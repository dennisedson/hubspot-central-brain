import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  CLAUDE_MODEL,
  ClaudeError,
  MAX_DESCRIPTION_LENGTH,
  MAX_TAGS,
  MAX_TITLE_LENGTH,
  buildRequestBody,
  createClaudeClient,
  parseSuggestions,
  requestVideoSuggestions,
} from '@lib/claude-client';

/**
 * The Claude client.
 *
 * parseSuggestions is the highest-risk surface in this module because its input
 * is model output rather than an API contract: prose can wrap the JSON, control
 * characters can appear inside strings, and field names can drift. Every case
 * below is a shape a model plausibly produces.
 *
 * The rule these tests enforce is that the module never invents content. When
 * nothing usable comes back it raises — the legacy implementation answered that
 * case with placeholder text, which is worse than an error because it looks
 * like a suggestion.
 */

describe('parseSuggestions', () => {
  const good = JSON.stringify({
    titles: [{ title: 'A good title', reasoning: 'why' }],
    description: 'A description.',
    tags: ['alpha', 'beta'],
  });

  it('parses a clean response', () => {
    const out = parseSuggestions(good);
    expect(out.titles[0].title).toBe('A good title');
    expect(out.description).toBe('A description.');
    expect(out.tags).toEqual(['alpha', 'beta']);
    expect(out.descriptionTruncated).toBe(false);
  });

  it('extracts JSON wrapped in prose', () => {
    // Models routinely preface JSON with a sentence, whatever the instructions say.
    expect(parseSuggestions(`Here you go:\n\n${good}\n\nHope that helps!`).tags).toEqual([
      'alpha',
      'beta',
    ]);
  });

  it('extracts JSON from a fenced code block', () => {
    expect(parseSuggestions('```json\n' + good + '\n```').titles).toHaveLength(1);
  });

  it('accepts the alternate field names a model might use', () => {
    const alt = JSON.stringify({
      titleOptions: [{ title: 'Alt' }],
      suggestedDescription: 'Alt description',
      keywords: ['k1'],
    });
    const out = parseSuggestions(alt);
    expect(out.titles[0].title).toBe('Alt');
    expect(out.description).toBe('Alt description');
    expect(out.tags).toEqual(['k1']);
  });

  it('recovers from raw control characters inside strings', () => {
    // A literal newline inside a JSON string is invalid JSON but a very common
    // model output. Recovering beats discarding a whole good response.
    const withNewline = '{"titles":[{"title":"T"}],"description":"line one\nline two","tags":[]}';
    expect(parseSuggestions(withNewline).description).toContain('line one');
  });

  it('flags a truncated description rather than passing it off as complete', () => {
    const long = JSON.stringify({
      titles: [{ title: 'T' }],
      description: 'x'.repeat(MAX_DESCRIPTION_LENGTH + 500),
      tags: [],
    });
    const out = parseSuggestions(long);
    expect(out.descriptionTruncated).toBe(true);
    expect(out.description.length).toBeLessThanOrEqual(MAX_DESCRIPTION_LENGTH);
  });

  it('caps the number of tags', () => {
    const many = JSON.stringify({
      titles: [{ title: 'T' }],
      description: 'd',
      tags: Array.from({ length: 50 }, (_, i) => `tag${i}`),
    });
    expect(parseSuggestions(many).tags.length).toBeLessThanOrEqual(MAX_TAGS);
  });

  it('drops titles that exceed the platform limit', () => {
    const out = parseSuggestions(
      JSON.stringify({
        titles: [{ title: 'x'.repeat(MAX_TITLE_LENGTH + 50) }, { title: 'short' }],
        description: 'd',
        tags: [],
      }),
    );
    for (const t of out.titles) expect(t.title.length).toBeLessThanOrEqual(MAX_TITLE_LENGTH);
  });

  it('raises when there is no JSON at all', () => {
    expect(() => parseSuggestions('I could not do that.')).toThrow(ClaudeError);
  });

  it('raises when the JSON is an array rather than an object', () => {
    expect(() => parseSuggestions('[1,2,3]')).toThrow(ClaudeError);
  });

  it('raises rather than inventing content when nothing usable came back', () => {
    try {
      parseSuggestions(JSON.stringify({ titles: [], description: '', tags: [] }));
      throw new Error('should have thrown');
    } catch (err) {
      expect((err as ClaudeError).reason).toBe('empty_suggestions');
    }
  });
});

describe('buildRequestBody', () => {
  it('targets the configured model', () => {
    expect(buildRequestBody({ title: 'T' }).model).toBe(CLAUDE_MODEL);
  });

  it('includes the video facts it was given', () => {
    const body = buildRequestBody({ title: 'My Video', tags: 'a,b' });
    expect(JSON.stringify(body)).toContain('My Video');
  });

  it('survives a record where every field is null', () => {
    // The common case for a freshly created record — it must still produce a
    // valid request rather than throwing.
    expect(() =>
      buildRequestBody({
        title: null,
        description: null,
        tags: null,
        youtubeUrl: null,
        seriesName: null,
        campaignName: null,
        transcript: null,
      }),
    ).not.toThrow();
  });
});

describe('createClaudeClient', () => {
  const original = process.env.ANTHROPIC_API_KEY;
  afterEach(() => {
    if (original === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = original;
  });

  it('raises a named error when the key is absent', () => {
    delete process.env.ANTHROPIC_API_KEY;
    try {
      createClaudeClient();
      throw new Error('should have thrown');
    } catch (err) {
      expect((err as ClaudeError).reason).toBe('no_api_key');
    }
  });
});

describe('requestVideoSuggestions — transport failures are classified', () => {
  const originalFetch = globalThis.fetch;
  beforeEach(() => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
    globalThis.fetch = vi.fn() as unknown as typeof fetch;
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  function resp(status: number, body: unknown): Response {
    return {
      status,
      ok: status >= 200 && status < 300,
      text: async () => JSON.stringify(body),
    } as unknown as Response;
  }

  it('returns parsed suggestions and usage on success', async () => {
    (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
      resp(200, {
        model: CLAUDE_MODEL,
        stop_reason: 'end_turn',
        content: [
          { type: 'text', text: JSON.stringify({ titles: [{ title: 'T' }], description: 'd', tags: ['x'] }) },
        ],
        usage: { input_tokens: 10, output_tokens: 20 },
      }),
    );
    const out = await requestVideoSuggestions({ title: 'T' });
    expect(out.suggestions.titles[0].title).toBe('T');
    expect(out.usage.inputTokens).toBe(10);
    expect(out.model).toBe(CLAUDE_MODEL);
  });

  it('classifies a 401 as an auth failure, not a generic error', async () => {
    // Retrying an auth failure is pointless; retrying a rate limit is the fix.
    // The distinction has to survive to the caller.
    (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
      resp(401, { error: { message: 'API key is invalid.' } }),
    );
    await expect(requestVideoSuggestions({ title: 'T' })).rejects.toMatchObject({
      reason: 'auth_failed',
    });
  });

  it('classifies a 429 as rate limited', async () => {
    (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(resp(429, {}));
    await expect(requestVideoSuggestions({ title: 'T' })).rejects.toMatchObject({
      reason: 'rate_limited',
    });
  });

  it('surfaces a refusal distinctly', async () => {
    (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
      resp(200, { model: CLAUDE_MODEL, stop_reason: 'refusal', content: [], usage: {} }),
    );
    await expect(requestVideoSuggestions({ title: 'T' })).rejects.toMatchObject({
      reason: 'refused',
    });
  });

  it('reports a transport failure as a network error', async () => {
    (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('socket hang up'),
    );
    await expect(requestVideoSuggestions({ title: 'T' })).rejects.toMatchObject({
      reason: 'network_error',
    });
  });
});
