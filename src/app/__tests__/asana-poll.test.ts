import { describe, it, expect, vi, beforeEach } from 'vitest';

const TEST_PORTAL_ID = 51869810;

const TEST_CONFIG = {
  appConfig: { objectTypeId: '2-app' },
  asanaProjectGid: 'proj-gid',
  asanaWorkspaceGid: 'ws-gid',
  asanaSections: { content: 'sec-content', changelog: 'sec-changelog' },
  content: {
    objectTypeId: '2-content',
    pipelines: {
      content: {
        pipelineId: 'pipe-content',
        stageIds: {
          idea: 'idea-id', outline: 'outline-id', drafting: 'drafting-id',
          editing: 'editing-id', review: 'review-id', published: 'published-id', archived: 'archived-id',
        },
      },
      changelog: {
        pipelineId: 'pipe-changelog',
        stageIds: {
          identified: 'identified-id', drafting: 'drafting-cl-id',
          reviewing: 'reviewing-id', published: 'published-cl-id',
        },
      },
    },
  },
  video: {
    objectTypeId: '2-video',
    pipelineId: 'pipe-video',
    stageIds: { draft: 'draft', scheduled: 'scheduled', public: 'public' },
  },
};

vi.mock('@lib/portal-config', () => ({
  getPortalConfig: vi.fn().mockReturnValue(TEST_CONFIG),
}));

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function makeContext(overrides: Partial<{ accountId: number; hs_object_id: string }> = {}): any {
  return {
    method: 'POST',
    body: {
      callbackId: 'cb-1',
      hs_object_id: overrides.hs_object_id ?? 'app-config-rec-1',
      inputFields: {},
    },
    headers: {},
    query: {},
    accountId: overrides.accountId ?? TEST_PORTAL_ID,
  };
}

function mockHsGet(body: unknown) {
  mockFetch.mockResolvedValueOnce({ ok: true, status: 200, json: async () => body, text: async () => '' });
}

function mockHsPatch() {
  mockFetch.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({}), text: async () => '' });
}

function mockHsSearch(results: unknown[]) {
  mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ results }), text: async () => '' });
}

function mockAsanaEvents(body: unknown, status = 200) {
  mockFetch.mockResolvedValueOnce({
    ok: status < 400,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  });
}

// ASANA_PIPELINE_STAGE_FIELD_GID from mapping.ts
const PIPELINE_STAGE_FIELD_GID = '1202184607659964';

function mockAsanaTaskStage(stageGid: string) {
  mockFetch.mockResolvedValueOnce({
    ok: true,
    json: async () => ({
      data: {
        custom_fields: [{ gid: PIPELINE_STAGE_FIELD_GID, enum_value: { gid: stageGid } }],
      },
    }),
    text: async () => '',
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.ASANA_API_KEY = 'asana-test-key';
  process.env.PRIVATE_APP_ACCESS_TOKEN = 'hs-test-token';
});

describe('AsanaPoll', () => {
  it('returns 500 when ASANA_API_KEY is missing', async () => {
    delete process.env.ASANA_API_KEY;
    const { main } = await import('../functions/AsanaPoll');
    const res = await main(makeContext());
    expect(res.statusCode).toBe(500);
  });

  it('returns 400 when hs_object_id is missing', async () => {
    const { main } = await import('../functions/AsanaPoll');
    const ctx = { ...makeContext(), body: { callbackId: 'cb-1', inputFields: {} } };
    const res = await main(ctx);
    expect(res.statusCode).toBe(400);
  });

  it('returns success with 0 processed when Asana returns no events', async () => {
    const { main } = await import('../functions/AsanaPoll');
    mockHsGet({ properties: { asana_sync_token: 'old-token' } }); // getAsanaSyncToken
    mockAsanaEvents({ data: [], sync: 'new-token' });               // pollAsanaEvents
    mockHsPatch();                                                   // setAsanaSyncToken

    const res = await main(makeContext());

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.outputFields.syncStatus).toBe('success');
    expect(body.outputFields.processed).toBe('0');
  });

  it('handles first run (no stored token) — Asana call omits sync param', async () => {
    const { main } = await import('../functions/AsanaPoll');
    mockHsGet({ properties: { asana_sync_token: null } });
    mockAsanaEvents({ data: [], sync: 'first-token' });
    mockHsPatch();

    await main(makeContext());

    // [0]=getAsanaSyncToken (HS GET), [1]=pollAsanaEvents (Asana GET), [2]=setAsanaSyncToken (HS PATCH)
    const eventsCall = mockFetch.mock.calls[1];
    expect(eventsCall[0]).not.toContain('sync=');
    expect(eventsCall[0]).toContain('resource=proj-gid');
  });

  it('handles expired token (412) — saves refreshed token, processes 0 events', async () => {
    const { main } = await import('../functions/AsanaPoll');
    mockHsGet({ properties: { asana_sync_token: 'expired-token' } });
    mockAsanaEvents({ sync: 'refreshed-token' }, 412);
    mockHsPatch();

    const res = await main(makeContext());

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.outputFields.processed).toBe('0');

    const patchCall = mockFetch.mock.calls[2]; // [0]=get, [1]=412 events, [2]=patch
    const patchBody = JSON.parse(patchCall[1].body);
    expect(patchBody.properties.asana_sync_token).toBe('refreshed-token');
  });

  it('skips non-task events', async () => {
    const { main } = await import('../functions/AsanaPoll');
    mockHsGet({ properties: { asana_sync_token: 'tok' } });
    mockAsanaEvents({
      data: [{ action: 'changed', resource: { gid: 'proj-1', resource_type: 'project' }, change: { field: 'custom_fields', action: 'changed' } }],
      sync: 'tok2',
    });
    mockHsPatch();

    const res = await main(makeContext());

    const body = JSON.parse(res.body);
    expect(body.outputFields.processed).toBe('0');
  });

  it('skips non-custom_fields changes', async () => {
    const { main } = await import('../functions/AsanaPoll');
    mockHsGet({ properties: { asana_sync_token: 'tok' } });
    mockAsanaEvents({
      data: [{ action: 'changed', resource: { gid: 'task-1', resource_type: 'task' }, change: { field: 'name', action: 'changed' } }],
      sync: 'tok2',
    });
    mockHsPatch();

    const res = await main(makeContext());

    const body = JSON.parse(res.body);
    expect(body.outputFields.processed).toBe('0');
  });

  it('skips tasks with no linked HubSpot record', async () => {
    const { main } = await import('../functions/AsanaPoll');
    mockHsGet({ properties: { asana_sync_token: 'tok' } });
    mockAsanaEvents({
      data: [{ action: 'changed', resource: { gid: 'task-99', resource_type: 'task' }, change: { field: 'custom_fields', action: 'changed' } }],
      sync: 'tok2',
    });
    mockHsPatch();
    mockAsanaTaskStage('1202184607667441'); // In Progress GID
    mockHsSearch([]);

    const res = await main(makeContext());

    const body = JSON.parse(res.body);
    expect(body.outputFields.processed).toBe('0');
  });

  it('skips echo — HubSpot stage already maps to the incoming Asana stage', async () => {
    const { main } = await import('../functions/AsanaPoll');
    const IN_PROGRESS_GID = '1202184607667441'; // Asana "In Progress" = HubSpot "drafting"
    mockHsGet({ properties: { asana_sync_token: 'tok' } });
    mockAsanaEvents({
      data: [{ action: 'changed', resource: { gid: 'task-echo', resource_type: 'task' }, change: { field: 'custom_fields', action: 'changed' } }],
      sync: 'tok2',
    });
    mockHsPatch();
    mockAsanaTaskStage(IN_PROGRESS_GID);
    mockHsSearch([{
      id: 'hs-rec-1',
      properties: {
        asana_task_url: 'https://app.asana.com/0/proj-gid/task-echo',
        hs_pipeline_stage: 'drafting-id', // already at "drafting" which maps to In Progress
        hs_pipeline: 'pipe-content',
      },
    }]);

    const res = await main(makeContext());

    const body = JSON.parse(res.body);
    expect(body.outputFields.processed).toBe('0');
  });

  it('updates HubSpot record when Asana stage differs from current HubSpot stage', async () => {
    const { main } = await import('../functions/AsanaPoll');
    const PEER_REVIEW_GID = '1202184607668470'; // Asana "Peer Review" = HubSpot "review"
    mockHsGet({ properties: { asana_sync_token: 'tok' } });
    mockAsanaEvents({
      data: [{ action: 'changed', resource: { gid: 'task-upd', resource_type: 'task' }, change: { field: 'custom_fields', action: 'changed' } }],
      sync: 'tok2',
    });
    mockHsPatch(); // setAsanaSyncToken
    mockAsanaTaskStage(PEER_REVIEW_GID);
    mockHsSearch([{
      id: 'hs-rec-2',
      properties: {
        asana_task_url: 'https://app.asana.com/0/proj-gid/task-upd',
        hs_pipeline_stage: 'drafting-id', // was drafting, now Asana says review
        hs_pipeline: 'pipe-content',
      },
    }]);
    mockHsPatch(); // hsUpdate to write new stage

    const res = await main(makeContext());

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.outputFields.syncStatus).toBe('success');
    expect(body.outputFields.processed).toBe('1');

    const updateCall = mockFetch.mock.calls[mockFetch.mock.calls.length - 1];
    const updateBody = JSON.parse(updateCall[1].body);
    expect(updateBody.properties.hs_pipeline_stage).toBe('review-id');
  });
});
