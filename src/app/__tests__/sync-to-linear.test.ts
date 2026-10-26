import { describe, it, expect, vi, beforeEach } from 'vitest';

let main: (ctx: any) => Promise<any>;

beforeEach(async () => {
  vi.clearAllMocks();
  vi.resetModules();

  vi.doMock('@lib/linear-client', () => ({
    findStateIdByName: vi.fn().mockResolvedValue('st-done'),
    getIssueWorkflow: vi.fn().mockResolvedValue({
      currentState: 'In Progress',
      states: [
        { id: 'st-backlog', name: 'Backlog', type: 'backlog' },
        { id: 'st-todo', name: 'Todo', type: 'unstarted' },
        { id: 'st-progress', name: 'In Progress', type: 'started' },
        { id: 'st-review', name: 'In Review', type: 'started' },
        { id: 'st-done', name: 'Done', type: 'completed' },
        { id: 'st-canceled', name: 'Canceled', type: 'canceled' },
      ],
    }),
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

  it("returns 200 with syncStatus \"skipped\" when the issue's team has no state by that name", async () => {
    // Was asked of the workflow's team until 2026-10-20; an existing issue's
    // states now come from the issue's own team.
    const { getIssueWorkflow } = await import('@lib/linear-client');
    vi.mocked(getIssueWorkflow).mockResolvedValue({ currentState: 'In Progress', states: [{ id: 'st-progress', name: 'In Progress', type: 'started' }] });
    const result = await main(baseCtx);
    expect(result.statusCode).toBe(200);
    expect(JSON.parse(result.body).outputFields).toMatchObject({ syncStatus: 'skipped', reason: 'state_not_found:Done' });
  });

  it("returns 200 skipped when creating and the configured team has no state by that name", async () => {
    // The create path still asks the workflow's team — a new issue has no team
    // of its own yet.
    const { findStateIdByName, createIssue } = await import('@lib/linear-client');
    vi.mocked(findStateIdByName).mockResolvedValue(null);
    const ctx = {
      ...baseCtx,
      body: { ...baseCtx.body, inputFields: { ...baseCtx.body.inputFields, linearIssueId: '', hubspotStage: 'outline' } },
    };
    const result = await main(ctx);
    expect(findStateIdByName).toHaveBeenCalledWith('lin_test_key', 'team-1', 'Todo');
    expect(JSON.parse(result.body).outputFields.syncStatus).toBe('skipped');
    expect(createIssue).not.toHaveBeenCalled();
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
    const { getIssueWorkflow, updateLinearIssueState } = await import('@lib/linear-client');
    const ctx = {
      ...baseCtx,
      body: {
        ...baseCtx.body,
        inputFields: { ...baseCtx.body.inputFields, hubspotStage: 'reviewing', objectType: 'changelog' },
      },
    };
    await main(ctx);
    // The existing issue's team decides — see the describe block below.
    expect(getIssueWorkflow).toHaveBeenCalledWith('lin_test_key', 'lin-123');
    expect(updateLinearIssueState).toHaveBeenCalledWith('lin_test_key', 'lin-123', 'st-review');
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

describe("SyncToLinear — the team comes from the issue, not the workflow", () => {
  // Prod's two sync workflows carry linearTeamId 'any' — the assignee-first
  // settings sentinel. Linear answers team(id: "any") with
  // "Entity not found: Team" (checked 2026-10-20), and that lookup used to run
  // first, unguarded, so every stage move threw.
  const anyTeam = (inputFields: Record<string, unknown> = {}) => ({
    ...baseCtx,
    body: { ...baseCtx.body, inputFields: { ...baseCtx.body.inputFields, linearTeamId: 'any', ...inputFields } },
  });

  it("updates an existing issue using its own team when the workflow says 'any'", async () => {
    const { findStateIdByName, getIssueWorkflow, updateLinearIssueState } = await import('@lib/linear-client');

    const result = await main(anyTeam());

    expect(getIssueWorkflow).toHaveBeenCalledWith('lin_test_key', 'lin-123');
    expect(findStateIdByName).not.toHaveBeenCalled();
    expect(updateLinearIssueState).toHaveBeenCalledWith('lin_test_key', 'lin-123', 'st-done');
    expect(JSON.parse(result.body).outputFields.syncStatus).toBe('success');
  });

  it("uses the issue's team even when the workflow names a different real one", async () => {
    // An issue moved to another team would otherwise be handed a state id
    // from the wrong team.
    const { findStateIdByName, getIssueWorkflow } = await import('@lib/linear-client');
    await main(baseCtx);
    expect(getIssueWorkflow).toHaveBeenCalledWith('lin_test_key', 'lin-123');
    expect(findStateIdByName).not.toHaveBeenCalled();
  });

  it("answers 200 skipped, not a 500, when Linear can't be asked about the issue", async () => {
    const { getIssueWorkflow, updateLinearIssueState } = await import('@lib/linear-client');
    vi.mocked(getIssueWorkflow).mockRejectedValue(new Error('Linear GraphQL error: Entity not found: Issue'));

    const result = await main(baseCtx);

    expect(result.statusCode).toBe(200);
    expect(JSON.parse(result.body).outputFields).toMatchObject({ syncStatus: 'skipped', reason: 'linear_lookup_failed' });
    expect(updateLinearIssueState).not.toHaveBeenCalled();
  });

  it("skips creating, rather than failing, when there is no issue and the team is 'any'", async () => {
    const { findStateIdByName, createIssue } = await import('@lib/linear-client');

    const result = await main(anyTeam({ linearIssueId: '', hubspotStage: 'outline', title: 'A promoted note' }));

    expect(result.statusCode).toBe(200);
    expect(JSON.parse(result.body).outputFields).toMatchObject({ syncStatus: 'skipped', reason: 'no_team_for_create' });
    expect(findStateIdByName).not.toHaveBeenCalled();
    expect(createIssue).not.toHaveBeenCalled();
  });

  it("still reports below-Outline before it ever looks at the team", async () => {
    const result = await main(anyTeam({ linearIssueId: '', hubspotStage: 'idea' }));
    expect(JSON.parse(result.body).outputFields.reason).toBe('below_outline:idea');
  });
});

describe('SyncToLinear — never bounce an issue Linear already has right', () => {
  // The changelog map is many-to-one: Backlog, Todo and Canceled all mean
  // `identified`, which maps back to Backlog alone. So an issue moved to Todo
  // or Canceled in Linear changed the HubSpot stage, fired this action, and was
  // pushed to Backlog — a cancelled issue reopened. Found on prod 2026-10-26.
  const changelogAt = (stage: string) => ({
    ...baseCtx,
    body: { ...baseCtx.body, inputFields: { ...baseCtx.body.inputFields, objectType: 'changelog', hubspotStage: stage } },
  });
  const contentAt = (stage: string) => ({
    ...baseCtx,
    body: { ...baseCtx.body, inputFields: { ...baseCtx.body.inputFields, objectType: 'content', hubspotStage: stage } },
  });
  async function linearSays(currentState: string) {
    const { getIssueWorkflow } = await import('@lib/linear-client');
    const base = await vi.mocked(getIssueWorkflow).getMockImplementation()?.('k', 'x');
    vi.mocked(getIssueWorkflow).mockResolvedValue({ ...(base as object), currentState } as never);
  }

  it.each(['Todo', 'Canceled', 'Backlog'])('leaves a changelog issue in %s alone when HubSpot says identified', async state => {
    await linearSays(state);
    const { updateLinearIssueState } = await import('@lib/linear-client');

    const result = await main(changelogAt('identified'));

    expect(updateLinearIssueState).not.toHaveBeenCalled();
    expect(JSON.parse(result.body).outputFields).toMatchObject({ syncStatus: 'skipped', reason: 'linear_already_agrees' });
  });

  it("never moves an issue out of a state the mapping doesn't know — DEVDOCS-73 was Duplicate", async () => {
    await linearSays('Duplicate');
    const { updateLinearIssueState } = await import('@lib/linear-client');

    const result = await main(contentAt('idea'));

    expect(updateLinearIssueState).not.toHaveBeenCalled();
    expect(JSON.parse(result.body).outputFields).toMatchObject({ syncStatus: 'skipped', reason: 'linear_state_unmapped:Duplicate' });
  });

  it('still moves the issue when HubSpot was moved somewhere Linear is not — the control', async () => {
    // Someone dragged the card back to Identified while Linear says In Progress:
    // that is a real instruction, and Backlog is what it means.
    await linearSays('In Progress');
    const { updateLinearIssueState } = await import('@lib/linear-client');

    await main(changelogAt('identified'));

    expect(updateLinearIssueState).toHaveBeenCalledWith('lin_test_key', 'lin-123', 'st-backlog');
  });

  it('still round-trips the content pipeline, which maps one-to-one', async () => {
    await linearSays('Backlog');
    const { updateLinearIssueState } = await import('@lib/linear-client');

    await main(contentAt('outline'));

    expect(updateLinearIssueState).toHaveBeenCalledWith('lin_test_key', 'lin-123', 'st-todo');
  });
});
