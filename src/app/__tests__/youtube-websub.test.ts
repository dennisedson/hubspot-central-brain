import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  LEASE_SECONDS,
  WEBSUB_HUB_URL,
  callbackUrlFor,
  isDeletionNotice,
  isRenewalDue,
  leaseExpiryFrom,
  parseFeedEntries,
  requestSubscription,
  topicUrlFor,
} from '@lib/youtube-websub';
import { main } from '../functions/YouTubeWebhook';

/**
 * WebSub subscription and notification handling.
 *
 * The two things that silently break this feature are a lease nobody renews and
 * a challenge that is not echoed back exactly. Neither produces an error
 * anywhere on our side — the subscription simply goes quiet, which is
 * indistinguishable from "no new videos". Both are pinned here.
 */

const NOTIFICATION = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns:yt="http://www.youtube.com/xml/schemas/2015" xmlns="http://www.w3.org/2005/Atom">
  <entry>
    <yt:videoId>u0Ed_HW_LUk</yt:videoId>
    <yt:channelId>UCUp_0p0PFfaIEkUz5qMLLVw</yt:channelId>
    <title>A new video</title>
    <published>2026-09-10T12:00:00+00:00</published>
  </entry>
</feed>`;

describe('topic and callback URLs', () => {
  it('builds the channel feed topic', () => {
    expect(topicUrlFor('UC123')).toBe(
      'https://www.youtube.com/xml/feeds/videos.xml?channel_id=UC123',
    );
  });

  it('encodes a channel id rather than interpolating it raw', () => {
    expect(topicUrlFor('a&b')).toContain('a%26b');
  });

  it('points the callback at this portal’s webhook', () => {
    expect(callbackUrlFor(51869810)).toBe(
      'https://51869810.hs-sites.com/hs/serverless/youtube-webhook',
    );
  });
});

describe('lease arithmetic', () => {
  it('expiry is one lease ahead of now', () => {
    const now = Date.UTC(2026, 0, 1);
    expect(new Date(leaseExpiryFrom(now)).getTime()).toBe(now + LEASE_SECONDS * 1000);
  });

  it('treats an unset expiry as due', () => {
    // Not knowing when a subscription lapses is indistinguishable from it
    // having lapsed, and re-subscribing costs one request.
    expect(isRenewalDue(null)).toBe(true);
    expect(isRenewalDue(undefined)).toBe(true);
  });

  it('treats an unparseable expiry as due', () => {
    expect(isRenewalDue('not a date')).toBe(true);
  });

  it('is due inside the renewal window', () => {
    const now = Date.now();
    expect(isRenewalDue(new Date(now + 24 * 60 * 60 * 1000).toISOString(), now)).toBe(true);
  });

  it('is not due with plenty of lease left', () => {
    const now = Date.now();
    expect(isRenewalDue(new Date(now + 9 * 24 * 60 * 60 * 1000).toISOString(), now)).toBe(false);
  });

  it('is due once expired', () => {
    const now = Date.now();
    expect(isRenewalDue(new Date(now - 1000).toISOString(), now)).toBe(true);
  });
});

describe('parseFeedEntries', () => {
  it('pulls the fields out of a real notification', () => {
    const [e] = parseFeedEntries(NOTIFICATION);
    expect(e.videoId).toBe('u0Ed_HW_LUk');
    expect(e.channelId).toBe('UCUp_0p0PFfaIEkUz5qMLLVw');
    expect(e.title).toBe('A new video');
    expect(e.published).toBe('2026-09-10T12:00:00+00:00');
  });

  it('returns every entry, not just the first', () => {
    // A feed refresh can carry several; keeping only the first loses videos.
    const two = NOTIFICATION.replace(
      '</entry>',
      '</entry><entry><yt:videoId>second</yt:videoId></entry>',
    );
    expect(parseFeedEntries(two).map((e) => e.videoId)).toEqual(['u0Ed_HW_LUk', 'second']);
  });

  it('returns nothing for an empty or garbage body', () => {
    expect(parseFeedEntries('')).toEqual([]);
    expect(parseFeedEntries('<html>not a feed</html>')).toEqual([]);
  });

  it('recognises a deletion tombstone', () => {
    expect(isDeletionNotice('<at:deleted-entry ref="yt:video:abc"/>')).toBe(true);
    expect(isDeletionNotice(NOTIFICATION)).toBe(false);
  });
});

describe('requestSubscription', () => {
  const originalFetch = globalThis.fetch;
  beforeEach(() => {
    globalThis.fetch = vi.fn() as unknown as typeof fetch;
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('posts the documented form fields to the hub', async () => {
    (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      status: 202,
      text: async () => '',
    } as unknown as Response);

    await requestSubscription('UC123', 51869810);
    const [url, init] = (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe(WEBSUB_HUB_URL);

    const form = new URLSearchParams((init as RequestInit).body as string);
    expect(form.get('hub.mode')).toBe('subscribe');
    expect(form.get('hub.verify')).toBe('async');
    expect(form.get('hub.topic')).toContain('UC123');
    expect(form.get('hub.callback')).toContain('youtube-webhook');
  });

  it('treats 202 as accepted — the hub verifies later', async () => {
    (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      status: 202,
      text: async () => '',
    } as unknown as Response);
    expect((await requestSubscription('UC123', 1)).accepted).toBe(true);
  });

  it('reports a rejection', async () => {
    (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      status: 400,
      text: async () => 'bad topic',
    } as unknown as Response);
    const out = await requestSubscription('UC123', 1);
    expect(out.accepted).toBe(false);
    expect(out.body).toBe('bad topic');
  });
});

describe('YouTubeWebhook — hub verification', () => {
  it('echoes the challenge verbatim as plain text', async () => {
    // The hub's timeout is short and a failed verification is silent on our
    // side. Anything but the bare challenge fails the subscription.
    const res = await main({
      method: 'GET',
      params: { 'hub.challenge': ['abc123'], 'hub.mode': ['subscribe'] },
    } as unknown as Parameters<typeof main>[0]);
    expect(res.statusCode).toBe(200);
    expect(res.body).toBe('abc123');
    expect(res.headers?.['Content-Type']).toBe('text/plain');
  });

  it('echoes for unsubscribe too', async () => {
    const res = await main({
      method: 'GET',
      params: { 'hub.challenge': ['x'], 'hub.mode': ['unsubscribe'] },
    } as unknown as Parameters<typeof main>[0]);
    expect(res.body).toBe('x');
  });

  it('refuses a GET with no challenge', async () => {
    const res = await main({ method: 'GET', params: {} } as unknown as Parameters<typeof main>[0]);
    expect(res.statusCode).toBe(400);
  });
});

describe('YouTubeWebhook — notifications', () => {
  const originalFetch = globalThis.fetch;
  const originalToken = process.env.HS_ACCESS_TOKEN;

  beforeEach(() => {
    process.env.HS_ACCESS_TOKEN = 'test-token';
    globalThis.fetch = vi.fn() as unknown as typeof fetch;
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
    if (originalToken === undefined) delete process.env.HS_ACCESS_TOKEN;
    else process.env.HS_ACCESS_TOKEN = originalToken;
    vi.restoreAllMocks();
  });

  it('records an unknown video rather than creating one', async () => {
    // Inventing CRM records from an unauthenticated public endpoint is how a
    // webhook becomes a spam vector.
    (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ results: [] }),
      text: async () => '',
    } as unknown as Response);

    const res = await main({
      accountId: 51869810,
      method: 'POST',
      body: NOTIFICATION,
    } as unknown as Parameters<typeof main>[0]);

    const out = JSON.parse(res.body);
    expect(res.statusCode).toBe(200);
    expect(out.unknownVideoIds).toEqual(['u0Ed_HW_LUk']);
    expect(out.updated).toBe(0);
    // Searches happened; no record was created. Counting POSTs is the wrong
    // assertion — a search is a POST here — so check the URLs instead: an
    // object create would target the objects path with no id and no /search.
    const urls = (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.map((c) =>
      String(c[0]),
    );
    for (const url of urls) {
      const isWrite = !url.includes('/search');
      expect(isWrite, `unexpected non-search call: ${url}`).toBe(false);
    }
  });

  it('answers 200 on a deletion tombstone without touching anything', async () => {
    const res = await main({
      accountId: 51869810,
      method: 'POST',
      body: '<at:deleted-entry ref="yt:video:abc"/>',
    } as unknown as Parameters<typeof main>[0]);
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).entries).toBe(0);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('answers 200 on an unparseable body — the hub must not retry forever', async () => {
    const res = await main({
      accountId: 51869810,
      method: 'POST',
      body: 'garbage',
    } as unknown as Parameters<typeof main>[0]);
    expect(res.statusCode).toBe(200);
  });

  it('refuses a notification with no portal context', async () => {
    const res = await main({
      method: 'POST',
      body: NOTIFICATION,
    } as unknown as Parameters<typeof main>[0]);
    expect(res.statusCode).toBe(400);
  });
});
