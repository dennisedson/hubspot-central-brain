## 🎬 YouTube Episode Guide: One Object, Two Pipelines

**🎯 Core Learning Objective:**
"By the end of this video, you will know how to consolidate two separate HubSpot custom objects into one by adding a second pipeline, and how to update all your TypeScript code to route records through the right pipeline based on content type."

**⏱️ The 10-Minute Script Outline:**

*   **Hook & Demo (0:00 - 1:00):** We started with two custom objects: `content_piece` (blog posts, tutorials, videos) with a Content Lifecycle pipeline, and `changelog_entry` with its own Changelog Lifecycle pipeline. The problem: duplicated properties, duplicated workflow actions, two objects to query, and no easy way to view related content and changelogs together. HubSpot lets you add multiple pipelines to one object type — so we consolidate everything into `content_piece` with two pipelines. Demo: one HubSpot view showing both blog posts and changelogs, filtered by pipeline.

*   **The Architecture (1:00 - 3:00):** A HubSpot custom object can have multiple pipelines. Each record sits in exactly one pipeline. We add a `Changelog Lifecycle` pipeline to `content_piece` (Identified → Drafting → Reviewing → Published). A `content_type` property set to `'changelog'` lets us filter views. In code, a `pipelineKey: 'content' | 'changelog'` parameter routes all upsert/lookup operations to the correct pipeline and stage IDs — no duplicate functions needed.

*   **Step-by-Step Implementation (3:00 - 8:00):**
    *   **Step 1 — Provision the second pipeline** (`src/scripts/provision-objects.ts`): Inside `provisionContent()`, add a second `findExistingPipeline`/`create` block for `'Changelog Lifecycle'`. The provisioning script now prints both pipeline IDs in copy-paste format.
    *   **Step 2 — Restructure `PortalConfig`** (`src/app/lib/portal-config.ts`): Replace flat `content.pipelineId` with `content.pipelines.content` and `content.pipelines.changelog`, each containing `pipelineId` and `stageIds`. This makes the routing explicit and type-safe.
    *   **Step 3 — Unify `upsertContent`** (`src/app/lib/hubspot-client.ts`): Remove `upsertChangelog`. Add `pipelineKey: 'content' | 'changelog' = 'content'` parameter to `upsertContent`. Use `config.content.pipelines[pipelineKey]` to get the right pipeline and stage IDs. Set `content_type: 'changelog'` on records going through the changelog pipeline.
    *   **Step 4 — Update the webhook handler** (`src/app/functions/LinearWebhook.ts`): Remove the `upsertChangelog` import. Detect changelog issues with `const isChangelog = issue.labels.includes('changelog')`. Set `pipelineKey` accordingly and call `upsertContent(payload, accountId, pipelineKey)`.

*   **Testing & Wrap-up (8:00 - 10:00):** The key test: verify that `upsertContent` called with `'changelog'` hits the changelog pipeline IDs and sets `content_type: 'changelog'`, while `'content'` (the default) hits the content pipeline. Show that the same 84 tests all pass — no test rewrites needed, just mock config updates. Summary: HubSpot's multi-pipeline support lets you model distinct workflows on one object, keeping data unified while keeping logic separate.

**💻 Screen-Ready Code Snippets:**

```typescript
// portal-config.ts — nested pipeline config
interface PipelineConfig {
  pipelineId: string;
  stageIds: Record<string, string>;
}

export interface PortalConfig {
  content: {
    objectTypeId: string;
    pipelines: {
      content: PipelineConfig;    // Content Lifecycle: idea/outline/drafting/editing/review/published/archived
      changelog: PipelineConfig;  // Changelog Lifecycle: identified/drafting/reviewing/published
    };
  };
}
```

```typescript
// hubspot-client.ts — single upsert function for both pipelines
export async function upsertContent(
  payload: ContentPayload,
  portalId: number,
  pipelineKey: 'content' | 'changelog' = 'content',
): Promise<void> {
  const config = getPortalConfig(portalId);
  const pipelineConfig = config.content.pipelines[pipelineKey];

  const properties: Record<string, string> = {
    title: payload.title,
    linear_issue_url: payload.linearIssueUrl,
    pipeline: pipelineConfig.pipelineId,
    hs_pipeline_stage: pipelineConfig.stageIds[payload.stage] ?? '',
  };

  if (pipelineKey === 'changelog') {
    properties.content_type = 'changelog';
  }

  // upsert by linear_issue_id ...
}
```

```typescript
// LinearWebhook.ts — route to the right pipeline
const isChangelog = issue.labels.nodes.some(l => l.name.toLowerCase() === 'changelog');
const pipelineKey: 'content' | 'changelog' = isChangelog ? 'changelog' : 'content';
const pipelineConfig = portalConfig.content.pipelines[pipelineKey];

// Use pipelineConfig.stageIds to map Linear states to HubSpot stages
await upsertContent(payload, context.accountId, pipelineKey);
```

```typescript
// provision-objects.ts — create both pipelines on the same object
async function provisionContent(): Promise<void> {
  // ... create/find objectTypeId for content_piece ...

  let contentPipeline = await findExistingPipeline(objectTypeId, 'Content Lifecycle');
  if (!contentPipeline) {
    contentPipeline = await client.crm.pipelines.pipelinesApi.create(objectTypeId, {
      label: 'Content Lifecycle',
      stages: [/* idea, outline, drafting, editing, review, published, archived */],
    });
  }

  let changelogPipeline = await findExistingPipeline(objectTypeId, 'Changelog Lifecycle');
  if (!changelogPipeline) {
    changelogPipeline = await client.crm.pipelines.pipelinesApi.create(objectTypeId, {
      label: 'Changelog Lifecycle',
      stages: [/* identified, drafting, reviewing, published */],
    });
  }

  printPortalConfig(objectTypeId, contentPipeline, changelogPipeline);
}
```
