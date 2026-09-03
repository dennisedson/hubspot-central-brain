/**
 * Creates the Content and Changelog sync workflows in a HubSpot portal.
 * Idempotent — skips if a workflow with the same name already exists.
 *
 * Usage:
 *   HUBSPOT_ACCESS_KEY=your-key npm run provision:workflows
 *   HUBSPOT_ACCESS_KEY=your-key PORTAL=staging npm run provision:workflows
 *   HUBSPOT_ACCESS_KEY=your-key PORTAL=prod npm run provision:workflows
 */

import { getPortalConfig } from '../app/lib/portal-config';
import { loadEnv } from './script-env';
import { HS_BASE, objectSearchPath } from '../app/lib/hs-api';

const API = HS_BASE;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function hs(token: string, method: string, path: string, body?: unknown): Promise<any> {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  const json = text ? JSON.parse(text) : {};
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status}: ${text}`);
  return json;
}

// Discovers the numeric actionId for each custom workflow action.
// Uses the developer API (hapikey), which is separate from the portal service key.
async function discoverActionIds(devKey: string, appId: number): Promise<{
  syncToAsanaId: string;
  syncToLinearId: string;
  asanaPollId: string;
  fellowSyncId: string;
  associateRelatedContentId: string;
  generateSocialDraftId: string;
}> {
  const res = await fetch(
    `${API}/automation/v4/actions/${appId}?hapikey=${devKey}&limit=100`,
    { headers: { 'Content-Type': 'application/json' } },
  );
  const text = await res.text();
  if (!res.ok) throw new Error(`GET /automation/v4/actions/${appId} → ${res.status}: ${text}`);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const actions: any[] = JSON.parse(text).results ?? [];

  console.log(`  Found ${actions.length} custom action(s) for appId ${appId}`);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  actions.forEach((a: any) => console.log(`    – [${a.id}] uid=${a.uid ?? '?'} name=${a.labels?.en?.actionName ?? '?'}`));

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const asanaSyncAction = actions.find((a: any) => {
    const uid = (a.uid ?? '').toLowerCase();
    const name = (a.labels?.en?.actionName ?? '').toLowerCase();
    return uid === 'sync_to_asana_v1' ||
      (uid.includes('asana') && !uid.includes('poll')) ||
      (name.includes('asana') && !name.includes('poll'));
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const linearAction = actions.find((a: any) =>
    (a.uid ?? '').includes('linear') || (a.labels?.en?.actionName ?? '').toLowerCase().includes('linear'),
  );
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pollAction = actions.find((a: any) =>
    (a.uid ?? '').includes('poll') || (a.labels?.en?.actionName ?? '').toLowerCase().includes('poll'),
  );
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const fellowAction = actions.find((a: any) =>
    (a.uid ?? '').includes('fellow') || (a.labels?.en?.actionName ?? '').toLowerCase().includes('fellow'),
  );
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const associateRelatedContentAction = actions.find((a: any) =>
    (a.uid ?? '').includes('associate_related') ||
    (a.labels?.en?.actionName ?? '').toLowerCase().includes('associate related'),
  );
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const generateSocialDraftAction = actions.find((a: any) =>
    (a.uid ?? '').includes('generate_social') ||
    (a.labels?.en?.actionName ?? '').toLowerCase().includes('social'),
  );

  if (!asanaSyncAction || !linearAction) {
    throw new Error(
      `Could not find action IDs. Found UIDs: ${actions.map((a: any) => a.uid ?? a.id).join(', ')}`,
    );
  }

  if (!pollAction) {
    throw new Error(
      `Could not find AsanaPoll action. Make sure you have deployed the project (npm run build && hs project upload) before running this script. Found UIDs: ${actions.map((a: any) => a.uid ?? a.id).join(', ')}`,
    );
  }

  if (!fellowAction) {
    throw new Error(
      `Could not find FellowSync action. Make sure you have deployed the project before running this script. Found UIDs: ${actions.map((a: any) => a.uid ?? a.id).join(', ')}`,
    );
  }

  if (!associateRelatedContentAction) {
    throw new Error(
      `Could not find AssociateRelatedContent action. Make sure you have deployed the project before running this script. Found UIDs: ${actions.map((a: any) => a.uid ?? a.id).join(', ')}`,
    );
  }

  if (!generateSocialDraftAction) {
    throw new Error(
      `Could not find GenerateSocialDraft action. Make sure you have deployed the project before running this script. Found UIDs: ${actions.map((a: any) => a.uid ?? a.id).join(', ')}`,
    );
  }

  return {
    syncToAsanaId: `1-${asanaSyncAction.id}`,
    syncToLinearId: `1-${linearAction.id}`,
    asanaPollId: `1-${pollAction.id}`,
    fellowSyncId: `1-${fellowAction.id}`,
    associateRelatedContentId: `1-${associateRelatedContentAction.id}`,
    generateSocialDraftId: `1-${generateSocialDraftAction.id}`,
  };
}

// Reads the linearTeamId from the app settings CRM object (same source as AppSettingsApi).
async function fetchLinearTeamId(token: string, appConfigObjectTypeId: string): Promise<string> {
  const res = await hs(token, 'POST', objectSearchPath(appConfigObjectTypeId), {
    properties: ['linear_team_id'],
    limit: 1,
    filterGroups: [],
  });
  const teamId = res.results?.[0]?.properties?.linear_team_id ?? '';
  if (!teamId) {
    throw new Error(
      `linear_team_id is not set in app settings (objectType ${appConfigObjectTypeId}). ` +
      `Open the Settings page in HubSpot and configure your Linear Team ID first.`,
    );
  }
  return teamId;
}

// Returns the full existing workflow object (id + revisionId + isEnabled) or null
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function findExistingWorkflow(token: string, name: string): Promise<any | null> {
  const res = await hs(token, 'GET', '/automation/v4/flows?limit=100');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (res.results ?? []).find((w: any) => w.name === name) ?? null;
}

interface WorkflowDef {
  name: string;
  objectTypeId: string;
  pipelineId: string;
  appId: number;
  sharedSecret: string;
  linearTeamId: string;
  steps: {
    includeLinearSync: boolean;
    objectType: 'content' | 'changelog';
    syncToAsanaId: string;
    syncToLinearId: string;
  };
}

  // Builds a fields object for a CWA SINGLE_CONNECTION action.
  // CWA fields are plain strings: static fields pass the literal value,
  // property fields pass the HubSpot property name — HubSpot resolves it
  // at runtime using the supportedValueTypes from the action definition.
  function fieldSpec(
    mappings: Array<{ name: string; value: string }>,
  ): Record<string, string> {
    const result: Record<string, string> = {};
    for (const m of mappings) result[m.name] = m.value;
    return result;
  }

function buildWorkflow(def: WorkflowDef) {
  const actionSlots: Array<{ actionTypeId: string; fields: Record<string, unknown> }> = [];

  if (def.steps.includeLinearSync) {
    actionSlots.push({
      actionTypeId: def.steps.syncToLinearId,
      fields: fieldSpec([
        { name: 'sharedSecret', value: def.sharedSecret },
        { name: 'objectType', value: def.steps.objectType },
        { name: 'linearTeamId', value: def.linearTeamId },
        { name: 'hubspotStage', value: 'hs_pipeline_stage' },
        { name: 'linearIssueId', value: 'linear_issue_id' },
      ]),
    });
  }

  actionSlots.push({
    actionTypeId: def.steps.syncToAsanaId,
    fields: fieldSpec([
      { name: 'sharedSecret', value: def.sharedSecret },
      { name: 'objectType', value: def.steps.objectType },
      { name: 'objectId', value: 'hs_object_id' },
      { name: 'hubspotStage', value: 'hs_pipeline_stage' },
      { name: 'title', value: 'title' },
      { name: 'linearIssueUrl', value: 'linear_issue_url' },
      { name: 'existingAsanaTaskUrl', value: 'asana_task_url' },
    ]),
  });

  const actions = actionSlots.map((slot, i) => {
    const actionId = String(i + 1);
    const isLast = i === actionSlots.length - 1;
    return {
      type: 'SINGLE_CONNECTION',
      actionId,
      actionTypeId: slot.actionTypeId,
      actionTypeVersion: 0,
      fields: slot.fields,
      ...(isLast ? {} : { connection: { edgeType: 'STANDARD', nextActionId: String(i + 2) } }),
    };
  });

  return {
    name: def.name,
    type: 'PLATFORM_FLOW',
    flowType: 'WORKFLOW',
    isEnabled: false,
    objectTypeId: def.objectTypeId,
    startActionId: '1',
    enrollmentCriteria: {
      shouldReEnroll: true,
      type: 'EVENT_BASED',
      eventFilterBranches: [{
        filterBranches: [],
        // 4-655002 (property value changed) exposes its payload as hs_name / hs_value.
        // hs_name = which property changed; hs_value = the new value.
        // Both filters together = "hs_pipeline_stage changed to any known value."
        filters: [
          {
            filterType: 'PROPERTY',
            property: 'hs_name',
            operation: {
              operator: 'IS_EQUAL_TO',
              includeObjectsWithNoValueSet: false,
              value: 'hs_pipeline_stage',
              operationType: 'STRING',
            },
          },
          {
            filterType: 'PROPERTY',
            property: 'hs_value',
            operation: {
              operator: 'IS_KNOWN',
              includeObjectsWithNoValueSet: false,
              operationType: 'ALL_PROPERTY',
            },
          },
        ],
        eventTypeId: '4-655002',
        operator: 'HAS_COMPLETED',
        filterBranchType: 'UNIFIED_EVENTS',
        filterBranchOperator: 'AND',
      }],
      listMembershipFilterBranches: [],
      // Scope to the specific pipeline so the Changelog workflow doesn't fire on
      // Content records and vice versa (both share the same content_piece object type).
      listFilterBranch: {
        filterBranches: [{
          filterBranches: [],
          filters: [{
            filterType: 'PROPERTY',
            property: 'hs_pipeline',
            operation: {
              operator: 'IS_EQUAL_TO',
              includeObjectsWithNoValueSet: false,
              values: [def.pipelineId],
              operationType: 'MULTISTRING',
            },
          }],
          filterBranchType: 'AND',
          filterBranchOperator: 'AND',
        }],
        filters: [],
        filterBranchType: 'OR',
        filterBranchOperator: 'OR',
      },
    },
    actions,
  };
}

function buildPollWorkflow(name: string, appConfigObjectTypeId: string, asanaPollId: string) {
  // MANUAL enrollment: the workflow runs when manually triggered or when records
  // are enrolled programmatically. After creation, open the workflow in HubSpot
  // and configure a recurring schedule (Edit → Enrollment triggers → "On a schedule").
  return {
    name,
    type: 'PLATFORM_FLOW',
    flowType: 'WORKFLOW',
    isEnabled: false,
    objectTypeId: appConfigObjectTypeId,
    startActionId: '1',
    enrollmentCriteria: {
      shouldReEnroll: true,
      type: 'MANUAL',
      listMembershipFilterBranches: [],
      eventFilterBranches: [],
    },
    actions: [{
      type: 'SINGLE_CONNECTION',
      actionId: '1',
      actionTypeId: asanaPollId,
      actionTypeVersion: 0,
      fields: {},
    }],
  };
}

function buildStageWorkflow(
  name: string,
  objectTypeId: string,
  pipelineId: string,
  targetStageId: string,
  actionTypeId: string,
  fields: Record<string, string>,
) {
  return {
    name,
    type: 'PLATFORM_FLOW',
    flowType: 'WORKFLOW',
    isEnabled: false,
    objectTypeId,
    startActionId: '1',
    enrollmentCriteria: {
      shouldReEnroll: true,
      type: 'EVENT_BASED',
      eventFilterBranches: [{
        filterBranches: [],
        filters: [
          {
            filterType: 'PROPERTY',
            property: 'hs_name',
            operation: {
              operator: 'IS_EQUAL_TO',
              includeObjectsWithNoValueSet: false,
              value: 'hs_pipeline_stage',
              operationType: 'STRING',
            },
          },
          {
            filterType: 'PROPERTY',
            property: 'hs_value',
            operation: {
              operator: 'IS_EQUAL_TO',
              includeObjectsWithNoValueSet: false,
              value: targetStageId,
              operationType: 'STRING',
            },
          },
        ],
        eventTypeId: '4-655002',
        operator: 'HAS_COMPLETED',
        filterBranchType: 'UNIFIED_EVENTS',
        filterBranchOperator: 'AND',
      }],
      listMembershipFilterBranches: [],
      listFilterBranch: {
        filterBranches: [{
          filterBranches: [],
          filters: [{
            filterType: 'PROPERTY',
            property: 'hs_pipeline',
            operation: {
              operator: 'IS_EQUAL_TO',
              includeObjectsWithNoValueSet: false,
              values: [pipelineId],
              operationType: 'MULTISTRING',
            },
          }],
          filterBranchType: 'AND',
          filterBranchOperator: 'AND',
        }],
        filters: [],
        filterBranchType: 'OR',
        filterBranchOperator: 'OR',
      },
    },
    actions: [{
      type: 'SINGLE_CONNECTION',
      actionId: '1',
      actionTypeId,
      actionTypeVersion: 0,
      fields,
    }],
  };
}

async function main() {
  const { token, sharedSecret, portalId, portal, appId, developerApiKey } = loadEnv();

  const config = getPortalConfig(portalId);
  console.log(`\n[${portal}] Provisioning workflows on portal ${portalId}`);

  // Step 1: Discover action definition IDs for our custom workflow actions
  console.log('\nDiscovering custom action IDs...');
  const { syncToAsanaId, syncToLinearId, asanaPollId, fellowSyncId, associateRelatedContentId, generateSocialDraftId } = await discoverActionIds(developerApiKey, appId);
  console.log(`  appId=${appId}  syncToAsanaId=${syncToAsanaId}  syncToLinearId=${syncToLinearId}  asanaPollId=${asanaPollId}  fellowSyncId=${fellowSyncId}  associateRelatedContentId=${associateRelatedContentId}  generateSocialDraftId=${generateSocialDraftId}`);

  // Step 2: Fetch linearTeamId from app settings CRM object
  console.log('\nFetching Linear team ID from app settings...');
  const linearTeamId = await fetchLinearTeamId(token, config.appConfig.objectTypeId);
  console.log(`  linearTeamId=${linearTeamId}`);

  const objectTypeId = config.content.objectTypeId;

  // Upsert helper: creates via POST or updates via PUT.
  // On update: only replaces actions — preserves isEnabled, enrollmentCriteria (schedules),
  // and all other live operational state so re-running never disrupts enabled workflows.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async function upsertWorkflow(name: string, payload: Record<string, unknown>): Promise<void> {
    const summary = await findExistingWorkflow(token, name);
    if (summary) {
      console.log(`\nUpdating "${name}" (id=${summary.id})...`);
      const full = await hs(token, 'GET', `/automation/v4/flows/${summary.id}`);
      const result = await hs(token, 'PUT', `/automation/v4/flows/${full.id}`, {
        ...full,
        actions: (payload as Record<string, unknown>).actions,
        revisionId: full.revisionId,
      });
      console.log(`  ✓ Updated id=${result.id} (isEnabled=${full.isEnabled} preserved)`);
    } else {
      console.log(`\nCreating "${name}"...`);
      const result = await hs(token, 'POST', '/automation/v4/flows', payload);
      console.log(`  ✓ Created id=${result.id}`);
    }
  }

  // Step 3: Content workflow
  const contentName = 'Content → Sync to Linear + Asana';
  await upsertWorkflow(contentName, buildWorkflow({
    name: contentName,
    objectTypeId,
    pipelineId: config.content.pipelines.content.pipelineId,
    appId,
    sharedSecret,
    linearTeamId,
    steps: { includeLinearSync: true, objectType: 'content', syncToAsanaId, syncToLinearId },
  }));

  // Step 4: Changelog workflow
  const changelogName = 'Changelog → Sync to Linear + Asana';
  const changelogPipelineId = config.content.pipelines.changelog.pipelineId;
  if (!changelogPipelineId) {
    console.error('  ✗ Changelog pipeline not provisioned yet — run npm run provision first');
    process.exit(1);
  }
  await upsertWorkflow(changelogName, buildWorkflow({
    name: changelogName,
    objectTypeId,
    pipelineId: changelogPipelineId,
    appId,
    sharedSecret,
    linearTeamId,
    steps: { includeLinearSync: true, objectType: 'changelog', syncToAsanaId, syncToLinearId },
  }));

  // Step 5: App Config daily poll workflow (Asana → HubSpot)
  const pollWorkflowName = 'Asana → Poll for Stage Changes (Daily)';
  await upsertWorkflow(pollWorkflowName, buildPollWorkflow(
    pollWorkflowName,
    config.appConfig.objectTypeId,
    asanaPollId,
  ));

  // Step 6: App Config daily Fellow sync workflow (Fellow → HubSpot Tasks)
  const fellowWorkflowName = 'Fellow → Sync Action Items to Tasks (Daily)';
  await upsertWorkflow(fellowWorkflowName, buildPollWorkflow(
    fellowWorkflowName,
    config.appConfig.objectTypeId,
    fellowSyncId,
  ));

  // Step 7: Content → Associate Related Content (fires on enter review stage)
  const contentReviewStageId = config.content.pipelines.content.stageIds.review;
  if (!contentReviewStageId) {
    console.log('\nStep 7: Skipping "Content → Associate Related Content" — review stage ID not provisioned yet.');
  } else {
    const contentAssociateName = 'Content → Associate Related Content';
    await upsertWorkflow(contentAssociateName, buildStageWorkflow(
      contentAssociateName,
      config.content.objectTypeId,
      config.content.pipelines.content.pipelineId,
      contentReviewStageId,
      associateRelatedContentId,
      fieldSpec([
        { name: 'sharedSecret', value: sharedSecret },
        { name: 'objectId', value: 'hs_object_id' },
        { name: 'objectType', value: 'content' },
        { name: 'maxAssociations', value: '3' },
      ]),
    ));
  }

  // Step 8: Video → Associate Related Content (fires on enter scheduled stage)
  const videoScheduledStageId = config.video.stageIds.scheduled;
  if (!videoScheduledStageId) {
    console.log('\nStep 8: Skipping "Video → Associate Related Content" — scheduled stage ID not provisioned yet.');
  } else {
    const videoAssociateName = 'Video → Associate Related Content';
    await upsertWorkflow(videoAssociateName, buildStageWorkflow(
      videoAssociateName,
      config.video.objectTypeId,
      config.video.pipelineId,
      videoScheduledStageId,
      associateRelatedContentId,
      fieldSpec([
        { name: 'sharedSecret', value: sharedSecret },
        { name: 'objectId', value: 'hs_object_id' },
        { name: 'objectType', value: 'video' },
        { name: 'maxAssociations', value: '3' },
      ]),
    ));
  }

  // Step 9: Content → Generate LinkedIn Draft (fires on enter published stage)
  const contentPublishedStageId = config.content.pipelines.content.stageIds.published;
  if (!contentPublishedStageId) {
    console.log('\nStep 9: Skipping "Content → Generate LinkedIn Draft" — published stage ID not provisioned yet.');
  } else {
    const contentLinkedInName = 'Content → Generate LinkedIn Draft';
    await upsertWorkflow(contentLinkedInName, buildStageWorkflow(
      contentLinkedInName,
      config.content.objectTypeId,
      config.content.pipelines.content.pipelineId,
      contentPublishedStageId,
      generateSocialDraftId,
      fieldSpec([
        { name: 'objectId', value: 'hs_object_id' },
        { name: 'force', value: 'false' },
      ]),
    ));
  }

  console.log('\n✓ Done. New workflows are disabled — enable in HubSpot after verifying. Re-runs update existing workflows in place.');
}

main().catch(err => { console.error('\nFailed:', err.message); process.exit(1); });
