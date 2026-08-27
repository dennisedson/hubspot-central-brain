## 🎬 YouTube Episode Guide: Stop Clicking, Start Scripting: Provisioning HubSpot Workflows Programmatically

**🎯 Core Learning Objective:**
"By the end of this video, you will know how to write a TypeScript script that creates fully configured HubSpot automation workflows — with custom actions, event-based enrollment, and field mappings — using the v4 Flows API, so you never have to click through the UI again."

**⏱️ The 10-Minute Script Outline:**

*   **Hook & Demo (0:00 - 1:00):** "What if every time you spun up a new HubSpot portal, your workflows just… appeared? No clicking through the UI, no forgetting steps, no drift between environments." Show the terminal running `npm run provision:workflows` and then cut to the HubSpot UI where both workflows show up, pre-configured, with all their actions wired in.

*   **The Architecture (1:00 - 3:00):** Walk through what the script does at a high level — three phases: (1) discover the custom action type IDs from the developer API using your developer key, (2) fetch the Linear team ID from the live app settings object in HubSpot's CRM so the workflow always has the right value, (3) POST two workflow definitions to the v4 flows API. Key insight: HubSpot's automation API separates the concept of "what type of action" (`actionTypeId` like `1-271474309`) from "this action's position in the flow" (`actionId` like `"1"`). Custom workflow actions use the `1-{definitionId}` format.

*   **Step-by-Step Implementation (3:00 - 8:00):**
    *   **Step 1 — Discovering action IDs (3:00 - 4:30):** Open `src/scripts/provision-workflows.ts`. Show `discoverActionIds()` — how it calls `GET /automation/v4/actions/{appId}?hapikey={devKey}` (needs the developer API key, not the portal service key) and formats the returned IDs as `1-{id}`.
    *   **Step 2 — Building the workflow payload (4:30 - 6:30):** Show `buildWorkflow()`. Walk through the required root fields: `type: 'PLATFORM_FLOW'` (for custom objects — `CONTACT_FLOW` is for contacts), `flowType: 'WORKFLOW'`, `isEnabled: false` (HubSpot applies stricter validation for enabled-on-create), `startActionId`, and `enrollmentCriteria`. Explain the `SINGLE_CONNECTION` action structure with `actionTypeId`, `actionTypeVersion: 0`, `fields`, and `connection.nextActionId` for chaining.
    *   **Step 3 — Enrollment criteria (6:30 - 7:30):** Show the `EVENT_BASED` enrollment using `eventTypeId: "4-655002"` (property value changed). Explain that pipeline-specific filtering can be added as a `listFilterBranch` in a follow-up, but `EVENT_BASED` with empty filters is a valid starting point.
    *   **Step 4 — Idempotency (7:30 - 8:00):** Show `findExistingWorkflow()` — it lists all flows and checks by name so re-running the script is always safe.

*   **Testing & Wrap-up (8:00 - 10:00):** Run `npm run provision:workflows` in the terminal, then switch to HubSpot and show both workflows. Re-run the script and show the `[skip]` messages. Wrap up: "Three things to remember — custom actions use `1-{id}` format, workflows must be created disabled and enabled separately, and always use your developer API key (not the portal service key) to discover action IDs."

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

**Workflow payload structure:**
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
      filters: [],
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
      sharedSecret: { type: 'STATIC_VALUE', staticValue: '...' },
      hubspotStage: { type: 'OBJECT_PROPERTY', propertyName: 'hs_pipeline_stage' },
    },
    connection: { edgeType: 'STANDARD', nextActionId: '2' },
  }],
}
```

**Idempotency check:**
```typescript
async function findExistingWorkflow(token: string, name: string): Promise<string | null> {
  const res = await hs(token, 'GET', '/automation/v4/flows?limit=100');
  const existing = (res.results ?? []).find((w: any) => w.name === name);
  return existing?.id ?? null;
}
```
