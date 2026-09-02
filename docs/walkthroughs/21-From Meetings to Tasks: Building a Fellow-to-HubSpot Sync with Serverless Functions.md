## 🎬 YouTube Episode Guide: From Meetings to Tasks: Building a Fellow-to-HubSpot Sync

**🎯 Core Learning Objective:**
"By the end of this video, you will know how to poll the Fellow API for meeting action items and automatically create HubSpot native Tasks associated to matching contacts using a HubSpot Custom Workflow Action and serverless function — all running inside a single HubSpot Projects app with zero external hosting."

---

**⏱️ The 10-Minute Script Outline:**

*   **Hook & Demo (0:00 - 1:00):**
    After every meeting in Fellow, there's a list of action items assigned to people. Right now, those items live in Fellow and nowhere else — they don't appear in HubSpot, they're not tracked as Tasks, and they're not associated to the contacts involved. In this video we build the fix: a daily workflow that polls Fellow, creates HubSpot Tasks for each action item, and associates each task to the right contact by matching the assignee name to the meeting participants. Demo shows a Fellow meeting with two action items turning into two HubSpot Tasks linked to contacts.

*   **The Architecture (1:00 - 3:00):**
    This follows the exact same "daily poll" pattern as our Asana sync. A scheduled HubSpot workflow enrolls the App Config record once a day and triggers a Custom Workflow Action. The CWA is a serverless function that:
    1. Reads the last sync timestamp from App Config
    2. Calls `GET /hapi/v2/action_items?from_date=...` on the Fellow API
    3. For each action item group, fetches meeting participants to resolve assignee emails
    4. Creates or updates a HubSpot Task (native object `0-27`) with a dedup key (`fellow_action_item_id`)
    5. Associates the task to the matching HubSpot contact
    6. Saves the new sync timestamp before processing so progress is never lost

    The dedup key is `{meetingId}:{itemIndex}:{assigneeName}` — stable across runs for the same meeting. We skip the association step on updates because the link already exists.

*   **Step-by-Step Implementation (3:00 - 8:00):**

    **Step 1 — The Fellow API client (`src/app/lib/fellow-client.ts`)**
    Open `fellow-client.ts`. Two functions:
    - `pollFellowActionItems(apiKey, since)` — `GET /hapi/v2/action_items?from_date=X&to_date=Y`, returns typed `FellowActionItemGroup[]`
    - `getFellowMeetingParticipants(apiKey, meetingId)` — `GET /hapi/v2/meetings/{id}/participants`, returns participants with `email` and `name`
    Both use a simple `fellowGet()` helper that adds the Bearer auth header.

    **Step 2 — HubSpot helpers (`src/app/lib/hubspot-client.ts`)**
    Four new exports:
    - `getFellowLastSync` / `setFellowLastSync` — read/write `fellow_last_sync` on App Config (same pattern as `getAsanaSyncToken`)
    - `findContactByEmail` — GET a contact by email using `idProperty=email`
    - `upsertHubSpotTask` — search by `fellow_action_item_id`, PATCH if found, POST if not
    - `associateTaskToContact` — POST to `/crm/v4/associations/0-27/0-1/batch/create`

    **Step 3 — The serverless function (`src/app/functions/FellowSync.ts`)**
    Open `FellowSync.ts`. Walk through the main flow:
    - Guard for missing `FELLOW_API_KEY` and `hs_object_id`
    - Read last sync, poll Fellow, **save timestamp before processing**
    - For each group → fetch participants → build `emailByName` map
    - For each action item + assignee → look up contact → upsert task → associate on create
    - Return `outputFields: { syncStatus, tasksCreated, tasksUpdated }`

    **Step 4 — Configuration files and provisioning**
    Three config files mirror the Asana poll pattern:
    - `src/app/functions/fellow-sync-hsmeta.json` — registers the function at `/app/functions/FellowSync.js`
    - `src/app/workflow-actions/fellow-sync-hsmeta.json` — CWA definition with `${FELLOW_SYNC_URL}` placeholder (resolved by CI sed step)
    - `src/scripts/provision-fellow-sync.ts` — adds `fellow_last_sync` to App Config and `fellow_action_item_id` to Tasks (`0-27`) objects
    `provision-workflows.ts` discovers the `fellow_sync_v1` action ID and creates the daily workflow automatically.

*   **Testing & Wrap-up (8:00 - 10:00):**
    Run `npm test` — 11 new tests in `fellow-sync.test.ts`. Key cases to show:
    - Saves timestamp even when no items found
    - Creates task + associates contact when name matches
    - Sets status `COMPLETED` for done items
    - Skips association on task updates (link already exists)
    - Continues when participants fetch fails (graceful degradation)

    Then: `npm run provision:fellow-sync` to add the custom properties, deploy, and `npm run provision:workflows` to create the workflow. Enable the workflow in HubSpot and set a daily schedule.

    Summary: same poll pattern as Asana, but instead of updating pipeline stages we're creating native Tasks with contact associations. The dedup key makes re-runs safe — existing tasks update, new ones create.

---

**💻 Screen-Ready Code Snippets:**

```typescript
// fellow-client.ts — poll for action items since last sync
export async function pollFellowActionItems(
  apiKey: string,
  since: string | null,
): Promise<FellowActionItemGroup[]> {
  const from = since
    ? since.slice(0, 10)
    : new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const to = new Date().toISOString().slice(0, 10);
  const data = await fellowGet(apiKey, `/action_items?from_date=${from}&to_date=${to}`);
  // normalize and return as FellowActionItemGroup[]
}

export async function getFellowMeetingParticipants(
  apiKey: string,
  meetingId: string,
): Promise<FellowParticipant[]> {
  const data = await fellowGet(apiKey, `/meetings/${meetingId}/participants`);
  // normalize and return as FellowParticipant[]
}
```

```typescript
// FellowSync.ts — the core sync loop
const groups = await pollFellowActionItems(fellowApiKey, lastSync);

// Save timestamp BEFORE processing
const now = new Date().toISOString();
await setFellowLastSync(config.appConfig.objectTypeId, appConfigRecordId, now);

for (const group of groups) {
  const participants = await getFellowMeetingParticipants(fellowApiKey, group.meetingId);
  const emailByName = new Map(participants.map(p => [p.name.toLowerCase(), p.email]));

  for (let i = 0; i < group.actionItems.length; i++) {
    const item = group.actionItems[i];
    for (const assignee of item.assignees) {
      const actionItemId = `${group.meetingId}:${i}:${assignee.name.toLowerCase().replace(/\s+/g, '_')}`;
      const email = emailByName.get(assignee.name.toLowerCase());
      const contactId = email ? await findContactByEmail(email) : null;

      const result = await upsertHubSpotTask(actionItemId, {
        hs_task_subject: item.text.slice(0, 255),
        hs_task_body: `From meeting: ${group.noteTitle}\nAssigned to: ${assignee.name}`,
        hs_task_status: assignee.status === 'done' ? 'COMPLETED' : 'NOT_STARTED',
        hs_task_type: 'TODO',
        fellow_action_item_id: actionItemId,
      });

      if (contactId && result.action === 'created') {
        await associateTaskToContact(result.id, contactId);
      }
    }
  }
}
```

```typescript
// hubspot-client.ts — associate task to contact via v4 Associations API
export async function associateTaskToContact(taskId: string, contactId: string): Promise<void> {
  const token = getToken();
  await fetch(`${HS_BASE}/crm/v4/associations/0-27/0-1/batch/create`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      inputs: [{
        from: { id: taskId },
        to: { id: contactId },
        types: [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: 204 }],
      }],
    }),
  });
}
```
