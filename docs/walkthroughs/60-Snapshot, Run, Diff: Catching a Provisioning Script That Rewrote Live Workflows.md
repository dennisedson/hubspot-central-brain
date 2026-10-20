## 🎬 YouTube Episode Guide: Snapshot, Run, Diff

**🎯 Core Learning Objective:**
"By the end of this video, you will know how to safely run a script that rewrites live HubSpot workflows: snapshot every workflow first, diff after, roll back exactly what changed, and fix the script so a re-run is a provable no-op."

**⏱️ The 10-Minute Script Outline:**

*   **Hook & Demo (0:00 - 1:00):**
    "The script said `✓ Updated (isEnabled=true preserved)` nine times. It was telling the truth about the thing it checked, and it had broken my Linear sync."

    Show the terminal output: all green ticks. Then show the diff we ran afterwards: `linearTeamId: "db6b2f51-…" -> "any"` on both sync workflows, and `actionTypeVersion: 75 -> 0` on three more. Promise the payoff: by the end, the same script runs and the diff says IDENTICAL nine times.

*   **The Architecture (1:00 - 3:00):**
    Plain English. HubSpot's `PUT /automation/v4/flows/{id}` is a **full replace**: whatever you don't send gets dropped or reset. So a provisioning script that rebuilds a workflow from code has to merge with what's live, and anything it doesn't know about, it destroys.

    Two failure modes, both on screen:
    1. **A sentinel leaking into a real field.** App settings store `linear_team_id = 'any'`, meaning "assignee-first, any team". That's a filter for the webhook. The script copied it into the workflow action, where `SyncToLinear` uses it to look up a team's states. Linear has no team called `any`.
    2. **A value the builder hardcodes.** The builder always sends `actionTypeVersion: 0`. The live flows pinned 75.

    Then the meta-lesson: the script's "preserved" line printed what it *read* before the PUT, not what was there *after*. It verified its input, not its postcondition.

*   **Step-by-Step Implementation (3:00 - 8:00):**

    **Step 1 — Snapshot every workflow before you touch anything (3:00 - 4:15).**
    Show `snapshot-flows.ts`: list the flows, GET each one in full, and write it to disk. Explain why it's the full GET and not the list: the list doesn't include actions or fields. This snapshot is both your evidence and your undo.

    **Step 2 — Diff, ignoring what always changes (4:15 - 5:15).**
    Show the small recursive diff that skips `revisionId` and `updatedAt`. Run it and read the output out loud: three kinds of change, and only one of them (the new `objectId`/`title` fields) was intended.

    **Step 3 — Roll back exactly what was wrong (5:15 - 6:15).**
    Show `restore-flows.ts`: GET the live flow, copy back only `linearTeamId` and `actionTypeVersion` from the snapshot, and PUT. Keep the intended additions. Re-diff: two intended differences, five IDENTICAL.

    **Step 4 — Make the logic testable, then fix it test-first (6:15 - 8:00).**
    The merge function lived in a script that runs `main()` on import, which is why nothing tested it. Move it unchanged into `src/scripts/flow-actions.ts` and pin today's behaviour with a test. Then write the two failing tests using the *real* values from the diff, and watch them fail: `expected 'any' to be 'db6b2f51-…'`, `expected 0 to be 75`. Fix: keep the live team when the builder only has the sentinel (read through `isAnyTeam`, never truthiness), and carry over the live version. Add a control: a real team id from the builder still replaces the live one.

*   **Testing & Wrap-up (8:00 - 10:00):**
    Run `npx vitest run src/app/__tests__/flow-actions.test.ts`: 9 green. Then the real proof: snapshot, re-run the fixed script on dev, diff. Nine workflows, IDENTICAL.

    Close with what the check turned up on prod: all eight workflows disabled, and the two sync workflows already carrying `'any'` from their first provisioning. The fixed script now **warns** about that instead of hiding it.

    Recap: a script that rewrites live config has to merge with what's live; a sentinel is never a value; verify the postcondition, not the input; and the snapshot is your rollback plan.

**💻 Screen-Ready Code Snippets:**

The fix: `src/scripts/flow-actions.ts`:

```ts
export function carryOverServerActionFields(built: FlowAction[], live: FlowAction[]): FlowAction[] {
  return built.map(action => {
    const match = live.find(l => l.actionId === action.actionId && l.actionTypeId === action.actionTypeId);
    if (!match) return action;

    const inherited: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(match.fields ?? {})) {
      if (key.startsWith('hs_') && !(key in action.fields)) inherited[key] = value;
    }

    // Settings say 'any' — a webhook filter, not a team. Keep the real one.
    const builtTeam = action.fields.linearTeamId;
    const liveTeam = match.fields?.linearTeamId;
    if (typeof builtTeam === 'string' && isAnyTeam(builtTeam) && typeof liveTeam === 'string') {
      inherited.linearTeamId = liveTeam;
    }

    return {
      ...action,
      ...(match.actionTypeVersion !== undefined ? { actionTypeVersion: match.actionTypeVersion } : {}),
      fields: { ...action.fields, ...inherited },
    };
  });
}
```

The tests that failed first: `src/app/__tests__/flow-actions.test.ts`:

```ts
it("keeps the live team id when the builder only has the 'any' sentinel", () => {
  const built = [{ actionId: '1', actionTypeId: SYNC_TO_LINEAR, fields: { linearTeamId: 'any' } }];
  const live  = [{ actionId: '1', actionTypeId: SYNC_TO_LINEAR, fields: { linearTeamId: REAL_TEAM } }];
  expect(carryOverServerActionFields(built, live)[0].fields.linearTeamId).toBe(REAL_TEAM);
});

it('keeps the action version the live flow pins', () => {
  const built = [{ actionId: '1', actionTypeId: ASSOCIATE, actionTypeVersion: 0, fields: {} }];
  const live  = [{ actionId: '1', actionTypeId: ASSOCIATE, actionTypeVersion: 75, fields: {} }];
  expect(carryOverServerActionFields(built, live)[0].actionTypeVersion).toBe(75);
});
```

Snapshot every flow in full:

```ts
const list = await (await fetch('https://api.hubapi.com/automation/v4/flows?limit=100', { headers })).json();
for (const f of list.results) {
  const full = await (await fetch(`https://api.hubapi.com/automation/v4/flows/${f.id}`, { headers })).json();
  fs.writeFileSync(`${dir}/${portal}-${f.id}.json`, JSON.stringify(full, null, 2));
}
```

The diff, ignoring what always moves:

```python
IGN = {'revisionId', 'updatedAt'}
def walk(x, y, path=''):
    if isinstance(x, dict) and isinstance(y, dict):
        out = []
        for k in sorted(set(x) | set(y)):
            if k not in IGN:
                out += walk(x.get(k), y.get(k), f'{path}.{k}')
        return out
    if isinstance(x, list) and isinstance(y, list) and len(x) == len(y):   # actions are a list
        return [d for i, (p, q) in enumerate(zip(x, y)) for d in walk(p, q, f'{path}[{i}]')]
    return [] if x == y else [f'~ {path}: {x!r} -> {y!r}']
```
