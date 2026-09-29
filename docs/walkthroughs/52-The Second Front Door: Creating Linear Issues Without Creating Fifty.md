## 🎬 YouTube Episode Guide: The Second Front Door — Creating Linear Issues Without Creating Fifty

**🎯 Core Learning Objective:**
"By the end of this video, you will know how to let a second system create records in your integration's *first* system — and the two things you must build at the same moment you build the create path: the origin tag that stops your own webhook answering you, and the id write-back that stops the create path firing again on every subsequent update."

**⏱️ The 10-Minute Script Outline:**

*   **Hook & Demo (0:00 - 1:00):**
    Open on Linear, filtered to one team, and scroll. Fifty issues. Same title, fifty times. Created four minutes apart.

    Then the line that frames the episode: **nothing failed.** Every call returned 200. The issue was created correctly each time. The bug is that the create path never stopped being the create path — because the branch was chosen by asking "does this record have a Linear issue id?", and nothing ever answered yes.

    Show the finished version: tick a checkbox on an Obsidian note, wait a minute, and get *one* Linear issue, *one* Asana task, and a HubSpot record that knows about both.

*   **The Architecture (1:00 - 3:00):**
    Plain English, no code yet.

    Until now this app had exactly one front door. Linear is where work is born; a webhook turns a Linear issue into a HubSpot record; the HubSpot record drives Asana. One direction, one origin. Everything downstream could assume the Linear issue already existed, and every piece of code did.

    We're adding a second front door: an Obsidian note. And that breaks the assumption in the middle of the system — `SyncToLinear` only knew how to *update* an issue.

    Now the design rule, and it's the interesting part because it's a product decision, not a technical one: **ideas never reach the CRM.** The vault *is* the idea stage. A note is a thought, and a thought that lives in your tracker makes the tracker a list of maybes. So there's a threshold — **Outline** — and flipping the switch on a note promotes it *straight past Idea* to Outline. Below Outline nothing fans out at all: no Linear issue, no Asana task. Above it, both.

    Say why the threshold is shared: two different thresholds would give you a record with a Linear issue and no Asana task, and no way to tell whether that was the rule working or the Asana call failing.

    Then the two hazards, which is what the rest of the episode is about:

    1. **The echo.** We create an issue in Linear. Linear fires a webhook. Our webhook creates HubSpot records from Linear issues. We've just asked the system to create a second record for work that already has one.
    2. **The re-entry.** The create branch is chosen by an empty id field. If we don't fill that field in, it stays empty, and the next stage change takes the same branch again.

    Land the general shape: **any create path chosen by the absence of an id must write that id back, in the same run.** The write-back isn't cleanup. It's the thing that makes it a create path rather than a create loop.

*   **Step-by-Step Implementation (3:00 - 8:00):**

    **Step 1 — Put the origin tag where it cannot be forgotten (3:00 - 4:30).**
    Open `src/app/lib/linear-client.ts`. Show that the echo guard *already existed* — `LinearWebhook` has skipped any issue whose description contains `[hs-sync]` since episode 01. Nothing had ever written it, because nothing had ever created an issue.

    Now write `createIssue`. The move worth pausing on is where the tag goes: **inside the client, not at the call site.** Say the reason out loud, because it generalises — a caller who forgot the tag wouldn't get an error. They'd get a successful create, and a duplicate record a minute later, in a different system, with nothing connecting it back to the line that caused it. Make the wrong thing impossible rather than documented.

    Also mention the small one: `stateId` is spread in conditionally rather than passed as `undefined`, so Linear applies the team default instead of rejecting a null.

    **Step 2 — Branch on the absent id (4:30 - 5:45).**
    Open `src/app/functions/SyncToLinear.ts`. The whole branch is `if (!linearIssueId)`. Show that it sits *after* the stage is resolved to a Linear state, so the create path reuses the same mapping the update path uses — the new issue opens directly in the right state rather than being created and then moved.

    Then the threshold check, and the detail that makes it a real decision rather than a list: `archived` is not in the fan-out set. Archived isn't "later than Outline", it's off to the side. Work that arrives already dead doesn't need an issue opened for it.

    **Step 3 — The write-back, and why it gets the loudest comment in the file (5:45 - 7:15).**
    This is the episode. Stay here.

    Three properties, not one. `linear_issue_id` and `linear_issue_url` are what the record displays and what the next run reads. `linear_id` is the *unique* property the inbound webhook upserts on — write it too, so that if a human ever edits the issue and strips the `[hs-sync]` tag out of the description, the next webhook updates *this* record instead of creating a rival.

    Then the failure handling, and contrast it deliberately with the Asana side: when Asana's write-back fails we log and return success, because Asana can recover by searching for the task by Linear URL. Linear has no such search here. So a failed write-back returns `syncStatus: 'created_unlinked'` — a distinct, visible value. Callback to episode 51: a failure that reports itself as success is the bug, and the healthy value has to be one you can actually see.

    **Step 4 — Close the same door on the Asana side (7:15 - 8:00).**
    Open `src/app/functions/SyncToAsana.ts`. One gate, in the `else` where no existing task was found.

    Two things to say precisely. First: **creation only.** A task that already exists still follows the record back down to Idea, because once somebody is carrying the work, leaving Asana asserting a stage HubSpot stopped believing is worse than the stray task the rule exists to prevent. Second: it's gated on `stageName === 'idea'` rather than on the shared fan-out list, because a record that arrives already archived *is* deliberately given a task — an unassigned one, from episode 50 — so the cancellation is visible in the project.

*   **Testing & Wrap-up (8:00 - 10:00):**
    Name the single most valuable test: the one asserting `hsUpdate` was called with the new id. It is the only thing standing between this feature and the fifty-issue screenshot from the hook, and it's the kind of assertion that feels redundant when you write it and load-bearing forever after.

    Then the test-plan lesson, which is the subtle one. The end-to-end plan had a step that said "tag a Linear issue and expect an Asana task." That step had passed for months. With a threshold, it became **non-deterministic** — an issue in `Todo` maps to Outline and the task appears; an issue in `Backlog` maps to Idea and it correctly doesn't. Same instruction, two outcomes, depending on something the instruction never mentioned. Show the fix: pin the state, and add the "not a bug" line so the next person doesn't spend an afternoon on it.

    Make that the general rule to close on: **when you add a threshold, go and find every test that was passing by accident on the other side of it.** A manual test that doesn't pin the input isn't a test any more, it's a coin flip with a paper trail.

    And the one-sentence version of the whole episode: *a create path selected by a missing id is only finished when it fills that id in.*

**💻 Screen-Ready Code Snippets:**

**1. The tag lives in the client, not the call site** — `src/app/lib/linear-client.ts`

```ts
/**
 * Linear fires a webhook for every issue that appears, including ours.
 * LinearWebhook skips any description containing the tag — that skip is the
 * only thing between this call and a duplicate HubSpot record.
 *
 * The tag goes here rather than at the call site on purpose: a caller who
 * forgot it would not fail here. It would succeed, and fail a minute later,
 * in another system, as a record nobody can trace back to this line.
 */
export async function createIssue(apiKey: string, input: CreateIssueInput): Promise<CreatedLinearIssue> {
  const description = input.description?.includes(HS_SYNC_TAG)
    ? input.description
    : [input.description?.trim(), HS_SYNC_TAG].filter(Boolean).join('\n\n');

  const data = await gql<{ issueCreate: { success: boolean; issue: CreatedLinearIssue | null } }>(
    apiKey,
    `mutation CreateIssue($input: IssueCreateInput!) {
       issueCreate(input: $input) { success issue { id identifier url } }
     }`,
    { input: { teamId: input.teamId, title: input.title, description,
               ...(input.stateId ? { stateId: input.stateId } : {}) } },
  );

  // success: true with no issue would hand the caller an undefined id to write
  // into the CRM, which is worse than failing.
  if (!data.issueCreate.success || !data.issueCreate.issue) {
    throw new Error(`Linear issueCreate returned success: false for team ${input.teamId}`);
  }
  return data.issueCreate.issue;
}
```

**2. The threshold, in one place** — `src/app/lib/mapping.ts`

```ts
/**
 * The stages at which work fans out into Linear and Asana.
 *
 * `archived` is absent on purpose. It is not "later than Outline", it is off to
 * the side — opening an issue for work that arrived dead is noise.
 */
export const FANOUT_STAGES: readonly ContentStage[] = [
  'outline', 'drafting', 'editing', 'review', 'published',
];

export function isFanoutStage(stageName: string | undefined): boolean {
  return FANOUT_STAGES.includes(stageName as ContentStage);
}
```

**3. Branch on the absent id — then fill it in** — `src/app/functions/SyncToLinear.ts`

```ts
// No Linear issue yet: this record was born in the vault, not in Linear.
if (!linearIssueId) {
  if (!isFanoutStage(stageName)) {
    return json({ syncStatus: 'skipped', reason: `below_outline:${stageName}` });
  }

  const issue = await createIssue(apiKey, {
    teamId: linearTeamId,
    title: title || 'Untitled',
    description: `Promoted from the Central Brain vault. HubSpot record ${recordId}.`,
    stateId,          // opens directly in the right state, no second call
  });

  // THE WHOLE POINT OF THE CREATE PATH.
  //
  // Without this the property stays empty, so the NEXT stage change takes this
  // same branch and creates ANOTHER issue. One per stage move, forever, with
  // every response a 200 and the record looking healthy throughout.
  //
  // linear_id is written too: it is the unique key the inbound webhook upserts
  // on, so if anyone ever strips [hs-sync] out of the description, the next
  // webhook updates THIS record instead of creating a rival.
  try {
    await hsUpdate(config.content.objectTypeId, recordId, {
      linear_id: issue.id,
      linear_issue_id: issue.id,
      linear_issue_url: issue.url,
    });
  } catch (err) {
    // Never reported as plain success. The issue exists and the record does not
    // know it — this is the last chance to notice before the duplicate arrives.
    console.error(`Failed to write linear_issue_id back to ${recordId}:`, err);
    return json({ syncStatus: 'created_unlinked', linearIssueId: issue.id, linearIssueUrl: issue.url });
  }

  return json({ syncStatus: 'created', linearIssueId: issue.id, linearIssueUrl: issue.url });
}
```

**4. Suppress creation only, never the update** — `src/app/functions/SyncToAsana.ts`

```ts
} else {
  // Nothing fans out at Idea. Only CREATION is suppressed — an existing task
  // still follows the record back down, because once somebody is carrying the
  // work, Asana asserting a stage HubSpot stopped believing is the worse bug.
  //
  // Gated on 'idea' rather than the fan-out list because a record that arrives
  // already archived IS given a task — unassigned — so the cancellation shows.
  if (stageName === 'idea') {
    return json({ syncStatus: 'skipped', reason: 'below_outline:idea' });
  }

  const task = await createTask(/* … */);
}
```

**5. The one test that stands between you and fifty issues**

```ts
// If the id we just created is never written back, the property stays empty —
// so the NEXT stage change takes the same branch and creates another issue.
// This is TEST-PLAN 2.1's asana_task_url failure, minus Asana's ability to
// recover by searching. Nothing repairs it after the fact.
it('writes the new issue id and url back onto the HubSpot record', async () => {
  const { hsUpdate } = await import('@lib/hubspot-client');
  await main(ctxAt('outline'));
  expect(hsUpdate).toHaveBeenCalledWith('2-content', 'hs-456', {
    linear_id: 'lin-new',
    linear_issue_id: 'lin-new',
    linear_issue_url: 'https://linear.app/team/issue/ENG-9',
  });
});

// Rule 1 of the design: ideas never leave the vault.
it('creates nothing at Idea', async () => {
  const { createIssue } = await import('@lib/linear-client');
  const body = JSON.parse((await main(ctxAt('idea'))).body);
  expect(body.outputFields.reason).toBe('below_outline:idea');
  expect(createIssue).not.toHaveBeenCalled();
});
```

**6. The manual test that became a coin flip** — `docs/TEST-PLAN.md`

```diff
-Tag a Linear issue with the configured label.
+Tag a Linear issue with the configured label. **Put the issue in `Todo`, not
+`Backlog`, and check that before you start.**
+
+`Todo` maps to Outline, and Outline is the threshold at which work fans out
+into Asana. `Backlog` maps to Idea, and nothing is created at Idea. An issue
+tagged in Backlog produces a Content record and *no task* — which is correct
+behaviour, and looks exactly like the Asana sync being broken.
```
