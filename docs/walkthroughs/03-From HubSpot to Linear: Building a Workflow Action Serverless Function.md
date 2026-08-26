## 🎬 YouTube Episode Guide: From HubSpot to Linear: Building a Workflow Action Serverless Function

**🎯 Core Learning Objective:**
"By the end of this video, you will know how to build a HubSpot serverless function that acts as a custom workflow action — receiving a pipeline stage change, mapping it to a Linear state, and updating the Linear issue via the GraphQL API."

**⏱️ The 10-Minute Script Outline:**

*   **Hook & Demo (0:00 - 1:00):** "What if every time you move a content piece to 'Published' in HubSpot, the linked Linear issue automatically moves to 'Done'? That's exactly what we're building. Watch: I trigger a HubSpot workflow, and in seconds the Linear board updates itself — no manual work. This is the HubSpot-to-Linear sync direction, the missing half of a fully bidirectional integration."

*   **The Architecture (1:00 - 3:00):** Three pieces work together. First, a HubSpot Workflow Action definition — a JSON config that tells HubSpot what fields to collect and where to POST them. Second, a serverless function (`SyncToLinear.ts`) that receives that POST, translates the HubSpot pipeline stage to a Linear state name using our mapping table, resolves the state ID from the Linear GraphQL API, and calls `issueUpdate`. Third, the function config JSON that registers the function with the HubSpot project runtime. The stage mapping is the heart of it: `CONTENT_STAGE_TO_LINEAR_STATE` and `CHANGELOG_STAGE_TO_LINEAR_STATE` translate stage names like `'published'` to Linear state names like `'Done'`. Important caveat: HubSpot's `hs_pipeline_stage` property sends a numeric stage **ID** (e.g. `"1418660002"`), not a name. The function must reverse-lookup the ID against the portal config's `stageIds` map to get the name before hitting the mapping table.

*   **Step-by-Step Implementation (3:00 - 8:00):**
    *   **Step 1 — The test file** (`src/app/__tests__/sync-to-linear.test.ts`): Show the `beforeEach` pattern with `vi.resetModules()` and `vi.doMock()` to isolate each test's import. Explain why we use `import('../functions/SyncToLinear')` dynamically — so the mock is in place before the module loads. Run `npm test -- sync-to-linear` and watch it fail with "module not found."
    *   **Step 2 — The function** (`src/app/functions/SyncToLinear.ts`): Show the guard clause pattern (API key check → stage lookup → state ID lookup → update). Highlight the key cast: `(stageMap as Record<string, string>)[hubspotStage]` — explain why the naïve intersection cast would silently break for any stage outside the overlap of both types.
    *   **Step 3 — Function hsmeta** (`sync-to-linear-hsmeta.json`): Show the three config fields: `entrypoint` (`.js` extension for the runtime), `endpoint.path`, and `secretKeys`. Explain that `LINEAR_API_KEY` never touches source code — the runtime injects it at call time.
    *   **Step 4 — Workflow action hsmeta** (`workflow-actions/sync-to-linear-hsmeta.json`): Show the `actionUrl` placeholder and explain it gets filled post-deploy. Walk through the `inputFields` array — especially `objectType` as an `enumeration` with static options, contrasted with `linearIssueId` as an `OBJECT_PROPERTY` (pulled live from the HubSpot record).

*   **Testing & Wrap-up (8:00 - 10:00):** Run `npm test` — watch all 47 tests pass. Run `npm run validate` — lint, typecheck, tests all green. The 6 new tests cover: happy path (200), correct state ID forwarded to Linear, unknown stage (400), state not found in team (404), missing API key (500), and changelog object type routing. Recap: we built the outbound sync leg. The workflow action definition means any HubSpot workflow can now call this function as a native action — no webhooks to wire up manually.

**💻 Screen-Ready Code Snippets:**

**The stage-map lookup — with ID reverse-lookup (required):**
```typescript
// hs_pipeline_stage sends a numeric ID like "1418660002", not a name like "editing"
// Reverse-lookup the ID to get the name, then hit the mapping table
const config = getPortalConfig(context.accountId);
const stageIds = objectType === 'changelog' ? config.changelog.stageIds : config.content.stageIds;
const stageName = Object.entries(stageIds).find(([, id]) => id === hubspotStage)?.[0];

const stageMap = objectType === 'changelog'
  ? CHANGELOG_STAGE_TO_LINEAR_STATE
  : CONTENT_STAGE_TO_LINEAR_STATE;

const targetStateName = stageName ? (stageMap as Record<string, string>)[stageName] : undefined;
if (!targetStateName) {
  return { statusCode: 400, body: JSON.stringify({ error: `Unknown stage: "${hubspotStage}"` }) };
}
```

**The full handler flow:**
```typescript
export async function main(context) {
  const apiKey = process.env.LINEAR_API_KEY;
  if (!apiKey) return { statusCode: 500, body: JSON.stringify({ error: 'Server misconfiguration' }) };

  const { linearIssueId, hubspotStage, objectType, linearTeamId } = context.body.inputFields;
  const config = getPortalConfig(context.accountId);
  const stageIds = objectType === 'changelog' ? config.changelog.stageIds : config.content.stageIds;
  const stageName = Object.entries(stageIds).find(([, id]) => id === hubspotStage)?.[0];
  const stageMap = objectType === 'changelog' ? CHANGELOG_STAGE_TO_LINEAR_STATE : CONTENT_STAGE_TO_LINEAR_STATE;
  const targetStateName = stageName ? (stageMap as Record<string, string>)[stageName] : undefined;
  if (!targetStateName) return { statusCode: 400, body: JSON.stringify({ error: `Unknown stage: "${hubspotStage}"` }) };

  const stateId = await findStateIdByName(apiKey, linearTeamId, targetStateName);
  if (!stateId) return { statusCode: 404, body: JSON.stringify({ error: `State "${targetStateName}" not found` }) };

  await updateLinearIssueState(apiKey, linearIssueId, stateId);
  return { statusCode: 200, body: JSON.stringify({ outputFields: { syncStatus: 'success', linearStateName: targetStateName } }) };
}
```

**The TDD mock pattern:**
```typescript
beforeEach(async () => {
  vi.resetModules();
  vi.doMock('@lib/linear-client', () => ({
    findStateIdByName: vi.fn().mockResolvedValue('st-done'),
    updateLinearIssueState: vi.fn().mockResolvedValue(undefined),
  }));
  process.env.LINEAR_API_KEY = 'lin_test_key';
  const mod = await import('../functions/SyncToLinear');
  main = mod.main;
});
```

**The workflow action input field (enumeration type):**
```json
{
  "typeDefinition": {
    "name": "objectType",
    "type": "enumeration",
    "fieldType": "select",
    "options": [
      { "value": "content", "label": "Content" },
      { "value": "changelog", "label": "Changelog Entry" }
    ]
  },
  "supportedValueTypes": ["STATIC_VALUE"],
  "isRequired": true
}
```
