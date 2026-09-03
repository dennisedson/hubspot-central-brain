import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { main } from '../functions/EnterpretInsightsApi';

/**
 * Handler tests for EnterpretInsightsApi.
 *
 * ONE FETCH IS THE POINT. This handler is a pure record read: Enterpret data is
 * batch-synced into `content_piece.enterpret_quotes` out-of-band, because there
 * is no obtainable Enterpret API key and the assistant that does have access
 * reaches it over MCP, which a deployed HubSpot function cannot use. Every test
 * below asserts the full list of URLs called, so any reintroduced third-party
 * call fails here first.
 *
 * URL ASSERTIONS ARE ALSO THE POINT (issue #14). The HubSpot read is pinned to
 * an exact literal including its `?properties=` query string. Do not soften it
 * into `toContain` or a regex.
 */

const TEST_PORTAL_ID = 51869810;
const OBJECT_ID = '4201';

// --- the only URL this handler may call ----------------------------------
const READ_URL =
  'https://api.hubapi.com/crm/objects/2026-03/2-67505887/4201' +
  '?properties=enterpret_theme,enterpret_quote_count,enterpret_quotes';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

beforeEach(() => {
  mockFetch.mockReset();
  vi.stubEnv('PRIVATE_APP_ACCESS_TOKEN', 'hs-test-token');
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

function mockFailure(status: number, statusText = 'Server Error', body = 'boom') {
  mockFetch.mockResolvedValueOnce({
    ok: false,
    status,
    statusText,
    json: async () => ({}),
    text: async () => body,
  });
}

/** What the MCP-driven sync writes into the textarea property. */
const STORED_QUOTES = JSON.stringify([
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
]);

const SYNCED_RECORD = {
  enterpret_theme: 'Webhook reliability',
  enterpret_quote_count: '12',
  enterpret_quotes: STORED_QUOTES,
};

describe('EnterpretInsightsApi.main — request URLs', () => {
  it('reads the content_piece record from the exact CRM object URL', async () => {
    mockRecord(SYNCED_RECORD);

    await main(makeContext());

    expect(mockFetch.mock.calls[0][0]).toBe(READ_URL);
    expect(mockFetch.mock.calls[0][1].headers.Authorization).toBe('Bearer hs-test-token');
  });

  it('makes exactly one fetch — the record read, and nothing external', async () => {
    mockRecord(SYNCED_RECORD);

    await main(makeContext());

    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(urls()).toEqual([READ_URL]);
  });
});

describe('EnterpretInsightsApi.main — quotes stored on the record', () => {
  it('returns the payload shape EnterpretInsightsCard renders', async () => {
    mockRecord(SYNCED_RECORD);

    const res = await main(makeContext());
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);

    expect(body).toEqual({
      theme: 'Webhook reliability',
      quoteCount: 12,
      quotes: [
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
      ],
      sentiment: { total: 3, positive: 0, negative: 2, neutral: 1, dominant: 'negative' },
      errors: { enterpret: null },
    });
    expect(urls()).toEqual([READ_URL]);
  });

  it('caps the card at five quotes however many are stored', async () => {
    const many = Array.from({ length: 9 }, (_, i) => ({ text: `quote ${i}`, source: 'Slack' }));
    mockRecord({ ...SYNCED_RECORD, enterpret_quotes: JSON.stringify(many) });

    const body = JSON.parse((await main(makeContext())).body);
    expect(body.quotes).toHaveLength(5);
    expect(body.sentiment.total).toBe(5);
  });

  it('preserves a legitimate zero quote count and rejects junk', async () => {
    mockRecord({ enterpret_theme: 'Rate limits', enterpret_quote_count: '0', enterpret_quotes: '' });
    expect(JSON.parse((await main(makeContext())).body).quoteCount).toBe(0);

    mockRecord({ enterpret_theme: 'Rate limits', enterpret_quote_count: 'lots', enterpret_quotes: '' });
    expect(JSON.parse((await main(makeContext())).body).quoteCount).toBeNull();
  });
});

describe('EnterpretInsightsApi.main — nothing synced yet is a first-class success', () => {
  it('returns 200 with the stored theme and count when enterpret_quotes is empty', async () => {
    mockRecord({ ...SYNCED_RECORD, enterpret_quotes: '' });

    const res = await main(makeContext());
    expect(res.statusCode).toBe(200);

    expect(JSON.parse(res.body)).toEqual({
      theme: 'Webhook reliability',
      quoteCount: 12,
      quotes: [],
      sentiment: null,
      errors: { enterpret: null },
    });
    expect(urls()).toEqual([READ_URL]);
  });

  it('treats an absent enterpret_quotes property the same as an empty one', async () => {
    mockRecord({ enterpret_theme: 'Webhook reliability', enterpret_quote_count: '12' });

    const body = JSON.parse((await main(makeContext())).body);
    expect(body.quotes).toEqual([]);
    expect(body.sentiment).toBeNull();
    expect(body.theme).toBe('Webhook reliability');
  });

  it('degrades malformed stored JSON to no quotes, never to an error', async () => {
    for (const stored of [
      '[{"text": "truncated mid-sy',
      'not json at all',
      '{"text":"an object, not an array"}',
      '   ',
      'null',
    ]) {
      mockRecord({ ...SYNCED_RECORD, enterpret_quotes: stored });

      const res = await main(makeContext());
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);

      expect(body.quotes).toEqual([]);
      expect(body.sentiment).toBeNull();
      expect(body.errors).toEqual({ enterpret: null });
      // The theme and count still come back — a bad sync costs only the quotes.
      expect(body.theme).toBe('Webhook reliability');
      expect(body.quoteCount).toBe(12);
    }
  });

  it('returns a clean empty payload when the record has no theme', async () => {
    mockRecord({ enterpret_theme: '   ', enterpret_quote_count: null, enterpret_quotes: '' });

    const res = await main(makeContext());
    expect(res.statusCode).toBe(200);

    expect(JSON.parse(res.body)).toEqual({
      theme: null,
      quoteCount: null,
      quotes: [],
      sentiment: null,
      errors: { enterpret: null },
    });
    expect(urls()).toEqual([READ_URL]);
  });

  it('still returns quotes when they are synced without a theme', async () => {
    mockRecord({
      enterpret_theme: null,
      enterpret_quote_count: null,
      enterpret_quotes: '[{"text":"orphaned quote","source":"Slack"}]',
    });

    const body = JSON.parse((await main(makeContext())).body);
    expect(body.theme).toBeNull();
    expect(body.quotes).toHaveLength(1);
    expect(body.sentiment.total).toBe(1);
  });
});

describe('EnterpretInsightsApi.main — status codes', () => {
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

/**
 * REGRESSION GUARD — the Enterpret credential is gone for good.
 *
 * There is no key to obtain, so no code path may read one and no hsmeta may
 * declare one. The env var name is assembled at runtime so this file does not
 * match its own scan.
 */
describe('no Enterpret credential exists anywhere in the app', () => {
  const KEY_NAME = ['ENTERPRET', 'API', 'KEY'].join('_');
  const SRC = resolve(__dirname, '../..');

  function walk(dir: string, out: string[] = []): string[] {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full, out);
      else out.push(full);
    }
    return out;
  }

  it(`no file under src/ mentions ${['ENTERPRET', 'API', 'KEY'].join('_')}`, () => {
    const offenders = walk(SRC).filter(file => readFileSync(file, 'utf8').includes(KEY_NAME));
    expect(offenders).toEqual([]);
  });

  it('no code path reads it from the environment', () => {
    const offenders = walk(SRC).filter(file =>
      /process\.env\.ENTERPRET/.test(readFileSync(file, 'utf8')),
    );
    expect(offenders).toEqual([]);
  });

  it('the handler behaves identically whether or not such a key is in the env', async () => {
    mockRecord(SYNCED_RECORD);
    const without = JSON.parse((await main(makeContext())).body);

    vi.stubEnv(KEY_NAME, 'ent-live-should-be-ignored');
    mockRecord(SYNCED_RECORD);
    const with_ = JSON.parse((await main(makeContext())).body);

    expect(with_).toEqual(without);
    // Still one call per invocation: a key in the env buys no extra request.
    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(urls()).toEqual([READ_URL, READ_URL]);
  });

  it('the app function declares only the HubSpot token as a secret', () => {
    const meta = JSON.parse(
      readFileSync(resolve(__dirname, '../functions/EnterpretInsightsApi-hsmeta.json'), 'utf8'),
    );
    expect(meta.config.secretKeys).toEqual(['HS_ACCESS_TOKEN']);
  });
});
