import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { main } from '../functions/ContentDataApi';

/**
 * Handler tests for ContentDataApi.
 *
 * content_piece spans TWO pipelines. The stages returned and the records
 * returned must come from the same one — matching a record's stage ID against
 * another pipeline's stages silently yields zero results, which is exactly how
 * the Changelog Manager shipped showing empty columns.
 *
 * Real dev-portal ids from src/app/lib/portal-config.ts.
 */

const PORTAL_ID = 51869810;
const OBJECT_TYPE = '2-67505887';
const CONTENT_PIPELINE = '926238627';
const CHANGELOG_PIPELINE = '929918080';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

function pipelineResponse(stageId: string, label: string) {
  return {
    ok: true,
    status: 200,
    json: async () => ({ stages: [{ id: stageId, label, displayOrder: 0, metadata: {} }] }),
    text: async () => '',
  };
}

function searchResponse() {
  return {
    ok: true,
    status: 200,
    json: async () => ({ results: [] }),
    text: async () => '',
  };
}

beforeEach(() => {
  mockFetch.mockReset();
  vi.stubEnv('PRIVATE_APP_ACCESS_TOKEN', 'test-token');
});

afterEach(() => {
  vi.unstubAllEnvs();
});

function urls(): string[] {
  return mockFetch.mock.calls.map(c => String(c[0]));
}

function searchBody(): Record<string, unknown> {
  const call = mockFetch.mock.calls.find(c => String(c[0]).endsWith('/search'));
  return JSON.parse((call?.[1] as { body: string }).body) as Record<string, unknown>;
}

describe('ContentDataApi — pipeline selection', () => {
  it('defaults to the content pipeline', async () => {
    mockFetch
      .mockResolvedValueOnce(pipelineResponse('1418659999', 'Idea'))
      .mockResolvedValueOnce(searchResponse());

    const res = await main({ parameters: { portalId: String(PORTAL_ID) } });

    expect(res.statusCode).toBe(200);
    expect(urls()).toContain(
      `https://api.hubapi.com/crm/pipelines/2026-03/${OBJECT_TYPE}/${CONTENT_PIPELINE}`,
    );
  });

  it('uses the changelog pipeline when asked for it', async () => {
    mockFetch
      .mockResolvedValueOnce(pipelineResponse('1426412984', 'Identified'))
      .mockResolvedValueOnce(searchResponse());

    await main({ parameters: { portalId: String(PORTAL_ID), pipeline: 'changelog' } });

    expect(urls()).toContain(
      `https://api.hubapi.com/crm/pipelines/2026-03/${OBJECT_TYPE}/${CHANGELOG_PIPELINE}`,
    );
  });

  // The bug: an unfiltered search returned every record, including the other
  // pipeline's, whose stage ids match nothing in the returned stage list.
  it('filters records to the requested pipeline', async () => {
    mockFetch
      .mockResolvedValueOnce(pipelineResponse('1426412984', 'Identified'))
      .mockResolvedValueOnce(searchResponse());

    await main({ parameters: { portalId: String(PORTAL_ID), pipeline: 'changelog' } });

    expect(searchBody().filterGroups).toEqual([
      { filters: [{ propertyName: 'hs_pipeline', operator: 'EQ', value: CHANGELOG_PIPELINE }] },
    ]);
  });

  it('returns stages whose ids can match the records it returns', async () => {
    mockFetch
      .mockResolvedValueOnce(pipelineResponse('1426412984', 'Identified'))
      .mockResolvedValueOnce(searchResponse());

    const res = await main({ parameters: { portalId: String(PORTAL_ID), pipeline: 'changelog' } });
    const body = JSON.parse(res.body) as { stages: Array<{ id: string; label: string }> };

    // Callers match record.pipelineStage (an ID) against stage.id — never label.
    expect(body.stages[0].id).toBe('1426412984');
    expect(body.stages[0].label).toBe('Identified');
  });

  it('an unknown pipeline value falls back to content rather than erroring', async () => {
    mockFetch
      .mockResolvedValueOnce(pipelineResponse('1418659999', 'Idea'))
      .mockResolvedValueOnce(searchResponse());

    await main({ parameters: { portalId: String(PORTAL_ID), pipeline: 'nonsense' } });

    expect(urls()[0]).toContain(CONTENT_PIPELINE);
  });

  // Regression: hubspot.serverless() from a page does not populate accountId.
  it('resolves the portal from an explicit portalId when accountId is absent', async () => {
    mockFetch
      .mockResolvedValueOnce(pipelineResponse('1418659999', 'Idea'))
      .mockResolvedValueOnce(searchResponse());

    const res = await main({ parameters: { portalId: String(PORTAL_ID) } });

    expect(res.statusCode).toBe(200);
  });
});

/**
 * The pipeline board orders each column by the next milestone that forces
 * action, so the priority date has to come back with every record.
 *
 * Computed server-side from `notes` rather than stored: it cannot go stale
 * against the text it derives from, and it needed no backfill across the 70
 * records already on production.
 */
/**
 * Runs the handler against a single record with the given properties, and
 * returns that record as the board would receive it.
 */
async function oneRecord(props: Record<string, string>) {
  mockFetch.mockImplementation((url: string) => {
    if (String(url).endsWith('/search')) {
      return Promise.resolve({
        ok: true, status: 200,
        json: async () => ({ results: [{ id: '1', properties: { title: 'A thing', ...props } }] }),
        text: async () => '',
      });
    }
    return Promise.resolve(pipelineResponse('stage-1', 'Idea'));
  });

  const res = await main({ accountId: PORTAL_ID, parameters: {} } as never);
  const body = JSON.parse(res.body) as {
    records: Array<{
      priorityDate: string | null; priorityStage: string | null; priorityUpcoming: boolean;
    }>;
  };
  return body.records[0];
}

describe('rollout priority on each record', () => {
  it('returns the stored milestone, and marks a future one upcoming', async () => {
    const record = await oneRecord({
      rollout_priority_date: '2099-06-01',
      rollout_priority_stage: 'Public Beta',
    });

    expect(record.priorityDate).toBe('2099-06-01');
    expect(record.priorityStage).toBe('Public Beta');
    expect(record.priorityUpcoming).toBe(true);
  });

  it('marks a past milestone as not upcoming', async () => {
    // Computed per request rather than stored: "is it upcoming" is relative to
    // today, so a stored copy is correct for one day and wrong afterwards.
    const record = await oneRecord({
      rollout_priority_date: '2020-01-01',
      rollout_priority_stage: 'Live',
    });

    expect(record.priorityUpcoming).toBe(false);
  });

  it('handles a record with no milestone at all', async () => {
    const record = await oneRecord({});
    expect(record.priorityDate).toBeNull();
    expect(record.priorityUpcoming).toBe(false);
  });

  it('trims a datetime down to the date', async () => {
    // HubSpot returns date properties with a time component.
    const record = await oneRecord({ rollout_priority_date: '2099-06-01T00:00:00Z' });
    expect(record.priorityDate).toBe('2099-06-01');
  });

  it('does not ask HubSpot for notes — the board needs one date, not 2KB', async () => {
    await oneRecord({});
    const requested = (searchBody().properties as string[]) ?? [];
    expect(requested).toContain('rollout_priority_date');
    expect(requested).not.toContain('notes');
  });
});
