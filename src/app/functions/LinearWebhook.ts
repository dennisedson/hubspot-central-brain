import { verifyLinearSignature } from '../lib/hmac';
import { createHubSpotClient, getCurrentStage, upsertContent, upsertChangelog } from '../lib/hubspot-client';
import type { LinearWebhookPayload } from '../lib/types';
import {
  LINEAR_CHANGELOG_LABEL,
  HS_SYNC_TAG,
  LINEAR_STATE_TO_CONTENT_STAGE,
  LINEAR_STATE_TO_CHANGELOG_STAGE,
} from '../lib/mapping';
import { PORTAL_CONFIG } from '../lib/portal-config';

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

  if (!verifyLinearSignature(context.body, context.headers['linear-signature'], secret)) {
    console.warn('Rejected webhook: invalid Linear signature');
    return { statusCode: 401, body: JSON.stringify({ error: 'Invalid signature' }) };
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

  // Stage comparison: skip if HubSpot already reflects the incoming Linear state (prevents echo loops)
  const config = isChangelog ? PORTAL_CONFIG.changelog : PORTAL_CONFIG.content;
  const stageMap = isChangelog ? LINEAR_STATE_TO_CHANGELOG_STAGE : LINEAR_STATE_TO_CONTENT_STAGE;
  const incomingStageName = stageMap[payload.data.state.name];
  const expectedStageId = incomingStageName
    ? (config.stageIds as Record<string, string>)[incomingStageName]
    : undefined;
  if (expectedStageId) {
    const currentStageId = await getCurrentStage(client, config.objectTypeId, payload.data.id);
    if (currentStageId === expectedStageId) {
      console.log(`Skipping echo for Linear ${payload.data.id}: stage already matches`);
      return { statusCode: 200, body: JSON.stringify({ skipped: true, reason: 'stage already matches' }) };
    }
  }

  try {
    const result = isChangelog
      ? await upsertChangelog(client, payload)
      : await upsertContent(client, payload);

    console.log(`${result.action} ${isChangelog ? 'changelog' : 'content'} ${result.id} for Linear ${payload.data.id}`);
    return { statusCode: 200, body: JSON.stringify({ ok: true, ...result }) };
  } catch (err) {
    console.error('Upsert failed:', err);
    return { statusCode: 500, body: JSON.stringify({ error: 'Internal error' }) };
  }
}
