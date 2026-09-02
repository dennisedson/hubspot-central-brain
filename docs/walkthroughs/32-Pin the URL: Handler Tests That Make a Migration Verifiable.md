## 🎬 YouTube Episode Guide: Pin the URL — Handler Tests That Make a Migration Verifiable

**🎯 Core Learning Objective:**
"By the end of this video, you will know how to write handler-level tests that assert the exact URL your code calls — so a wide-reaching API migration becomes something you can verify locally, in one test run, instead of hoping production tells you."

**⏱️ The 10-Minute Script Outline:**

*   **Hook & Demo (0:00 - 1:00):**
    "Last episode I centralised every HubSpot path into one module and pinned each builder to an exact string. That proves the builders are right. It does **not** prove my handlers *use* them right."
    Show the gap on screen: `objectPath('2-67505887', '4201')` is tested. But nobody tests that `TaskStatusApi` calls it with the content objectTypeId, the record id, and `?properties=linear_issue_id,asana_task_id,hs_pipeline,hs_pipeline_stage` on the end.
    "So I wrote six test files — one per serverless function — and every single one asserts the full URL string, query string included. 120 new tests. Now `npx vitest run` is the migration checklist."

*   **The Architecture (1:00 - 3:00):**
    Plain English: a serverless handler is just `main(context) → { statusCode, body }`. Everything in between is `fetch`. So there are exactly three things worth asserting, and most test suites only assert the third:
    1. **Which URL** went out (the migration surface).
    2. **What came back** when a source fails (the resilience surface).
    3. **What the card gets** (the contract surface).
    Explain the mocking stance: stub global `fetch` and let the *real* client libraries run underneath. If you mock `getLinearIssue`, you never see the Linear URL. If you mock `fetch`, you see every hop — HubSpot, Linear, Asana, Enterpret — and you can pin each one.
    Then the second decision: **don't mock `portal-config`.** Use the real dev portal id, `51869810`, so the object type ids in the assertions are the ones production actually builds.

*   **Step-by-Step Implementation (3:00 - 8:00):**

    **Step 1 — The harness (3:00 - 4:00).**
    Open [task-status-api.test.ts](../../src/app/__tests__/task-status-api.test.ts). Show the three-line harness: `vi.fn()`, `vi.stubGlobal('fetch', …)`, `mockReset()` in `beforeEach`. Show `vi.stubEnv` + `vi.unstubAllEnvs()` so a developer's own exported secret can never change the result. Then the payoff: `urls()` — one helper that turns the whole call log into an array of strings.

    **Step 2 — Assert the URL, not a fragment (4:00 - 5:30).**
    The one rule: `toBe`, never `toContain`, never a regex. Show `expect(urls()).toEqual([RECORD_URL, LINEAR_URL, ASANA_URL])` — that single line pins three systems *and* the call order. Then show the two-family case in [meeting-intelligence-api.test.ts](../../src/app/__tests__/meeting-intelligence-api.test.ts): v4 associations with `?limit=100`, and v3 `batch/read`. "This handler is where the migration is riskiest, because two different API families move on different schedules."

    **Step 3 — Prove failure isolation, don't assume it (5:30 - 7:00).**
    Four of these handlers use `Promise.allSettled` so one dead integration can't blank the other half of the card. That claim is untested until you make one side fail. Show the test: Linear returns 500, Asana returns a task, and the assertion checks *both* — `errors.linear` populated **and** `asana.name` still there.
    Mention the ordering trap: under `allSettled` the call sequence changes when a source rejects, so `MeetingIntelligenceApi` routes `fetch` by URL instead of by call index.

    **Step 4 — The behaviours that only bite in production (7:00 - 8:00).**
    Three worth showing:
    - **The false-drift trap.** The stage mapping is many-to-one in *both* directions. A changelog record in `identified` with a Linear issue in `Todo` is in sync — even though `expectedState` is `Backlog`. Show that test.
    - **Never clobber a human.** `GenerateSocialDraft` must return `skipped: true` and make **zero** write calls when `social_post_draft` already has content. Assert the call log has length 1.
    - **Fail soft, not loud.** `AssociateRelatedContent` hits an association endpoint that isn't provisioned yet. A 4xx must come back as **200** with `associationStatus: "failed"` — because a non-2xx makes HubSpot retry and park the enrollment.

*   **Testing & Wrap-up (8:00 - 10:00):**
    Run `npx vitest run` — 434 passing, up from 314.
    Then the real demo: open `hs-api.ts`, change one line — `const OBJECTS_V3 = '/crm/v3/objects'` → `OBJECTS_DATED` — and re-run. Watch the failures name every handler that just moved, with the old and new URL side by side. Revert.
    "That's the whole point. The migration is still one line. But now the blast radius prints itself."
    Summary: mock at the boundary you want to observe; assert whole strings, not fragments; and a test that proves failure isolation is worth ten that prove the happy path.

**💻 Screen-Ready Code Snippets:**

**1. The whole harness.**
```ts
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

beforeEach(() => {
  mockFetch.mockReset();
  vi.stubEnv('PRIVATE_APP_ACCESS_TOKEN', 'hs-test-token');
});

afterEach(() => vi.unstubAllEnvs());

function urls(): string[] {
  return mockFetch.mock.calls.map(call => String(call[0]));
}
```

**2. Pin the URL — exact literals, query string included.**
```ts
const RECORD_URL =
  'https://api.hubapi.com/crm/v3/objects/2-67505887/4201' +
  '?properties=linear_issue_id,asana_task_id,hs_pipeline,hs_pipeline_stage';
const LINEAR_URL = 'https://api.linear.app/graphql';
const ASANA_URL =
  'https://app.asana.com/api/1.0/tasks/1209876543210' +
  '?opt_fields=name,permalink_url,assignee.name,custom_fields.gid,custom_fields.enum_value.gid';

it('calls HubSpot, then Linear, then Asana — three exact URLs', async () => {
  mockRecord({ linear_issue_id: 'lin-abc-123', asana_task_id: '1209876543210', /* … */ });
  mockLinearIssue('In Progress');
  mockAsanaTask('1202184607667441');

  await main(makeContext());

  expect(urls()).toEqual([RECORD_URL, LINEAR_URL, ASANA_URL]);
});
```

**3. Prove one dead source doesn't blank the other.**
```ts
it('a Linear outage does not blank Asana', async () => {
  mockRecord({ linear_issue_id: 'lin-abc-123', asana_task_id: '1209876543210', /* … */ });
  mockFailure(500);                       // Linear is down
  mockAsanaTask('1202184607667441');      // Asana is fine

  const body = JSON.parse((await main(makeContext())).body);

  expect(body.errors.linear).toBe('Linear API HTTP error: 500 Server Error');
  expect(body.asana.name).toBe('Draft blog post');   // still there
  expect(body.errors.asana).toBeNull();
});
```

**4. Route by URL when `allSettled` makes call order unstable.**
```ts
mockFetch.mockImplementation(async (url: string) => {
  const match = routes.get(String(url));
  if (!match) throw new Error(`Unrouted fetch in test: ${url}`);
  const status = match.status ?? 200;
  return {
    ok: status < 400,
    status,
    json: async () => match.json ?? {},
    text: async () => match.text ?? '',
  };
});
```

**5. The behaviours that only bite in production.**
```ts
// Many-to-one in both directions: this is IN SYNC, not drift.
expect(body.linear.drift).toEqual({
  inSync: true, expectedState: 'Backlog', actualState: 'Todo',
});

// A human's draft is never overwritten — and no write is even attempted.
expect(body.skipped).toBe(true);
expect(urls()).toEqual([READ_URL]);

// An unprovisioned association must fail SOFT, or HubSpot parks the enrollment.
expect(res.statusCode).toBe(200);
expect(JSON.parse(res.body).outputFields.associationStatus).toBe('failed');
```
