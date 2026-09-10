## 🎬 YouTube Episode Guide: The Parameter That Was Never There — When Your Tests Encode the Wrong Reality

**🎯 Core Learning Objective:**
"By the end of this video, you will know how to find out what shape a serverless platform *actually* hands your function — by deploying a diagnostic that echoes it — and you will understand why a full green test suite can coexist with a completely broken production path, because tests written from an assumed interface only ever prove the assumption."

**⏱️ The 10-Minute Script Outline:**

*   **Hook & Demo (0:00 – 1:00):**
    Curl a deployed OAuth endpoint with `?action=status`. It returns an authorization URL. Curl it with `?action=disconnect`. Same authorization URL. Curl it with a fake `?code=` — the thing an OAuth callback exists to handle — and it *still* returns an authorization URL. Every query parameter is being ignored. Then the sting: 725 unit tests pass, and four CRM cards calling these same functions work perfectly in production. Nothing was red. The bug is that Google's redirect would have landed here, the code would have been invisible, and the user would have received a fresh login link instead of their token — forever.

*   **The Architecture (1:00 – 3:00):**
    Plain English on how this hides. The handler reads parameters through a small helper checking three places: `parameters`, `query`, `body`. HubSpot delivers URL query parameters in a fourth — `params`. But every *existing* caller was a CRM card using `hubspot.serverless()`, which posts its payload into `body` — one of the three the helper did check. So every real caller used the one path that worked, and the broken paths had no users yet. Name the general principle: **an interface you wrote down is a hypothesis; an interface you observed is a fact.** The TypeScript `interface` declaring `query?: Record<string, string>` was documentation of a belief, and TypeScript will happily typecheck a belief.

*   **Step-by-Step Implementation (3:00 – 8:00):**

    *   **Step 1 — Prove the parameter never arrives (3:00 – 4:00).** Don't reason about it. Send `?code=TESTCODE` and watch the response come back as the default branch instead of the callback. That single curl converts "I think params aren't working" into "params are not working," which is the difference between a theory and a bug report.

    *   **Step 2 — Ask the platform what it sends (4:00 – 5:30).** The technique worth stealing. You cannot read the docs faster than you can read reality: deploy a temporary handler that serializes its own context — keys only, values as types — and returns it in the response body. Note *why* the response body and not a log: console output went to an execution log the CLI could not retrieve, and chasing it burned more time than the fix. Then the payoff on screen:
        ```
        contextKeys: [HS_FUNCTION_NAME, method, params, body, headers, accountId]
        params: ['action', 'code']
        ```
        There they are, in a key nothing in the codebase had ever mentioned.

    *   **Step 3 — Fix it, and find the second bug hiding behind the first (5:30 – 7:00).** Add `params` to the lookup chain, redeploy, curl again — and get `state.split is not a function`. Progress, not regression: the parameter now arrives, and it arrives as an **array**. `["status"]` is not `"status"`, so the router falls through; the signed state has no `.split()`. Two bugs stacked, the second invisible until the first was fixed. Unwrap the array and it finally routes.

    *   **Step 4 — Fix every copy, not just the one you were debugging (7:00 – 8:00).** Grep the helper. Nine handlers had copy-pasted it. Fix one and you have fixed the function you happened to be looking at; fix nine and you have fixed the bug. Show the grep, show the count, show the batch patch.

*   **Testing & Wrap-up (8:00 – 10:00):**
    Write the regression test using the shape the platform *sends*, not the shape the code wanted — and say plainly on camera that the previous tests passed for two days against a broken production path because they supplied the expected shape to a function that never sees it. Then verify where it actually counts: live, against the deployed endpoint. `status` returns `disconnected`. A forged state gets rejected as `Invalid or missing state` — proof the callback is reachable at last. Complete the OAuth flow and watch `status` flip to `connected` with a real channel name. Close on the lesson: green tests prove your code matches your beliefs. Only a live call proves your beliefs match the platform.

**💻 Screen-Ready Code Snippets:**

**The symptom — every query parameter ignored:**
```bash
curl -s ".../youtube-auth?action=status"          # → {"authUrl": "..."}
curl -s ".../youtube-auth?action=disconnect"      # → {"authUrl": "..."}
curl -s ".../youtube-auth?code=TESTCODE"          # → {"authUrl": "..."}  ← the callback, unreachable
```

**The helper, and the place it never looked:**
```ts
// Before — three plausible locations, none of them the real one
return ctx.parameters?.[key] ?? ctx.query?.[key] ?? ctx.body?.[key];
```

**Ask the platform instead of guessing:**
```ts
// Temporary. Returns the context's own shape in the response body —
// keys and types only, never values.
const ctx = context as unknown as Record<string, unknown>;
const shape: Record<string, unknown> = {};
for (const k of Object.keys(ctx)) {
  const v = ctx[k];
  shape[k] = v && typeof v === 'object' ? Object.keys(v as object) : typeof v;
}
return json(200, { __contextKeys: Object.keys(ctx), __contextShape: shape });
```
```
contextKeys: [HS_FUNCTION_NAME, method, params, body, headers, accountId]
params:      ['action', 'code']
```

**The fix — and the array nobody expected:**
```ts
// HubSpot delivers query params in `params`, and the values are ARRAYS.
// Reading one through yields ["status"], which !== "status" and has no .split().
const q = ctx.params?.[key];
const fromQuery = Array.isArray(q) ? q[0] : q;
return fromQuery ?? ctx.parameters?.[key] ?? ctx.query?.[key] ?? ctx.body?.[key];
```

**Fix every copy:**
```bash
grep -rln "ctx.parameters?.\[key\]" src/app/functions/*.ts
# nine handlers shared the same copy-pasted helper
```

**Verify where it counts — live, not green:**
```
action=status       → {"status":"disconnected","hasRefreshTokenSecret":false}
code=…&state=bogus  → {"error":"Invalid or missing state"}   ← callback reachable at last
                    → after real consent:
action=status       → {"status":"connected","channelTitle":"dennis edson"}
```
