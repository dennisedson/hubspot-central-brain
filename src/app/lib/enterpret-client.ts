/**
 * Enterpret client.
 *
 * Enterpret is the voice-of-the-developer system that produces the friction
 * themes stored on `content_piece.enterpret_theme`. This client turns a theme
 * back into the underlying developer quotes so a writer can see the actual
 * words behind the theme they are writing about.
 *
 * ---------------------------------------------------------------------------
 * NOT YET CONFIGURED
 * ---------------------------------------------------------------------------
 * `ENTERPRET_API_KEY` is deliberately NOT declared in
 * `src/app/functions/EnterpretInsightsApi-hsmeta.json`. Declaring a secret that
 * does not exist in the portal fails the project deploy, so the app ships today
 * with the key absent and `isEnterpretConfigured()` returning false — a normal,
 * first-class state, never an error.
 *
 * TO ACTIVATE, once the secret exists in the portal
 * (`hs secrets add ENTERPRET_API_KEY`):
 *
 *   in src/app/functions/EnterpretInsightsApi-hsmeta.json change
 *     "secretKeys": ["HS_ACCESS_TOKEN"]
 *   to
 *     "secretKeys": ["HS_ACCESS_TOKEN", "ENTERPRET_API_KEY"]
 *
 * That is the whole change. No code edit is required.
 *
 * ---------------------------------------------------------------------------
 * ABOUT THE ENDPOINT SHAPE
 * ---------------------------------------------------------------------------
 * Enterpret's only publicly documented HTTP surface is the bulk Export API
 * (`POST https://api.enterpret.com/export/external/v2/export`, bearer auth),
 * which returns signed CSV file URLs — far too heavy for a CRM card. The
 * per-theme verbatim lookup used here mirrors the `find_user_quote` capability
 * exposed by Enterpret's MCP server, but its REST equivalent is NOT publicly
 * documented and could NOT be verified.
 *
 * The request shape below is therefore an assumption. It is contained in
 * exactly one place — `requestQuotes()` plus the two constants above it — so
 * correcting it later is a small, local edit. Everything else in this file is
 * pure, unit-tested and tolerant of field-name variation, so a differently
 * named-but-similar response still shapes correctly.
 */

/** Base URL for the Enterpret HTTP API. */
const ENTERPRET_API_BASE = 'https://api.enterpret.com';

/** ASSUMED path for the per-theme verbatim query. See the file header. */
const QUOTES_PATH = '/external/v2/feedback-records/query';

/** How many quotes to pull when the caller does not say. */
const DEFAULT_QUOTE_LIMIT = 5;

/** Above/below this score a numeric sentiment counts as positive/negative. */
const SENTIMENT_SCORE_THRESHOLD = 0.15;

export type EnterpretSentiment = 'positive' | 'negative' | 'neutral';

export interface EnterpretQuote {
  /** Enterpret's feedback record id, when the response carries one. */
  id: string | null;
  /** The verbatim developer quote. Always non-empty — blanks are dropped. */
  text: string;
  /** Where the feedback came from, e.g. "GitHub Discussions". */
  source: string;
  sentiment: EnterpretSentiment;
  /** ISO timestamp as Enterpret returned it, or null if absent. */
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
/* Configuration                                                              */
/* -------------------------------------------------------------------------- */

/**
 * Whether an Enterpret API key is available to this runtime.
 *
 * False is the expected state today and is never an error: callers should fall
 * back to the theme and quote count already stored on the CRM record.
 */
export function isEnterpretConfigured(): boolean {
  const key = process.env.ENTERPRET_API_KEY;
  return typeof key === 'string' && key.trim().length > 0;
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
 * Coerce whatever Enterpret calls sentiment into our three labels. Accepts a
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

/** One raw entry to one quote, or null when there is no usable verbatim text. */
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

/** Envelope keys an Enterpret-shaped response might wrap its rows in. */
const LIST_KEYS = ['records', 'results', 'data', 'feedbackRecords', 'feedback_records', 'items', 'quotes'];

/** Locate the row array inside a response envelope we cannot fully predict. */
function extractList(payload: unknown): unknown[] {
  if (Array.isArray(payload)) return payload;
  if (!isRecord(payload)) return [];
  for (const key of LIST_KEYS) {
    const value = payload[key];
    if (Array.isArray(value)) return value;
  }
  return [];
}

/**
 * Turn a raw Enterpret response into quotes. Total-loss tolerant: a malformed
 * payload yields an empty list rather than an exception, so a shape change at
 * Enterpret degrades the card instead of breaking it.
 */
export function shapeQuotes(payload: unknown, limit = DEFAULT_QUOTE_LIMIT): EnterpretQuote[] {
  const quotes: EnterpretQuote[] = [];
  for (const entry of extractList(payload)) {
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

/* -------------------------------------------------------------------------- */
/* Network (the only unverified part — keep it small)                         */
/* -------------------------------------------------------------------------- */

/**
 * The single HTTP call in this module. Throws on transport failure, matching
 * the error style of `linear-client.ts`; callers isolate that with
 * `Promise.allSettled` so one bad integration never fails a whole response.
 */
async function requestQuotes(apiKey: string, theme: string, limit: number): Promise<unknown> {
  const response = await fetch(`${ENTERPRET_API_BASE}${QUOTES_PATH}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      filter: { reason: theme },
      limit,
    }),
  });

  if (!response.ok) {
    throw new Error(`Enterpret API HTTP error: ${response.status} ${response.statusText}`);
  }
  return response.json();
}

/** Fetch the developer quotes behind a friction theme. */
export async function getEnterpretQuotes(
  apiKey: string,
  theme: string,
  limit: number = DEFAULT_QUOTE_LIMIT,
): Promise<EnterpretQuote[]> {
  if (!apiKey || apiKey.trim().length === 0) {
    throw new Error('Enterpret API key is missing');
  }

  const normalisedTheme = normaliseTheme(theme);
  if (!normalisedTheme) return [];

  const payload = await requestQuotes(apiKey.trim(), normalisedTheme, limit);
  return shapeQuotes(payload, limit);
}
