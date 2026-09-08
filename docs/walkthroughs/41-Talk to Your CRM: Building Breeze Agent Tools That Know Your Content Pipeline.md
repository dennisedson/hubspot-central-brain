## 🎬 YouTube Episode Guide: Talk to Your CRM: Building Breeze Agent Tools That Know Your Content Pipeline

**🎯 Core Learning Objective:**
"By the end of this video, you will know how to build custom Breeze Agent tools that let HubSpot's AI assistant query and act on your own CRM data — using nothing but a serverless function and a workflow action definition."

**⏱️ The 10-Minute Script Outline:**

*   **Hook & Demo (0:00 - 1:00):** Open HubSpot and ask the Breeze AI assistant: "What content is currently in review?" Watch it call your custom tool and return a live pipeline summary straight from your CRM. Then ask: "Route these meeting action items" and watch it automatically create content_piece records in HubSpot. This is a custom Breeze Agent — powered entirely by your own serverless function, with zero external AI calls.

*   **The Architecture (1:00 - 3:00):** Breeze Agents can call any workflow action as a tool. The magic is two config fields: `supportedClients: [{ client: "AGENTS", toolType: "GET_DATA" }]` and `llmConfig.actionDescription` — a plain-English description the LLM reads to decide when to call your tool. Your workflow action points to a public endpoint on your HubSpot project. When Breeze calls it, it sends a POST with `{ inputFields, origin: { portalId } }` and expects back `{ outputFields: { key: "string" } }` — all values must be strings. That's the entire contract.

*   **Step-by-Step Implementation (3:00 - 8:00):**
    1.  **The function file** (`BreezeContentPipeline.ts`) — Read `context.body.inputFields` for inputs and `context.accountId ?? context.body.origin?.portalId` for the portal ID. Query CRM objects, group by pipeline stage, return a text summary in `outputFields`. Every value must be a string — no objects, no arrays.
    2.  **The function hsmeta** (`BreezeContentPipeline-hsmeta.json`) — Standard `app-function` config with `endpoint.path` and `secretKeys`. Do NOT include `PRIVATE_APP_ACCESS_TOKEN` — it's a reserved keyword. Use `HS_ACCESS_TOKEN` only.
    3.  **The workflow action hsmeta** (`breeze-content-pipeline-hsmeta.json`) — Set `supportedClients[0].client: "AGENTS"`, `toolType: "GET_DATA"` (or `TAKE_ACTION` for write operations), and write a clear `actionDescription` — this is the prompt the AI reads. Add `"objectTypes": []` — required field even when empty. Set `actionUrl` to your project's public endpoint URL.
    4.  **The TAKE_ACTION pattern** (`BreezeMeetingRouter.ts`) — For tools that write data, use `toolType: "TAKE_ACTION"`. Classify input, call the HubSpot CRM API to create records, return a human-readable summary of what was done.

*   **Testing & Wrap-up (8:00 - 10:00):** After deploying with `hs project upload`, go to HubSpot → Automation → Workflows → Custom actions. Your new tools appear there. For agent testing, install the "Developer Tool Testing Agent" from the HubSpot Marketplace — it lets you call your tools directly from the AI assistant with custom inputs. Verify the `outputFields` come back as strings and the `actionDescription` triggers correctly. Wrap up: you now have an AI assistant that can query your content pipeline, find friction theme coverage gaps, and route meeting notes into HubSpot — all without leaving the chat.

**💻 Screen-Ready Code Snippets:**

**workflow-action hsmeta (GET_DATA tool):**
```json
{
  "uid": "breeze_content_pipeline_tool",
  "type": "workflow-action",
  "config": {
    "actionUrl": "https://YOUR_PORTAL_ID.hs-sites.com/hs/serverless/breeze-content-pipeline",
    "isPublished": false,
    "objectTypes": [],
    "supportedClients": [
      {
        "client": "AGENTS",
        "toolType": "GET_DATA",
        "llmConfig": {
          "actionDescription": "Use this tool to query the HubSpot content pipeline and see what content is in each stage..."
        }
      }
    ],
    "inputFields": [...],
    "outputFields": [
      { "typeDefinition": { "name": "pipelineSummary", "type": "string", "externalOptions": false } }
    ]
  }
}
```

**serverless function (core pattern):**
```typescript
export async function main(context) {
  const portalId = context.accountId ?? context.body.origin?.portalId ?? 0;
  const inputFields = context.body.inputFields ?? context.body.fields ?? {};
  const token = process.env.HS_ACCESS_TOKEN;

  // ... query CRM, build summary string ...

  return {
    statusCode: 200,
    body: JSON.stringify({
      outputFields: {
        pipelineSummary: "Stage: Drafting\n  • My Blog Post (target: Oct 1)",
        recordCount: "5",
      },
    }),
  };
}
```

**function hsmeta (no reserved secrets):**
```json
{
  "uid": "breeze_content_pipeline",
  "type": "app-function",
  "config": {
    "entrypoint": "/app/functions/BreezeContentPipeline.js",
    "endpoint": { "path": "breeze-content-pipeline", "methods": ["POST"] },
    "secretKeys": ["HS_ACCESS_TOKEN"]
  }
}
```
