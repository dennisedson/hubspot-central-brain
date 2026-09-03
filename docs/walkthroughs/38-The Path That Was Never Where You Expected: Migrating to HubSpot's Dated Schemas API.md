## 🎬 YouTube Episode Guide: The Path That Was Never Where You Expected

**🎯 Core Learning Objective:**
"By the end of this video, you will know how to locate and migrate to a HubSpot dated API path when the root is completely different from every other CRM family — and how to write tests that make the migration visible and safe."

**⏱️ The 10-Minute Script Outline:**

*   **Hook & Demo (0:00 - 1:00):** You've migrated every HubSpot API family to dated paths — objects, associations, properties, pipelines. One is left: schemas. You probed `/crm/schemas/2026-03`, `/crm/custom-objects/2026-03/schemas`, everything you could infer from the pattern. All 404. The spec JSON sitting on the developer portal tells you where it actually is in two seconds. We'll flip the last constant, run 515 tests, and close issue #14 for good.

*   **The Architecture (1:00 - 3:00):** HubSpot is retiring non-dated API versions like `/crm/v3/` in favor of dated ones like `2026-03`. The key insight is that dated families do NOT all share the same root path — most live under `/crm/<family>/2026-03/`, but schemas lives under `/crm-object-schemas/2026-03/schemas` (a completely different root). Every family prefix is centralized in one constant in `hs-api.ts`, so changing one line moves all call sites automatically. The tests in `hs-api.test.ts` act as a registry: they enumerate which families are on legacy paths vs dated paths, making the migration state readable from a test run.

*   **Step-by-Step Implementation (3:00 - 8:00):**
    1.  **Find the spec** — Open `https://developers.hubspot.com/docs/specs/2026-03/crm-schemas-v2026-03.json` in your browser while signed into HubSpot. The first path in the spec is `/crm-object-schemas/2026-03/schemas`. That's the answer.
    2.  **Flip the constant** — In `src/app/lib/hs-api.ts`, rename `SCHEMAS_V3 = '/crm/v3/schemas'` to `SCHEMAS_DATED = \`/crm-object-schemas/${HS_API_VERSION}/schemas\``. Both `schemasPath()` and `schemaAssociationsPath()` use this constant, so both move in one edit.
    3.  **Update the test registry** — In `src/app/__tests__/hs-api.test.ts`, move `schemasPath` out of the `legacyBuilders` array (it's now empty — every family is dated). Update the explicit `schemasPath()` assertion to the new value. Note: the schemas path won't pass the generic dated-path regex (`^/crm/[a-z-]+/VERSION/`) because it uses a different root, so it intentionally stays out of the generic `datedBuilders` array.
    4.  **Fix the downstream test** — `provision-associations.test.ts` has a hardcoded URL assertion for `schemaAssociationsPath`. Update both occurrences from `/crm/v3/schemas/` to `/crm-object-schemas/2026-03/schemas/`.

*   **Testing & Wrap-up (8:00 - 10:00):** Run `npm run test` — 515 tests, all green. The migration status describe block now reads "All families are on dated paths" instead of "Only schemas remains." The lesson: never infer a dated path from the pattern of other families — always verify against the spec JSON. The spec is the source of truth; it took seconds and saved an hour of dead-end probing.

**💻 Screen-Ready Code Snippets:**

`src/app/lib/hs-api.ts` — before and after:

```ts
// Before
const SCHEMAS_V3 = '/crm/v3/schemas';

// After
const SCHEMAS_DATED = `/crm-object-schemas/${HS_API_VERSION}/schemas`;
```

The two builder functions don't need any other change — they just reference the constant:

```ts
export function schemasPath(): string {
  return SCHEMAS_DATED;
}

export function schemaAssociationsPath(objectType: string): string {
  return `${SCHEMAS_DATED}/${objectType}/associations`;
}
```

`src/app/__tests__/hs-api.test.ts` — updated assertions:

```ts
describe('schemasPath', () => {
  it('builds the schemas path', () => {
    expect(schemasPath()).toBe('/crm-object-schemas/2026-03/schemas');
    expect(`${schemasPath()}?limit=100`).toBe('/crm-object-schemas/2026-03/schemas?limit=100');
  });
});
```

Migration status block — `legacyBuilders` goes empty:

```ts
// All families are now on dated paths. Schemas uses a different root:
// /crm-object-schemas/2026-03/schemas (not /crm/<family>/2026-03).
const legacyBuilders: Array<[string, string]> = [];
```
