## 🎬 YouTube Episode Guide: The Tests That Weren't Testing — Preparing a Migration You Can't Verify

**🎯 Core Learning Objective:**
"By the end of this video, you will know how to prepare a risky, wide-reaching API migration so the actual switch becomes a one-line change — and, more importantly, how to tell whether your existing test suite would actually catch you breaking it. Spoiler: mine wouldn't have, and I nearly trusted it."

**⏱️ The 10-Minute Script Outline:**

*   **Hook & Demo (0:00 - 1:00):**
    "HubSpot is deprecating every non-date-based API. `/crm/v3/`, `/crm/v4/` — all of it. My codebase has 34 calls across 14 files, and the next version ships in weeks."
    Show the survey output. Then the twist: "Here's the part that nearly got me. I had 282 passing tests. I assumed they'd catch a bad URL. Watch this."
    Run: `grep "crm/v" src/app/__tests__/` → **nothing**.
    "Not one test asserts a URL. They mock `fetch` and check response bodies. I could have changed every path to garbage and stayed green."

*   **The Architecture (1:00 - 3:00):**
    Explain the two-part shape of a risky migration: **the prep, which is safe, and the switch, which isn't.**
    The version isn't just a number swap — it moves *position*: `/crm/v3/objects/contacts` becomes `/crm/objects/2026-03/contacts`. And it's a genuinely new API version, so response shapes can change too.
    "So there are two ways to be wrong: wrong URL, or right URL with a response you don't expect. Only a live portal can tell you about the second one."
    Then the key insight: **you can do all the safe work first, and make the unsafe work small.** Scattered across 34 sites, every future bump is a 14-file change. Behind one module, it's one line per family — small enough to flip, verify, and revert in minutes.

*   **Step-by-Step Implementation (3:00 - 8:00):**

    **Step 1 — Survey before you touch anything (3:00 - 4:00).**
    Show the one-liner that produced the file-by-file count, and the discovery that fell out of it: the Fellow sync was *already half-migrated*. Objects on `2026-03`, pipelines on `v3`, associations on `v4` — three surfaces in one code path, nobody's decision, just drift.
    "That's what a survey buys you. I went looking for a count and found an inconsistency that explains a separate open bug."

    **Step 2 — Centralize without changing anything (4:00 - 5:30).**
    Open [hs-api.ts](../../src/app/lib/hs-api.ts). Show the prefix constants and builders. Stress the discipline: **every builder returns exactly the path that was there before.** Legacy builders keep `/crm/v3/`. The already-dated Fellow calls keep `2026-03`.
    "The temptation here is enormous. You're touching all 34 sites anyway — why not fix them while you're in there? Because then you've got a refactor and a migration in one commit, and when something breaks you won't know which one did it."

    **Step 3 — Prove equivalence, since the tests won't (5:30 - 7:00).**
    This is the heart of the episode.
    "'All 282 tests still pass' sounds like proof. It isn't. Those tests never looked at a URL. So I had to build the proof separately."
    Show the approach: execute every builder, capture its output, diff against the set of path templates extracted from the pre-refactor files. All 19 reproduce exactly.
    Then the permanent fix: `hs-api.test.ts` pins each builder to its exact literal string. "Now the suite *does* test URLs. Next time someone flips a version, 10 tests fail by name with old and new strings side by side."

    **Step 4 — Make the switch one line, then don't pull it (7:00 - 8:00).**
    Show the migration edit:
    ```ts
    const OBJECTS_V3 = '/crm/v3/objects';   →   const OBJECTS_V3 = OBJECTS_DATED;
    ```
    Demo flipping it: 10 targeted failures naming every affected builder. Then revert.
    "And now the discipline bit. I'm not shipping that flip, because I can't verify it. My CI deploys these functions without ever *calling* these APIs — a green pipeline would tell me absolutely nothing. That verification needs a live portal and a human watching it."

*   **Testing & Wrap-up (8:00 - 10:00):**
    Deploy the prep. Green. Nothing behaves differently, by design — "the best outcome for a refactor is that nobody notices."
    Recap:
    1. **Survey first.** The count is the smallest thing you'll learn.
    2. **Check whether your tests test the thing you're about to change.** Grep for it. Assume nothing.
    3. **Separate the safe prep from the unsafe switch.** One commit each.
    4. **A green deploy is not verification** when the pipeline never exercises the code path.
    5. **Leave the switch loaded but unpulled**, with a test that fires when someone pulls it.

**💻 Screen-Ready Code Snippets:**

**The grep that changes how much you trust your suite:**

```bash
# Does anything in my tests actually assert a URL?
grep -r "crm/v" src/app/__tests__/
# (no output)  ← 282 passing tests, zero URL coverage
```

**Survey before touching anything:**

```bash
grep -rn -oE "/crm/v[0-9]+/[a-zA-Z0-9/_.{}$-]*" src --include="*.ts" \
  | sed 's|:.*/crm/|  /crm/|' | awk -F'  ' '{print $1}' \
  | sort | uniq -c | sort -rn
#  10 src/app/lib/hubspot-client.ts
#   3 src/app/functions/MeetingIntelligenceApi.ts
#   ...  34 sites, 14 files
```

**One module owns the version — legacy and dated live side by side, honestly labelled:**

```ts
export const HS_BASE = 'https://api.hubapi.com';
export const HS_API_VERSION = '2026-03';

const OBJECTS_DATED = `/crm/objects/${HS_API_VERSION}`;

// LEGACY v3 — migrate to dated per issue #14
const OBJECTS_V3 = '/crm/v3/objects';

export const objectPath = (type: string, id?: string) =>
  id ? `${OBJECTS_V3}/${type}/${id}` : `${OBJECTS_V3}/${type}`;

// Already dated — the Fellow projects calls
export const datedObjectPath = (type: string, id?: string) =>
  id ? `${OBJECTS_DATED}/${type}/${id}` : `${OBJECTS_DATED}/${type}`;
```

> **Builders never percent-encode.** One call site encodes its id, another doesn't. If the builder encoded, the second one's URL would silently change — and that's exactly the kind of "harmless tidy-up" that turns a behaviour-neutral refactor into a bug.

**Tests that pin the literal, so a future flip fails loudly:**

```ts
it('objectPath is still on legacy v3', () => {
  expect(objectPath('contacts')).toBe('/crm/v3/objects/contacts');
});

it('Fellow projects are already dated', () => {
  expect(datedObjectPath('projects')).toBe('/crm/objects/2026-03/projects');
});
```

**Find everything still to migrate:**

```bash
grep -rn "migrate to dated per issue #14" src/
```

**The whole migration, per family:**

```diff
- const OBJECTS_V3 = '/crm/v3/objects';
+ const OBJECTS_V3 = OBJECTS_DATED;
```

> Flipping this produces 10 named test failures showing exact old/new strings for every affected builder — which is the point. The switch is trivial; knowing it's complete is what the tests buy you.
