import { describe, it, expect, vi, beforeEach } from 'vitest';

let main: (ctx: any) => Promise<any>;

const TEST_PORTAL_CONFIG = {
  appConfig: { objectTypeId: '2-app' },
  asanaProjectGid: '1202179514576728',
  asanaSections: { content: 'section-blog', changelog: 'section-changelog' },
  content: {
    objectTypeId: '2-content',
    pipelines: {
      content: {
        pipelineId: 'pipe-1',
        stageIds: { idea: 'idea', outline: 'outline', drafting: 'drafting', editing: 'editing', review: 'review', published: 'published', archived: 'archived' },
      },
      changelog: {
        pipelineId: 'pipe-2',
        stageIds: { identified: 'identified', drafting: 'drafting', reviewing: 'reviewing', published: 'published' },
      },
    },
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
    setTaskDueDate: vi.fn().mockResolvedValue(undefined),
    setTaskAssignee: vi.fn().mockResolvedValue(undefined),
    toAsanaDueOn: vi.fn().mockReturnValue(null),
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

  it('returns 200 with syncStatus "skipped" when hubspotStage does not map to a known stage name', async () => {
    const ctx = {
      ...baseCtx,
      body: { ...baseCtx.body, inputFields: { ...baseCtx.body.inputFields, hubspotStage: 'unknown-id' } },
    };
    const result = await main(ctx);
    expect(result.statusCode).toBe(200);
    expect(JSON.parse(result.body).outputFields.syncStatus).toBe('skipped');
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

describe('SyncToAsana — archived work leaves the assignee queue', () => {
  /**
   * Tagging the task Canceled does not remove it from anyone's My Tasks: it sits
   * there as a live to-do nobody intends to do. Archiving the HubSpot record
   * should clear the Asana assignee too.
   */
  const archivedCtx = {
    ...baseCtx,
    body: {
      ...baseCtx.body,
      inputFields: { ...baseCtx.body.inputFields, hubspotStage: 'archived' },
    },
  };

  it('clears the assignee when the stage is archived', async () => {
    const { setTaskAssignee } = await import('@lib/asana-client');
    const result = await main(archivedCtx);

    expect(result.statusCode).toBe(200);
    expect(setTaskAssignee).toHaveBeenCalledWith('asana-pat-test', 'asana-task-42', null);
  });

  it('leaves the assignee untouched on every other stage', async () => {
    // A routine stage change must not quietly take work off someone's list.
    const { setTaskAssignee } = await import('@lib/asana-client');
    await main(baseCtx); // hubspotStage: 'published'
    expect(setTaskAssignee).not.toHaveBeenCalled();
  });

  it('still reports success when the unassign call fails', async () => {
    // The stage move already landed; losing the assignee clear must not undo it.
    const { setTaskAssignee } = await import('@lib/asana-client');
    vi.mocked(setTaskAssignee).mockRejectedValueOnce(new Error('Asana 403'));

    const result = await main(archivedCtx);
    expect(result.statusCode).toBe(200);
    expect(JSON.parse(result.body).outputFields.syncStatus).toBe('success');
  });
});

/**
 * The Outline threshold.
 *
 * Outline is where work becomes real. Below it — at Idea — nothing fans out:
 * no Linear issue, no Asana task. The Obsidian vault IS the idea stage, so a
 * record still sitting at Idea represents a thought nobody has committed to,
 * and putting one in somebody's Asana project makes the project a list of
 * maybes rather than a list of work.
 */
describe('SyncToAsana — nothing is created below Outline', () => {
  function ctxAt(stage: string, overrides: Record<string, unknown> = {}) {
    return {
      ...baseCtx,
      body: {
        ...baseCtx.body,
        inputFields: { ...baseCtx.body.inputFields, hubspotStage: stage, ...overrides },
      },
    };
  }

  it('does not create a task for a record at Idea', async () => {
    const { createTask, findTaskByLinearIssueUrl } = await import('@lib/asana-client');
    // No stored URL and no task found — the create path, which must now refuse.
    vi.mocked(findTaskByLinearIssueUrl).mockResolvedValue(null);
    const result = await main(ctxAt('idea'));
    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body.outputFields.syncStatus).toBe('skipped');
    expect(body.outputFields.reason).toBe('below_outline:idea');
    expect(createTask).not.toHaveBeenCalled();
  });

  // The suppression is on CREATION only. Once a task exists somebody is already
  // carrying the work, and leaving Asana asserting a stage HubSpot has stopped
  // believing is worse than the stray task the rule exists to prevent.
  it('still updates an existing task that has moved back to Idea', async () => {
    const { updateTaskPipelineStage, createTask } = await import('@lib/asana-client');
    const result = await main(ctxAt('idea', { existingAsanaTaskUrl: 'https://app.asana.com/0/p/asana-task-42' }));
    expect(JSON.parse(result.body).outputFields.syncStatus).toBe('success');
    // idea → CONTENT_STAGE_TO_ASANA_STAGE.idea = '1212751789107073' (New Idea)
    expect(updateTaskPipelineStage).toHaveBeenCalledWith('asana-pat-test', 'asana-task-42', '1212751789107073');
    expect(createTask).not.toHaveBeenCalled();
  });

  // Same rule, reached the other way: the task was found by Linear URL rather
  // than stored on the record. Found is found.
  it('still updates a task discovered by Linear URL at Idea', async () => {
    const { updateTaskPipelineStage } = await import('@lib/asana-client');
    const result = await main(ctxAt('idea'));
    expect(JSON.parse(result.body).outputFields.syncStatus).toBe('success');
    expect(updateTaskPipelineStage).toHaveBeenCalled();
  });

  it('creates at Outline — the threshold itself is inside the door', async () => {
    const { createTask, findTaskByLinearIssueUrl } = await import('@lib/asana-client');
    vi.mocked(findTaskByLinearIssueUrl).mockResolvedValue(null);
    const result = await main(ctxAt('outline'));
    expect(JSON.parse(result.body).outputFields.syncStatus).toBe('success');
    expect(createTask).toHaveBeenCalled();
  });

  // Archived is deliberately NOT gated, although it is outside the fan-out
  // range Linear uses. A record that arrives already archived still gets a
  // task — an unassigned one — so the cancellation is visible in the project
  // rather than invisible. See TEST-PLAN 2.5.
  it('still creates an unassigned task at Archived', async () => {
    const { createTask, findTaskByLinearIssueUrl } = await import('@lib/asana-client');
    vi.mocked(findTaskByLinearIssueUrl).mockResolvedValue(null);
    await main(ctxAt('archived'));
    expect(createTask).toHaveBeenCalled();
  });

  // The idea gate must not leak across pipelines. 'identified' is the changelog
  // pipeline's first stage and it maps to the same Asana "New Idea" option, but
  // changelog records are Linear-born and were never part of this rule.
  it('still creates for a changelog record at identified', async () => {
    const { createTask, findTaskByLinearIssueUrl } = await import('@lib/asana-client');
    vi.mocked(findTaskByLinearIssueUrl).mockResolvedValue(null);
    const result = await main(ctxAt('identified', { objectType: 'changelog' }));
    expect(JSON.parse(result.body).outputFields.syncStatus).toBe('success');
    expect(createTask).toHaveBeenCalled();
  });
});
