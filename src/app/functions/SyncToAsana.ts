import { findTaskByLinearIssueUrl, updateTaskPipelineStage, createTask } from '../lib/asana-client';
import {
  ASANA_PIPELINE_STAGE_FIELD_GID,
  ASANA_LINEAR_ISSUE_URL_FIELD_GID,
  CONTENT_STAGE_TO_ASANA_STAGE,
  CHANGELOG_STAGE_TO_ASANA_STAGE,
} from '../lib/mapping';
import { getPortalConfig } from '../lib/portal-config';
import { verifySharedSecret } from '../lib/shared-secret';

interface SyncToAsanaBody {
  callbackId: string;
  hs_object_id: string;
  inputFields: {
    sharedSecret: string;
    title?: string;
    existingAsanaTaskUrl?: string;
    linearIssueUrl?: string;
    hubspotStage: string;
    objectType: 'content' | 'changelog';
  };
}

interface SyncToAsanaContext {
  method: string;
  body: SyncToAsanaBody;
  headers: Record<string, string>;
  query: Record<string, string>;
  accountId: number;
}

export async function main(context: SyncToAsanaContext): Promise<{ statusCode: number; body: string }> {
  const expectedSecret = process.env.SYNC_SHARED_SECRET;
  if (!expectedSecret) {
    console.error('SYNC_SHARED_SECRET is not set');
    return { statusCode: 500, body: JSON.stringify({ error: 'Server misconfiguration' }) };
  }

  if (!verifySharedSecret(context.body.inputFields?.sharedSecret, expectedSecret)) {
    return { statusCode: 401, body: JSON.stringify({ error: 'Unauthorized' }) };
  }

  const asanaApiKey = process.env.ASANA_API_KEY;
  if (!asanaApiKey) {
    console.error('ASANA_API_KEY is not set');
    return { statusCode: 500, body: JSON.stringify({ error: 'Server misconfiguration' }) };
  }

  const { title, existingAsanaTaskUrl, linearIssueUrl, hubspotStage, objectType } = context.body.inputFields;

  const config = getPortalConfig(context.accountId);
  const asanaProjectGid = config.asanaProjectGid;
  const stageIds = objectType === 'changelog' ? config.changelog.stageIds : config.content.stageIds;
  const stageName = Object.entries(stageIds).find(([, id]) => id === hubspotStage)?.[0];

  const stageMap = objectType === 'changelog' ? CHANGELOG_STAGE_TO_ASANA_STAGE : CONTENT_STAGE_TO_ASANA_STAGE;
  const asanaStageGid = stageName ? (stageMap as Record<string, string>)[stageName] : undefined;

  if (!asanaStageGid) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: `Unknown HubSpot stage: "${hubspotStage}" for objectType "${objectType}"` }),
    };
  }

  try {
    let taskGid: string | null = null;

    // 1. Prefer the stored Asana task URL — no API search needed
    if (existingAsanaTaskUrl) {
      const parts = existingAsanaTaskUrl.split('/');
      taskGid = parts[parts.length - 1] || null;
    }

    // 2. Fall back to searching by Linear issue URL (only when non-empty)
    if (!taskGid && linearIssueUrl) {
      taskGid = await findTaskByLinearIssueUrl(asanaApiKey, asanaProjectGid, linearIssueUrl);
    }

    if (taskGid) {
      await updateTaskPipelineStage(asanaApiKey, taskGid, asanaStageGid);
      console.log(`Updated Asana task ${taskGid} → stage ${asanaStageGid}`);
    } else {
      const customFields: Record<string, string> = { [ASANA_PIPELINE_STAGE_FIELD_GID]: asanaStageGid };
      if (linearIssueUrl) customFields[ASANA_LINEAR_ISSUE_URL_FIELD_GID] = linearIssueUrl;
      const task = await createTask(asanaApiKey, asanaProjectGid, title ?? 'Untitled', customFields);
      taskGid = task.gid;
      console.log(`Created Asana task ${taskGid}`);
    }

    const asanaTaskUrl = `https://app.asana.com/0/${asanaProjectGid}/${taskGid}`;
    return {
      statusCode: 200,
      body: JSON.stringify({
        outputFields: { syncStatus: 'success', asanaTaskGid: taskGid, asanaTaskUrl },
      }),
    };
  } catch (err) {
    console.error('Asana sync failed:', err);
    return { statusCode: 500, body: JSON.stringify({ error: 'Internal error' }) };
  }
}
