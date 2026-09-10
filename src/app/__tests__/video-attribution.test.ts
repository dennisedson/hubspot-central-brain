import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { main } from '../functions/VideoAttribution';
import hsmeta from '../functions/VideoAttribution-hsmeta.json';
import actionMeta from '../workflow-actions/generate-utm-hsmeta.json';

/**
 * The attribution action.
 *
 * Two gates carry the weight here, and both exist to stop the action doing
 * damage on a re-enrolment:
 *
 *   1. the video must be in the published stage
 *   2. a utm_link already on the record is never regenerated
 *
 * The second is the serious one. That exact string has been pasted into a
 * YouTube description; minting a new one silently orphans every click already
 * attributed to it. Both gates are bypassable with `force`, deliberately, and
 * that bypass needs a test as much as the gates do.
 */

const PORTAL = 51869810;
const PUBLIC_STAGE = '1418680348'; // video pipeline "Public", per portal-config

function ctx(body: Record<string, unknown>) {
  return { accountId: PORTAL, body } as unknown as Parameters<typeof main>[0];
}

function mockRecord(properties: Record<string, string | null>) {
  (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({ properties }),
    text: async () => '',
  } as unknown as Response);
}

describe('VideoAttribution gates', () => {
  const originalFetch = globalThis.fetch;
  const originalToken = process.env.HS_ACCESS_TOKEN;

  beforeEach(() => {
    process.env.HS_ACCESS_TOKEN = 'test-token';
    globalThis.fetch = vi.fn() as unknown as typeof fetch;
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
    if (originalToken === undefined) delete process.env.HS_ACCESS_TOKEN;
    else process.env.HS_ACCESS_TOKEN = originalToken;
    vi.restoreAllMocks();
  });

  it('refuses without an objectId', async () => {
    const res = await main(ctx({}));
    expect(res.statusCode).toBe(400);
  });

  it('skips a video that is not in the published stage', async () => {
    mockRecord({ hs_pipeline_stage: 'some-draft-stage', utm_link: null });
    const res = await main(ctx({ objectId: '1' }));
    expect(res.statusCode).toBe(200);
    expect(JSON.stringify(res.body)).toContain('not_published_stage');
  });

  it('never regenerates a link that is already in the wild', async () => {
    // The link is in a published video description. A new one orphans every
    // click already attributed to the old.
    mockRecord({
      hs_pipeline_stage: PUBLIC_STAGE,
      utm_link: 'https://x.com/p?utm_campaign=old',
      website_url: 'https://x.com/p',
      campaign_name: 'new',
    });
    const res = await main(ctx({ objectId: '1' }));
    expect(JSON.stringify(res.body)).toContain('already exists');
    // Only the read happened — nothing was written.
    expect((globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(1);
  });

  it('force overrides both gates', async () => {
    (globalThis.fetch as unknown as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          properties: {
            hs_pipeline_stage: 'draft',
            utm_link: 'https://x.com/p?utm_campaign=old',
            website_url: 'https://x.com/p',
            campaign_name: 'relaunch',
            title: 'My Video',
          },
        }),
        text: async () => '',
      } as unknown as Response)
      .mockResolvedValue({ ok: true, status: 200, json: async () => ({}), text: async () => '' } as unknown as Response);

    const res = await main(ctx({ objectId: '1', force: 'true' }));
    expect(res.statusCode).toBe(200);
    expect(JSON.stringify(res.body)).toContain('utm_campaign=relaunch');
  });

  it('reports a data problem rather than failing when the campaign is missing', async () => {
    // FAIL_CONTINUE territory: the workflow should branch, not error.
    mockRecord({
      hs_pipeline_stage: PUBLIC_STAGE,
      utm_link: null,
      website_url: 'https://x.com/p',
      campaign_name: null,
    });
    const res = await main(ctx({ objectId: '1' }));
    expect(res.statusCode).toBeLessThan(500);
    expect(JSON.stringify(res.body)).toMatch(/campaign/i);
  });

  it('prefers a workflow input over the stored property', async () => {
    // One action can set the destination and mint the link in the same call —
    // saveWebsiteLink and linkCampaign folded together.
    (globalThis.fetch as unknown as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          properties: {
            hs_pipeline_stage: PUBLIC_STAGE,
            utm_link: null,
            website_url: 'https://stored.example.com/p',
            campaign_name: 'stored',
            title: 'T',
          },
        }),
        text: async () => '',
      } as unknown as Response)
      .mockResolvedValue({ ok: true, status: 200, json: async () => ({}), text: async () => '' } as unknown as Response);

    const res = await main(ctx({ objectId: '1', campaignName: 'from-workflow' }));
    expect(JSON.stringify(res.body)).toContain('utm_campaign=from-workflow');
  });

  it('surfaces a 404 as a 404, not a generic failure', async () => {
    (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      status: 404,
      json: async () => ({}),
      text: async () => 'not found',
    } as unknown as Response);
    expect((await main(ctx({ objectId: '999' }))).statusCode).toBe(404);
  });
});

describe('generate-utm workflow action config', () => {
  it('gives every input field exactly one supportedValueType', () => {
    // Build #224 failed on precisely this. It is validated server-side at
    // upload, so nothing else local catches it.
    for (const f of actionMeta.config.inputFields ?? []) {
      expect(f.supportedValueTypes).toHaveLength(1);
    }
  });

  it('declares WORKFLOWS, matching the actions that work', () => {
    expect(actionMeta.config.supportedClients.map((c) => c.client)).toContain('WORKFLOWS');
  });

  it('points its actionUrl at the function this handler serves', () => {
    expect(actionMeta.config.actionUrl).toContain(hsmeta.config.endpoint.path);
  });
});
