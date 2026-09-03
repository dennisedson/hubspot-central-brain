/**
 * Enterpret data helpers.
 *
 * Enterpret is the voice-of-the-developer system that produces the friction
 * themes stored on `content_piece.enterpret_theme`. This module turns the data
 * stored alongside that theme into the developer quotes a writer sees on the
 * record, so they can read the actual words behind the theme they are writing
 * about.
 *
 * ---------------------------------------------------------------------------
 * THERE IS NO NETWORK CALL HERE — AND THAT IS THE DESIGN
 * ---------------------------------------------------------------------------
 * An earlier version of this file called the Enterpret HTTP API live from the
 * `EnterpretInsightsApi` app function. That path has been removed outright, for
 * two reasons that are not going to change:
 *
 *   1. NO API KEY IS OBTAINABLE. We do not have permission to create an
 *      Enterpret API key, so there is no credential to put in `secretKeys` and
 *      nothing to authenticate a live call with. The endpoint the old code used
 *      was also never publicly documented — it was an assumption modelled on
 *      Enterpret's MCP `find_user_quote` capability, and it could not be
 *      verified against a real account.
 *
 *   2. MCP CANNOT BE REACHED FROM HUBSPOT'S RUNTIME. Enterpret is connected to
 *      an AI assistant over MCP from a developer machine. A deployed HubSpot
 *      serverless function lives in a different runtime behind a different
 *      trust boundary; it has no MCP client, no session, and no route to that
 *      server. A function cannot "just call MCP".
 *
 * ---------------------------------------------------------------------------
 * THE STORED-PROPERTY MODEL
 * ---------------------------------------------------------------------------
 * Enterpret data reaches HubSpot out-of-band instead. Over MCP, an assistant
 * pulls the verbatims for a theme and batch-writes them onto the record:
 *
 *     enterpret_theme        string    the friction theme
 *     enterpret_quote_count  number    how many verbatims Enterpret has
 *     enterpret_quotes       string    a JSON array of quote objects (textarea)
 *
 * `enterpret_quotes` holds text like:
 *
 *     [{"text":"...","source":"Developer Slack","sentiment":"negative",
 *       "createdAt":"2026-08-14T00:00:00Z"}]
 *
 * At render time the app function does one thing: read those properties. No
 * key to rotate, no third-party latency on a card render, and no failure mode
 * beyond "the record has no data yet".
 *
 * BECAUSE THE WRITER IS A BATCH SYNC, NOT AN API CONTRACT, the stored string is
 * treated as untrusted input. `shapeQuotes` is total: empty, whitespace, null,
 * invalid JSON, a JSON object where an array was expected, and entries missing
 * fields all mean "no quotes" — never an exception. Everything in this file is
 * pure and unit-tested, so a card can never break on a bad sync.
 */

/** How many quotes to surface when the caller does not say. */
const DEFAULT_QUOTE_LIMIT = 5;

/** Above/below this score a numeric sentiment counts as positive/negative. */
const SENTIMENT_SCORE_THRESHOLD = 0.15;

export type EnterpretSentiment = 'positive' | 'negative' | 'neutral';

export interface EnterpretQuote {
  /** Enterpret's feedback record id, when the stored entry carries one. */
  id: string | null;
  /** The verbatim developer quote. Always non-empty — blanks are dropped. */
  text: string;
  /** Where the feedback came from, e.g. "GitHub Discussions". */
  source: string;
  sentiment: EnterpretSentiment;
  /** ISO timestamp as the sync stored it, or null if absent. */
  createdAt: string | null;
  /** Deep link back to the source record, or null if absent. */
  url: string | null;
}

export interface SentimentSummary {
  total: number;
  positive: number;
  negative: number;
  neutral: number;
  /** null only when there are no quotes at all. */
  dominant: EnterpretSentiment | null;
}

/* -------------------------------------------------------------------------- */
/* Pure shaping helpers (no network — these are what the unit tests cover)     */
/* -------------------------------------------------------------------------- */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** First non-blank string found at any of `keys`, else null. */
function pickString(raw: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = raw[key];
    if (typeof value === 'string' && value.trim().length > 0) return value.trim();
  }
  return null;
}

/** Trimmed theme, or null when the record has no usable theme. */
export function normaliseTheme(raw: string | null | undefined): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * HubSpot returns number properties as strings. Parse `enterpret_quote_count`
 * into a real number, preserving a legitimate 0 and rejecting junk.
 */
export function parseQuoteCount(raw: string | null | undefined): number | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed)) return null;
  return Math.round(parsed);
}

/**
 * Coerce whatever the sync wrote for sentiment into our three labels. Accepts a
 * label in any casing or a numeric score; anything unrecognised is neutral so
 * an unexpected value can never break the card.
 */
export function normaliseSentiment(raw: unknown): EnterpretSentiment {
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    if (raw > SENTIMENT_SCORE_THRESHOLD) return 'positive';
    if (raw < -SENTIMENT_SCORE_THRESHOLD) return 'negative';
    return 'neutral';
  }
  if (typeof raw === 'string') {
    const label = raw.trim().toLowerCase();
    if (label === 'positive' || label === 'negative' || label === 'neutral') return label;
  }
  return 'neutral';
}

/** The origin of a quote, whether flat (`source: "Slack"`) or nested. */
function extractSource(raw: Record<string, unknown>): string {
  const flat = pickString(raw, ['source', 'sourceName', 'channel', 'integration', 'sourceType']);
  if (flat) return flat;

  const nested = raw.source;
  if (isRecord(nested)) {
    const name = pickString(nested, ['name', 'displayName', 'type']);
    if (name) return name;
  }
  return 'Unknown source';
}

/** One stored entry to one quote, or null when there is no usable verbatim. */
function toQuote(raw: unknown): EnterpretQuote | null {
  if (!isRecord(raw)) return null;

  const text = pickString(raw, ['text', 'quote', 'verbatim', 'body', 'content', 'snippet']);
  if (!text) return null;

  return {
    id: pickString(raw, ['id', 'recordId', 'record_id', 'feedbackRecordId']),
    text,
    source: extractSource(raw),
    sentiment: normaliseSentiment(raw.sentiment ?? raw.sentimentLabel ?? raw.sentimentScore),
    createdAt: pickString(raw, ['createdAt', 'created_at', 'occurredAt', 'timestamp', 'date']),
    url: pickString(raw, ['url', 'permalink', 'link', 'sourceUrl', 'source_url']),
  };
}

/**
 * Decode the stored `enterpret_quotes` property into raw entries.
 *
 * The property is a textarea written by a batch sync, so every degenerate value
 * is expected traffic rather than an error: absent, empty, whitespace, and
 * unparseable text all decode to no entries, as does valid JSON that is not an
 * array (an object, a number, a bare string). Nothing here throws.
 *
 * An already-decoded array is passed through, which keeps the function usable
 * from a caller that has parsed the property itself.
 */
function decodeStoredQuotes(stored: unknown): unknown[] {
  if (Array.isArray(stored)) return stored;
  if (typeof stored !== 'string') return [];

  const trimmed = stored.trim();
  if (trimmed.length === 0) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return [];
  }
  return Array.isArray(parsed) ? parsed : [];
}

/**
 * Turn the stored `enterpret_quotes` JSON string into quotes.
 *
 * Total-loss tolerant by design: a malformed or half-written property yields an
 * empty list rather than an exception, so a bad sync degrades the card to its
 * "not synced yet" state instead of breaking it.
 */
export function shapeQuotes(stored: unknown, limit = DEFAULT_QUOTE_LIMIT): EnterpretQuote[] {
  const quotes: EnterpretQuote[] = [];
  for (const entry of decodeStoredQuotes(stored)) {
    const quote = toQuote(entry);
    if (quote) quotes.push(quote);
    if (quotes.length >= limit) break;
  }
  return quotes;
}

/**
 * Count sentiments and pick the dominant one. Ties resolve to negative, then
 * positive, then neutral — a friction theme's negative signal is the point of
 * the card, so it should never be hidden by a tie.
 */
export function summariseSentiment(quotes: EnterpretQuote[]): SentimentSummary {
  const summary: SentimentSummary = {
    total: quotes.length,
    positive: 0,
    negative: 0,
    neutral: 0,
    dominant: null,
  };

  for (const quote of quotes) summary[quote.sentiment] += 1;
  if (summary.total === 0) return summary;

  const ranked: EnterpretSentiment[] = ['negative', 'positive', 'neutral'];
  summary.dominant = ranked.reduce((best, label) =>
    summary[label] > summary[best] ? label : best,
  );
  return summary;
}
