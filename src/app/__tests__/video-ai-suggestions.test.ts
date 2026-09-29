import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * How the AI suggestions handler receives its inputs.
 *
 * This is the whole file's subject, because it is what was broken: the handler
 * read `recordId` from the request body while the card sends it in
 * `parameters`, and read the portal from `accountId`, which a card's
 * `hubspot.serverless()` call does not carry. Every press of "Suggest
 * metadata" answered 400 without the model ever being asked. Nothing here had
 * test coverage, which is how it shipped.
 *
 * The model call itself is mocked out — the contract under test is argument
 * plumbing, not prompting.
 */

const originalFetch = globalThis.fetch;
const originalToken = process.env.HS_ACCESS_TOKEN;

const requestVideoSuggestions = vi.fn();

beforeEach(() => {
  process.env.HS_ACCESS_TOKEN = 'test-token';
  vi.resetModules();
  requestVideoSuggestions.mockReset();
  requestVideoSuggestions.mockResolvedValue({ suggestions: { titles: [] } });

  globalThis.fetch = vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({ id: '42', properties: { title: 'T', youtube_video_id: 'v1' } }),
    text: async () => '',
  }) as unknown as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalToken === undefined) delete process.env.HS_ACCESS_TOKEN;
  else process.env.HS_ACCESS_TOKEN = originalToken;
  vi.restoreAllMocks();
  vi.resetModules();
});

async function load() {
  vi.doMock('@lib/claude-client', () => ({
    requestVideoSuggestions,
    ClaudeError: class ClaudeError extends Error {
      reason = 'test';
    },
  }));
  return (await import('../functions/VideoAiSuggestions')).main;
}

describe('VideoAiSuggestions.main', () => {
  it('reads recordId from parameters — the path the card actually uses', async () => {
    const main = await load();
    const res = await main({
      parameters: { recordId: '42', portalId: '51869810' },
    } as never);

    expect(res.statusCode).toBe(200);
    expect(requestVideoSuggestions).toHaveBeenCalledTimes(1);
  });

  it('still reads recordId from the body', async () => {
    // The public-URL callers send a body. Fixing the card must not break them.
    const main = await load();
    const res = await main({
      accountId: 51869810,
      body: { recordId: '42' },
    } as never);

    expect(res.statusCode).toBe(200);
  });

  it('unwraps an array recordId from a public-URL query', async () => {
    const main = await load();
    const res = await main({
      accountId: 51869810,
      params: { recordId: ['42'] },
    } as never);

    expect(res.statusCode).toBe(200);
  });

  it('answers 400 with no recordId, without calling the model', async () => {
    const main = await load();
    const res = await main({ accountId: 51869810 } as never);

    expect(res.statusCode).toBe(400);
    expect(requestVideoSuggestions).not.toHaveBeenCalled();
  });

  it('answers 400 rather than 500 when no portal can be resolved', async () => {
    // Previously this reached getPortalConfig(undefined) and threw, which the
    // card surfaced as an opaque HTTP 500.
    const main = await load();
    const res = await main({ parameters: { recordId: '42' } } as never);

    expect(res.statusCode).toBe(400);
    expect(requestVideoSuggestions).not.toHaveBeenCalled();
  });

  it('prefers accountId over the parameter when both are present', async () => {
    const main = await load();
    const res = await main({
      accountId: 51869810,
      parameters: { recordId: '42', portalId: '999999' },
    } as never);

    expect(res.statusCode).toBe(200);
  });
});
