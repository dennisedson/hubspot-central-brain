## 🎬 YouTube Episode Guide: One Door, One Key

**🎯 Core Learning Objective:**
"By the end of this video, you will know how to put authentication on a serverless endpoint that two different callers share — one that can keep a secret and one that cannot — by splitting the surface instead of bolting a check onto the function they both use."

**⏱️ The 10-Minute Script Outline:**

*   **Hook & Demo (0:00 - 1:00):**
    "This URL let anyone on the internet write to my CRM. Not read — *write*. And I couldn't just add a password, because the thing calling it had nowhere to keep one."

    Show `curl` hitting `settings-api?action=saveSettings` with no credentials. Then the finished state: that path 404s, a new `dashboard-data` path answers `401` without a key, and the dashboard page still renders live numbers.

*   **The Architecture (1:00 - 3:00):**
    Set up the squeeze. One function had two callers:

    1. A **CRM UI extension** — runs in the user's browser. HubSpot authenticates it already, and it calls by uid, not URL. It can hold no secret; anything shipped to a browser is public.
    2. A **CMS page** — server-renders on HubSpot's infrastructure, where `hubspot.serverless()` doesn't exist. It can *only* use a URL, and it *can* hold a secret.

    So requiring a secret breaks caller 1. Not requiring one leaves caller 2's door open to the world.

    The resolution, and the transferable idea: **don't authenticate a shared surface, split it.** Make the shared function private so only the trusted internal caller reaches it. Then build one narrow, read-only, authenticated endpoint for the caller that genuinely needs a URL.

    Say the rule plainly: the public surface should be the smallest one that does the job, not the one that already exists.

*   **Step-by-Step Implementation (3:00 - 8:00):**

    **Step 1 — Prove a query parameter even arrives (3:00 - 4:00).**
    A comment in my repo said HubSpot "strips both custom headers and query parameters." If true, there's nowhere to put a key. Don't trust it — test it. Call a function that takes a parameter and check whether the answer changes. Mine did, which killed the premise and unblocked the design. Headers really are unavailable; query parameters are not.

    **Step 2 — Create the secret first, because the deploy depends on it (4:00 - 4:45).**
    `hs secrets add DASHBOARD_SHARED_SECRET`. A function cannot declare a secret that doesn't exist — the deploy fails outright. Warn viewers that `hs secrets list` lags behind the write by a few minutes, so an absent name right after adding is not a failure.

    **Step 3 — Write the one public door (4:45 - 6:30).**
    Open the new function. Three beats: fail closed when the secret is unset, compare in constant time, then call the two now-private functions in-process rather than over HTTP.

    Point out the 502. If half the data fails, return an error — never a partial answer. A dashboard that paints "0 active records" when the fetch failed is lying to you.

    **Step 4 — Close the old doors and point the page at the new one (6:30 - 8:00).**
    Delete `endpoint` from both shared functions. In the CMS module, `getSecret()` during SSR — note that it *throws* inside an island on purpose, so it can't leak to the browser.

*   **Testing & Wrap-up (8:00 - 10:00):**
    Deploy, then verify from outside: both old paths 404, the new path 401 with no key. Stress the detail that `401` rather than `500` is what proves the function can actually read the secret — a misconfigured deploy fails differently from a rejected caller.

    Then load the page and show the numbers still render, and open a CRM record to show the extension unaffected.

    Summary: split rather than bolt on; make the public surface read-only and minimal; fail closed; and never let a failed fetch render as a zero.

**💻 Screen-Ready Code Snippets:**

**1. Does a query parameter survive the runtime? Test, don't assume.**

```bash
# Same function, one parameter different. If the answer changes, params arrive.
curl -s "$BASE/content-data-api"                   # ['Idea','Outline',...]
curl -s "$BASE/content-data-api?pipeline=changelog" # ['Identified','Drafting',...]
```

**2. The one public door — fail closed, then delegate**

```ts
import { verifySharedSecret } from '../lib/shared-secret';
import { main as contentData } from './ContentDataApi';
import { main as appSettings } from './AppSettingsApi';

export async function main(context) {
  const expected = process.env.DASHBOARD_SHARED_SECRET;
  if (!expected) {
    // A missing secret is a broken deploy, not permission.
    return { statusCode: 500, body: JSON.stringify({ error: 'Server misconfiguration' }) };
  }
  if (!verifySharedSecret(param(context, 'secret'), expected)) {
    return { statusCode: 401, body: JSON.stringify({ error: 'Unauthorized' }) };
  }

  // In-process: these are private now, and a round trip would spend the
  // 20-second budget twice.
  const [pipeline, settings] = await Promise.all([
    contentData({ parameters: { portalId } }),
    appSettings({ parameters: { action: 'getSettings', portalId } }),
  ]);

  // Half an answer is a wrong answer — it renders as "0 active records".
  if (pipeline.statusCode !== 200) return { statusCode: 502, body: '{"error":"Content pipeline unavailable"}' };
  if (settings.statusCode !== 200) return { statusCode: 502, body: '{"error":"Settings unavailable"}' };

  return { statusCode: 200, body: JSON.stringify({
    pipeline: JSON.parse(pipeline.body), settings: JSON.parse(settings.body),
  })};
}
```

**3. Constant-time comparison that tolerates different lengths**

```ts
export function verifySharedSecret(provided?: string, expected?: string): boolean {
  if (!provided || !expected) return false;
  // Hash both first: timingSafeEqual throws on a length mismatch, and the
  // throw itself would leak the length.
  const a = crypto.createHash('sha256').update(provided).digest();
  const b = crypto.createHash('sha256').update(expected).digest();
  return crypto.timingSafeEqual(a, b);
}
```

**4. Reading the secret in CMS React — SSR only**

```jsx
import { getSecret } from '@hubspot/cms-components';

export async function getServerSideProps({ hublData }) {
  const portalId = hublData?.portalId;
  const noData = error => ({
    serverSideProps: { pipeline: null, settings: null, fetchError: error },
    cacheConfig: { cacheControl: 'no-cache' },
  });

  try {
    // Throws if called from an island — that is the safety rail, not a bug.
    const secret = getSecret('DASHBOARD_SHARED_SECRET');
    const res = await fetch(
      `https://${portalId}.hs-sites.com/hs/serverless/dashboard-data` +
      `?portalId=${portalId}&secret=${encodeURIComponent(secret)}`
    );

    // Previously a failed fetch fell through as null and rendered as zero.
    if (!res.ok) return noData(`Dashboard data unavailable (HTTP ${res.status})`);

    const raw = await res.json();
    const data = typeof raw.body === 'string' ? JSON.parse(raw.body) : raw;
    return { serverSideProps: { ...data, fetchError: null }, cacheConfig: { cacheControl: 'no-cache' } };
  } catch (err) {
    return noData(String(err));
  }
}
```

**5. Verify from outside the app**

```bash
curl -s -o /dev/null -w "%{http_code}\n" "$BASE/content-data-api"              # 404 — private
curl -s -o /dev/null -w "%{http_code}\n" "$BASE/settings-api?action=getSettings" # 404 — private
curl -s -o /dev/null -w "%{http_code}\n" "$BASE/dashboard-data?portalId=$PORTAL" # 401 — needs the key

# 401 rather than 500 is the tell: the function found its secret and rejected you.
```
