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
    expect(body.model).toBe('claude-sonnet-5-5');
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
    // Sonnet is the default because the function has 20 seconds to finish.
    expect((JSON.parse(call![1].body as string) as { model: string }).model).toBe('claude-sonnet-5-5');
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

/**
 * HubSpot kills an app function at 20 seconds:
 *
 *   [runServerlessFunction] The serverless function 'changelog_draft_api'
 *   timed out. Task timed out after 20.00 seconds.
 *
 * There is no timeout field in the hsmeta, so the only options are to finish
 * sooner or to fail in a way that says what to do about it. The first turn of a
 * real session succeeded and the follow-up was killed mid-generation, which is
 * how this was found.
 */
describe('the 20-second budget', () => {
  it('gives up before the platform does, with advice rather than a RequestId', async () => {
    vi.useFakeTimers();
    mockFetch().mockImplementation((url: string, init?: { method?: string; body?: string }) => {
      if (String(url).includes('api.anthropic.com')) {
        // A model that never answers.
        return new Promise(() => {});
      }
      return recordFetch({
        title: 'x', notes: NOTES, hs_pipeline: '929918080',
        changelog_draft: null, changelog_draft_mode: null,
      })(url, init);
    });

    const pending = main({
      accountId: DEV_PORTAL,
      parameters: { action: 'turn', objectId: '1', message: 'go' },
    });
    await vi.advanceTimersByTimeAsync(17_000);
    const res = await pending;
    vi.useRealTimers();

    expect(res.statusCode).toBe(504);
    const body = JSON.parse(res.body) as { error: string; detail: string };
    expect(body.error).toMatch(/did not answer in time/);
    expect(body.detail).toMatch(/Sonnet or Haiku/);
  });

  it('caps max_tokens so one runaway answer cannot eat the budget', async () => {
    mockFetch().mockImplementation(recordFetch({
      title: 'x', notes: NOTES, hs_pipeline: '929918080',
      changelog_draft: null, changelog_draft_mode: null,
    }));

    await main({ accountId: DEV_PORTAL, parameters: { action: 'turn', objectId: '1', message: 'go' } });

    const call = mockFetch().mock.calls.find(([u]) => String(u).includes('api.anthropic.com'));
    const body = JSON.parse(call![1].body as string) as { max_tokens: number; thinking: { type: string } };
    expect(body.max_tokens).toBeLessThanOrEqual(2048);
    // Thinking happens before any output, so it is the worst use of the budget.
    expect(body.thinking).toEqual({ type: 'disabled' });
  });
});

/**
 * Creating the Google Doc.
 *
 * Document creation is not idempotent by nature: call it twice and Drive makes
 * two documents, with nothing to say which is the real one. `changelog_doc_url`
 * being set is the record of that — the same rule the Asana task lookup had to
 * learn the hard way.
 */
describe('the createDoc action', () => {
  beforeEach(() => {
    // The DRIVE token, not the YouTube one: Google refuses to grant both in a
    // single authorisation, so they are separate secrets.
    process.env.GOOGLE_DRIVE_REFRESH_TOKEN = 'drive-refresh';
    process.env.YOUTUBE_CLIENT_ID = 'id';
    process.env.YOUTUBE_CLIENT_SECRET = 'secret';
  });

  /** Routes Google, HubSpot search, and HubSpot writes. */
  function driveFetch(record: Record<string, string | null>, opts: { folderId?: string } = {}) {
    const writes: Array<{ url: string; properties: Record<string, string> }> = [];
    mockFetch().mockImplementation((url: string, init?: { method?: string; body?: string }) => {
      const u = String(url);
      if (u.includes('oauth2.googleapis.com')) {
        // googleTokenRequest reads the body with res.json(), because Google
        // puts its error detail there on a 4xx.
        return Promise.resolve({ ok: true, status: 200,
          json: async () => ({ access_token: 'g-token', expires_in: 3600 }),
          text: async () => '' } as unknown as Response);
      }
      if (u.includes('upload/drive')) {
        return Promise.resolve({ ok: true, status: 200, text: async () => JSON.stringify({ id: 'doc-99' }) } as unknown as Response);
      }
      if (u.includes('googleapis.com/drive/v3/files')) {
        // A GET is the folder check; a POST creates one.
        if (init?.method === 'POST') {
          return Promise.resolve({ ok: true, status: 200, text: async () => JSON.stringify({ id: 'new-folder' }) } as unknown as Response);
        }
        return Promise.resolve({ ok: true, status: 200,
          text: async () => JSON.stringify({ id: opts.folderId, trashed: false, mimeType: 'application/vnd.google-apps.folder' }) } as unknown as Response);
      }
      if (init?.method === 'PATCH') {
        writes.push({ url: u, properties: (JSON.parse(init.body ?? '{}') as { properties: Record<string, string> }).properties });
        return Promise.resolve({ ok: true, status: 200, json: async () => ({}), text: async () => '' } as unknown as Response);
      }
      if (u.includes('/search')) {
        return Promise.resolve({ ok: true, status: 200,
          json: async () => ({ results: [{ id: 'cfg-1', properties: { google_drive_folder_id: opts.folderId ?? '' } }] }),
          text: async () => '' } as unknown as Response);
      }
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ properties: record }), text: async () => '' } as unknown as Response);
    });
    return writes;
  }

  it('creates the document and stores its URL on the record', async () => {
    const writes = driveFetch({
      title: 'A changelog', changelog_draft: '# Title\n\nBody.',
      changelog_doc_url: null, hs_pipeline: '929918080',
    }, { folderId: 'folder-1' });

    const res = await main({ accountId: DEV_PORTAL, parameters: { action: 'createDoc', objectId: '1' } });

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).docUrl).toBe('https://docs.google.com/document/d/doc-99/edit');
    const recordWrite = writes.find(w => w.properties.changelog_doc_url);
    expect(recordWrite!.properties.changelog_doc_url).toBe('https://docs.google.com/document/d/doc-99/edit');
  });

  it('refuses when a document already exists, rather than making a second', async () => {
    driveFetch({
      title: 'x', changelog_draft: 'body',
      changelog_doc_url: 'https://docs.google.com/document/d/existing/edit',
      hs_pipeline: '929918080',
    });

    const res = await main({ accountId: DEV_PORTAL, parameters: { action: 'createDoc', objectId: '1' } });

    expect(res.statusCode).toBe(409);
    expect(JSON.parse(res.body).docUrl).toContain('existing');
  });

  it('refuses when there is no draft to put in it', async () => {
    driveFetch({ title: 'x', changelog_draft: '   ', changelog_doc_url: null, hs_pipeline: '929918080' });
    const res = await main({ accountId: DEV_PORTAL, parameters: { action: 'createDoc', objectId: '1' } });
    expect(res.statusCode).toBe(400);
  });

  it('creates the folder when the portal has none, and remembers it', async () => {
    // drive.file cannot search for a folder it did not create, so a missing id
    // means a new folder — never a found one.
    const writes = driveFetch({
      title: 'x', changelog_draft: 'body', changelog_doc_url: null, hs_pipeline: '929918080',
    }, { folderId: '' });

    await main({ accountId: DEV_PORTAL, parameters: { action: 'createDoc', objectId: '1' } });

    const configWrite = writes.find(w => w.properties.google_drive_folder_id);
    expect(configWrite!.properties.google_drive_folder_id).toBe('new-folder');
  });
});
