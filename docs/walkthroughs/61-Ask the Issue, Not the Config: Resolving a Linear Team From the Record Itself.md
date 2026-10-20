## 🎬 YouTube Episode Guide: Ask the Issue, Not the Config

**🎯 Core Learning Objective:**
"By the end of this video, you will know how to stop a sync action from depending on a configured value that can be a sentinel — by resolving what you need (here, a Linear team's workflow states) from the record you're acting on, and failing soft on the one path that genuinely has nothing to ask."

**⏱️ The 10-Minute Script Outline:**

*   **Hook & Demo (0:00 - 1:00):**
    "Every one of my production sync workflows would have thrown on its first stage change. The only reason nobody noticed: they were all switched off."

    Show the read-only check: prod's *Content → Sync to Linear + Asana* action carries `linearTeamId: "any"`. Then ask Linear about that team: `team(id: "any")` returns `Entity not found: Team`. Then ask Linear about an issue instead, `issue(id: "DEVADV-876") { team { states } }`, and get DEVADV with all eight states. That second query is the fix.

*   **The Architecture (1:00 - 3:00):**
    Plain English. Moving a HubSpot stage means setting a Linear issue's *workflow state*, and state ids belong to a team. The action used to get the team from the workflow, and the workflow got it from settings. With assignee-first sync, settings say "any team", which is a filter, not a team.

    Two paths, two answers:
    1. **The issue exists** (every ordinary stage move): it knows its own team. Ask it. This is also more correct for a real configured team, because an issue moved between teams would have been handed a state id from the wrong team.
    2. **No issue yet** (a vault note promoted to Outline): there's nothing to ask. The configured team has to be real; with `'any'`, refuse by name and report it, rather than sending it to Linear to fail.

    And one rule from the old code to keep: never let a lookup throw out of a workflow action. Answer 200 with a reason.

*   **Step-by-Step Implementation (3:00 - 8:00):**

    **Step 1 — Prove the failure against the real API (3:00 - 4:00).**
    Two curl calls, read-only: the "Entity not found: Team" error, and the issue-team query that works. Save their shapes; they become the mocks.

    **Step 2 — `findIssueStateIdByName` (4:00 - 5:15).**
    Open `src/app/lib/linear-client.ts`. One query: `issue(id) { team { states(first: 250) { … pageInfo { hasNextPage } } } }`. Case-insensitive name match. Strict paging: a team with more than a page of states is refused rather than half-searched.

    **Step 3 — Split the lookup by path in `SyncToLinear` (5:15 - 7:00).**
    Before: one `findStateIdByName(apiKey, linearTeamId, …)` at the top, unguarded, used by both paths. After:
    - the update path calls `findIssueStateIdByName` inside a try/catch, returning `skipped: linear_lookup_failed` on error;
    - the create path keeps its existing checks first (content-only, Outline or later), then refuses `isAnyTeam(linearTeamId)` with `no_team_for_create`, then looks up the configured team.

    Order matters: the "below Outline" reason must still win for an Idea-stage record, whatever the team. There's a test for it.

    **Step 4 — Change the two tests that encoded the old behaviour, on purpose (7:00 - 8:00).**
    Two existing tests asserted that an existing issue's states came from `team-1`. They now assert the issue's own team, with a comment saying when and why. Explain the difference between a test that broke and a test whose contract changed.

*   **Testing & Wrap-up (8:00 - 10:00):**
    Run `npx vitest run src/app/__tests__/sync-to-linear.test.ts src/app/__tests__/linear-issue-states.test.ts`. Show the RED from before the fix: `expected "spy" to be called with [lin_test_key, lin-123, Done]`, and `syncStatus: created` where it should have been skipped. The mock happily accepted team `'any'`, which is exactly why you check the real API first. Then green: 52 tests.

    Recap: resolve from the record when the record knows; refuse sentinels by their named predicate; keep the path-specific guards ahead of the lookup; never let an action throw.

**💻 Screen-Ready Code Snippets:**

The lookup: `src/app/lib/linear-client.ts`:

```ts
export async function findIssueStateIdByName(apiKey: string, issueId: string, stateName: string) {
  const data = await gql<{ issue: { team: { states: { nodes: LinearState[]; pageInfo: { hasNextPage: boolean } } } } | null }>(
    apiKey,
    `query($issueId: String!) {
       issue(id: $issueId) { team { states(first: 250) { nodes { id name type } pageInfo { hasNextPage } } } }
     }`,
    { issueId },
  );
  if (!data.issue) throw new Error(`Linear issue not found: ${issueId}`);
  if (data.issue.team.states.pageInfo.hasNextPage) throw new Error('refusing to search part of a team\'s states');
  const lower = stateName.toLowerCase();
  return data.issue.team.states.nodes.find(s => s.name.toLowerCase() === lower)?.id ?? null;
}
```

The update path: `src/app/functions/SyncToLinear.ts`:

```ts
let stateId: string | null;
try {
  stateId = await findIssueStateIdByName(apiKey, linearIssueId, targetStateName);
} catch (err) {
  return { statusCode: 200, body: JSON.stringify({ outputFields: { syncStatus: 'skipped', reason: 'linear_lookup_failed' } }) };
}
```

The create path, after its own guards:

```ts
if (isAnyTeam(linearTeamId)) {
  return { statusCode: 200, body: JSON.stringify({ outputFields: { syncStatus: 'skipped', reason: 'no_team_for_create' } }) };
}
const stateId = await findStateIdByName(apiKey, linearTeamId, targetStateName);   // inside try/catch too
```

The proof query, worth keeping in your notes:

```graphql
query { team(id: "any") { id } }            # → "Entity not found: Team"
query { issue(id: "DEVADV-876") { team { key states { nodes { name } } } } }   # → DEVADV, 8 states
```
