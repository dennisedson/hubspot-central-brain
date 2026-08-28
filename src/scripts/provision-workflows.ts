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

const API = 'https://api.hubapi.com';

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
  actions.forEach((a: any) => console.log(`    – [${a.id}] uid=${a.uid ?? '?'}`));

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const asanaAction = actions.find((a: any) =>
    (a.uid ?? '').includes('asana') || (a.labels?.en?.actionName ?? '').toLowerCase().includes('asana'),
  );
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const linearAction = actions.find((a: any) =>
    (a.uid ?? '').includes('linear') || (a.labels?.en?.actionName ?? '').toLowerCase().includes('linear'),
  );

  if (!asanaAction || !linearAction) {
    throw new Error(
      `Could not find action IDs. Found UIDs: ${actions.map((a: any) => a.uid ?? a.id).join(', ')}`,
    );
  }

  return {
    syncToAsanaId: `1-${asanaAction.id}`,
    syncToLinearId: `1-${linearAction.id}`,
  };
}

// Reads the linearTeamId from the app settings CRM object (same source as AppSettingsApi).
async function fetchLinearTeamId(token: string, appConfigObjectTypeId: string): Promise<string> {
  const res = await hs(token, 'POST', `/crm/v3/objects/${appConfigObjectTypeId}/search`, {
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

// Check if a workflow with this name already exists
async function findExistingWorkflow(token: string, name: string): Promise<string | null> {
  const res = await hs(token, 'GET', '/automation/v4/flows?limit=100');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const existing = (res.results ?? []).find((w: any) => w.name === name);
  return existing?.id ?? null;
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

  // TODO: add "Edit record → set asana_task_url from action output" step once we know
  // the correct actionTypeId for the native SET_PROPERTY action type in the v4 flows API.

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
        filters: [],
        eventTypeId: '4-655002',
        operator: 'HAS_COMPLETED',
        filterBranchType: 'UNIFIED_EVENTS',
        filterBranchOperator: 'AND',
      }],
      listMembershipFilterBranches: [],
    },
    actions,
  };
}

async function main() {
  const { token, sharedSecret, portalId, portal, appId, developerApiKey } = loadEnv();

  const config = getPortalConfig(portalId);
  console.log(`\n[${portal}] Provisioning workflows on portal ${portalId}`);

  // Step 1: Discover action definition IDs for our custom workflow actions
  console.log('\nDiscovering custom action IDs...');
  const { syncToAsanaId, syncToLinearId } = await discoverActionIds(developerApiKey, appId);
  console.log(`  appId=${appId}  syncToAsanaId=${syncToAsanaId}  syncToLinearId=${syncToLinearId}`);

  // Step 2: Fetch linearTeamId from app settings CRM object
  console.log('\nFetching Linear team ID from app settings...');
  const linearTeamId = await fetchLinearTeamId(token, config.appConfig.objectTypeId);
  console.log(`  linearTeamId=${linearTeamId}`);

  const objectTypeId = config.content.objectTypeId;

  // Step 3: Content workflow
  const contentName = 'Content → Sync to Linear + Asana';
  let existingId = await findExistingWorkflow(token, contentName);
  if (existingId) {
    console.log(`\n[skip] "${contentName}" already exists (id=${existingId})`);
  } else {
    console.log(`\nCreating "${contentName}"...`);
    const workflow = buildWorkflow({
      name: contentName,
      objectTypeId,
      pipelineId: config.content.pipelines.content.pipelineId,
      appId,
      sharedSecret,
      linearTeamId,
      steps: { includeLinearSync: true, objectType: 'content', syncToAsanaId, syncToLinearId },
    });
    console.log('\nPayload:', JSON.stringify(workflow));
    const created = await hs(token, 'POST', '/automation/v4/flows', workflow);
    console.log(`  ✓ Created id=${created.id}`);
  }

  // Step 4: Changelog workflow
  const changelogName = 'Changelog → Sync to Asana';
  existingId = await findExistingWorkflow(token, changelogName);
  if (existingId) {
    console.log(`\n[skip] "${changelogName}" already exists (id=${existingId})`);
  } else {
    console.log(`\nCreating "${changelogName}"...`);
    const changelogPipelineId = config.content.pipelines.changelog.pipelineId;
    if (!changelogPipelineId) {
      console.error('  ✗ Changelog pipeline not provisioned yet — run npm run provision first');
      process.exit(1);
    }
    const workflow = buildWorkflow({
      name: changelogName,
      objectTypeId,
      pipelineId: changelogPipelineId,
      appId,
      sharedSecret,
      linearTeamId,
      steps: { includeLinearSync: false, objectType: 'changelog', syncToAsanaId, syncToLinearId },
    });
    const created = await hs(token, 'POST', '/automation/v4/flows', workflow);
    console.log(`  ✓ Created id=${created.id}`);
  }

  console.log('\n✓ Done. Workflows created in disabled state — enable them in HubSpot after verifying the configuration.');
}

main().catch(err => { console.error('\nFailed:', err.message); process.exit(1); });
