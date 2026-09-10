import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mapAnalyticsToProperties, mapVideoToProperties } from '../functions/YouTubeSync';
import hsmeta from '../functions/YouTubeSync-hsmeta.json';

/**
 * The metrics sync.
 *
 * Two behaviours here are the whole point of the module and neither is visible
 * from its return type: a missing count must not be written as zero, and one
 * bad record must not abandon the rest of the batch. A sync that quietly
 * processes three of fifty and reports success is the failure mode this
 * codebase has been bitten by repeatedly.
 */

describe('mapVideoToProperties', () => {
  it('maps the three statistics YouTube returns', () => {
    expect(
      mapVideoToProperties({
        id: 'v1',
        statistics: { viewCount: '1234', likeCount: '56', commentCount: '7' },
      }),
    ).toEqual({ view_count: '1234', like_count: '56', comment_count: '7' });
  });

  it('omits a missing count rather than writing "0"', () => {
    // Absent and zero are different facts, and only one of them is true. A
    // video with comments disabled has no commentCount; writing 0 asserts
    // something YouTube never said.
    const props = mapVideoToProperties({ id: 'v1', statistics: { viewCount: '10' } });
    expect(props).toEqual({ view_count: '10' });
    expect('comment_count' in props).toBe(false);
  });

  it('preserves a genuine zero', () => {
    const props = mapVideoToProperties({ id: 'v1', statistics: { viewCount: '0' } });
    expect(props.view_count).toBe('0');
  });

  it('returns nothing at all when statistics are absent', () => {
    expect(mapVideoToProperties({ id: 'v1' })).toEqual({});
  });

  it('passes counts through as strings without reparsing', () => {
    // A large channel's view count can exceed what a JS number represents
    // exactly; round-tripping through Number would corrupt it silently.
    const huge = '9007199254740993';
    expect(mapVideoToProperties({ id: 'v1', statistics: { viewCount: huge } }).view_count).toBe(huge);
  });
});

describe('mapAnalyticsToProperties', () => {
  it('maps the analytics triple', () => {
    expect(
      mapAnalyticsToProperties({ impressions: 100, clickThroughRate: 0.05, averageViewDuration: 42 }),
    ).toEqual({ impressions: '100', click_through_rate: '0.05', average_view_duration: '42' });
  });

  it('writes a real zero rather than dropping it', () => {
    const props = mapAnalyticsToProperties({
      impressions: 0,
      clickThroughRate: 0,
      averageViewDuration: 0,
    });
    expect(props.impressions).toBe('0');
  });
});

describe('YouTubeSync-hsmeta.json', () => {
  it('declares every secret the sync path needs', () => {
    // A secret named here but absent from the portal fails the whole deploy,
    // and one omitted here is simply undefined at runtime.
    for (const key of ['HS_ACCESS_TOKEN', 'YOUTUBE_CLIENT_ID', 'YOUTUBE_CLIENT_SECRET', 'YOUTUBE_REFRESH_TOKEN']) {
      expect(hsmeta.config.secretKeys).toContain(key);
    }
  });

  it('points its entrypoint at the built file, not the source', () => {
    expect(hsmeta.config.entrypoint).toBe('/app/functions/YouTubeSync.js');
  });

  it('matches its endpoint path to the uid convention', () => {
    expect(hsmeta.config.endpoint.path).toBe('youtube-sync');
    expect(hsmeta.uid).toBe('youtube_sync');
  });
});

describe('runSync orchestration', () => {
  const originalFetch = globalThis.fetch;

  const originalToken = process.env.HS_ACCESS_TOKEN;

  beforeEach(() => {
    vi.resetModules();
    // The record search reads the token straight off the environment, the same
    // way it does in the deployed function.
    process.env.HS_ACCESS_TOKEN = 'test-hs-token';
    globalThis.fetch = vi.fn() as unknown as typeof fetch;
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
    if (originalToken === undefined) delete process.env.HS_ACCESS_TOKEN;
    else process.env.HS_ACCESS_TOKEN = originalToken;
    vi.restoreAllMocks();
    vi.resetModules();
  });

  /** One page of search results, then no more. */
  function mockSearch(records: Array<{ id: string; ytId: string }>) {
    (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        results: records.map((r) => ({ id: r.id, properties: { youtube_video_id: r.ytId } })),
      }),
      text: async () => '',
    } as unknown as Response);
  }

  it('reports zero found when the portal has no video records', async () => {
    vi.doMock('@lib/youtube-auth', () => ({ getYouTubeAccessToken: async () => 'tok' }));
    vi.doMock('@lib/youtube-client', () => ({
      chunkVideoIds: (ids: string[]) => (ids.length ? [ids] : []),
      fetchVideoBatch: async () => ({ notModified: false, etag: null, items: [] }),
      fetchVideoAnalytics: async () => new Map(),
    }));
    vi.doMock('@lib/hubspot-client', () => ({ hsUpdate: vi.fn() }));
    mockSearch([]);

    const { runSync } = await import('../functions/YouTubeSync');
    const out = await runSync(51869810);
    expect(out.recordsFound).toBe(0);
    expect(out.recordsUpdated).toBe(0);
    expect(out.errors).toEqual([]);
  });

  it('skips writes entirely when YouTube answers 304', async () => {
    const hsUpdate = vi.fn();
    vi.doMock('@lib/youtube-auth', () => ({ getYouTubeAccessToken: async () => 'tok' }));
    vi.doMock('@lib/youtube-client', () => ({
      chunkVideoIds: (ids: string[]) => [ids],
      fetchVideoBatch: async () => ({ notModified: true, etag: 'E1', items: [] }),
      fetchVideoAnalytics: async () => new Map(),
    }));
    vi.doMock('@lib/hubspot-client', () => ({ hsUpdate }));
    mockSearch([{ id: '1', ytId: 'v1' }]);

    const { runSync } = await import('../functions/YouTubeSync');
    const out = await runSync(51869810);
    expect(out.batchesNotModified).toBe(1);
    expect(out.recordsUpdated).toBe(0);
    expect(hsUpdate).not.toHaveBeenCalled();
  });

  it('keeps going when one record fails to write', async () => {
    // The behaviour that matters: a single bad record must cost that record,
    // not the batch.
    const hsUpdate = vi
      .fn()
      .mockRejectedValueOnce(new Error('property is read-only'))
      .mockResolvedValue(undefined);
    vi.doMock('@lib/youtube-auth', () => ({ getYouTubeAccessToken: async () => 'tok' }));
    vi.doMock('@lib/youtube-client', () => ({
      chunkVideoIds: (ids: string[]) => [ids],
      fetchVideoBatch: async () => ({
        notModified: false,
        etag: 'E',
        items: [
          { id: 'v1', statistics: { viewCount: '1' } },
          { id: 'v2', statistics: { viewCount: '2' } },
        ],
      }),
      fetchVideoAnalytics: async () => new Map(),
    }));
    vi.doMock('@lib/hubspot-client', () => ({ hsUpdate }));
    mockSearch([
      { id: '1', ytId: 'v1' },
      { id: '2', ytId: 'v2' },
    ]);

    const { runSync } = await import('../functions/YouTubeSync');
    const out = await runSync(51869810);
    expect(out.recordsFound).toBe(2);
    expect(out.recordsUpdated).toBe(1);
    expect(out.errors).toHaveLength(1);
    expect(out.errors[0]).toContain('v1');
  });

  it('degrades rather than failing when analytics are unavailable', async () => {
    // Analytics is a separate API with its own quota. Losing it must not cost
    // us the statistics we already fetched.
    const hsUpdate = vi.fn().mockResolvedValue(undefined);
    process.env.YOUTUBE_CHANNEL_ID = 'UC123';
    vi.doMock('@lib/youtube-auth', () => ({ getYouTubeAccessToken: async () => 'tok' }));
    vi.doMock('@lib/youtube-client', () => ({
      chunkVideoIds: (ids: string[]) => [ids],
      fetchVideoBatch: async () => ({
        notModified: false,
        etag: 'E',
        items: [{ id: 'v1', statistics: { viewCount: '5' } }],
      }),
      fetchVideoAnalytics: async () => {
        throw new Error('analytics quota exceeded');
      },
    }));
    vi.doMock('@lib/hubspot-client', () => ({ hsUpdate }));
    mockSearch([{ id: '1', ytId: 'v1' }]);

    const { runSync } = await import('../functions/YouTubeSync');
    const out = await runSync(51869810);
    delete process.env.YOUTUBE_CHANNEL_ID;

    expect(out.recordsUpdated).toBe(1);
    expect(out.errors.some((e) => e.includes('analytics'))).toBe(true);
  });
});
