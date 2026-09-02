import { getPortalConfig } from '../lib/portal-config';
import {
  isEnterpretConfigured,
  getEnterpretQuotes,
  summariseSentiment,
  normaliseTheme,
  parseQuoteCount,
} from '../lib/enterpret-client';
import type { EnterpretQuote, SentimentSummary } from '../lib/enterpret-client';

const HS_BASE = 'https://api.hubapi.com';

/** How many verbatims to surface in the card. */
const QUOTE_LIMIT = 5;

interface EnterpretInsightsContext {
  accountId?: number;
  parameters?: Record<string, string | undefined>;
  query?: Record<string, string | undefined>;
  body?: Record<string, string | undefined>;
}

interface InsightsPayload {
  /** False whenever no Enterpret API key is available. Never an error. */
  configured: boolean;
  /** The friction theme stored on the record, or null. */
  theme: string | null;
  /** `enterpret_quote_count` from the record as a number, or null. */
  quoteCount: number | null;
  quotes: EnterpretQuote[];
  sentiment: SentimentSummary | null;
  errors: { enterpret: string | null };
}

function param(ctx: EnterpretInsightsContext, key: string): string | undefined {
  return ctx.parameters?.[key] ?? ctx.query?.[key] ?? ctx.body?.[key];
}

function json(statusCode: number, payload: unknown) {
  return { statusCode, body: JSON.stringify(payload) };
}

function reason(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Returns the Enterpret friction theme stored on a content_piece plus, when an
 * Enterpret API key is available, the developer quotes behind that theme.
 *
 * The unconfigured path is a first-class success: it still returns 200 with the
 * stored `theme` and `quoteCount` so the card renders something useful today.
 *
 * `ENTERPRET_API_KEY` is intentionally absent from `secretKeys` in
 * EnterpretInsightsApi-hsmeta.json — see the note at the declaration site below.
 */
export async function main(context: EnterpretInsightsContext) {
  const token = process.env.PRIVATE_APP_ACCESS_TOKEN ?? process.env.HS_ACCESS_TOKEN;
  const objectId = param(context, 'objectId');
  const portalId = context.accountId;

  if (!token) return json(500, { error: 'No HubSpot access token' });
  if (!objectId) return json(400, { error: 'objectId is required' });
  if (!portalId) return json(400, { error: 'accountId missing from context' });

  const config = getPortalConfig(portalId);
  const props = ['enterpret_theme', 'enterpret_quote_count'];
  const url = `${HS_BASE}/crm/v3/objects/${config.content.objectTypeId}/${objectId}?properties=${props.join(',')}`;

  const recordRes = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!recordRes.ok) {
    return json(502, { error: `Could not read record ${objectId}: ${recordRes.status}` });
  }
  const record = (await recordRes.json()) as { properties: Record<string, string | null> };

  const theme = normaliseTheme(record.properties.enterpret_theme);
  const quoteCount = parseQuoteCount(record.properties.enterpret_quote_count);

  const payload: InsightsPayload = {
    configured: false,
    theme,
    quoteCount,
    quotes: [],
    sentiment: null,
    errors: { enterpret: null },
  };

  // ---------------------------------------------------------------------
  // ENTERPRET_API_KEY is NOT declared in EnterpretInsightsApi-hsmeta.json.
  // The secret does not exist in the portal yet, and declaring a missing
  // secret fails the project deploy — so this reads as `undefined` today and
  // `isEnterpretConfigured()` is simply false.
  //
  // WHEN THE SECRET IS PROVISIONED, add it to `secretKeys` in
  // src/app/functions/EnterpretInsightsApi-hsmeta.json:
  //   "secretKeys": ["HS_ACCESS_TOKEN", "ENTERPRET_API_KEY"]
  // No other change is required.
  // ---------------------------------------------------------------------
  const apiKey = process.env.ENTERPRET_API_KEY;

  if (!isEnterpretConfigured() || !theme) {
    return json(200, payload);
  }

  // Per-source isolation, as in TaskStatusApi: an Enterpret outage must never
  // cost the caller the fields we already have on the record.
  const [outcome] = await Promise.allSettled([
    getEnterpretQuotes(apiKey ?? '', theme, QUOTE_LIMIT),
  ]);

  payload.configured = true;

  if (outcome.status === 'rejected') {
    payload.errors.enterpret = reason(outcome.reason);
  } else {
    payload.quotes = outcome.value;
    payload.sentiment = summariseSentiment(outcome.value);
  }

  return json(200, payload);
}
