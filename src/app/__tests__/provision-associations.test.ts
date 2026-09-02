import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  associationPairingsFor,
  requiredAssociationPairings,
  isSelfReferential,
  existingDefinitionsRequest,
  definitionRequest,
  classifyExisting,
  planFor,
  ensureAssociationDefinitions,
  unusablePairings,
  SELF_ASSOCIATION_REJECTION,
  type AssociationPairing,
} from '../../scripts/association-definitions';
import type { PortalConfig } from '../lib/portal-config';

/**
 * Issue #3: the content/video custom objects were provisioned with contact and
 * company associations only, so `AssociateRelatedContent` could never create an
 * association. These tests pin the definitions that must exist, the idempotency
 * decision, and the exact URL and body sent to HubSpot — the parts that can be
 * verified without a portal.
 *
 * The URL assertions are exact literals on purpose. If someone migrates the
 * association builders in `hs-api.ts` off `/crm/v3/` and `/crm/v4/` per issue
 * #14, these fail and say so.
 */

const CONTENT = '2-67505887';
const VIDEO = '2-67505890';

const pairings = associationPairingsFor(CONTENT, VIDEO);
const contentToContent = pairings[0];
const contentToVideo = pairings[1];
const videoToVideo = pairings[2];

describe('associationPairingsFor', () => {
  it('requires exactly the three pairings the app associates across', () => {
    expect(pairings.map(p => p.key)).toEqual([
      'content_to_content',
      'content_to_video',
      'video_to_video',
    ]);
  });

  it('points content_piece ↔ content_piece at the content object on both sides', () => {
    expect(contentToContent.fromObjectTypeId).toBe(CONTENT);
    expect(contentToContent.toObjectTypeId).toBe(CONTENT);
  });

  it('points content_piece ↔ video across the two object types', () => {
    expect(contentToVideo.fromObjectTypeId).toBe(CONTENT);
    expect(contentToVideo.toObjectTypeId).toBe(VIDEO);
  });

  it('points video ↔ video at the video object on both sides', () => {
    expect(videoToVideo.fromObjectTypeId).toBe(VIDEO);
    expect(videoToVideo.toObjectTypeId).toBe(VIDEO);
  });

  it('gives every definition a distinct snake_case name', () => {
    const names = pairings.map(p => p.name);
    expect(new Set(names).size).toBe(names.length);
    names.forEach(name => expect(name).toMatch(/^[a-z][a-z0-9_]*$/));
  });
});

describe('requiredAssociationPairings', () => {
  it('reads both object type ids out of the portal config', () => {
    const config = {
      content: { objectTypeId: '2-1' },
      video: { objectTypeId: '2-2' },
    } as unknown as PortalConfig;

    expect(requiredAssociationPairings(config).map(p => [p.fromObjectTypeId, p.toObjectTypeId]))
      .toEqual([
        ['2-1', '2-1'],
        ['2-1', '2-2'],
        ['2-2', '2-2'],
      ]);
  });
});

describe('isSelfReferential', () => {
  it('is true when both sides are the same object type', () => {
    expect(isSelfReferential(contentToContent)).toBe(true);
    expect(isSelfReferential(videoToVideo)).toBe(true);
  });

  it('is false across two object types', () => {
    expect(isSelfReferential(contentToVideo)).toBe(false);
  });
});

describe('existingDefinitionsRequest', () => {
  it('reads the association labels for the pairing', () => {
    expect(existingDefinitionsRequest(contentToVideo)).toEqual({
      method: 'GET',
      url: `https://api.hubapi.com/crm/v4/associations/${CONTENT}/${VIDEO}/labels`,
    });
  });

  it('uses the same object type on both sides for a self-referential pairing', () => {
    expect(existingDefinitionsRequest(contentToContent).url).toBe(
      `https://api.hubapi.com/crm/v4/associations/${CONTENT}/${CONTENT}/labels`,
    );
  });
});

describe('definitionRequest', () => {
  it('creates a cross-type pairing through the v3 schema associations endpoint', () => {
    expect(definitionRequest(contentToVideo)).toEqual({
      method: 'POST',
      url: `https://api.hubapi.com/crm/v3/schemas/${CONTENT}/associations`,
      body: {
        fromObjectTypeId: CONTENT,
        toObjectTypeId: VIDEO,
        name: 'content_piece_to_video',
      },
    });
  });

  it('creates a self-referential pairing through the v4 labels endpoint', () => {
    expect(definitionRequest(contentToContent)).toEqual({
      method: 'POST',
      url: `https://api.hubapi.com/crm/v4/associations/${CONTENT}/${CONTENT}/labels`,
      body: { name: 'content_piece_to_content_piece', label: 'Related Content' },
    });
  });

  it('omits inverseLabel on self-referential pairings — HubSpot 500s when it equals label', () => {
    expect(definitionRequest(videoToVideo).body).not.toHaveProperty('inverseLabel');
  });
});

describe('classifyExisting', () => {
  it('treats a missing payload (404) as undefined', () => {
    expect(classifyExisting(null)).toBe('undefined');
  });

  it('treats an empty results array as undefined', () => {
    expect(classifyExisting({ results: [] })).toBe('undefined');
  });

  it('recognises the unlabeled type by its null label', () => {
    expect(classifyExisting({
      results: [{ typeId: 1, category: 'USER_DEFINED', label: null }],
    })).toBe('defined-unlabeled');
  });

  it('recognises an omitted label as the unlabeled type', () => {
    expect(classifyExisting({ results: [{ typeId: 1, category: 'USER_DEFINED' }] }))
      .toBe('defined-unlabeled');
  });

  it('flags a definition that only has labels — default associations still fail there', () => {
    expect(classifyExisting({
      results: [{ typeId: 550, category: 'USER_DEFINED', label: 'Related Content' }],
    })).toBe('defined-labeled-only');
  });

  it('sees the unlabeled type alongside custom labels', () => {
    expect(classifyExisting({
      results: [
        { typeId: 550, category: 'USER_DEFINED', label: 'Related Content' },
        { typeId: 1, category: 'USER_DEFINED', label: null },
      ],
    })).toBe('defined-unlabeled');
  });
});

describe('planFor', () => {
  it('creates only when nothing is defined', () => {
    expect(planFor('undefined')).toBe('create');
  });

  it('never touches a pairing that already has a definition', () => {
    expect(planFor('defined-unlabeled')).toBe('skip');
    expect(planFor('defined-labeled-only')).toBe('skip');
  });
});

// ---------------------------------------------------------------------------
// ensureAssociationDefinitions — fetch is mocked, no portal involved
// ---------------------------------------------------------------------------

interface StubResponse {
  status?: number;
  body?: unknown;
}

type Route = (url: string, init?: RequestInit) => StubResponse;

function stubFetch(route: Route) {
  const calls: { url: string; method: string; body: unknown }[] = [];

  const impl = vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({
      url,
      method: init?.method ?? 'GET',
      body: init?.body ? JSON.parse(init.body as string) : undefined,
    });
    const { status = 200, body = {} } = route(url, init);
    return {
      ok: status >= 200 && status < 300,
      status,
      text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
    };
  });

  vi.stubGlobal('fetch', impl);
  return calls;
}

const UNLABELED = { results: [{ typeId: 1, category: 'USER_DEFINED', label: null }] };
const NOTHING = { results: [] };

/**
 * A portal where nothing is defined yet: every read before a pairing's POST
 * says `undefined`, every read after it says `defined-unlabeled`.
 */
function routeFreshPortal(): Route {
  // ensureAssociationDefinitions walks one pairing at a time as
  // GET -> POST -> GET, so a single "the pairing was just created" flag is
  // enough to model a portal where nothing existed before the run.
  let justCreated = false;
  return (_url, init) => {
    if ((init?.method ?? 'GET') !== 'GET') {
      justCreated = true;
      return { status: 200, body: {} };
    }
    const body = justCreated ? UNLABELED : NOTHING;
    justCreated = false;
    return { status: 200, body };
  };
}

describe('ensureAssociationDefinitions', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('skips every pairing that is already defined and sends no POST', async () => {
    const calls = stubFetch(() => ({ status: 200, body: UNLABELED }));

    const results = await ensureAssociationDefinitions('tok', pairings);

    expect(results.map(r => r.outcome)).toEqual(['skipped', 'skipped', 'skipped']);
    expect(results.map(r => r.state)).toEqual([
      'defined-unlabeled',
      'defined-unlabeled',
      'defined-unlabeled',
    ]);
    expect(calls.every(c => c.method === 'GET')).toBe(true);
  });

  it('treats a 404 on the labels read as "no definition yet"', async () => {
    let posted = false;
    const calls = stubFetch((_url, init) => {
      if ((init?.method ?? 'GET') === 'GET') {
        return posted ? { status: 200, body: UNLABELED } : { status: 404, body: '' };
      }
      posted = true;
      return { status: 200, body: {} };
    });

    const results = await ensureAssociationDefinitions('tok', [contentToVideo]);

    expect(results[0].outcome).toBe('created');
    expect(calls.filter(c => c.method === 'POST')).toHaveLength(1);
  });

  it('sends the exact URL, method, headers and body when creating a cross-type pairing', async () => {
    const calls = stubFetch((_url, init) =>
      (init?.method ?? 'GET') === 'GET'
        ? { status: 200, body: NOTHING }
        : { status: 200, body: {} },
    );

    await ensureAssociationDefinitions('secret-token', [contentToVideo]);

    const post = calls.find(c => c.method === 'POST');
    expect(post).toEqual({
      url: `https://api.hubapi.com/crm/v3/schemas/${CONTENT}/associations`,
      method: 'POST',
      body: {
        fromObjectTypeId: CONTENT,
        toObjectTypeId: VIDEO,
        name: 'content_piece_to_video',
      },
    });

    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    const [, init] = fetchMock.mock.calls.at(-1) as [string, RequestInit];
    expect(init.headers).toEqual({
      'Content-Type': 'application/json',
      Authorization: 'Bearer secret-token',
    });
  });

  it('sends the exact URL and body when creating a self-referential pairing', async () => {
    const calls = stubFetch((_url, init) =>
      (init?.method ?? 'GET') === 'GET'
        ? { status: 200, body: NOTHING }
        : { status: 200, body: {} },
    );

    await ensureAssociationDefinitions('tok', [contentToContent]);

    expect(calls.find(c => c.method === 'POST')).toEqual({
      url: `https://api.hubapi.com/crm/v4/associations/${CONTENT}/${CONTENT}/labels`,
      method: 'POST',
      body: { name: 'content_piece_to_content_piece', label: 'Related Content' },
    });
  });

  it('reads the pairing back after creating it, so a labels-only result is visible', async () => {
    let posted = false;
    stubFetch((_url, init) => {
      if ((init?.method ?? 'GET') === 'GET') {
        return posted
          ? { status: 200, body: { results: [{ typeId: 550, label: 'Related Content' }] } }
          : { status: 200, body: NOTHING };
      }
      posted = true;
      return { status: 200, body: {} };
    });

    const results = await ensureAssociationDefinitions('tok', [contentToContent]);

    expect(results[0].outcome).toBe('created');
    expect(results[0].state).toBe('defined-labeled-only');
    expect(unusablePairings(results)).toHaveLength(1);
  });

  it('reports HubSpot refusing a self-referential definition without throwing', async () => {
    stubFetch((_url, init) =>
      (init?.method ?? 'GET') === 'GET'
        ? { status: 200, body: NOTHING }
        : {
            status: 400,
            body: {
              status: 'error',
              message: `Cannot create association definition with itself: ${CONTENT}`,
              category: 'VALIDATION_ERROR',
              subCategory: `ObjectSchemaError.${SELF_ASSOCIATION_REJECTION}`,
            },
          },
    );

    const results = await ensureAssociationDefinitions('tok', [contentToContent]);

    expect(results[0].outcome).toBe('failed');
    expect(results[0].state).toBeNull();
    expect(results[0].detail).toContain(SELF_ASSOCIATION_REJECTION);
  });

  it('keeps going after one pairing fails', async () => {
    stubFetch((url, init) => {
      if ((init?.method ?? 'GET') === 'GET') return { status: 200, body: NOTHING };
      if (url.includes('/labels')) return { status: 400, body: 'nope' };
      return { status: 200, body: {} };
    });

    const results = await ensureAssociationDefinitions('tok', pairings);

    expect(results.map(r => r.outcome)).toEqual(['failed', 'created', 'failed']);
  });

  it('treats an "already exists" conflict as a skip, not a failure', async () => {
    stubFetch((_url, init) =>
      (init?.method ?? 'GET') === 'GET'
        ? { status: 200, body: NOTHING }
        : { status: 409, body: { message: 'Association definition already exists' } },
    );

    const results = await ensureAssociationDefinitions('tok', [contentToVideo]);

    expect(results[0].outcome).toBe('skipped');
  });

  it('surfaces an unexpected read failure as a failed pairing', async () => {
    stubFetch(() => ({ status: 500, body: 'internal error' }));

    const results = await ensureAssociationDefinitions('tok', [contentToVideo]);

    expect(results[0].outcome).toBe('failed');
    expect(results[0].detail).toContain('500');
  });

  it('is idempotent — the first run creates all three, the second sends no POST', async () => {
    const first = stubFetch(routeFreshPortal());
    const created = await ensureAssociationDefinitions('tok', pairings);

    expect(created.map(r => r.outcome)).toEqual(['created', 'created', 'created']);
    expect(created.map(r => r.state)).toEqual([
      'defined-unlabeled',
      'defined-unlabeled',
      'defined-unlabeled',
    ]);
    expect(first.filter(c => c.method === 'POST')).toHaveLength(3);

    // Re-run against the portal the first run left behind.
    const second = stubFetch(() => ({ status: 200, body: UNLABELED }));
    const rerun = await ensureAssociationDefinitions('tok', pairings);

    expect(second.some(c => c.method === 'POST')).toBe(false);
    expect(rerun.every(r => r.outcome === 'skipped')).toBe(true);
    expect(unusablePairings(rerun)).toHaveLength(0);
  });
});

describe('unusablePairings', () => {
  it('returns only the pairings without an unlabeled definition', () => {
    const results = [
      { pairing: contentToContent as AssociationPairing, outcome: 'created' as const, state: 'defined-unlabeled' as const, detail: '' },
      { pairing: contentToVideo as AssociationPairing, outcome: 'created' as const, state: 'defined-labeled-only' as const, detail: '' },
      { pairing: videoToVideo as AssociationPairing, outcome: 'failed' as const, state: null, detail: '' },
    ];

    expect(unusablePairings(results).map(r => r.pairing.key)).toEqual([
      'content_to_video',
      'video_to_video',
    ]);
  });
});
