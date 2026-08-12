## 🎬 YouTube Episode Guide: Build a Type-Safe HubSpot CRM Client in TypeScript

**🎯 Core Learning Objective:**
"By the end of this video, you will know how to build a fully type-safe HubSpot CRM client wrapper in TypeScript that can search for records by a custom ID, retrieve pipeline stage, and upsert (create or update) custom objects — all powered by env-var config and tested with Vitest mocks."

---

**⏱️ The 10-Minute Script Outline:**

*   **Hook & Demo (0:00 - 1:00):**
    We're building the engine that powers bidirectional sync between Linear and HubSpot. Instead of firing blind API calls, our app needs to know: "Does a HubSpot record for this Linear issue already exist? What stage is it in? Create it if not, update it if so." I'll show the finished test run — 9 new tests, all green — and what a real upsert call looks like end-to-end.

*   **The Architecture (1:00 - 3:00):**
    Three concepts working together:
    1. **Portal Config** — a flat config object backed by environment variables with safe `FILL_IN` defaults. You fill in the real IDs after provisioning. No hardcoded portal values in code.
    2. **HubSpot Client wrapper** — thin functions over `@hubspot/api-client` v12. We never scatter raw API calls across the app; every HubSpot touch goes through this module.
    3. **Upsert pattern** — always search first (`findByLinearId`), then create or update based on the result. The `notes` property carries the Linear issue description so nothing is lost in translation.

*   **Step-by-Step Implementation (3:00 - 8:00):**

    **Step 1 — `portal-config.ts` (3:00 - 4:30)**
    Open `src/app/lib/portal-config.ts`. This is a thin config object:
    - Two top-level keys: `content` and `changelog`
    - Each has `objectTypeId`, `pipelineId`, and a `stageIds` map
    - Every value reads from `process.env` first, falls back to `'FILL_IN'`
    - Nothing to deploy yet — this file is a placeholder until `npm run provision` runs in Task 8

    **Step 2 — `findByLinearId` and `getCurrentStage` (4:30 - 6:00)**
    Open `src/app/lib/hubspot-client.ts`.
    - `findByLinearId` calls `searchApi.doSearch` with a single filter on `linear_issue_id` and returns the first result's `id`, or `null`
    - `getCurrentStage` does the same search but also requests `hs_pipeline_stage` in the properties array, returning `response.results[0]?.properties?.hs_pipeline_stage ?? null`
    - Key type fix: use `FilterOperatorEnum.Eq` from the HubSpot SDK (not the raw string `'EQ'`)

    **Step 3 — `upsertContent` and `upsertChangelog` (6:00 - 7:30)**
    Both functions follow the same pattern:
    1. Map the Linear state name through the mapping table (`LINEAR_STATE_TO_CONTENT_STAGE` / `LINEAR_STATE_TO_CHANGELOG_STAGE`)
    2. Look up the HubSpot stage ID from `PORTAL_CONFIG`
    3. Build a `properties` object — note the `...(data.description ? { notes: data.description } : {})` spread that conditionally sets the `notes` field
    4. Call `findByLinearId` — if found, call `basicApi.update`; if not, call `basicApi.create` with `associations: []`
    5. Return `{ id, action: 'created' | 'updated' }`

    **Step 4 — TDD with Vitest mocks (7:30 - 8:00)**
    Open `src/app/__tests__/hubspot-client.test.ts`.
    - `mockSearch`, `mockUpdate`, `mockCreate` are `vi.fn()` stubs assembled into a fake client typed as `any`
    - Each test sets `mockSearch.mockResolvedValue(...)` then calls the function and asserts on the mock's call args
    - `beforeEach(() => vi.clearAllMocks())` keeps tests isolated

*   **Testing & Wrap-up (8:00 - 10:00):**
    Run `npm test` — 26 tests pass across `hmac`, `mapping`, and `hubspot-client` suites.
    Run `npm run typecheck` — zero errors.
    Run `npm run validate` — lint + typecheck + test all green.

    What we learned:
    - How to wrap `@hubspot/api-client` v12 with type-safe helpers
    - The upsert pattern: search → create or update
    - Using env-var-backed config with safe defaults for values that don't exist yet
    - Testing async HubSpot calls cleanly with Vitest `vi.fn()` mocks

---

**💻 Screen-Ready Code Snippets:**

**`portal-config.ts` (the placeholder):**
```typescript
export const PORTAL_CONFIG = {
  content: {
    objectTypeId: process.env.CONTENT_OBJECT_TYPE_ID ?? '2-FILL_IN',
    pipelineId:   process.env.CONTENT_PIPELINE_ID   ?? 'FILL_IN',
    stageIds: {
      idea:      process.env.CONTENT_STAGE_IDEA      ?? 'FILL_IN',
      drafting:  process.env.CONTENT_STAGE_DRAFTING  ?? 'FILL_IN',
      published: process.env.CONTENT_STAGE_PUBLISHED ?? 'FILL_IN',
      // ...
    },
  },
  changelog: {
    objectTypeId: process.env.CHANGELOG_OBJECT_TYPE_ID ?? '2-FILL_IN',
    pipelineId:   process.env.CHANGELOG_PIPELINE_ID   ?? 'FILL_IN',
    stageIds: {
      identified: process.env.CHANGELOG_STAGE_IDENTIFIED  ?? 'FILL_IN',
      published:  process.env.CHANGELOG_STAGE_PUBLISHED_CL ?? 'FILL_IN',
      // ...
    },
  },
};
```

**`getCurrentStage` (the key addition):**
```typescript
export async function getCurrentStage(
  client: Client,
  objectTypeId: string,
  linearIssueId: string,
): Promise<string | null> {
  const response = await client.crm.objects.searchApi.doSearch(objectTypeId, {
    filterGroups: [{ filters: [{ propertyName: 'linear_issue_id', operator: FilterOperatorEnum.Eq, value: linearIssueId }] }],
    properties: ['linear_issue_id', 'hs_pipeline_stage'],
    limit: 1, sorts: [], query: '', after: '0',
  });
  return response.results[0]?.properties?.hs_pipeline_stage ?? null;
}
```

**`upsertContent` (the full upsert pattern):**
```typescript
export async function upsertContent(client: Client, payload: LinearWebhookPayload): Promise<UpsertResult> {
  const { data } = payload;
  const stageName = LINEAR_STATE_TO_CONTENT_STAGE[data.state.name] ?? 'idea';
  const stageId   = PORTAL_CONFIG.content.stageIds[stageName] ?? stageName;

  const properties: Record<string, string> = {
    title:            data.title,
    linear_issue_id:  data.id,
    linear_issue_url: data.url,
    hs_pipeline:       PORTAL_CONFIG.content.pipelineId,
    hs_pipeline_stage: stageId,
    ...(data.description ? { notes: data.description } : {}),
  };

  const existingId = await findByLinearId(client, PORTAL_CONFIG.content.objectTypeId, data.id);
  if (existingId) {
    await client.crm.objects.basicApi.update(PORTAL_CONFIG.content.objectTypeId, existingId, { properties });
    return { id: existingId, action: 'updated' };
  }
  const created = await client.crm.objects.basicApi.create(PORTAL_CONFIG.content.objectTypeId, { properties, associations: [] });
  return { id: created.id, action: 'created' };
}
```

**Vitest mock pattern:**
```typescript
const mockSearch = vi.fn();
const mockClient = { crm: { objects: { searchApi: { doSearch: mockSearch }, basicApi: { update: vi.fn(), create: vi.fn() } } } } as any;

it('returns null when no record exists', async () => {
  mockSearch.mockResolvedValue({ results: [] });
  expect(await getCurrentStage(mockClient, '2-content', 'lin-999')).toBeNull();
});
```
