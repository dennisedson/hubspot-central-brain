/**
 * Pure UTM link construction for video attribution.
 *
 * WHY THIS IS ITS OWN MODULE
 * --------------------------
 * This is the whole of the ported Firebase logic that can go wrong silently.
 * The old `workflowGenerateUtm` built its link with:
 *
 *     const separator = destinationUrl.includes('?') ? '&' : '?';
 *     const utmLink = `${destinationUrl}${separator}${utmParams.toString()}`;
 *
 * which is wrong in four ways that all still return 200 and still look like a
 * URL in the CRM:
 *
 *   1. A fragment swallows the parameters. `https://x.com/p#faq` becomes
 *      `https://x.com/p#faq?utm_source=…` — everything after `#` never reaches
 *      the server, so the visit is recorded as direct traffic.
 *   2. A destination that already carries `utm_source` ends up with the
 *      parameter twice; which one analytics keeps is undefined.
 *   3. `URLSearchParams` encodes a space as `+`, so an un-slugified campaign
 *      name lands in reports as `q1+launch` next to `q1-launch` from another
 *      link, splitting one campaign across two rows.
 *   4. Nothing validated the destination, so a blank `website_url` produced the
 *      link `?utm_source=youtube…` and wrote it to the record.
 *
 * Everything here is pure: no network, no env, no HubSpot. That is what makes
 * the rules above cheap to assert one at a time in `__tests__/utm.test.ts`.
 */

/** Default `utm_source`. Every link this app builds starts life on YouTube. */
export const DEFAULT_UTM_SOURCE = 'youtube';

/** Default `utm_medium` when a workflow leaves the placement blank. */
export const DEFAULT_UTM_MEDIUM = 'video_description';

/**
 * The placements offered by the workflow action. These strings are the option
 * `value`s in `workflow-actions/generate-utm-hsmeta.json` and they travel into
 * reports verbatim — `normalizeToken` keeps the underscores rather than
 * hyphenating them, so what an analyst filters on is exactly what they picked.
 */
export const UTM_MEDIUMS = [
  'video_description',
  'video_card',
  'end_screen',
  'pinned_comment',
] as const;

export type UtmMedium = (typeof UTM_MEDIUMS)[number];

export function isUtmMedium(value: unknown): value is UtmMedium {
  return typeof value === 'string' && (UTM_MEDIUMS as readonly string[]).includes(value);
}

/**
 * `utm_content` cap. Long video titles otherwise dominate the report column and
 * push the useful parameters off screen. Matches the legacy `substring(0, 50)`.
 */
export const MAX_UTM_CONTENT_LENGTH = 50;

export type UtmErrorCode =
  | 'missing_destination_url'
  | 'invalid_destination_url'
  | 'missing_campaign_name';

/** Thrown by the builders below. `code` maps straight onto a workflow `reason`. */
export class UtmError extends Error {
  readonly code: UtmErrorCode;

  constructor(code: UtmErrorCode, message: string) {
    super(message);
    this.name = 'UtmError';
    this.code = code;
  }
}

interface NormalizeOptions {
  /** Keep `_` as a real character instead of folding it into the separator. */
  allowUnderscore: boolean;
  /** 0 means no cap. */
  maxLength: number;
}

/**
 * Fold to lowercase ASCII and replace every run of disallowed characters with a
 * single `-`. Accents are decomposed first so "Développement" survives as
 * "developpement" rather than being gutted to "d-veloppement".
 *
 * This is also the injection guard: `&`, `=`, `#`, `?` and whitespace are all
 * disallowed, so no campaign name a human types into a workflow can add a
 * parameter of its own to the finished link.
 */
function normalize(value: unknown, options: NormalizeOptions): string {
  if (typeof value !== 'string') return '';

  const allowed = options.allowUnderscore ? /[^a-z0-9_]+/g : /[^a-z0-9]+/g;
  const trimmable = options.allowUnderscore ? /^[-_]+|[-_]+$/g : /^-+|-+$/g;

  const ascii = value
    .normalize('NFKD')
    // Strip the combining marks NFKD just split off the base letters.
    .replace(/[\u0300-\u036f]/g, '');

  const slug = ascii.toLowerCase().replace(allowed, '-').replace(trimmable, '');

  if (options.maxLength <= 0 || slug.length <= options.maxLength) return slug;
  // Never leave a dangling separator behind after the cut.
  return slug.slice(0, options.maxLength).replace(trimmable, '');
}

/** "Q1 Launch & Beyond" -> "q1-launch-beyond". Used for campaign / content / term. */
export function slugify(value: unknown, maxLength = 0): string {
  return normalize(value, { allowUnderscore: false, maxLength });
}

/** "Video_Description" -> "video_description". Used for source / medium. */
export function normalizeToken(value: unknown, maxLength = 0): string {
  return normalize(value, { allowUnderscore: true, maxLength });
}

/**
 * Parse a destination into a `URL`, or throw a `UtmError` naming why not.
 *
 * A workflow's static-value field is typed by a human, so a bare
 * "developers.hubspot.com/pricing" is a likely input and is upgraded to
 * `https://`. Anything that already declares a scheme keeps it and must be
 * http(s) — silently rewriting `ftp://x.com/f` to `https://ftp//x.com/f` (which
 * is what prepending would do) is worse than refusing it.
 */
export function normalizeDestinationUrl(value: unknown): URL {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  if (!trimmed) {
    throw new UtmError('missing_destination_url', 'A destination URL is required');
  }

  const hasHttpScheme = /^https?:\/\//i.test(trimmed);
  const hasOtherScheme = !hasHttpScheme && /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed);
  if (hasOtherScheme) {
    throw new UtmError(
      'invalid_destination_url',
      `Destination URL must be http or https: ${trimmed}`,
    );
  }

  let url: URL;
  try {
    url = new URL(hasHttpScheme ? trimmed : `https://${trimmed}`);
  } catch {
    throw new UtmError('invalid_destination_url', `Not a usable destination URL: ${trimmed}`);
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new UtmError(
      'invalid_destination_url',
      `Destination URL must be http or https: ${trimmed}`,
    );
  }

  return url;
}

export interface UtmParamsInput {
  campaignName?: unknown;
  /** Placement. Falls back to DEFAULT_UTM_MEDIUM when blank. */
  medium?: unknown;
  source?: unknown;
  /** Usually the video title. Omitted from the link when it slugs to nothing. */
  content?: unknown;
  term?: unknown;
}

/**
 * The `utm_*` pairs, in the order they will appear in the link. Order is fixed
 * so the same inputs always produce a byte-identical URL — an equality check on
 * the stored `utm_link` is then meaningful.
 *
 * A parameter with no value is omitted entirely rather than emitted empty:
 * `utm_content=` is a real value in most analytics tools and would show up as
 * its own row.
 */
export function buildUtmParams(input: UtmParamsInput): Record<string, string> {
  const campaign = slugify(input.campaignName);
  if (!campaign) {
    throw new UtmError(
      'missing_campaign_name',
      'A campaign name is required to build a UTM link',
    );
  }

  const params: Record<string, string> = {
    utm_source: normalizeToken(input.source) || DEFAULT_UTM_SOURCE,
    utm_medium: normalizeToken(input.medium) || DEFAULT_UTM_MEDIUM,
    utm_campaign: campaign,
  };

  const content = slugify(input.content, MAX_UTM_CONTENT_LENGTH);
  if (content) params.utm_content = content;

  const term = slugify(input.term, MAX_UTM_CONTENT_LENGTH);
  if (term) params.utm_term = term;

  return params;
}

function queryKeyOf(pair: string): string {
  const raw = pair.split('=', 1)[0];
  try {
    return decodeURIComponent(raw).toLowerCase();
  } catch {
    // A stray '%' in the original query is not our problem to fix.
    return raw.toLowerCase();
  }
}

/**
 * Splice `params` into `url`'s query, replacing any parameter of the same name
 * and leaving every other one byte-for-byte as it arrived.
 *
 * Rebuilt by hand rather than through `url.searchParams`, which round-trips the
 * whole query and rewrites a literal space as `+`. Non-utm parameters belong to
 * the destination site and must come out the far side untouched.
 *
 * The fragment is re-attached last, which is the fix for the swallowed-params
 * bug in the header.
 */
export function appendUtmParams(url: URL, params: Record<string, string>): string {
  // `href` is exactly base + search + hash, so this keeps any userinfo the
  // destination carried while giving us the query to rewrite.
  const base = url.href.slice(0, url.href.length - url.search.length - url.hash.length);

  const replacing = new Set(Object.keys(params).map(key => key.toLowerCase()));
  const preserved = url.search
    .replace(/^\?/, '')
    .split('&')
    .filter(Boolean)
    .filter(pair => !replacing.has(queryKeyOf(pair)));

  const added = Object.entries(params).map(
    ([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`,
  );

  const query = [...preserved, ...added].join('&');
  return `${base}${query ? `?${query}` : ''}${url.hash}`;
}

export interface UtmLinkInput extends UtmParamsInput {
  destinationUrl?: unknown;
}

export interface UtmLink {
  /** The finished, shareable link. */
  url: string;
  /** The parameters that were spliced in, for logging and workflow outputs. */
  params: Record<string, string>;
  /** The destination after normalisation, with any previous utm_* still on it. */
  destinationUrl: string;
}

/**
 * Build the tracked link. Throws `UtmError` when the destination or the
 * campaign name cannot produce a usable one.
 */
export function buildUtmLink(input: UtmLinkInput): UtmLink {
  const url = normalizeDestinationUrl(input.destinationUrl);
  const params = buildUtmParams(input);
  return { url: appendUtmParams(url, params), params, destinationUrl: url.href };
}
