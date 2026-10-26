import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fetchEveryPage, getRelease, listRollupReleases } from '@lib/linear-client';
import { ROLLUP_PIPELINE_ID } from '@lib/rollup-doc';

/**
 * Its own file because linear-client.test.ts queues responses in call order,
 * and the routed mockImplementation used here would leak into it.
 */

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

type Gql = { query: string; variables: Record<string, unknown> };
const ok = (data: unknown) => ({ ok: true, status: 200, statusText: 'OK', json: async () => ({ data }) });
const httpError = { ok: false, status: 500, statusText: 'Server Error', json: async () => ({}) };

/** Route every Linear call on what it asks for, never on call order. */
function route(handler: (gql: Gql) => unknown) {
  mockFetch.mockImplementation(async (_url: string, init: { body: string }) => handler(JSON.parse(init.body) as Gql));
}

const OCT_DOC = 'https://docs.google.com/document/d/1OctDoc/edit';

function release(id: string, name: string, links: string[], issues: string[], moreIssues = false, pipelineId = ROLLUP_PIPELINE_ID) {
  return {
    id,
    name,
    pipeline: { id: pipelineId },
    links: { nodes: links.map(url => ({ url })), pageInfo: { hasNextPage: false } },
    issues: {
      nodes: issues.map(i => ({ id: i })),
      pageInfo: { hasNextPage: moreIssues, endCursor: moreIssues ? 'first-page-end' : null },
    },
  };
}

// Braces matter: Vitest calls a function returned from beforeEach as a cleanup
// hook, and mockReset() returns the mock — which would call fetch() with nothing.
beforeEach(() => {
  mockFetch.mockReset();
});

describe('fetchEveryPage', () => {
  const QUERY = 'query($first: Int!, $after: String) { things(first: $first, after: $after) { nodes { id } pageInfo { hasNextPage endCursor } } }';
  type Things = { things: { nodes: { id: string }[]; pageInfo: { hasNextPage: boolean; endCursor: string | null } } };
  const select = (d: Things) => d.things;

  it('follows the cursor to the last page', async () => {
    route(({ variables }) =>
      variables.after === null
        ? ok({ things: { nodes: [{ id: 'a' }], pageInfo: { hasNextPage: true, endCursor: 'c1' } } })
        : ok({ things: { nodes: [{ id: 'b' }], pageInfo: { hasNextPage: false, endCursor: null } } }),
    );
    expect(await fetchEveryPage('k', QUERY, {}, select)).toEqual([{ id: 'a' }, { id: 'b' }]);
  });

  it('throws rather than return the first page when a later one fails', async () => {
    route(({ variables }) =>
      variables.after === null
        ? ok({ things: { nodes: [{ id: 'a' }], pageInfo: { hasNextPage: true, endCursor: 'c1' } } })
        : httpError,
    );
    await expect(fetchEveryPage('k', QUERY, {}, select)).rejects.toThrow(/500/);
  });

  it('throws when Linear reports another page without a cursor', async () => {
    route(() => ok({ things: { nodes: [{ id: 'a' }], pageInfo: { hasNextPage: true, endCursor: null } } }));
    await expect(fetchEveryPage('k', QUERY, {}, select)).rejects.toThrow(/cursor/);
  });

  it('throws when the pages never end', async () => {
    let n = 0;
    route(() => ok({ things: { nodes: [{ id: String(n) }], pageInfo: { hasNextPage: true, endCursor: `c${n++}` } } }));
    await expect(fetchEveryPage('k', QUERY, {}, select)).rejects.toThrow(/refusing/);
  });
});

describe('listRollupReleases', () => {
  it('asks Linear for the rollup pipeline and returns every release in it, Spotlights included', async () => {
    route(({ query, variables }) => {
      if (query.includes('releases(')) {
        expect(variables.pipelineId).toBe(ROLLUP_PIPELINE_ID);
        return ok({
          releases: {
            nodes: [
              release('r-oct', 'October 2026 Changelog Rollup', [OCT_DOC, 'https://example.com'], ['i-1', 'i-2']),
              release('r-spring', 'Spring 2027 Spotlight', [], ['i-555']),
              // Linear's filter should never let this through; if it did, the
              // pipeline check here still would not.
              release('r-x', 'Elsewhere', [], ['i-9'], false, 'pipe-other'),
            ],
            pageInfo: { hasNextPage: false, endCursor: null },
          },
        });
      }
      throw new Error(`unexpected query: ${query}`);
    });

    expect(await listRollupReleases('k')).toEqual([
      {
        id: 'r-oct',
        name: 'October 2026 Changelog Rollup',
        pipelineId: ROLLUP_PIPELINE_ID,
        linkUrls: [OCT_DOC, 'https://example.com'],
        issueIds: ['i-1', 'i-2'],
      },
      { id: 'r-spring', name: 'Spring 2027 Spotlight', pipelineId: ROLLUP_PIPELINE_ID, linkUrls: [], issueIds: ['i-555'] },
    ]);
  });

  it('reads every issue of a release whose issues overflow the first page', async () => {
    route(({ query, variables }) => {
      if (query.includes('releases(')) {
        return ok({
          releases: {
            nodes: [release('r-oct', 'October 2026 Changelog Rollup', [], ['i-1'], true)],
            pageInfo: { hasNextPage: false, endCursor: null },
          },
        });
      }
      if (query.includes('release(id: $id)') && query.includes('issues(')) {
        expect(variables.id).toBe('r-oct');
        return variables.after === null
          ? ok({ release: { issues: { nodes: [{ id: 'i-1' }, { id: 'i-2' }], pageInfo: { hasNextPage: true, endCursor: 'p2' } } } })
          : ok({ release: { issues: { nodes: [{ id: 'i-3' }], pageInfo: { hasNextPage: false, endCursor: null } } } });
      }
      throw new Error(`unexpected query: ${query}`);
    });

    const [oct] = await listRollupReleases('k');
    expect(oct.issueIds).toEqual(['i-1', 'i-2', 'i-3']);
  });

  it("refuses to pick a doc from part of a release's links", async () => {
    route(() =>
      ok({
        releases: {
          nodes: [{
            ...release('r-oct', 'October 2026 Changelog Rollup', [OCT_DOC], []),
            links: { nodes: [{ url: OCT_DOC }], pageInfo: { hasNextPage: true } },
          }],
          pageInfo: { hasNextPage: false, endCursor: null },
        },
      }),
    );
    await expect(listRollupReleases('k')).rejects.toThrow(/links/);
  });
});

describe('getRelease', () => {
  it("returns a release's name, pipeline and linked URLs", async () => {
    route(({ query, variables }) => {
      expect(query).toContain('links(');
      expect(query).toContain('pipeline');
      expect(variables.id).toBe('r-spring');
      return ok({
        release: {
          name: 'Spring 2027 Spotlight',
          pipeline: { id: ROLLUP_PIPELINE_ID },
          links: { nodes: [{ url: OCT_DOC }], pageInfo: { hasNextPage: false } },
        },
      });
    });
    expect(await getRelease('k', 'r-spring')).toEqual({
      name: 'Spring 2027 Spotlight',
      pipelineId: ROLLUP_PIPELINE_ID,
      linkUrls: [OCT_DOC],
    });
  });

  it('throws on a null release rather than reporting no links', async () => {
    route(() => ok({ release: null }));
    await expect(getRelease('k', 'nope')).rejects.toThrow(/not found/);
  });

  it('throws on the error Linear actually sends for an unknown release', async () => {
    // Observed 2026-10-20: HTTP 200, data null, and this error.
    route(() => ({
      ok: true,
      status: 200,
      json: async () => ({
        data: null,
        errors: [{ message: 'Entity not found: Release', extensions: { code: 'INPUT_ERROR', statusCode: 400 } }],
      }),
    }));
    await expect(getRelease('k', 'nope')).rejects.toThrow(/Entity not found/);
  });
});
