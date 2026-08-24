## 🎬 YouTube Episode Guide: Closing the Loop: Building the HubSpot to Linear Workflow Action

**🎯 Core Learning Objective:**
"By the end of this video, you will know how to register a custom HubSpot workflow action in a 2026.03 app, wire it to a serverless function, and trigger it automatically when a CRM record changes stage."

**⏱️ The 10-Minute Script Outline:**

*   **Hook & Demo (0:00 - 1:00):** "We already have Linear pushing changes into HubSpot. Now we close the loop — move a Content Piece to a new pipeline stage in HubSpot, and watch the linked Linear issue update automatically. Here's the live demo."

*   **The Architecture (1:00 - 3:00):** A custom workflow action is a registered extension point in your app that appears in HubSpot's workflow editor. When a Content Piece stage changes, the workflow calls your public endpoint function with input fields you define. The function maps the HubSpot stage name to a Linear state name, looks up the state ID via Linear's GraphQL API, and fires an `issueUpdate` mutation.

*   **Step-by-Step Implementation (3:00 - 8:00):**
    1.  **Register the custom action** — `src/app/workflow-actions/sync-to-linear-hsmeta.json`. The `actionUrl` is the public endpoint URL (injected via `${SYNC_TO_LINEAR_URL}` at deploy time). Define `inputFields` for `sharedSecret`, `linearIssueId`, `hubspotStage`, `objectType`, and `linearTeamId`, plus `outputFields` for `syncStatus` and `linearStateName`.
    2.  **The serverless function** — `SyncToLinear.ts`. Verify the shared secret first (it's the only auth possible since headers are stripped). Map `hubspotStage` → Linear state name via `CONTENT_STAGE_TO_LINEAR_STATE`. Call `findStateIdByName` then `updateLinearIssueState`.
    3.  **Create the workflow in HubSpot** — Object-based workflow on Content Pieces. Enrollment trigger: `hs_pipeline_stage is known`. Re-enrollment: enabled, same condition. Add the "Sync Status to Linear" action. Configure input fields: `sharedSecret` as a static value, `linearIssueId` and `hubspotStage` as object properties, `objectType` and `linearTeamId` as static values.
    4.  **Enrollment settings** — When turning the workflow on, choose "No" for retroactive enrollment. You don't want to fire the action on all existing records (many won't have a valid `linear_issue_id`).

*   **Testing & Wrap-up (8:00 - 10:00):** Move a Content Piece that was originally created from a Linear issue to a new stage. Check the workflow history for a success result showing `syncStatus: success` and `linearStateName`. Verify the Linear issue state changed. Recap: custom action registration, shared secret auth, stage mapping, enrollment settings.

**💻 Screen-Ready Code Snippets:**

```json
// workflow-actions/sync-to-linear-hsmeta.json (key parts)
{
  "uid": "sync_to_linear_action",
  "type": "workflow-action",
  "config": {
    "actionUrl": "${SYNC_TO_LINEAR_URL}",
    "isPublished": true,
    "inputFields": [
      {
        "typeDefinition": { "name": "sharedSecret", "type": "string", "fieldType": "text" },
        "supportedValueTypes": ["STATIC_VALUE"],
        "isRequired": true
      },
      {
        "typeDefinition": { "name": "linearIssueId", "type": "string", "fieldType": "text" },
        "supportedValueTypes": ["OBJECT_PROPERTY"],
        "isRequired": true
      },
      {
        "typeDefinition": { "name": "hubspotStage", "type": "string", "fieldType": "text" },
        "supportedValueTypes": ["OBJECT_PROPERTY"],
        "isRequired": true
      }
    ],
    "outputFields": [
      { "typeDefinition": { "name": "syncStatus", "type": "string", "fieldType": "text" } },
      { "typeDefinition": { "name": "linearStateName", "type": "string", "fieldType": "text" } }
    ]
  }
}
```

```typescript
// SyncToLinear.ts — core logic
const { linearIssueId, hubspotStage, objectType, linearTeamId } = context.body.inputFields;

const stageMap = objectType === 'changelog'
  ? CHANGELOG_STAGE_TO_LINEAR_STATE
  : CONTENT_STAGE_TO_LINEAR_STATE;

const targetStateName = (stageMap as Record<string, string>)[hubspotStage];
if (!targetStateName) {
  return { statusCode: 400, body: JSON.stringify({ error: `Unknown stage: "${hubspotStage}"` }) };
}

const stateId = await findStateIdByName(apiKey, linearTeamId, targetStateName);
await updateLinearIssueState(apiKey, linearIssueId, stateId);

return {
  statusCode: 200,
  body: JSON.stringify({ outputFields: { syncStatus: 'success', linearStateName: targetStateName } }),
};
```

**⚠️ Security Note:**
The `sharedSecret` is entered as a static value in the workflow action configuration. This is visible to anyone who can edit the workflow in HubSpot. The URL for the endpoint is also fully derivable (portal ID in domain + path in repo), so the shared secret is the only real protection. For a client product, generate and inject the secret programmatically during onboarding rather than asking the admin to enter it manually.
