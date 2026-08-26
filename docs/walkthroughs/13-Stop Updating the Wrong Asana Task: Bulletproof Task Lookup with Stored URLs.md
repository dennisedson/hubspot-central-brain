## 🎬 YouTube Episode Guide: Stop Updating the Wrong Asana Task

**🎯 Core Learning Objective:**
"By the end of this video, you will know how to implement a three-tier task lookup strategy in a HubSpot workflow action that prevents silent data corruption when syncing to Asana."

**⏱️ The 10-Minute Script Outline:**

*   **Hook & Demo (0:00 - 1:00):** You wired up your HubSpot-to-Asana sync, triggered it, got a 200 — and it silently updated the wrong task. We show the bug live: passing an empty `linearIssueUrl` to Asana's custom field search returns the *first* task in the project. This is a class of bug where success responses hide data corruption. We fix it with a three-tier lookup hierarchy.

*   **The Architecture (1:00 - 3:00):** Three lookup tiers, evaluated in order:
    1. **Stored URL** — if `asana_task_url` is already on the HubSpot record, extract the GID from the URL and skip all API calls.
    2. **Linear URL search** — only if `linearIssueUrl` is non-empty, search Asana by custom field value.
    3. **Create new** — if neither lookup finds a task, create one and write its URL back to HubSpot as an output field.
    Tier 1 makes re-syncs idempotent and fast. The guard on Tier 2 is the critical bug fix — an empty string search returns a random existing task.

*   **Step-by-Step Implementation (3:00 - 8:00):**
    *   **Step 1 — Add `existingAsanaTaskUrl` input field** (`src/app/workflow-actions/sync-to-asana-hsmeta.json`): Add it as an optional `OBJECT_PROPERTY` input that maps to the `asana_task_url` CRM property. Mark `isRequired: false`.
    *   **Step 2 — Update the TypeScript interface** (`src/app/functions/SyncToAsana.ts`): Add `existingAsanaTaskUrl?: string` and make `title` and `linearIssueUrl` optional too (required fields on a live action break existing enrollments).
    *   **Step 3 — Implement the lookup hierarchy**: Replace the single `findTaskByLinearIssueUrl` call with the three-tier block. Parse GID from the URL with `url.split('/').at(-1)`.
    *   **Step 4 — Guard the search call**: Wrap `findTaskByLinearIssueUrl` with `if (!taskGid && linearIssueUrl)` — this single condition prevents the entire class of empty-string search bugs.

*   **Testing & Wrap-up (8:00 - 10:00):** Test three scenarios: (1) HubSpot record already has `asana_task_url` → verify `createTask` and `findTaskByLinearIssueUrl` are NOT called. (2) No stored URL, valid Linear URL → verify search is called. (3) No stored URL, empty Linear URL → verify a new task is created. Show the unit tests for each case. Summary: always prefer idempotent stored state over live API searches, and always guard searches against empty inputs.

**💻 Screen-Ready Code Snippets:**

```typescript
// src/app/functions/SyncToAsana.ts — three-tier lookup
const { title, existingAsanaTaskUrl, linearIssueUrl, hubspotStage, objectType } = context.body.inputFields;

let taskGid: string | null = null;

// Tier 1: use the stored Asana task URL — no API call needed
if (existingAsanaTaskUrl) {
  const parts = existingAsanaTaskUrl.split('/');
  taskGid = parts[parts.length - 1] || null;
}

// Tier 2: search by Linear issue URL (only when non-empty — empty string matches random tasks)
if (!taskGid && linearIssueUrl) {
  taskGid = await findTaskByLinearIssueUrl(asanaApiKey, asanaProjectGid, linearIssueUrl);
}

// Tier 3: create a new task
if (taskGid) {
  await updateTaskPipelineStage(asanaApiKey, taskGid, asanaStageGid);
} else {
  const task = await createTask(asanaApiKey, asanaProjectGid, title ?? 'Untitled', customFields, sectionGid);
  taskGid = task.gid;
}

// Return the task URL as an output field so HubSpot stores it for future re-syncs
const asanaTaskUrl = `https://app.asana.com/0/${asanaProjectGid}/${taskGid}`;
```

```json
// sync-to-asana-hsmeta.json — optional input field for stored URL
{
  "typeDefinition": "OBJECT_PROPERTY",
  "isRequired": false,
  "label": "Existing Asana Task URL",
  "internalName": "existingAsanaTaskUrl",
  "description": "If set, skips task search and updates this task directly"
}
```
