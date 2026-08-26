import { describe, it, expect, vi, beforeEach } from 'vitest';

let main: (ctx: any) => Promise<any>;

const TEST_PORTAL_CONFIG = {
  appConfig: { objectTypeId: '2-app' },
  content: {
    objectTypeId: '2-content',
    pipelineId: 'pipe-1',
    stageIds: { idea: 'idea', outline: 'outline', drafting: 'drafting', editing: 'editing', review: 'review', published: 'published', archived: 'archived' },
  },
  changelog: {
    objectTypeId: '2-changelog',
    pipelineId: 'pipe-2',
    stageIds: { identified: 'identified', drafting: 'drafting', reviewing: 'reviewing', published: 'published' },
  },
  video: { objectTypeId: '2-video', pipelineId: 'pipe-3', stageIds: { draft: 'draft', scheduled: 'scheduled', public: 'public' } },
};

beforeEach(async () => {
  vi.clearAllMocks();
  vi.resetModules();

  vi.doMock('@lib/portal-config', () => ({
    getPortalConfig: vi.fn().mockReturnValue(TEST_PORTAL_CONFIG),
    DEFAULT_APP_SETTINGS: { linearTeamId: '', assigneeFilter: 'all', linearAssigneeId: '' },
  }));

  vi.doMock('@lib/asana-client', () => ({
    findTaskByLinearIssueUrl: vi.fn().mockResolvedValue('asana-task-42'),
    updateTaskPipelineStage: vi.fn().mockResolvedValue(undefined),
  }));

  process.env.SYNC_SHARED_SECRET = 'top-secret';
  process.env.ASANA_API_KEY = 'asana-pat-test';

  const mod = await import('../functions/SyncToAsana');
  main = mod.main;
});

const baseCtx = {
  method: 'POST',
  headers: {},
  query: {},
  accountId: 999,
  body: {
    callbackId: 'cb-1',
    hs_object_id: 'hs-456',
    inputFields: {
      sharedSecret: 'top-secret',
      linearIssueUrl: 'https://linear.app/team/issue/ENG-1',
      hubspotStage: 'published',
      objectType: 'content',
    },
  },
};

describe('SyncToAsana.main', () => {
  it('returns 200 and syncStatus "success" when everything works', async () => {
    const result = await main(baseCtx);
    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body.outputFields.syncStatus).toBe('success');
  });

  it('calls updateTaskPipelineStage with correct task GID and Asana stage GID', async () => {
    const { updateTaskPipelineStage } = await import('@lib/asana-client');
    await main(baseCtx);
    // published → CONTENT_STAGE_TO_ASANA_STAGE.published = '1202212684793528'
    expect(updateTaskPipelineStage).toHaveBeenCalledWith('asana-pat-test', 'asana-task-42', '1202212684793528');
  });

  it('passes the correct project GID when searching for the Asana task', async () => {
    const { findTaskByLinearIssueUrl } = await import('@lib/asana-client');
    await main(baseCtx);
    expect(findTaskByLinearIssueUrl).toHaveBeenCalledWith(
      'asana-pat-test',
      '1202179514576728',
      'https://linear.app/team/issue/ENG-1',
    );
  });

  it('handles changelog objectType, mapping "reviewing" → correct Asana stage', async () => {
    const { updateTaskPipelineStage } = await import('@lib/asana-client');
    const ctx = {
      ...baseCtx,
      body: {
        ...baseCtx.body,
        inputFields: { ...baseCtx.body.inputFields, hubspotStage: 'reviewing', objectType: 'changelog' },
      },
    };
    const result = await main(ctx);
    expect(result.statusCode).toBe(200);
    // reviewing → CHANGELOG_STAGE_TO_ASANA_STAGE.reviewing = '1202184607668470'
    expect(updateTaskPipelineStage).toHaveBeenCalledWith('asana-pat-test', 'asana-task-42', '1202184607668470');
  });

  it('returns 200 with skipped when no Asana task is found for the linearIssueUrl', async () => {
    const { findTaskByLinearIssueUrl } = await import('@lib/asana-client');
    vi.mocked(findTaskByLinearIssueUrl).mockResolvedValue(null);
    const result = await main(baseCtx);
    expect(result.statusCode).toBe(200);
    expect(JSON.parse(result.body).outputFields.syncStatus).toBe('skipped');
  });

  it('returns 400 when hubspotStage does not map to a known stage name', async () => {
    const ctx = {
      ...baseCtx,
      body: {
        ...baseCtx.body,
        inputFields: { ...baseCtx.body.inputFields, hubspotStage: 'unknown-stage-id' },
      },
    };
    const result = await main(ctx);
    expect(result.statusCode).toBe(400);
  });

  it('returns 401 when shared secret does not match', async () => {
    const ctx = {
      ...baseCtx,
      body: { ...baseCtx.body, inputFields: { ...baseCtx.body.inputFields, sharedSecret: 'wrong' } },
    };
    const result = await main(ctx);
    expect(result.statusCode).toBe(401);
  });

  it('returns 500 when SYNC_SHARED_SECRET is not configured', async () => {
    delete process.env.SYNC_SHARED_SECRET;
    const result = await main(baseCtx);
    expect(result.statusCode).toBe(500);
  });

  it('returns 500 when ASANA_API_KEY is not configured', async () => {
    delete process.env.ASANA_API_KEY;
    const result = await main(baseCtx);
    expect(result.statusCode).toBe(500);
  });

  it('returns 500 when the Asana API throws', async () => {
    const { updateTaskPipelineStage } = await import('@lib/asana-client');
    vi.mocked(updateTaskPipelineStage).mockRejectedValue(new Error('Asana API error 403'));
    const result = await main(baseCtx);
    expect(result.statusCode).toBe(500);
  });
});
