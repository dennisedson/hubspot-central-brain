import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { main } from '../functions/RelatedContentApi';

/**
 * Handler tests for RelatedContentApi.
 *
 * URL ASSERTIONS ARE THE POINT (issue #14). Both the source read and the
 * candidate search are pinned to exact literals — including the `?properties=`
 * query string, which differs per object type because `video` has no
 * `enterpret_theme`. Do not soften these into `toContain` or a regex.
 *
 * Real dev-portal ids from src/app/lib/portal-config.ts; real property names
 * from src/scripts/provision-objects.ts.
 */

const TEST_PORTAL_ID = 51869810;
const VIDEO_TYPE_ID = '2-67505890';
const SOURCE_ID = '4201';
const VIDEO_SOURCE_ID = '7001';

// --- the exact URLs this handler must call -------------------------------
const CONTENT_SOURCE_URL =
  'https://api.hubapi.com/crm/objects/2026-03/2-67505887/4201?properties=title,topic_tags,enterpret_theme';
const CONTENT_SEARCH_URL = 'https://api.hubapi.com/crm/objects/2026-03/2-67505887/search';
const VIDEO_SOURCE_URL =
  'https://api.hubapi.com/crm/objects/2026-03/2-67505890/7001?properties=title,tags';
const VIDEO_SEARCH_URL = 'https://api.hubapi.com/crm/objects/2026-03/2-67505890/search';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

beforeEach(() => {
  mockFetch.mockReset();
  vi.stubEnv('PRIVATE_APP_ACCESS_TOKEN', 'hs-test-token');
});

afterEach(() => {
  vi.unstubAllEnvs();
});

function makeContext(parameters: Record<string, string | undefined>) {
  return { accountId: TEST_PORTAL_ID, parameters, query: {}, body: {} };
}

function urls(): string[] {
  return mockFetch.mock.calls.map(call => String(call[0]));
}

function mockOk(payload: unknown) {
  mockFetch.mockResolvedValueOnce({
    ok: true,
    status: 200,
    json: async () => payload,
    text: async () => '',
  });
}

function mockFailure(status: number, body = 'boom') {
  mockFetch.mockResolvedValueOnce({
    ok: false,
    status,
    json: async () => ({}),
    text: async () => body,
  });
}

/** The source content_piece: tagged api+crm, theme "Webhook reliability". */
const SOURCE_RECORD = {
  id: SOURCE_ID,
  properties: {
    title: 'Retrying HubSpot webhooks',
    topic_tags: 'api;crm',
    enterpret_theme: 'Webhook reliability',
  },
};

const CANDIDATE_RESULTS = [
  // The source itself comes back from the search; it must be excluded by id.
  SOURCE_RECORD,
  {
    id: '4202',
    properties: {
      title: 'Webhook signature validation',
      topic_tags: 'api;workflows',
      enterpret_theme: 'Webhook reliability',
    },
  },
  {
    id: '4203',
    properties: { title: 'CRM cards deep dive', topic_tags: 'crm', enterpret_theme: null },
  },
  {
    id: '4204',
    properties: { title: 'Unrelated UI post', topic_tags: 'ui_extensions', enterpret_theme: null },
  },
];

describe('RelatedContentApi.main — request URLs', () => {
  it('reads the source record and searches candidates at the exact CRM URLs', async () => {
    mockOk(SOURCE_RECORD);
    mockOk({ results: CANDIDATE_RESULTS });

    await main(makeContext({ objectId: SOURCE_ID }));

    expect(urls()).toEqual([CONTENT_SOURCE_URL, CONTENT_SEARCH_URL]);
  });

  it('uses the video object type id and its property list when the card is on a video', async () => {
    mockOk({ id: VIDEO_SOURCE_ID, properties: { title: 'Ep 12', tags: 'api, crm' } });
    mockOk({ results: [] });

    await main(makeContext({ objectId: VIDEO_SOURCE_ID, objectTypeId: VIDEO_TYPE_ID }));

    expect(urls()).toEqual([VIDEO_SOURCE_URL, VIDEO_SEARCH_URL]);
  });

  it('resolves the video type from the explicit objectType parameter too', async () => {
    mockOk({ id: VIDEO_SOURCE_ID, properties: { title: 'Ep 12', tags: '' } });
    mockOk({ results: [] });

    await main(makeContext({ objectId: VIDEO_SOURCE_ID, objectType: 'video' }));

    expect(mockFetch.mock.calls[0][0]).toBe(VIDEO_SOURCE_URL);
  });

  it('defaults to the content object type when nothing identifies the record', async () => {
    mockOk(SOURCE_RECORD);
    mockOk({ results: [] });

    await main(makeContext({ objectId: SOURCE_ID }));

    expect(mockFetch.mock.calls[0][0]).toBe(CONTENT_SOURCE_URL);
  });

  it('POSTs the candidate search with the documented body', async () => {
    mockOk(SOURCE_RECORD);
    mockOk({ results: [] });

    await main(makeContext({ objectId: SOURCE_ID }));

    const [, init] = mockFetch.mock.calls[1];
    expect(init.method).toBe('POST');
    expect(init.headers.Authorization).toBe('Bearer hs-test-token');
    expect(JSON.parse(init.body)).toEqual({
      filterGroups: [],
      properties: ['title', 'topic_tags', 'enterpret_theme'],
      sorts: [{ propertyName: 'hs_lastmodifieddate', direction: 'DESCENDING' }],
      limit: 100,
      after: '0',
    });
  });
});

describe('RelatedContentApi.main — happy path', () => {
  it('returns the payload shape RelatedContentCard renders', async () => {
    mockOk(SOURCE_RECORD);
    mockOk({ results: CANDIDATE_RESULTS });

    const res = await main(makeContext({ objectId: SOURCE_ID }));
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);

    expect(body.objectType).toBe('content');
    expect(body.candidatesScanned).toBe(4);
    expect(body.errors).toEqual({ candidates: null });
    expect(body.source).toEqual({
      id: SOURCE_ID,
      title: 'Retrying HubSpot webhooks',
      topicTags: ['api', 'crm'],
      enterpretTheme: 'Webhook reliability',
    });

    // 4202: one shared tag (2) + shared theme (3) = 5. 4203: one shared tag = 2.
    // 4204 scores zero and is dropped; the source itself is excluded by id.
    expect(body.related).toEqual([
      {
        id: '4202',
        title: 'Webhook signature validation',
        score: 5,
        matchedTags: ['api'],
        matchedTheme: 'Webhook reliability',
        url: 'https://app.hubspot.com/contacts/51869810/record/2-67505887/4202',
      },
      {
        id: '4203',
        title: 'CRM cards deep dive',
        score: 2,
        matchedTags: ['crm'],
        matchedTheme: null,
        url: 'https://app.hubspot.com/contacts/51869810/record/2-67505887/4203',
      },
    ]);
  });

  it('caps the result list at five', async () => {
    const many = Array.from({ length: 12 }, (_, i) => ({
      id: `50${i}`,
      properties: { title: `Post ${i}`, topic_tags: 'api', enterpret_theme: 'Webhook reliability' },
    }));
    mockOk(SOURCE_RECORD);
    mockOk({ results: many });

    const body = JSON.parse((await main(makeContext({ objectId: SOURCE_ID }))).body);
    expect(body.related).toHaveLength(5);
    expect(body.candidatesScanned).toBe(12);
  });

  it('reports a video source with no theme and free-text tags', async () => {
    mockOk({ id: VIDEO_SOURCE_ID, properties: { title: 'Ep 12', tags: 'api, crm' } });
    mockOk({
      results: [{ id: '7002', properties: { title: 'Ep 13', tags: 'crm' } }],
    });

    const body = JSON.parse(
      (await main(makeContext({ objectId: VIDEO_SOURCE_ID, objectTypeId: VIDEO_TYPE_ID }))).body,
    );

    expect(body.objectType).toBe('video');
    expect(body.source.enterpretTheme).toBeNull();
    expect(body.source.topicTags).toEqual(['api', 'crm']);
    expect(body.related[0]).toMatchObject({
      id: '7002',
      score: 2,
      matchedTheme: null,
      url: 'https://app.hubspot.com/contacts/51869810/record/2-67505890/7002',
    });
  });

  it('falls back to "Untitled" and no tags for a bare record', async () => {
    mockOk({ id: SOURCE_ID, properties: { title: null, topic_tags: null, enterpret_theme: null } });
    mockOk({ results: CANDIDATE_RESULTS });

    const body = JSON.parse((await main(makeContext({ objectId: SOURCE_ID }))).body);
    expect(body.source.title).toBe('Untitled');
    expect(body.source.topicTags).toEqual([]);
    expect(body.related).toEqual([]);
  });
});

describe('RelatedContentApi.main — per-source failure isolation', () => {
  it('a failed candidate search still returns the source, with errors.candidates set', async () => {
    mockOk(SOURCE_RECORD);
    mockFailure(400, 'property topic_tags does not exist');

    const res = await main(makeContext({ objectId: SOURCE_ID }));
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);

    expect(urls()).toEqual([CONTENT_SOURCE_URL, CONTENT_SEARCH_URL]);
    expect(body.errors.candidates).toBe(
      'Candidate search failed 400: property topic_tags does not exist',
    );
    expect(body.source.title).toBe('Retrying HubSpot webhooks');
    expect(body.source.topicTags).toEqual(['api', 'crm']);
    expect(body.related).toEqual([]);
    expect(body.candidatesScanned).toBe(0);
  });

  it('a rejected candidate search never blanks the source (transport error)', async () => {
    mockOk(SOURCE_RECORD);
    mockFetch.mockRejectedValueOnce(new Error('socket hang up'));

    const body = JSON.parse((await main(makeContext({ objectId: SOURCE_ID }))).body);
    expect(body.errors.candidates).toBe('socket hang up');
    expect(body.source.id).toBe(SOURCE_ID);
  });
});

describe('RelatedContentApi.main — status codes', () => {
  it('returns 400 when objectId is missing', async () => {
    const res = await main(makeContext({}));
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toBe('objectId is required');
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('returns 400 for an unsupported objectType', async () => {
    const res = await main(makeContext({ objectId: SOURCE_ID, objectType: 'podcast' }));
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toBe(
      'objectType must be "content" or "video", got "podcast"',
    );
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('returns 400 for an objectTypeId this portal does not know', async () => {
    const res = await main(makeContext({ objectId: SOURCE_ID, objectTypeId: '2-99999999' }));
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toBe(
      'Unrecognized objectTypeId "2-99999999" for portal 51869810',
    );
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('returns 400 when accountId is missing from the context', async () => {
    const res = await main({ parameters: { objectId: SOURCE_ID }, query: {}, body: {} });
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toBe('accountId missing from context');
  });

  it('returns 500 when no HubSpot access token is available', async () => {
    vi.stubEnv('PRIVATE_APP_ACCESS_TOKEN', '');
    vi.stubEnv('HS_ACCESS_TOKEN', '');
    const res = await main(makeContext({ objectId: SOURCE_ID }));
    expect(res.statusCode).toBe(500);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('returns 500 for a portal with no config', async () => {
    const res = await main({
      accountId: 12345,
      parameters: { objectId: SOURCE_ID },
      query: {},
      body: {},
    });
    expect(res.statusCode).toBe(500);
    expect(JSON.parse(res.body).error).toBe('No portal config for 12345');
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('returns 502 when the source record cannot be read', async () => {
    mockFailure(404, 'not found');
    mockOk({ results: [] });

    const res = await main(makeContext({ objectId: SOURCE_ID }));
    expect(res.statusCode).toBe(502);
    expect(JSON.parse(res.body).error).toBe('Could not read record 4201: 404');
  });
});
