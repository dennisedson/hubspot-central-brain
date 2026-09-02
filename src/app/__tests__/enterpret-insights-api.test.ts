import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { main } from '../functions/EnterpretInsightsApi';

/**
 * Handler tests for EnterpretInsightsApi.
 *
 * URL ASSERTIONS ARE THE POINT (issue #14). The HubSpot read is pinned to an
 * exact literal including its `?properties=` query string; the Enterpret call is
 * pinned too so the (assumed) third-party path is equally visible in a diff.
 * Do not soften these into `toContain` or a regex.
 *
 * ENV: every test stubs ENTERPRET_API_KEY explicitly — unset is the shipped
 * state, and `vi.unstubAllEnvs()` in afterEach restores the real environment so
 * a developer who happens to have the key exported cannot change the outcome.
 */

const TEST_PORTAL_ID = 51869810;
const OBJECT_ID = '4201';

// --- the exact URLs this handler must call -------------------------------
const READ_URL =
  'https://api.hubapi.com/crm/objects/2026-03/2-67505887/4201' +
  '?properties=enterpret_theme,enterpret_quote_count';
const ENTERPRET_URL = 'https://api.enterpret.com/external/v2/feedback-records/query';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

beforeEach(() => {
  mockFetch.mockReset();
  vi.stubEnv('PRIVATE_APP_ACCESS_TOKEN', 'hs-test-token');
  // The shipped state: the secret does not exist in the portal yet.
  vi.stubEnv('ENTERPRET_API_KEY', undefined);
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

function mockRecord(properties: Record<string, string | null>) {
  mockFetch.mockResolvedValueOnce({
    ok: true,
    status: 200,
    json: async () => ({ id: OBJECT_ID, properties }),
    text: async () => '',
  });
}

function mockEnterpret(payload: unknown) {
  mockFetch.mockResolvedValueOnce({
    ok: true,
    status: 200,
    statusText: 'OK',
    json: async () => payload,
    text: async () => '',
  });
}

function mockFailure(status: number, statusText = 'Server Error', body = 'boom') {
  mockFetch.mockResolvedValueOnce({
    ok: false,
    status,
    statusText,
    json: async () => ({}),
    text: async () => body,
  });
}

const THEMED_RECORD = { enterpret_theme: 'Webhook reliability', enterpret_quote_count: '12' };

const ENTERPRET_PAYLOAD = {
  records: [
    {
      id: 'fr-1',
      text: 'Webhook retries silently drop the second delivery.',
      source: { name: 'GitHub Discussions' },
      sentiment: 'negative',
      createdAt: '2026-08-20T10:00:00.000Z',
      url: 'https://github.com/HubSpot/discussions/1',
    },
    {
      id: 'fr-2',
      text: 'Took me two days to work out why my webhook never fired.',
      source: 'Developer Slack',
      sentimentScore: -0.8,
      occurredAt: '2026-08-22T10:00:00.000Z',
    },
    {
      id: 'fr-3',
      text: 'Docs on retries are clear enough now.',
      source: 'Support ticket',
      sentiment: 'neutral',
    },
  ],
};

describe('EnterpretInsightsApi.main — request URLs', () => {
  it('reads the content_piece record from the exact CRM object URL', async () => {
    mockRecord(THEMED_RECORD);

    await main(makeContext());

    expect(mockFetch.mock.calls[0][0]).toBe(READ_URL);
    expect(mockFetch.mock.calls[0][1].headers.Authorization).toBe('Bearer hs-test-token');
  });

  it('calls Enterpret at the exact query URL once configured', async () => {
    vi.stubEnv('ENTERPRET_API_KEY', 'ent-test-key');
    mockRecord(THEMED_RECORD);
    mockEnterpret(ENTERPRET_PAYLOAD);

    await main(makeContext());

    expect(urls()).toEqual([READ_URL, ENTERPRET_URL]);
  });

  it('POSTs the theme and the card quote limit to Enterpret', async () => {
    vi.stubEnv('ENTERPRET_API_KEY', 'ent-test-key');
    mockRecord(THEMED_RECORD);
    mockEnterpret(ENTERPRET_PAYLOAD);

    await main(makeContext());

    const [, init] = mockFetch.mock.calls[1];
    expect(init.method).toBe('POST');
    expect(init.headers.Authorization).toBe('Bearer ent-test-key');
    expect(JSON.parse(init.body)).toEqual({
      filter: { reason: 'Webhook reliability' },
      limit: 5,
    });
  });
});

describe('EnterpretInsightsApi.main — unconfigured is a first-class success', () => {
  it('returns 200 with configured:false and the record’s stored theme and count', async () => {
    mockRecord(THEMED_RECORD);

    const res = await main(makeContext());
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);

    expect(body).toEqual({
      configured: false,
      theme: 'Webhook reliability',
      quoteCount: 12,
      quotes: [],
      sentiment: null,
      errors: { enterpret: null },
    });
    // No Enterpret call is attempted at all.
    expect(urls()).toEqual([READ_URL]);
  });

  it('treats a blank key as unconfigured', async () => {
    vi.stubEnv('ENTERPRET_API_KEY', '   ');
    mockRecord(THEMED_RECORD);

    const body = JSON.parse((await main(makeContext())).body);
    expect(body.configured).toBe(false);
    expect(body.theme).toBe('Webhook reliability');
    expect(urls()).toEqual([READ_URL]);
  });

  it('returns configured:false when the record has no theme, even with a key present', async () => {
    vi.stubEnv('ENTERPRET_API_KEY', 'ent-test-key');
    mockRecord({ enterpret_theme: '   ', enterpret_quote_count: null });

    const res = await main(makeContext());
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);

    expect(body.configured).toBe(false);
    expect(body.theme).toBeNull();
    expect(body.quoteCount).toBeNull();
    expect(urls()).toEqual([READ_URL]);
  });

  it('preserves a legitimate zero quote count and rejects junk', async () => {
    mockRecord({ enterpret_theme: 'Rate limits', enterpret_quote_count: '0' });
    expect(JSON.parse((await main(makeContext())).body).quoteCount).toBe(0);

    mockRecord({ enterpret_theme: 'Rate limits', enterpret_quote_count: 'lots' });
    expect(JSON.parse((await main(makeContext())).body).quoteCount).toBeNull();
  });
});

describe('EnterpretInsightsApi.main — configured happy path', () => {
  it('returns the payload shape EnterpretInsightsCard renders', async () => {
    vi.stubEnv('ENTERPRET_API_KEY', 'ent-test-key');
    mockRecord(THEMED_RECORD);
    mockEnterpret(ENTERPRET_PAYLOAD);

    const res = await main(makeContext());
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);

    expect(body.configured).toBe(true);
    expect(body.theme).toBe('Webhook reliability');
    expect(body.quoteCount).toBe(12);
    expect(body.errors).toEqual({ enterpret: null });
    expect(body.quotes).toEqual([
      {
        id: 'fr-1',
        text: 'Webhook retries silently drop the second delivery.',
        source: 'GitHub Discussions',
        sentiment: 'negative',
        createdAt: '2026-08-20T10:00:00.000Z',
        url: 'https://github.com/HubSpot/discussions/1',
      },
      {
        id: 'fr-2',
        text: 'Took me two days to work out why my webhook never fired.',
        source: 'Developer Slack',
        sentiment: 'negative',
        createdAt: '2026-08-22T10:00:00.000Z',
        url: null,
      },
      {
        id: 'fr-3',
        text: 'Docs on retries are clear enough now.',
        source: 'Support ticket',
        sentiment: 'neutral',
        createdAt: null,
        url: null,
      },
    ]);
    expect(body.sentiment).toEqual({
      total: 3,
      positive: 0,
      negative: 2,
      neutral: 1,
      dominant: 'negative',
    });
  });

  it('degrades to an empty quote list when Enterpret returns an unfamiliar shape', async () => {
    vi.stubEnv('ENTERPRET_API_KEY', 'ent-test-key');
    mockRecord(THEMED_RECORD);
    mockEnterpret({ somethingElse: true });

    const body = JSON.parse((await main(makeContext())).body);
    expect(body.configured).toBe(true);
    expect(body.quotes).toEqual([]);
    expect(body.sentiment).toEqual({
      total: 0,
      positive: 0,
      negative: 0,
      neutral: 0,
      dominant: null,
    });
    expect(body.errors.enterpret).toBeNull();
  });
});

describe('EnterpretInsightsApi.main — per-source failure isolation', () => {
  it('an Enterpret outage still returns the stored theme and count', async () => {
    vi.stubEnv('ENTERPRET_API_KEY', 'ent-test-key');
    mockRecord(THEMED_RECORD);
    mockFailure(503, 'Service Unavailable');

    const res = await main(makeContext());
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);

    expect(body.configured).toBe(true);
    expect(body.theme).toBe('Webhook reliability');
    expect(body.quoteCount).toBe(12);
    expect(body.quotes).toEqual([]);
    expect(body.sentiment).toBeNull();
    expect(body.errors.enterpret).toBe('Enterpret API HTTP error: 503 Service Unavailable');
  });

  it('a transport-level rejection is isolated the same way', async () => {
    vi.stubEnv('ENTERPRET_API_KEY', 'ent-test-key');
    mockRecord(THEMED_RECORD);
    mockFetch.mockRejectedValueOnce(new Error('socket hang up'));

    const body = JSON.parse((await main(makeContext())).body);
    expect(body.errors.enterpret).toBe('socket hang up');
    expect(body.theme).toBe('Webhook reliability');
    expect(body.quoteCount).toBe(12);
  });
});

describe('EnterpretInsightsApi.main — status codes', () => {
  it('returns 400 when objectId is missing', async () => {
    const res = await main(makeContext({}));
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toBe('objectId is required');
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('returns 400 when accountId is missing from the context', async () => {
    const res = await main({ parameters: { objectId: OBJECT_ID }, query: {}, body: {} });
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

  it('returns 502 when the record cannot be read', async () => {
    mockFailure(403, 'Forbidden', 'no scope');
    const res = await main(makeContext());
    expect(res.statusCode).toBe(502);
    expect(JSON.parse(res.body).error).toBe('Could not read record 4201: 403');
    expect(urls()).toEqual([READ_URL]);
  });
});
