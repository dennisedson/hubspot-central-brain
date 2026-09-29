import { getPortalConfig } from '../lib/portal-config';
import { HS_BASE, objectPath, objectSearchPath } from '../lib/hs-api';
import { isDeletionNotice, parseFeedEntries } from '../lib/youtube-websub';

/**
 * WebSub callback for YouTube channel notifications.
 *
 * Two protocols share this endpoint, which is why it accepts both verbs:
 *
 *   GET   the hub verifying a subscription. Echo `hub.challenge` back verbatim,
 *         as plain text, immediately. This is time-sensitive — the hub gives up
 *         quickly, and a slow or decorated answer fails the subscription with no
 *         error anywhere on our side.
 *
 *   POST  a notification carrying an Atom feed. Extract the video ids and mark
 *         the matching records so the next sync picks them up.
 *
 * BLOCKED BY THE PLATFORM (verified 2026-09-10)
 * -------------------------------------------
 * This cannot receive notifications today. HubSpot's serverless gateway accepts
 * only `application/json` bodies; YouTube's hub sends `application/atom+xml`.
 * Measured against the deployed endpoint:
 *
 *     application/atom+xml  -> 415      text/plain        -> 415
 *     application/xml       -> 415      (no content-type) -> 415
 *     text/xml              -> 415      application/json  -> 200, reaches here
 *
 * The rejection happens at the gateway, before any of this runs, so nothing
 * here can compensate. The GET verification path DOES work — it carries no body
 * — which makes this worse rather than better: a subscription verifies, looks
 * established, and then silently delivers nothing.
 *
 * The only route through would be an external relay converting Atom to JSON,
 * which is exactly the external hosting this project exists to avoid. The
 * subscription created while testing this was unsubscribed for that reason: an
 * active subscription that cannot deliver is worse than none.
 *
 * The code is kept, tested, and ready. If the gateway ever accepts XML, this
 * works as written.
 *
 * WHAT THIS DELIBERATELY DOES NOT DO
 * ----------------------------------
 * It does not call YouTube. A notification means "something changed", not "here
 * are the new statistics" — the feed carries no metrics at all. Fetching them
 * here would put a YouTube round-trip inside a callback the hub expects to
 * answer fast, and would duplicate logic the sync already owns.
 *
 * It also does not create records. A notification for a video with no Video
 * record is recorded and ignored: inventing CRM records from an unauthenticated
 * public endpoint is how a webhook becomes a spam vector.
 */

/** Anyone can POST here. Nothing this handler does is destructive, by design. */
const NOTIFY_PROPERTIES = ['youtube_video_id'] as const;

interface WebhookContext {
  accountId?: number;
  method?: string;
  params?: Record<string, string | string[] | undefined>;
  parameters?: Record<string, string | undefined>;
  query?: Record<string, string | undefined>;
  body?: unknown;
  headers?: Record<string, string>;
}

function param(ctx: WebhookContext, key: string): string | undefined {
  const q = ctx.params?.[key];
  const fromQuery = Array.isArray(q) ? q[0] : q;
  return fromQuery ?? ctx.parameters?.[key] ?? ctx.query?.[key];
}

function getToken(): string | null {
  return process.env.PRIVATE_APP_ACCESS_TOKEN ?? process.env.HS_ACCESS_TOKEN ?? null;
}

/** Find the Video record for a YouTube id, or null. */
export async function findRecordForVideo(
  objectTypeId: string,
  token: string,
  youtubeVideoId: string,
): Promise<string | null> {
  const res = await fetch(`${HS_BASE}${objectSearchPath(objectTypeId)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      filterGroups: [
        { filters: [{ propertyName: 'youtube_video_id', operator: 'EQ', value: youtubeVideoId }] },
      ],
      properties: NOTIFY_PROPERTIES,
      limit: 1,
      sorts: [],
      query: '',
      after: '0',
    }),
  });
  if (!res.ok) throw new Error(`Video search failed ${res.status}`);
  const body = (await res.json()) as { results?: Array<{ id: string }> };
  return body.results?.[0]?.id ?? null;
}

/** Stamp the record so the next sync knows YouTube reported a change. */
async function markNotified(
  objectTypeId: string,
  token: string,
  recordId: string,
  publishedAt: string | null,
): Promise<void> {
  const properties: Record<string, string> = {};
  // Only write a property we know exists. published_at is on the video object;
  // inventing a "last notified" field here would need provisioning first.
  if (publishedAt) properties.published_at = publishedAt;
  if (Object.keys(properties).length === 0) return;

  const res = await fetch(`${HS_BASE}${objectPath(objectTypeId, recordId)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ properties }),
  });
  if (!res.ok) throw new Error(`Record update failed ${res.status}`);
}

/**
 * Record that the subscription is genuinely live.
 *
 * Deliberately done here and not during the hub's GET challenge. That challenge
 * is time-sensitive — the hub gives up quickly and a failed verification is
 * silent on our side — so it must do nothing but echo. A notification arriving
 * is itself proof the hub verified, and this path has no deadline.
 */
async function markSubscriptionActive(portalId: number, token: string): Promise<void> {
  const appConfigType = getPortalConfig(portalId).appConfig.objectTypeId;
  const search = await fetch(`${HS_BASE}${objectSearchPath(appConfigType)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ filterGroups: [], properties: ['youtube_subscription_status'], limit: 1, sorts: [], query: '', after: '0' }),
  });
  if (!search.ok) return;
  const found = (await search.json()) as { results?: Array<{ id: string; properties?: Record<string, string | null> }> };
  const record = found.results?.[0];
  if (!record) return;
  if (record.properties?.youtube_subscription_status === 'active') return;

  await fetch(`${HS_BASE}${objectPath(appConfigType, record.id)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ properties: { youtube_subscription_status: 'active' } }),
  });
}

export interface NotificationOutcome {
  entries: number;
  matched: number;
  updated: number;
  unknownVideoIds: string[];
  errors: string[];
}

export async function handleNotification(
  portalId: number,
  xml: string,
): Promise<NotificationOutcome> {
  const outcome: NotificationOutcome = {
    entries: 0,
    matched: 0,
    updated: 0,
    unknownVideoIds: [],
    errors: [],
  };

  if (isDeletionNotice(xml)) return outcome;

  const entries = parseFeedEntries(xml);
  outcome.entries = entries.length;
  if (entries.length === 0) return outcome;

  const token = getToken();
  if (!token) {
    outcome.errors.push('no HubSpot access token');
    return outcome;
  }

  const objectTypeId = getPortalConfig(portalId).video.objectTypeId;

  // A notification proves the hub verified. Failing to record that must not
  // cost us the notification itself.
  try {
    await markSubscriptionActive(portalId, token);
  } catch (err) {
    outcome.errors.push(`could not mark subscription active: ${err instanceof Error ? err.message : String(err)}`);
  }

  for (const entry of entries) {
    try {
      const recordId = await findRecordForVideo(objectTypeId, token, entry.videoId);
      if (!recordId) {
        outcome.unknownVideoIds.push(entry.videoId);
        continue;
      }
      outcome.matched += 1;
      await markNotified(objectTypeId, token, recordId, entry.published);
      outcome.updated += 1;
    } catch (err) {
      // One bad entry must not lose the rest of the feed.
      outcome.errors.push(`${entry.videoId}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return outcome;
}

export const main = async (
  context: WebhookContext,
): Promise<{ statusCode: number; body: string; headers?: Record<string, string> }> => {
  const method = (context.method ?? 'POST').toUpperCase();

  // --- hub verification -----------------------------------------------------
  if (method === 'GET') {
    const challenge = param(context, 'hub.challenge');
    const mode = param(context, 'hub.mode');

    // Echo first, ask questions never. The hub's timeout is short and a failed
    // verification is silent on our side.
    if (challenge && (mode === 'subscribe' || mode === 'unsubscribe')) {
      return {
        statusCode: 200,
        body: challenge,
        headers: { 'Content-Type': 'text/plain' },
      };
    }
    return { statusCode: 400, body: 'Invalid verification request' };
  }

  // --- notification ---------------------------------------------------------
  const portalId = context.accountId ?? parseInt(param(context, 'portalId') ?? '0', 10);
  if (!portalId) return { statusCode: 400, body: JSON.stringify({ error: 'Missing portalId' }) };

  const xml = typeof context.body === 'string' ? context.body : String(context.body ?? '');

  try {
    const outcome = await handleNotification(portalId, xml);
    // 200 even when nothing matched: the hub retries on failure, and retrying
    // will not make an unknown video id known.
    return { statusCode: 200, body: JSON.stringify(outcome) };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('YouTubeWebhook failed:', message);
    return { statusCode: 500, body: JSON.stringify({ error: message }) };
  }
};

export default main;
