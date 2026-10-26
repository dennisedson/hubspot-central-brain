import { findStateIdByName, getIssueWorkflow, updateLinearIssueState, createIssue } from '../lib/linear-client';
import {
  CONTENT_STAGE_TO_LINEAR_STATE,
  CHANGELOG_STAGE_TO_LINEAR_STATE,
  LINEAR_STATE_TO_CONTENT_STAGE,
  LINEAR_STATE_TO_CHANGELOG_STAGE,
  isFanoutStage,
  isAnyTeam,
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
      title,
      recordId,
    });
  }

  // The issue exists, so its own team decides which states it can move to —
  // not the workflow's linearTeamId, which on an assignee-first portal is the
  // sentinel 'any', a team Linear does not have. This lookup used to run first
  // and unguarded, so on prod every stage move threw.
  let workflow: { currentState: string; states: Array<{ id: string; name: string }> };
  try {
    workflow = await getIssueWorkflow(apiKey, linearIssueId);
  } catch (err) {
    console.error(`Could not read the workflow states for Linear issue ${linearIssueId}:`, err);
    return {
      statusCode: 200,
      body: JSON.stringify({ outputFields: { syncStatus: 'skipped', reason: 'linear_lookup_failed' } }),
    };
  }

  // Do nothing when Linear already says what HubSpot says. The changelog map is
  // many-to-one — Backlog, Todo and Canceled all mean `identified`, which maps
  // back to Backlog alone — so pushing the stage back unasked moved Todo issues
  // to Backlog and reopened cancelled ones. Most stage changes arrive FROM
  // Linear; this is what keeps them from bouncing. (Found on prod, 2026-10-26.)
  //
  // And never move an issue out of a state the map does not know — Duplicate,
  // Triage — because there is no telling what the move would undo.
  const linearToStage = (objectType === 'changelog'
    ? LINEAR_STATE_TO_CHANGELOG_STAGE
    : LINEAR_STATE_TO_CONTENT_STAGE) as Record<string, string>;
  const current = workflow.currentState;
  const currentStage = Object.entries(linearToStage).find(([state]) => state.toLowerCase() === current.toLowerCase())?.[1];
  if (currentStage === undefined) {
    console.log(`Linear issue ${linearIssueId} is in "${current}", which no HubSpot stage maps to — leaving it`);
    return {
      statusCode: 200,
      body: JSON.stringify({ outputFields: { syncStatus: 'skipped', reason: `linear_state_unmapped:${current}` } }),
    };
  }
  if (currentStage === stageName) {
    console.log(`Linear issue ${linearIssueId} is already "${current}", which means "${stageName}" — nothing to move`);
    return {
      statusCode: 200,
      body: JSON.stringify({ outputFields: { syncStatus: 'skipped', reason: 'linear_already_agrees', linearStateName: current } }),
    };
  }

  const lower = targetStateName.toLowerCase();
  const stateId = workflow.states.find(st => st.name.toLowerCase() === lower)?.id ?? null;
  if (!stateId) {
    console.warn(`Linear state "${targetStateName}" not found in the team of issue ${linearIssueId}`);
    return {
      statusCode: 200,
      body: JSON.stringify({ outputFields: { syncStatus: 'skipped', reason: `state_not_found:${targetStateName}` } }),
    };
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
  title: string | undefined;
  recordId: string | undefined;
}

async function createIssueForRecord(args: CreateArgs): Promise<{ statusCode: number; body: string }> {
  const { apiKey, config, objectType, stageName, targetStateName, linearTeamId, title, recordId } = args;

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

  // A new issue has no team to ask, so it needs a real one from the workflow.
  // 'any' is the assignee-first sentinel: refused here, by name, rather than
  // sent to Linear to fail. Promoted notes on such a portal stay without an
  // issue until a team for new issues is configured.
  if (isAnyTeam(linearTeamId)) {
    console.warn(`No team to create a Linear issue in: the workflow's linearTeamId is "${linearTeamId}"`);
    return {
      statusCode: 200,
      body: JSON.stringify({ outputFields: { syncStatus: 'skipped', reason: 'no_team_for_create' } }),
    };
  }

  let stateId: string | null;
  try {
    stateId = await findStateIdByName(apiKey, linearTeamId, targetStateName);
  } catch (err) {
    console.error(`Could not read the workflow states for Linear team ${linearTeamId}:`, err);
    return {
      statusCode: 200,
      body: JSON.stringify({ outputFields: { syncStatus: 'skipped', reason: 'linear_lookup_failed' } }),
    };
  }
  if (!stateId) {
    console.warn(`Linear state "${targetStateName}" not found in team ${linearTeamId} — available states logged above`);
    return {
      statusCode: 200,
      body: JSON.stringify({ outputFields: { syncStatus: 'skipped', reason: `state_not_found:${targetStateName}` } }),
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
