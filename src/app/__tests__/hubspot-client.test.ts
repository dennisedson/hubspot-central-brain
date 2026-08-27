import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { LinearWebhookPayload } from '@lib/types';

const TEST_PORTAL_ID = 999;

const TEST_PORTAL_CONFIG = {
  appConfig: { objectTypeId: '2-app' },
  content: {
    objectTypeId: '2-content',
    pipelines: {
      content: {
        pipelineId: 'pipe-content',
        stageIds: { idea: 'idea', outline: 'outline', drafting: 'drafting', editing: 'editing', review: 'review', published: 'published', archived: 'archived' },
      },
      changelog: {
        pipelineId: 'pipe-changelog',
        stageIds: { identified: 'identified', drafting: 'drafting', reviewing: 'reviewing', published: 'published' },
      },
    },
  },
  video: {
    objectTypeId: '2-video',
    pipelineId: 'pipe-video',
    stageIds: { draft: 'draft', scheduled: 'scheduled', public: 'public' },
  },
};

vi.mock('@lib/portal-config', () => ({
  getPortalConfig: vi.fn().mockReturnValue(TEST_PORTAL_CONFIG),
  DEFAULT_APP_SETTINGS: { linearTeamId: '', assigneeFilter: 'all', linearAssigneeId: '' },
}));

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

function mockSearchResponse(results: unknown[]) {
  mockFetch.mockResolvedValueOnce({
    ok: true,
    json: async () => ({ results }),
    text: async () => '',
  });
}

function mockMutationResponse(body: unknown = {}) {
  mockFetch.mockResolvedValueOnce({
    ok: true,
    status: 200,
    json: async () => body,
    text: async () => '',
  });
}

function mock404Response() {
  mockFetch.mockResolvedValueOnce({
    ok: false,
    status: 404,
    json: async () => ({}),
    text: async () => 'Not Found',
  });
}

const baseIssue: LinearWebhookPayload = {
  action: 'create',
  type: 'Issue',
  organizationId: 'org-1',
  webhookTimestamp: 1000000,
  webhookId: 'wh-1',
  data: {
    id: 'lin-123',
    identifier: 'ENG-1',
    title: 'Add API endpoint docs',
    state: { id: 'st-1', name: 'In Progress', type: 'started' },
    labels: { nodes: [] },
    url: 'https://linear.app/team/issue/ENG-1',
    team: { id: 't-1', name: 'Engineering' },
  },
};

beforeEach(() => {
  vi.clearAllMocks();
  process.env.PRIVATE_APP_ACCESS_TOKEN = 'hs-test-token';
});

describe('findByLinearId', () => {
  it('returns null when no records match', async () => {
    const { findByLinearId } = await import('@lib/hubspot-client');
    mockSearchResponse([]);
    expect(await findByLinearId('2-content', 'lin-999')).toBeNull();
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('2-content/search'),
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('returns the id of the first matching record', async () => {
    const { findByLinearId } = await import('@lib/hubspot-client');
    mockSearchResponse([{ id: 'hs-456' }, { id: 'hs-789' }]);
    expect(await findByLinearId('2-content', 'lin-123')).toBe('hs-456');
  });
});

describe('getCurrentStage', () => {
  it('returns null when no record exists', async () => {
    const { getCurrentStage } = await import('@lib/hubspot-client');
    mockSearchResponse([]);
    expect(await getCurrentStage('2-content', 'lin-999')).toBeNull();
  });

  it('returns the hs_pipeline_stage value from the matching record', async () => {
    const { getCurrentStage } = await import('@lib/hubspot-client');
    mockSearchResponse([{ id: 'hs-1', properties: { hs_pipeline_stage: 'stage-abc' } }]);
    expect(await getCurrentStage('2-content', 'lin-123')).toBe('stage-abc');
  });

  it('returns null when the record has no stage set', async () => {
    const { getCurrentStage } = await import('@lib/hubspot-client');
    mockSearchResponse([{ id: 'hs-1', properties: { hs_pipeline_stage: null } }]);
    expect(await getCurrentStage('2-content', 'lin-123')).toBeNull();
  });
});

describe('upsertContent', () => {
  it('creates a new record when no existing match, maps "In Progress" to "drafting"', async () => {
    const { upsertContent } = await import('@lib/hubspot-client');
    mock404Response();                            // PATCH by idProperty → not found
    mockMutationResponse({ id: 'hs-new-1' });    // POST create → success

    const result = await upsertContent(baseIssue, TEST_PORTAL_ID);

    const createCall = mockFetch.mock.calls[1];  // [1] = POST create
    const body = JSON.parse(createCall[1].body);
    expect(body.properties).toMatchObject({
      title: 'Add API endpoint docs',
      linear_issue_id: 'lin-123',
      linear_issue_url: 'https://linear.app/team/issue/ENG-1',
      hs_pipeline_stage: 'drafting',
    });
    expect(result).toEqual({ id: 'hs-new-1', action: 'created' });
  });

  it('maps description to the notes property', async () => {
    const { upsertContent } = await import('@lib/hubspot-client');
    const issueWithDesc = { ...baseIssue, data: { ...baseIssue.data, description: 'Some notes here' } };
    mock404Response();
    mockMutationResponse({ id: 'hs-new-2' });
    await upsertContent(issueWithDesc, TEST_PORTAL_ID);
    const body = JSON.parse(mockFetch.mock.calls[1][1].body);  // [1] = POST create
    expect(body.properties.notes).toBe('Some notes here');
  });

  it('updates when a matching record exists', async () => {
    const { upsertContent } = await import('@lib/hubspot-client');
    mockMutationResponse({ id: 'hs-existing' });  // PATCH by idProperty → found, updated

    const result = await upsertContent(baseIssue, TEST_PORTAL_ID);

    const updateCall = mockFetch.mock.calls[0];   // [0] = the single PATCH call
    expect(updateCall[0]).toContain('lin-123');
    expect(updateCall[0]).toContain('idProperty=linear_issue_id');
    expect(updateCall[1].method).toBe('PATCH');
    expect(result).toEqual({ id: 'hs-existing', action: 'updated' });
  });
});

describe('upsertContent (changelog pipeline)', () => {
  it('creates a changelog record, maps "Done" to "published"', async () => {
    const { upsertContent } = await import('@lib/hubspot-client');
    const doneIssue: LinearWebhookPayload = {
      ...baseIssue,
      data: { ...baseIssue.data, state: { id: 'st-done', name: 'Done', type: 'completed' } },
    };
    mock404Response();
    mockMutationResponse({ id: 'hs-cl-1' });

    const result = await upsertContent(doneIssue, TEST_PORTAL_ID, 'changelog');

    expect(result.action).toBe('created');
    const body = JSON.parse(mockFetch.mock.calls[1][1].body);  // [1] = POST create
    expect(body.properties).toMatchObject({
      linear_issue_id: 'lin-123',
      hs_pipeline_stage: 'published',
    });
  });
});

describe('archiveContentByLinearId', () => {
  it('moves the matching record to the archived stage and returns action "updated"', async () => {
    const { archiveContentByLinearId } = await import('@lib/hubspot-client');
    mockSearchResponse([{ id: 'hs-existing' }]);
    mockMutationResponse();

    const result = await archiveContentByLinearId('lin-123', TEST_PORTAL_ID);

    const updateCall = mockFetch.mock.calls[1];
    expect(updateCall[0]).toContain('2-content');
    expect(updateCall[0]).toContain('hs-existing');
    const body = JSON.parse(updateCall[1].body);
    expect(body.properties.hs_pipeline_stage).toBe('archived');
    expect(result).toEqual({ id: 'hs-existing', action: 'updated' });
  });

  it('returns null when no matching record exists', async () => {
    const { archiveContentByLinearId } = await import('@lib/hubspot-client');
    mockSearchResponse([]);

    const result = await archiveContentByLinearId('lin-missing', TEST_PORTAL_ID);

    expect(result).toBeNull();
    expect(mockFetch).toHaveBeenCalledOnce();
  });
});
