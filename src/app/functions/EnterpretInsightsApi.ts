import { getPortalConfig } from '../lib/portal-config';
import {
  summariseSentiment,
  normaliseTheme,
  parseQuoteCount,
  shapeQuotes,
} from '../lib/enterpret-client';
import type { EnterpretQuote, SentimentSummary } from '../lib/enterpret-client';
import { HS_BASE, objectPath } from '../lib/hs-api';

/** How many verbatims to surface in the card. */
const QUOTE_LIMIT = 5;

/** The three Enterpret properties a content_piece carries. */
const ENTERPRET_PROPS = ['enterpret_theme', 'enterpret_quote_count', 'enterpret_quotes'];

interface EnterpretInsightsContext {
  accountId?: number;
  parameters?: Record<string, string | undefined>;
  query?: Record<string, string | undefined>;
  body?: Record<string, string | undefined>;
}

interface InsightsPayload {
  /** The friction theme stored on the record, or null. */
  theme: string | null;
  /** `enterpret_quote_count` from the record as a number, or null. */
  quoteCount: number | null;
  /** Parsed from `enterpret_quotes`. Empty when nothing has been synced. */
  quotes: EnterpretQuote[];
  /** Summary of `quotes`, or null when there are none to summarise. */
  sentiment: SentimentSummary | null;
  /**
   * Retained so the card's payload contract does not change shape. There is no
   * external call left to fail here, so this is always null — a read failure is
   * a non-200 instead (see the status codes below).
   */
  errors: { enterpret: string | null };
}

function param(ctx: EnterpretInsightsContext, key: string): string | undefined {
  return ctx.parameters?.[key] ?? ctx.query?.[key] ?? ctx.body?.[key];
}

function json(statusCode: number, payload: unknown) {
  return { statusCode, body: JSON.stringify(payload) };
}

/**
 * Returns the Enterpret data stored on a content_piece: the friction theme, the
 * quote count, and the developer verbatims behind that theme.
 *
 * THIS HANDLER MAKES EXACTLY ONE HTTP CALL — the CRM record read. It never
 * talks to Enterpret.
 *
 * Enterpret has no obtainable API key for us, and the assistant that does have
 * access reaches it over MCP, which a deployed HubSpot function cannot use: a
 * different runtime behind a different trust boundary, with no MCP client and
 * no route to that server. So the quotes are batch-synced into the
 * `enterpret_quotes` property out-of-band and this function simply reads them.
 * `secretKeys` is therefore just `["HS_ACCESS_TOKEN"]` — there is no Enterpret
 * credential anywhere in this app, and nothing to rotate.
 *
 * `enterpret_quotes` is untrusted input: absent, empty or malformed JSON all
 * shape to zero quotes (see `shapeQuotes`), which the card renders as its
 * "not synced yet" state. A bad sync never becomes an error here.
 */
export async function main(context: EnterpretInsightsContext) {
  const token = process.env.PRIVATE_APP_ACCESS_TOKEN ?? process.env.HS_ACCESS_TOKEN;
  const objectId = param(context, 'objectId');
  const portalId = context.accountId;

  if (!token) return json(500, { error: 'No HubSpot access token' });
  if (!objectId) return json(400, { error: 'objectId is required' });
  if (!portalId) return json(400, { error: 'accountId missing from context' });

  const config = getPortalConfig(portalId);
  const url = `${HS_BASE}${objectPath(config.content.objectTypeId, objectId)}?properties=${ENTERPRET_PROPS.join(',')}`;

  const recordRes = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!recordRes.ok) {
    return json(502, { error: `Could not read record ${objectId}: ${recordRes.status}` });
  }
  const record = (await recordRes.json()) as { properties: Record<string, string | null> };

  const quotes = shapeQuotes(record.properties.enterpret_quotes, QUOTE_LIMIT);

  const payload: InsightsPayload = {
    theme: normaliseTheme(record.properties.enterpret_theme),
    quoteCount: parseQuoteCount(record.properties.enterpret_quote_count),
    quotes,
    sentiment: quotes.length > 0 ? summariseSentiment(quotes) : null,
    errors: { enterpret: null },
  };

  return json(200, payload);
}
