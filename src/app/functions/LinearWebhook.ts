import {
  createHubSpotClient,
  getCurrentStage,
  upsertContent,
  upsertChangelog,
  archiveContentByLinearId,
} from '../lib/hubspot-client';
import type { LinearWebhookPayload } from '../lib/types';
import {
  LINEAR_CHANGELOG_LABEL,
  HS_SYNC_TAG,
  CONTENT_STAGE_TO_LINEAR_STATE,
  CHANGELOG_STAGE_TO_LINEAR_STATE,
} from '../lib/mapping';
import { getPortalConfig } from '../lib/portal-config';

interface PublicFunctionContext {
  method: string;
  body: LinearWebhookPayload;
  headers: Record<string, string>;
  query: Record<string, string>;
  accountId: number;
}


export async function main(context: PublicFunctionContext): Promise<{ statusCode: number; body: string }> {
  const secret = process.env.LINEAR_WEBHOOK_SECRET;
  if (!secret) {
    console.error('LINEAR_WEBHOOK_SECRET is not set');
    return { statusCode: 500, body: JSON.stringify({ error: 'Server misconfiguration' }) };
  }

  if (context.query?.token !== secret) {
    return { statusCode: 401, body: JSON.stringify({ error: 'Unauthorized' }) };
  }

  const payload = context.body;

  if (payload.type !== 'Issue') {
    return { statusCode: 200, body: JSON.stringify({ skipped: true, reason: 'not an Issue event' }) };
  }

  // Explicit tag: skip payloads that originated from our own sync
  if (payload.data.description?.includes(HS_SYNC_TAG)) {
    return { statusCode: 200, body: JSON.stringify({ skipped: true, reason: 'hs-sync echo' }) };
  }

  const labels = payload.data.labels?.nodes?.map(l => l.name) ?? [];
  const isChangelog = labels.includes(LINEAR_CHANGELOG_LABEL);
  const client = createHubSpotClient();

  try {
    // Linear issue deletion: archive the linked HubSpot record rather than upserting.
    if (payload.action === 'remove') {
      if (isChangelog) {
        // The changelog pipeline has no archived stage, so there is nowhere to move it.
        return {
          statusCode: 200,
          body: JSON.stringify({ skipped: true, reason: 'changelog remove not archived (no archive stage)' }),
        };
      }
      const archived = await archiveContentByLinearId(client, payload.data.id, context.accountId);
      if (!archived) {
        return { statusCode: 200, body: JSON.stringify({ skipped: true, reason: 'remove: no matching record' }) };
      }
      console.log(`Archived content ${archived.id} for removed Linear ${payload.data.id}`);
      return { statusCode: 200, body: JSON.stringify({ ok: true, action: 'archived', id: archived.id }) };
    }

    // Echo prevention: skip if the current HubSpot stage already maps FORWARD to the
    // incoming Linear state. This subsumes the exact-match check and also covers the
    // many-to-one case (e.g. both 'editing' and 'drafting' map to 'In Progress'), so an
    // inbound webhook triggered by our own outbound sync does not overwrite the user's stage.
    const portalConfig = getPortalConfig(context.accountId);
    const config = isChangelog ? portalConfig.changelog : portalConfig.content;
    const forwardMap = isChangelog ? CHANGELOG_STAGE_TO_LINEAR_STATE : CONTENT_STAGE_TO_LINEAR_STATE;
    const currentStageId = await getCurrentStage(client, config.objectTypeId, payload.data.id);
    if (currentStageId) {
      const stageIds = config.stageIds as Record<string, string>;
      const currentStageName = Object.keys(stageIds).find(name => stageIds[name] === currentStageId);
      if (currentStageName && (forwardMap as Record<string, string>)[currentStageName] === payload.data.state.name) {
        console.log(`Skipping echo for Linear ${payload.data.id}: stage already matches`);
        return { statusCode: 200, body: JSON.stringify({ skipped: true, reason: 'stage already matches' }) };
      }
    }

    const result = isChangelog
      ? await upsertChangelog(client, payload, context.accountId)
      : await upsertContent(client, payload, context.accountId);

    console.log(`${result.action} ${isChangelog ? 'changelog' : 'content'} ${result.id} for Linear ${payload.data.id}`);
    return { statusCode: 200, body: JSON.stringify({ ok: true, ...result }) };
  } catch (err) {
    console.error('Upsert failed:', err);
    return { statusCode: 500, body: JSON.stringify({ error: 'Internal error' }) };
  }
}
