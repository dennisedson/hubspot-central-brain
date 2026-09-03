import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  associationPairingsFor,
  requiredAssociationPairings,
  isSelfReferential,
  labelSpecFor,
  existingDefinitionsRequest,
  definitionRequest,
  classifyExisting,
  planFor,
  isProvisioned,
  ensureAssociationDefinitions,
  unusablePairings,
  UNLABELED_NAME_CONFLICT,
  type AssociationPairing,
} from '../../scripts/association-definitions';
import { collidesWithUnlabeledName } from '../lib/related-content-associations';
import type { PortalConfig } from '../lib/portal-config';

/**
 * Issue #3: the content/video custom objects were provisioned with contact and
 * company associations only, so `AssociateRelatedContent` could never create an
 * association. These tests pin the definitions that must exist, the idempotency
 * decision, and the exact URL and body sent to HubSpot — the parts that can be
 * verified without a portal.
 *
 * TWO THINGS THIS FILE EXISTS TO STOP REGRESSING
 * 1. The self-referential definitions must NOT be named `{a}_to_{a}`. HubSpot
 *    reserves that name for the unlabeled association and 400s the labels POST.
 * 2. A self-referential pairing is only provisioned once its OWN label exists.
 *    A bare unlabeled definition leaves the workflow action with no typeId, so
 *    it must not be classified as usable.
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

  it('routes the self-referential pairings through labels and the cross-type one through the schema', () => {
    expect(pairings.map(p => p.route)).toEqual(['labels', 'schema', 'labels']);
  });

  it('names the labeled definitions distinctly — never `{a}_to_{a}` (regression)', () => {
    // `content_piece_to_content_piece` is rejected outright:
    //   400 Association definition name '…' conflicts with unlabeled
    //   association name '…' (case-insensitive match)
    expect(contentToContent.name).toBe('cb_related_content');
    expect(videoToVideo.name).toBe('cb_related_video');
    pairings.forEach(p => expect(collidesWithUnlabeledName(p.name)).toBe(false));
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

  it('carries the same names on every portal — only the object ids change', () => {
    const config = {
      content: { objectTypeId: '2-67508928' },
      video: { objectTypeId: '2-67508933' },
    } as unknown as PortalConfig;

    expect(requiredAssociationPairings(config).map(p => p.name)).toEqual(pairings.map(p => p.name));
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

describe('labelSpecFor', () => {
  it('is the name/label pair the definition is read back by', () => {
    expect(labelSpecFor(contentToContent)).toEqual({
      name: 'cb_related_content',
      label: 'Related Content',
    });
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
      body: { name: 'cb_related_content', label: 'Related Content' },
    });
  });

  it('creates the video pairing with its own distinct name', () => {
    expect(definitionRequest(videoToVideo)).toEqual({
      method: 'POST',
      url: `https://api.hubapi.com/crm/v4/associations/${VIDEO}/${VIDEO}/labels`,
      body: { name: 'cb_related_video', label: 'Related Video' },
    });
  });

  it('never sends the colliding auto-generated name (regression)', () => {
    const bodies = pairings.map(p => definitionRequest(p).body?.name ?? '');
    expect(bodies).not.toContain('content_piece_to_content_piece');
    expect(bodies).not.toContain('video_to_video');
    bodies.forEach(name => expect(collidesWithUnlabeledName(name)).toBe(false));
  });

  it('omits inverseLabel on self-referential pairings — HubSpot 500s when it equals label', () => {
    expect(definitionRequest(videoToVideo).body).not.toHaveProperty('inverseLabel');
  });
});

// ---------------------------------------------------------------------------
// Fixtures shaped like real `GET …/labels` responses
// ---------------------------------------------------------------------------

/** A labeled definition and the inverse HubSpot pairs with it (`label: null`). */
function labeled(typeId: number, label: string) {
  return {
    results: [
      { category: 'USER_DEFINED', typeId, label },
      { category: 'USER_DEFINED', typeId: typeId + 1, label: null },
    ],
  };
}

/** The dev portal's real numbers for content ↔ content. */
const CONTENT_LABELS = labeled(99, 'Related Content');
/** A deliberately different number — typeIds are per portal and per pairing. */
const VIDEO_LABELS = labeled(141, 'Related Video');
const UNLABELED = { results: [{ typeId: 1, category: 'USER_DEFINED', label: null }] };
const NOTHING = { results: [] };

/** What each pairing's labels GET returns once the portal is fully provisioned. */
function provisionedLabels(url: string) {
  if (url.includes(`/${CONTENT}/${CONTENT}/`)) return CONTENT_LABELS;
  if (url.includes(`/${VIDEO}/${VIDEO}/`)) return VIDEO_LABELS;
  return UNLABELED;
}

describe('classifyExisting', () => {
  it('treats a missing payload (404) as undefined', () => {
    expect(classifyExisting(null, contentToContent)).toEqual({ state: 'undefined', typeId: null });
  });

  it('treats an empty results array as undefined', () => {
    expect(classifyExisting({ results: [] }, contentToContent))
      .toEqual({ state: 'undefined', typeId: null });
  });

  it('reports the typeId of the pairing\'s own label', () => {
    expect(classifyExisting(CONTENT_LABELS, contentToContent))
      .toEqual({ state: 'defined-labeled', typeId: 99 });
  });

  it('reports a different pairing\'s typeId from the same shape — nothing is hardcoded', () => {
    expect(classifyExisting(VIDEO_LABELS, videoToVideo))
      .toEqual({ state: 'defined-labeled', typeId: 141 });
  });

  it('never reports the paired inverse, which carries a null label', () => {
    expect(classifyExisting(CONTENT_LABELS, contentToContent).typeId).not.toBe(100);
  });

  it('an unlabeled definition alone is not enough for a labels-route pairing', () => {
    // This is the case the old classifier called `defined-unlabeled` and treated
    // as success. There is no typeId here, so the workflow action cannot PUT.
    expect(classifyExisting(UNLABELED, contentToContent))
      .toEqual({ state: 'defined-without-label', typeId: null });
  });

  it('someone else\'s label does not count as this pairing\'s definition', () => {
    expect(classifyExisting(
      { results: [{ typeId: 550, category: 'USER_DEFINED', label: 'Something unrelated' }] },
      contentToContent,
    )).toEqual({ state: 'defined-without-label', typeId: null });
  });

  it('finds the label alongside the unlabeled type', () => {
    expect(classifyExisting(
      {
        results: [
          { typeId: 1, category: 'USER_DEFINED', label: null },
          { typeId: 99, category: 'USER_DEFINED', label: 'Related Content' },
        ],
      },
      contentToContent,
    )).toEqual({ state: 'defined-labeled', typeId: 99 });
  });
});

describe('isProvisioned', () => {
  it('needs the label itself for a self-referential pairing', () => {
    expect(isProvisioned(contentToContent, 'defined-labeled')).toBe(true);
    expect(isProvisioned(contentToContent, 'defined-without-label')).toBe(false);
    expect(isProvisioned(contentToContent, 'undefined')).toBe(false);
    expect(isProvisioned(contentToContent, null)).toBe(false);
  });

  it('accepts the unlabeled definition for the cross-type pairing', () => {
    expect(isProvisioned(contentToVideo, 'defined-without-label')).toBe(true);
    expect(isProvisioned(contentToVideo, 'defined-labeled')).toBe(true);
    expect(isProvisioned(contentToVideo, 'undefined')).toBe(false);
  });
});

describe('planFor', () => {
  it('creates when nothing is defined', () => {
    pairings.forEach(p => expect(planFor(p, 'undefined')).toBe('create'));
  });

  it('adds the missing label to a pairing that only has the unlabeled definition', () => {
    expect(planFor(contentToContent, 'defined-without-label')).toBe('create');
    expect(planFor(videoToVideo, 'defined-without-label')).toBe('create');
  });

  it('never touches a pairing that is already provisioned', () => {
    expect(planFor(contentToContent, 'defined-labeled')).toBe('skip');
    expect(planFor(contentToVideo, 'defined-without-label')).toBe('skip');
    expect(planFor(videoToVideo, 'defined-labeled')).toBe('skip');
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

/**
 * A portal where nothing is defined yet: every read before a pairing's POST
 * says `undefined`, every read after it returns that pairing's provisioned
 * labels.
 */
function routeFreshPortal(): Route {
  // ensureAssociationDefinitions walks one pairing at a time as
  // GET -> POST -> GET, so a single "the pairing was just created" flag is
  // enough to model a portal where nothing existed before the run.
  let justCreated = false;
  return (url, init) => {
    if ((init?.method ?? 'GET') !== 'GET') {
      justCreated = true;
      return { status: 200, body: {} };
    }
    const body = justCreated ? provisionedLabels(url) : NOTHING;
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

  it('skips every pairing that is already provisioned and sends no POST', async () => {
    const calls = stubFetch(url => ({ status: 200, body: provisionedLabels(url) }));

    const results = await ensureAssociationDefinitions('tok', pairings);

    expect(results.map(r => r.outcome)).toEqual(['skipped', 'skipped', 'skipped']);
    expect(results.map(r => r.state)).toEqual([
      'defined-labeled',
      'defined-without-label',
      'defined-labeled',
    ]);
    expect(calls.every(c => c.method === 'GET')).toBe(true);
  });

  it('reports the typeId of each label it read back', async () => {
    stubFetch(url => ({ status: 200, body: provisionedLabels(url) }));

    const results = await ensureAssociationDefinitions('tok', pairings);

    expect(results.map(r => r.typeId)).toEqual([99, null, 141]);
  });

  it('treats a 404 on the labels read as "no definition yet"', async () => {
    let posted = false;
    const calls = stubFetch((url, init) => {
      if ((init?.method ?? 'GET') === 'GET') {
        return posted ? { status: 200, body: provisionedLabels(url) } : { status: 404, body: '' };
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
      body: { name: 'cb_related_content', label: 'Related Content' },
    });
  });

  it('adds the label to a pairing that already has the unlabeled definition', async () => {
    let posted = false;
    const calls = stubFetch((url, init) => {
      if ((init?.method ?? 'GET') === 'GET') {
        return { status: 200, body: posted ? provisionedLabels(url) : UNLABELED };
      }
      posted = true;
      return { status: 200, body: {} };
    });

    const results = await ensureAssociationDefinitions('tok', [contentToContent]);

    expect(calls.filter(c => c.method === 'POST')).toHaveLength(1);
    expect(results[0].outcome).toBe('created');
    expect(results[0].state).toBe('defined-labeled');
    expect(results[0].typeId).toBe(99);
  });

  it('reads the pairing back after creating it, so a label that never landed is visible', async () => {
    stubFetch((_url, init) =>
      (init?.method ?? 'GET') === 'GET'
        ? { status: 200, body: UNLABELED }
        : { status: 200, body: {} },
    );

    const results = await ensureAssociationDefinitions('tok', [contentToContent]);

    expect(results[0].outcome).toBe('created');
    expect(results[0].state).toBe('defined-without-label');
    expect(results[0].typeId).toBeNull();
    expect(unusablePairings(results)).toHaveLength(1);
  });

  it('reports a name collision without throwing', async () => {
    stubFetch((_url, init) =>
      (init?.method ?? 'GET') === 'GET'
        ? { status: 200, body: NOTHING }
        : {
            status: 400,
            body: {
              status: 'error',
              message:
                "Association definition name 'content_piece_to_content_piece' " +
                `${UNLABELED_NAME_CONFLICT} 'content_piece_to_content_piece' ` +
                '(case-insensitive match)',
              category: 'VALIDATION_ERROR',
            },
          },
    );

    const results = await ensureAssociationDefinitions('tok', [contentToContent]);

    expect(results[0].outcome).toBe('failed');
    expect(results[0].state).toBeNull();
    expect(results[0].detail).toContain('cb_related_content');
    expect(results[0].detail).toContain('distinct name');
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
      'defined-labeled',
      'defined-without-label',
      'defined-labeled',
    ]);
    expect(created.map(r => r.typeId)).toEqual([99, null, 141]);
    expect(first.filter(c => c.method === 'POST')).toHaveLength(3);
    expect(unusablePairings(created)).toHaveLength(0);

    // Re-run against the portal the first run left behind.
    const second = stubFetch(url => ({ status: 200, body: provisionedLabels(url) }));
    const rerun = await ensureAssociationDefinitions('tok', pairings);

    expect(second.some(c => c.method === 'POST')).toBe(false);
    expect(rerun.every(r => r.outcome === 'skipped')).toBe(true);
    expect(unusablePairings(rerun)).toHaveLength(0);
  });
});

describe('unusablePairings', () => {
  it('returns only the pairings the workflow action still cannot use', () => {
    const results = [
      { pairing: contentToContent as AssociationPairing, outcome: 'created' as const, state: 'defined-labeled' as const, typeId: 99, detail: '' },
      // An unlabeled definition is enough for the cross-type pairing…
      { pairing: contentToVideo as AssociationPairing, outcome: 'created' as const, state: 'defined-without-label' as const, typeId: null, detail: '' },
      // …but not for a self-referential one: there is no typeId to associate by.
      { pairing: videoToVideo as AssociationPairing, outcome: 'created' as const, state: 'defined-without-label' as const, typeId: null, detail: '' },
    ];

    expect(unusablePairings(results).map(r => r.pairing.key)).toEqual(['video_to_video']);
  });

  it('counts a pairing whose state could not be read', () => {
    const results = [
      { pairing: contentToVideo as AssociationPairing, outcome: 'failed' as const, state: null, typeId: null, detail: 'boom' },
    ];

    expect(unusablePairings(results)).toHaveLength(1);
  });
});
