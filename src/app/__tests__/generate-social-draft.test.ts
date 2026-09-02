import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { main } from '../functions/GenerateSocialDraft';

/**
 * Handler tests for GenerateSocialDraft.
 *
 * URL ASSERTIONS ARE THE POINT (issue #14). Two exact literals: the read
 * (`objectPath` + `?properties=`) and the write (`objectPath`, via `hsUpdate`
 * in hubspot-client). Do not soften these into `toContain` or a regex.
 *
 * The write path is deliberately NOT mocked at the module boundary — the real
 * `hsUpdate` runs against the mocked `fetch` so its URL is pinned here too.
 */

const TEST_PORTAL_ID = 51869810;
const OBJECT_ID = '4201';

// --- the exact URLs this handler must call -------------------------------
const READ_URL =
  'https://api.hubapi.com/crm/v3/objects/2-67505887/4201' +
  '?properties=title,content_type,published_url,topic_tags,enterpret_theme,social_post_draft';
const WRITE_URL = 'https://api.hubapi.com/crm/v3/objects/2-67505887/4201';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

beforeEach(() => {
  mockFetch.mockReset();
  vi.stubEnv('PRIVATE_APP_ACCESS_TOKEN', 'hs-test-token');
});

afterEach(() => {
  vi.unstubAllEnvs();
});

function urls(): string[] {
  return mockFetch.mock.calls.map(call => String(call[0]));
}

/** A realistic content_piece: blog post, published, tagged, with a theme. */
const RECORD_PROPERTIES: Record<string, string | null> = {
  title: 'Retrying HubSpot webhooks without duplicating work',
  content_type: 'blog_post',
  published_url: 'https://developers.hubspot.com/blog/retrying-webhooks',
  topic_tags: 'api;developer_platform',
  enterpret_theme: 'Webhook reliability',
  social_post_draft: null,
};

function mockRead(properties: Record<string, string | null> = RECORD_PROPERTIES) {
  mockFetch.mockResolvedValueOnce({
    ok: true,
    status: 200,
    json: async () => ({ id: OBJECT_ID, properties }),
    text: async () => '',
  });
}

function mockWriteOk() {
  mockFetch.mockResolvedValueOnce({
    ok: true,
    status: 200,
    json: async () => ({ id: OBJECT_ID }),
    text: async () => '',
  });
}

function mockFailure(status: number, body = 'boom') {
  mockFetch.mockResolvedValueOnce({
    ok: false,
    status,
    json: async () => ({}),
    text: async () => body,
  });
}

describe('GenerateSocialDraft.main — request URLs', () => {
  it('reads and writes at the exact CRM object URLs', async () => {
    mockRead();
    mockWriteOk();

    await main({ accountId: TEST_PORTAL_ID, parameters: { objectId: OBJECT_ID } });

    expect(urls()).toEqual([READ_URL, WRITE_URL]);
  });

  it('writes with PATCH and only the social_post_draft property', async () => {
    mockRead();
    mockWriteOk();

    const res = await main({ accountId: TEST_PORTAL_ID, parameters: { objectId: OBJECT_ID } });

    const [url, init] = mockFetch.mock.calls[1];
    expect(url).toBe(WRITE_URL);
    expect(init.method).toBe('PATCH');
    expect(init.headers.Authorization).toBe('Bearer hs-test-token');
    const written = JSON.parse(init.body);
    expect(Object.keys(written.properties)).toEqual(['social_post_draft']);
    // The draft written is exactly the draft returned to the caller.
    expect(written.properties.social_post_draft).toBe(JSON.parse(res.body).draft);
  });
});

describe('GenerateSocialDraft.main — happy path', () => {
  it('generates and stores a draft built from the record properties', async () => {
    mockRead();
    mockWriteOk();

    const res = await main({ accountId: TEST_PORTAL_ID, parameters: { objectId: OBJECT_ID } });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);

    expect(body.skipped).toBe(false);
    expect(body.overwritten).toBe(false);
    expect(body.objectId).toBe(OBJECT_ID);
    expect(body.draftLength).toBe(body.draft.length);
    expect(body.outputFields).toEqual({
      draftStatus: 'generated',
      draftLength: String(body.draft.length),
    });

    // blog_post variant copy, the title, the theme sentence, the URL, hashtags.
    expect(body.draft).toContain('New blog post is live.');
    expect(body.draft).toContain('Retrying HubSpot webhooks without duplicating work');
    expect(body.draft).toContain('Webhook reliability');
    expect(body.draft).toContain('Read the full post: https://developers.hubspot.com/blog/retrying-webhooks');
    expect(body.draft).toContain('#API #DeveloperPlatform');
  });

  it('accepts the workflow payload shape (hs_object_id + inputFields)', async () => {
    mockRead();
    mockWriteOk();

    const res = await main({
      accountId: TEST_PORTAL_ID,
      body: { callbackId: 'cb-1', hs_object_id: OBJECT_ID, inputFields: {} },
    });

    expect(res.statusCode).toBe(200);
    expect(mockFetch.mock.calls[0][0]).toBe(READ_URL);
    expect(JSON.parse(res.body).outputFields.draftStatus).toBe('generated');
  });

  it('still produces a draft for a sparse record', async () => {
    mockRead({
      title: 'Untitled experiment',
      content_type: null,
      published_url: null,
      topic_tags: null,
      enterpret_theme: null,
      social_post_draft: null,
    });
    mockWriteOk();

    const body = JSON.parse(
      (await main({ accountId: TEST_PORTAL_ID, parameters: { objectId: OBJECT_ID } })).body,
    );
    expect(body.draft).toBe('Sharing something new.\n\nUntitled experiment');
  });
});

describe('GenerateSocialDraft.main — never clobber a human edit', () => {
  it('skips when social_post_draft already has content', async () => {
    mockRead({ ...RECORD_PROPERTIES, social_post_draft: 'A human wrote this. Leave it alone.' });

    const res = await main({ accountId: TEST_PORTAL_ID, parameters: { objectId: OBJECT_ID } });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);

    expect(body.skipped).toBe(true);
    expect(body.reason).toBe('draft already exists');
    expect(body.outputFields).toEqual({ draftStatus: 'skipped', reason: 'draft already exists' });
    // The write must never happen: read only.
    expect(urls()).toEqual([READ_URL]);
  });

  it('treats a whitespace-only draft as empty and writes', async () => {
    mockRead({ ...RECORD_PROPERTIES, social_post_draft: '   \n  ' });
    mockWriteOk();

    const body = JSON.parse(
      (await main({ accountId: TEST_PORTAL_ID, parameters: { objectId: OBJECT_ID } })).body,
    );
    expect(body.skipped).toBe(false);
    expect(body.overwritten).toBe(false);
    expect(urls()).toEqual([READ_URL, WRITE_URL]);
  });

  it('force=true overwrites an existing draft and reports "regenerated"', async () => {
    mockRead({ ...RECORD_PROPERTIES, social_post_draft: 'A human wrote this.' });
    mockWriteOk();

    const res = await main({
      accountId: TEST_PORTAL_ID,
      parameters: { objectId: OBJECT_ID, force: 'true' },
    });
    const body = JSON.parse(res.body);

    expect(body.skipped).toBe(false);
    expect(body.overwritten).toBe(true);
    expect(body.outputFields.draftStatus).toBe('regenerated');
    expect(urls()).toEqual([READ_URL, WRITE_URL]);
  });

  it.each(['1', 'yes', 'on', 'TRUE'])('treats force="%s" as truthy', async force => {
    mockRead({ ...RECORD_PROPERTIES, social_post_draft: 'existing' });
    mockWriteOk();

    const body = JSON.parse(
      (await main({ accountId: TEST_PORTAL_ID, parameters: { objectId: OBJECT_ID, force } })).body,
    );
    expect(body.skipped).toBe(false);
  });

  it.each(['false', 'no', '0', ''])('treats force="%s" as falsy', async force => {
    mockRead({ ...RECORD_PROPERTIES, social_post_draft: 'existing' });

    const body = JSON.parse(
      (await main({ accountId: TEST_PORTAL_ID, parameters: { objectId: OBJECT_ID, force } })).body,
    );
    expect(body.skipped).toBe(true);
    expect(urls()).toEqual([READ_URL]);
  });

  it('reads force from inputFields when Workflows invokes the action', async () => {
    mockRead({ ...RECORD_PROPERTIES, social_post_draft: 'existing' });
    mockWriteOk();

    const body = JSON.parse(
      (
        await main({
          accountId: TEST_PORTAL_ID,
          body: { hs_object_id: OBJECT_ID, inputFields: { force: 'true' } },
        })
      ).body,
    );
    expect(body.overwritten).toBe(true);
  });
});

describe('GenerateSocialDraft.main — status codes', () => {
  it('returns 400 when objectId is missing', async () => {
    const res = await main({ accountId: TEST_PORTAL_ID, parameters: {} });
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).outputFields).toEqual({
      draftStatus: 'error',
      reason: 'missing_object_id',
    });
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('returns 400 when accountId is missing from the context', async () => {
    const res = await main({ parameters: { objectId: OBJECT_ID } });
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).outputFields.reason).toBe('missing_account_id');
  });

  it('returns 500 when no HubSpot access token is available', async () => {
    vi.stubEnv('PRIVATE_APP_ACCESS_TOKEN', '');
    vi.stubEnv('HS_ACCESS_TOKEN', '');
    const res = await main({ accountId: TEST_PORTAL_ID, parameters: { objectId: OBJECT_ID } });
    expect(res.statusCode).toBe(500);
    expect(JSON.parse(res.body).outputFields.reason).toBe('no_access_token');
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('returns 404 when the content piece does not exist', async () => {
    mockFailure(404, 'not found');
    const res = await main({ accountId: TEST_PORTAL_ID, parameters: { objectId: OBJECT_ID } });
    expect(res.statusCode).toBe(404);
    expect(JSON.parse(res.body).outputFields.reason).toBe('read_failed_404');
    expect(urls()).toEqual([READ_URL]);
  });

  it('returns 502 when the read fails for any other reason', async () => {
    mockFailure(500, 'internal error');
    const res = await main({ accountId: TEST_PORTAL_ID, parameters: { objectId: OBJECT_ID } });
    expect(res.statusCode).toBe(502);
    expect(JSON.parse(res.body).outputFields.reason).toBe('read_failed_500');
  });

  it('returns 502 when the read throws at the transport level', async () => {
    mockFetch.mockRejectedValueOnce(new Error('socket hang up'));
    const res = await main({ accountId: TEST_PORTAL_ID, parameters: { objectId: OBJECT_ID } });
    expect(res.statusCode).toBe(502);
    expect(JSON.parse(res.body).outputFields.reason).toBe('read_failed');
    expect(JSON.parse(res.body).error).toBe('Could not read content piece 4201: socket hang up');
  });

  it('returns 502 when the write fails', async () => {
    mockRead();
    mockFailure(403, 'missing write scope');

    const res = await main({ accountId: TEST_PORTAL_ID, parameters: { objectId: OBJECT_ID } });
    expect(res.statusCode).toBe(502);
    expect(JSON.parse(res.body).outputFields.reason).toBe('write_failed');
    expect(JSON.parse(res.body).error).toBe(
      'Could not write social_post_draft: HubSpot update failed 403: missing write scope',
    );
    expect(urls()).toEqual([READ_URL, WRITE_URL]);
  });
});
