import { getTaskPipelineStage } from '../lib/asana-client';
import { findContentByAsanaTaskUrl, hsUpdate } from '../lib/hubspot-client';
import {
  CONTENT_STAGE_TO_ASANA_STAGE,
  CHANGELOG_STAGE_TO_ASANA_STAGE,
  ASANA_STAGE_TO_CONTENT_STAGE,
  ASANA_STAGE_TO_CHANGELOG_STAGE,
} from '../lib/mapping';
import { getPortalConfig } from '../lib/portal-config';

interface AsanaEvent {
  action: string;
  resource: {
    gid: string;
    resource_type: string;
  };
  change?: {
    field: string;
    action: string;
  };
}

interface AsanaWebhookPayload {
  events?: AsanaEvent[];
}

interface AsanaWebhookContext {
  method: string;
  body: AsanaWebhookPayload;
  headers: Record<string, string>;
  query: Record<string, string>;
  accountId: number;
}

type FunctionResponse = {
  statusCode: number;
  body: string;
  headers?: Record<string, string>;
};

export async function main(context: AsanaWebhookContext): Promise<FunctionResponse> {
  // Asana webhook handshake — echo back X-Hook-Secret if present.
  // HubSpot's runtime may strip custom headers; if it does, the webhook
  // subscription must be registered via a script that pre-handles the handshake.
  const hookSecret =
    context.headers['x-hook-secret'] ?? context.headers['X-Hook-Secret'];
  if (hookSecret) {
    console.log('AsanaWebhook: handshake received, echoing X-Hook-Secret');
    return {
      statusCode: 200,
      body: '',
      headers: { 'X-Hook-Secret': hookSecret },
    };
  }

  const asanaApiKey = process.env.ASANA_API_KEY;
  if (!asanaApiKey) {
    console.error('ASANA_API_KEY is not set');
    return { statusCode: 500, body: JSON.stringify({ error: 'Server misconfiguration' }) };
  }

  let config;
  try {
    config = getPortalConfig(context.accountId);
  } catch {
    console.error(`AsanaWebhook: no config for accountId ${context.accountId}`);
    return { statusCode: 500, body: JSON.stringify({ error: 'No portal config' }) };
  }

  const events = context.body.events ?? [];
  if (events.length === 0) {
    return { statusCode: 200, body: JSON.stringify({ processed: 0 }) };
  }

  const results: string[] = [];

  for (const event of events) {
    if (event.resource.resource_type !== 'task') continue;
    if (event.action !== 'changed') continue;
    if (event.change?.field !== 'custom_fields') continue;

    const taskGid = event.resource.gid;

    try {
      const asanaStageGid = await getTaskPipelineStage(asanaApiKey, taskGid);
      if (!asanaStageGid) {
        console.log(`AsanaWebhook: task ${taskGid} has no pipeline stage — skipping`);
        results.push(`${taskGid}: skipped (no stage)`);
        continue;
      }

      const asanaTaskUrl = `https://app.asana.com/0/${config.asanaProjectGid}/${taskGid}`;
      const record = await findContentByAsanaTaskUrl(config.content.objectTypeId, asanaTaskUrl);
      if (!record) {
        console.log(`AsanaWebhook: no HubSpot record for ${taskGid} — skipping`);
        results.push(`${taskGid}: skipped (no HubSpot record)`);
        continue;
      }

      // Determine which pipeline the record belongs to
      const contentPipeline = config.content.pipelines.content;
      const changelogPipeline = config.content.pipelines.changelog;
      const isChangelog = record.pipeline
        ? record.pipeline === changelogPipeline.pipelineId
        : record.pipelineStage
          ? Object.values(changelogPipeline.stageIds).includes(record.pipelineStage)
          : false;

      const pipelineStageIds = isChangelog ? changelogPipeline.stageIds : contentPipeline.stageIds;
      const stageToAsana = isChangelog ? CHANGELOG_STAGE_TO_ASANA_STAGE : CONTENT_STAGE_TO_ASANA_STAGE;
      const asanaToStage = isChangelog ? ASANA_STAGE_TO_CHANGELOG_STAGE : ASANA_STAGE_TO_CONTENT_STAGE;

      // Echo prevention: skip if HubSpot's current stage already maps to this Asana stage.
      // This fires when our own SyncToAsana updated Asana, which then bounces back here.
      if (record.pipelineStage) {
        const currentStageName = Object.keys(pipelineStageIds).find(
          name => pipelineStageIds[name] === record.pipelineStage,
        );
        if (currentStageName) {
          const mappedAsanaGid = (stageToAsana as Record<string, string>)[currentStageName];
          if (mappedAsanaGid === asanaStageGid) {
            console.log(`AsanaWebhook: echo skip for task ${taskGid} — HubSpot already at ${currentStageName}`);
            results.push(`${taskGid}: skipped (echo)`);
            continue;
          }
        }
      }

      const targetStageName = (asanaToStage as Record<string, string>)[asanaStageGid];
      if (!targetStageName) {
        console.log(`AsanaWebhook: unrecognized Asana stage GID ${asanaStageGid} for task ${taskGid} — skipping`);
        results.push(`${taskGid}: skipped (unmapped stage)`);
        continue;
      }

      const targetStageId = pipelineStageIds[targetStageName];
      if (!targetStageId) {
        console.log(`AsanaWebhook: no HubSpot stage ID for "${targetStageName}" in portal ${context.accountId} — skipping`);
        results.push(`${taskGid}: skipped (no stage ID)`);
        continue;
      }

      await hsUpdate(config.content.objectTypeId, record.id, { hs_pipeline_stage: targetStageId });
      console.log(`AsanaWebhook: updated HubSpot record ${record.id} → ${targetStageName} (${targetStageId})`);
      results.push(`${taskGid}: updated record ${record.id} → ${targetStageName}`);
    } catch (err) {
      console.error(`AsanaWebhook: error processing task ${taskGid}:`, err);
      results.push(`${taskGid}: error`);
    }
  }

  return {
    statusCode: 200,
    body: JSON.stringify({ processed: results.length, results }),
  };
}
