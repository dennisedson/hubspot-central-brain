import { describe, it, expect, vi, beforeEach } from 'vitest';

let main: (ctx: any) => Promise<any>;

beforeEach(async () => {
  vi.clearAllMocks();
  vi.resetModules();

  vi.doMock('@lib/linear-client', () => ({
    findStateIdByName: vi.fn().mockResolvedValue('st-done'),
    updateLinearIssueState: vi.fn().mockResolvedValue(undefined),
  }));

  vi.doMock('@lib/portal-config', () => ({
    getPortalConfig: vi.fn().mockReturnValue({
      appConfig: { objectTypeId: '2-test' },
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
      video: {
        objectTypeId: '2-video',
        pipelineId: 'pipe-3',
        stageIds: { draft: 'draft', scheduled: 'scheduled', public: 'public' },
      },
    }),
    DEFAULT_APP_SETTINGS: { linearTeamId: '', assigneeFilter: 'all', linearAssigneeId: '' },
  }));

  process.env.LINEAR_API_KEY = 'lin_test_key';
  process.env.SYNC_SHARED_SECRET = 'top-secret';

  const mod = await import('../functions/SyncToLinear');
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
      linearIssueId: 'lin-123',
      hubspotStage: 'published',
      objectType: 'content',
      linearTeamId: 'team-1',
    },
  },
};

describe('SyncToLinear.main', () => {
  it('returns 200 and syncStatus "success" when everything works', async () => {
    const result = await main(baseCtx);
    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body.outputFields.syncStatus).toBe('success');
    expect(body.outputFields.linearStateName).toBe('Done');
  });

  it('calls updateLinearIssueState with the resolved state ID', async () => {
    const { updateLinearIssueState } = await import('@lib/linear-client');
    await main(baseCtx);
    expect(updateLinearIssueState).toHaveBeenCalledWith('lin_test_key', 'lin-123', 'st-done');
  });

  it('returns 400 for an unknown HubSpot stage', async () => {
    const ctx = {
      ...baseCtx,
      body: { ...baseCtx.body, inputFields: { ...baseCtx.body.inputFields, hubspotStage: 'unknown_stage' } },
    };
    const result = await main(ctx);
    expect(result.statusCode).toBe(400);
  });

  it('returns 404 when the Linear state name is not found in the team', async () => {
    const { findStateIdByName } = await import('@lib/linear-client');
    vi.mocked(findStateIdByName).mockResolvedValue(null);
    const result = await main(baseCtx);
    expect(result.statusCode).toBe(404);
  });

  it('returns 500 when LINEAR_API_KEY is missing', async () => {
    delete process.env.LINEAR_API_KEY;
    const result = await main(baseCtx);
    expect(result.statusCode).toBe(500);
  });

  it('returns 401 when the shared secret does not match', async () => {
    const { updateLinearIssueState } = await import('@lib/linear-client');
    const ctx = {
      ...baseCtx,
      body: { ...baseCtx.body, inputFields: { ...baseCtx.body.inputFields, sharedSecret: 'wrong-secret' } },
    };
    const result = await main(ctx);
    expect(result.statusCode).toBe(401);
    // Auth must run before any Linear work is attempted.
    expect(updateLinearIssueState).not.toHaveBeenCalled();
  });

  it('returns 401 when the shared secret is absent', async () => {
    const ctx = {
      ...baseCtx,
      body: { ...baseCtx.body, inputFields: { ...baseCtx.body.inputFields, sharedSecret: undefined } },
    };
    const result = await main(ctx);
    expect(result.statusCode).toBe(401);
  });

  it('returns 500 when SYNC_SHARED_SECRET is not configured', async () => {
    delete process.env.SYNC_SHARED_SECRET;
    const result = await main(baseCtx);
    expect(result.statusCode).toBe(500);
  });

  it('handles changelog objectType, mapping "reviewing" → "In Review"', async () => {
    const { findStateIdByName } = await import('@lib/linear-client');
    const ctx = {
      ...baseCtx,
      body: {
        ...baseCtx.body,
        inputFields: { ...baseCtx.body.inputFields, hubspotStage: 'reviewing', objectType: 'changelog' },
      },
    };
    await main(ctx);
    expect(findStateIdByName).toHaveBeenCalledWith('lin_test_key', 'team-1', 'In Review');
  });
});
