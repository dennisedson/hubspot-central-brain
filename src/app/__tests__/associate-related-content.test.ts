import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { main } from '../functions/AssociateRelatedContent';

/**
 * Handler tests for AssociateRelatedContent.
 *
 * URL ASSERTIONS ARE THE POINT (issue #14). This is the only handler that PUTs
 * to the v4 default-association endpoint, so the association URL is pinned per
 * winner, in order. Do not soften these into `toContain` or a regex.
 *
 * NOTE ON ISSUE #3: the default association definition between two content_piece
 * records is not provisioned in the portal, so this endpoint 4xxs in the wild.
 * That must surface as a 200 with `associationStatus: "failed"` — a non-2xx makes
 * HubSpot retry and eventually park the workflow enrollment.
 */

const TEST_PORTAL_ID = 51869810;
const SOURCE_ID = '4201';
const SHARED_SECRET = 'top-secret';

// --- the exact URLs this handler must call -------------------------------
const SOURCE_URL =
  'https://api.hubapi.com/crm/objects/2026-03/2-67505887/4201?properties=title,topic_tags,enterpret_theme';
const SEARCH_URL = 'https://api.hubapi.com/crm/objects/2026-03/2-67505887/search';
const assocUrl = (toId: string) =>
  `https://api.hubapi.com/crm/v4/objects/2-67505887/4201/associations/default/2-67505887/${toId}`;

const VIDEO_SOURCE_URL =
  'https://api.hubapi.com/crm/objects/2026-03/2-67505890/7001?properties=title,tags';
const VIDEO_SEARCH_URL = 'https://api.hubapi.com/crm/objects/2026-03/2-67505890/search';
const VIDEO_ASSOC_URL =
  'https://api.hubapi.com/crm/v4/objects/2-67505890/7001/associations/default/2-67505890/7002';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

beforeEach(() => {
  mockFetch.mockReset();
  vi.stubEnv('PRIVATE_APP_ACCESS_TOKEN', 'hs-test-token');
  vi.stubEnv('SYNC_SHARED_SECRET', SHARED_SECRET);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

function urls(): string[] {
  return mockFetch.mock.calls.map(call => String(call[0]));
}

function makeContext(inputFields: Record<string, unknown> = {}, accountId = TEST_PORTAL_ID) {
  return {
    accountId,
    body: {
      callbackId: 'cb-1',
      inputFields: { sharedSecret: SHARED_SECRET, objectId: SOURCE_ID, ...inputFields },
    },
  };
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

const SOURCE_RECORD = {
  id: SOURCE_ID,
  properties: {
    title: 'Retrying HubSpot webhooks',
    topic_tags: 'api;crm',
    enterpret_theme: 'Webhook reliability',
  },
};

/** 4202 scores 5 (tag + theme), 4203 and 4204 score 2, 4205 scores 0. */
const CANDIDATE_RESULTS = [
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
    properties: { title: 'API rate limits', topic_tags: 'api', enterpret_theme: null },
  },
  {
    id: '4205',
    properties: { title: 'Unrelated UI post', topic_tags: 'ui_extensions', enterpret_theme: null },
  },
];

function mockReadAndSearch(results: unknown[] = CANDIDATE_RESULTS) {
  mockOk(SOURCE_RECORD);
  mockOk({ results });
}

describe('AssociateRelatedContent.main — request URLs', () => {
  it('reads, searches, then PUTs one association per winner — all exact URLs', async () => {
    mockReadAndSearch();
    mockOk({}); // 4202
    mockOk({}); // 4203
    mockOk({}); // 4204

    await main(makeContext());

    expect(urls()).toEqual([
      SOURCE_URL,
      SEARCH_URL,
      assocUrl('4202'),
      assocUrl('4203'),
      assocUrl('4204'),
    ]);
  });

  it('creates associations with PUT and a bearer token, no body', async () => {
    mockReadAndSearch();
    mockOk({});
    mockOk({});
    mockOk({});

    await main(makeContext());

    const [url, init] = mockFetch.mock.calls[2];
    expect(url).toBe(assocUrl('4202'));
    expect(init.method).toBe('PUT');
    expect(init.headers).toEqual({ Authorization: 'Bearer hs-test-token' });
    expect(init.body).toBeUndefined();
  });

  it('uses the video object type on both ends of the association path', async () => {
    mockOk({ id: '7001', properties: { title: 'Ep 12', tags: 'api, crm' } });
    mockOk({ results: [{ id: '7002', properties: { title: 'Ep 13', tags: 'crm' } }] });
    mockOk({});

    const res = await main(makeContext({ objectId: '7001', objectType: 'video' }));

    expect(urls()).toEqual([VIDEO_SOURCE_URL, VIDEO_SEARCH_URL, VIDEO_ASSOC_URL]);
    expect(JSON.parse(res.body).outputFields.associationStatus).toBe('success');
  });

  it('POSTs the candidate search with the documented body', async () => {
    mockReadAndSearch([]);

    await main(makeContext());

    const [, init] = mockFetch.mock.calls[1];
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({
      filterGroups: [],
      properties: ['title', 'topic_tags', 'enterpret_theme'],
      sorts: [{ propertyName: 'hs_lastmodifieddate', direction: 'DESCENDING' }],
      limit: 100,
      after: '0',
    });
  });
});

describe('AssociateRelatedContent.main — happy path', () => {
  it('returns success with the created count and titles', async () => {
    mockReadAndSearch();
    mockOk({});
    mockOk({});
    mockOk({});

    const res = await main(makeContext());
    expect(res.statusCode).toBe(200);

    expect(JSON.parse(res.body)).toEqual({
      outputFields: {
        associationStatus: 'success',
        associationsCreated: 3,
        relatedTitles: 'Webhook signature validation; CRM cards deep dive; API rate limits',
      },
    });
  });

  it('defaults to three associations', async () => {
    mockReadAndSearch();
    mockOk({});
    mockOk({});
    mockOk({});

    await main(makeContext());

    expect(urls().filter(u => u.includes('/associations/default/'))).toHaveLength(3);
  });

  it('honours a lower maxAssociations', async () => {
    mockReadAndSearch();
    mockOk({});

    const res = await main(makeContext({ maxAssociations: 1 }));

    expect(urls()).toEqual([SOURCE_URL, SEARCH_URL, assocUrl('4202')]);
    expect(JSON.parse(res.body).outputFields.associationsCreated).toBe(1);
  });

  it('clamps maxAssociations to the hard maximum of five', async () => {
    const many = Array.from({ length: 8 }, (_, i) => ({
      id: `43${i}`,
      properties: { title: `Post ${i}`, topic_tags: 'api', enterpret_theme: null },
    }));
    mockReadAndSearch(many);
    for (let i = 0; i < 5; i += 1) mockOk({});

    const res = await main(makeContext({ maxAssociations: '10' }));

    expect(urls().filter(u => u.includes('/associations/default/'))).toHaveLength(5);
    expect(JSON.parse(res.body).outputFields.associationsCreated).toBe(5);
  });

  it('returns no_matches without attempting an association', async () => {
    mockReadAndSearch([
      { id: '4299', properties: { title: 'Nothing in common', topic_tags: 'ui_extensions', enterpret_theme: null } },
    ]);

    const res = await main(makeContext());
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).outputFields).toEqual({
      associationStatus: 'no_matches',
      associationsCreated: 0,
      relatedTitles: '',
    });
    expect(urls()).toEqual([SOURCE_URL, SEARCH_URL]);
  });

  it('falls back to hs_object_id when inputFields carries no objectId', async () => {
    mockReadAndSearch([]);

    const res = await main({
      accountId: TEST_PORTAL_ID,
      body: { hs_object_id: SOURCE_ID, inputFields: { sharedSecret: SHARED_SECRET } },
    });

    expect(res.statusCode).toBe(200);
    expect(mockFetch.mock.calls[0][0]).toBe(SOURCE_URL);
  });

  it('falls back to object.objectId from the workflow payload', async () => {
    mockReadAndSearch([]);

    await main({
      accountId: TEST_PORTAL_ID,
      body: {
        object: { objectId: Number(SOURCE_ID), objectType: 'content_piece' },
        inputFields: { sharedSecret: SHARED_SECRET },
      },
    });

    expect(mockFetch.mock.calls[0][0]).toBe(SOURCE_URL);
  });
});

describe('AssociateRelatedContent.main — unprovisioned associations (issue #3)', () => {
  it('a 4xx from every association yields 200 with associationStatus "failed"', async () => {
    mockReadAndSearch();
    mockFailure(400, 'No default association definition exists');
    mockFailure(400, 'No default association definition exists');
    mockFailure(400, 'No default association definition exists');

    const res = await main(makeContext());

    // Never throws, never a non-2xx: HubSpot must not retry and park the enrollment.
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).outputFields).toEqual({
      associationStatus: 'failed',
      associationsCreated: 0,
      relatedTitles: '',
    });
    expect(urls()).toEqual([
      SOURCE_URL,
      SEARCH_URL,
      assocUrl('4202'),
      assocUrl('4203'),
      assocUrl('4204'),
    ]);
  });

  it('a 403 on one association out of three yields "partial"', async () => {
    mockReadAndSearch();
    mockOk({}); // 4202 succeeds
    mockFailure(403, 'forbidden'); // 4203 fails
    mockOk({}); // 4204 succeeds

    const res = await main(makeContext());
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).outputFields).toEqual({
      associationStatus: 'partial',
      associationsCreated: 2,
      relatedTitles: 'Webhook signature validation; API rate limits',
    });
  });

  it('a transport-level rejection on one association is isolated too', async () => {
    mockReadAndSearch();
    mockOk({});
    mockFetch.mockRejectedValueOnce(new Error('socket hang up'));
    mockOk({});

    const res = await main(makeContext());
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).outputFields.associationStatus).toBe('partial');
    expect(JSON.parse(res.body).outputFields.associationsCreated).toBe(2);
  });
});

describe('AssociateRelatedContent.main — source failures', () => {
  it('returns 200 "failed" when the source record cannot be read', async () => {
    mockFailure(404, 'not found');
    mockOk({ results: CANDIDATE_RESULTS });

    const res = await main(makeContext());
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).outputFields).toEqual({
      associationStatus: 'failed',
      associationsCreated: 0,
      relatedTitles: '',
    });
    // Both reads were attempted; nothing was associated.
    expect(urls()).toEqual([SOURCE_URL, SEARCH_URL]);
  });

  it('returns 200 "failed" when the candidate search fails', async () => {
    mockOk(SOURCE_RECORD);
    mockFailure(400, 'property topic_tags does not exist');

    const res = await main(makeContext());
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).outputFields.associationStatus).toBe('failed');
  });
});

describe('AssociateRelatedContent.main — auth and validation', () => {
  it('returns 500 when SYNC_SHARED_SECRET is not configured', async () => {
    vi.stubEnv('SYNC_SHARED_SECRET', undefined);
    const res = await main(makeContext());
    expect(res.statusCode).toBe(500);
    expect(JSON.parse(res.body).error).toBe('Server misconfiguration');
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('returns 401 when the shared secret does not match', async () => {
    const res = await main(makeContext({ sharedSecret: 'wrong-secret' }));
    expect(res.statusCode).toBe(401);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('returns 401 when the shared secret is absent', async () => {
    const res = await main({ accountId: TEST_PORTAL_ID, body: { inputFields: {} } });
    expect(res.statusCode).toBe(401);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('returns 500 when no HubSpot access token is available', async () => {
    vi.stubEnv('PRIVATE_APP_ACCESS_TOKEN', '');
    vi.stubEnv('HS_ACCESS_TOKEN', '');
    const res = await main(makeContext());
    expect(res.statusCode).toBe(500);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('returns 200 "skipped" when the payload carries no record id', async () => {
    const res = await main({
      accountId: TEST_PORTAL_ID,
      body: { inputFields: { sharedSecret: SHARED_SECRET } },
    });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).outputFields).toEqual({
      associationStatus: 'skipped',
      associationsCreated: 0,
      relatedTitles: '',
    });
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('returns 200 "skipped" for an unsupported objectType', async () => {
    const res = await main(makeContext({ objectType: 'podcast' }));
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).outputFields.associationStatus).toBe('skipped');
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('returns 500 for a portal with no config', async () => {
    const res = await main(makeContext({}, 12345));
    expect(res.statusCode).toBe(500);
    expect(JSON.parse(res.body).error).toBe('No portal config for 12345');
    expect(mockFetch).not.toHaveBeenCalled();
  });
});
