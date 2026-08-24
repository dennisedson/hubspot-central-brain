## 🎬 YouTube Episode Guide: Settings Without Code: Building a HubSpot App Settings Page

**🎯 Core Learning Objective:**
"By the end of this video, you will know how to add a settings page to a HubSpot 2026.03 app using React, wire it to a private backend function, and store configuration in a CRM custom object — so admins can configure the app without touching code."

**⏱️ The 10-Minute Script Outline:**

*   **Hook & Demo (0:00 - 1:00):** "Right now our app has hardcoded values — Linear team IDs, filter settings — that only a developer can change. In this video we add a real settings UI inside HubSpot that any admin can use. Here's the finished result: a settings page under Connected Apps that saves configuration directly to the CRM."

*   **The Architecture (1:00 - 3:00):** A settings page in HubSpot is a React component that lives in `src/app/settings/`. The UI calls a private backend function via `actions.serverless()`. That function uses the HubSpot CRM API to read and write settings to a dedicated custom object — one singleton record per portal that acts as the app's configuration store.

*   **Step-by-Step Implementation (3:00 - 8:00):**
    1.  **Scaffold the settings page** — run `hs project add` and select **Settings**. This generates `src/app/settings/` with a React component, hsmeta, and package.json. The settings package has its own dependencies separate from the root project.
    2.  **Create the storage object** — in HubSpot, create a custom object "App Config" with three single-line text properties: `linear_team_id`, `assignee_filter`, `linear_assignee_id`. Copy the generated object type ID (format `2-XXXXXXX`) and add it to `portal-config.ts`.
    3.  **Build the backend function** — `AppSettingsApi.ts` with no `endpoint` config (private function). Handles GET (search for the singleton record, return defaults if missing) and POST (upsert the singleton record). Add it to the esbuild script.
    4.  **Build the settings UI** — `SettingsPage.tsx` uses `actions.serverless('app_settings_api', { parameters: { method: 'GET' } })` to load settings on mount, and POST to save. Components: `Input` for team ID, `Select` for assignee filter, conditional `Input` for user ID when "My issues only" is selected.

*   **Testing & Wrap-up (8:00 - 10:00):** Navigate to Marketplace → Connected Apps → My Apps → your app → Settings tab. Enter a Linear team ID, select a filter, save. Check the App Config object in HubSpot CRM to confirm the record was created. Recap: scaffold, custom object, private function, React UI.

**💻 Screen-Ready Code Snippets:**

```json
// AppSettingsApi-hsmeta.json — private function, no endpoint config
{
  "uid": "app_settings_api",
  "type": "app-function",
  "config": {
    "entrypoint": "/app/functions/AppSettingsApi.js",
    "secretKeys": ["HS_ACCESS_TOKEN"]
  }
}
```

```typescript
// AppSettingsApi.ts — GET: return settings or defaults; POST: upsert singleton record
export async function main(context) {
  const client = createHubSpotClient();
  const { objectTypeId } = getPortalConfig(context.accountId).appConfig;

  if (context.body.method === 'GET') {
    const response = await client.crm.objects.searchApi.doSearch(objectTypeId, {
      filterGroups: [], properties: ['linear_team_id', 'assignee_filter', 'linear_assignee_id'],
      limit: 1, sorts: [], query: '', after: '0',
    });
    const record = response.results[0];
    return { statusCode: 200, body: JSON.stringify(record ? {
      linearTeamId: record.properties.linear_team_id ?? '',
      assigneeFilter: record.properties.assignee_filter ?? 'all',
      linearAssigneeId: record.properties.linear_assignee_id ?? '',
    } : DEFAULT_APP_SETTINGS) };
  }

  if (context.body.method === 'POST') {
    const existing = await client.crm.objects.searchApi.doSearch(objectTypeId, {
      filterGroups: [], properties: ['linear_team_id'],
      limit: 1, sorts: [], query: '', after: '0',
    });
    const properties = {
      linear_team_id: context.body.settings.linearTeamId,
      assignee_filter: context.body.settings.assigneeFilter,
      linear_assignee_id: context.body.settings.linearAssigneeId ?? '',
    };
    const existingId = existing.results[0]?.id;
    if (existingId) {
      await client.crm.objects.basicApi.update(objectTypeId, existingId, { properties });
    } else {
      await client.crm.objects.basicApi.create(objectTypeId, { properties, associations: [] });
    }
    return { statusCode: 200, body: JSON.stringify({ ok: true }) };
  }
}
```

```typescript
// SettingsPage.tsx — load on mount, save on button click
useEffect(() => {
  actions.serverless('app_settings_api', { parameters: { method: 'GET' } })
    .then(response => setSettings(JSON.parse(response.body)))
    .finally(() => setLoading(false));
}, [actions]);

const handleSave = () => {
  actions.serverless('app_settings_api', { parameters: { method: 'POST', settings } })
    .then(response => setStatus(response.status === 200 ? 'success' : 'error'));
};
```

**📋 Per-Portal Note:**
The App Config custom object must be created once per portal (dev, staging, prod) and its `objectTypeId` added to `portal-config.ts`. For a real client product, there's only one portal — the admin configures it once and never repeats it. The multi-portal setup is specific to a dev/staging/prod release pipeline.

**🚀 What's Next:**
The settings are stored but not yet read by the sync functions. The next step is wiring `LinearWebhook.ts` to call `AppSettingsApi` at runtime to apply the assignee filter before deciding whether to sync an incoming issue.
