import { describe, it, expect, vi, beforeEach } from 'vitest';

let main: (ctx: any) => Promise<any>;

const TEST_PORTAL_CONFIG = {
  asanaWorkspaceGid: 'ws-1',
  asanaProjectGid: 'proj-1',
  asanaSections: { content: 'sec-content', changelog: 'sec-changelog' },
  appConfig: { objectTypeId: '2-app' },
  content: {
    objectTypeId: '2-content',
    pipelines: {
      content: {
        pipelineId: 'pipe-content',
        stageIds: {
          idea: 'stage-idea',
          outline: 'stage-outline',
          drafting: 'stage-drafting',
          editing: 'stage-editing',
          review: 'stage-review',
          published: 'stage-published',
          archived: 'stage-archived',
        },
      },
      changelog: {
        pipelineId: 'pipe-changelog',
        stageIds: {
          identified: 'stage-identified',
          drafting: 'stage-drafting-cl',
          reviewing: 'stage-reviewing',
          published: 'stage-published-cl',
        },
      },
    },
  },
  video: { objectTypeId: '2-video', pipelineId: 'pipe-video', stageIds: { draft: 'draft', scheduled: 'scheduled', public: 'public' } },
};

const mockGetTaskPipelineStage = vi.fn();
const mockFindContentByAsanaTaskUrl = vi.fn();
const mockHsUpdate = vi.fn();

beforeEach(async () => {
  vi.clearAllMocks();
  vi.resetModules();

  vi.doMock('@lib/asana-client', () => ({
    getTaskPipelineStage: mockGetTaskPipelineStage,
    updateTaskPipelineStage: vi.fn(),
    createTask: vi.fn(),
    findTaskByLinearIssueUrl: vi.fn(),
  }));
  vi.doMock('@lib/hubspot-client', () => ({
    findContentByAsanaTaskUrl: mockFindContentByAsanaTaskUrl,
    hsUpdate: mockHsUpdate,
    getCurrentStage: vi.fn(),
    upsertContent: vi.fn(),
    archiveContentByLinearId: vi.fn(),
    readAppSettings: vi.fn(),
    findByLinearId: vi.fn(),
  }));
  vi.doMock('@lib/portal-config', () => ({
    getPortalConfig: vi.fn().mockReturnValue(TEST_PORTAL_CONFIG),
  }));

  process.env.ASANA_API_KEY = 'test-asana-key';

  const mod = await import('../functions/AsanaWebhook');
  main = mod.main;
});

const baseCtx = {
  method: 'POST',
  headers: {},
  query: {},
  accountId: 999,
};

function makeEvent(taskGid: string, field = 'custom_fields') {
  return {
    action: 'changed',
    resource: { gid: taskGid, resource_type: 'task' },
    change: { field, action: 'changed' },
  };
}

describe('AsanaWebhook', () => {
  it('handles handshake by echoing X-Hook-Secret', async () => {
    const res = await main({ ...baseCtx, body: {}, headers: { 'x-hook-secret': 'abc123' } });
    expect(res.statusCode).toBe(200);
    expect(res.headers?.['X-Hook-Secret']).toBe('abc123');
  });

  it('returns 200 with empty result when no events', async () => {
    const res = await main({ ...baseCtx, body: { events: [] } });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).processed).toBe(0);
  });

  it('skips non-task events', async () => {
    const res = await main({
      ...baseCtx,
      body: {
        events: [{ action: 'changed', resource: { gid: 'proj-1', resource_type: 'project' }, change: { field: 'custom_fields', action: 'changed' } }],
      },
    });
    expect(mockGetTaskPipelineStage).not.toHaveBeenCalled();
    expect(JSON.parse(res.body).results).toHaveLength(0);
  });

  it('skips events for non-custom_fields changes', async () => {
    await main({
      ...baseCtx,
      body: { events: [makeEvent('task-1', 'name')] },
    });
    expect(mockGetTaskPipelineStage).not.toHaveBeenCalled();
  });

  it('skips tasks with no pipeline stage', async () => {
    mockGetTaskPipelineStage.mockResolvedValue(null);
    const res = await main({ ...baseCtx, body: { events: [makeEvent('task-1')] } });
    expect(mockFindContentByAsanaTaskUrl).not.toHaveBeenCalled();
    expect(JSON.parse(res.body).results[0]).toContain('skipped (no stage)');
  });

  it('skips tasks with no HubSpot record (non-content Asana tasks)', async () => {
    mockGetTaskPipelineStage.mockResolvedValue('1202184607667441'); // In Progress
    mockFindContentByAsanaTaskUrl.mockResolvedValue(null);

    const res = await main({ ...baseCtx, body: { events: [makeEvent('task-1')] } });
    expect(mockHsUpdate).not.toHaveBeenCalled();
    expect(JSON.parse(res.body).results[0]).toContain('skipped (no HubSpot record)');
  });

  it('updates HubSpot stage when Asana stage changes', async () => {
    mockGetTaskPipelineStage.mockResolvedValue('1202184607668470'); // Peer Review
    mockFindContentByAsanaTaskUrl.mockResolvedValue({
      id: 'hs-1',
      pipelineStage: 'stage-drafting',
      pipeline: 'pipe-content',
    });
    mockHsUpdate.mockResolvedValue(undefined);

    const res = await main({ ...baseCtx, body: { events: [makeEvent('task-1')] } });
    expect(mockHsUpdate).toHaveBeenCalledWith('2-content', 'hs-1', { hs_pipeline_stage: 'stage-review' });
    expect(JSON.parse(res.body).results[0]).toContain('updated record hs-1 → review');
  });

  it('skips echo when HubSpot stage already maps to the incoming Asana stage', async () => {
    // HubSpot is at 'review' (stage-review), which maps to Peer Review (1202184607668470)
    mockGetTaskPipelineStage.mockResolvedValue('1202184607668470'); // Peer Review
    mockFindContentByAsanaTaskUrl.mockResolvedValue({
      id: 'hs-1',
      pipelineStage: 'stage-review',
      pipeline: 'pipe-content',
    });

    const res = await main({ ...baseCtx, body: { events: [makeEvent('task-1')] } });
    expect(mockHsUpdate).not.toHaveBeenCalled();
    expect(JSON.parse(res.body).results[0]).toContain('skipped (echo)');
  });

  it('skips echo for editing stage (maps to same In Progress GID as drafting)', async () => {
    // HubSpot is at 'editing' (stage-editing), which maps to In Progress (1202184607667441)
    mockGetTaskPipelineStage.mockResolvedValue('1202184607667441'); // In Progress
    mockFindContentByAsanaTaskUrl.mockResolvedValue({
      id: 'hs-1',
      pipelineStage: 'stage-editing',
      pipeline: 'pipe-content',
    });

    const res = await main({ ...baseCtx, body: { events: [makeEvent('task-1')] } });
    expect(mockHsUpdate).not.toHaveBeenCalled();
    expect(JSON.parse(res.body).results[0]).toContain('skipped (echo)');
  });

  it('returns 500 when ASANA_API_KEY is missing', async () => {
    delete process.env.ASANA_API_KEY;
    const res = await main({ ...baseCtx, body: { events: [makeEvent('task-1')] } });
    expect(res.statusCode).toBe(500);
  });
});
