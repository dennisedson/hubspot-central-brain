/**
 * Template-based LinkedIn draft generation for Content Piece records.
 *
 * Deliberately NOT AI-generated: no LLM call, no API key, no network, no
 * dependencies. Given the properties we already store on a content_piece we can
 * assemble a solid first draft that a human then edits in HubSpot. Keeping this
 * pure makes it fast, free, deterministic and trivially testable.
 */

/** LinkedIn's own limit is 3000; we stop at 2800 to leave editing headroom. */
export const MAX_DRAFT_LENGTH = 2800;

/** More than four hashtags reads as spam on LinkedIn. */
export const MAX_HASHTAGS = 4;

const ELLIPSIS = '…';

export interface SocialDraftInput {
  title?: string | null;
  contentType?: string | null;
  publishedUrl?: string | null;
  /** Array, or the ";"-separated string HubSpot returns for a multi-checkbox property. */
  topicTags?: string | string[] | null;
  enterpretTheme?: string | null;
}

export interface ContentTypeVariant {
  /** First line of the post. */
  opener: string;
  /** Call to action that precedes the published URL. */
  cta: string;
}

/**
 * Keyed by the `content_type` enum values provisioned in provision-objects.ts.
 * Exported so the copy can be tweaked (and asserted on) without touching logic.
 */
export const CONTENT_TYPE_VARIANTS: Record<string, ContentTypeVariant> = {
  blog_post: {
    opener: 'New blog post is live.',
    cta: 'Read the full post:',
  },
  video: {
    opener: 'New video just dropped.',
    cta: 'Watch it here:',
  },
  tutorial: {
    opener: 'Fresh tutorial, start to finish.',
    cta: 'Follow along here:',
  },
  talk: {
    opener: 'The talk recording is now up.',
    cta: 'Watch the talk:',
  },
  changelog: {
    opener: 'Heads up — there is a new changelog entry worth knowing about.',
    cta: 'Full details:',
  },
  documentation: {
    opener: 'New documentation just landed.',
    cta: 'Read the docs:',
  },
  social: {
    opener: 'Something worth sharing.',
    cta: 'More here:',
  },
};

/** Used when content_type is missing, blank, or a value we have no copy for. */
export const DEFAULT_VARIANT: ContentTypeVariant = {
  opener: 'Sharing something new.',
  cta: 'Take a look:',
};

/**
 * Words that should stay fully uppercase in a hashtag. HubSpot stores topic
 * tags as lowercase enum values ("api", "ui_extensions"), so without this every
 * hashtag would come out as "#Api" / "#UiExtensions".
 */
export const HASHTAG_ACRONYMS = new Set([
  'api', 'crm', 'cms', 'ui', 'ux', 'ai', 'ml', 'sdk', 'cli', 'seo',
  'hubl', 'graphql', 'oauth', 'json', 'http', 'https', 'css', 'html', 'saas',
]);

function clean(value: string | null | undefined): string {
  return typeof value === 'string' ? value.trim() : '';
}

function capitalizeWord(word: string): string {
  if (HASHTAG_ACRONYMS.has(word.toLowerCase())) return word.toUpperCase();
  return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
}

/**
 * "developer platform" -> "#DeveloperPlatform", "ui_extensions" -> "#UIExtensions".
 * Returns '' for a tag with no alphanumeric content so callers can filter it out.
 */
export function toHashtag(tag: string | null | undefined): string {
  const words = clean(tag).split(/[^a-zA-Z0-9]+/).filter(Boolean);
  if (words.length === 0) return '';
  return `#${words.map(capitalizeWord).join('')}`;
}

/**
 * Normalises HubSpot's multi-checkbox value (or an array) into at most
 * MAX_HASHTAGS de-duplicated hashtags, in the order supplied.
 */
export function buildHashtags(tags: string | string[] | null | undefined): string[] {
  if (!tags) return [];
  const raw = Array.isArray(tags) ? tags : tags.split(/[;,]/);

  const seen = new Set<string>();
  const hashtags: string[] = [];
  for (const tag of raw) {
    const hashtag = toHashtag(tag);
    if (!hashtag) continue;
    const key = hashtag.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    hashtags.push(hashtag);
    if (hashtags.length === MAX_HASHTAGS) break;
  }
  return hashtags;
}

function variantFor(contentType: string | null | undefined): ContentTypeVariant {
  const key = clean(contentType).toLowerCase();
  return CONTENT_TYPE_VARIANTS[key] ?? DEFAULT_VARIANT;
}

/**
 * Cut `text` down to `limit` characters, preferring a word boundary and marking
 * the cut with an ellipsis. Returns '' if there is no room for anything useful.
 */
function truncate(text: string, limit: number): string {
  if (limit <= 0) return '';
  if (text.length <= limit) return text;

  const room = limit - ELLIPSIS.length;
  if (room <= 0) return '';

  let cut = text.slice(0, room).replace(/\s+$/, '');
  const lastSpace = cut.lastIndexOf(' ');
  // Only fall back to a word boundary if it does not throw away most of the text.
  if (lastSpace > room * 0.6) cut = cut.slice(0, lastSpace);
  cut = cut.replace(/[\s.,;:!?-]+$/, '');

  return cut.length > 0 ? `${cut}${ELLIPSIS}` : '';
}

/**
 * Build the LinkedIn draft. Blocks are separated by a blank line; any block
 * that has no content is dropped entirely, so a record with no URL never
 * produces a dangling "Read the full post:" fragment.
 *
 * The URL block and the hashtag block are treated as a fixed tail: when the
 * draft is over MAX_DRAFT_LENGTH only the body (opener / title / theme) is
 * truncated, so the link and the hashtags always survive.
 */
export function generateSocialDraft(input: SocialDraftInput): string {
  const variant = variantFor(input.contentType);
  const title = clean(input.title);
  const theme = clean(input.enterpretTheme);
  const url = clean(input.publishedUrl);
  const hashtags = buildHashtags(input.topicTags);

  const bodyBlocks = [
    variant.opener,
    title,
    theme ? `This one came straight from what developers keep telling us about ${theme}.` : '',
  ].filter(Boolean);

  const tailBlocks = [
    url ? `${variant.cta} ${url}` : '',
    hashtags.length > 0 ? hashtags.join(' ') : '',
  ].filter(Boolean);

  const body = bodyBlocks.join('\n\n');
  const tail = tailBlocks.join('\n\n');

  if (!tail) return truncate(body, MAX_DRAFT_LENGTH);
  if (!body) return tail;

  const separator = '\n\n';
  const full = `${body}${separator}${tail}`;
  if (full.length <= MAX_DRAFT_LENGTH) return full;

  // The tail is protected. Truncate the body to whatever room is left.
  const roomForBody = MAX_DRAFT_LENGTH - tail.length - separator.length;
  const trimmedBody = truncate(body, roomForBody);
  return trimmedBody ? `${trimmedBody}${separator}${tail}` : tail;
}
