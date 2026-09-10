/**
 * WebSub (PubSubHubbub) subscription to a YouTube channel feed.
 *
 * WHY THIS EXISTS
 * ---------------
 * The metrics sync is a poll. A poll is fine for view counts, which drift
 * continuously, but useless for "a video was just published" — that is an event,
 * and waiting up to a day to notice it makes every downstream automation late.
 * WebSub is how YouTube tells you.
 *
 * THE SHAPE OF THE PROTOCOL
 * -------------------------
 * Subscribing is a POST to Google's hub asking it to call you back. The hub then
 * verifies by issuing a GET to your callback carrying `hub.challenge`, which you
 * must echo back verbatim and promptly. Only after that does it deliver
 * notifications, as POSTs carrying an Atom feed.
 *
 * Two consequences that shape the code:
 *
 *   - Subscriptions EXPIRE. `hub.lease_seconds` is a ceiling, not a promise, and
 *     the hub may grant less. A subscription nobody renews goes quiet without
 *     announcing it, which looks exactly like "no new videos". Renewal is not
 *     optional maintenance; it is part of the feature.
 *
 *   - Re-subscribing is idempotent and is how you renew. There is no separate
 *     renew call — you subscribe again and the lease is extended.
 */

/** Google's public WebSub hub. */
export const WEBSUB_HUB_URL = 'https://pubsubhubbub.appspot.com/subscribe';

/** Ten days, matching the lease the original Creator Console asked for. */
export const LEASE_SECONDS = 864000;

/** Renew when fewer than this many days of lease remain. */
export const RENEW_WHEN_DAYS_LEFT = 2;

export type SubscribeMode = 'subscribe' | 'unsubscribe';

export interface SubscribeResult {
  ok: boolean;
  status: number;
  /** The hub verifies asynchronously, so 202 is the success case, not 200. */
  accepted: boolean;
  body: string;
}

export function topicUrlFor(channelId: string): string {
  return `https://www.youtube.com/xml/feeds/videos.xml?channel_id=${encodeURIComponent(channelId)}`;
}

export function callbackUrlFor(portalId: number): string {
  return `https://${portalId}.hs-sites.com/hs/serverless/youtube-webhook`;
}

/**
 * Ask the hub to start (or stop) delivering notifications for a channel.
 *
 * `hub.verify: async` means the hub answers immediately and verifies afterwards,
 * so a 202 here means "request accepted", not "subscription active". The
 * subscription only becomes real once the hub's GET challenge reaches the
 * webhook and is echoed back.
 */
export async function requestSubscription(
  channelId: string,
  portalId: number,
  mode: SubscribeMode = 'subscribe',
): Promise<SubscribeResult> {
  const form = new URLSearchParams({
    'hub.callback': callbackUrlFor(portalId),
    'hub.topic': topicUrlFor(channelId),
    'hub.verify': 'async',
    'hub.mode': mode,
    'hub.lease_seconds': String(LEASE_SECONDS),
  });

  const res = await fetch(WEBSUB_HUB_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form.toString(),
  });

  const body = await res.text();
  return { ok: res.ok, status: res.status, accepted: res.status === 202 || res.ok, body };
}

/** When a lease taken now would expire, as an ISO timestamp. */
export function leaseExpiryFrom(now: number = Date.now()): string {
  return new Date(now + LEASE_SECONDS * 1000).toISOString();
}

/**
 * Whether a stored expiry is close enough to warrant re-subscribing.
 *
 * An unset or unparseable expiry counts as due: not knowing when a subscription
 * lapses is indistinguishable from it having lapsed, and re-subscribing costs
 * one request.
 */
export function isRenewalDue(expiresAt: string | null | undefined, now: number = Date.now()): boolean {
  if (!expiresAt) return true;
  const expiry = new Date(expiresAt).getTime();
  if (!Number.isFinite(expiry)) return true;
  return expiry - now < RENEW_WHEN_DAYS_LEFT * 24 * 60 * 60 * 1000;
}

export interface FeedEntry {
  videoId: string;
  channelId: string | null;
  title: string | null;
  published: string | null;
}

/**
 * Pull the video entries out of a WebSub Atom notification.
 *
 * Parsed with regex rather than an XML library, deliberately: the payload shape
 * is fixed and narrow, and a serverless bundle does not need a parser to read
 * four fields. The original did the same.
 *
 * Note this returns every entry rather than only the first. YouTube usually
 * sends one, but a feed refresh can carry several, and dropping the rest would
 * silently lose videos.
 */
export function parseFeedEntries(xml: string): FeedEntry[] {
  if (!xml) return [];

  const entries: FeedEntry[] = [];
  const blocks = xml.split(/<entry[\s>]/i).slice(1);

  for (const block of blocks) {
    const videoId = block.match(/<yt:videoId>([^<]+)<\/yt:videoId>/i)?.[1];
    if (!videoId) continue;
    entries.push({
      videoId: videoId.trim(),
      channelId: block.match(/<yt:channelId>([^<]+)<\/yt:channelId>/i)?.[1]?.trim() ?? null,
      title: block.match(/<title>([^<]*)<\/title>/i)?.[1]?.trim() ?? null,
      published: block.match(/<published>([^<]+)<\/published>/i)?.[1]?.trim() ?? null,
    });
  }

  // A feed with no <entry> wrapper still occasionally carries a bare videoId.
  if (entries.length === 0) {
    const lone = xml.match(/<yt:videoId>([^<]+)<\/yt:videoId>/i)?.[1];
    if (lone) {
      entries.push({
        videoId: lone.trim(),
        channelId: xml.match(/<yt:channelId>([^<]+)<\/yt:channelId>/i)?.[1]?.trim() ?? null,
        title: null,
        published: null,
      });
    }
  }

  return entries;
}

/** A deletion notification carries no entry, only a tombstone. */
export function isDeletionNotice(xml: string): boolean {
  return /<at:deleted-entry/i.test(xml);
}
