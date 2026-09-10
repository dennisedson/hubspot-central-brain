import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { main } from '../functions/VideoCardApi';
import hsmeta from '../functions/VideoCardApi-hsmeta.json';
import cardMeta from '../cards/video-hsmeta.json';

/**
 * The Video card's read API.
 *
 * The contract that matters is that an unset property comes back as null and
 * never as "0". The card renders a missing metric as an em dash and a real zero
 * as 0 — collapsing them here would tell someone a video has no views when the
 * truth is that it has never been synced.
 *
 * Also read-only by construction: the card's actions call other functions, so a
 * bug in this one can never write to a record.
 */

const PORTAL = 51869810;

function ctx(params: Record<string, string>) {
  return { accountId: PORTAL, params } as unknown as Parameters<typeof main>[0];
}

function mockProps(properties: Record<string, string | null>) {
  (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({ properties }),
    text: async () => '',
  } as unknown as Response);
}

describe('VideoCardApi', () => {
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

  it('requires an objectId', async () => {
    const res = await main(ctx({}));
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toMatch(/objectId/);
  });

  it('maps a fully populated record', async () => {
    mockProps({
      title: 'My Video',
      youtube_video_id: 'abc123',
      youtube_url: 'https://youtube.com/watch?v=abc123',
      view_count: '1000',
      like_count: '50',
      comment_count: '7',
      impressions: '5000',
      click_through_rate: '0.2',
      average_view_duration: '120',
      utm_link: 'https://x.com/p?utm_campaign=c',
      campaign_name: 'c',
      website_url: 'https://x.com/p',
      hs_lastmodifieddate: '2026-09-10T16:48:09.922Z',
    });
    const payload = JSON.parse((await main(ctx({ objectId: '1' }))).body);
    expect(payload.youtubeVideoId).toBe('abc123');
    expect(payload.viewCount).toBe('1000');
    expect(payload.campaignName).toBe('c');
  });

  it('reports an unset metric as null, never as zero', async () => {
    // "Never synced" and "zero views" must not render identically.
    mockProps({ title: 'T', youtube_video_id: 'abc' });
    const payload = JSON.parse((await main(ctx({ objectId: '1' }))).body);
    expect(payload.viewCount).toBeNull();
    expect(payload.impressions).toBeNull();
  });

  it('preserves a genuine zero', async () => {
    mockProps({ view_count: '0' });
    expect(JSON.parse((await main(ctx({ objectId: '1' }))).body).viewCount).toBe('0');
  });

  it('returns the objectId it was asked about', async () => {
    mockProps({});
    expect(JSON.parse((await main(ctx({ objectId: '61720843957' }))).body).objectId).toBe('61720843957');
  });

  it('surfaces a read failure as a 500 with the reason', async () => {
    (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      status: 403,
      json: async () => ({}),
      text: async () => 'forbidden',
    } as unknown as Response);
    const res = await main(ctx({ objectId: '1' }));
    expect(res.statusCode).toBe(500);
    expect(JSON.parse(res.body).error).toContain('403');
  });

  it('reads and never writes', async () => {
    mockProps({});
    await main(ctx({ objectId: '1' }));
    const init = (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0][1] as RequestInit | undefined;
    // No method means GET. Anything else would be a write from a card backend.
    expect(init?.method ?? 'GET').toBe('GET');
  });

  it('accepts query params delivered as arrays, the way HubSpot sends them', async () => {
    // The bug that made every URL query parameter invisible across nine
    // handlers: params arrive under `params`, and their values are arrays.
    mockProps({ title: 'T' });
    const res = await main({
      accountId: PORTAL,
      params: { objectId: ['1'] },
    } as unknown as Parameters<typeof main>[0]);
    expect(res.statusCode).toBe(200);
  });
});

describe('Video card wiring', () => {
  it('the card targets the video object', () => {
    expect(cardMeta.config.objectTypes).toContain('p_video');
  });

  it('the card entrypoint exists as declared', () => {
    expect(cardMeta.config.entrypoint).toBe('/app/cards/VideoCard.tsx');
  });

  it('the API is reachable by the uid the card calls', () => {
    expect(hsmeta.uid).toBe('video_card_api');
  });
});
