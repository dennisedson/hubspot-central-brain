## 🎬 YouTube Episode Guide: Leaving the Queue — Making an Unassignment Travel Across Three Systems

**🎯 Core Learning Objective:**
"By the end of this video, you will know how to make a single unassignment in your issue tracker propagate all the way through your CRM and your task manager — archiving the record and clearing the assignee — and, just as importantly, how to decide which half of that round trip you should *not* automate."

**⏱️ The 10-Minute Script Outline:**

*   **Hook & Demo (0:00 - 1:00):**
    Open on the failure, not the feature. Show a Linear issue you were assigned. Unassign yourself. Cut to HubSpot: the Content record is still sitting in **In Progress**, looking perfectly alive. Cut to Asana: the task is still in **My Tasks**, still yours. Nothing errored. Every webhook returned 200. That is the whole problem — *silence that looks like success*. Then show the finished version: unassign in Linear, and within a minute the HubSpot record slides to **Archived** and the Asana task quietly leaves your queue. One action, three systems agreeing.

*   **The Architecture (1:00 - 3:00):**
    Plain English, no code on screen yet.

    There are three systems and one fact: *this work is no longer mine.* Linear is where that fact is born. HubSpot is where the work is tracked. Asana is where it sits in somebody's day.

    Before this change, the Linear webhook had an **assignee filter** — if the issue wasn't yours, the handler skipped it and returned 200. Explain why skipping is the trap: skipping is correct about the *incoming event* and wrong about the *existing record*. The record was already there. Declining to update it doesn't make it neutral; it freezes it mid-pipeline, permanently claiming a status that stopped being true.

    So the rule becomes: **an excluded issue is archived, not skipped.** Archived is a visible state. Frozen is an invisible one.

    Then the second hop. HubSpot moving to Archived fires the existing sync to Asana, which already moved the task to the Canceled stage. But Canceled isn't enough — a Canceled task still shows up in My Tasks. It's labelled dead and behaves alive. So archiving also clears the assignee.

    Close the section on the asymmetry, because it's the interesting design call: **the trip back does not restore the Asana assignee.** Nothing in Asana distinguishes "the automation unassigned this" from "a human deliberately unassigned this." Auto-reassigning would silently overrule a real person's decision. Un-archiving is safe because HubSpot's stage is derived from Linear anyway; re-assigning is not. Asymmetric behaviour, deliberately.

*   **Step-by-Step Implementation (3:00 - 8:00):**

    **Step 1 — Turn the skip into an archive (3:00 - 4:30).**
    Open `src/app/functions/LinearWebhook.ts`. Show the old shape first (a filter that returns `skipped: true`), then the new one. The key move is computing a *reason* separately from the *action*, so the same branch can either archive or skip depending on whether an archive stage even exists. Point out the changelog carve-out: that pipeline has no Archived stage, so there's nothing to move to and skipping is genuinely the right answer there.

    **Step 2 — Add the assignee write to the Asana client (4:30 - 5:15).**
    Open `src/app/lib/asana-client.ts`. This is a four-line function and it should feel like one. The only thing worth pausing on is the type: `string | null`. `null` is the payload Asana wants for "nobody" — it isn't an error case, it's a value. That single nullable parameter is what lets one function both assign and unassign.

    **Step 3 — Fire it on the archive transition only (5:15 - 7:00).**
    Open `src/app/functions/SyncToAsana.ts`. Two things to explain on screen:

    First, the gate: `if (stageName === 'archived')`. Emphasise that this is the *only* transition that touches the assignee. Any broader trigger means a routine stage change could silently take work off somebody's list.

    Second, the `try/catch`. By the time we reach this line the stage move has already succeeded. If clearing the assignee fails, the sync did its main job — reporting failure would be a lie and would trigger a pointless retry. Log it, continue, still return success. This is the line viewers will want to copy.

    **Step 4 — The create path's third state (7:00 - 8:00).**
    Still in `SyncToAsana.ts`, show the `createTask` call. The assignee argument is `null | undefined` and they mean different things: `undefined` means "assign it to the token's owner," `null` means "leave it unassigned." A task created *directly* at the archived stage passes `null` — assigning it and immediately clearing it would flash a notification at somebody for work that was never theirs. Good moment to make the general point: `undefined` is "I have no opinion," `null` is "I have an opinion and it's nobody."

*   **Testing & Wrap-up (8:00 - 10:00):**
    Three tests, all in `sync-to-asana.test.ts`, and say why each one exists:
    1. Archiving clears the assignee.
    2. **Other stages don't touch it** — the regression guard. This is the test that matters most; it's the one that fails if someone widens the condition later.
    3. A failed unassign still reports success.

    Then the manual proof, which is the honest one: unassign yourself in Linear, watch the HubSpot record reach Archived, refresh Asana and watch the task leave My Tasks. Reassign yourself and note the record comes back to the stage mapped from the Linear state — *not* where it was before — while the Asana task stays unassigned. That's the asymmetry, working as designed.

    Wrap on the takeaway: **a filter that decides whether to process an event has not decided what to do about the record that already exists.** Those are two different questions and conflating them is how records quietly go stale.

**💻 Screen-Ready Code Snippets:**

**1. The filter that archives instead of skipping** — `src/app/functions/LinearWebhook.ts`

```ts
// An excluded issue is ARCHIVED rather than skipped. Skipping left the record
// frozen at its last synced stage: still in the pipeline, looking live, no
// longer tracking anything — and reporting 200 the whole time.
const filterReason =
  settings.assigneeFilter === 'assigned' && !assigneeId
    ? 'no assignee'
    : settings.assigneeFilter === 'mine' && assigneeId !== settings.linearAssigneeId
      ? 'not assigned to configured user'
      : null;

if (filterReason) {
  // The changelog pipeline has no archived stage to move to.
  if (isChangelog) return skip(`changelog ${filterReason} (no archive stage)`);

  const archived = await archiveContentByLinearId(payload.data.id, context.accountId);
  if (!archived) return skip(filterReason);

  return { ok: true, action: 'archived', reason: filterReason, id: archived.id };
}
```

**2. One function, assign and unassign** — `src/app/lib/asana-client.ts`

```ts
export const ASANA_SELF = 'me';

/** `null` clears the assignee — it is a value Asana accepts, not an error case. */
export async function setTaskAssignee(
  apiKey: string,
  taskGid: string,
  assignee: string | null,
): Promise<void> {
  await request(apiKey, 'PUT', `/tasks/${taskGid}`, { data: { assignee } });
}
```

**3. Clearing the assignee on archive, without risking the sync** — `src/app/functions/SyncToAsana.ts`

```ts
await updateTaskPipelineStage(asanaApiKey, taskGid, asanaStageGid);

// Archived work should leave the assignee's queue. Tagging it Canceled does
// not: the task still sits in their My Tasks as a live to-do.
// Failing here must not fail the sync — the stage move already landed.
if (stageName === 'archived') {
  try {
    await setTaskAssignee(asanaApiKey, taskGid, null);
    console.log(`Unassigned archived Asana task ${taskGid}`);
  } catch (err) {
    console.warn(`Could not unassign ${taskGid}:`, err);
  }
}
```

**4. Three states on the create path** — `src/app/functions/SyncToAsana.ts`

```ts
const task = await createTask(
  asanaApiKey,
  asanaProjectGid,
  title ?? 'Untitled',
  customFields,
  sectionGid || undefined,
  stageName === 'archived' ? null : undefined, // null leaves it unassigned; undefined assigns the token's owner
  dueOn,
);
```

**5. The test that stops someone widening the gate later**

```ts
it('leaves the assignee alone on every other stage', async () => {
  await main(eventFor({ stage: 'in_progress' }));
  expect(setTaskAssignee).not.toHaveBeenCalled();
});

it('still reports success when the unassign fails', async () => {
  vi.mocked(setTaskAssignee).mockRejectedValueOnce(new Error('asana down'));
  const res = await main(eventFor({ stage: 'archived' }));
  expect(res.statusCode).toBe(200); // the stage move already landed
});
```
