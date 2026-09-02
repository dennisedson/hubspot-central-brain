import { describe, it, expect, vi, beforeEach } from 'vitest';

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
    readAppSettings: vi.fn().mockResolvedValue({ linearTeamId: '', assigneeFilter: 'all', linearAssigneeId: '' }),
  }));
  vi.doMock('@lib/portal-config', () => ({
    getPortalConfig: vi.fn().mockReturnValue(TEST_PORTAL_CONFIG),
    DEFAULT_APP_SETTINGS: { linearTeamId: '', assigneeFilter: 'all', linearAssigneeId: '' },
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
      vi.mocked(mockSettings).mockResolvedValue({ linearTeamId: '', assigneeFilter: 'assigned', linearAssigneeId: '' });
      const result = await main(baseCtx); // baseCtx has no assignee
      expect(result.statusCode).toBe(200);
      expect(JSON.parse(result.body).reason).toBe('no assignee');
      expect(mockUpsert).not.toHaveBeenCalled();
    });

    it('processes an assigned issue when filter is "assigned"', async () => {
      const { readAppSettings: mockSettings, upsertContent: mockUpsert } = await import('@lib/hubspot-client');
      vi.mocked(mockSettings).mockResolvedValue({ linearTeamId: '', assigneeFilter: 'assigned', linearAssigneeId: '' });
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
      vi.mocked(mockSettings).mockResolvedValue({ linearTeamId: '', assigneeFilter: 'mine', linearAssigneeId: 'user-me' });
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
      vi.mocked(mockSettings).mockResolvedValue({ linearTeamId: '', assigneeFilter: 'mine', linearAssigneeId: 'user-me' });
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
