import { describe, it, expect, vi, beforeEach } from 'vitest';

let main: (ctx: any) => Promise<any>;

beforeEach(async () => {
  vi.clearAllMocks();
  vi.resetModules();

  vi.doMock('@lib/hmac', () => ({ verifyLinearSignature: vi.fn().mockReturnValue(true) }));
  vi.doMock('@lib/hubspot-client', () => ({
    createHubSpotClient: vi.fn(() => ({})),
    getCurrentStage: vi.fn().mockResolvedValue(null),
    upsertContent: vi.fn().mockResolvedValue({ id: 'hs-1', action: 'created' }),
    upsertChangelog: vi.fn().mockResolvedValue({ id: 'hs-2', action: 'created' }),
  }));
  vi.doMock('../lib/portal-config', () => ({
    PORTAL_CONFIG: {
      content: {
        objectTypeId: '2-content',
        pipelineId: 'pipe-1',
        stageIds: { idea: 'stage-idea', outline: 'stage-outline', drafting: 'stage-drafting', editing: 'stage-editing', review: 'stage-review', published: 'stage-published', archived: 'stage-archived' },
      },
      changelog: {
        objectTypeId: '2-changelog',
        pipelineId: 'pipe-2',
        stageIds: { identified: 'stage-identified', drafting: 'stage-drafting-cl', reviewing: 'stage-reviewing', published: 'stage-published-cl' },
      },
    },
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
      labels: { nodes: [] },
      url: 'https://linear.app/issue/ENG-1',
      team: { id: 't-1', name: 'Eng' },
    },
  },
};

describe('LinearWebhook.main', () => {
  it('returns 401 when signature is invalid', async () => {
    const { verifyLinearSignature: mockVerify } = await import('@lib/hmac');
    vi.mocked(mockVerify).mockReturnValue(false);
    const result = await main(baseCtx);
    expect(result.statusCode).toBe(401);
  });

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

  it('calls upsertChangelog for issues with the "changelog" label', async () => {
    const { upsertChangelog: mockUpsert } = await import('@lib/hubspot-client');
    const ctx = {
      ...baseCtx,
      body: {
        ...baseCtx.body,
        data: { ...baseCtx.body.data, labels: { nodes: [{ name: 'changelog' }] } },
      },
    };
    await main(ctx);
    expect(mockUpsert).toHaveBeenCalledOnce();
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
});
