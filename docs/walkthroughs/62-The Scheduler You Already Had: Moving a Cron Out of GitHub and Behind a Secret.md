## 🎬 YouTube Episode Guide: The Scheduler You Already Had

**🎯 Core Learning Objective:**
"By the end of this video, you will know how to move a scheduled job from a GitHub Actions cron into a HubSpot daily workflow, split one serverless function into a private door and a secret-checked public door, and write a test that keeps every public workflow action honest about authentication."

**⏱️ The 10-Minute Script Outline:**

*   **Hook & Demo (0:00 - 1:00):**
    "My YouTube metrics sync ran from GitHub for three weeks, because I'd read a field wrong and decided HubSpot couldn't schedule anything. It could. And the workaround left the endpoint open to anyone."

    Show the two snapshots side by side: dev's *Asana → Poll (Daily)* flow carries `"enrollmentSchedule": {"type":"DAILY","timeOfDay":{"hour":17,"minute":0}}` and is on, while `enrollmentCriteria.type` says `MANUAL`. Then the old cron: `curl -X POST …/youtube-sync -d '{}'`. No secret, and it got a 200.

*   **The Architecture (1:00 - 3:00):**
    Plain English, three ideas.

    1. **A flow has two different "when" fields.** `enrollmentCriteria` says *which records* get in, and `MANUAL` means "you pick them". `enrollmentSchedule` says *how often* it runs. I read the first as the second.
    2. **The workaround cost more than it looked.** The GitHub cron only ran against dev, fired around 15:30 for a 09:00 schedule, and needed the endpoint open, because GitHub had no secret to send.
    3. **Two callers, two doors.** The Video card calls the sync from inside HubSpot by uid, so it needs no URL. A workflow action can only reach a function through a public URL. So split them: `youtube_sync` becomes private, and a new `youtube_sync_action` owns `/youtube-sync` and checks the shared secret first. It's the same move episode 58 made for the dashboard.

*   **Step-by-Step Implementation (3:00 - 8:00):**

    **Step 1: Tests first, for the split (3:00 - 4:30).**
    Open `youtube-sync.test.ts`. The old assertion "endpoint path is `youtube-sync`" becomes "`youtube_sync` publishes **no** endpoint". Add the new hsmeta's expectations: it owns the path and declares `SYNC_SHARED_SECRET`. In `function-endpoints-are-justified.test.ts`, `youtube_sync` moves to the must-stay-private controls. Run them and watch them fail.

    **Step 2: The new door (4:30 - 5:45).**
    Open `YouTubeSyncAction.ts`. It checks the secret before anything else (401 without it, 500 if the secret isn't configured), takes the portal from the gateway's `accountId`, sweeps the portal with the shared `runSync`, and returns `outputFields` using the exported `outputFieldsFor`. It deliberately keeps the 500-on-failure behaviour: a dead refresh token must not look like success. Show the test mock that keeps the real module and swaps only `runSync`, using `importOriginal`.

    **Step 3: The workflow side (5:45 - 6:45).**
    The workflow action gains a required `sharedSecret` input (`STATIC_VALUE`), and `provision-workflows.ts` fills it in for the daily YouTube flow. Delete `.github/workflows/youtube-sync.yml`. The Video card's Sync button is now the way to run it by hand.

    **Step 4: The ratchet (6:45 - 8:00).**
    This is the twist: the endpoint allowlist had a comment saying every workflow action checks `SYNC_SHARED_SECRET`. Generate the real table (function declares the secret? verifies it? does the action send it?). Only four of twelve did. Instead of fixing seven actions in one PR, write `NOT_YET_AUTHENTICATED`, a named list with a reason per entry. The test requires every other action to authenticate end to end, and it fails if a listed action starts authenticating but is never removed from the list. A comment can go stale; this test can't.

*   **Testing & Wrap-up (8:00 - 10:00):**
    `npx vitest run src/app/__tests__/youtube-sync-action.test.ts`: 7 tests, including "refuses a call without the shared secret, before touching YouTube". Then `npm run validate`: 1,322 green.

    Then be honest about what you gave up. The GitHub job asserted postconditions: it failed on errors and warned on zero records. A HubSpot workflow shows a 500 as a failed action, but a 200 with `recordsFound: 0` is a green tick, so read the output fields.

    Recap: check what the platform can do before you work around it; give each caller its own door; and replace comments that claim security properties with tests that check them.

**💻 Screen-Ready Code Snippets:**

The two "when" fields on a HubSpot flow (from dev, 2026-10-20):

```json
{
  "enrollmentCriteria": { "type": "MANUAL", "shouldReEnroll": true },
  "enrollmentSchedule": { "type": "DAILY", "timeOfDay": { "hour": 17, "minute": 0 } },
  "isEnabled": true
}
```

The secret-checked door: `src/app/functions/YouTubeSyncAction.ts`:

```ts
export async function main(context: ActionContext) {
  const expected = process.env.SYNC_SHARED_SECRET;
  if (!expected) return respond(500, { error: 'Server misconfiguration' });
  if (!verifySharedSecret(context.body?.inputFields?.sharedSecret, expected)) {
    return respond(401, { error: 'Unauthorized' });
  }
  const portalId = context.accountId;
  if (!portalId) return respond(400, { error: 'Missing portal' });

  try {
    const outcome = await runSync(portalId, {});
    return respond(200, { ...outcome, outputFields: outputFieldsFor(outcome) });
  } catch (err) {
    return respond(500, { message: String(err), outputFields: { syncStatus: 'error' } });
  }
}
```

The private door: `YouTubeSync-hsmeta.json`, with no `endpoint`:

```json
{
  "uid": "youtube_sync",
  "type": "app-function",
  "config": {
    "entrypoint": "/app/functions/YouTubeSync.js",
    "secretKeys": ["HS_ACCESS_TOKEN", "YOUTUBE_CLIENT_ID", "YOUTUBE_CLIENT_SECRET", "YOUTUBE_REFRESH_TOKEN"]
  }
}
```

The ratchet: `workflow-actions.test.ts`:

```ts
const NOT_YET_AUTHENTICATED: Record<string, string> = {
  asana_poll: 'polls Asana; no secret input yet — follow-up',
  fellow_sync: 'Fellow integration unverified (every path 404s) — follow-up',
  // …
};

if (fn.meta.uid in NOT_YET_AUTHENTICATED) {
  expect(authenticated, `${fn.meta.uid} now authenticates — remove it from the list`).toBe(false);
} else {
  expect({ declares, verifies, passes }).toEqual({ declares: true, verifies: true, passes: true });
}
```

Mocking one export, keeping the rest real:

```ts
vi.doMock('../functions/YouTubeSync', async importOriginal => ({
  ...(await importOriginal<typeof import('../functions/YouTubeSync')>()),
  runSync,
}));
```
