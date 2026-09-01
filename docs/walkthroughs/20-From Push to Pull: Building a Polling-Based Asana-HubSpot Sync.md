## 🎬 YouTube Episode Guide: From Push to Pull: Building a Polling-Based Asana–HubSpot Sync

**🎯 Core Learning Objective:**
"By the end of this video, you will know how to build a reliable, fully HubSpot-hosted polling loop that reads Asana's Events API every hour, filters out irrelevant events, prevents echo loops, and writes stage changes back to HubSpot — without any external infrastructure."

**⏱️ The 10-Minute Script Outline:**

*   **Hook & Demo (0:00 - 1:00):** "We built a bidirectional sync between HubSpot and Asana. The HubSpot→Asana direction worked great. But when someone moves a task in Asana, HubSpot knew nothing about it. We tried a push webhook — but HubSpot's serverless layer strips the secret header Asana needs for its handshake. So we had to flip the model: instead of Asana pushing events to us, we pull them on a schedule. I'll show you the finished system: change a stage in Asana, wait up to an hour, and HubSpot updates automatically."

*   **The Architecture (1:00 - 3:00):** Three concepts to understand before the code:
    1. **Asana Events API**: `GET /events?resource={projectGid}&sync={token}` returns all events since your last sync token. On the first call, you get a token but no events. On every subsequent call, you get events + a new token. Tokens expire after ~24 hours of inactivity — Asana returns a 412 with a fresh one.
    2. **Sync token storage**: We need to persist the sync token between hourly runs. We store it as a property (`asana_sync_token`) on the App Config custom object — the single record that already holds portal-level settings.
    3. **HubSpot Scheduled Workflow**: A workflow scoped to the App Config object type, with hourly re-enrollment, calls our `AsanaPoll` custom action once per hour per portal. The enrolled record's `hs_object_id` is the App Config record ID, which the function uses to read and write the sync token.

*   **Step-by-Step Implementation (3:00 - 8:00):**

    **Step 1 — Asana Events API client** (`src/app/lib/asana-client.ts`):
    Add `pollAsanaEvents(apiKey, projectGid, syncToken)`. Handle three cases: no token (first run), valid token (return events), 412 expired token (return fresh token, zero events).

    **Step 2 — Sync token persistence** (`src/app/lib/hubspot-client.ts`):
    Add `getAsanaSyncToken(objectTypeId, recordId)` and `setAsanaSyncToken(objectTypeId, recordId, token)`. Uses the App Config record ID from the workflow's `hs_object_id` — direct GET by ID, no search needed.

    **Step 3 — The `AsanaPoll` function** (`src/app/functions/AsanaPoll.ts`):
    The workflow action entry point. Reads the stored token → polls Asana → saves the new token immediately (before processing so progress isn't lost on partial failure) → filters events for task custom_field changes → skips tasks not linked to a HubSpot record → applies echo prevention → writes the new stage to HubSpot.

    **Step 4 — Register as a workflow action + provision** (`src/app/workflow-actions/asana-poll-hsmeta.json`, `src/scripts/provision-asana-sync-token.ts`, `src/scripts/provision-workflows.ts`):
    The hsmeta registers `AsanaPoll` as a CWA (no input fields needed). The sync-token script adds `asana_sync_token` property to App Config. The workflows script discovers the poll action ID and creates the hourly scheduled workflow on the App Config object type.

*   **Testing & Wrap-up (8:00 - 10:00):**
    Trigger the workflow action manually in HubSpot (enroll the App Config record once). Watch the logs: first run stores a sync token and returns 0 events. Then move a task in Asana. Trigger again — you should see the event and the HubSpot record updating. Key things to verify: 412 handling (clear the token manually), echo prevention (move HubSpot→Asana first, confirm the bounce-back is ignored), and non-content task filtering (only tasks with a linked `asana_task_url` in HubSpot are processed). What we learned: when a platform strips headers and breaks your webhook handshake, pull-based polling is often the cleanest alternative — and storing the cursor (sync token) on an existing config record keeps the whole thing serverless.

**💻 Screen-Ready Code Snippets:**

```typescript
// asana-client.ts — poll the Events API
export async function pollAsanaEvents(
  apiKey: string,
  projectGid: string,
  syncToken: string | null,
): Promise<{ events: AsanaEvent[]; syncToken: string }> {
  const url = syncToken
    ? `${ASANA_API}/events?resource=${projectGid}&sync=${syncToken}`
    : `${ASANA_API}/events?resource=${projectGid}`;

  const res = await fetch(url, { headers: { Authorization: `Bearer ${apiKey}` } });

  if (res.status === 412) {
    // Token expired — Asana sends a fresh one in the response body
    const json = await res.json() as { sync: string };
    return { events: [], syncToken: json.sync };
  }

  if (!res.ok) throw new Error(`Asana events poll failed ${res.status}: ${await res.text()}`);
  const json = await res.json() as { data: AsanaEvent[]; sync: string };
  return { events: json.data ?? [], syncToken: json.sync };
}
```

```typescript
// hubspot-client.ts — read/write sync token on App Config record
export async function getAsanaSyncToken(objectTypeId: string, recordId: string) {
  const token = getToken();
  const res = await fetch(
    `${HS_BASE}/crm/v3/objects/${objectTypeId}/${recordId}?properties=asana_sync_token`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  const data = await res.json() as { properties: { asana_sync_token: string | null } };
  return data.properties.asana_sync_token ?? null;
}

export async function setAsanaSyncToken(
  objectTypeId: string, recordId: string, syncToken: string,
) {
  await hsUpdate(objectTypeId, recordId, { asana_sync_token: syncToken });
}
```

```typescript
// AsanaPoll.ts — core of the function (simplified)
export async function main(context: AsanaPollContext) {
  const config = getPortalConfig(context.accountId);
  const recordId = context.body.hs_object_id!;

  const storedToken = await getAsanaSyncToken(config.appConfig.objectTypeId, recordId);
  const { events, syncToken: newToken } = await pollAsanaEvents(
    asanaApiKey, config.asanaProjectGid, storedToken,
  );

  // Save token first — progress is kept even if processing partially fails
  await setAsanaSyncToken(config.appConfig.objectTypeId, recordId, newToken);

  let updatedCount = 0;
  for (const event of events) {
    if (event.resource.resource_type !== 'task') continue;
    if (event.action !== 'changed') continue;
    if (event.change?.field !== 'custom_fields') continue;

    // ... look up HubSpot record, check echo, apply stage update ...
    updatedCount++;
  }

  return { statusCode: 200, body: JSON.stringify({
    outputFields: { syncStatus: 'success', processed: String(updatedCount) },
  })};
}
```

```typescript
// provision-workflows.ts — scheduled hourly workflow (key excerpt)
function buildPollWorkflow(name: string, appConfigObjectTypeId: string, asanaPollId: string) {
  return {
    name,
    type: 'PLATFORM_FLOW',
    flowType: 'WORKFLOW',
    isEnabled: false,
    objectTypeId: appConfigObjectTypeId,
    enrollmentCriteria: {
      shouldReEnroll: true,
      type: 'SCHEDULED',
      schedule: { frequencyType: 'HOURLY', startHour: 0, startMinutes: 0 },
    },
    actions: [{
      type: 'SINGLE_CONNECTION',
      actionId: '1',
      actionTypeId: asanaPollId,
      actionTypeVersion: 0,
      fields: {},
    }],
  };
}
```
