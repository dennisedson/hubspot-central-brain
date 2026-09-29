## 🎬 YouTube Episode Guide: One Card, Two APIs — Live Cross-System Status Inside a HubSpot Record

**🎯 Core Learning Objective:**
"By the end of this video, you will know how to build a HubSpot UI Extensions CRM card that calls a serverless app function, fetches live data from two external APIs in parallel without letting either one break the other, and correctly detects when your sync has drifted — including the many-to-one mapping trap that makes naive drift detection cry wolf on perfectly healthy records."

**⏱️ The 10-Minute Script Outline:**

*   **Hook & Demo (0:00 - 1:00):**
    Open on a Content record. It shows a pipeline stage — and nothing else. "To answer 'who owns this, when did it last move, and is my sync actually correct?', I have to open Linear and Asana in two more tabs."
    Then show the finished card on the same record: Linear identifier, live state, assignee, last-updated; Asana task and section; and a warning banner when the two disagree with HubSpot.
    "The interesting part isn't the fetching. It's that last banner — because getting it to fire *only* when something is genuinely wrong is much harder than it looks."

*   **The Architecture (1:00 - 3:00):**
    Explain why the card can't just call Linear directly: API keys don't belong in a browser extension. The card is a thin client; the app function is where secrets live.
    Draw the flow:
    ```
    card → hubspot.serverless('task_status_api', { parameters: { objectId } })
         → function reads the record (linear_issue_id, asana_task_id, pipeline, stage)
         → Promise.allSettled([ getLinearIssue(), getAsanaTask() ])
         → drift comparison per source
         → one JSON payload back
    ```
    Two decisions worth explaining on camera:
    - **`Promise.allSettled`, not `Promise.all`.** With `all`, Linear having a bad day blanks the Asana half of a card that has nothing to do with Linear. `allSettled` lets each source succeed or fail on its own.
    - **Live, not stored.** The pipeline stage is already the HubSpot-side mirror of Linear state. A card that only read stored fields would restate what's already on screen. The value is in what the sync *doesn't* store — and in whether the two sides actually agree.

*   **Step-by-Step Implementation (3:00 - 8:00):**

    **Step 1 — The trap that makes drift detection lie (3:00 - 5:00).** This is the heart of the episode; give it the most time.
    Open [mapping.ts](../../src/app/lib/mapping.ts) and show the tables. Then show the problem concretely:
    - `drafting` → Linear `In Progress`
    - `editing` → Linear `In Progress`  ← **two stages, one state**
    "So what happens when I reverse it? `In Progress` comes back as `drafting`. Now take a record sitting in `editing`, perfectly synced. Naive check: expected `drafting`, actual `editing`. **Drift!** Except nothing is wrong."
    Then show it fails the *other* way too, on the changelog pipeline: both `Backlog` and `Canceled` map to `identified`, so a forward-only check cries wolf there instead.
    Land the rule: accept a match from **either** direction.
    "Neither direction alone is correct, because the mapping is lossy in both. This is true of basically every sync that translates between two systems' vocabularies — the moment two of your states collapse into one of theirs, single-direction comparison starts lying."

    **Step 2 — Write the traps as tests first (5:00 - 6:00).**
    Show [drift.test.ts](../../src/app/__tests__/drift.test.ts) — specifically the three tests that encode the traps: `editing` vs `In Progress`, `identified` vs `Canceled`, and a changelog record using the changelog table. "These three tests are the spec. If someone 'simplifies' this function later, these are what stop them."
    Mention the honest moment: two tests failed on the first run, because the implementation reported drift for a Linear state the tables don't model at all (`Triage`). The fix was to return *unknown*, not drift — if we can't interpret the state, "expected" would be a guess.

    **Step 3 — The function: parallel, isolated, pipeline-aware (6:00 - 7:00).**
    Open [TaskStatusApi.ts](../../src/app/functions/TaskStatusApi.ts). Show `Promise.allSettled` and the per-source error object. Then the pipeline resolution — `content_piece` carries two pipelines, so the function reads `hs_pipeline` and picks the matching table. "Use the content table on a changelog record and you report false drift on every single one."

    **Step 4 — The card, and two build errors worth seeing (7:00 - 8:00).**
    Show the card's independent render blocks — Linear and Asana each handle their own data / not-linked / error state.
    Then show the first deploy failing with two errors, because they're both instructive:
    ```
    The entrypoint file [/app/functions/TaskStatusApi.js] was not found
    The object name `2-67505887` is invalid ... prefix it with `p_`
    ```
    "The first: the build script is an explicit esbuild list, so a new function is invisible until you add it. The second is my favourite kind of error — I'd designed a whole per-portal `sed` substitution because the custom object has a different type id in each of my three portals. HubSpot wanted the *name*. `p_content_piece` is identical everywhere. The fix deleted more code than it added."

*   **Testing & Wrap-up (8:00 - 10:00):**
    Run the suite: 16 drift tests, 7 client tests, 146 total green. Deploy, confirm both components `DONE` **and** the run conclusion `success`.
    Open a record with both links and show it live. Then open a changelog-pipeline record and show it correctly reporting in-sync — "this is the case that would have been a false alarm."
    Recap:
    1. Card = thin client, function = where secrets live.
    2. `allSettled` over `all` whenever sources are independent.
    3. Lossy mappings need bidirectional tolerance.
    4. Unmappable ≠ wrong. Report unknown, not drift.
    5. Encode the traps as tests, or someone will "simplify" them away.

**💻 Screen-Ready Code Snippets:**

**The trap, in one table:**

```ts
// mapping.ts — note two stages collapsing into one Linear state
export const CONTENT_STAGE_TO_LINEAR_STATE = {
  drafting: 'In Progress',
  editing:  'In Progress',   // ← same target
  review:   'In Review',
};

// Reversing is therefore lossy:
export const LINEAR_STATE_TO_CONTENT_STAGE = {
  'In Progress': 'drafting', // 'editing' is unrecoverable
};
```

**The comparison that doesn't cry wolf:**

```ts
function compare(forward, reverse, stage, actual): DriftResult | null {
  const expectedState = forward[stage] ?? null;
  const reversedStage = reverse[actual] ?? null;

  // Can't interpret the external state at all → unknown, not drift.
  if (reversedStage === null) return null;

  return {
    // Either direction matching is good enough. The tables are
    // many-to-one BOTH ways, so one direction alone reports false drift.
    inSync: expectedState === actual || reversedStage === stage,
    expectedState,
    actualState: actual,
  };
}
```

**The three tests that are really the spec:**

```ts
// 'editing' also maps forward to 'In Progress', but reversing
// 'In Progress' yields 'drafting'. Must NOT report drift.
it('reports in sync for editing vs In Progress', () => {
  expect(computeLinearDrift('content', 'editing', 'In Progress')?.inSync).toBe(true);
});

// Fails the other way: 'identified' maps forward to 'Backlog',
// but 'Canceled' reverses to 'identified'.
it('reports in sync for identified vs Canceled on changelog', () => {
  expect(computeLinearDrift('changelog', 'identified', 'Canceled')?.inSync).toBe(true);
});

// A genuine mismatch must still fail both checks.
it('reports drift on a genuine mismatch', () => {
  expect(computeLinearDrift('content', 'drafting', 'Done')?.inSync).toBe(false);
});
```

**Isolated parallel fetches — one bad API can't blank the other half:**

```ts
const [linearOutcome, asanaOutcome] = await Promise.allSettled([
  linearId ? getLinearIssue(process.env.LINEAR_API_KEY ?? '', linearId) : Promise.resolve(null),
  asanaId  ? getAsanaTask(process.env.ASANA_API_KEY ?? '', asanaId)     : Promise.resolve(null),
]);

const errors = { linear: null, asana: null };

if (linearOutcome.status === 'rejected') {
  errors.linear = reason(linearOutcome.reason);   // Asana still renders
} else if (linearOutcome.value) {
  linear = { ...linearOutcome.value, drift: computeLinearDrift(pipeline, stage, linearOutcome.value.state) };
}
```

**Calling a serverless function from a card — the shape that actually works:**

```tsx
const result = await hubspot.serverless('task_status_api', {
  parameters: { objectId: String(context.crm.objectId) },
});
// resolves to { statusCode, body } where body is a JSON STRING
const parsed = JSON.parse(result.body);
```

**The card config — use the object NAME, not the type id:**

```json
{
  "uid": "task_status_card",
  "type": "card",
  "config": {
    "name": "Linear / Asana Status",
    "location": "crm.record.tab",
    "entrypoint": "/app/cards/TaskStatusCard.tsx",
    "objectTypes": ["p_content_piece"]
  }
}
```

> `p_content_piece` is identical across every portal. Using the numeric type id (`2-67505887` on dev) fails the build *and* would have needed per-environment substitution. The right answer removed code.
