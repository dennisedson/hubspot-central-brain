import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { main } from '../functions/BreezeFrictionFinder';

/**
 * Handler tests for the BreezeFrictionFinder agent tool (toolType GET_DATA).
 *
 * URL ASSERTIONS ARE THE POINT (issue #14): one exact literal for the search.
 *
 * This tool reads themes already synced into HubSpot — it never calls
 * Enterpret. The empty-state copy has to keep saying so, or an agent will
 * report "no developer friction" when the truth is "the sync has not run".
 */

const TEST_PORTAL_ID = 51869810;

/** The exact URL this handler must search. */
const SEARCH_URL = 'https://api.hubapi.com/crm/objects/2026-03/2-67505887/search';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

beforeEach(() => {
  mockFetch.mockReset();
  vi.stubEnv('PRIVATE_APP_ACCESS_TOKEN', 'hs-test-token');
});

afterEach(() => {
  vi.unstubAllEnvs();
});

interface Ctx {
  method: string;
  body: { origin?: { portalId: number }; inputFields?: { limit?: string } };
  headers: Record<string, string>;
  query: Record<string, string>;
  accountId: number;
}

function ctx(inputFields: { limit?: string } = {}, accountId = TEST_PORTAL_ID): Ctx {
  return {
    method: 'POST',
    body: { origin: { portalId: accountId }, inputFields },
    headers: {},
    query: {},
    accountId,
  };
}

function record(id: string, theme: string | null, quoteCount: string | null, title = `Record ${id}`) {
  return {
    id,
    properties: {
      title,
      enterpret_theme: theme,
      enterpret_quote_count: quoteCount,
      hs_pipeline_stage: 's-review',
      content_type: 'blog_post',
    },
  };
}

function mockSearch(results: ReturnType<typeof record>[], total?: number) {
  mockFetch.mockResolvedValueOnce({
    ok: true,
    status: 200,
    json: async () => ({ results, total: total ?? results.length }),
    text: async () => '',
  });
}

function outputFields(res: { body: string }): Record<string, string> {
  return JSON.parse(res.body).outputFields;
}

describe('BreezeFrictionFinder.main — request', () => {
  it('searches at the exact CRM search URL for records that have a theme', async () => {
    mockSearch([record('1', 'Webhook reliability', '40')]);

    await main(ctx());

    expect(String(mockFetch.mock.calls[0][0])).toBe(SEARCH_URL);
    const body = JSON.parse(String(mockFetch.mock.calls[0][1].body));
    expect(body.filterGroups[0].filters[0]).toEqual({
      propertyName: 'enterpret_theme',
      operator: 'HAS_PROPERTY',
    });
    expect(body.limit).toBe(100);
  });
});

describe('BreezeFrictionFinder.main — aggregation', () => {
  it('groups content pieces by theme and counts coverage', async () => {
    mockSearch([
      record('1', 'Webhook reliability', '40', 'Retrying webhooks'),
      record('2', 'Webhook reliability', '40', 'Webhook signatures'),
      record('3', 'OAuth scopes', '12', 'Scope basics'),
    ]);

    const out = outputFields(await main(ctx()));

    expect(out.themes).toContain('Webhook reliability — 40 quotes | 2 pieces');
    expect(out.themes).toContain('OAuth scopes — 12 quotes | 1 piece');
    expect(out.themeCount).toBe('2');
  });

  it('ranks themes by quote count, highest demand first', async () => {
    mockSearch([
      record('1', 'Low demand', '3'),
      record('2', 'High demand', '90'),
      record('3', 'Mid demand', '25'),
    ]);

    const out = outputFields(await main(ctx()));
    const order = ['High demand', 'Mid demand', 'Low demand'].map(t => out.themes.indexOf(t));

    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(order[0]).toBeGreaterThan(-1);
  });

  it('ignores records whose theme is blank or whitespace', async () => {
    mockSearch([
      record('1', 'Webhook reliability', '40'),
      record('2', '   ', '99'),
      record('3', null, '99'),
    ]);

    const out = outputFields(await main(ctx()));

    expect(out.themeCount).toBe('1');
  });

  it('lists at most three example titles per theme', async () => {
    mockSearch([
      record('1', 'Webhook reliability', '40', 'One'),
      record('2', 'Webhook reliability', '40', 'Two'),
      record('3', 'Webhook reliability', '40', 'Three'),
      record('4', 'Webhook reliability', '40', 'Four'),
    ]);

    const out = outputFields(await main(ctx()));

    expect(out.themes).toContain('One, Two, Three');
    expect(out.themes).not.toContain('Four');
  });
});

describe('BreezeFrictionFinder.main — limit and truncation', () => {
  it('caps the returned themes at the requested limit and says how many exist', async () => {
    mockSearch(
      Array.from({ length: 8 }, (_, i) => record(String(i), `Theme ${i}`, String(100 - i))),
    );

    const out = outputFields(await main(ctx({ limit: '3' })));

    expect(out.themes).toContain('3 of 8 themes');
    expect(out.themeCount).toBe('8');
  });

  it('does not say "of N" when every theme is shown', async () => {
    mockSearch([record('1', 'Webhook reliability', '40')]);

    const out = outputFields(await main(ctx()));

    expect(out.themes).toContain('(1 themes across 1 content records)');
  });

  it('clamps an oversized limit to 30', async () => {
    mockSearch(
      Array.from({ length: 40 }, (_, i) => record(String(i), `Theme ${i}`, String(100 - i))),
    );

    const out = outputFields(await main(ctx({ limit: '999' })));

    expect(out.themes).toContain('30 of 40 themes');
  });

  it('says so when the search was truncated at the page size', async () => {
    mockSearch([record('1', 'Webhook reliability', '40')], 400);

    const out = outputFields(await main(ctx()));

    expect(out.themes).toContain('truncated');
    expect(out.themes).toContain('first 1 of 400 themed content records');
  });

  it('adds no truncation note when everything fit', async () => {
    mockSearch([record('1', 'Webhook reliability', '40')]);

    expect(outputFields(await main(ctx())).themes).not.toContain('truncated');
  });
});

describe('BreezeFrictionFinder.main — coverage gaps', () => {
  it('flags a high-demand theme with a single content piece', async () => {
    mockSearch([
      record('1', 'Thin coverage', '75'),
      record('2', 'Good coverage', '30'),
      record('3', 'Good coverage', '30'),
    ]);

    const out = outputFields(await main(ctx()));

    expect(out.coverageGaps).toContain('Thin coverage — 75 quotes');
    expect(out.coverageGaps).not.toContain('Good coverage');
  });

  it('reports no gaps when every theme has multiple pieces', async () => {
    mockSearch([
      record('1', 'Webhook reliability', '40'),
      record('2', 'Webhook reliability', '40'),
    ]);

    expect(outputFields(await main(ctx())).coverageGaps).toContain('No obvious coverage gaps');
  });
});

describe('BreezeFrictionFinder.main — guards', () => {
  it('names the Enterpret sync in the empty state rather than reporting no friction', async () => {
    mockSearch([]);

    const out = outputFields(await main(ctx()));

    expect(out.themeCount).toBe('0');
    expect(out.themes).toContain('Enterpret sync');
    expect(out.coverageGaps).toContain('Enterpret MCP sync');
  });

  it('returns 500 when the portal has no config', async () => {
    const res = await main(ctx({}, 999));

    expect(res.statusCode).toBe(500);
    expect(JSON.parse(res.body).error).toContain('999');
  });

  it('returns 500 when the search fails', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false, status: 429, json: async () => ({}), text: async () => 'rate limited',
    });

    const res = await main(ctx());

    expect(res.statusCode).toBe(500);
    expect(JSON.parse(res.body).error).toContain('429');
  });

  it('returns 500 when no access token is set', async () => {
    vi.unstubAllEnvs();
    vi.stubEnv('PRIVATE_APP_ACCESS_TOKEN', '');
    vi.stubEnv('HS_ACCESS_TOKEN', '');

    const res = await main(ctx());

    expect(res.statusCode).toBe(500);
    expect(JSON.parse(res.body).error).toBe('No HubSpot access token');
  });
});
