/**
 * Pure scoring logic for the Related Content feature.
 *
 * No I/O lives here — callers fetch records from HubSpot, map them into
 * `RelatedCandidate` shapes, and hand them to `scoreRelated`.
 */

/** Points awarded for each topic tag the source and candidate share. */
export const TAG_WEIGHT = 2;

/** Points awarded when the source and candidate share an Enterpret theme. */
export const THEME_WEIGHT = 3;

export interface RelatedCandidate {
  id: string;
  topicTags: string[];
  enterpretTheme: string | null;
}

export interface RankedCandidate<T extends RelatedCandidate = RelatedCandidate> {
  /** The candidate object exactly as it was passed in, so extra fields survive. */
  candidate: T;
  score: number;
  /** Shared tags, spelled the way the source record spells them. */
  matchedTags: string[];
  /** The shared theme (source spelling), or null when the theme did not match. */
  matchedTheme: string | null;
}

/**
 * Splits a HubSpot property string into topic tags.
 *
 * Semicolon is HubSpot's multi-select (checkbox/enumeration) convention, so
 * `content_piece.topic_tags` arrives as `"api;crm;workflows"`. Commas are
 * accepted too because `video.tags` is a plain free-text property where a
 * human is just as likely to type `"api, crm"`.
 *
 * Segments are trimmed, empties are dropped, and duplicates are removed
 * case-insensitively — the first spelling encountered wins.
 */
export function parseTopicTags(raw: string | null | undefined): string[] {
  if (!raw) return [];

  const seen = new Set<string>();
  const tags: string[] = [];

  for (const segment of raw.split(/[;,]/)) {
    const tag = segment.trim();
    if (!tag) continue;
    const key = tag.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    tags.push(tag);
  }

  return tags;
}

function normalizeTheme(theme: string | null | undefined): string | null {
  const trimmed = theme?.trim();
  return trimmed ? trimmed.toLowerCase() : null;
}

/**
 * Ranks candidates against a source record.
 *
 * Scoring: TAG_WEIGHT per shared topic tag, plus THEME_WEIGHT when the
 * Enterpret themes match. Tag and theme comparison is case-insensitive.
 *
 * The source record is excluded by id, candidates scoring zero are dropped,
 * and the result is sorted by score descending. The sort is stable, so
 * candidates with equal scores keep the order they were given in — which
 * preserves any upstream ordering (e.g. most recently modified first).
 */
export function scoreRelated<T extends RelatedCandidate>(
  source: RelatedCandidate,
  candidates: T[],
): RankedCandidate<T>[] {
  const sourceTheme = normalizeTheme(source.enterpretTheme);

  // Map normalized tag -> the source record's spelling, for readable output.
  const sourceTags = new Map<string, string>();
  for (const tag of source.topicTags) {
    const key = tag.trim().toLowerCase();
    if (key && !sourceTags.has(key)) sourceTags.set(key, tag.trim());
  }

  const ranked: RankedCandidate<T>[] = [];

  for (const candidate of candidates) {
    if (candidate.id === source.id) continue;

    const matchedKeys = new Set<string>();
    for (const tag of candidate.topicTags) {
      const key = tag.trim().toLowerCase();
      if (key && sourceTags.has(key)) matchedKeys.add(key);
    }

    const candidateTheme = normalizeTheme(candidate.enterpretTheme);
    const themeMatched = sourceTheme !== null && candidateTheme === sourceTheme;

    const score = matchedKeys.size * TAG_WEIGHT + (themeMatched ? THEME_WEIGHT : 0);
    if (score === 0) continue;

    // Report matched tags in the source record's declared order.
    const matchedTags = [...sourceTags.entries()]
      .filter(([key]) => matchedKeys.has(key))
      .map(([, spelling]) => spelling);

    ranked.push({
      candidate,
      score,
      matchedTags,
      matchedTheme: themeMatched ? (source.enterpretTheme as string).trim() : null,
    });
  }

  return ranked.sort((a, b) => b.score - a.score);
}
