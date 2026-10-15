import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * dashboard_data_api is the only public URL the CMS theme is allowed, so it is
 * the only place a bad secret can be turned away. Everything here is about
 * failing closed.
 */

vi.mock('../functions/ContentDataApi', () => ({ main: vi.fn() }));
vi.mock('../functions/AppSettingsApi', () => ({ main: vi.fn() }));

import { main } from '../functions/DashboardDataApi';
import { main as contentData } from '../functions/ContentDataApi';
import { main as appSettings } from '../functions/AppSettingsApi';

const SECRET = 'correct-horse-battery-staple';

function ok(body: unknown) {
  return { statusCode: 200, body: JSON.stringify(body) };
}

beforeEach(() => {
  vi.mocked(contentData).mockReset().mockResolvedValue(ok({ stages: [{ id: 's1', label: 'Idea' }], records: [] }));
  vi.mocked(appSettings).mockReset().mockResolvedValue(ok({ linearTeamId: 'T1', assigneeFilter: 'mine' }));
  vi.stubEnv('DASHBOARD_SHARED_SECRET', SECRET);
});

afterEach(() => { vi.unstubAllEnvs(); });

describe('DashboardDataApi — authentication', () => {
  it('rejects a request with no secret', async () => {
    const res = await main({ params: { portalId: ['1'] } });

    expect(res.statusCode).toBe(401);
    expect(contentData).not.toHaveBeenCalled();
  });

  it('rejects a wrong secret', async () => {
    const res = await main({ params: { portalId: ['1'], secret: ['nope'] } });

    expect(res.statusCode).toBe(401);
    expect(contentData).not.toHaveBeenCalled();
  });

  // A missing secret is a broken deploy, not permission to skip the check.
  it('fails closed when the secret is not configured on the portal', async () => {
    vi.stubEnv('DASHBOARD_SHARED_SECRET', '');

    const res = await main({ params: { portalId: ['1'], secret: [SECRET] } });

    expect(res.statusCode).toBe(500);
    expect(contentData).not.toHaveBeenCalled();
  });

  // The control: the correct secret still gets through.
  it('accepts the correct secret and merges both payloads', async () => {
    const res = await main({ params: { portalId: ['1'], secret: [SECRET] } });
    const body = JSON.parse(res.body) as { pipeline: { stages: unknown[] }; settings: { linearTeamId: string } };

    expect(res.statusCode).toBe(200);
    expect(body.pipeline.stages).toHaveLength(1);
    expect(body.settings.linearTeamId).toBe('T1');
  });

  // HubSpot delivers query params as arrays; a plain string must work too,
  // because that is the shape hubspot.serverless() would hand over.
  it('reads the secret whether it arrives as an array or a string', async () => {
    const res = await main({ parameters: { portalId: '1', secret: SECRET } });

    expect(res.statusCode).toBe(200);
  });
});

describe('DashboardDataApi — partial failures', () => {
  it('refuses to return half an answer when the pipeline fails', async () => {
    // Returning 0 records here would paint "0 active records" as the truth.
    vi.mocked(contentData).mockResolvedValue({ statusCode: 500, body: '{}' });

    const res = await main({ params: { portalId: ['1'], secret: [SECRET] } });

    expect(res.statusCode).toBe(502);
  });

  it('refuses to return half an answer when settings fail', async () => {
    vi.mocked(appSettings).mockResolvedValue({ statusCode: 500, body: '{}' });

    const res = await main({ params: { portalId: ['1'], secret: [SECRET] } });

    expect(res.statusCode).toBe(502);
  });

  it('requires a portalId', async () => {
    const res = await main({ params: { secret: [SECRET] } });

    expect(res.statusCode).toBe(400);
  });
});
