## 🎬 YouTube Episode Guide: The Silent Filter Bug: When Your API Search Returns the Wrong Task

**🎯 Core Learning Objective:**
"By the end of this video, you will know how to diagnose and fix a silent API filter failure — where an endpoint accepts your query parameters, returns 200 OK, but silently ignores the filter and hands back arbitrary results."

**⏱️ The 10-Minute Script Outline:**

*   **Hook & Demo (0:00 - 1:00):**
    The app is running. A new changelog entry syncs from Linear to HubSpot. The HubSpot workflow fires. Asana returns `syncStatus: success` with a task GID. But when you open Asana, the Developer Changelog section is completely empty — and the task that "updated" is an old unrelated test entry from months ago. No error anywhere. 200 everywhere. And yet, entirely wrong. Today we track down why.

*   **The Architecture (1:00 - 3:00):**
    Walk through the three-system sync loop: Linear webhook → HubSpot custom object → HubSpot workflow → `SyncToAsana` serverless function → Asana. The `SyncToAsana` function has two lookup paths: (1) use the stored `asana_task_url` from the HubSpot record if present, or (2) search Asana by the Linear issue URL stored as a custom field on the task. Explain that path 2 is what gets triggered for brand-new records where no Asana task exists yet — and that's where the bug lives.

*   **Step-by-Step Implementation (3:00 - 8:00):**

    **Step 1 — Reproduce the symptom (3:00 - 4:30)**
    Show the monitoring panel: 6 calls, all 200. Show the `SyncToAsana` response body returning `asanaTaskGid: 1217883338136935`. Open Asana: that GID is "Dennis needs to solve this issue" — an old test task in the wrong section with a completely different Linear issue URL. The function found the wrong task. How?

    **Step 2 — Read the broken search code (4:30 - 5:30)**
    Open `src/app/lib/asana-client.ts`. Show `findTaskByLinearIssueUrl` — it calls `GET /tasks?project={gid}&custom_fields.{field_gid}.value={url}`. This looks correct. But the Asana `GET /tasks` endpoint **does not support custom field value filtering**. The parameter is silently ignored. The endpoint returns all tasks in the project, and `tasks[0]` is whatever Asana decides to return first — in this case, the old test task. No error. Just wrong data.

    **Step 3 — Find the right endpoint (5:30 - 6:30)**
    The correct endpoint for custom field filtering is `GET /workspaces/{workspace_gid}/tasks/search`. This is Asana's search API and it genuinely evaluates `custom_fields.{field_gid}.value`. We need the workspace GID — add `asanaWorkspaceGid` to the portal config (obtained by calling `GET /projects/{project_gid}?opt_fields=workspace.gid`).

    **Step 4 — Fix and second bug: case-insensitive state lookup (6:30 - 8:00)**
    While we're here, show the second bug: `findStateIdByName` in `linear-client.ts` does an exact string match (`s.name === stateName`). If your Linear team calls the state `"backlog"` and the mapping expects `"Backlog"`, the state is never found and the sync silently skips. One-line fix: `s.name.toLowerCase() === stateName.toLowerCase()`. Add a try-catch around `updateLinearIssueState` so a Linear API failure returns `200/skipped` instead of crashing the workflow chain and blocking Asana.

*   **Testing & Wrap-up (8:00 - 10:00):**
    After deploying: create a new changelog entry in Linear, move it through HubSpot stages. Show the Developer Changelog section in Asana now populating correctly with a fresh task. Show Linear's state updating when HubSpot stages change. Key lesson: when an API returns 200 with results but those results are wrong, suspect silent filter failure — always verify your filter parameters against the correct endpoint in the API docs, not just the base URL.

---

**💻 Screen-Ready Code Snippets:**

**Before — broken (GET /tasks ignores custom field filters):**
```typescript
export async function findTaskByLinearIssueUrl(
  apiKey: string,
  projectGid: string,
  linearIssueUrl: string,
): Promise<string | null> {
  const params = new URLSearchParams({
    project: projectGid,
    [`custom_fields.${ASANA_LINEAR_ISSUE_URL_FIELD_GID}.value`]: linearIssueUrl,
    opt_fields: 'gid,name',
  });
  // BUG: GET /tasks silently ignores the custom_fields filter
  const tasks = await request<Array<{ gid: string }>>(apiKey, 'GET', `/tasks?${params}`);
  return tasks[0]?.gid ?? null;
}
```

**After — fixed (workspace search endpoint respects custom field filters):**
```typescript
export async function findTaskByLinearIssueUrl(
  apiKey: string,
  workspaceGid: string,
  projectGid: string,
  linearIssueUrl: string,
): Promise<string | null> {
  const params = new URLSearchParams({
    'projects.any': projectGid,
    [`custom_fields.${ASANA_LINEAR_ISSUE_URL_FIELD_GID}.value`]: linearIssueUrl,
    opt_fields: 'gid,name',
  });
  const tasks = await request<Array<{ gid: string }>>(
    apiKey, 'GET', `/workspaces/${workspaceGid}/tasks/search?${params}`
  );
  return tasks[0]?.gid ?? null;
}
```

**Case-insensitive Linear state lookup:**
```typescript
export async function findStateIdByName(
  apiKey: string,
  teamId: string,
  stateName: string,
): Promise<string | null> {
  const states = await getLinearStates(apiKey, teamId);
  const lower = stateName.toLowerCase();
  return states.find(s => s.name.toLowerCase() === lower)?.id ?? null;
}
```

**Resilient SyncToLinear — never crashes the workflow chain:**
```typescript
try {
  await updateLinearIssueState(apiKey, linearIssueId, stateId);
} catch (err) {
  console.error(`Linear issueUpdate failed for issue ${linearIssueId}:`, err);
  return {
    statusCode: 200,
    body: JSON.stringify({ outputFields: { syncStatus: 'skipped', reason: 'linear_update_failed' } }),
  };
}
```
