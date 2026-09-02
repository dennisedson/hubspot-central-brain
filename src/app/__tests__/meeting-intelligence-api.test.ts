import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { main } from '../functions/MeetingIntelligenceApi';

/**
 * Handler tests for MeetingIntelligenceApi.
 *
 * URL ASSERTIONS ARE THE POINT (issue #14). This handler is the only one that
 * touches BOTH the v4 associations family and the v3 batch-read family, so it
 * pins four exact literals: two association URLs (including `?limit=100`) and
 * two batch-read URLs. Do not soften these into `toContain` or a regex.
 *
 * The two sources run under `Promise.allSettled`, so fetch is routed by URL
 * rather than by call order — a rejected source shortens the call sequence.
 */

const TEST_PORTAL_ID = 51869810;
const CONTACT_ID = '551';

// --- the exact URLs this handler must call -------------------------------
const MEETINGS_ASSOC_URL =
  'https://api.hubapi.com/crm/v4/objects/contacts/551/associations/meetings?limit=100';
const MEETINGS_BATCH_URL = 'https://api.hubapi.com/crm/objects/2026-03/meetings/batch/read';
const CONTENT_ASSOC_URL =
  'https://api.hubapi.com/crm/v4/objects/contacts/551/associations/2-67505887?limit=100';
const CONTENT_BATCH_URL = 'https://api.hubapi.com/crm/objects/2026-03/2-67505887/batch/read';

interface Route {
  ok?: boolean;
  status?: number;
  json?: unknown;
  text?: string;
  reject?: Error;
}

const routes = new Map<string, Route>();
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

function route(url: string, response: Route) {
  routes.set(url, response);
}

beforeEach(() => {
  routes.clear();
  mockFetch.mockReset();
  mockFetch.mockImplementation(async (url: string) => {
    const match = routes.get(String(url));
    if (!match) throw new Error(`Unrouted fetch in test: ${url}`);
    if (match.reject) throw match.reject;
    const status = match.status ?? 200;
    return {
      ok: match.ok ?? status < 400,
      status,
      json: async () => match.json ?? {},
      text: async () => match.text ?? '',
    };
  });
  vi.stubEnv('PRIVATE_APP_ACCESS_TOKEN', 'hs-test-token');
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

function makeContext(parameters: Record<string, string | undefined> = { contactId: CONTACT_ID }) {
  return { accountId: TEST_PORTAL_ID, parameters, query: {}, body: {} };
}

function urls(): string[] {
  return mockFetch.mock.calls.map(call => String(call[0]));
}

function callFor(url: string) {
  const call = mockFetch.mock.calls.find(c => String(c[0]) === url);
  if (!call) throw new Error(`No fetch call was made to ${url}`);
  return call;
}

const NOW = Date.parse('2026-09-02T12:00:00.000Z');

/** Two meetings, deliberately supplied oldest-first to prove client-side sorting. */
const MEETING_RECORDS = [
  {
    id: '901',
    properties: {
      hs_meeting_title: 'Kickoff with Acme',
      hs_meeting_start_time: '2026-08-30T09:00:00.000Z',
      hs_meeting_outcome: 'COMPLETED',
    },
  },
  {
    id: '902',
    properties: {
      hs_meeting_title: 'Follow-up review',
      hs_meeting_start_time: '2026-09-02T10:00:00.000Z',
      hs_meeting_outcome: 'NO_SHOW',
    },
  },
];

const CONTENT_RECORDS = [
  {
    id: '4201',
    properties: {
      title: 'Retrying HubSpot webhooks',
      content_type: 'blog_post',
      hs_pipeline_stage: '1418660001',
      linear_issue_url: 'https://linear.app/hubspot/issue/DAD-142',
      target_date: '2026-09-15',
    },
  },
];

function routeHappyPath() {
  route(MEETINGS_ASSOC_URL, { json: { results: [{ toObjectId: 901 }, { toObjectId: '902' }] } });
  route(MEETINGS_BATCH_URL, { json: { results: MEETING_RECORDS } });
  route(CONTENT_ASSOC_URL, { json: { results: [{ toObjectId: '4201' }] } });
  route(CONTENT_BATCH_URL, { json: { results: CONTENT_RECORDS } });
}

describe('MeetingIntelligenceApi.main — request URLs', () => {
  it('calls both association URLs and both batch-read URLs, exactly', async () => {
    routeHappyPath();

    await main(makeContext());

    const called = urls();
    expect(called).toHaveLength(4);
    expect(called[0]).toBe(MEETINGS_ASSOC_URL);
    expect(called[1]).toBe(CONTENT_ASSOC_URL);
    expect(called).toContain(MEETINGS_BATCH_URL);
    expect(called).toContain(CONTENT_BATCH_URL);
  });

  it('percent-encodes the contact id into the association path', async () => {
    const weirdAssoc = (to: string) =>
      `https://api.hubapi.com/crm/v4/objects/contacts/55%2F1/associations/${to}?limit=100`;
    route(weirdAssoc('meetings'), { json: { results: [] } });
    route(weirdAssoc('2-67505887'), { json: { results: [] } });

    await main(makeContext({ contactId: '55/1' }));

    expect(urls()).toEqual([weirdAssoc('meetings'), weirdAssoc('2-67505887')]);
  });

  it('POSTs the meetings batch read with the properties the card renders', async () => {
    routeHappyPath();

    await main(makeContext());

    const [, init] = callFor(MEETINGS_BATCH_URL);
    expect(init.method).toBe('POST');
    expect(init.headers.Authorization).toBe('Bearer hs-test-token');
    expect(JSON.parse(init.body)).toEqual({
      properties: [
        'hs_meeting_title',
        'hs_meeting_start_time',
        'hs_meeting_end_time',
        'hs_meeting_outcome',
        'hs_timestamp',
      ],
      inputs: [{ id: '901' }, { id: '902' }],
    });
  });

  it('POSTs the content batch read with the content_piece properties', async () => {
    routeHappyPath();

    await main(makeContext());

    const [, init] = callFor(CONTENT_BATCH_URL);
    expect(JSON.parse(init.body)).toEqual({
      properties: ['title', 'content_type', 'hs_pipeline_stage', 'linear_issue_url', 'target_date'],
      inputs: [{ id: '4201' }],
    });
  });

  it('caps the content batch read at ten ids', async () => {
    route(MEETINGS_ASSOC_URL, { json: { results: [] } });
    route(CONTENT_ASSOC_URL, {
      json: { results: Array.from({ length: 25 }, (_, i) => ({ toObjectId: `42${i}` })) },
    });
    route(CONTENT_BATCH_URL, { json: { results: [] } });

    await main(makeContext());

    const [, init] = callFor(CONTENT_BATCH_URL);
    expect(JSON.parse(init.body).inputs).toHaveLength(10);
  });

  it('skips the batch read entirely when a contact has no associations', async () => {
    route(MEETINGS_ASSOC_URL, { json: { results: [] } });
    route(CONTENT_ASSOC_URL, { json: {} });

    const res = await main(makeContext());

    expect(urls()).toEqual([MEETINGS_ASSOC_URL, CONTENT_ASSOC_URL]);
    const body = JSON.parse(res.body);
    expect(body.meetings).toEqual([]);
    expect(body.content).toEqual([]);
    expect(body.errors).toEqual({ meetings: null, content: null });
  });
});

describe('MeetingIntelligenceApi.main — happy path', () => {
  it('returns the payload shape MeetingIntelligenceCard renders, newest meeting first', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    routeHappyPath();

    const res = await main(makeContext());
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);

    expect(body.errors).toEqual({ meetings: null, content: null });
    expect(body.meetings).toEqual([
      {
        id: '902',
        title: 'Follow-up review',
        timestamp: '2026-09-02T10:00:00.000Z',
        relative: '2h ago',
        outcome: 'No show',
      },
      {
        id: '901',
        title: 'Kickoff with Acme',
        timestamp: '2026-08-30T09:00:00.000Z',
        relative: '3d ago',
        outcome: 'Completed',
      },
    ]);
    expect(body.content).toEqual([
      {
        id: '4201',
        title: 'Retrying HubSpot webhooks',
        contentType: 'blog_post',
        pipelineStage: '1418660001',
        linearIssueUrl: 'https://linear.app/hubspot/issue/DAD-142',
        targetDate: '2026-09-15',
      },
    ]);
  });

  it('nulls the optional content fields rather than dropping the record', async () => {
    route(MEETINGS_ASSOC_URL, { json: { results: [] } });
    route(CONTENT_ASSOC_URL, { json: { results: [{ toObjectId: '4299' }] } });
    route(CONTENT_BATCH_URL, { json: { results: [{ id: '4299', properties: {} }] } });

    const body = JSON.parse((await main(makeContext())).body);
    expect(body.content).toEqual([
      {
        id: '4299',
        title: 'Untitled',
        contentType: null,
        pipelineStage: null,
        linearIssueUrl: null,
        targetDate: null,
      },
    ]);
  });

  it('drops association rows with no usable toObjectId', async () => {
    route(MEETINGS_ASSOC_URL, {
      json: { results: [{ toObjectId: '901' }, { toObjectId: null }, {}] },
    });
    route(MEETINGS_BATCH_URL, { json: { results: [MEETING_RECORDS[0]] } });
    route(CONTENT_ASSOC_URL, { json: { results: [] } });

    await main(makeContext());

    expect(JSON.parse(callFor(MEETINGS_BATCH_URL)[1].body).inputs).toEqual([{ id: '901' }]);
  });

  it('treats a 404 from an association lookup as "no records", not an error', async () => {
    route(MEETINGS_ASSOC_URL, { status: 404, json: {} });
    route(CONTENT_ASSOC_URL, { json: { results: [] } });

    const res = await main(makeContext());
    const body = JSON.parse(res.body);

    expect(res.statusCode).toBe(200);
    expect(body.meetings).toEqual([]);
    expect(body.errors.meetings).toBeNull();
  });
});

describe('MeetingIntelligenceApi.main — per-source failure isolation', () => {
  it('a failed meetings lookup still returns content, with errors.meetings set', async () => {
    route(MEETINGS_ASSOC_URL, { status: 403, text: 'missing scope crm.objects.meetings.read' });
    route(CONTENT_ASSOC_URL, { json: { results: [{ toObjectId: '4201' }] } });
    route(CONTENT_BATCH_URL, { json: { results: CONTENT_RECORDS } });

    const res = await main(makeContext());
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);

    expect(body.errors.meetings).toBe(
      'Association lookup (contacts -> meetings) failed 403: missing scope crm.objects.meetings.read',
    );
    expect(body.meetings).toEqual([]);
    expect(body.content).toHaveLength(1);
    expect(body.errors.content).toBeNull();
  });

  it('a failed content batch read still returns meetings, with errors.content set', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    route(MEETINGS_ASSOC_URL, { json: { results: [{ toObjectId: '902' }] } });
    route(MEETINGS_BATCH_URL, { json: { results: [MEETING_RECORDS[1]] } });
    route(CONTENT_ASSOC_URL, { json: { results: [{ toObjectId: '4201' }] } });
    route(CONTENT_BATCH_URL, { status: 500, text: 'internal error' });

    const res = await main(makeContext());
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);

    expect(body.errors.content).toBe('Batch read of 2-67505887 failed 500: internal error');
    expect(body.content).toEqual([]);
    expect(body.meetings).toHaveLength(1);
    expect(body.meetings[0].title).toBe('Follow-up review');
    expect(body.errors.meetings).toBeNull();
  });

  it('a transport-level rejection on one source does not blank the other', async () => {
    route(MEETINGS_ASSOC_URL, { reject: new Error('socket hang up') });
    route(CONTENT_ASSOC_URL, { json: { results: [] } });

    const body = JSON.parse((await main(makeContext())).body);
    expect(body.errors.meetings).toBe('socket hang up');
    expect(body.errors.content).toBeNull();
    expect(body.content).toEqual([]);
  });

  it('reports both errors when both sources fail', async () => {
    route(MEETINGS_ASSOC_URL, { status: 500, text: 'boom' });
    route(CONTENT_ASSOC_URL, { status: 500, text: 'boom' });

    const res = await main(makeContext());
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.errors.meetings).toContain('failed 500');
    expect(body.errors.content).toContain('failed 500');
  });
});

describe('MeetingIntelligenceApi.main — status codes', () => {
  it('returns 400 when contactId is missing', async () => {
    const res = await main(makeContext({}));
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toBe('contactId is required');
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('returns 400 when accountId is missing from the context', async () => {
    const res = await main({ parameters: { contactId: CONTACT_ID }, query: {}, body: {} });
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toBe('accountId missing from context');
  });

  it('returns 500 when no HubSpot access token is available', async () => {
    vi.stubEnv('PRIVATE_APP_ACCESS_TOKEN', '');
    vi.stubEnv('HS_ACCESS_TOKEN', '');
    const res = await main(makeContext());
    expect(res.statusCode).toBe(500);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('returns 500 for a portal with no config', async () => {
    const res = await main({
      accountId: 12345,
      parameters: { contactId: CONTACT_ID },
      query: {},
      body: {},
    });
    expect(res.statusCode).toBe(500);
    expect(JSON.parse(res.body).error).toBe('No portal config for 12345');
    expect(mockFetch).not.toHaveBeenCalled();
  });
});
