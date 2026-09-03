## 🎬 YouTube Episode Guide: The Name Was the Bug

**🎯 Core Learning Objective:**
"By the end of this video, you will know how to associate a HubSpot custom object record to *another record of the same type* — the labeled association HubSpot never documents — including why the obvious definition name is rejected outright, and how to discover the per-portal `associationTypeId` at runtime instead of hardcoding a number that only works on one portal."

**⏱️ The 10-Minute Script Outline:**

*   **Hook & Demo (0:00 - 1:00):**
    "Last episode I told you HubSpot blocks a custom object from associating with itself. I showed you the error code and everything. I was wrong — and the real bug was hiding *inside my own request body*."

    Put the two errors side by side on screen. The one I chased:

    ```
    ObjectSchemaError.CANNOT_ASSOCIATE_OBJECT_TYPE_WITH_ITSELF
    ```

    And the one that was actually being returned by the endpoint that matters:

    ```
    400 Association definition name 'content_piece_to_content_piece' conflicts with
        unlabeled association name 'content_piece_to_content_piece' (case-insensitive match)
    ```

    That is not "you can't do this." That is "pick a different name." Change one string and the call returns 201. Final demo: run the provisioning script, watch it print `associationTypeId 99`, then trigger the workflow and watch three related records actually link.

*   **The Architecture (1:00 - 3:00):**
    Plain English, no code yet. Three facts, in order, and each one kills an assumption:

    1.  **A custom object *can* associate with itself.** The schema endpoint refuses it, but that is a limit of that one endpoint, not of the platform. The labels endpoint — `POST /crm/v4/associations/{type}/{type}/labels` — accepts it.
    2.  **HubSpot has already claimed the obvious name.** Every pairing has an invisible *unlabeled* association named `{a}_to_{a}`. Ask for `content_piece_to_content_piece` and you are asking for a name that is already taken, case-insensitively. So our definitions are named `cb_related_content` and `cb_related_video`.
    3.  **There is no default association between a type and itself.** So `PUT .../associations/default/...` — the path the workflow action used — cannot ever work here. The labeled association takes its place:

        ```
        PUT /crm/v4/objects/{type}/{fromId}/associations/{type}/{toId}
        [{ "associationCategory": "USER_DEFINED", "associationTypeId": 99 }]
        ```

    Then the punchline that shapes the whole implementation: **99 is not a constant.** It is the number *this* portal happened to assign. Staging and prod will each mint their own. Hardcode it and you ship a function that works in exactly one environment — which is the worst kind of bug, because it passes every test you run.

*   **Step-by-Step Implementation (3:00 - 8:00):**

    **Step 1 — Make the bad name unrepresentable (open `src/app/lib/related-content-associations.ts`).**
    One tiny pure function, `collidesWithUnlabeledName`, splits on `_to_` and asks whether both sides are identical. Then a test asserts every name the app generates returns `false`. Say it out loud on screen: this is a three-line function guarding a 400 that cost a full debugging session. The bug can now only come back through a failing test.

    **Step 2 — Look the typeId up, never write it down (same file).**
    `findAssociationTypeId` takes the `GET .../labels` payload and the name/label we provisioned, and returns a number or `null`. Two details worth pausing on: it matches on **label first** because `label` is the field the endpoint always returns, and it filters out every entry whose label is `null`. That second filter is not tidiness — a self-referential definition comes back as a *pair*, the forward type carrying the label and an inverse carrying `null`, and PUTting the inverse points the relationship backwards.

    **Step 3 — Wire it into the handler (open `src/app/functions/AssociateRelatedContent.ts`).**
    Delete the `defaultAssociationPath` call. Replace it with one labels lookup per invocation — after scoring, so a record with no matches never makes the call — and reuse that typeId for every winner. Then the branch that makes this production-safe: `null` typeId returns a **200** with `associationStatus: 'not_provisioned'`. Workflow actions must never answer non-2xx; HubSpot retries and eventually parks the enrollment. An unprovisioned portal is a message, not a failure.

    **Step 4 — Teach the provisioning script what "done" means (open `src/scripts/association-definitions.ts`).**
    The old classifier looked for the *unlabeled* definition and called that success. That is now exactly backwards for self-referential pairings. `classifyExisting` now returns `{ state, typeId }`, and `isProvisioned` is route-aware: a labels-route pairing needs its own label present, a schema-route pairing just needs a definition to exist. Same shape of code, opposite meaning — which is why the tests had to be rewritten alongside it.

*   **Testing & Wrap-up (8:00 - 10:00):**
    `npx vitest run` — 513 green, up from 469. Walk through three assertions that carry the whole fix: the exact PUT URL with no `default` segment, the exact body `[{ associationCategory: 'USER_DEFINED', associationTypeId: 99 }]`, and the one that proves the point — feed the mock a portal that reports `512` and assert `512` goes out on the wire. If someone ever hardcodes 99 again, that test fails.

    Then the real run, one portal at a time:

    ```bash
    npx tsx src/scripts/provision-associations.ts
    PORTAL=staging npx tsx src/scripts/provision-associations.ts
    PORTAL=prod     npx tsx src/scripts/provision-associations.ts
    ```

    What was learned: read the error you actually got, not the error you expected; a 400 that names a *field value* is a naming problem, not a capability problem; and any id a platform assigns for you is a lookup, never a literal.

**💻 Screen-Ready Code Snippets:**

**1. The guard that makes the original bug untypeable**

```ts
/**
 * True for the `{a}_to_{a}` name HubSpot reserves for the unlabeled association
 * between a type and itself. Sending one to the labels endpoint is a hard 400.
 */
export function collidesWithUnlabeledName(name: string): boolean {
  const sides = name.split('_to_');
  return sides.length === 2 && sides[0].length > 0 && sides[0] === sides[1];
}

export const RELATED_CONTENT_LABEL = { name: 'cb_related_content', label: 'Related Content' };
export const RELATED_VIDEO_LABEL   = { name: 'cb_related_video',   label: 'Related Video'   };
```

**2. Discovering the typeId — and never picking the inverse**

```ts
export function findAssociationTypeId(
  payload: AssociationLabelsResponse | null | undefined,
  spec: AssociationLabelSpec,
): number | null {
  // Only LABELED entries are candidates. A self-referential definition comes
  // back as a pair — the forward type carrying the label, and an inverse
  // carrying `label: null`. Associating through the inverse points the
  // relationship the wrong way.
  const labeled = (payload?.results ?? []).filter(
    (t): t is AssociationTypeSpec & { typeId: number } =>
      typeof t.typeId === 'number' && typeof t.label === 'string' && t.label.length > 0,
  );

  const byLabel = labeled.find(t => sameText(t.label, spec.label));
  if (byLabel) return byLabel.typeId;

  const byName = labeled.find(t => sameText(t.name, spec.name));
  return byName ? byName.typeId : null;
}
```

**3. The request that finally returns 201**

```ts
async function associateLabeled(
  token: string,
  objectTypeId: string,
  fromId: string,
  toId: string,
  associationTypeId: number,
): Promise<void> {
  const res = await fetch(
    `${HS_BASE}${labeledAssociationPath(objectTypeId, fromId, objectTypeId, toId)}`,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify([{ associationCategory: 'USER_DEFINED', associationTypeId }]),
    },
  );
  if (!res.ok) {
    throw new Error(`Association ${fromId}->${toId} failed ${res.status}: ${await res.text()}`);
  }
}
```

**4. Degrading without lying — one lookup, reused, and a 200 either way**

```ts
// One lookup per invocation, reused for every winner.
let associationTypeId: number | null;
try {
  associationTypeId = await resolveAssociationTypeId(token, objectTypeId, objectType);
} catch (err: unknown) {
  console.error('AssociateRelatedContent label lookup failed:', reason(err));
  return outcome({ associationStatus: 'failed', associationsCreated: 0, relatedTitles: '' });
}

if (associationTypeId === null) {
  const { label, name } = SELF_ASSOCIATION_LABELS[objectType];
  console.error(
    `AssociateRelatedContent: portal has no "${label}" (${name}) association label on ` +
    `${objectTypeId} — run \`npx tsx src/scripts/provision-associations.ts\` for this portal`,
  );
  return outcome({
    associationStatus: 'not_provisioned',
    associationsCreated: 0,
    relatedTitles: '',
  });
}
```

**5. The test that keeps 99 out of the source code**

```ts
it('sends whatever typeId the portal reports — 99 is not hardcoded', async () => {
  mockReadAndSearch();
  mockOk({ results: [{ category: 'USER_DEFINED', typeId: 512, label: 'Related Content' }] });
  mockOk({}); mockOk({}); mockOk({});

  await main(makeContext());

  expect(associationPuts().map(([, body]) => body)).toEqual([
    [{ associationCategory: 'USER_DEFINED', associationTypeId: 512 }],
    [{ associationCategory: 'USER_DEFINED', associationTypeId: 512 }],
    [{ associationCategory: 'USER_DEFINED', associationTypeId: 512 }],
  ]);
});
```
