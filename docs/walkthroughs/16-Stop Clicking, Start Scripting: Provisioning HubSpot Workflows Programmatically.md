## 🎬 YouTube Episode Guide: Stop Clicking, Start Scripting: Provisioning HubSpot Workflows Programmatically

**🎯 Core Learning Objective:**
"By the end of this video, you will know how to write a TypeScript script that creates fully configured HubSpot automation workflows — with custom actions, event-based enrollment, and field mappings — using the v4 Flows API, so you never have to click through the UI again."

**⏱️ The 10-Minute Script Outline:**

*   **Hook & Demo (0:00 - 1:00):** "What if every time you spun up a new HubSpot portal, your workflows just… appeared? No clicking through the UI, no forgetting steps, no drift between environments." Show the terminal running `npm run provision:workflows` and then cut to the HubSpot UI where both workflows show up, pre-configured, with all their actions wired in.

*   **The Architecture (1:00 - 3:00):** Walk through what the script does at a high level — three phases: (1) discover the custom action type IDs from the developer API using your developer key, (2) fetch the Linear team ID from the live app settings object in HubSpot's CRM so the workflow always has the right value, (3) upsert two workflow definitions via the v4 flows API (POST to create, PUT to update). Key insight: HubSpot's automation API separates the concept of "what type of action" (`actionTypeId` like `1-271474309`) from "this action's position in the flow" (`actionId` like `"1"`). Custom workflow actions use the `1-{definitionId}` format.

*   **Step-by-Step Implementation (3:00 - 8:00):**
    *   **Step 1 — Discovering action IDs (3:00 - 4:30):** Open `src/scripts/provision-workflows.ts`. Show `discoverActionIds()` — how it calls `GET /automation/v4/actions/{appId}?hapikey={devKey}` (needs the developer API key, not the portal service key) and formats the returned IDs as `1-{id}`.
    *   **Step 2 — Building the workflow payload (4:30 - 6:30):** Show `buildWorkflow()`. Walk through the required root fields: `type: 'PLATFORM_FLOW'` (for custom objects — `CONTACT_FLOW` is for contacts), `flowType: 'WORKFLOW'`, `isEnabled: false` (HubSpot applies stricter validation for enabled-on-create), `startActionId`, and `enrollmentCriteria`. Explain the `SINGLE_CONNECTION` action structure with `actionTypeId`, `actionTypeVersion: 0`, `fields`, and `connection.nextActionId` for chaining.
    *   **Step 3 — Enrollment criteria (6:30 - 7:30):** Show the `EVENT_BASED` enrollment using `eventTypeId: "4-655002"` (property value changed). The key gotcha: you MUST add two `PROPERTY` filters inside the event filter branch — one on `hs_name` (the event's "which property changed" attribute, matched `IS_EQUAL_TO "hs_pipeline_stage"`) and one on `hs_value` (the event's new value, matched `IS_KNOWN`). Without these, HubSpot shows "Property name and value filter is missing" and the trigger is unconfigured. The event exposes its payload as `hs_name` / `hs_value` event attributes, accessed via `filterType: "PROPERTY"` — this is undocumented and the only way to discover it is to configure the trigger in the UI and then GET the workflow to inspect the JSON.
    *   **Step 4 — Upsert pattern (7:30 - 8:00):** Show `upsertWorkflow()` — it GETs the workflow list to check by name. If the workflow exists, it PUTs with the existing `revisionId` and `isEnabled` preserved. If not, it POSTs. This makes the script safe to re-run and lets you update enrollment criteria or action fields after the fact.

*   **Testing & Wrap-up (8:00 - 10:00):** Run `npm run provision:workflows` in the terminal, then switch to HubSpot and show both workflows with a clean trigger (no red warnings). Re-run the script to show it updates in place. Wrap up: "Four things to remember — custom actions use `1-{id}` format, workflows must be created disabled, always use your developer API key to discover action IDs, and property-change triggers require an explicit PROPERTY filter or HubSpot won't let you enable the workflow."

**💻 Screen-Ready Code Snippets:**

**Discover action IDs (developer key required):**
```typescript
const res = await fetch(
  `https://api.hubapi.com/automation/v4/actions/${appId}?hapikey=${devKey}&limit=100`,
  { headers: { 'Content-Type': 'application/json' } },
);
const actions = JSON.parse(await res.text()).results ?? [];
return {
  syncToAsanaId: `1-${asanaAction.id}`,
  syncToLinearId: `1-${linearAction.id}`,
};
```

**Workflow payload structure (with correct enrollment filter):**
```typescript
{
  name: 'Content → Sync to Linear + Asana',
  type: 'PLATFORM_FLOW',          // CONTACT_FLOW for contact-based workflows
  flowType: 'WORKFLOW',
  isEnabled: false,               // create disabled; enable in UI after verifying
  objectTypeId: '2-67505887',
  startActionId: '1',
  enrollmentCriteria: {
    shouldReEnroll: true,
    type: 'EVENT_BASED',
    eventFilterBranches: [{
      filterBranches: [],
      // 4-655002 exposes its payload as hs_name / hs_value event attributes.
      // hs_name = which property changed; hs_value = the new value.
      // Undocumented — discovered by configuring in the UI and reading back via GET.
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
      eventTypeId: '4-655002',    // property value changed
      operator: 'HAS_COMPLETED',
      filterBranchType: 'UNIFIED_EVENTS',
      filterBranchOperator: 'AND',
    }],
    listMembershipFilterBranches: [],
  },
  actions: [{
    type: 'SINGLE_CONNECTION',
    actionId: '1',                // sequential ID you assign within this flow
    actionTypeId: '1-271474309',  // 1-{definitionId} from your custom action
    actionTypeVersion: 0,
    fields: {
      sharedSecret: 'your-secret',          // plain strings for static values
      hubspotStage: 'hs_pipeline_stage',    // plain property name for object properties
    },
    connection: { edgeType: 'STANDARD', nextActionId: '2' },
  }],
}
```

**Upsert workflow (create or update in place):**
```typescript
async function upsertWorkflow(name: string, payload: Record<string, unknown>) {
  const existing = await findExistingWorkflow(token, name);
  if (existing) {
    const result = await hs(token, 'PUT', `/automation/v4/flows/${existing.id}`, {
      ...payload,
      revisionId: existing.revisionId,  // required for PUT
      isEnabled: existing.isEnabled,    // preserve enabled state across updates
    });
    console.log(`Updated id=${result.id}`);
  } else {
    const result = await hs(token, 'POST', '/automation/v4/flows', payload);
    console.log(`Created id=${result.id}`);
  }
}
```
