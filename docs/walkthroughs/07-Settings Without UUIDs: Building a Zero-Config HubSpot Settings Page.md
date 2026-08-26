## 🎬 YouTube Episode Guide: Settings Without UUIDs: Building a Zero-Config HubSpot Settings Page

**🎯 Core Learning Objective:**
"By the end of this video, you will know how to build a HubSpot app settings page that pulls live data from a third-party API (Linear) to show friendly dropdowns instead of asking users to paste raw UUIDs."

**⏱️ The 10-Minute Script Outline:**

*   **Hook & Demo (0:00 - 1:00):** Show the finished settings page — three clean dropdowns: pick your Linear team by name, choose whether to sync all issues or just yours, pick yourself from a list of teammates. No UUIDs, no context-switching to Linear. Then show the old approach (copy UUID from Linear URL) to contrast why this matters.

*   **The Architecture (1:00 - 3:00):** Two pieces working together: an HTTP endpoint function (`AppSettingsApi`) that talks to both HubSpot CRM and the Linear GraphQL API, and a React settings extension that calls it via `hubspot.fetch()`. Explain why `hubspot.fetch()` + endpoint function is used instead of `hubspot.serverless()` — the docs explicitly recommend this for settings pages. Walk through the data flow: page loads → GET fetches saved settings + Linear teams → user picks team → POST fetches team members → user picks themselves → Save.

*   **Step-by-Step Implementation (3:00 - 8:00):**
    *   **Step 1 — The endpoint function hsmeta** (`AppSettingsApi-hsmeta.json`): Show the `endpoint` config with `path` and `methods`, plus `secretKeys` including both `HS_ACCESS_TOKEN` and `LINEAR_API_KEY`. Contrast with a private app-function (no endpoint block).
    *   **Step 2 — GET handler** (`AppSettingsApi.ts`): Show `context.accountId` for portal ID, the `Promise.all` that fetches HubSpot settings + Linear teams + Linear team members in parallel. Highlight the Linear GraphQL query for teams and members.
    *   **Step 3 — POST handler actions**: Show how a single POST endpoint handles two actions — `loadTeamMembers` (when team changes) and the default save. No separate endpoints needed.
    *   **Step 4 — The React settings page** (`SettingsPage.tsx`): Show `hubspot.extend<'settings'>` with context, the `PORTAL_SETTINGS_URLS` lookup map, and how `handleTeamChange` fires a live POST to reload members when the user picks a different team.

*   **Testing & Wrap-up (8:00 - 10:00):** Open Connected Apps → Settings tab → show all three dropdowns populated from live data, pick a team, watch the member list update, save. Confirm "Settings saved" banner. Summary: endpoint functions + hubspot.fetch() is the reliable pattern for settings pages; always use context.accountId not context.query.portalId.

**💻 Screen-Ready Code Snippets:**

```json
// AppSettingsApi-hsmeta.json — key config
{
  "uid": "app_settings_api",
  "type": "app-function",
  "config": {
    "entrypoint": "/app/functions/AppSettingsApi.js",
    "endpoint": {
      "path": "settings-api",
      "methods": ["GET", "POST"]
    },
    "secretKeys": ["HS_ACCESS_TOKEN", "LINEAR_API_KEY"]
  }
}
```

```typescript
// GET handler — parallel fetch of settings + Linear data
const [teams, teamMembers] = await Promise.all([
  linearApiKey ? getLinearTeams(linearApiKey) : Promise.resolve([]),
  linearApiKey && settings.linearTeamId
    ? getLinearTeamMembers(settings.linearTeamId, linearApiKey)
    : Promise.resolve([]),
]);
return { statusCode: 200, body: JSON.stringify({ ...settings, teams, teamMembers }) };
```

```typescript
// POST — two actions in one endpoint
if (body.action === 'loadTeamMembers') {
  const teamMembers = await getLinearTeamMembers(body.teamId, linearApiKey);
  return { statusCode: 200, body: JSON.stringify({ teamMembers }) };
}
// default: save settings to HubSpot CRM
```

```tsx
// SettingsPage.tsx — team change triggers live member reload
const handleTeamChange = useCallback((teamId: string) => {
  setSettings(s => ({ ...s, linearTeamId: teamId, linearAssigneeId: '' }));
  setTeamMembers([]);
  setLoadingMembers(true);
  hubspot.fetch(apiUrl, { method: 'POST', body: { action: 'loadTeamMembers', teamId } })
    .then(async res => {
      const data = await res.json();
      setTeamMembers(data.teamMembers ?? []);
    })
    .finally(() => setLoadingMembers(false));
}, [apiUrl]);
```
