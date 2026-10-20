import { runSync, outputFieldsFor } from './YouTubeSync';
import { verifySharedSecret } from '../lib/shared-secret';

/**
 * The public door onto the YouTube metrics sync — what the
 * "YouTube → Sync Metrics (Daily)" workflow posts to.
 *
 * WHY A SEPARATE FUNCTION
 * -----------------------
 * The sync has two callers. The Video card calls `youtube_sync` by uid over
 * `hubspot.serverless()`, which never leaves HubSpot and needs no URL. A
 * workflow action can only reach a function through a public URL, and a public
 * URL is reachable by anyone. Until 2026-10-20 one function served both, owned
 * /youtube-sync with no secret at all, and a GitHub cron called it that way —
 * so anyone with the URL could spend the portal's YouTube quota.
 *
 * Splitting the doors keeps the card's private and makes this one prove the
 * caller: `youtube_sync` publishes no endpoint, and this function owns the
 * path and checks SYNC_SHARED_SECRET before anything else happens. Same
 * pattern as the CMS dashboard's `dashboard_data_api` (#127).
 *
 * The daily cadence is the workflow's `enrollmentSchedule`, set in the UI, the
 * same as the other "(Daily)" workflows. The GitHub cron that used to call the
 * sync existed because HubSpot was believed to have no scheduler; it does.
 */

interface ActionContext {
  accountId?: number;
  body?: { inputFields?: { sharedSecret?: string } };
}

function respond(statusCode: number, body: Record<string, unknown>) {
  return { statusCode, body: JSON.stringify(body) };
}

export async function main(context: ActionContext): Promise<{ statusCode: number; body: string }> {
  const expected = process.env.SYNC_SHARED_SECRET;
  if (!expected) {
    console.error('SYNC_SHARED_SECRET is not set');
    return respond(500, { error: 'Server misconfiguration', outputFields: { syncStatus: 'error' } });
  }
  if (!verifySharedSecret(context.body?.inputFields?.sharedSecret, expected)) {
    console.warn('Rejected YouTubeSyncAction request: invalid shared secret');
    return respond(401, { error: 'Unauthorized' });
  }

  // A gateway request always carries the portal. Without one there is nothing
  // to sync, and guessing a portal is how writes land in the wrong one.
  const portalId = context.accountId;
  if (!portalId) {
    return respond(400, { error: 'Missing portal', outputFields: { syncStatus: 'error' } });
  }

  try {
    // The workflow sweeps the portal; a single record is the card's job.
    const outcome = await runSync(portalId, {});
    return respond(200, { ...outcome, outputFields: outputFieldsFor(outcome) });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('YouTube sync failed:', message);
    // 500 deliberately, as in YouTubeSync: a sync that cannot authenticate or
    // reach YouTube has done nothing, and 200 is how a dead refresh token went
    // unnoticed. In a workflow it shows as a failed action in the history.
    return respond(500, { message, outputFields: { syncStatus: 'error' } });
  }
}
