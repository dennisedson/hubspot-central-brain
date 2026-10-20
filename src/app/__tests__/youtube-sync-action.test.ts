import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * The public door onto the YouTube sync: what the daily HubSpot workflow
 * posts to. Unlike the Video card, it arrives over a URL anyone can reach, so
 * it must carry the shared secret before any YouTube quota is spent.
 */

let main: (ctx: unknown) => Promise<{ statusCode: number; body: string }>;
const runSync = vi.fn();

const OUTCOME = {
  recordsFound: 3,
  recordsUpdated: 2,
  analyticsStatus: 'ok',
  errors: [],
};

beforeEach(async () => {
  vi.resetModules();
  runSync.mockReset();
  runSync.mockResolvedValue(OUTCOME);
  // The real module, with only the YouTube round trip replaced.
  vi.doMock('../functions/YouTubeSync', async importOriginal => ({
    ...(await importOriginal<typeof import('../functions/YouTubeSync')>()),
    runSync,
  }));
  process.env.SYNC_SHARED_SECRET = 'top-secret';
  ({ main } = await import('../functions/YouTubeSyncAction'));
});

const workflowCall = (sharedSecret?: string) => ({
  accountId: 51869810,
  body: { callbackId: 'cb-1', inputFields: sharedSecret === undefined ? {} : { sharedSecret } },
});

const fields = (res: { body: string }) => JSON.parse(res.body).outputFields;

describe('YouTubeSyncAction.main', () => {
  it('refuses a call without the shared secret, before touching YouTube', async () => {
    const res = await main(workflowCall());
    expect(res.statusCode).toBe(401);
    expect(runSync).not.toHaveBeenCalled();
  });

  it('refuses a wrong secret', async () => {
    const res = await main(workflowCall('guess'));
    expect(res.statusCode).toBe(401);
    expect(runSync).not.toHaveBeenCalled();
  });

  it('is misconfigured, not open, when SYNC_SHARED_SECRET is unset', async () => {
    delete process.env.SYNC_SHARED_SECRET;
    const res = await main(workflowCall('anything'));
    expect(res.statusCode).toBe(500);
    expect(runSync).not.toHaveBeenCalled();
  });

  it('sweeps the whole portal and reports through outputFields', async () => {
    const res = await main(workflowCall('top-secret'));

    expect(res.statusCode).toBe(200);
    expect(runSync).toHaveBeenCalledWith(51869810, {});
    expect(fields(res)).toEqual({
      syncStatus: 'success',
      recordsFound: '3',
      recordsUpdated: '2',
      analyticsStatus: 'ok',
    });
  });

  it("reports 'partial' when some records failed", async () => {
    runSync.mockResolvedValue({ ...OUTCOME, errors: ['video 9: 403'] });
    const res = await main(workflowCall('top-secret'));
    expect(fields(res).syncStatus).toBe('partial');
  });

  it('answers 500 when the sync cannot run — a dead token must not look like success', async () => {
    // Prod's YouTube refresh token has died twice; 200 with nothing done is
    // how that went unnoticed.
    runSync.mockRejectedValue(new Error('invalid_grant'));
    const res = await main(workflowCall('top-secret'));
    expect(res.statusCode).toBe(500);
    expect(fields(res).syncStatus).toBe('error');
  });

  it('answers 400 when the gateway supplied no portal', async () => {
    const res = await main({ body: { inputFields: { sharedSecret: 'top-secret' } } });
    expect(res.statusCode).toBe(400);
    expect(runSync).not.toHaveBeenCalled();
  });
});
