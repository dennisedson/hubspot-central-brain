## 🎬 YouTube Episode Guide: The Door You Forgot You Opened

**🎯 Core Learning Objective:**
"By the end of this video, you will know how to audit every serverless function in your HubSpot app for accidental public exposure, close the ones nothing calls by URL, and write a test that stops them from creeping back open — without breaking the callers that genuinely need a URL."

**⏱️ The 10-Minute Script Outline:**

*   **Hook & Demo (0:00 - 1:00):**
    "This one line in a config file published my app's AI endpoint to the open internet. Anyone with the URL could spend my Anthropic credits."

    Show the terminal. `curl` a `changelog-draft` endpoint with no auth header — it answers. Then show the fix: one field deleted, `curl` returns 404, and the CRM card that uses it still loads live data. Seven functions closed, zero features broken.

    The punchline to promise: the audit found that two of the functions I was about to close had a caller I'd forgotten about, and closing them would have silently broken a page.

*   **The Architecture (1:00 - 3:00):**
    Plain English, no code yet. A HubSpot app function has two possible front doors:

    1. **The public URL** — you get one by declaring `endpoint` in the function's hsmeta. It publishes to `https://<portal>.hs-sites.com/hs/serverless/<path>`. There is **no authentication on it at all**. Anyone who knows the path can call it.
    2. **The private call** — `hubspot.serverless('<uid>')`, available inside UI extensions. HubSpot routes it internally and authenticates it as the logged-in user.

    The trap: most templates give you an `endpoint`, so you keep it, and you never notice that your cards were using the private door the whole time. The public door is left standing open with nothing walking through it.

    So the audit question is simply: **for each function, does any caller actually use the URL?** Draw the four kinds of caller that genuinely do — workflow actions (they POST to an `actionUrl`), third-party webhooks, OAuth redirects, and anything rendering server-side where `hubspot.serverless()` doesn't exist.

    That last one is the twist. Foreshadow it.

*   **Step-by-Step Implementation (3:00 - 8:00):**

    **Step 1 — Inventory every door (3:00 - 4:15).**
    Open the terminal. Run the one-liner that prints each function and whether it publishes an endpoint. Twenty-five functions, twenty-five endpoints. Point at the screen: "every single one."

    **Step 2 — Find who actually calls by URL (4:15 - 5:45).**
    Two greps. First, every `hubspot.serverless()` call — these are uid callers, and they do **not** need an endpoint. Second, grep the whole repo for each endpoint's path string to find URL callers.

    This is the step that saves you. In my repo the second grep turned up a CMS theme — `src/theme/.../Dashboard/index.jsx` — calling two of my functions from `getServerSideProps`. That runs on HubSpot's render servers, where `hubspot.serverless()` does not exist, so those two **must** stay public. Say the lesson out loud: *grep the whole repo, not just the extension folder.*

    **Step 3 — Write the ratchet test before touching anything (5:45 - 7:00).**
    Open the new test file. The shape is an allowlist keyed by uid, where the value is the reason. Explain why a reason string beats a bare array: a stale entry outlives its caller, and the next person reads it as permission.

    Run it. Watch it fail with the list of unjustified endpoints. **That failing list is your work order.**

    **Step 4 — Delete the field (7:00 - 8:00).**
    Show one hsmeta before and after. Four lines gone. Re-run the test — green. Emphasise that nothing in the function's code changed; only how it can be reached.

*   **Testing & Wrap-up (8:00 - 10:00):**
    Deploy, then verify the postcondition rather than the exit code. `curl` each closed path — 404. `curl` a control that should still be open — 200.

    **Show the method-mismatch gotcha**, because it nearly fooled me: a `POST`-only endpoint answers a `GET` with 404 whether or not it exists. If you verify with the wrong verb you'll "prove" a door is closed that is standing wide open. Re-run with `-X POST` to be sure.

    Then open the CRM record and show the card still loading Linear and Asana data through the private door.

    Summary: an `endpoint` is a public URL with no auth; UI extensions never need one; grep the whole repo before closing anything; and lock the result with an allowlist test so it can't regress.

**💻 Screen-Ready Code Snippets:**

**1. Inventory — which functions publish a public URL?**

```bash
for f in src/app/functions/*-hsmeta.json; do
  python3 -c "
import json; d = json.load(open('$f')); c = d.get('config', {})
print(f\"{d['uid']:<34} {'PUBLIC: ' + c['endpoint']['path'] if 'endpoint' in c else 'private'}\")"
done
```

**2. Who calls by uid (needs no endpoint) vs. by URL (needs one)?**

```bash
# Private callers — these are fine without an endpoint.
grep -rho "serverless([[:space:]]*['\"][a-z_]*" --include="*.tsx" src/app/ \
  | sed "s/.*['\"]//" | sort -u

# URL callers — grep the WHOLE repo. This is the step that catches the
# CMS theme, the workflow actionUrls, and the OAuth redirect.
grep -rn "changelog-draft" --exclude-dir=node_modules . | grep -v -- "-hsmeta.json"
```

**3. The one-field change**

```diff
  {
    "uid": "changelog_draft_api",
    "type": "app-function",
    "config": {
      "entrypoint": "/app/functions/ChangelogDraft.js",
-     "endpoint": {
-       "path": "changelog-draft",
-       "methods": ["GET", "POST"]
-     },
      "secretKeys": ["HS_ACCESS_TOKEN", "ANTHROPIC_API_KEY"]
    }
  }
```

Nothing else changes. The card keeps working, because it never used the URL:

```ts
const result = await hubspot.serverless('changelog_draft_api', {
  parameters: { action: 'source', objectId },
});
```

**4. The ratchet test**

```ts
/**
 * An `endpoint` publishes a function at a public URL with no authentication.
 * A function may have one only if a caller named here needs the URL.
 */
const PUBLIC_BY_DESIGN: Record<string, string> = {
  sync_to_linear:  'workflow-action actionUrl',
  youtube_auth:    'Google redirects the browser here after OAuth consent',
  linear_webhook:  'Linear POSTs here',
  content_data_api:'CMS dashboard theme fetches /content-data-api',
  // ...one line per exception, each naming its caller
};

it('no function publishes an endpoint without a documented caller', () => {
  const unjustified = allFunctions()
    .filter(fn => fn.config?.endpoint)
    .map(fn => fn.uid)
    .filter(uid => !(uid in PUBLIC_BY_DESIGN));

  expect(unjustified).toEqual([]);
});

// A stale allowlist is how exposure creeps back: the entry outlives the
// caller, and the next person reads it as permission.
it('every allowlist entry names a function that still exists', () => {
  const uids = new Set(allFunctions().map(fn => fn.uid));
  expect(Object.keys(PUBLIC_BY_DESIGN).filter(u => !uids.has(u))).toEqual([]);
});
```

**5. Verify the postcondition — with the right verb**

```bash
BASE=https://<portalId>.hs-sites.com/hs/serverless

# Closed doors.
curl -s -o /dev/null -w "%{http_code}\n" "$BASE/changelog-draft"        # 404

# A POST-only endpoint 404s on GET whether or not it exists —
# always re-check with the verb it actually declares.
curl -s -o /dev/null -w "%{http_code}\n" -X POST "$BASE/video-ai-suggestions"   # 404

# The control that must stay open.
curl -s -o /dev/null -w "%{http_code}\n" -X POST "$BASE/breeze-content-pipeline" # 200
```
