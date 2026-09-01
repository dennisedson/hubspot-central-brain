import { pollAsanaEvents, getTaskPipelineStage } from '../lib/asana-client';
import { findContentByAsanaTaskUrl, hsUpdate, getAsanaSyncToken, setAsanaSyncToken } from '../lib/hubspot-client';
import {
  CONTENT_STAGE_TO_ASANA_STAGE,
  CHANGELOG_STAGE_TO_ASANA_STAGE,
  ASANA_STAGE_TO_CONTENT_STAGE,
  ASANA_STAGE_TO_CHANGELOG_STAGE,
} from '../lib/mapping';
import { getPortalConfig } from '../lib/portal-config';

interface AsanaPollBody {
  callbackId: string;
  hs_object_id?: string;
  inputFields: Record<string, string>;
}

interface AsanaPollContext {
  method: string;
  body: AsanaPollBody;
  headers: Record<string, string>;
  query: Record<string, string>;
  accountId: number;
}

export async function main(context: AsanaPollContext): Promise<{ statusCode: number; body: string }> {
  const asanaApiKey = process.env.ASANA_API_KEY;
  if (!asanaApiKey) {
    console.error('ASANA_API_KEY is not set');
    return { statusCode: 500, body: JSON.stringify({ error: 'Server misconfiguration' }) };
  }

  let config;
  try {
    config = getPortalConfig(context.accountId);
  } catch {
    console.error(`AsanaPoll: no config for accountId ${context.accountId}`);
    return { statusCode: 500, body: JSON.stringify({ error: 'No portal config' }) };
  }

  const appConfigRecordId = context.body.hs_object_id;
  if (!appConfigRecordId) {
    console.error('AsanaPoll: no hs_object_id in body — cannot read/write sync token');
    return { statusCode: 400, body: JSON.stringify({ error: 'Missing hs_object_id' }) };
  }

  const storedSyncToken = await getAsanaSyncToken(config.appConfig.objectTypeId, appConfigRecordId);
  console.log(`AsanaPoll: polling with ${storedSyncToken ? 'stored token' : 'no token (first run)'}`);

  const { events, syncToken: newSyncToken } = await pollAsanaEvents(
    asanaApiKey,
    config.asanaProjectGid,
    storedSyncToken,
  );

  // Persist the new sync token before processing so progress is saved even on partial failure
  await setAsanaSyncToken(config.appConfig.objectTypeId, appConfigRecordId, newSyncToken);
  console.log(`AsanaPoll: ${events.length} event(s), sync token updated`);

  if (events.length === 0) {
    return {
      statusCode: 200,
      body: JSON.stringify({ outputFields: { syncStatus: 'success', processed: '0' } }),
    };
  }

  const results: string[] = [];
  let updatedCount = 0;

  for (const event of events) {
    if (event.resource.resource_type !== 'task') continue;
    if (event.action !== 'changed') continue;
    if (event.change?.field !== 'custom_fields') continue;

    const taskGid = event.resource.gid;

    try {
      const asanaStageGid = await getTaskPipelineStage(asanaApiKey, taskGid);
      if (!asanaStageGid) {
        console.log(`AsanaPoll: task ${taskGid} has no pipeline stage — skipping`);
        results.push(`${taskGid}: skipped (no stage)`);
        continue;
      }

      const asanaTaskUrl = `https://app.asana.com/0/${config.asanaProjectGid}/${taskGid}`;
      const record = await findContentByAsanaTaskUrl(config.content.objectTypeId, asanaTaskUrl);
      if (!record) {
        console.log(`AsanaPoll: no HubSpot record for ${taskGid} — skipping`);
        results.push(`${taskGid}: skipped (no HubSpot record)`);
        continue;
      }

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

      // Echo prevention: skip if HubSpot's current stage already maps to this Asana stage
      if (record.pipelineStage) {
        const currentStageName = Object.keys(pipelineStageIds).find(
          name => pipelineStageIds[name] === record.pipelineStage,
        );
        if (currentStageName) {
          const mappedAsanaGid = (stageToAsana as Record<string, string>)[currentStageName];
          if (mappedAsanaGid === asanaStageGid) {
            console.log(`AsanaPoll: echo skip for task ${taskGid} — HubSpot already at ${currentStageName}`);
            results.push(`${taskGid}: skipped (echo)`);
            continue;
          }
        }
      }

      const targetStageName = (asanaToStage as Record<string, string>)[asanaStageGid];
      if (!targetStageName) {
        console.log(`AsanaPoll: unrecognized Asana stage GID ${asanaStageGid} for task ${taskGid} — skipping`);
        results.push(`${taskGid}: skipped (unmapped stage)`);
        continue;
      }

      const targetStageId = pipelineStageIds[targetStageName];
      if (!targetStageId) {
        console.log(`AsanaPoll: no HubSpot stage ID for "${targetStageName}" in portal ${context.accountId} — skipping`);
        results.push(`${taskGid}: skipped (no stage ID)`);
        continue;
      }

      await hsUpdate(config.content.objectTypeId, record.id, { hs_pipeline_stage: targetStageId });
      console.log(`AsanaPoll: updated HubSpot record ${record.id} → ${targetStageName} (${targetStageId})`);
      results.push(`${taskGid}: updated record ${record.id} → ${targetStageName}`);
      updatedCount++;
    } catch (err) {
      console.error(`AsanaPoll: error processing task ${taskGid}:`, err);
      results.push(`${taskGid}: error`);
    }
  }

  return {
    statusCode: 200,
    body: JSON.stringify({
      outputFields: { syncStatus: 'success', processed: String(updatedCount) },
    }),
  };
}
