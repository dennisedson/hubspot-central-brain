import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { main } from '../functions/TaskStatusApi';

/**
 * Handler tests for TaskStatusApi.
 *
 * URL ASSERTIONS ARE THE POINT (issue #14). Every outbound call is pinned to an
 * exact literal so the migration from `/crm/v3/` to `/crm/objects/2026-03/`
 * cannot land silently. Do not soften these into `toContain` or a regex.
 *
 * The portal config is NOT mocked: 51869810 is the real dev portal and
 * `2-67505887` is its real content_piece objectTypeId, so the literals below are
 * the URLs the deployed function actually builds.
 */

const TEST_PORTAL_ID = 51869810;
const OBJECT_ID = '4201';

// Real dev-portal ids from src/app/lib/portal-config.ts
const CONTENT_PIPELINE_ID = '926238627';
const STAGE_DRAFTING = '1418660001';
const STAGE_EDITING = '1418660002';
const CHANGELOG_PIPELINE_ID = '929918080';
const CHANGELOG_STAGE_IDENTIFIED = '1426412984';

// Asana "Pipeline Stage" enum option GIDs from src/app/lib/mapping.ts
const ASANA_IN_PROGRESS = '1202184607667441';
const ASANA_PUBLISHED = '1202212684793528';

const LINEAR_ISSUE_ID = 'lin-abc-123';
const ASANA_TASK_ID = '1209876543210';

// --- the exact URLs this handler must call -------------------------------
const RECORD_URL =
  'https://api.hubapi.com/crm/objects/2026-03/2-67505887/4201' +
  '?properties=linear_issue_id,asana_task_id,hs_pipeline,hs_pipeline_stage';
const LINEAR_URL = 'https://api.linear.app/graphql';
const ASANA_URL =
  'https://app.asana.com/api/1.0/tasks/1209876543210' +
  '?opt_fields=name,permalink_url,assignee.name,custom_fields.gid,custom_fields.enum_value.gid';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

beforeEach(() => {
  mockFetch.mockReset();
  vi.stubEnv('PRIVATE_APP_ACCESS_TOKEN', 'hs-test-token');
  vi.stubEnv('LINEAR_API_KEY', 'lin_test_key');
  vi.stubEnv('ASANA_API_KEY', 'asana-test-key');
});

afterEach(() => {
  vi.unstubAllEnvs();
});

function makeContext(parameters: Record<string, string | undefined> = { objectId: OBJECT_ID }) {
  return { accountId: TEST_PORTAL_ID, parameters, query: {}, body: {} };
}

function urls(): string[] {
  return mockFetch.mock.calls.map(call => String(call[0]));
}

/** The HubSpot record read (call 0). */
function mockRecord(properties: Record<string, string | null>) {
  mockFetch.mockResolvedValueOnce({
    ok: true,
    status: 200,
    json: async () => ({ id: OBJECT_ID, properties }),
    text: async () => '',
  });
}

/** A Linear GraphQL `issue` response. */
function mockLinearIssue(state: string, overrides: Record<string, unknown> = {}) {
  mockFetch.mockResolvedValueOnce({
    ok: true,
    status: 200,
    statusText: 'OK',
    json: async () => ({
      data: {
        issue: {
          identifier: 'DAD-142',
          title: 'Add webhook retry',
          updatedAt: '2026-09-01T12:00:00.000Z',
          url: 'https://linear.app/hubspot/issue/DAD-142',
          state: { name: state },
          assignee: { displayName: 'dennis' },
          ...overrides,
        },
      },
    }),
    text: async () => '',
  });
}

/** An Asana task response carrying the Pipeline Stage custom field. */
function mockAsanaTask(stageGid: string | null) {
  mockFetch.mockResolvedValueOnce({
    ok: true,
    status: 200,
    json: async () => ({
      data: {
        name: 'Draft blog post',
        permalink_url: 'https://app.asana.com/0/1202179514576728/1209876543210',
        assignee: { name: 'dennis' },
        custom_fields: [
          {
            gid: '1202184607659964',
            enum_value: stageGid === null ? null : { gid: stageGid },
          },
        ],
      },
    }),
    text: async () => '',
  });
}

function mockFailure(status: number, statusText = 'Server Error', body = 'upstream boom') {
  mockFetch.mockResolvedValueOnce({
    ok: false,
    status,
    statusText,
    json: async () => ({}),
    text: async () => body,
  });
}

describe('TaskStatusApi.main — request URLs', () => {
  it('reads the content_piece record from the exact CRM object URL', async () => {
    mockRecord({
      linear_issue_id: null,
      asana_task_id: null,
      hs_pipeline: CONTENT_PIPELINE_ID,
      hs_pipeline_stage: STAGE_DRAFTING,
    });

    await main(makeContext());

    expect(mockFetch.mock.calls[0][0]).toBe(RECORD_URL);
  });

  it('calls HubSpot, then Linear, then Asana — three exact URLs', async () => {
    mockRecord({
      linear_issue_id: LINEAR_ISSUE_ID,
      asana_task_id: ASANA_TASK_ID,
      hs_pipeline: CONTENT_PIPELINE_ID,
      hs_pipeline_stage: STAGE_DRAFTING,
    });
    mockLinearIssue('In Progress');
    mockAsanaTask(ASANA_IN_PROGRESS);

    await main(makeContext());

    expect(urls()).toEqual([RECORD_URL, LINEAR_URL, ASANA_URL]);
  });

  it('sends the bearer token on the HubSpot read', async () => {
    mockRecord({ linear_issue_id: null, asana_task_id: null, hs_pipeline: '', hs_pipeline_stage: '' });

    await main(makeContext());

    expect(mockFetch.mock.calls[0][1].headers.Authorization).toBe('Bearer hs-test-token');
  });
});

describe('TaskStatusApi.main — happy path', () => {
  it('returns the payload shape TaskStatusCard renders', async () => {
    mockRecord({
      linear_issue_id: LINEAR_ISSUE_ID,
      asana_task_id: ASANA_TASK_ID,
      hs_pipeline: CONTENT_PIPELINE_ID,
      hs_pipeline_stage: STAGE_DRAFTING,
    });
    mockLinearIssue('In Progress');
    mockAsanaTask(ASANA_IN_PROGRESS);

    const res = await main(makeContext());
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);

    expect(body.pipeline).toBe('content');
    expect(body.stageLabel).toBe('drafting');
    expect(body.linear).toEqual({
      identifier: 'DAD-142',
      title: 'Add webhook retry',
      state: 'In Progress',
      assignee: 'dennis',
      updatedAt: '2026-09-01T12:00:00.000Z',
      url: 'https://linear.app/hubspot/issue/DAD-142',
      drift: { inSync: true, expectedState: 'In Progress', actualState: 'In Progress' },
    });
    expect(body.asana).toEqual({
      name: 'Draft blog post',
      stageGid: ASANA_IN_PROGRESS,
      assignee: 'dennis',
      url: 'https://app.asana.com/0/1202179514576728/1209876543210',
      drift: { inSync: true, expectedState: ASANA_IN_PROGRESS, actualState: ASANA_IN_PROGRESS },
    });
    expect(body.errors).toEqual({ linear: null, asana: null });
  });

  it('reports real drift when Linear has moved past the HubSpot stage', async () => {
    mockRecord({
      linear_issue_id: LINEAR_ISSUE_ID,
      asana_task_id: null,
      hs_pipeline: CONTENT_PIPELINE_ID,
      hs_pipeline_stage: STAGE_DRAFTING,
    });
    mockLinearIssue('Done');

    const body = JSON.parse((await main(makeContext())).body);

    expect(body.linear.drift).toEqual({
      inSync: false,
      expectedState: 'In Progress',
      actualState: 'Done',
    });
  });

  it('reports drift null for a Linear state the sync does not model', async () => {
    mockRecord({
      linear_issue_id: LINEAR_ISSUE_ID,
      asana_task_id: null,
      hs_pipeline: CONTENT_PIPELINE_ID,
      hs_pipeline_stage: STAGE_DRAFTING,
    });
    mockLinearIssue('Triage');

    const body = JSON.parse((await main(makeContext())).body);
    expect(body.linear.drift).toBeNull();
  });
});

describe('TaskStatusApi.main — the false-drift traps', () => {
  /**
   * The mapping tables are many-to-one in BOTH directions. `identified` maps
   * forward to "Backlog", but "Todo" maps back to `identified` — so a changelog
   * record sitting in `identified` with a Linear issue in "Todo" is IN SYNC,
   * even though expectedState !== actualState.
   */
  it('a changelog record whose Linear state agrees in reverse is inSync', async () => {
    mockRecord({
      linear_issue_id: LINEAR_ISSUE_ID,
      asana_task_id: null,
      hs_pipeline: CHANGELOG_PIPELINE_ID,
      hs_pipeline_stage: CHANGELOG_STAGE_IDENTIFIED,
    });
    mockLinearIssue('Todo');

    const body = JSON.parse((await main(makeContext())).body);

    expect(body.pipeline).toBe('changelog');
    expect(body.stageLabel).toBe('identified');
    expect(body.linear.drift).toEqual({
      inSync: true,
      expectedState: 'Backlog',
      actualState: 'Todo',
    });
  });

  it('a changelog record genuinely behind Linear still reports drift', async () => {
    mockRecord({
      linear_issue_id: LINEAR_ISSUE_ID,
      asana_task_id: null,
      hs_pipeline: CHANGELOG_PIPELINE_ID,
      hs_pipeline_stage: CHANGELOG_STAGE_IDENTIFIED,
    });
    mockLinearIssue('Done');

    const body = JSON.parse((await main(makeContext())).body);
    expect(body.linear.drift).toEqual({
      inSync: false,
      expectedState: 'Backlog',
      actualState: 'Done',
    });
  });

  it('content "editing" against Asana "In Progress" is inSync (both map forward)', async () => {
    mockRecord({
      linear_issue_id: null,
      asana_task_id: ASANA_TASK_ID,
      hs_pipeline: CONTENT_PIPELINE_ID,
      hs_pipeline_stage: STAGE_EDITING,
    });
    mockAsanaTask(ASANA_IN_PROGRESS);

    const body = JSON.parse((await main(makeContext())).body);

    expect(body.stageLabel).toBe('editing');
    expect(body.asana.drift.inSync).toBe(true);
  });

  it('content "editing" against Asana "Published" reports drift', async () => {
    mockRecord({
      linear_issue_id: null,
      asana_task_id: ASANA_TASK_ID,
      hs_pipeline: CONTENT_PIPELINE_ID,
      hs_pipeline_stage: STAGE_EDITING,
    });
    mockAsanaTask(ASANA_PUBLISHED);

    const body = JSON.parse((await main(makeContext())).body);
    expect(body.asana.drift).toEqual({
      inSync: false,
      expectedState: ASANA_IN_PROGRESS,
      actualState: ASANA_PUBLISHED,
    });
  });
});

describe('TaskStatusApi.main — unlinked records', () => {
  it('makes no external calls when the record has neither linear_issue_id nor asana_task_id', async () => {
    mockRecord({
      linear_issue_id: null,
      asana_task_id: null,
      hs_pipeline: CONTENT_PIPELINE_ID,
      hs_pipeline_stage: STAGE_DRAFTING,
    });

    const res = await main(makeContext());
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);

    expect(urls()).toEqual([RECORD_URL]);
    expect(body.linear).toBeNull();
    expect(body.asana).toBeNull();
    expect(body.errors).toEqual({ linear: null, asana: null });
    expect(body.pipeline).toBe('content');
    expect(body.stageLabel).toBe('drafting');
  });

  it('treats empty-string ids as unlinked', async () => {
    mockRecord({
      linear_issue_id: '',
      asana_task_id: '',
      hs_pipeline: CONTENT_PIPELINE_ID,
      hs_pipeline_stage: STAGE_DRAFTING,
    });

    const body = JSON.parse((await main(makeContext())).body);
    expect(urls()).toEqual([RECORD_URL]);
    expect(body.linear).toBeNull();
    expect(body.asana).toBeNull();
  });

  it('returns pipeline/stageLabel null for an unrecognised pipeline', async () => {
    mockRecord({
      linear_issue_id: null,
      asana_task_id: null,
      hs_pipeline: 'not-a-pipeline',
      hs_pipeline_stage: 'not-a-stage',
    });

    const body = JSON.parse((await main(makeContext())).body);
    expect(body.pipeline).toBeNull();
    expect(body.stageLabel).toBeNull();
  });
});

describe('TaskStatusApi.main — per-source failure isolation', () => {
  it('a Linear outage does not blank Asana', async () => {
    mockRecord({
      linear_issue_id: LINEAR_ISSUE_ID,
      asana_task_id: ASANA_TASK_ID,
      hs_pipeline: CONTENT_PIPELINE_ID,
      hs_pipeline_stage: STAGE_DRAFTING,
    });
    mockFailure(500); // Linear
    mockAsanaTask(ASANA_IN_PROGRESS);

    const res = await main(makeContext());
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);

    expect(urls()).toEqual([RECORD_URL, LINEAR_URL, ASANA_URL]);
    expect(body.linear).toBeNull();
    expect(body.errors.linear).toBe('Linear API HTTP error: 500 Server Error');
    expect(body.asana.name).toBe('Draft blog post');
    expect(body.errors.asana).toBeNull();
  });

  it('an Asana outage does not blank Linear', async () => {
    mockRecord({
      linear_issue_id: LINEAR_ISSUE_ID,
      asana_task_id: ASANA_TASK_ID,
      hs_pipeline: CONTENT_PIPELINE_ID,
      hs_pipeline_stage: STAGE_DRAFTING,
    });
    mockLinearIssue('In Progress');
    mockFailure(503, 'Service Unavailable', 'asana down');

    const res = await main(makeContext());
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);

    expect(body.asana).toBeNull();
    expect(body.errors.asana).toBe('Asana GET task failed 503: asana down');
    expect(body.linear.identifier).toBe('DAD-142');
    expect(body.errors.linear).toBeNull();
  });

  it('surfaces a GraphQL-level Linear error without failing the response', async () => {
    mockRecord({
      linear_issue_id: LINEAR_ISSUE_ID,
      asana_task_id: null,
      hs_pipeline: CONTENT_PIPELINE_ID,
      hs_pipeline_stage: STAGE_DRAFTING,
    });
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => ({ data: null, errors: [{ message: 'Entity not found: Issue' }] }),
      text: async () => '',
    });

    const res = await main(makeContext());
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).errors.linear).toBe('Linear GraphQL error: Entity not found: Issue');
  });

  it('a deleted Asana task (404) is not an error — it is simply null', async () => {
    mockRecord({
      linear_issue_id: null,
      asana_task_id: ASANA_TASK_ID,
      hs_pipeline: CONTENT_PIPELINE_ID,
      hs_pipeline_stage: STAGE_DRAFTING,
    });
    mockFailure(404, 'Not Found', 'gone');

    const body = JSON.parse((await main(makeContext())).body);
    expect(body.asana).toBeNull();
    expect(body.errors.asana).toBeNull();
  });
});

describe('TaskStatusApi.main — status codes', () => {
  it('returns 400 when objectId is missing', async () => {
    const res = await main(makeContext({}));
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toBe('objectId is required');
    expect(mockFetch).not.toHaveBeenCalled();
  });

  // Regression: cards call this via hubspot.serverless(), which does NOT populate
  // context.accountId. The card passes portalId explicitly instead. Before this
  // fallback existed every card rendered "accountId missing from context".
  it('resolves the portal from an explicit portalId when accountId is absent', async () => {
    // Getting as far as the record fetch is the proof: the portalId guard was
    // cleared. This block does not stub a response, so the call rejects after
    // that point — which is fine, the guard is what is under test.
    await main({
      parameters: { objectId: OBJECT_ID, portalId: '51869810' },
      query: {},
      body: {},
    }).catch(() => undefined);
    expect(mockFetch).toHaveBeenCalled();
  });

  it('returns 400 when accountId is missing from the context', async () => {
    const res = await main({ parameters: { objectId: OBJECT_ID }, query: {}, body: {} });
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toBe('portalId is required');
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('returns 500 when no HubSpot access token is available', async () => {
    vi.stubEnv('PRIVATE_APP_ACCESS_TOKEN', '');
    vi.stubEnv('HS_ACCESS_TOKEN', '');
    const res = await main(makeContext());
    expect(res.statusCode).toBe(500);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('returns 502 when the record cannot be read', async () => {
    mockFailure(403, 'Forbidden', 'no scope');
    const res = await main(makeContext());
    expect(res.statusCode).toBe(502);
    expect(JSON.parse(res.body).error).toBe('Could not read record 4201: 403');
  });

  it('accepts objectId from the query string as well as parameters', async () => {
    mockRecord({ linear_issue_id: null, asana_task_id: null, hs_pipeline: '', hs_pipeline_stage: '' });
    const res = await main({ accountId: TEST_PORTAL_ID, query: { objectId: OBJECT_ID }, body: {} });
    expect(res.statusCode).toBe(200);
    expect(mockFetch.mock.calls[0][0]).toBe(RECORD_URL);
  });
});
