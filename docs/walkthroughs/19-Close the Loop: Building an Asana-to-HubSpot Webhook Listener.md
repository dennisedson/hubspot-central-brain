## 🎬 YouTube Episode Guide: Close the Loop: Building an Asana-to-HubSpot Webhook Listener

**🎯 Core Learning Objective:**
"By the end of this video, you will know how to receive Asana webhook events in a HubSpot serverless function, filter out noise from non-content tasks, prevent echo loops, and update a HubSpot CRM record when a stage changes in Asana."

---

**⏱️ The 10-Minute Script Outline:**

*   **Hook & Demo (0:00 - 1:00):**
    We've wired HubSpot → Linear → Asana. But the sync only goes one way: if someone moves a task in Asana, nothing happens in HubSpot. Today we close that loop. I'll show a task moving from "Peer Review" to "In Progress" in Asana, and watch the HubSpot record update in real time — without touching Linear.

*   **The Architecture (1:00 - 3:00):**
    Three things make this tricky. First, our Asana project has tasks that are NOT content records — "publish to YouTube," calendar reminders, random work items. We can't blindly sync everything. Second, when HubSpot moves a stage, it already updates Asana via `SyncToAsana`. If Asana then fires a webhook back at us, we'd create an infinite loop. Third, Asana requires a handshake when registering a webhook — and HubSpot's serverless runtime strips custom request headers, which makes that handshake interesting. We solve all three: filter by whether a HubSpot record is linked to the task, prevent echoes by comparing the incoming Asana stage against what HubSpot already has, and handle the handshake gracefully.

*   **Step-by-Step Implementation (3:00 - 8:00):**

    **Step 1 — Add the reverse stage mappings** (`src/app/lib/mapping.ts`)
    We already have `CONTENT_STAGE_TO_ASANA_STAGE` (HubSpot → Asana GID). Add the inverse: `ASANA_STAGE_TO_CONTENT_STAGE` and `ASANA_STAGE_TO_CHANGELOG_STAGE`. Note the lossy case: both `drafting` and `editing` forward-map to Asana's "In Progress" GID, so the reverse picks `drafting` as canonical.

    **Step 2 — Add `getTaskPipelineStage` to the Asana client** (`src/app/lib/asana-client.ts`)
    Asana webhook events tell you a custom field changed — but not what it changed to. We add a GET call that fetches `custom_fields.gid` and `custom_fields.enum_value.gid` for a task and plucks out the Pipeline Stage field.

    **Step 3 — Add `findContentByAsanaTaskUrl` to the HubSpot client** (`src/app/lib/hubspot-client.ts`)
    Given an Asana task URL (`https://app.asana.com/0/{projectGid}/{taskGid}`), search HubSpot for a content record where `asana_task_url` matches exactly. Return the record ID, pipeline, and current stage — or null if no record exists. A null result is the non-content task filter: if HubSpot doesn't know about this task, we skip it entirely.

    **Step 4 — The `AsanaWebhook` function** (`src/app/functions/AsanaWebhook.ts`)
    Walk through the main loop:
    - Handshake check: if `x-hook-secret` is in headers, echo it back in response headers.
    - Per event: skip non-task resources, skip non-`custom_fields` changes.
    - GET the task's current stage GID from Asana.
    - Look up the HubSpot record by URL — skip if not found.
    - Echo prevention: check if the HubSpot record's current stage maps forward to the same Asana GID. If yes, this event was triggered by our own `SyncToAsana` — skip it.
    - Map the Asana GID → HubSpot stage name → stage ID, then PATCH the HubSpot record.

*   **Testing & Wrap-up (8:00 - 10:00):**
    Show the test for the echo prevention case — HubSpot is at `editing` (which maps to "In Progress"), Asana fires "In Progress" back, and we correctly skip it. Then show the genuine-change case: HubSpot is at `drafting`, Asana fires "Peer Review," and we update to `review`. To register the webhook in production, run `provision-asana-webhook.ts` with the deployed function URL. If HubSpot forwards the `X-Hook-Secret` header, the handshake is automatic. If not, the script's header documents the ngrok workaround. The sync loop is now fully closed: Linear → HubSpot → Asana → HubSpot → Linear.

---

**💻 Screen-Ready Code Snippets:**

**Reverse stage mapping (`mapping.ts`):**
```typescript
export const ASANA_STAGE_TO_CONTENT_STAGE: Record<string, ContentStage> = {
  '1212751789107073': 'idea',
  '1213736254001623': 'outline',
  '1202184607667441': 'drafting',  // In Progress (canonical for editing too)
  '1202184607668470': 'review',
  '1202212684793528': 'published',
  '1202184607671632': 'archived',
};
```

**Get the task's current stage (`asana-client.ts`):**
```typescript
export async function getTaskPipelineStage(apiKey: string, taskGid: string): Promise<string | null> {
  const res = await fetch(
    `${ASANA_API}/tasks/${taskGid}?opt_fields=custom_fields.gid,custom_fields.enum_value.gid`,
    { headers: { Authorization: `Bearer ${apiKey}` } },
  );
  const json = await res.json();
  const field = json.data.custom_fields.find(f => f.gid === ASANA_PIPELINE_STAGE_FIELD_GID);
  return field?.enum_value?.gid ?? null;
}
```

**The core loop in `AsanaWebhook.ts`:**
```typescript
for (const event of events) {
  if (event.resource.resource_type !== 'task') continue;
  if (event.action !== 'changed') continue;
  if (event.change?.field !== 'custom_fields') continue;

  const asanaStageGid = await getTaskPipelineStage(asanaApiKey, event.resource.gid);
  if (!asanaStageGid) continue;

  const asanaTaskUrl = `https://app.asana.com/0/${config.asanaProjectGid}/${event.resource.gid}`;
  const record = await findContentByAsanaTaskUrl(config.content.objectTypeId, asanaTaskUrl);
  if (!record) continue; // not a tracked content task

  // Echo prevention
  const currentStageName = Object.keys(pipelineStageIds)
    .find(name => pipelineStageIds[name] === record.pipelineStage);
  if (currentStageName && stageToAsana[currentStageName] === asanaStageGid) continue;

  const targetStageName = asanaToStage[asanaStageGid];
  const targetStageId = pipelineStageIds[targetStageName];
  await hsUpdate(config.content.objectTypeId, record.id, { hs_pipeline_stage: targetStageId });
}
```
