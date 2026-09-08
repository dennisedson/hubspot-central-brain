import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { main } from '../functions/BreezeMeetingRouter';
import { CONTENT_TYPE_VARIANTS } from '../lib/social-draft';

/**
 * Handler tests for the BreezeMeetingRouter agent tool (toolType TAKE_ACTION).
 *
 * THE ENUM ASSERTION IS THE POINT. `content_type` is a provisioned
 * enumeration; HubSpot rejects any value outside the option list with a 400,
 * which would make every create fail while the tool still returned 200. The
 * value written here is asserted against CONTENT_TYPE_VARIANTS — the same
 * keys provisioned in provision-objects.ts — so the two cannot drift.
 *
 * URL ASSERTIONS ARE ALSO THE POINT (issue #14): one exact literal for the
 * create call. Do not soften it into `toContain` or a regex.
 */

const TEST_PORTAL_ID = 51869810;

/** The exact URL this handler must POST each new content_piece to. */
const CREATE_URL = 'https://api.hubapi.com/crm/objects/2026-03/2-67505887';

const CONTENT_PIPELINE_ID = '926238627';
const IDEA_STAGE_ID = '1418659999';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

beforeEach(() => {
  mockFetch.mockReset();
  vi.stubEnv('PRIVATE_APP_ACCESS_TOKEN', 'hs-test-token');
});

afterEach(() => {
  vi.unstubAllEnvs();
});

interface Ctx {
  method: string;
  body: {
    origin?: { portalId: number };
    inputFields?: { meetingSummary?: string; actionItems?: string };
  };
  headers: Record<string, string>;
  query: Record<string, string>;
  accountId: number;
}

function ctx(actionItems: string, meetingSummary = '', accountId = TEST_PORTAL_ID): Ctx {
  return {
    method: 'POST',
    body: { origin: { portalId: accountId }, inputFields: { actionItems, meetingSummary } },
    headers: {},
    query: {},
    accountId,
  };
}

function mockCreateOk(id: string) {
  mockFetch.mockResolvedValueOnce({
    ok: true,
    status: 201,
    json: async () => ({ id }),
    text: async () => '',
  });
}

function mockCreateFailure(status = 400, body = 'PROPERTY_VALUE_NOT_VALID') {
  mockFetch.mockResolvedValueOnce({
    ok: false,
    status,
    json: async () => ({}),
    text: async () => body,
  });
}

/** Parse the JSON body of the nth fetch call. */
function requestBody(n = 0): Record<string, never> & { properties: Record<string, string> } {
  return JSON.parse(String(mockFetch.mock.calls[n][1].body));
}

function outputFields(res: { body: string }): Record<string, string> {
  return JSON.parse(res.body).outputFields;
}

describe('BreezeMeetingRouter.main — content_piece creation', () => {
  it('writes a content_type that is one of the provisioned enum options', async () => {
    mockCreateOk('7001');

    await main(ctx('Write a blog post about webhook retries'));

    const written = requestBody().properties.content_type;
    expect(Object.keys(CONTENT_TYPE_VARIANTS)).toContain(written);
  });

  it('creates the record at the exact CRM object URL', async () => {
    mockCreateOk('7001');

    await main(ctx('Write a blog post about webhook retries'));

    expect(String(mockFetch.mock.calls[0][0])).toBe(CREATE_URL);
    expect(mockFetch.mock.calls[0][1].method).toBe('POST');
  });

  it('places the new record in the Idea stage of the content pipeline', async () => {
    mockCreateOk('7001');

    await main(ctx('Draft a tutorial on association labels'));

    const props = requestBody().properties;
    expect(props.hs_pipeline).toBe(CONTENT_PIPELINE_ID);
    expect(props.hs_pipeline_stage).toBe(IDEA_STAGE_ID);
    expect(props.title).toBe('Draft a tutorial on association labels');
  });

  it('reports the created record and counts it', async () => {
    mockCreateOk('7001');

    const out = outputFields(await main(ctx('Write a blog post about webhook retries')));

    expect(out.contentIdeasCreated).toBe('1');
    expect(out.routingSummary).toContain('record 7001');
  });

  it('reports a rejected create in the failed list, not as a success', async () => {
    mockCreateFailure();

    const out = outputFields(await main(ctx('Write a blog post about webhook retries')));

    expect(out.contentIdeasCreated).toBe('0');
    expect(out.routingSummary).toContain('Failed to create');
  });

  it('carries the meeting summary into the record notes', async () => {
    mockCreateOk('7001');

    await main(ctx('Write a blog post about webhook retries', 'Discussed Q3 developer content'));

    expect(requestBody().properties.notes).toContain('Discussed Q3 developer content');
  });
});

describe('BreezeMeetingRouter.main — classification', () => {
  it('routes engineering work to Linear suggestions without creating a record', async () => {
    const out = outputFields(await main(ctx('Fix the pagination bug in the search endpoint')));

    expect(mockFetch).not.toHaveBeenCalled();
    expect(out.linearTasksSuggested).toContain('Fix the pagination bug');
    expect(out.contentIdeasCreated).toBe('0');
  });

  it('routes an unmatched item to HubSpot task suggestions', async () => {
    const out = outputFields(await main(ctx('Follow up with Priya about the offsite')));

    expect(mockFetch).not.toHaveBeenCalled();
    expect(out.hubspotTasksSuggested).toContain('Follow up with Priya');
  });

  it.each([
    ['Follow up with Priya about the offsite', 'pr inside "Priya"'],
    ['Make a decision on the vendor', 'ci inside "decision"'],
    ['Order a new device for Sam', 'dev inside "device"'],
    ['Review the latest numbers', 'test inside "latest"'],
    ['Approve the budget', 'pr inside "approve"'],
  ])('does not route %j to Linear (%s)', async item => {
    const out = outputFields(await main(ctx(item)));

    expect(out.linearTasksSuggested).toBe('  (none)');
    expect(out.hubspotTasksSuggested).toContain(item);
  });

  it('still matches a multi-word keyword', async () => {
    const out = outputFields(await main(ctx('Review the open pull request on the parser')));

    expect(out.linearTasksSuggested).toContain('pull request');
  });

  it('strips bullet and numbering prefixes before classifying', async () => {
    mockCreateOk('7001');

    await main(ctx('  - Write a blog post about webhook retries'));

    expect(requestBody().properties.title).toBe('Write a blog post about webhook retries');
  });

  it('splits multiple lines and routes each independently', async () => {
    mockCreateOk('7001');

    const out = outputFields(
      await main(
        ctx(
          [
            '• Write a blog post about webhook retries',
            '• Fix the pagination bug in the search endpoint',
            '• Follow up with Priya about the offsite',
          ].join('\n'),
        ),
      ),
    );

    expect(out.contentIdeasCreated).toBe('1');
    expect(out.linearTasksSuggested).toContain('Fix the pagination bug');
    expect(out.hubspotTasksSuggested).toContain('Follow up with Priya');
    expect(out.routingSummary).toContain('Routed 3 action items');
  });
});

describe('BreezeMeetingRouter.main — guards', () => {
  it('returns 200 with a no-op summary when no action items are given', async () => {
    const res = await main(ctx('   '));

    expect(res.statusCode).toBe(200);
    expect(outputFields(res).routingSummary).toBe('No action items provided.');
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('returns 500 when the portal has no config', async () => {
    const res = await main(ctx('Write a blog post', '', 999));

    expect(res.statusCode).toBe(500);
    expect(JSON.parse(res.body).error).toContain('999');
  });

  it('returns 500 when no access token is set', async () => {
    vi.unstubAllEnvs();
    vi.stubEnv('PRIVATE_APP_ACCESS_TOKEN', '');
    vi.stubEnv('HS_ACCESS_TOKEN', '');

    const res = await main(ctx('Write a blog post'));

    expect(res.statusCode).toBe(500);
    expect(JSON.parse(res.body).error).toBe('No HubSpot access token');
  });
});
