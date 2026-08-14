## 🎬 YouTube Episode Guide: Never Hit a Label Conflict Again: Automating HubSpot Custom Object Provisioning

**🎯 Core Learning Objective:**
"By the end of this video, you will know how to write an idempotent TypeScript script that provisions HubSpot custom objects, properties, and pipelines from code — so your portal setup is repeatable, version-controlled, and never breaks on reserved label conflicts."

**⏱️ The 10-Minute Script Outline:**

*   **Hook & Demo (0:00 - 1:00):** You just ran `npm run provision` and watched three custom objects and their full pipeline stages appear in HubSpot in under 5 seconds. No clicking through Settings → Objects. No worrying about whether it already exists. Run it twice — nothing breaks. That's what we're building.

*   **The Architecture (1:00 - 3:00):** HubSpot's CRM schema API lets you create custom objects programmatically. The challenge is idempotency — if you run the script twice, you don't want duplicate objects or errors. We solve this with a `findExistingSchema()` helper that checks before creating. We also have to work around a gotcha: HubSpot reserves certain labels (like "Content") for built-in objects. We'll rename our object `content_piece` to avoid that collision.

*   **Step-by-Step Implementation (3:00 - 8:00):**
    1.  **The client setup** — `@hubspot/api-client` initialized with a Service Key (not a Personal Access Key from the developer portal — that's a different thing). Show the env var pattern.
    2.  **`findExistingSchema()`** — Call `coreApi.getAll()`, scan results for a matching `name` or `labels.singular`. Return the `objectTypeId` if found, `null` if not. This is the key to idempotency.
    3.  **`provisionContent()`** — The full pattern: check → skip or create schema with properties → check pipeline → skip or create pipeline with stages → print the IDs to paste into config. Walk through one object end-to-end.
    4.  **The label conflict** — Show the `OBJECT_TYPE_SINGULAR_LABEL_CONFLICT` error, explain why "Content" is reserved, and show the fix: rename to `content_piece` / `Content Piece`. The `groupName` must also match: `content_pieceinformation`.

*   **Testing & Wrap-up (8:00 - 10:00):** Run `npm run provision` against a clean sandbox. Show all three objects appearing. Run it again — all "Already exists" messages. Then show the printed IDs that go straight into `portal-config.ts`.

**💻 Screen-Ready Code Snippets:**

```typescript
// Check before creating — the key to idempotency
async function findExistingSchema(
  name: string,
  singularLabel: string,
): Promise<string | null> {
  const response = await (client.crm.schemas.coreApi as any).getAll(false);
  const match = response.results?.find(
    (s: any) => s.name === name || s.labels?.singular === singularLabel,
  );
  return match?.objectTypeId ?? null;
}

// Provision with skip-if-exists
async function provisionContent(): Promise<void> {
  let objectTypeId = await findExistingSchema('content_piece', 'Content Piece');

  if (objectTypeId) {
    console.log('Already exists. objectTypeId:', objectTypeId);
  } else {
    const schema = await client.crm.schemas.coreApi.create({
      name: 'content_piece',
      labels: { singular: 'Content Piece', plural: 'Content Pieces' },
      primaryDisplayProperty: 'title',
      requiredProperties: [],
      properties: [
        { name: 'title', label: 'Title', type: 'string', fieldType: 'text',
          groupName: 'content_pieceinformation' },
        { name: 'linear_issue_id', label: 'Linear Issue ID', type: 'string',
          fieldType: 'text', groupName: 'content_pieceinformation' },
        // ... more properties
      ],
      associatedObjects: ['CONTACT', 'COMPANY'],
    } as any);
    objectTypeId = schema.objectTypeId as string;
    console.log('Created. objectTypeId:', objectTypeId);
  }

  // Same pattern for the pipeline
  let pipeline = await findExistingPipeline(objectTypeId, 'Content Lifecycle');
  if (!pipeline) {
    pipeline = await client.crm.pipelines.pipelinesApi.create(objectTypeId, {
      label: 'Content Lifecycle',
      displayOrder: 0,
      stages: [
        { label: 'Idea', displayOrder: 0, metadata: { probability: '0.1' } },
        { label: 'Drafting', displayOrder: 2, metadata: { probability: '0.4' } },
        { label: 'Published', displayOrder: 5, metadata: { probability: '1.0' } },
      ],
    } as any);
  }

  // Print IDs for portal-config.ts
  console.log(`objectTypeId: '${objectTypeId}',`);
  console.log(`pipelineId: '${pipeline.id}',`);
}
```

```json
// package.json
{
  "scripts": {
    "provision": "tsx src/scripts/provision-objects.ts"
  }
}
```

```bash
# Run against any portal by swapping the key
export HUBSPOT_ACCESS_KEY=your-service-key-here
npm run provision
```
