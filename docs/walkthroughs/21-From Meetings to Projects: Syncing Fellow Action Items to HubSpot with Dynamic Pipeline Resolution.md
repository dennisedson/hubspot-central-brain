## 🎬 YouTube Episode Guide: From Meetings to Projects: Syncing Fellow Action Items to HubSpot

**🎯 Core Learning Objective:**
"By the end of this video, you will know how to poll the Fellow API for meeting action items and automatically create HubSpot Projects records associated to matching contacts — using dynamic pipeline stage resolution so zero IDs are hardcoded anywhere in your codebase."

---

**⏱️ The 10-Minute Script Outline:**

*   **Hook & Demo (0:00 - 1:00):**
    After every meeting in Fellow, there's a list of action items assigned to people. Right now, those items live in Fellow and nowhere else — they don't appear in HubSpot, they're not tracked, and they're not associated to the contacts involved. In this video we build the fix: a daily workflow that polls Fellow, creates HubSpot Projects for each action item, and associates each project to the right contact. We also make one architectural choice that protects you from a nasty class of breakage: instead of hardcoding pipeline stage IDs (which are opaque GUIDs that differ per portal), we resolve them dynamically at runtime by name. Demo shows a Fellow meeting with two action items turning into two HubSpot Projects — one in Execution, one in Completed — linked to contacts.

*   **The Architecture (1:00 - 3:00):**
    Same "daily poll" pattern as our Asana sync. A scheduled HubSpot workflow enrolls the App Config record once a day and triggers a Custom Workflow Action (CWA). The CWA is a serverless function that:
    1. Looks up the Projects pipeline by label ("Project Pipeline") and resolves stage IDs by label ("Execution", "Completed") — no hardcoded GUIDs
    2. Reads the last sync timestamp from App Config (same `fellow_last_sync` property pattern as `asana_sync_token`)
    3. Calls `GET /hapi/v2/action_items?from_date=...&to_date=...` on the Fellow API
    4. For each action item group, fetches meeting participants to resolve assignee emails
    5. Creates or updates a HubSpot Projects record via the `2026-03` versioned API with a dedup key (`fellow_action_item_id`)
    6. Associates the project to the matching HubSpot contact on create only
    7. Saves the new sync timestamp **before** processing so progress is never lost on partial failure

    Why Projects instead of Tasks? HubSpot Tasks (object `0-27`) have a fully locked schema — you cannot add custom properties. No dedup key means no idempotency. Projects is a native HubSpot object with a public API, custom property support (for the `fellow_action_item_id` dedup key), and pipeline stages. Available on all plans.

*   **Step-by-Step Implementation (3:00 - 8:00):**

    **Step 1 — The Fellow API client (`src/app/lib/fellow-client.ts`)**
    Two functions:
    - `pollFellowActionItems(apiKey, since)` — `GET /hapi/v2/action_items`, returns typed `FellowActionItemGroup[]`. Defaults to a 7-day lookback window when `since` is null.
    - `getFellowMeetingParticipants(apiKey, meetingId)` — `GET /hapi/v2/meetings/{id}/participants`, returns participants with `email` and `name`. Fellow action items only carry assignee names — participants give you the emails needed for contact lookup.

    **Step 2 — HubSpot helpers (`src/app/lib/hubspot-client.ts`)**
    Five new exports:
    - `getFellowLastSync` / `setFellowLastSync` — read/write `fellow_last_sync` on App Config
    - `findContactByEmail` — GET a contact by email using `idProperty=email`
    - `resolveProjectsPipeline` — calls `GET /crm/v3/pipelines/projects`, finds "Project Pipeline" by label, returns `{ pipelineId, executionStageId, completedStageId }`. Falls back to `results[0]` if no pipeline is named "Project Pipeline". Throws a clear error if a named stage doesn't exist.
    - `upsertFellowProject` — searches `/crm/objects/2026-03/projects/search` by `fellow_action_item_id`, PATCH if found, POST if not
    - `associateProjectToContact` — POST to `/crm/v4/associations/projects/contacts/batch/create`

    **Step 3 — The serverless function (`src/app/functions/FellowSync.ts`)**
    Walk through the main flow:
    - Guard for missing `FELLOW_API_KEY` and `hs_object_id`
    - Resolve portal config and pipeline IDs in parallel with `Promise.all([getFellowLastSync(...), resolveProjectsPipeline()])`
    - Poll Fellow, **save timestamp before processing**
    - For each group → fetch participants → build `emailByName` map
    - For each action item + assignee → look up contact → upsert project with `hs_pipeline`, `hs_pipeline_stage`, `hs_type: 'internal_ops'`, and `fellow_action_item_id`
    - Associate to contact on create only (link already exists on update)
    - Return `outputFields: { syncStatus, projectsCreated, projectsUpdated }`

    **Step 4 — Configuration and provisioning**
    - `src/app/workflow-actions/fellow-sync-hsmeta.json` — CWA definition with `${FELLOW_SYNC_URL}` placeholder resolved by a CI sed step. No function-level hsmeta needed — CWA-only functions are served at `hs-sites.com/hs/serverless/fellow-sync` by filename convention.
    - `src/scripts/provision-fellow-sync.ts` — adds `fellow_last_sync` to App Config and `fellow_action_item_id` to the Projects schema (`/crm/v3/properties/projects`). Safe to re-run.
    - `provision-workflows.ts` discovers the `fellow_sync_v1` action ID and creates the daily scheduled workflow.

*   **Testing & Wrap-up (8:00 - 10:00):**
    Run `npm test` — 11 new tests in `fellow-sync.test.ts`. Key cases to show:
    - Missing API key → 500 before any API calls
    - Saves timestamp even when zero items found
    - Creates project with correct pipeline ID + stage IDs from mock resolver
    - Sets `stage-completed` for done items, `stage-execution` for not_done
    - Associates contact on create, skips association on update
    - Continues gracefully when participant fetch fails for one meeting
    - Portal config failure → 500

    Then: `npm run provision:fellow-sync` to add custom properties, deploy, `npm run provision:workflows` to create the workflow. Enable in HubSpot and set a daily schedule.

    The key takeaway beyond the sync itself: **never hardcode pipeline stage IDs**. They're opaque GUIDs that differ per portal. Resolving by label at runtime costs one API call per sync run and makes your code self-healing across dev, staging, and production.

---

**💻 Screen-Ready Code Snippets:**

```typescript
// hubspot-client.ts — resolve pipeline IDs dynamically, no hardcoded GUIDs
export async function resolveProjectsPipeline(): Promise<ProjectsPipelineConfig> {
  const token = getToken();
  const res = await fetch(`${HS_BASE}/crm/v3/pipelines/projects`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const data = await res.json();

  const pipeline = data.results.find(p => p.label === 'Project Pipeline') ?? data.results[0];
  if (!pipeline) throw new Error('No Projects pipeline found in HubSpot');

  const find = (label: string) => {
    const stage = pipeline.stages.find(s => s.label === label);
    if (!stage) throw new Error(`Projects pipeline has no "${label}" stage`);
    return stage.id;
  };

  return {
    pipelineId: pipeline.id,
    executionStageId: find('Execution'),
    completedStageId: find('Completed'),
  };
}
```

```typescript
// FellowSync.ts — resolve pipeline + last sync in parallel, save timestamp before processing
const [lastSync, pipeline] = await Promise.all([
  getFellowLastSync(config.appConfig.objectTypeId, appConfigRecordId),
  resolveProjectsPipeline(),
]);

const groups = await pollFellowActionItems(fellowApiKey, lastSync);

// Save timestamp BEFORE processing — progress is never lost on partial failure
await setFellowLastSync(config.appConfig.objectTypeId, appConfigRecordId, new Date().toISOString());

for (const group of groups) {
  const participants = await getFellowMeetingParticipants(fellowApiKey, group.meetingId);
  const emailByName = new Map(participants.map(p => [p.name.toLowerCase(), p.email]));

  for (let i = 0; i < group.actionItems.length; i++) {
    const item = group.actionItems[i];
    for (const assignee of item.assignees) {
      const actionItemId = `${group.meetingId}:${i}:${assignee.name.toLowerCase().replace(/\s+/g, '_')}`;
      const email = emailByName.get(assignee.name.toLowerCase());
      const contactId = email ? await findContactByEmail(email) : null;

      const result = await upsertFellowProject(actionItemId, {
        hs_name: item.text.slice(0, 255),
        hs_description: `From meeting: ${group.noteTitle}\nAssigned to: ${assignee.name}`,
        hs_pipeline: pipeline.pipelineId,
        hs_pipeline_stage: assignee.status === 'done'
          ? pipeline.completedStageId
          : pipeline.executionStageId,
        hs_type: 'internal_ops',
        fellow_action_item_id: actionItemId,
      });

      if (result.action === 'created' && contactId) {
        await associateProjectToContact(result.id, contactId);
      }
    }
  }
}
```

```typescript
// hubspot-client.ts — upsert via the 2026-03 versioned Projects API
export async function upsertFellowProject(
  fellowActionItemId: string,
  properties: Record<string, string>,
): Promise<UpsertResult> {
  // Search by dedup key
  const searchRes = await fetch(`${HS_BASE}/crm/objects/2026-03/projects/search`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      filterGroups: [{ filters: [{ propertyName: 'fellow_action_item_id', operator: 'EQ', value: fellowActionItemId }] }],
      properties: ['fellow_action_item_id'],
      limit: 1,
    }),
  });
  const { results } = await searchRes.json();

  if (results.length > 0) {
    await fetch(`${HS_BASE}/crm/objects/2026-03/projects/${results[0].id}`, {
      method: 'PATCH', headers, body: JSON.stringify({ properties }),
    });
    return { id: results[0].id, action: 'updated' };
  }

  const createRes = await fetch(`${HS_BASE}/crm/objects/2026-03/projects`, {
    method: 'POST', headers, body: JSON.stringify({ properties }),
  });
  const created = await createRes.json();
  return { id: created.id, action: 'created' };
}
```
