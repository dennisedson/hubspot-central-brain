## 🎬 YouTube Episode Guide: Five Bugs One Session: Debugging a Multi-Environment HubSpot Workflow Integration

**🎯 Core Learning Objective:**
"By the end of this video, you will know how to diagnose and fix the five most common failure modes in a HubSpot workflow integration: a missing trigger filter, a 401 from duplicate .env keys, a 400 from cross-pipeline enrollment, a 500 from a wrong Linear team ID format, and a PUT failure caused by a missing revisionId."

**⏱️ The 10-Minute Script Outline:**

*   **Hook & Demo (0:00 - 1:00):** "Your workflow was working yesterday. Today you're getting 401s, 400s, and 500s — and HubSpot's error messages are useless. This episode is a real debugging session: five different errors on the same integration, each with a non-obvious root cause. Let's walk through all of them." Show the HubSpot monitoring panel with the red errors, then cut to a clean green run after all fixes are applied.

*   **The Architecture (1:00 - 3:00):** Quick recap of the stack — two HubSpot workflows (Content and Changelog) on a custom `content_piece` object, each calling serverless functions that sync to Linear and Asana. Three environments (dev/staging/prod) each with their own portal and secrets. The provisioning script wires it all up. Each bug lives at a different layer: the enrollment trigger, the `.env` file, the serverless function, the Linear API query, and the HubSpot Flows API upsert pattern.

*   **Step-by-Step Implementation (3:00 - 8:00):**

    *   **Bug 1 — "Property name and value filter is missing" (3:00 - 4:15):** Open `src/scripts/provision-workflows.ts`. The `4-655002` event filter is undocumented. HubSpot requires two `PROPERTY` filters inside the `UNIFIED_EVENTS` branch: one on `hs_name IS_EQUAL_TO "hs_pipeline_stage"` and one on `hs_value IS_KNOWN`. Without these, HubSpot shows a red warning and the trigger won't fire. The only way to discover this format: configure the trigger in the HubSpot UI, then GET the workflow to read back the JSON HubSpot stored. Show the `eventFilterBranches` block with both filters.

    *   **Bug 2 — 401 Unauthorized on every action call (4:15 - 5:15):** Open `.env`. When you have three portals, you can't name all three secrets `SYNC_SHARED_SECRET` — dotenv silently uses the last value (prod). Dev and staging workflows were encoding the prod secret, but their function environments expected the dev/staging secret. Fix: rename to `HUBSPOT_DEV_SYNC_SECRET`, `HUBSPOT_STAGING_SYNC_SECRET`, `HUBSPOT_PROD_SYNC_SECRET`. Open `src/scripts/script-env.ts` and show `requireVar(vars, \`HUBSPOT_${prefix}_SYNC_SECRET\`)` — now each portal's provisioning run picks the right secret.

    *   **Bug 3 — 400 "Unknown HubSpot stage" on the wrong pipeline (5:15 - 6:15):** Both Content and Changelog workflows share the `content_piece` object type, so a stage change on any record fires both. The Changelog workflow receives a Content stage ID it doesn't recognize. Two-part fix: (1) Add a `listFilterBranch` to each workflow scoping it to its `hs_pipeline`, so it only enrolls records from the right pipeline. (2) Add a graceful 200/skipped return in both `SyncToLinear.ts` and `SyncToAsana.ts` for stages not in the pipeline map — because even with the filter, re-enrollment windows can overlap.

    *   **Bug 4 — 500 "Linear team not found: db6b2f51-..." (6:15 - 7:30):** Open `src/app/lib/linear-client.ts`. The original `getLinearStates` queries `teams(filter: { key: { eq: $teamId } })` — this filters by the team **key** (slug like "DAD"), but the Settings page and provision script store and send the team **UUID**. The Linear `teams(filter: { key })` query doesn't match UUIDs. Fix: switch to `team(id: $teamId)` — the singular `team` resolver accepts a UUID, exactly like `getLinearTeamMembers` already does. One query shape change, all environments fixed.

    *   **Bug 5 — 400 "Invalid request to flow update" on PUT (7:30 - 8:00):** The `GET /automation/v4/flows` list endpoint omits `revisionId`. A PUT without `revisionId` is rejected. Fix in the upsert helper: after finding the workflow by name in the list, do a second GET by ID to fetch the full object including `revisionId`, then PUT with it. Also: HubSpot rejects updates to enabled workflows — always send `isEnabled: false` on PUT.

*   **Testing & Wrap-up (8:00 - 10:00):** Run `npm run provision:workflows` to show a clean provision, then flip to HubSpot monitoring and change a content piece stage — watch both functions return 200. Wrap up: "Five completely different root causes, all in the same integration. The pattern: when an API gives you a vague error, read back what you wrote — configure in the UI and GET it, or look at what the API actually returns versus what you assume it accepts."

**💻 Screen-Ready Code Snippets:**

**Bug 1 — Correct UNIFIED_EVENTS filter for property-change trigger:**
```typescript
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
}]
```

**Bug 2 — Per-env secrets in script-env.ts:**
```typescript
// .env — three separate keys, not three SYNC_SHARED_SECRET entries
// HUBSPOT_DEV_SYNC_SECRET=abc
// HUBSPOT_STAGING_SYNC_SECRET=def
// HUBSPOT_PROD_SYNC_SECRET=ghi

sharedSecret: requireVar(vars, `HUBSPOT_${prefix}_SYNC_SECRET`),
```

**Bug 3 — Pipeline scope filter + graceful skip:**
```typescript
// In buildWorkflow: scope enrollment to specific pipeline
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

// In SyncToLinear.ts / SyncToAsana.ts: graceful skip for unknown stages
if (!targetStateName) {
  console.log(`Stage "${hubspotStage}" not in ${objectType} pipeline — skipping`);
  return { statusCode: 200, body: JSON.stringify({ outputFields: { syncStatus: 'skipped' } }) };
}
```

**Bug 4 — Query by UUID instead of team key:**
```typescript
// Before (broken — filters by key slug, not UUID):
teams(filter: { key: { eq: $teamId } }) {
  nodes { states { nodes { id name type } } }
}

// After (correct — resolves UUID directly):
query GetTeamStates($teamId: String!) {
  team(id: $teamId) {
    states { nodes { id name type } }
  }
}
```

**Bug 5 — Upsert with revisionId and isEnabled:false:**
```typescript
async function upsertWorkflow(name: string, payload: Record<string, unknown>) {
  const summary = await findExistingWorkflow(token, name);  // list endpoint — no revisionId
  if (summary) {
    const full = await hs(token, 'GET', `/automation/v4/flows/${summary.id}`);  // full object has revisionId
    await hs(token, 'PUT', `/automation/v4/flows/${full.id}`, {
      ...payload,
      revisionId: full.revisionId,  // required — PUT rejects without it
      isEnabled: false,             // required — PUT rejects updates to enabled workflows
    });
  } else {
    await hs(token, 'POST', '/automation/v4/flows', payload);
  }
}
```
