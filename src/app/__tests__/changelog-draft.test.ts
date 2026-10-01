import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { main } from '../functions/ChangelogDraft';

/**
 * The drafting function.
 *
 * Two things here have bitten this codebase before and are asserted
 * explicitly: the draft is never written back into `notes`, which the webhook
 * rewrites from Linear on every change, and portalId must survive arriving as
 * a query-param array rather than a string.
 */

const DEV_PORTAL = 51869810;
const CONTENT = '2-67505887';
const originalFetch = globalThis.fetch;

beforeEach(() => {
  globalThis.fetch = vi.fn() as unknown as typeof fetch;
  process.env.PRIVATE_APP_ACCESS_TOKEN = 'hs-token';
  process.env.ANTHROPIC_API_KEY = 'sk-test';
});
afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

const mockFetch = () => globalThis.fetch as unknown as ReturnType<typeof vi.fn>;

const NOTES = `## New Rollout Created

**Rollout ID:** 310955
**Name:** hs app logs CLI command
**State:** In Development
**Type:** ADDITIONAL_FUNCTIONALITY
**Audiences:** API developer
**Use Cases:** Automate work
**User Impact:** MODERATE

### Description

Developers can now fetch all app logs directly to their terminal via a CLI command.`;

function recordFetch(props: Record<string, string | null>) {
  return (url: string, init?: { method?: string; body?: string }) => {
    if (String(url).includes('api.anthropic.com')) {
      return Promise.resolve({
        ok: true, status: 200,
        text: async () => JSON.stringify({
          content: [{ type: 'text', text: '### A draft\n\nSomething useful.' }],
          stop_reason: 'end_turn',
        }),
      } as unknown as Response);
    }
    if (init?.method === 'PATCH') {
      return Promise.resolve({ ok: true, status: 200, json: async () => ({}), text: async () => '' } as unknown as Response);
    }
    if (String(url).includes('/search')) {
      return Promise.resolve({
        ok: true, status: 200,
        json: async () => ({ results: [{ id: 'cfg', properties: {} }] }),
        text: async () => '',
      } as unknown as Response);
    }
    return Promise.resolve({
      ok: true, status: 200,
      json: async () => ({ properties: props }),
      text: async () => '',
    } as unknown as Response);
  };
}

describe('the source action', () => {
  it('parses the rollout template and reports nothing missing', async () => {
    mockFetch().mockImplementation(recordFetch({
      title: 'hs app logs', notes: NOTES, hs_pipeline: '929918080',
      changelog_draft: null, changelog_draft_mode: null,
    }));

    const res = await main({ accountId: DEV_PORTAL, parameters: { action: 'source', objectId: '1' } });
    const body = JSON.parse(res.body) as {
      fields: Record<string, string>; missingForStandalone: string[]; isChangelog: boolean;
    };

    expect(body.fields['Name']).toBe('hs app logs CLI command');
    expect(body.missingForStandalone).toEqual([]);
    expect(body.isChangelog).toBe(true);
  });

  it('says when the record is not on the changelog pipeline', async () => {
    mockFetch().mockImplementation(recordFetch({
      title: 'A blog post', notes: NOTES, hs_pipeline: '926238627',
      changelog_draft: null, changelog_draft_mode: null,
    }));

    const res = await main({ accountId: DEV_PORTAL, parameters: { action: 'source', objectId: '1' } });
    expect((JSON.parse(res.body) as { isChangelog: boolean }).isChangelog).toBe(false);
  });

  it('warns about a thin record before anyone spends a model call on it', async () => {
    mockFetch().mockImplementation(recordFetch({
      title: 'Sparse', notes: '**Name:** Something\n\n### Description\n\nShort.',
      hs_pipeline: '929918080', changelog_draft: null, changelog_draft_mode: null,
    }));

    const res = await main({ accountId: DEV_PORTAL, parameters: { action: 'source', objectId: '1' } });
    const { missingForStandalone } = JSON.parse(res.body) as { missingForStandalone: string[] };

    expect(missingForStandalone).toContain('Type');
    expect(missingForStandalone).toContain('Audiences');
  });

  it('accepts portalId arriving as a query-param array', async () => {
    // HubSpot delivers query params in `params` as ARRAYS, not strings.
    mockFetch().mockImplementation(recordFetch({
      title: 'x', notes: NOTES, hs_pipeline: '929918080',
      changelog_draft: null, changelog_draft_mode: null,
    }));

    const res = await main({
      params: { portalId: [String(DEV_PORTAL)], action: ['source'], objectId: ['1'] },
    });
    expect(res.statusCode).toBe(200);
  });
});

describe('the save action', () => {
  it('writes the draft to changelog_draft and never to notes', async () => {
    // notes is the Linear description, rewritten on every webhook. A draft
    // written there would be destroyed the next time the issue moved.
    const writes: Array<Record<string, string>> = [];
    mockFetch().mockImplementation((url: string, init?: { method?: string; body?: string }) => {
      if (init?.method === 'PATCH') {
        writes.push((JSON.parse(init.body ?? '{}') as { properties: Record<string, string> }).properties);
        return Promise.resolve({ ok: true, status: 200, json: async () => ({}), text: async () => '' } as unknown as Response);
      }
      return recordFetch({})(url, init);
    });

    const res = await main({
      accountId: DEV_PORTAL,
      parameters: { action: 'save', objectId: '1', mode: 'rollup', draft: '### Entry\n\nText.' },
    });

    expect(res.statusCode).toBe(200);
    expect(writes[0].changelog_draft).toBe('### Entry\n\nText.');
    expect(writes[0].changelog_draft_mode).toBe('rollup');
    expect(writes[0]).not.toHaveProperty('notes');
  });

  it('refuses a save with no draft field rather than blanking the record', async () => {
    mockFetch().mockImplementation(recordFetch({}));
    const res = await main({ accountId: DEV_PORTAL, parameters: { action: 'save', objectId: '1' } });
    expect(res.statusCode).toBe(400);
  });

  it('allows deliberately clearing the draft', async () => {
    const writes: Array<Record<string, string>> = [];
    mockFetch().mockImplementation((url: string, init?: { method?: string; body?: string }) => {
      if (init?.method === 'PATCH') {
        writes.push((JSON.parse(init.body ?? '{}') as { properties: Record<string, string> }).properties);
        return Promise.resolve({ ok: true, status: 200, json: async () => ({}), text: async () => '' } as unknown as Response);
      }
      return recordFetch({})(url, init);
    });

    await main({ accountId: DEV_PORTAL, parameters: { action: 'save', objectId: '1', mode: 'standalone', draft: '' } });
    expect(writes[0].changelog_draft).toBe('');
  });
});

describe('the turn action', () => {
  it('caches system plus the record facts, not the system block alone', async () => {
    // The system prompt is 901-1,010 tokens, either side of Anthropic's
    // 1,024-token minimum cacheable prefix — and a prefix under the minimum
    // silently does not cache at all. The breakpoint therefore sits at the end
    // of the opening user turn, where the prefix averages ~1,830 tokens.
    mockFetch().mockImplementation(recordFetch({
      title: 'hs app logs', notes: NOTES, hs_pipeline: '929918080',
      changelog_draft: null, changelog_draft_mode: null,
    }));

    await main({
      accountId: DEV_PORTAL,
      parameters: { action: 'turn', objectId: '1', mode: 'rollup', message: 'Draft it' },
    });

    const call = mockFetch().mock.calls.find(([u]) => String(u).includes('api.anthropic.com'));
    const body = JSON.parse(call![1].body as string) as {
      system: Array<{ text: string; cache_control?: unknown }>;
      messages: Array<{ role: string; content: string | Array<{ text: string; cache_control?: unknown }> }>;
    };

    expect(body.system[0].cache_control).toBeUndefined();
    expect(body.system[0].text).toContain('Digest Entry');

    const opening = body.messages[0].content as Array<{ text: string; cache_control?: unknown }>;
    expect(body.messages[0].role).toBe('user');
    expect(opening[0].cache_control).toBeDefined();
    expect(opening[0].text).toContain('hs app logs CLI command');
    expect(body.messages[body.messages.length - 1].content).toBe('Draft it');
  });

  it('uses the portal\'s configured model and thinking setting', async () => {
    mockFetch().mockImplementation((url: string, init?: { method?: string; body?: string }) => {
      if (String(url).includes('/search')) {
        return Promise.resolve({
          ok: true, status: 200,
          json: async () => ({ results: [{ properties: {
            changelog_model: 'sonnet', changelog_thinking: 'off',
          } }] }),
          text: async () => '',
        } as unknown as Response);
      }
      return recordFetch({
        title: 'x', notes: NOTES, hs_pipeline: '929918080',
        changelog_draft: null, changelog_draft_mode: null,
      })(url, init);
    });

    await main({
      accountId: DEV_PORTAL,
      parameters: { action: 'turn', objectId: '1', message: 'go' },
    });

    const call = mockFetch().mock.calls.find(([u]) => String(u).includes('api.anthropic.com'));
    const body = JSON.parse(call![1].body as string) as { model: string; thinking: { type: string } };
    expect(body.model).toBe('claude-sonnet-5');
    expect(body.thinking).toEqual({ type: 'disabled' });
  });

  it('falls back to the default model when the setting is empty or unknown', async () => {
    mockFetch().mockImplementation((url: string, init?: { method?: string; body?: string }) => {
      if (String(url).includes('/search')) {
        return Promise.resolve({
          ok: true, status: 200,
          json: async () => ({ results: [{ properties: { changelog_model: 'gpt-4' } }] }),
          text: async () => '',
        } as unknown as Response);
      }
      return recordFetch({
        title: 'x', notes: NOTES, hs_pipeline: '929918080',
        changelog_draft: null, changelog_draft_mode: null,
      })(url, init);
    });

    await main({ accountId: DEV_PORTAL, parameters: { action: 'turn', objectId: '1', message: 'go' } });

    const call = mockFetch().mock.calls.find(([u]) => String(u).includes('api.anthropic.com'));
    expect((JSON.parse(call![1].body as string) as { model: string }).model).toBe('claude-opus-5-5');
  });

  it('tells the model to revise an existing draft rather than start over', async () => {
    mockFetch().mockImplementation(recordFetch({
      title: 'x', notes: NOTES, hs_pipeline: '929918080',
      changelog_draft: 'An earlier draft.', changelog_draft_mode: 'standalone',
    }));

    await main({
      accountId: DEV_PORTAL,
      parameters: { action: 'turn', objectId: '1', mode: 'standalone', message: 'shorter' },
    });

    const call = mockFetch().mock.calls.find(([u]) => String(u).includes('api.anthropic.com'));
    const body = JSON.parse(call![1].body as string) as {
      messages: Array<{ content: Array<{ text: string }> }>;
    };
    expect(body.messages[0].content[0].text).toContain('An earlier draft.');
    expect(body.messages[0].content[0].text).toMatch(/revise it rather than starting over/);
  });

  it('drops malformed history instead of failing the turn', async () => {
    mockFetch().mockImplementation(recordFetch({
      title: 'x', notes: NOTES, hs_pipeline: '929918080',
      changelog_draft: null, changelog_draft_mode: null,
    }));

    const res = await main({
      accountId: DEV_PORTAL,
      parameters: {
        action: 'turn', objectId: '1', message: 'go',
        conversation: 'not json at all',
      },
    });
    expect(res.statusCode).toBe(200);
  });

  it('refuses a turn with no message', async () => {
    mockFetch().mockImplementation(recordFetch({}));
    const res = await main({ accountId: DEV_PORTAL, parameters: { action: 'turn', objectId: '1' } });
    expect(res.statusCode).toBe(400);
  });
});
