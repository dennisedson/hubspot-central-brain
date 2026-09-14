import { HS_BASE, objectPath } from '../lib/hs-api';
import {
  findTaskByLinearIssueUrl,
  updateTaskPipelineStage,
  createTask,
  setTaskDueDate,
  setTaskAssignee,
  toAsanaDueOn,
} from '../lib/asana-client';
import { hsUpdate } from '../lib/hubspot-client';
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
  hs_object_id?: string;
  inputFields: {
    sharedSecret: string;
    objectId?: string;
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

  const { title, existingAsanaTaskUrl, linearIssueUrl, hubspotStage, objectType, objectId } = context.body.inputFields;
  const recordId = objectId ?? context.body.hs_object_id;

  const config = getPortalConfig(context.accountId);
  const asanaWorkspaceGid = config.asanaWorkspaceGid;
  const asanaProjectGid = config.asanaProjectGid;
  const stageIds = config.content.pipelines[objectType as 'content' | 'changelog'].stageIds;
  const stageName = Object.entries(stageIds).find(([, id]) => id === hubspotStage)?.[0];
  console.log(`SyncToAsana: objectType=${objectType} hubspotStage=${hubspotStage} stageName=${stageName} knownStageIds=${JSON.stringify(stageIds)}`);

  const stageMap = objectType === 'changelog' ? CHANGELOG_STAGE_TO_ASANA_STAGE : CONTENT_STAGE_TO_ASANA_STAGE;
  const asanaStageGid = stageName ? (stageMap as Record<string, string>)[stageName] : undefined;

  if (!asanaStageGid) {
    console.log(`Stage "${hubspotStage}" not in ${objectType} pipeline — skipping (cross-pipeline trigger)`);
    return {
      statusCode: 200,
      body: JSON.stringify({ outputFields: { syncStatus: 'skipped' } }),
    };
  }

  // The workflow action carries no date field, so read it off the record. A
  // failure here must not cost us the sync — the due date is an enhancement to
  // the task, not the reason the task exists.
  let dueOn: string | null = null;
  if (recordId) {
    try {
      const token = process.env.PRIVATE_APP_ACCESS_TOKEN ?? process.env.HS_ACCESS_TOKEN;
      const res = await fetch(
        `${HS_BASE}${objectPath(config.content.objectTypeId, recordId)}?properties=target_date`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      if (res.ok) {
        const body = (await res.json()) as { properties?: Record<string, string | null> };
        dueOn = toAsanaDueOn(body.properties?.target_date);
      }
    } catch (err) {
      console.warn('Could not read target_date; continuing without a due date:', err);
    }
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
      taskGid = await findTaskByLinearIssueUrl(asanaApiKey, asanaWorkspaceGid, asanaProjectGid, linearIssueUrl);
    }

    if (taskGid) {
      await updateTaskPipelineStage(asanaApiKey, taskGid, asanaStageGid);
      console.log(`Updated Asana task ${taskGid} → stage ${asanaStageGid}`);

      // Archived work should leave the assignee's queue. Tagging it Canceled
      // does not: the task still sits in their My Tasks as a live to-do.
      // Failing here must not fail the sync — the stage move already landed.
      if (stageName === 'archived') {
        try {
          await setTaskAssignee(asanaApiKey, taskGid, null);
          console.log(`Unassigned archived Asana task ${taskGid}`);
        } catch (err) {
          console.warn(`Could not unassign ${taskGid}:`, err);
        }
      }
      if (dueOn) {
        // Only pushed when the record has one. Clearing an Asana due date
        // because HubSpot has none would overwrite a date someone set by hand.
        try {
          await setTaskDueDate(asanaApiKey, taskGid, dueOn);
        } catch (err) {
          console.warn(`Could not set due date on ${taskGid}:`, err);
        }
      }
    } else {
      const customFields: Record<string, string> = { [ASANA_PIPELINE_STAGE_FIELD_GID]: asanaStageGid };
      if (linearIssueUrl) customFields[ASANA_LINEAR_ISSUE_URL_FIELD_GID] = linearIssueUrl;
      const sectionGid = config.asanaSections[objectType] || undefined;
      const task = await createTask(
        asanaApiKey,
        asanaProjectGid,
        title ?? 'Untitled',
        customFields,
        sectionGid || undefined,
        stageName === 'archived' ? null : undefined, // null leaves it unassigned; undefined assigns the token's owner
        dueOn,
      );
      taskGid = task.gid;
      console.log(`Created Asana task ${taskGid}`);
    }

    const asanaTaskUrl = `https://app.asana.com/0/${asanaProjectGid}/${taskGid}`;

    // Write the task URL back to the HubSpot record so future workflow runs
    // skip the Asana search and use the stored URL directly.
    if (!existingAsanaTaskUrl && recordId) {
      try {
        await hsUpdate(config.content.objectTypeId, recordId, { asana_task_url: asanaTaskUrl });
        console.log(`Wrote asana_task_url back to HubSpot record ${recordId}`);
      } catch (err) {
        console.error('Failed to write asana_task_url back to HubSpot:', err);
      }
    }

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
