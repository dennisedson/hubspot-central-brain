## 🎬 YouTube Episode Guide: Three Shapes, One Fix: Reverse-Engineering HubSpot Serverless Return Values

**🎯 Core Learning Objective:**
"By the end of this video, you will know how to correctly wire `hubspot.serverless()` calls in a HubSpot UI extension — including the exact shape the platform returns — so your settings or data pages load reliably instead of silently failing."

---

**⏱️ The 10-Minute Script Outline:**

*   **Hook & Demo (0:00 - 1:00):**
    The Settings page has been broken for multiple sessions. Every fix attempt produces a different error. Today we crack it — not by guessing, but by making the app tell us exactly what HubSpot is actually returning. We end the video with a fully-loaded Settings page showing real data: team name, assignee filter, and your Linear identity — all pulled live from the API.

*   **The Architecture (1:00 - 3:00):**
    A HubSpot UI extension page calls `hubspot.serverless()` to invoke a private serverless function. The function fetches data from HubSpot CRM and the Linear API, then returns a result. The question nobody documents clearly: what shape does that result take when it arrives back in the React component?

    There are three plausible shapes that look reasonable:
    - `{ status: 'SUCCESS', response: { statusCode, body } }` — looks like HTTP middleware
    - `{ body: { statusCode, body } }` — looks like a fetch wrapper
    - `{ statusCode, body }` — the function return value, passed through directly

    Only one is correct. We try two wrong ones before using a diagnostic throw to find the truth.

*   **Step-by-Step Implementation (3:00 - 8:00):**

    **Step 1 — Identify the real component (file: `src/app/pages/SettingsApp.tsx`)**
    The app has two settings components. Sentry data (`extensibleCardId`, `parameters: {"method":"GET"}`) pins down which one is actually rendered. The `page`-type hsmeta in `pages-hsmeta.json` is what users see — not the `settings`-extension component.

    **Step 2 — Fix `context.parameters` in the function (file: `src/app/functions/AppSettingsApi.ts`)**
    Private serverless functions receive values via `context.parameters`, not `context.body`. `context.body` is only populated for public endpoint functions called over HTTP. Change every `context.body?.x` reference to `context.parameters?.x`.

    **Step 3 — Add a diagnostic throw to expose the result shape**
    Instead of guessing again, replace `callApi`'s return logic with:
    ```typescript
    throw new Error(`RAW_SHAPE:${JSON.stringify(result).slice(0, 300)}`);
    ```
    Deploy, open the page, read the error. The output reveals:
    ```json
    { "statusCode": 200, "body": "{\"linearTeamId\":\"...\",\"teams\":[...]}" }
    ```
    The function's return value IS the result — no envelope.

    **Step 4 — Apply the correct shape to all three callers**
    Fix `ServerlessResult` type and `callApi` in `SettingsApp.tsx`, `SettingsPage.tsx`, and `ContentCommandCenter.tsx`:
    ```typescript
    type ServerlessResult = {
      statusCode: number;
      body: string;
    };

    const result = await (hubspot.serverless as (...) => Promise<ServerlessResult>)(
      'app_settings_api',
      { parameters: { action, ...params } },
    );
    if (!result || result.statusCode === undefined) {
      throw new Error(`Unexpected serverless result: ${JSON.stringify(result)}`);
    }
    return result;
    ```

*   **Testing & Wrap-up (8:00 - 10:00):**
    After deploy, the Settings page loads with real data — Linear team, assignee filter, and team member dropdown pre-populated. Clicking Save works. The three rules to remember: (1) parameters arrive via `context.parameters`; (2) `hubspot.serverless()` returns your function's value directly; (3) when in doubt, throw a diagnostic — one deploy cycle beats ten guesses.

---

**💻 Screen-Ready Code Snippets:**

**The wrong shape (what seems reasonable but isn't):**
```typescript
// ❌ Wrong — this is not what HubSpot returns
if (result.status !== 'SUCCESS' || !result.response) {
  throw new Error('Serverless call failed');
}
return result.response;
```

**The diagnostic throw (use this whenever you're unsure):**
```typescript
throw new Error(`RAW_SHAPE:${JSON.stringify(result).slice(0, 300)}`);
```

**The correct serverless call pattern:**
```typescript
type ServerlessResult = {
  statusCode: number;
  body: string;
};

async function callApi(
  action: string,
  params: Record<string, string> = {},
): Promise<{ statusCode: number; body: string }> {
  const result = await (
    hubspot.serverless as (
      uid: string,
      opts: { parameters: Record<string, string> },
    ) => Promise<ServerlessResult>
  )('app_settings_api', { parameters: { action, ...params } });

  if (!result || result.statusCode === undefined) {
    throw new Error(`Unexpected serverless result: ${JSON.stringify(result)}`);
  }
  return result;
}
```

**The correct function context pattern:**
```typescript
// ✅ context.parameters for private app-functions
interface SettingsContext {
  accountId?: number;
  parameters?: Record<string, string | undefined>;
}

export async function main(context: SettingsContext) {
  const action = context.parameters?.action ?? 'getSettings';
  const portalId = context.accountId ?? parseInt(context.parameters?.portalId ?? '0', 10);
  // ...
}
```
