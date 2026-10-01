import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { classify, safeDetail, probe, overallStatus } from '../lib/credential-health';
import { main } from '../functions/AppHealth';

/**
 * Three credentials have died silently in this project: the HubSpot service
 * key, the YouTube refresh token, and ANTHROPIC_API_KEY — the last one invalid
 * in .env and on both portals at once, unnoticed because nothing had ever
 * called Anthropic for real. Preflight passed every time; all thirteen of its
 * checks are structural.
 */

describe('classify', () => {
  it('separates rejection from unreachability', () => {
    expect(classify(200)).toBe('ok');
    expect(classify(401)).toBe('invalid');
    expect(classify(403)).toBe('invalid');
    expect(classify(500)).toBe('error');
    expect(classify(429)).toBe('error');
  });
});

describe('safeDetail', () => {
  it('redacts anything that looks like a credential', () => {
    // A failing provider often echoes the request back, so the body is not
    // automatically safe to surface.
    expect(safeDetail('bad key sk-ant-api03-abcdefghijklmnop')).not.toContain('abcdefghij');
    expect(safeDetail('token lin_api_0123456789abcdef rejected')).toContain('[redacted]');
  });

  it('collapses whitespace and truncates', () => {
    expect(safeDetail('a\n\n   b')).toBe('a b');
    expect(safeDetail('x'.repeat(400)).length).toBeLessThanOrEqual(140);
  });
});

describe('probe', () => {
  it('reports an unset secret as unconfigured, not as a failure', () => {
    // A portal that never had YouTube connected is not broken.
    return probe('youtube', undefined, async () => ({ status: 200, body: '' }))
      .then(r => {
        expect(r.status).toBe('unconfigured');
      });
  });

  it('turns a throw into a result rather than failing the batch', async () => {
    const r = await probe('linear', 'key', async () => { throw new Error('network down'); });
    expect(r.status).toBe('error');
    expect(r.detail).toContain('network down');
  });

  it('never returns the credential it was given', async () => {
    const r = await probe('anthropic', 'sk-ant-secretvalue123456', async () => ({
      status: 401, body: 'invalid key sk-ant-secretvalue123456',
    }));
    expect(JSON.stringify(r)).not.toContain('secretvalue');
  });
});

describe('overallStatus', () => {
  it('is degraded when anything is invalid or errored', () => {
    expect(overallStatus([{ name: 'a', status: 'ok', detail: '' }])).toBe('ok');
    expect(overallStatus([
      { name: 'a', status: 'ok', detail: '' },
      { name: 'b', status: 'unconfigured', detail: '' },
    ])).toBe('ok');
    expect(overallStatus([
      { name: 'a', status: 'ok', detail: '' },
      { name: 'b', status: 'invalid', detail: '' },
    ])).toBe('degraded');
  });
});

const originalFetch = globalThis.fetch;
beforeEach(() => {
  globalThis.fetch = vi.fn() as unknown as typeof fetch;
  process.env.SYNC_SHARED_SECRET = 'shh';
});
afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});
const mockFetch = () => globalThis.fetch as unknown as ReturnType<typeof vi.fn>;

describe('the health endpoint', () => {
  it('refuses without the shared secret', async () => {
    // Public endpoint: every probe costs a real third-party call, so an
    // unauthenticated version lets anyone spend this portal's budget.
    const res = await main({ accountId: 51869810, parameters: {} });
    expect(res.statusCode).toBe(401);
    expect(mockFetch()).not.toHaveBeenCalled();
  });

  it('refuses a wrong secret', async () => {
    const res = await main({ accountId: 51869810, parameters: { secret: 'nope' } });
    expect(res.statusCode).toBe(401);
  });

  it('reports degraded when one credential is rejected', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-dead';
    process.env.LINEAR_API_KEY = 'lin-good';
    mockFetch().mockImplementation((url: string) =>
      Promise.resolve({
        status: String(url).includes('anthropic') ? 401 : 200,
        text: async () => String(url).includes('anthropic') ? '{"message":"API key is invalid."}' : 'ok',
      } as unknown as Response));

    const res = await main({ accountId: 51869810, parameters: { secret: 'shh' } });
    const body = JSON.parse(res.body) as {
      status: string; checks: Array<{ name: string; status: string }>;
    };

    expect(res.statusCode).toBe(200);
    expect(body.status).toBe('degraded');
    expect(body.checks.find(c => c.name === 'anthropic')!.status).toBe('invalid');
  });

  it('answers 200 even when degraded, so a dead portal is distinguishable from a dead endpoint', async () => {
    mockFetch().mockImplementation(() =>
      Promise.resolve({ status: 401, text: async () => 'no' } as unknown as Response));
    const res = await main({ accountId: 51869810, parameters: { secret: 'shh' } });
    expect(res.statusCode).toBe(200);
  });

  it('checks every dependency, not just the one that broke today', async () => {
    for (const k of ['ANTHROPIC_API_KEY', 'LINEAR_API_KEY', 'ASANA_API_KEY', 'FELLOW_API_KEY', 'YOUTUBE_REFRESH_TOKEN', 'HS_ACCESS_TOKEN']) {
      process.env[k] = 'set';
    }
    mockFetch().mockImplementation(() =>
      Promise.resolve({ status: 200, text: async () => 'ok' } as unknown as Response));

    const res = await main({ accountId: 51869810, parameters: { secret: 'shh' } });
    const names = (JSON.parse(res.body) as { checks: Array<{ name: string }> }).checks.map(c => c.name);

    expect(names.sort()).toEqual(['anthropic', 'asana', 'fellow', 'hubspot', 'linear', 'youtube']);
  });
});

describe('an HTML response', () => {
  it('is reported as a wrong endpoint, not a bad credential', async () => {
    // Fellow's host answers every path with an HTML 404, including the root.
    // Truncating `<!doctype html>` to 140 characters reads as "the key is
    // broken" and sends someone to rotate a key that is fine.
    const r = await probe('fellow', 'a-good-key', async () => ({
      status: 404,
      body: '<!doctype html>\n<html prefix="" data-theme="">…',
    }));

    expect(r.status).toBe('error');
    expect(r.detail).toMatch(/base URL may have moved/);
    expect(r.detail).not.toContain('doctype');
  });

  it('leaves a genuine API error message alone', async () => {
    const r = await probe('youtube', 'tok', async () => ({
      status: 400,
      body: '{ "error": "invalid_grant", "error_description": "Bad Request" }',
    }));
    expect(r.detail).toContain('invalid_grant');
  });
});
