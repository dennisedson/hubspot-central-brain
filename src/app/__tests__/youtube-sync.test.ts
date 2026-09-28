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
    vi.doMock('@lib/hubspot-client', () => ({ hsUpdate: vi.fn(), readYouTubeChannelId: async () => null }));
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
    vi.doMock('@lib/hubspot-client', () => ({ hsUpdate, readYouTubeChannelId: async () => null }));
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
    vi.doMock('@lib/hubspot-client', () => ({ hsUpdate, readYouTubeChannelId: async () => null }));
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

  it('says why analytics were skipped when no channel is known', async () => {
    // Blank analytics properties are indistinguishable from a channel with no
    // impressions. Before this the outcome was silent, and the difference cost
    // real debugging time.
    const hsUpdate = vi.fn().mockResolvedValue(undefined);
    vi.doMock('@lib/youtube-auth', () => ({ getYouTubeAccessToken: async () => 'tok' }));
    vi.doMock('@lib/youtube-client', () => ({
      chunkVideoIds: (ids: string[]) => [ids],
      fetchVideoBatch: async () => ({
        notModified: false,
        etag: 'E',
        items: [{ id: 'v1', statistics: { viewCount: '5' } }],
      }),
      fetchVideoAnalytics: async () => {
        throw new Error('should never be called without a channel');
      },
    }));
    vi.doMock('@lib/hubspot-client', () => ({ hsUpdate, readYouTubeChannelId: async () => null }));
    mockSearch([{ id: '1', ytId: 'v1' }]);

    const { runSync } = await import('../functions/YouTubeSync');
    const out = await runSync(51869810);

    expect(out.analyticsStatus).toContain('no channel id');
    // Missing configuration is not a failure — the statistics still landed.
    expect(out.errors).toEqual([]);
    expect(out.recordsUpdated).toBe(1);
  });

  it('reports analyticsStatus "ok" when analytics actually ran', async () => {
    const hsUpdate = vi.fn().mockResolvedValue(undefined);
    vi.doMock('@lib/youtube-auth', () => ({ getYouTubeAccessToken: async () => 'tok' }));
    vi.doMock('@lib/youtube-client', () => ({
      chunkVideoIds: (ids: string[]) => [ids],
      fetchVideoBatch: async () => ({
        notModified: false,
        etag: 'E',
        items: [{ id: 'v1', statistics: { viewCount: '5' } }],
      }),
      fetchVideoAnalytics: async () =>
        new Map([['v1', { impressions: 0, clickThroughRate: 0, averageViewDuration: 0 }]]),
    }));
    vi.doMock('@lib/hubspot-client', () => ({ hsUpdate, readYouTubeChannelId: async () => 'UC123' }));
    mockSearch([{ id: '1', ytId: 'v1' }]);

    const { runSync } = await import('../functions/YouTubeSync');
    const out = await runSync(51869810);

    // All zeros is a real answer, and must not read as "never ran".
    //
    // Asserted as a string rather than null on purpose: HubSpot drops null
    // properties when a handler returns an object body, so a null success
    // signal disappears from the response and reads as a stale deploy.
    expect(out.analyticsStatus).toBe('ok');
  });

  it('degrades rather than failing when analytics are unavailable', async () => {
    // Analytics is a separate API with its own quota. Losing it must not cost
    // us the statistics we already fetched.
    const hsUpdate = vi.fn().mockResolvedValue(undefined);
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
    vi.doMock('@lib/hubspot-client', () => ({ hsUpdate, readYouTubeChannelId: async () => 'UC123' }));
    mockSearch([{ id: '1', ytId: 'v1' }]);

    const { runSync } = await import('../functions/YouTubeSync');
    const out = await runSync(51869810);

    expect(out.recordsUpdated).toBe(1);
    expect(out.errors.some((e) => e.includes('analytics'))).toBe(true);
    // The outcome must say why the analytics properties are blank, not merely
    // that something went wrong somewhere.
    expect(out.analyticsStatus).toContain('failed:');
  });
});

describe('mapAnalyticsToProperties — absent versus zero', () => {
  it('omits impressions and CTR when the API did not supply them', () => {
    // reports.query does not serve them. Writing 0 asserts something YouTube
    // never said, and is indistinguishable from a genuine zero.
    const props = mapAnalyticsToProperties({ averageViewDuration: 42 });
    expect(props).toEqual({ average_view_duration: '42' });
    expect('impressions' in props).toBe(false);
    expect('click_through_rate' in props).toBe(false);
  });
});

describe('YouTubeSync.main — how the portal is resolved', () => {
  const originalFetch = globalThis.fetch;
  const originalToken = process.env.HS_ACCESS_TOKEN;

  beforeEach(() => {
    process.env.HS_ACCESS_TOKEN = 'test-token';
    vi.resetModules();
    globalThis.fetch = vi.fn() as unknown as typeof fetch;
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
    if (originalToken === undefined) delete process.env.HS_ACCESS_TOKEN;
    else process.env.HS_ACCESS_TOKEN = originalToken;
    vi.restoreAllMocks();
    vi.resetModules();
  });

  function mockEmptySearch() {
    (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ results: [] }),
      text: async () => '',
    } as unknown as Response);
  }

  async function load() {
    vi.doMock('@lib/youtube-auth', () => ({ getYouTubeAccessToken: async () => 'tok' }));
    vi.doMock('@lib/youtube-client', () => ({
      chunkVideoIds: (ids: string[]) => (ids.length ? [ids] : []),
      fetchVideoBatch: async () => ({ notModified: false, etag: null, items: [] }),
      fetchVideoAnalytics: async () => new Map(),
    }));
    vi.doMock('@lib/hubspot-client', () => ({
      hsUpdate: vi.fn(),
      readYouTubeChannelId: async () => null,
    }));
    return (await import('../functions/YouTubeSync')).main;
  }

  it('falls back to the portalId parameter when accountId is absent', async () => {
    // A card's hubspot.serverless() call carries no accountId, which is why the
    // card passes portalId explicitly. Reading only accountId made every sync
    // from the card a 500.
    const main = await load();
    mockEmptySearch();
    const res = await main({ parameters: { portalId: '51869810' } } as never);
    expect(res.statusCode).toBe(200);
  });

  it('unwraps an array portalId from a public-URL query', async () => {
    const main = await load();
    mockEmptySearch();
    const res = await main({ params: { portalId: ['51869810'] } } as never);
    expect(res.statusCode).toBe(200);
  });

  it('answers 400 rather than 500 with no portal anywhere', async () => {
    // Previously this reached getPortalConfig(undefined) and threw, which the
    // card surfaced as an opaque HTTP 500.
    const main = await load();
    const res = await main({} as never);
    expect(res.statusCode).toBe(400);
  });

  it('reads one record rather than searching when given a recordId', async () => {
    // A single-record sync must not depend on HubSpot search indexing, which
    // is what makes a freshly created record report recordsFound: 0.
    const main = await load();
    (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ id: '42', properties: { youtube_video_id: 'v1' } }),
      text: async () => '',
    } as unknown as Response);

    const res = await main({ parameters: { portalId: '51869810', recordId: '42' } } as never);
    expect(res.statusCode).toBe(200);
    expect((res.body as { recordsFound: number }).recordsFound).toBe(1);

    const urls = (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.map((c) =>
      String(c[0]),
    );
    expect(urls.some((u) => u.includes('/search'))).toBe(false);
    expect(urls[0]).toContain('/42');
  });

  it('reports nothing to sync when the record has no video id', async () => {
    const main = await load();
    (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ id: '42', properties: {} }),
      text: async () => '',
    } as unknown as Response);

    const res = await main({ parameters: { portalId: '51869810', recordId: '42' } } as never);
    expect(res.statusCode).toBe(200);
    expect((res.body as { recordsFound: number }).recordsFound).toBe(0);
  });
});

describe('YouTubeSync.main — serving a workflow step as well as the card', () => {
  const originalFetch = globalThis.fetch;
  const originalToken = process.env.HS_ACCESS_TOKEN;

  beforeEach(() => {
    process.env.HS_ACCESS_TOKEN = 'test-token';
    vi.resetModules();
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ results: [] }),
      text: async () => '',
    } as unknown as Response) as unknown as typeof fetch;
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
    if (originalToken === undefined) delete process.env.HS_ACCESS_TOKEN;
    else process.env.HS_ACCESS_TOKEN = originalToken;
    vi.restoreAllMocks();
    vi.resetModules();
  });

  async function load() {
    vi.doMock('@lib/youtube-auth', () => ({ getYouTubeAccessToken: async () => 'tok' }));
    vi.doMock('@lib/youtube-client', () => ({
      chunkVideoIds: (ids: string[]) => (ids.length ? [ids] : []),
      fetchVideoBatch: async () => ({ notModified: false, etag: null, items: [] }),
      fetchVideoAnalytics: async () => new Map(),
    }));
    vi.doMock('@lib/hubspot-client', () => ({
      hsUpdate: vi.fn(),
      readYouTubeChannelId: async () => null,
    }));
    return (await import('../functions/YouTubeSync')).main;
  }

  it('carries outputFields for the workflow step', async () => {
    // A workflow reads outputFields out of the response body. Without them the
    // daily sync runs but reports nothing back into the workflow, so a failing
    // sync looks identical to a healthy one in the workflow history.
    const main = await load();
    const res = await main({ accountId: 51869810 } as never);
    const body = res.body as { outputFields: Record<string, string> };

    expect(body.outputFields.syncStatus).toBe('success');
    expect(body.outputFields.recordsFound).toBe('0');
    // 'ok' rather than a skip reason: with no video records the sync returns
    // before the analytics block, so analytics were never needed rather than
    // skipped. Nothing to fetch them for is not a failure to fetch them.
    expect(body.outputFields.analyticsStatus).toBe('ok');
  });

  it('still carries the plain outcome the card reads', async () => {
    // The card reads the outcome directly. Adding outputFields must not move
    // or wrap the fields it already depends on.
    const main = await load();
    const res = await main({ accountId: 51869810 } as never);
    const body = res.body as { recordsFound: number; recordsUpdated: number; errors: string[] };

    expect(body.recordsFound).toBe(0);
    expect(body.recordsUpdated).toBe(0);
    expect(body.errors).toEqual([]);
  });

  it('reports a missing portal through outputFields too', async () => {
    const main = await load();
    const res = await main({} as never);
    expect(res.statusCode).toBe(400);
    expect((res.body as { outputFields: Record<string, string> }).outputFields.syncStatus).toBe('error');
  });

  it('every outputFields value is a string', async () => {
    // Workflow fields hold strings. A number here is silently coerced or
    // dropped depending on the field type, which is the sort of thing nobody
    // notices until a workflow branch stops matching.
    const main = await load();
    const res = await main({ accountId: 51869810 } as never);
    const fields = (res.body as { outputFields: Record<string, unknown> }).outputFields;
    for (const [key, value] of Object.entries(fields)) {
      expect(typeof value, `${key} must be a string`).toBe('string');
    }
  });
});
