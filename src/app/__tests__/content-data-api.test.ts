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
