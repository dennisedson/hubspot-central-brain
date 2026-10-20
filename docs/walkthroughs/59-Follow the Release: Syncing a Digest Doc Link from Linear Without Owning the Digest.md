## 🎬 YouTube Episode Guide: Follow the Release

**🎯 Core Learning Objective:**
"By the end of this video, you will know how to sync a value that lives on a *group* in one system — a Google Doc link on a Linear release — onto every member record in your CRM, using one pure rule, a set-only webhook path and a strict daily sweep, without ever creating a record you don't own and without a partial read wiping out good data."

**⏱️ The 10-Minute Script Outline:**

*   **Hook & Demo (0:00 - 1:00):**
    "My changelog entries go out in a monthly digest that somebody else writes. Every entry should link to that digest's Google Doc. Nobody should be copying links by hand — and none of their work should end up in my CRM."

    Show Linear: the *Monthly Changelog Rollups* pipeline, "October 2026 Changelog Rollup", six issues — two of them mine. Attach a Google Doc to the release as a link. Cut to HubSpot: my two entries now show *Changelog Rollup: October 2026 Changelog Rollup* and the doc link. The other four issues? Not in HubSpot, and still not in HubSpot.

    Then the twist to promise: move an issue to November's release, which has no doc yet — and October's link *disappears* from it, instead of quietly pointing at the wrong month.

*   **The Architecture (1:00 - 3:00):**
    Plain English, a whiteboard with three boxes.

    1. **Linear already knows the membership.** I nearly built association labels and a "digest" record in HubSpot. Then it turned out the team tracks digests as Linear *releases* — and the issue webhook already lists each issue's releases. Lesson: before you model a relationship, check whether the system upstream already has it.
    2. **One rule, two callers.** A pure function decides what one entry should hold. The webhook applies it the moment an issue changes. A daily sweep applies it for the things no webhook announces: the doc being attached *after* the issues, and a scheduled release completing and rolling its unfinished issues on to next month.
    3. **Three guarantees.** The release's doc *wins* over whatever the entry held. Only a doc that belongs to *some* rollup is ever *cleared* — so a link a person pasted is safe. And nothing, ever, creates a record.

    Draw the trap you'll defuse in Step 3: the sweep decides "this issue left October" from the issue's *absence*. A list that's missing a page looks exactly like an issue that left.

*   **Step-by-Step Implementation (3:00 - 8:00):**

    **Step 1 — The rule as a pure function (3:00 - 4:30).**
    Open `src/app/lib/rollup-doc.ts`. Show `isMonthlyRollup` — matched by *name*, because Spotlight releases share the pipeline. Show `googleDocId`: links compared by document id, because `/edit` and `/edit?tab=t.0` are the same doc. Then `decideEntry` and walk the table: one rollup with a doc → set it; one with no doc → clear only if the current link is a rollup doc; no rollup → clear name, and doc only if it's a rollup doc; two rollups → touch nothing, say why. Point out that "is a rollup doc" is what replaces storing provenance.

    **Step 2 — The webhook: set-only, and in the branch you'd forget (4:30 - 5:45).**
    Open `LinearWebhook.ts`, `applyRollup`. It runs after the stage write in *both* branches — and explain why the "stage already matches" branch is the one that matters: adding an issue to a release doesn't change its state. Show `updateByLinearId` in `hubspot-client.ts`: PATCH by unique property, 404 answers `false`. Contrast with the sync's upsert, which creates on 404 — right for the sync, wrong for annotating. Finally the try/catch: a Linear error still writes the release name, a write error is reported in the body, and the webhook answers 200 either way.

    **Step 3 — The sweep and strict pagination (5:45 - 7:15).**
    Open `linear-client.ts`, `fetchEveryPage`. Put it next to the older `fetchAllPages`, which returns what it has when a page fails — fine for a dropdown. Here that would mean: page two fails, iss-55 is missing, the sweep concludes it left October, and clears a real link. So `fetchEveryPage` throws on a failed page, a missing cursor, or a runaway connection. Then `RollupDocSync.ts`: every read before any write, a 16-second budget against HubSpot's 20-second kill, and `batchUpdate` treating 207 Multi-Status as the failure it is.

    **Step 4 — Don't let your action get mistaken for another (7:15 - 8:00).**
    Quick one. The provisioning script finds workflow actions by *substring* — anything named with "linear" or "poll" gets handed out as a different action's id. Show the test in `workflow-actions.test.ts` that pins the new action's uid and name clear of every claimed word.

*   **Testing & Wrap-up (8:00 - 10:00):**
    Run `npx vitest run src/app/__tests__/rollup-doc-sync.test.ts`. The test builds a fake Linear workspace and a fake HubSpot portal that answer by *what is asked*, never by call order. Show three cases:
    - *"writes nothing at all when a Linear page fails"* — the partial-list trap, caught.
    - *"clears October's doc and moves the name when the issue rolls on to November"*.
    - *"creates nothing for issues that aren't mine"* — it asserts every HubSpot call was a search or a batch update.

    Bonus bug from the session: `beforeEach(() => mockFetch.mockReset())` — Vitest treats a returned function as a cleanup hook, and `mockReset()` returns the mock, so it called `fetch()` with no arguments after every test. Braces fix it.

    Recap: let the upstream system own membership; put the rule in one pure function; make the fast path set-only and unable to fail its host; make the slow path strict, read-everything-then-write. Next steps: watch a live `Issue` webhook to confirm it carries `releases`, and let the daily workflow run once.

**💻 Screen-Ready Code Snippets:**

The rule — `src/app/lib/rollup-doc.ts`:

```ts
const MONTHLY_ROLLUP =
  /^(January|February|March|April|May|June|July|August|September|October|November|December) \d{4} Changelog Rollup$/;

const GOOGLE_DOC = /^https:\/\/docs\.google\.com\/document\/(?:u\/\d+\/)?d\/([A-Za-z0-9_-]+)/;

export function googleDocId(url: string | null | undefined): string | null {
  if (!url) return null;
  return GOOGLE_DOC.exec(url.trim())?.[1] ?? null;
}

export function decideEntry(current: RollupFields, rollups: IssueRollup[], rollupDocIds: ReadonlySet<string>): Decision {
  if (rollups.length > 1) return { changes: {}, skipped: `in ${rollups.length} monthly rollups` };

  const currentDocId = googleDocId(current.changelog_doc_url);
  const holdsRollupDoc = currentDocId !== null && rollupDocIds.has(currentDocId);
  const desired = { ...current };

  if (rollups.length === 0) {
    desired.changelog_rollup = '';
    if (holdsRollupDoc) desired.changelog_doc_url = '';
  } else {
    const [rollup] = rollups;
    desired.changelog_rollup = rollup.name;
    if (rollup.doc.kind === 'one' && googleDocId(rollup.doc.url) !== currentDocId) {
      desired.changelog_doc_url = rollup.doc.url;          // the release wins
    } else if (rollup.doc.kind === 'none' && holdsRollupDoc) {
      desired.changelog_doc_url = '';                       // only a rollup doc is cleared
    }
  }
  return { changes: diff(current, desired) };
}
```

Never create — `src/app/lib/hubspot-client.ts`:

```ts
export async function updateByLinearId(objectTypeId: string, linearId: string, properties: Record<string, string>) {
  const res = await fetch(
    `${HS_BASE}${objectPath(objectTypeId, encodeURIComponent(linearId))}?idProperty=linear_id`,
    { method: 'PATCH', headers, body: JSON.stringify({ properties }) },
  );
  if (res.status === 404) return false;   // the sync's upsert would create here
  if (!res.ok) throw new Error(`HubSpot update by linear_id failed ${res.status}`);
  return true;
}
```

Strict pagination — `src/app/lib/linear-client.ts`:

```ts
export async function fetchEveryPage<D, T>(apiKey, query, variables, select: (d: D) => Connection<T> | null | undefined) {
  const nodes: T[] = [];
  let after: string | null = null;
  for (let page = 0; page < MAX_PAGES; page++) {
    const conn = select(await gql<D>(apiKey, query, { ...variables, first: 250, after }));
    if (!conn) throw new Error('Linear returned no connection to page through');
    nodes.push(...conn.nodes);
    if (!conn.pageInfo.hasNextPage) return nodes;
    if (!conn.pageInfo.endCursor) throw new Error('Linear reported another page without a cursor');
    after = conn.pageInfo.endCursor;
  }
  throw new Error('refusing to return part of a connection');
}
```

Read everything, then write — `src/app/functions/RollupDocSync.ts`:

```ts
try {
  plan = planSweep(await listMonthlyRollups(apiKey));
  entries = await findEntries(objectTypeId, [...plan.issueRollups.keys()]);
} catch (err) {
  return outcome('error', counts, `nothing written: ${reason(err)}`);
}

for (let i = 0; i < updates.length; i += 100) {
  if (Date.now() > deadline) return outcome('partial', counts, 'the next run finishes them');
  await batchUpdate(objectTypeId, updates.slice(i, i + 100));   // 207 throws
}
```

The Vitest gotcha:

```ts
// ❌ returns the mock — Vitest calls it as a cleanup hook: fetch()
beforeEach(() => mockFetch.mockReset());

// ✅
beforeEach(() => {
  mockFetch.mockReset();
});
```
