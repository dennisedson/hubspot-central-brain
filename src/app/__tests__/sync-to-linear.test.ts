import { describe, it, expect, vi, beforeEach } from 'vitest';

let main: (ctx: any) => Promise<any>;

beforeEach(async () => {
  vi.clearAllMocks();
  vi.resetModules();

  vi.doMock('@lib/linear-client', () => ({
    findStateIdByName: vi.fn().mockResolvedValue('st-done'),
    updateLinearIssueState: vi.fn().mockResolvedValue(undefined),
    createIssue: vi.fn().mockResolvedValue({
      id: 'lin-new',
      identifier: 'ENG-9',
      url: 'https://linear.app/team/issue/ENG-9',
    }),
  }));

  vi.doMock('@lib/hubspot-client', () => ({
    hsUpdate: vi.fn().mockResolvedValue(undefined),
  }));

  vi.doMock('@lib/portal-config', () => ({
    getPortalConfig: vi.fn().mockReturnValue({
      appConfig: { objectTypeId: '2-test' },
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

  it('returns 200 with syncStatus "skipped" for an unknown HubSpot stage', async () => {
    const ctx = {
      ...baseCtx,
      body: { ...baseCtx.body, inputFields: { ...baseCtx.body.inputFields, hubspotStage: 'unknown_stage' } },
    };
    const result = await main(ctx);
    expect(result.statusCode).toBe(200);
    expect(JSON.parse(result.body).outputFields.syncStatus).toBe('skipped');
  });

  it('returns 200 with syncStatus "skipped" when the Linear state name is not found in the team', async () => {
    const { findStateIdByName } = await import('@lib/linear-client');
    vi.mocked(findStateIdByName).mockResolvedValue(null);
    const result = await main(baseCtx);
    expect(result.statusCode).toBe(200);
    expect(JSON.parse(result.body).outputFields.syncStatus).toBe('skipped');
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

/**
 * The create path — a record promoted from the Obsidian vault.
 *
 * Such a record has no linear_issue_id, because no Linear issue exists yet. The
 * vault is the idea stage; ticking `promote` on a note lands the record straight
 * at Outline, and Outline is the threshold at which work becomes real enough to
 * deserve an issue.
 */
describe('SyncToLinear.main — no linear issue yet', () => {
  function ctxAt(stage: string, overrides: Record<string, unknown> = {}) {
    return {
      ...baseCtx,
      body: {
        ...baseCtx.body,
        inputFields: {
          ...baseCtx.body.inputFields,
          linearIssueId: '',
          hubspotStage: stage,
          title: 'Promoted from the vault',
          objectId: 'hs-456',
          ...overrides,
        },
      },
    };
  }

  it('creates the issue when the record has reached Outline', async () => {
    const { createIssue } = await import('@lib/linear-client');
    const result = await main(ctxAt('outline'));
    expect(result.statusCode).toBe(200);
    expect(JSON.parse(result.body).outputFields.syncStatus).toBe('created');
    expect(createIssue).toHaveBeenCalledWith('lin_test_key', expect.objectContaining({
      teamId: 'team-1',
      title: 'Promoted from the vault',
      stateId: 'st-done',
    }));
  });

  // WHY THIS IS THE MOST IMPORTANT TEST IN THIS FILE.
  //
  // The branch above is chosen because linear_issue_id is empty. If the id we
  // just created is never written back, the property stays empty — so the NEXT
  // stage change takes the same branch and creates another issue, and the one
  // after that another. One issue per stage move, forever, with the record
  // looking healthy throughout and every response a 200.
  //
  // This is the failure docs/TEST-PLAN.md 2.1 records for asana_task_url, with
  // one difference: Asana can recover by searching for the task by Linear URL.
  // Linear has no such search here. Nothing repairs it after the fact.
  it('writes the new issue id and url back onto the HubSpot record', async () => {
    const { hsUpdate } = await import('@lib/hubspot-client');
    await main(ctxAt('outline'));
    expect(hsUpdate).toHaveBeenCalledWith('2-content', 'hs-456', {
      linear_id: 'lin-new',
      linear_issue_id: 'lin-new',
      linear_issue_url: 'https://linear.app/team/issue/ENG-9',
    });
  });

  // linear_id is the unique property LinearWebhook upserts on. Writing it here
  // means that if anyone ever strips the [hs-sync] tag out of the issue
  // description, the next inbound webhook updates THIS record rather than
  // creating a rival one.
  it('writes linear_id, not only the display properties', async () => {
    const { hsUpdate } = await import('@lib/hubspot-client');
    await main(ctxAt('outline'));
    const written = vi.mocked(hsUpdate).mock.calls[0][2];
    expect(written).toHaveProperty('linear_id', 'lin-new');
  });

  it.each(['drafting', 'editing', 'review', 'published'])(
    'also creates at %s — anything past Outline is past the threshold',
    async stage => {
      const { createIssue } = await import('@lib/linear-client');
      const result = await main(ctxAt(stage));
      expect(JSON.parse(result.body).outputFields.syncStatus).toBe('created');
      expect(createIssue).toHaveBeenCalled();
    },
  );

  // Rule 1 of the design: ideas never leave the vault. A record sitting at Idea
  // with no issue is not a broken link, it is a decision nobody has made yet.
  it('creates nothing at Idea', async () => {
    const { createIssue } = await import('@lib/linear-client');
    const result = await main(ctxAt('idea'));
    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body);
    expect(body.outputFields.syncStatus).toBe('skipped');
    expect(body.outputFields.reason).toBe('below_outline:idea');
    expect(createIssue).not.toHaveBeenCalled();
  });

  // Archived is not "past Outline", it is off to the side. Work that arrived
  // already dead does not need an issue opened for it.
  it('creates nothing at Archived', async () => {
    const { createIssue } = await import('@lib/linear-client');
    const body = JSON.parse((await main(ctxAt('archived'))).body);
    expect(body.outputFields.syncStatus).toBe('skipped');
    expect(createIssue).not.toHaveBeenCalled();
  });

  // Changelog records are born from a Linear issue that already exists, so an
  // unlinked one is a symptom, not a request. Creating issues here would be a
  // policy nobody agreed to — and the changelog pipeline has no Outline stage
  // to hang the threshold on.
  it('never creates for a changelog record, even at a mapped stage', async () => {
    const { createIssue } = await import('@lib/linear-client');
    const ctx = ctxAt('drafting', { objectType: 'changelog' });
    const body = JSON.parse((await main(ctx)).body);
    expect(body.outputFields.syncStatus).toBe('skipped');
    expect(body.outputFields.reason).toBe('no_issue_id_changelog');
    expect(createIssue).not.toHaveBeenCalled();
  });

  it('updates rather than creates once the id is present', async () => {
    const { createIssue, updateLinearIssueState } = await import('@lib/linear-client');
    await main(baseCtx);
    expect(updateLinearIssueState).toHaveBeenCalled();
    expect(createIssue).not.toHaveBeenCalled();
  });

  // A failed write-back must not report plain success. The issue exists and the
  // record does not know it — the next run will create a duplicate, and a
  // 'success' here is the last chance anyone has to notice before it does.
  it('reports created_unlinked when the write-back fails', async () => {
    const { hsUpdate } = await import('@lib/hubspot-client');
    vi.mocked(hsUpdate).mockRejectedValueOnce(new Error('403 Forbidden'));
    const body = JSON.parse((await main(ctxAt('outline'))).body);
    expect(body.outputFields.syncStatus).toBe('created_unlinked');
    // The id is still reported, so the link can be repaired by hand.
    expect(body.outputFields.linearIssueId).toBe('lin-new');
  });

  it('reports created_unlinked when there is no record id to write to', async () => {
    const ctx = ctxAt('outline', { objectId: '' });
    const body = JSON.parse((await main({ ...ctx, body: { ...ctx.body, hs_object_id: '' } })).body);
    expect(body.outputFields.syncStatus).toBe('created_unlinked');
  });

  // The workflow action carries objectId explicitly, but the runtime also puts
  // the enrolled record at the top of the body. Either is enough to link.
  it('falls back to hs_object_id when objectId is absent', async () => {
    const { hsUpdate } = await import('@lib/hubspot-client');
    const ctx = ctxAt('outline', { objectId: undefined });
    await main(ctx);
    expect(hsUpdate).toHaveBeenCalledWith('2-content', 'hs-456', expect.anything());
  });

  it('does not write anything back when the create itself fails', async () => {
    const { createIssue } = await import('@lib/linear-client');
    const { hsUpdate } = await import('@lib/hubspot-client');
    vi.mocked(createIssue).mockRejectedValueOnce(new Error('Linear down'));
    const body = JSON.parse((await main(ctxAt('outline'))).body);
    expect(body.outputFields.syncStatus).toBe('skipped');
    expect(body.outputFields.reason).toBe('linear_create_failed');
    expect(hsUpdate).not.toHaveBeenCalled();
  });

  it('falls back to a placeholder title rather than creating an issue named "undefined"', async () => {
    const { createIssue } = await import('@lib/linear-client');
    await main(ctxAt('outline', { title: '' }));
    expect(createIssue).toHaveBeenCalledWith('lin_test_key', expect.objectContaining({ title: 'Untitled' }));
  });
});
