## 🎬 YouTube Episode Guide: Settings That Actually Work: Wiring Runtime Config to the Webhook Handler

**🎯 Core Learning Objective:**
"By the end of this video, you will know how to read saved app settings from a HubSpot custom object at runtime and use them to filter which Linear events your webhook actually processes — so changing a setting in the UI immediately changes the app's behavior, no redeploy required."

---

**⏱️ The 10-Minute Script Outline:**

*   **Hook & Demo (0:00 - 1:00):**
    "We built a settings page last episode. Users can pick their Linear team and assignee filter from dropdowns — no UUIDs, no manual config. But here's the catch: those settings weren't actually connected to anything. The webhook was processing every Linear issue from every team regardless of what was saved. Today we close that gap. Watch: I change the configured team in the settings page, create an issue in a different team in Linear, and the webhook skips it. No code change. No redeploy. Just settings."

*   **The Architecture (1:00 - 3:00):**
    The app has three layers that need to talk to each other:
    1. **Settings page** (HubSpot UI) — writes `linearTeamId` (UUID), `assigneeFilter`, and `linearAssigneeId` to a HubSpot App Config custom object via `AppSettingsApi.ts`
    2. **`readAppSettings`** (in `hubspot-client.ts`) — reads those properties back from the same custom object at runtime
    3. **`LinearWebhook.ts`** — the function that needs to act on those settings

    `readAppSettings` was already wired up for `assigneeFilter`. But `linearTeamId` was fetched and silently discarded. The Linear webhook payload includes `data.team.id` (a UUID) on every issue event. Since both values are UUIDs, filtering is a direct equality check — no extra API calls needed.

    One architectural detail matters: `readAppSettings` was being called *after* the `remove` action handler, so deletions in the wrong team would still archive HubSpot records. Moving the settings read *before* the remove handler makes the team filter apply uniformly to all event types.

*   **Step-by-Step Implementation (3:00 - 8:00):**

    **Step 1 — Find the gap (3:00 - 4:30)**
    Open `LinearWebhook.ts`. At line 71, `readAppSettings` is called and returns `{ linearTeamId, assigneeFilter, linearAssigneeId }`. Scroll up — the `remove` handler runs on lines 54–68, before settings are read. And scroll down — `settings.assigneeFilter` is used, but `settings.linearTeamId` is never referenced anywhere. That's the gap.

    **Step 2 — Restructure the flow (4:30 - 6:30)**
    Move `readAppSettings` to the top of the try block, before the `remove` handler. Immediately after the call, add the team filter: if `settings.linearTeamId` is set and `payload.data.team.id` doesn't match, return a 200 skip response. The empty-string guard (`settings.linearTeamId && ...`) means the filter is opt-in — portals that haven't configured a team keep their existing behavior, no disruption.

    **Step 3 — Clean up the assignee section (6:30 - 8:00)**
    The `assigneeId` variable was declared inside the old post-remove block alongside the settings read. Now that settings are read earlier, move `assigneeId` down to where it's used. The assignee filter logic itself doesn't change — just the position in the file.

*   **Testing & Wrap-up (8:00 - 10:00):**
    In the settings page, confirm a Linear team is selected. Create a new Linear issue in a *different* team. Check the webhook monitoring — the function is called and returns `{ skipped: true, reason: "not configured team" }`. Now create an issue in the *configured* team — it creates a HubSpot record as expected. Recap: settings stored in HubSpot, read at runtime, no infrastructure changes needed to update behavior. The pattern — write to a custom object, read with `readAppSettings` at call time — is reusable for any future config the app needs.

---

**💻 Screen-Ready Code Snippets:**

**The restructured webhook handler (key section):**
```typescript
// Read settings once, before any action handling
const settings = await readAppSettings(context.accountId);

// Team filter — applies to all event types including removes.
// Empty linearTeamId means "process all teams" (opt-in filtering).
if (settings.linearTeamId && payload.data.team.id !== settings.linearTeamId) {
  return { statusCode: 200, body: JSON.stringify({ skipped: true, reason: 'not configured team' }) };
}

// Linear issue deletion
if (payload.action === 'remove') {
  // ... archive logic unchanged
}

// Assignee filter
const assigneeId = payload.data.assignee?.id;
if (settings.assigneeFilter === 'assigned' && !assigneeId) {
  return { statusCode: 200, body: JSON.stringify({ skipped: true, reason: 'no assignee' }) };
}
if (settings.assigneeFilter === 'mine' && assigneeId !== settings.linearAssigneeId) {
  return { statusCode: 200, body: JSON.stringify({ skipped: true, reason: 'not assigned to configured user' }) };
}
```

**The AppSettings type (for reference):**
```typescript
export interface AppSettings {
  linearTeamId: string;   // Linear team UUID — matches payload.data.team.id directly
  assigneeFilter: 'all' | 'assigned' | 'mine';
  linearAssigneeId: string;
}
```

**Why team IDs are UUIDs here but keys elsewhere:**
The settings page dropdown calls Linear's `teams { nodes { id name } }` and stores the UUID as the value. This is different from the `SyncToLinear` workflow action, where the user types a team *key* (like "DAD") as a static text field — that path uses a GraphQL `teams(filter: { key: { eq: $teamId } })` query to resolve it. Same Linear concept, two different ID formats depending on how the value enters the system.
