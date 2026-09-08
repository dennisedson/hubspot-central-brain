import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { main } from '../functions/BreezeContentPipeline';

/**
 * Handler tests for the BreezeContentPipeline agent tool (toolType GET_DATA).
 *
 * URL ASSERTIONS ARE THE POINT (issue #14). Two exact literals: the pipeline
 * read and the record search. Do not soften these into `toContain`.
 *
 * The counting assertions matter just as much. Whatever this handler puts in
 * the header and in `recordCount` is what the agent repeats to the user, so a
 * count that disagrees with the list underneath it is a wrong answer delivered
 * confidently.
 */

const TEST_PORTAL_ID = 51869810;
const CONTENT_PIPELINE_ID = '926238627';

// --- the exact URLs this handler must call -------------------------------
const PIPELINE_URL =
  'https://api.hubapi.com/crm/pipelines/2026-03/2-67505887/926238627';
const SEARCH_URL =
  'https://api.hubapi.com/crm/objects/2026-03/2-67505887/search';

const STAGES = [
  { id: 's-idea', label: 'Idea', displayOrder: 0 },
  { id: 's-drafting', label: 'Drafting', displayOrder: 2 },
  { id: 's-review', label: 'Review', displayOrder: 4 },
  { id: 's-published', label: 'Published', displayOrder: 5, metadata: { isClosed: 'true' } },
  { id: 's-archived', label: 'Archived', displayOrder: 6, metadata: { isClosed: 'true' } },
];

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
  body: {
    origin?: { portalId: number };
    inputFields?: { pipeline?: string; stageFilter?: string };
  };
  headers: Record<string, string>;
  query: Record<string, string>;
  accountId: number;
}

function ctx(
  inputFields: { pipeline?: string; stageFilter?: string } = {},
  accountId = TEST_PORTAL_ID,
): Ctx {
  return {
    method: 'POST',
    body: { origin: { portalId: accountId }, inputFields },
    headers: {},
    query: {},
    accountId,
  };
}

function record(id: string, stageId: string, props: Record<string, string | null> = {}) {
  return {
    id,
    properties: {
      title: `Record ${id}`,
      content_type: 'blog_post',
      hs_pipeline_stage: stageId,
      target_date: null,
      linear_issue_url: null,
      ...props,
    },
  };
}

/** Queue the pipeline read and the record search, in the order main() awaits. */
function mockPortal(results: ReturnType<typeof record>[], total?: number) {
  mockFetch.mockResolvedValueOnce({
    ok: true,
    status: 200,
    json: async () => ({ stages: STAGES }),
    text: async () => '',
  });
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

describe('BreezeContentPipeline.main — request URLs', () => {
  it('reads the pipeline and searches records at the exact CRM URLs', async () => {
    mockPortal([record('1', 's-review')]);

    await main(ctx());

    const called = mockFetch.mock.calls.map(c => String(c[0]));
    expect(called).toContain(PIPELINE_URL);
    expect(called).toContain(SEARCH_URL);
  });

  it('filters the search to the requested pipeline', async () => {
    mockPortal([record('1', 's-review')]);

    await main(ctx());

    const body = JSON.parse(String(mockFetch.mock.calls[1][1].body));
    expect(body.filterGroups[0].filters[0]).toEqual({
      propertyName: 'hs_pipeline',
      operator: 'EQ',
      value: CONTENT_PIPELINE_ID,
    });
  });
});

describe('BreezeContentPipeline.main — record counts', () => {
  it('counts only records in the stages it actually lists', async () => {
    // 2 active, 3 in closed stages. The header must say 2, not 5.
    mockPortal([
      record('1', 's-review'),
      record('2', 's-drafting'),
      record('3', 's-published'),
      record('4', 's-published'),
      record('5', 's-archived'),
    ]);

    const out = outputFields(await main(ctx()));

    expect(out.pipelineSummary).toContain('2 active records');
    expect(out.recordCount).toBe('2');
  });

  it('reports the closed-stage records it left out', async () => {
    mockPortal([record('1', 's-review'), record('2', 's-published')]);

    const out = outputFields(await main(ctx()));

    expect(out.pipelineSummary).toContain('1 record in closed/archived stages not shown');
  });

  it('says so when the search was truncated at the page size', async () => {
    mockPortal([record('1', 's-review')], 250);

    const out = outputFields(await main(ctx()));

    expect(out.pipelineSummary).toContain('truncated');
    expect(out.pipelineSummary).toContain('first 1 of 250 records');
  });

  it('adds no truncation note when everything fit', async () => {
    mockPortal([record('1', 's-review')]);

    const out = outputFields(await main(ctx()));

    expect(out.pipelineSummary).not.toContain('truncated');
  });

  it('requests no more than the page size', async () => {
    mockPortal([record('1', 's-review')]);

    await main(ctx());

    expect(JSON.parse(String(mockFetch.mock.calls[1][1].body)).limit).toBe(100);
  });
});

describe('BreezeContentPipeline.main — target dates', () => {
  it('renders an ISO date in UTC', async () => {
    mockPortal([record('1', 's-review', { target_date: '2026-10-01' })]);

    const out = outputFields(await main(ctx()));

    expect(out.pipelineSummary).toContain('(target: Oct 1)');
  });

  it('renders an epoch-millisecond date rather than "Invalid Date"', async () => {
    // 2026-10-01T00:00:00Z
    mockPortal([record('1', 's-review', { target_date: '1790812800000' })]);

    const out = outputFields(await main(ctx()));

    expect(out.pipelineSummary).toContain('(target: Oct 1)');
    expect(out.pipelineSummary).not.toContain('Invalid Date');
  });

  it('omits an unparseable date instead of printing "Invalid Date"', async () => {
    mockPortal([record('1', 's-review', { target_date: 'soon-ish' })]);

    const out = outputFields(await main(ctx()));

    expect(out.pipelineSummary).not.toContain('Invalid Date');
    expect(out.pipelineSummary).not.toContain('target:');
  });
});

describe('BreezeContentPipeline.main — stage filter', () => {
  it('narrows to stages whose label matches, and labels the count accordingly', async () => {
    mockPortal([record('1', 's-review'), record('2', 's-drafting')]);

    const out = outputFields(await main(ctx({ stageFilter: 'review' })));

    expect(out.pipelineSummary).toContain('1 matching "review" record');
    expect(out.pipelineSummary).toContain('Review (1):');
    expect(out.pipelineSummary).not.toContain('Drafting');
  });

  it('shows a matched stage that is empty', async () => {
    mockPortal([record('1', 's-drafting')]);

    const out = outputFields(await main(ctx({ stageFilter: 'review' })));

    expect(out.pipelineSummary).toContain('Review (0):');
    expect(out.pipelineSummary).toContain('(empty)');
  });
});

describe('BreezeContentPipeline.main — guards', () => {
  it('returns 400 when the requested pipeline is not configured for the portal', async () => {
    // Staging has no changelog pipeline id.
    const res = await main(ctx({ pipeline: 'changelog' }, 51869787));

    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toContain('changelog');
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('returns 500 when the portal has no config', async () => {
    const res = await main(ctx({}, 999));

    expect(res.statusCode).toBe(500);
    expect(JSON.parse(res.body).error).toContain('999');
  });

  it('returns 500 when the record search fails', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true, status: 200, json: async () => ({ stages: STAGES }), text: async () => '',
    });
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
