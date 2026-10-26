## 🎬 YouTube Episode Guide: Preview the Bulk Sync

**🎯 Core Learning Objective:**
"By the end of this video, you will know how to preview a bulk two-way sync before running it, spot the round-trip bug a many-to-one mapping hides, and fix it so a sync only writes when the other system actually disagrees."

**⏱️ The 10-Minute Script Outline:**

*   **Hook & Demo (0:00 - 1:00):**
    "I asked for one thing: run the sync on everything so it's all in step. The preview said that would reopen two cancelled issues, un-mark a duplicate, and drop 92 tasks into my team's Asana project at once."

    Show the preview table: 86 agree, 8 would move, with the bad ones highlighted. Then the moment of realisation: this isn't a bulk-run problem. The same bug fires on every ordinary stage change, and it had been live on prod for an hour.

*   **The Architecture (1:00 - 3:00):**
    Draw the two maps side by side. Linear → HubSpot changelog: Backlog → identified, Todo → identified, Canceled → identified. HubSpot → Linear: identified → **Backlog**. Three roads in, one road out.

    Trace a single event: someone moves an issue to Todo in Linear. The webhook sets the HubSpot stage to *identified*, which is a real change if it was *drafting*. The workflow fires and `SyncToLinear` pushes *identified* back as Backlog. The issue the person just moved has moved again. Cancel an issue and it gets reopened.

    The content map is one-to-one, so it round-trips cleanly. That's why dev never showed it.

    The fix in one sentence: **only write when the other side disagrees**, and decide "disagrees" by mapping *their* value into *your* terms rather than the other way round.

*   **Step-by-Step Implementation (3:00 - 8:00):**

    **Step 1: Preview, read-only (3:00 - 4:30).**
    Show `sync-preview.ts`. For every record it maps the HubSpot stage to the Linear state the action would set, compares that with the issue's real state, and runs the Asana task lookup the action would run. Nothing is written. The output decided everything that followed: push the three that were HubSpot board moves, pull the one where HubSpot was stale, leave four alone, and create Asana tasks only for the 33 active records.

    **Step 2: Contain it (4:30 - 5:15).**
    Pause the one workflow that carries the bug, the Changelog sync, with a full-body PUT and `isEnabled: false`, then read it back. The webhook still carries Linear → HubSpot.

    **Step 3: Tests that name the bounce (5:15 - 6:30).**
    In `sync-to-linear.test.ts`, write "leaves a changelog issue in Todo/Canceled/Backlog alone when HubSpot says identified" and "never moves an issue out of a state the mapping doesn't know (Duplicate)". Add the two controls: a record dragged back to Identified while Linear says In Progress still moves to Backlog, and content still round-trips. Watch the new ones fail.

    **Step 4: One query, two answers (6:30 - 8:00).**
    `getIssueWorkflow` returns the issue's current state and its team's states in one round trip. In `SyncToLinear`, map the current Linear state back to a HubSpot stage. If it's unmapped, skip with `linear_state_unmapped:<state>`. If it equals the record's stage, skip with `linear_already_agrees`. Only otherwise look up the target state and move it.

*   **Testing & Wrap-up (8:00 - 10:00):**
    Run the suites: 56 green. Then the canary discipline from the hand-run sync: one Asana task created through the deployed action and checked in Asana (project, section, stage, Linear URL, the digest doc in *Draft File*) before the other 32. Then a fresh preview: 90 of 94 agree, and the remaining four are exactly the ones deliberately left alone, which the fixed code also leaves alone.

    Recap: preview any bulk write; a lossy map makes every write-back suspect; compare in the other system's terms; and contain a live bug before you fix it.

**💻 Screen-Ready Code Snippets:**

The lossy map: `src/app/lib/mapping.ts`:

```ts
export const LINEAR_STATE_TO_CHANGELOG_STAGE = {
  Backlog: 'identified', Todo: 'identified', Canceled: 'identified',   // three in…
  'In Progress': 'drafting', 'In Review': 'reviewing', Done: 'published',
};
export const CHANGELOG_STAGE_TO_LINEAR_STATE = {
  identified: 'Backlog',                                                 // …one out
  drafting: 'In Progress', reviewing: 'In Review', published: 'Done',
};
```

The guard: `src/app/functions/SyncToLinear.ts`:

```ts
const workflow = await getIssueWorkflow(apiKey, linearIssueId);
const currentStage = linearToStage[workflow.currentState];

if (currentStage === undefined) return skipped(`linear_state_unmapped:${workflow.currentState}`);
if (currentStage === stageName) return skipped('linear_already_agrees');

const stateId = workflow.states.find(s => s.name === targetStateName)?.id;
await updateLinearIssueState(apiKey, linearIssueId, stateId);
```

One query for both halves: `src/app/lib/linear-client.ts`:

```graphql
query($issueId: String!) {
  issue(id: $issueId) {
    state { name }
    team { states(first: 250) { nodes { id name type } pageInfo { hasNextPage } } }
  }
}
```

The preview that came first:

```text
[prod] 94 records. Linear: 86 already agree, 8 WOULD MOVE
   DEVADV-1392  changelog stage=identified Linear "Canceled" → "Backlog"
   DEVADV-1436  changelog stage=identified Linear "Todo" → "Backlog"
   DEVDOCS-73   content   stage=idea       Linear "Duplicate" → "Backlog"
[prod] Asana: 92 WOULD CREATE a task, 0 would link an existing task
```
