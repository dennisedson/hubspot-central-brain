import { findStateIdByName, updateLinearIssueState, createIssue } from '../lib/linear-client';
import {
  CONTENT_STAGE_TO_LINEAR_STATE,
  CHANGELOG_STAGE_TO_LINEAR_STATE,
  isFanoutStage,
} from '../lib/mapping';
import { hsUpdate } from '../lib/hubspot-client';
import { verifySharedSecret } from '../lib/shared-secret';
import { getPortalConfig } from '../lib/portal-config';

interface SyncToLinearBody {
  callbackId: string;
  hs_object_id: string;
  inputFields: {
    sharedSecret: string;
    linearIssueId: string;
    hubspotStage: string;
    objectType: 'content' | 'changelog';
    linearTeamId: string;
    /** Empty on a record that has no Linear issue yet — used as the new issue's title. */
    title?: string;
    /** The enrolled record's id. Needed to write the new issue's id back. */
    objectId?: string;
  };
}

interface SyncToLinearContext {
  method: string;
  body: SyncToLinearBody;
  headers: Record<string, string>;
  query: Record<string, string>;
  accountId: number;
}

export async function main(context: SyncToLinearContext): Promise<{ statusCode: number; body: string }> {
  const expectedSecret = process.env.SYNC_SHARED_SECRET;
  if (!expectedSecret) {
    console.error('SYNC_SHARED_SECRET is not set');
    return { statusCode: 500, body: JSON.stringify({ error: 'Server misconfiguration' }) };
  }

  if (!verifySharedSecret(context.body.inputFields?.sharedSecret, expectedSecret)) {
    console.warn('Rejected SyncToLinear request: invalid shared secret');
    return { statusCode: 401, body: JSON.stringify({ error: 'Unauthorized' }) };
  }

  const apiKey = process.env.LINEAR_API_KEY;
  if (!apiKey) {
    console.error('LINEAR_API_KEY is not set');
    return { statusCode: 500, body: JSON.stringify({ error: 'Server misconfiguration' }) };
  }

  const { linearIssueId, hubspotStage, objectType, linearTeamId, title, objectId } = context.body.inputFields;
  const recordId = objectId ?? context.body.hs_object_id;
  console.log(`SyncToLinear input: objectType=${objectType} hubspotStage=${hubspotStage} linearIssueId=${linearIssueId} linearTeamId=${linearTeamId}`);

  const config = getPortalConfig(context.accountId);
  const stageIds = config.content.pipelines[objectType as 'content' | 'changelog'].stageIds;
  const stageName = Object.entries(stageIds).find(([, id]) => id === hubspotStage)?.[0];

  const stageMap = objectType === 'changelog'
    ? CHANGELOG_STAGE_TO_LINEAR_STATE
    : CONTENT_STAGE_TO_LINEAR_STATE;

  const targetStateName = stageName ? (stageMap as Record<string, string>)[stageName] : undefined;
  if (!targetStateName) {
    console.log(`Stage "${hubspotStage}" not in ${objectType} pipeline — skipping (cross-pipeline trigger)`);
    return {
      statusCode: 200,
      body: JSON.stringify({ outputFields: { syncStatus: 'skipped' } }),
    };
  }

  const stateId = await findStateIdByName(apiKey, linearTeamId, targetStateName);
  if (!stateId) {
    console.warn(`Linear state "${targetStateName}" not found in team ${linearTeamId} — available states logged above`);
    return {
      statusCode: 200,
      body: JSON.stringify({ outputFields: { syncStatus: 'skipped', reason: `state_not_found:${targetStateName}` } }),
    };
  }

  // No Linear issue yet: this record was born in the vault, not in Linear.
  //
  // It only earns an issue once somebody promoted it past the threshold. Below
  // Outline there is nothing to create — an idea that has not been promoted is
  // a note, and giving it an issue would put every stray thought in the tracker.
  if (!linearIssueId) {
    return createIssueForRecord({
      apiKey,
      config,
      objectType,
      stageName,
      targetStateName,
      linearTeamId,
      stateId,
      title,
      recordId,
    });
  }

  try {
    await updateLinearIssueState(apiKey, linearIssueId, stateId);
  } catch (err) {
    console.error(`Linear issueUpdate failed for issue ${linearIssueId}:`, err);
    return {
      statusCode: 200,
      body: JSON.stringify({ outputFields: { syncStatus: 'skipped', reason: 'linear_update_failed' } }),
    };
  }

  console.log(`Synced Linear issue ${linearIssueId} → "${targetStateName}" (${stateId})`);
  return {
    statusCode: 200,
    body: JSON.stringify({
      outputFields: {
        syncStatus: 'success',
        linearStateName: targetStateName,
      },
    }),
  };
}

interface CreateArgs {
  apiKey: string;
  config: ReturnType<typeof getPortalConfig>;
  objectType: 'content' | 'changelog';
  stageName: string | undefined;
  targetStateName: string;
  linearTeamId: string;
  stateId: string;
  title: string | undefined;
  recordId: string | undefined;
}

async function createIssueForRecord(args: CreateArgs): Promise<{ statusCode: number; body: string }> {
  const { apiKey, config, objectType, stageName, targetStateName, linearTeamId, stateId, title, recordId } = args;

  // Only the Content pipeline has a vault front door. Changelog records are
  // born from a Linear issue that already exists, so an unlinked one means
  // something upstream went wrong rather than that a new issue is wanted —
  // and inventing changelog issues here would be a policy nobody agreed to.
  if (objectType !== 'content') {
    console.log(`No linearIssueId on a ${objectType} record — skipping (creation is content-only)`);
    return {
      statusCode: 200,
      body: JSON.stringify({ outputFields: { syncStatus: 'skipped', reason: 'no_issue_id_changelog' } }),
    };
  }

  if (!isFanoutStage(stageName)) {
    console.log(`No linearIssueId and stage "${stageName}" is below Outline — nothing to create`);
    return {
      statusCode: 200,
      body: JSON.stringify({ outputFields: { syncStatus: 'skipped', reason: `below_outline:${stageName}` } }),
    };
  }

  let issue;
  try {
    issue = await createIssue(apiKey, {
      teamId: linearTeamId,
      title: title || 'Untitled',
      description: recordId
        ? `Promoted from the Central Brain vault. HubSpot record ${recordId}.`
        : 'Promoted from the Central Brain vault.',
      stateId,
    });
  } catch (err) {
    console.error(`Linear issueCreate failed for team ${linearTeamId}:`, err);
    return {
      statusCode: 200,
      body: JSON.stringify({ outputFields: { syncStatus: 'skipped', reason: 'linear_create_failed' } }),
    };
  }

  console.log(`Created Linear issue ${issue.identifier} (${issue.id}) at "${targetStateName}"`);

  // THE WHOLE POINT OF THE CREATE PATH.
  //
  // Without this write-back nothing on the record remembers the issue, so the
  // next stage change arrives with an empty linearIssueId and creates ANOTHER
  // issue, and the one after that another — one per stage move, forever. The
  // record looks fine the whole time. This is the same failure the Asana side
  // documents in docs/TEST-PLAN.md 2.1 as its fail signal for asana_task_url,
  // except Linear has no equivalent of the task search to recover from it.
  //
  // linear_id is written alongside the two display properties because it is the
  // unique upsert key LinearWebhook keys on. If a human ever strips the
  // [hs-sync] tag out of the issue description, the next inbound webhook stops
  // being skipped — and with linear_id set it updates THIS record instead of
  // creating a duplicate.
  if (!recordId) {
    console.error('Created a Linear issue with no HubSpot record id to link it to');
    return {
      statusCode: 200,
      body: JSON.stringify({
        outputFields: {
          syncStatus: 'created_unlinked',
          linearStateName: targetStateName,
          linearIssueId: issue.id,
          linearIssueUrl: issue.url,
        },
      }),
    };
  }

  try {
    await hsUpdate(config.content.objectTypeId, recordId, {
      linear_id: issue.id,
      linear_issue_id: issue.id,
      linear_issue_url: issue.url,
    });
    console.log(`Wrote linear_issue_id back to HubSpot record ${recordId}`);
  } catch (err) {
    // Reported, never swallowed. A silent failure here is indistinguishable
    // from success until duplicate issues start appearing in Linear.
    console.error(`Failed to write linear_issue_id back to HubSpot record ${recordId}:`, err);
    return {
      statusCode: 200,
      body: JSON.stringify({
        outputFields: {
          syncStatus: 'created_unlinked',
          linearStateName: targetStateName,
          linearIssueId: issue.id,
          linearIssueUrl: issue.url,
        },
      }),
    };
  }

  return {
    statusCode: 200,
    body: JSON.stringify({
      outputFields: {
        syncStatus: 'created',
        linearStateName: targetStateName,
        linearIssueId: issue.id,
        linearIssueUrl: issue.url,
      },
    }),
  };
}
