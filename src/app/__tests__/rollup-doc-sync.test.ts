import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { main } from '../functions/RollupDocSync';

vi.mock('@lib/portal-config', async () => ({
  ...(await vi.importActual<typeof import('@lib/portal-config')>('@lib/portal-config')),
  getPortalConfig: vi.fn().mockReturnValue({ content: { objectTypeId: '2-content' } }),
}));

const OCT_DOC = 'https://docs.google.com/document/d/1OctDoc/edit';
const OWN_DOC = 'https://docs.google.com/document/d/1OwnDoc/edit';
const HS = 'https://api.hubapi.com/crm/objects/2026-03/2-content';

interface FakeRelease { id: string; name: string; links: string[]; issues: string[] }
interface FakeEntry { id: string; linear_id?: string; changelog_doc_url?: string; changelog_rollup?: string }
type Filter = { propertyName: keyof FakeEntry; operator: string; values?: string[] };

/**
 * A Linear workspace and a HubSpot portal that answer by what is asked —
 * GraphQL query text and URL — never by call order. Shapes are the ones the
 * real APIs returned on 2026-10-20.
 */
function world(
  releases: FakeRelease[],
  entries: FakeEntry[],
  opts: { failIssuePage?: boolean; onSearch?: () => void } = {},
) {
  const writes: Array<{ id: string; properties: Record<string, string> }> = [];
  const ISSUES_PAGE = 50;
  const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) });

  const fetchMock = vi.fn(async (url: string, init: { method?: string; body: string }) => {
    const body = JSON.parse(init.body);

    if (url === 'https://api.linear.app/graphql') {
      if (body.query.includes('releases(')) {
        const nodes = releases
          .filter(r => r.name.endsWith(body.variables.suffix))
          .map(r => ({
            id: r.id,
            name: r.name,
            links: { nodes: r.links.map(u => ({ url: u })), pageInfo: { hasNextPage: false } },
            issues: {
              nodes: r.issues.slice(0, ISSUES_PAGE).map(id => ({ id })),
              pageInfo: {
                hasNextPage: r.issues.length > ISSUES_PAGE,
                endCursor: r.issues.length > ISSUES_PAGE ? 'p1' : null,
              },
            },
          }));
        return ok({ data: { releases: { nodes, pageInfo: { hasNextPage: false, endCursor: null } } } });
      }
      if (body.query.includes('release(id: $id)') && body.query.includes('issues(')) {
        if (opts.failIssuePage) return { ok: false, status: 500, statusText: 'Server Error', json: async () => ({}) };
        const release = releases.find(r => r.id === body.variables.id)!;
        const start = body.variables.after ? Number(body.variables.after) : 0;
        const page = release.issues.slice(start, start + body.variables.first);
        const next = start + page.length;
        const more = next < release.issues.length;
        return ok({
          data: {
            release: {
              issues: { nodes: page.map(id => ({ id })), pageInfo: { hasNextPage: more, endCursor: more ? String(next) : null } },
            },
          },
        });
      }
    }

    if (url === `${HS}/search`) {
      opts.onSearch?.();
      const matches = (e: FakeEntry) =>
        (body.filterGroups as Array<{ filters: Filter[] }>).some(g =>
          g.filters.every(f =>
            f.operator === 'IN'
              ? f.values!.includes(e[f.propertyName] ?? '')
              : f.operator === 'HAS_PROPERTY'
                ? Boolean(e[f.propertyName])
                : false,
          ),
        );
      const results = entries.filter(matches).map(e => ({
        id: e.id,
        properties: {
          linear_id: e.linear_id ?? null,
          changelog_doc_url: e.changelog_doc_url ?? null,
          changelog_rollup: e.changelog_rollup ?? null,
        },
      }));
      return ok({ results });
    }

    if (url === `${HS}/batch/update`) {
      writes.push(...body.inputs);
      return ok({ status: 'COMPLETE', results: body.inputs });
    }

    throw new Error(`unexpected ${init.method ?? 'GET'} ${url}`);
  });

  vi.stubGlobal('fetch', fetchMock);
  return { writes, fetchMock };
}

const ctx = (sharedSecret = 'shh') => ({ accountId: 999, body: { inputFields: { sharedSecret } } });
const out = (res: { body: string }) => JSON.parse(res.body).outputFields;

const OCTOBER: FakeRelease = {
  id: 'r-oct',
  name: 'October 2026 Changelog Rollup',
  links: [OCT_DOC],
  issues: ['iss-876', 'iss-1453'],
};

beforeEach(() => {
  process.env.SYNC_SHARED_SECRET = 'shh';
  process.env.LINEAR_API_KEY = 'lin_key';
  process.env.HS_ACCESS_TOKEN = 'tok';
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('RollupDocSync', () => {
  it("sets October's doc and name on my entry, and creates nothing for issues that aren't mine", async () => {
    // iss-1453 is in the release but not in HubSpot: someone else's, or nobody's.
    const { writes, fetchMock } = world([OCTOBER], [{ id: '101', linear_id: 'iss-876' }]);

    const res = await main(ctx());

    expect(writes).toEqual([
      { id: '101', properties: { changelog_doc_url: OCT_DOC, changelog_rollup: 'October 2026 Changelog Rollup' } },
    ]);
    expect(out(res)).toMatchObject({ syncStatus: 'ok', updated: '1', cleared: '0' });
    // Every HubSpot call was a search or a batch update — never a create.
    for (const [url] of fetchMock.mock.calls) {
      if (String(url).startsWith(HS)) expect(url).toMatch(/\/(search|batch\/update)$/);
    }
  });

  it("clears October's doc and moves the name when the issue rolls on to November", async () => {
    const november: FakeRelease = { id: 'r-nov', name: 'November 2026 Changelog Rollup', links: [], issues: ['iss-876'] };
    const { writes } = world([{ ...OCTOBER, issues: [] }, november], [
      { id: '101', linear_id: 'iss-876', changelog_doc_url: OCT_DOC, changelog_rollup: 'October 2026 Changelog Rollup' },
    ]);

    const res = await main(ctx());

    expect(writes).toEqual([
      { id: '101', properties: { changelog_doc_url: '', changelog_rollup: 'November 2026 Changelog Rollup' } },
    ]);
    expect(out(res)).toMatchObject({ updated: '1', cleared: '1' });
  });

  it('writes nothing for an entry with its own doc whose issue is in no rollup', async () => {
    // The control.
    const { writes } = world([OCTOBER], [{ id: '102', linear_id: 'iss-other', changelog_doc_url: OWN_DOC }]);
    const res = await main(ctx());
    expect(writes).toEqual([]);
    expect(out(res)).toMatchObject({ syncStatus: 'ok', updated: '0' });
  });

  it('leaves alone, and reports, an issue in two monthly rollups', async () => {
    const november: FakeRelease = { id: 'r-nov', name: 'November 2026 Changelog Rollup', links: [], issues: ['iss-876'] };
    const { writes } = world([OCTOBER, november], [{ id: '101', linear_id: 'iss-876' }]);
    const res = await main(ctx());
    expect(writes).toEqual([]);
    expect(out(res).skipped).toBe('1');
    expect(out(res).detail).toMatch(/iss-876: in 2 monthly rollups/);
  });

  it("reads past the first page of a release's issues", async () => {
    const issues = Array.from({ length: 60 }, (_, i) => `iss-${i}`);
    const { writes } = world([{ ...OCTOBER, issues }], [{ id: '155', linear_id: 'iss-55' }]);
    await main(ctx());
    expect(writes).toEqual([
      { id: '155', properties: { changelog_doc_url: OCT_DOC, changelog_rollup: 'October 2026 Changelog Rollup' } },
    ]);
  });

  it('writes nothing at all when a Linear page fails', async () => {
    // Without strict paging, iss-55 would look like it had left October and
    // lose its link.
    const issues = Array.from({ length: 60 }, (_, i) => `iss-${i}`);
    const { writes } = world(
      [{ ...OCTOBER, issues }],
      [{ id: '101', linear_id: 'iss-55', changelog_doc_url: OCT_DOC, changelog_rollup: 'October 2026 Changelog Rollup' }],
      { failIssuePage: true },
    );
    const res = await main(ctx());
    expect(writes).toEqual([]);
    expect(out(res)).toMatchObject({ syncStatus: 'error' });
    expect(out(res).detail).toMatch(/nothing written/);
  });

  it('leaves a record with no linear_id alone, even when it holds a rollup doc', async () => {
    const { writes } = world([OCTOBER], [{ id: '103', changelog_doc_url: OCT_DOC }]);
    await main(ctx());
    expect(writes).toEqual([]);
  });

  it('ignores Spotlight releases', async () => {
    const spotlight: FakeRelease = { id: 'r-spot', name: 'Spring 2027 Spotlight', links: [OWN_DOC], issues: ['iss-876'] };
    const { writes } = world([spotlight], [{ id: '101', linear_id: 'iss-876' }]);
    await main(ctx());
    expect(writes).toEqual([]);
  });

  it('stops before writing when the reads use up the time budget', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const { writes } = world([OCTOBER], [{ id: '101', linear_id: 'iss-876' }], {
      onSearch: () => vi.setSystemTime(Date.now() + 17_000),
    });
    const res = await main(ctx());
    expect(writes).toEqual([]);
    expect(out(res)).toMatchObject({ syncStatus: 'partial' });
  });

  it('rejects a request without the shared secret, and calls nothing', async () => {
    const { fetchMock } = world([OCTOBER], []);
    const res = await main(ctx('wrong'));
    expect(res.statusCode).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
