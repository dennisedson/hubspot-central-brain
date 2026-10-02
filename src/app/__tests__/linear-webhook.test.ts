import { describe, it, expect, vi, beforeEach } from 'vitest';
import { isConfigured, DEFAULT_APP_SETTINGS } from '@lib/portal-config';
import { classifyIssue, parseProjectMap } from '@lib/mapping';

let main: (ctx: any) => Promise<any>;

const TEST_PORTAL_CONFIG = {
  content: {
    objectTypeId: '2-content',
    pipelines: {
      content: {
        pipelineId: 'pipe-1',
        stageIds: { idea: 'stage-idea', outline: 'stage-outline', drafting: 'stage-drafting', editing: 'stage-editing', review: 'stage-review', published: 'stage-published', archived: 'stage-archived' },
      },
      changelog: {
        pipelineId: 'pipe-2',
        stageIds: { identified: 'stage-identified', drafting: 'stage-drafting-cl', reviewing: 'stage-reviewing', published: 'stage-published-cl' },
      },
    },
  },
  video: { objectTypeId: '2-video', pipelineId: 'pipe-3', stageIds: { draft: 'draft', scheduled: 'scheduled', public: 'public' } },
  appConfig: { objectTypeId: '2-app' },
};

beforeEach(async () => {
  vi.clearAllMocks();
  vi.resetModules();

  vi.doMock('@lib/hubspot-client', () => ({
    getCurrentStage: vi.fn().mockResolvedValue(null),
    upsertContent: vi.fn().mockResolvedValue({ id: 'hs-1', action: 'created' }),
    archiveContentByLinearId: vi.fn().mockResolvedValue({ id: 'hs-arch', action: 'updated' }),
    readAppSettings: vi.fn().mockResolvedValue({ linearTeamId: 't-1', assigneeFilter: 'all', linearAssigneeId: '' }),
    // Empty by default: classification falls back to the label, which is what
    // the rest of this file was written against.
    readProjectState: vi.fn().mockResolvedValue({ recordId: 'cfg-1', map: {}, unmapped: [] }),
    recordUnmappedProject: vi.fn().mockResolvedValue(undefined),
    refreshDerivedProperties: vi.fn().mockResolvedValue(undefined),
  }));
  vi.doMock('@lib/portal-config', async () => ({
    ...(await vi.importActual<typeof import('@lib/portal-config')>('@lib/portal-config')),
    getPortalConfig: vi.fn().mockReturnValue(TEST_PORTAL_CONFIG),
  }));

  process.env.LINEAR_WEBHOOK_SECRET = 'test-secret';

  const mod = await import('../functions/LinearWebhook');
  main = mod.main;
});

const baseCtx = {
  method: 'POST',
  headers: { 'linear-signature': 'abc123' },
  query: {},
  accountId: 999,
  body: {
    action: 'create',
    type: 'Issue',
    organizationId: 'org-1',
    webhookTimestamp: 1000,
    webhookId: 'wh-1',
    data: {
      id: 'lin-1',
      identifier: 'ENG-1',
      title: 'Improve docs',
      state: { id: 'st-1', name: 'Backlog', type: 'backlog' },
      labels: [],
      url: 'https://linear.app/issue/ENG-1',
      team: { id: 't-1', name: 'Eng' },
    },
  },
};

describe('LinearWebhook.main', () => {
  it('skips non-Issue events and returns 200', async () => {
    const ctx = { ...baseCtx, body: { ...baseCtx.body, type: 'Comment' } };
    const result = await main(ctx);
    expect(result.statusCode).toBe(200);
    expect(JSON.parse(result.body).skipped).toBe(true);
  });

  it('calls upsertContent for issues without the changelog label', async () => {
    const { upsertContent: mockUpsert } = await import('@lib/hubspot-client');
    await main(baseCtx);
    expect(mockUpsert).toHaveBeenCalledOnce();
  });

  it('calls upsertContent with pipelineKey "changelog" for issues with the "changelog" label', async () => {
    const { upsertContent: mockUpsert } = await import('@lib/hubspot-client');
    const ctx = {
      ...baseCtx,
      body: {
        ...baseCtx.body,
        data: { ...baseCtx.body.data, labels: [{ id: 'lbl-1', name: 'changelog' }] },
      },
    };
    await main(ctx);
    expect(mockUpsert).toHaveBeenCalledWith(expect.anything(), expect.anything(), 'changelog');
  });

  it('returns 200 and ok:true on success', async () => {
    const result = await main(baseCtx);
    expect(result.statusCode).toBe(200);
    expect(JSON.parse(result.body).ok).toBe(true);
  });

  it('skips when incoming Linear state already matches the current HubSpot stage (echo prevention)', async () => {
    const { getCurrentStage: mockGetStage } = await import('@lib/hubspot-client');
    // baseCtx state is 'Backlog' → maps to 'idea' → stageId 'stage-idea' in the mock config
    vi.mocked(mockGetStage).mockResolvedValue('stage-idea');
    const result = await main(baseCtx);
    expect(result.statusCode).toBe(200);
    expect(JSON.parse(result.body).reason).toBe('stage already matches');
  });

  it('still refreshes the derived properties when the stage write is skipped', async () => {
    // The guard protects the STAGE. The description may still have changed —
    // a rollout date added, moved or removed — while the issue sat in the same
    // state throughout. Returning outright meant adding a date to an existing
    // issue produced no write at all.
    const { getCurrentStage: mockGetStage, refreshDerivedProperties: mockRefresh, upsertContent: mockUpsert } =
      await import('@lib/hubspot-client');
    vi.mocked(mockGetStage).mockResolvedValue('stage-idea');

    const ctx = {
      ...baseCtx,
      body: {
        ...baseCtx.body,
        data: { ...baseCtx.body.data, description: '### Timeline\n\n**Live Date:** 2099-01-01' },
      },
    };
    const result = await main(ctx);

    expect(result.statusCode).toBe(200);
    expect(JSON.parse(result.body).refreshed).toBe(true);
    expect(mockRefresh).toHaveBeenCalledWith(
      expect.any(String),
      ctx.body.data.id,
      '### Timeline\n\n**Live Date:** 2099-01-01',
    );
    // And the stage itself is still left alone.
    expect(mockUpsert).not.toHaveBeenCalled();
  });

  it('skips overwrite when the current HubSpot stage shares the incoming Linear state bucket (editing/drafting)', async () => {
    const { getCurrentStage: mockGetStage, upsertContent: mockUpsertContent } =
      await import('@lib/hubspot-client');
    // Incoming Linear state is 'In Progress'; the record is already in the content 'editing' stage,
    // which maps forward to 'In Progress' too. This must NOT be overwritten to 'drafting'.
    vi.mocked(mockGetStage).mockResolvedValue('stage-editing');
    const ctx = {
      ...baseCtx,
      body: {
        ...baseCtx.body,
        data: { ...baseCtx.body.data, state: { id: 'st-2', name: 'In Progress', type: 'started' } },
      },
    };
    const result = await main(ctx);
    expect(result.statusCode).toBe(200);
    expect(JSON.parse(result.body).skipped).toBe(true);
    expect(JSON.parse(result.body).reason).toBe('stage already matches');
    expect(mockUpsertContent).not.toHaveBeenCalled();
  });

  it('archives the linked content record on a Linear "remove" action', async () => {
    const { archiveContentByLinearId: mockArchive, upsertContent: mockUpsert } = await import('@lib/hubspot-client');
    const ctx = { ...baseCtx, body: { ...baseCtx.body, action: 'remove' } };
    const result = await main(ctx);
    expect(mockArchive).toHaveBeenCalledWith('lin-1', expect.anything());
    expect(result.statusCode).toBe(200);
    expect(JSON.parse(result.body).action).toBe('archived');
    expect(mockUpsert).not.toHaveBeenCalled();
  });

  it('returns "no matching record" when a "remove" targets an unknown content issue', async () => {
    const { archiveContentByLinearId: mockArchive } = await import('@lib/hubspot-client');
    vi.mocked(mockArchive).mockResolvedValue(null);
    const ctx = { ...baseCtx, body: { ...baseCtx.body, action: 'remove' } };
    const result = await main(ctx);
    expect(result.statusCode).toBe(200);
    expect(JSON.parse(result.body).reason).toBe('remove: no matching record');
  });

  it('skips (does not archive) a "remove" on a changelog-labeled issue', async () => {
    const { archiveContentByLinearId: mockArchive } = await import('@lib/hubspot-client');
    const ctx = {
      ...baseCtx,
      body: {
        ...baseCtx.body,
        action: 'remove',
        data: { ...baseCtx.body.data, labels: [{ id: 'lbl-1', name: 'changelog' }] },
      },
    };
    const result = await main(ctx);
    expect(result.statusCode).toBe(200);
    expect(JSON.parse(result.body).reason).toBe('changelog remove not archived (no archive stage)');
    expect(mockArchive).not.toHaveBeenCalled();
  });

  it('returns 500 when getCurrentStage throws', async () => {
    const { getCurrentStage: mockGetStage } = await import('@lib/hubspot-client');
    vi.mocked(mockGetStage).mockRejectedValue(new Error('search API down'));
    const result = await main(baseCtx);
    expect(result.statusCode).toBe(500);
  });

  it('returns 500 when LINEAR_WEBHOOK_SECRET is missing', async () => {
    delete process.env.LINEAR_WEBHOOK_SECRET;
    const result = await main(baseCtx);
    expect(result.statusCode).toBe(500);
  });

  it('returns 500 when upsert throws', async () => {
    const { upsertContent: mockUpsert } = await import('@lib/hubspot-client');
    vi.mocked(mockUpsert).mockRejectedValue(new Error('API down'));
    const result = await main(baseCtx);
    expect(result.statusCode).toBe(500);
  });

  describe('team filter', () => {
    it('skips when linearTeamId is set and the issue team does not match', async () => {
      const { readAppSettings: mockSettings, upsertContent: mockUpsert } = await import('@lib/hubspot-client');
      vi.mocked(mockSettings).mockResolvedValue({ linearTeamId: 'team-A', assigneeFilter: 'all', linearAssigneeId: '' });
      const result = await main(baseCtx); // baseCtx.body.data.team.id = 't-1'
      expect(result.statusCode).toBe(200);
      expect(JSON.parse(result.body).reason).toBe('not configured team');
      expect(mockUpsert).not.toHaveBeenCalled();
    });

    it('processes the issue when linearTeamId matches', async () => {
      const { readAppSettings: mockSettings, upsertContent: mockUpsert } = await import('@lib/hubspot-client');
      vi.mocked(mockSettings).mockResolvedValue({ linearTeamId: 't-1', assigneeFilter: 'all', linearAssigneeId: '' });
      const result = await main(baseCtx);
      expect(result.statusCode).toBe(200);
      expect(JSON.parse(result.body).ok).toBe(true);
      expect(mockUpsert).toHaveBeenCalledOnce();
    });
  });

  describe('assignee filter', () => {
    it('skips unassigned issues when filter is "assigned"', async () => {
      const { readAppSettings: mockSettings, upsertContent: mockUpsert } = await import('@lib/hubspot-client');
      vi.mocked(mockSettings).mockResolvedValue({ linearTeamId: 't-1', assigneeFilter: 'assigned', linearAssigneeId: '' });
      const result = await main(baseCtx); // baseCtx has no assignee
      expect(result.statusCode).toBe(200);
      expect(JSON.parse(result.body).reason).toBe('no assignee');
      expect(mockUpsert).not.toHaveBeenCalled();
    });

    it('processes an assigned issue when filter is "assigned"', async () => {
      const { readAppSettings: mockSettings, upsertContent: mockUpsert } = await import('@lib/hubspot-client');
      vi.mocked(mockSettings).mockResolvedValue({ linearTeamId: 't-1', assigneeFilter: 'assigned', linearAssigneeId: '' });
      const ctx = {
        ...baseCtx,
        body: { ...baseCtx.body, data: { ...baseCtx.body.data, assignee: { id: 'user-1', name: 'Alice' } } },
      };
      const result = await main(ctx);
      expect(result.statusCode).toBe(200);
      expect(JSON.parse(result.body).ok).toBe(true);
      expect(mockUpsert).toHaveBeenCalledOnce();
    });

    it('skips issues assigned to someone else when filter is "mine"', async () => {
      const { readAppSettings: mockSettings, upsertContent: mockUpsert } = await import('@lib/hubspot-client');
      vi.mocked(mockSettings).mockResolvedValue({ linearTeamId: 't-1', assigneeFilter: 'mine', linearAssigneeId: 'user-me' });
      const ctx = {
        ...baseCtx,
        body: { ...baseCtx.body, data: { ...baseCtx.body.data, assignee: { id: 'user-other', name: 'Bob' } } },
      };
      const result = await main(ctx);
      expect(result.statusCode).toBe(200);
      expect(JSON.parse(result.body).reason).toBe('not assigned to configured user');
      expect(mockUpsert).not.toHaveBeenCalled();
    });

    it('processes an issue assigned to the configured user when filter is "mine"', async () => {
      const { readAppSettings: mockSettings, upsertContent: mockUpsert } = await import('@lib/hubspot-client');
      vi.mocked(mockSettings).mockResolvedValue({ linearTeamId: 't-1', assigneeFilter: 'mine', linearAssigneeId: 'user-me' });
      const ctx = {
        ...baseCtx,
        body: { ...baseCtx.body, data: { ...baseCtx.body.data, assignee: { id: 'user-me', name: 'Me' } } },
      };
      const result = await main(ctx);
      expect(result.statusCode).toBe(200);
      expect(JSON.parse(result.body).ok).toBe(true);
      expect(mockUpsert).toHaveBeenCalledOnce();
    });
  });
});

describe('LinearWebhook — unassignment archives the HubSpot record', () => {
  /**
   * Previously an excluded issue was skipped outright, which left the record
   * frozen at its last synced stage: sitting in the pipeline, looking live, no
   * longer tracking anything, and returning 200 throughout. Archiving makes the
   * divergence visible. Reassignment restores it through the normal upsert,
   * which writes the mapped stage and lifts it back out of Archived.
   */
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('archives the record when the assignee no longer matches "mine"', async () => {
    const { readAppSettings: mockSettings, archiveContentByLinearId: mockArchive, upsertContent: mockUpsert } =
      await import('@lib/hubspot-client');
    vi.mocked(mockSettings).mockResolvedValue({ linearTeamId: 't-1', assigneeFilter: 'mine', linearAssigneeId: 'user-me' });
    vi.mocked(mockArchive).mockResolvedValue({ id: '123', action: 'updated' });

    const ctx = {
      ...baseCtx,
      body: { ...baseCtx.body, data: { ...baseCtx.body.data, assignee: { id: 'user-other', name: 'Bob' } } },
    };
    const result = await main(ctx);
    const body = JSON.parse(result.body);

    expect(result.statusCode).toBe(200);
    expect(body.action).toBe('archived');
    expect(body.reason).toBe('not assigned to configured user');
    expect(mockArchive).toHaveBeenCalledOnce();
    expect(mockUpsert).not.toHaveBeenCalled();
  });

  it('archives when the issue is unassigned entirely under "assigned"', async () => {
    const { readAppSettings: mockSettings, archiveContentByLinearId: mockArchive } =
      await import('@lib/hubspot-client');
    vi.mocked(mockSettings).mockResolvedValue({ linearTeamId: 't-1', assigneeFilter: 'assigned', linearAssigneeId: '' });
    vi.mocked(mockArchive).mockResolvedValue({ id: '123', action: 'updated' });

    const body = JSON.parse((await main(baseCtx)).body); // baseCtx has no assignee
    expect(body.action).toBe('archived');
    expect(body.reason).toBe('no assignee');
  });

  it('does not archive an issue nothing ever tracked', async () => {
    // No record means nothing to set aside — this must stay a quiet skip rather
    // than becoming noise on every issue assigned to someone else.
    const { readAppSettings: mockSettings, archiveContentByLinearId: mockArchive } =
      await import('@lib/hubspot-client');
    vi.mocked(mockSettings).mockResolvedValue({ linearTeamId: 't-1', assigneeFilter: 'mine', linearAssigneeId: 'user-me' });
    vi.mocked(mockArchive).mockResolvedValue(null);

    const ctx = {
      ...baseCtx,
      body: { ...baseCtx.body, data: { ...baseCtx.body.data, assignee: { id: 'user-other', name: 'Bob' } } },
    };
    const body = JSON.parse((await main(ctx)).body);
    expect(body.skipped).toBe(true);
    expect(body.action).toBeUndefined();
  });

  it('reassignment goes through the normal upsert, which un-archives it', async () => {
    const { readAppSettings: mockSettings, archiveContentByLinearId: mockArchive, upsertContent: mockUpsert } =
      await import('@lib/hubspot-client');
    vi.mocked(mockSettings).mockResolvedValue({ linearTeamId: 't-1', assigneeFilter: 'mine', linearAssigneeId: 'user-me' });

    const ctx = {
      ...baseCtx,
      body: { ...baseCtx.body, data: { ...baseCtx.body.data, assignee: { id: 'user-me', name: 'Me' } } },
    };
    const result = await main(ctx);

    expect(JSON.parse(result.body).ok).toBe(true);
    expect(mockArchive).not.toHaveBeenCalled();
    // upsertContent writes the stage mapped from the Linear state, which is what
    // moves the record back out of Archived.
    expect(mockUpsert).toHaveBeenCalledOnce();
  });
});

describe('LinearWebhook — refuses to sync an unconfigured portal', () => {
  /**
   * The defaults are permissive: an empty linearTeamId skipped the team filter
   * entirely and assigneeFilter 'all' excludes nobody, so the portal that
   * should sync nothing synced everything.
   *
   * On 2026-09-29 production had its Linear webhook registered before its
   * settings were saved, and 34 Content Pieces arrived from teams nobody had
   * chosen, against live data. These pin the gate that stops it.
   */

  it('refuses when no team has been chosen', () => {
    expect(isConfigured({ linearTeamId: '', assigneeFilter: 'all', linearAssigneeId: '' })).toBe(false);
  });

  it('refuses "mine" with nobody named — it would match every issue', () => {
    expect(
      isConfigured({ linearTeamId: 'team-1', assigneeFilter: 'mine', linearAssigneeId: '' }),
    ).toBe(false);
  });

  it('accepts "assigned" without a person, since it means anyone', () => {
    expect(
      isConfigured({ linearTeamId: 'team-1', assigneeFilter: 'assigned', linearAssigneeId: '' }),
    ).toBe(true);
  });

  it('accepts a fully answered configuration', () => {
    expect(
      isConfigured({ linearTeamId: 'team-1', assigneeFilter: 'mine', linearAssigneeId: 'user-1' }),
    ).toBe(true);
  });

  it('accepts "mine" with a person and NO team — the point of the change', () => {
    // "Issues assigned to me, wherever they live." A team-scoped filter stops
    // covering someone's work the day they join another team, silently.
    // Measured on production: 83 issues across four teams, 75 outside the one
    // configured team.
    expect(
      isConfigured({ linearTeamId: '', assigneeFilter: 'mine', linearAssigneeId: 'user-1' }),
    ).toBe(true);
  });

  it('still refuses no team with no named person', () => {
    // 'all' and 'assigned' are bounded only by the team. Without one they
    // accept the entire workspace.
    expect(isConfigured({ linearTeamId: '', assigneeFilter: 'all', linearAssigneeId: '' })).toBe(false);
    expect(isConfigured({ linearTeamId: '', assigneeFilter: 'assigned', linearAssigneeId: '' })).toBe(false);
  });

  it('the shipped defaults are NOT configured', () => {
    // The whole point. If this ever passes, an unconfigured portal syncs again.
    expect(isConfigured(DEFAULT_APP_SETTINGS)).toBe(false);
  });
});

describe('LinearWebhook — routing live issues by project', () => {
  /**
   * The import honoured the project map before the webhook did, which made the
   * map half a feature: history filed correctly, everything arriving after it
   * classified by a label this workspace has never used.
   */

  it('files an issue by its project, not its labels', async () => {
    const { readProjectState, upsertContent: mockUpsert } = await import('@lib/hubspot-client');
    vi.mocked(readProjectState).mockResolvedValue({ recordId: 'cfg-1', map: { 'proj-1': 'changelog' }, unmapped: [] });

    await main({
      ...baseCtx,
      body: { ...baseCtx.body, data: { ...baseCtx.body.data, project: { id: 'proj-1', name: 'Rollouts' } } },
    } as unknown as typeof baseCtx);

    expect(mockUpsert).toHaveBeenCalledWith(expect.anything(), expect.anything(), 'changelog');
  });

  it('writes nothing at all for a project mapped to ignore', async () => {
    // Not "files it somewhere harmless" — an ignored project is work that does
    // not belong in the pipeline, so nothing should be created or updated.
    const { readProjectState, upsertContent: mockUpsert } = await import('@lib/hubspot-client');
    vi.mocked(readProjectState).mockResolvedValue({ recordId: 'cfg-1', map: { 'proj-1': 'ignore' }, unmapped: [] });

    const res = await main({
      ...baseCtx,
      body: { ...baseCtx.body, data: { ...baseCtx.body.data, project: { id: 'proj-1', name: 'Chores' } } },
    } as unknown as typeof baseCtx);

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).reason).toContain('ignore');
    expect(mockUpsert).not.toHaveBeenCalled();
  });

  it('falls back to the label when the project is unmapped', async () => {
    const { readProjectState, upsertContent: mockUpsert } = await import('@lib/hubspot-client');
    vi.mocked(readProjectState).mockResolvedValue({ recordId: 'cfg-1', map: { other: 'ignore' }, unmapped: [] });

    await main(baseCtx);
    expect(mockUpsert).toHaveBeenCalled();
  });
});

describe('classifyIssue — the project map', () => {
  /**
   * Classification used to read labels only. On the production workspace that
   * was wrong for 69 of 83 issues: they are changelogs by project, and not one
   * issue in the workspace carries the changelog label.
   */

  it('the map decides, over the label', () => {
    expect(classifyIssue([{ name: 'changelog' }], 'p1', { p1: 'content' })).toBe('content');
    expect(classifyIssue([], 'p1', { p1: 'changelog' })).toBe('changelog');
  });

  it('falls back to the label when the project is unmapped', () => {
    // Keeps portals working that predate the map — dev classifies by label.
    expect(classifyIssue([{ name: 'changelog' }], 'unmapped', {})).toBe('changelog');
    expect(classifyIssue([{ name: 'changelog' }], null, {})).toBe('changelog');
  });

  it('defaults an unmapped, unlabelled issue to content', () => {
    // Not 'ignore': silently dropping issues looks like a broken sync, while
    // filing them in the obvious place is visible and fixable.
    expect(classifyIssue([], 'unmapped', {})).toBe('content');
    expect(classifyIssue([], null, {})).toBe('content');
  });

  it('honours ignore', () => {
    expect(classifyIssue([{ name: 'changelog' }], 'p1', { p1: 'ignore' })).toBe('ignore');
  });
});

describe('parseProjectMap — it must never throw', () => {
  it('survives anything an operator can put in a text property', () => {
    // A broken map must not take the sync down; it degrades to label-only.
    expect(parseProjectMap(null)).toEqual({});
    expect(parseProjectMap('')).toEqual({});
    expect(parseProjectMap('not json')).toEqual({});
    expect(parseProjectMap('[1,2,3]')).toEqual({});
    expect(parseProjectMap('"a string"')).toEqual({});
  });

  it('drops entries whose value is not a known kind', () => {
    expect(parseProjectMap('{"a":"content","b":"nonsense","c":"ignore"}'))
      .toEqual({ a: 'content', c: 'ignore' });
  });
})

describe('LinearWebhook — noticing a project nobody has mapped', () => {
  /**
   * An unmapped project defaults to content, deliberately — silently dropping
   * issues is worse than filing them somewhere visible. But a silent default
   * with no prompt is how you end up with records in the wrong place and no
   * idea when it started. This is the prompt.
   */

  function ctxWithProject(id: string, name: string) {
    return {
      ...baseCtx,
      body: { ...baseCtx.body, data: { ...baseCtx.body.data, project: { id, name } } },
    } as unknown as typeof baseCtx;
  }

  it('records a project it has never seen', async () => {
    const { readProjectState, recordUnmappedProject } = await import('@lib/hubspot-client');
    vi.mocked(readProjectState).mockResolvedValue({ recordId: 'cfg-1', map: {}, unmapped: [] });

    await main(ctxWithProject('p-new', 'Q3 Docs'));

    expect(recordUnmappedProject).toHaveBeenCalledWith(
      expect.anything(), 'cfg-1', [], { id: 'p-new', name: 'Q3 Docs' },
    );
  });

  it('does not record a project that is already mapped', async () => {
    const { readProjectState, recordUnmappedProject } = await import('@lib/hubspot-client');
    vi.mocked(readProjectState).mockResolvedValue({
      recordId: 'cfg-1', map: { 'p-known': 'changelog' }, unmapped: [],
    });

    await main(ctxWithProject('p-known', 'Rollouts'));
    expect(recordUnmappedProject).not.toHaveBeenCalled();
  });

  it('does not record the same project twice', async () => {
    // Otherwise every issue from an unmapped project is another write, and the
    // banner lists the same name repeatedly.
    const { readProjectState, recordUnmappedProject } = await import('@lib/hubspot-client');
    vi.mocked(readProjectState).mockResolvedValue({
      recordId: 'cfg-1', map: {}, unmapped: [{ id: 'p-seen', name: 'Already Noticed' }],
    });

    await main(ctxWithProject('p-seen', 'Already Noticed'));
    expect(recordUnmappedProject).not.toHaveBeenCalled();
  });

  it('still syncs the issue — noticing must not cost the record', async () => {
    const { readProjectState, upsertContent: mockUpsert } = await import('@lib/hubspot-client');
    vi.mocked(readProjectState).mockResolvedValue({ recordId: 'cfg-1', map: {}, unmapped: [] });

    await main(ctxWithProject('p-new', 'Q3 Docs'));
    expect(mockUpsert).toHaveBeenCalled();
  });
});
