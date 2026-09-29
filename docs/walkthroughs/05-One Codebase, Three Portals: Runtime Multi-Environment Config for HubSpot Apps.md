## 🎬 YouTube Episode Guide: One Codebase, Three Portals: Runtime Multi-Environment Config for HubSpot Apps

**🎯 Core Learning Objective:**
"By the end of this video, you will know how to deploy a single compiled HubSpot serverless app to dev, staging, and production portals — with each portal automatically using its own object IDs, pipeline IDs, and stage IDs at runtime."

**⏱️ The 10-Minute Script Outline:**

*   **Hook & Demo (0:00 - 1:00):** The same JS file runs in three different HubSpot portals. Each portal has different custom object IDs — what was provisioned in dev has completely different IDs in prod. We need the code to know which portal it's in and pick the right IDs automatically. We'll show the function receiving a webhook, looking up its portal ID, and resolving the correct `objectTypeId` in under a millisecond.

*   **The Architecture (1:00 - 3:00):** HubSpot serverless functions receive a `context` object with an `accountId` field — that's your portal ID. We build a static lookup map keyed by portal ID, with each entry containing all the provisioned IDs for that environment. A `getPortalConfig(portalId)` function does the lookup and throws a clear error if the portal isn't registered. No env vars, no secrets needed for IDs — it's all baked into the deployed JS.

*   **Step-by-Step Implementation (3:00 - 8:00):**
    1.  **The `PortalConfig` interface** — Define the shape: a single `content_piece` object type under `content`, with `objectTypeId` and a nested `pipelines` map. Each pipeline entry (`content` and `changelog`) has `pipelineId` and a `stageIds` record. TypeScript ensures every portal entry is complete.
    2.  **The `CONFIGS` map** — Keyed by portal ID (number). Show all three environments side-by-side. Each was populated by pasting the output of `npm run provision`.
    3.  **`getPortalConfig(portalId)`** — The lookup function. Throws if the portal isn't found so misconfiguration is loud, not silent.
    4.  **Threading `portalId` through the function** — `LinearWebhook.ts` receives `context.accountId`. Determine `pipelineKey` from the issue labels, then call `upsertContent(payload, portalId, pipelineKey)`. Inside, call `getPortalConfig(portalId)` and index into `config.content.pipelines[pipelineKey]` to get the right pipeline and stage IDs.

*   **Testing & Wrap-up (8:00 - 10:00):** Show the `context` object in a HubSpot serverless function. Call `getPortalConfig(context.accountId)` and log the result. Verify it returns dev IDs on the dev portal. Recap: provision each portal once, paste the IDs into the map, deploy once — done.

**💻 Screen-Ready Code Snippets:**

```typescript
// portal-config.ts
interface PipelineConfig {
  pipelineId: string;
  stageIds: Record<string, string>;
}

export interface PortalConfig {
  content: {
    objectTypeId: string;
    pipelines: {
      content: PipelineConfig;   // Content Lifecycle: idea/outline/drafting/editing/review/published/archived
      changelog: PipelineConfig; // Changelog Lifecycle: identified/drafting/reviewing/published
    };
  };
}

const CONFIGS: Record<number, PortalConfig> = {
  // dev
  51869810: {
    content: {
      objectTypeId: '2-67505887',
      pipelines: {
        content: {
          pipelineId: '926238627',
          stageIds: { idea: '1418659999', drafting: '1418660001', published: '1418660004', archived: '1418660005', /* ... */ },
        },
        changelog: { pipelineId: 'FILL_IN', stageIds: { identified: 'FILL_IN', /* ... */ } },
      },
    },
  },
  // staging
  51869787: {
    content: { objectTypeId: '2-67508770', pipelines: { content: { /* ... */ }, changelog: { /* ... */ } } },
  },
  // prod
  22047910: {
    content: { objectTypeId: '2-67508928', pipelines: { content: { /* ... */ }, changelog: { /* ... */ } } },
  },
};

export function getPortalConfig(portalId: number): PortalConfig {
  const config = CONFIGS[portalId];
  if (!config) {
    throw new Error(`No portal config found for portalId ${portalId}`);
  }
  return config;
}
```

```typescript
// LinearWebhook.ts — threading portalId through
export async function main(context: PublicFunctionContext) {
  // context.accountId is the HubSpot portal ID
  const pipelineKey: 'content' | 'changelog' = isChangelog ? 'changelog' : 'content';
  const result = await upsertContent(payload, context.accountId, pipelineKey);
}

// hubspot-client.ts — using it
export async function upsertContent(
  payload: LinearWebhookPayload,
  portalId: number,
  pipelineKey: 'content' | 'changelog' = 'content',
): Promise<UpsertResult> {
  const config = getPortalConfig(portalId);
  const objectTypeId = config.content.objectTypeId;
  const pipelineConfig = config.content.pipelines[pipelineKey];
  const stageId = pipelineConfig.stageIds[stageName];
  // ...
}
```
