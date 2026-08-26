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
    createTask: vi.fn().mockResolvedValue({ gid: 'asana-task-new' }),
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
      title: 'Improve API docs',
      linearIssueUrl: 'https://linear.app/team/issue/ENG-1',
      hubspotStage: 'published',
      objectType: 'content',
    },
  },
};

describe('SyncToAsana.main — existing task', () => {
  it('returns 200 with syncStatus "success" when task is found and updated', async () => {
    const result = await main(baseCtx);
    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body.outputFields.syncStatus).toBe('success');
    expect(body.outputFields.asanaTaskGid).toBe('asana-task-42');
  });

  it('includes the Asana task URL in output fields', async () => {
    const result = await main(baseCtx);
    const body = JSON.parse(result.body);
    expect(body.outputFields.asanaTaskUrl).toContain('asana-task-42');
    expect(body.outputFields.asanaTaskUrl).toContain('1202179514576728');
  });

  it('calls updateTaskPipelineStage with correct task GID and Asana stage GID', async () => {
    const { updateTaskPipelineStage } = await import('@lib/asana-client');
    await main(baseCtx);
    // published → CONTENT_STAGE_TO_ASANA_STAGE.published = '1202212684793528'
    expect(updateTaskPipelineStage).toHaveBeenCalledWith('asana-pat-test', 'asana-task-42', '1202212684793528');
  });

  it('does NOT call createTask when a task is already found', async () => {
    const { createTask } = await import('@lib/asana-client');
    await main(baseCtx);
    expect(createTask).not.toHaveBeenCalled();
  });
});

describe('SyncToAsana.main — task creation', () => {
  beforeEach(async () => {
    const { findTaskByLinearIssueUrl } = await import('@lib/asana-client');
    vi.mocked(findTaskByLinearIssueUrl).mockResolvedValue(null);
  });

  it('creates a new Asana task when none is found', async () => {
    const { createTask } = await import('@lib/asana-client');
    const result = await main(baseCtx);
    expect(result.statusCode).toBe(200);
    expect(createTask).toHaveBeenCalledOnce();
  });

  it('creates the task with the correct name and project', async () => {
    const { createTask } = await import('@lib/asana-client');
    await main(baseCtx);
    const [, projectGid, name] = vi.mocked(createTask).mock.calls[0];
    expect(name).toBe('Improve API docs');
    expect(projectGid).toBe('1202179514576728');
  });

  it('sets the Linear Issue URL and pipeline stage custom fields on the new task', async () => {
    const { createTask } = await import('@lib/asana-client');
    await main(baseCtx);
    const [, , , customFields] = vi.mocked(createTask).mock.calls[0];
    expect(customFields['1213736210804469']).toBe('https://linear.app/team/issue/ENG-1');
    expect(customFields['1202184607659964']).toBe('1202212684793528'); // published Asana GID
  });

  it('returns the new task GID and URL in output fields', async () => {
    const result = await main(baseCtx);
    const body = JSON.parse(result.body);
    expect(body.outputFields.asanaTaskGid).toBe('asana-task-new');
    expect(body.outputFields.asanaTaskUrl).toContain('asana-task-new');
  });
});

describe('SyncToAsana.main — error cases', () => {
  it('handles changelog objectType, mapping "reviewing" → correct Asana stage', async () => {
    const { updateTaskPipelineStage } = await import('@lib/asana-client');
    const ctx = {
      ...baseCtx,
      body: {
        ...baseCtx.body,
        inputFields: { ...baseCtx.body.inputFields, hubspotStage: 'reviewing', objectType: 'changelog' },
      },
    };
    await main(ctx);
    // reviewing → CHANGELOG_STAGE_TO_ASANA_STAGE.reviewing = '1202184607668470'
    expect(updateTaskPipelineStage).toHaveBeenCalledWith('asana-pat-test', 'asana-task-42', '1202184607668470');
  });

  it('returns 400 when hubspotStage does not map to a known stage name', async () => {
    const ctx = {
      ...baseCtx,
      body: { ...baseCtx.body, inputFields: { ...baseCtx.body.inputFields, hubspotStage: 'unknown-id' } },
    };
    expect((await main(ctx)).statusCode).toBe(400);
  });

  it('returns 401 when shared secret does not match', async () => {
    const ctx = {
      ...baseCtx,
      body: { ...baseCtx.body, inputFields: { ...baseCtx.body.inputFields, sharedSecret: 'wrong' } },
    };
    expect((await main(ctx)).statusCode).toBe(401);
  });

  it('returns 500 when SYNC_SHARED_SECRET is not configured', async () => {
    delete process.env.SYNC_SHARED_SECRET;
    expect((await main(baseCtx)).statusCode).toBe(500);
  });

  it('returns 500 when ASANA_API_KEY is not configured', async () => {
    delete process.env.ASANA_API_KEY;
    expect((await main(baseCtx)).statusCode).toBe(500);
  });

  it('returns 500 when the Asana API throws', async () => {
    const { updateTaskPipelineStage } = await import('@lib/asana-client');
    vi.mocked(updateTaskPipelineStage).mockRejectedValue(new Error('Asana 403'));
    expect((await main(baseCtx)).statusCode).toBe(500);
  });
});
