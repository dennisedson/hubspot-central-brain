## 🎬 YouTube Episode Guide: The Association That Never Was

> **⚠️ Correction — do not film this episode as written.** Two central claims were later disproven by testing against a live portal. See [episode 34](34-The%20Name%20Was%20the%20Bug:%20Self-Referential%20HubSpot%20Associations%20That%20Actually%20Work.md), which supersedes this one.
>
> 1. **Self-referential associations are NOT blocked for custom objects.** The `ObjectSchemaError.CANNOT_ASSOCIATE_OBJECT_TYPE_WITH_ITSELF` rejection cited below came from a community report and does not reproduce. Creating a self-referential label succeeds immediately — provided you supply a **distinct name**. The real rejection is a name collision: the auto-generated `{type}_to_{type}` conflicts with a reserved unlabeled name that does not itself exist.
> 2. **`defined-unlabeled` is not the success state, and is not reachable.** There is no default/unlabeled association for a self-referential pairing and one cannot be created. The workflow action had to move off `.../associations/default/...` onto the **labeled** endpoint with a runtime-resolved `associationTypeId`.
>
> The provisioning *technique* below — idempotent, read-back-and-classify, unit-tested without a portal — is sound and worth teaching. Its conclusions about what HubSpot permits are not. The deeper lesson is the one episode 34 opens with: this episode was written from a community report and careful reading, and both were wrong. One live API call would have settled it, and eventually did.

**🎯 Core Learning Objective:**
"By the end of this video, you will know how to write an idempotent provisioning script that creates HubSpot association *definitions* between custom objects — including the self-referential case — and how to unit test the exact request it sends without ever touching a portal."

**⏱️ The 10-Minute Script Outline:**

*   **Hook & Demo (0:00 - 1:00):**
    "We shipped a workflow action that finds related content and associates the records. It deployed. It ran. It logged `0/3 associated` every single time — and nobody noticed for weeks, because the action was written to never fail loudly."

    Show `AssociateRelatedContent.ts` returning `associationStatus: 'failed'` with a 400 in the logs. Then show the actual cause, one line in `provision-objects.ts`:

    ```
    associatedObjects: ['CONTACT', 'COMPANY'],
    ```

    Content can associate to contacts and companies. It cannot associate to *content*. The definition the action needs was never created. Final demo: run the new script, watch it print `defined-labeled` and an `associationTypeId` for each pairing, then watch the action associate the records.

*   **The Architecture (1:00 - 3:00):**
    Plain English, no code yet. In HubSpot there are two completely different things both called "associations":

    1.  The **definition** (a.k.a. the association type) — a schema-level statement that "records of type A are allowed to associate with records of type B." Portal-wide, created once.
    2.  The **association** — an actual link between two records.

    You cannot create #2 until #1 exists. `associatedObjects` on schema creation makes #1, and that is the only place we ever made one.

    Then the twist worth the whole episode: there are *two different endpoints* for creating a definition after the fact, and which one you need depends on whether the two object types are the same.

    *   Different types (Content → Video): `POST /crm/v3/schemas/{type}/associations`. Creates the **unlabeled** definition.
    *   Same type (Content → Content): use `POST /crm/associations/2026-03/{type}/{type}/labels`, which creates a *labeled* definition.

    > **Corrected:** this section originally claimed the schema endpoint refuses same-type pairings with `CANNOT_ASSOCIATE_OBJECT_TYPE_WITH_ITSELF`. That does not reproduce. Self-referential definitions are permitted; the labels endpoint is the right route for them, but not because the other one is forbidden.

    And that distinction matters, because the workflow action originally called `.../associations/default/...` — the **unlabeled** path. That path cannot work for a self-referential pairing: no default association exists and none can be created. So the script does not assume: it creates, then reads back, then tells you which state you actually landed in. Episode 34 covers what it actually lands in.

*   **Step-by-Step Implementation (3:00 - 8:00):**

    **Step 1 — Name the pairings (open `src/scripts/association-definitions.ts`).**
    Start with the data, not the HTTP. Three pairings, one function, zero side effects. Point out on screen that the workflow action only ever associates same-type to same-type — so the two self-referential rows are the ones that unblock the bug.

    **Step 2 — One request builder per route (same file).**
    `definitionRequest()` branches on `isSelfReferential()`. Two things to call out while it is on screen: the self-referential body sends `label` but *not* `inverseLabel` — HubSpot returns a 500 when the two are the same string, and a symmetric relationship has nothing to put in the second one. And every URL comes from `hs-api.ts`, never inlined, so the pending dated-API migration is a one-line change.

    **Step 3 — Make idempotency a pure function (same file).**
    `classifyExisting()` turns the `GET .../labels` payload into three states: `undefined`, `defined-unlabeled`, `defined-labeled-only`. `planFor()` creates only on `undefined`. This is the part that makes re-running safe, and it is a pure function of a JSON blob — which is exactly why it is testable.

    Emphasise the third state. It is not paranoia: it is the state where the definition exists, the script would happily report success, and the workflow action still fails. Naming it is what makes it visible.

    **Step 4 — Test the request, not the portal (open `src/app/__tests__/provision-associations.test.ts`).**
    Stub `fetch`, assert the exact URL and the exact body. Show the idempotency test: first run POSTs three times, second run POSTs zero times. Point out you have proven the hard parts without credentials, without a sandbox, and in 24 milliseconds.

*   **Testing & Wrap-up (8:00 - 10:00):**
    `npx vitest run` — 32 new tests green. Then the real run: `npx tsx src/scripts/provision-associations.ts`, and read the summary line by line. Any pairing that is not `defined-unlabeled` gets called out explicitly with what to do about it, because a provisioning script that says "done" when it is not done is how we got here in the first place.

    What was learned: definitions are not associations; same-type and cross-type take different endpoints; and when the platform's behaviour is genuinely uncertain, the honest move is to attempt it, read the result back, and report — not to assume and log a green tick.

**💻 Screen-Ready Code Snippets:**

**1. The pairings — data first, HTTP later**

```ts
export function associationPairingsFor(content: string, video: string): AssociationPairing[] {
  return [
    { key: 'content_to_content', fromObjectTypeId: content, toObjectTypeId: content,
      name: 'content_piece_to_content_piece', label: 'Related Content' },
    { key: 'content_to_video',   fromObjectTypeId: content, toObjectTypeId: video,
      name: 'content_piece_to_video',         label: 'Related Video' },
    { key: 'video_to_video',     fromObjectTypeId: video,   toObjectTypeId: video,
      name: 'video_to_video',                 label: 'Related Video' },
  ];
}

export function isSelfReferential(p: AssociationPairing): boolean {
  return p.fromObjectTypeId === p.toObjectTypeId;
}
```

**2. Two routes, because HubSpot has two**

```ts
export function definitionRequest(p: AssociationPairing): HsRequest {
  // Same object type on both sides: use the labels endpoint, which creates a
  // labeled definition. Supply a DISTINCT name — the auto-generated
  // {type}_to_{type} collides with a reserved unlabeled name.
  // No inverseLabel — HubSpot 500s when it equals label.
  if (isSelfReferential(p)) {
    return {
      method: 'POST',
      url: `${HS_BASE}${associationLabelsPath(p.fromObjectTypeId, p.toObjectTypeId)}`,
      body: { name: p.name, label: p.label },
    };
  }

  // Cross-type: this creates the *unlabeled* definition, which is what
  // PUT .../associations/default/... needs.
  return {
    method: 'POST',
    url: `${HS_BASE}${schemaAssociationsPath(p.fromObjectTypeId)}`,
    body: {
      fromObjectTypeId: p.fromObjectTypeId,
      toObjectTypeId: p.toObjectTypeId,
      name: p.name,
    },
  };
}
```

**3. Idempotency as a pure function of the API payload**

```ts
export type PairingState = 'undefined' | 'defined-unlabeled' | 'defined-labeled-only';

export function classifyExisting(payload: AssociationLabelsResponse | null): PairingState {
  const results = payload?.results ?? [];          // null = 404 = nothing defined
  if (results.length === 0) return 'undefined';
  return results.some(t => t.label === null || t.label === undefined)
    ? 'defined-unlabeled'                          // the workflow action will work
    : 'defined-labeled-only';                      // it still will not
}

export function planFor(state: PairingState) {
  return state === 'undefined' ? 'create' : 'skip';
}
```

**4. Create, then read back — never assume**

```ts
const before = await readState(token, pairing);
if (planFor(before.state) === 'skip') { /* leave it alone */ }

const res = await send(token, definitionRequest(pairing));

// A successful label POST does not guarantee the unlabeled type
// the workflow action depends on. Go and look.
const after = await readState(token, pairing);
```

**5. Proving the URL without a portal**

```ts
it('sends the exact URL and body when creating a self-referential pairing', async () => {
  const calls = stubFetch((_url, init) =>
    (init?.method ?? 'GET') === 'GET' ? { body: { results: [] } } : { body: {} });

  await ensureAssociationDefinitions('tok', [contentToContent]);

  expect(calls.find(c => c.method === 'POST')).toEqual({
    url: `https://api.hubapi.com/crm/v4/associations/${CONTENT}/${CONTENT}/labels`,
    method: 'POST',
    body: { name: 'content_piece_to_content_piece', label: 'Related Content' },
  });
});
```

**6. Run it**

```bash
npx tsx src/scripts/provision-associations.ts                 # dev
PORTAL=staging npx tsx src/scripts/provision-associations.ts  # staging
PORTAL=prod    npx tsx src/scripts/provision-associations.ts  # prod
```
