## 🎬 YouTube Episode Guide: Expired 20,705 Days Ago — When an Auth Error Lies About What's Wrong

**🎯 Core Learning Objective:**
"By the end of this video, you will know how to read an authentication error that is actively misleading you — using the shape of the error rather than its wording — and how to prove that a 'safe to re-run' script is genuinely idempotent by running it against a portal that is already provisioned."

**⏱️ The 10-Minute Script Outline:**

*   **Hook & Demo (0:00 – 1:00):**
    Put the error on screen and read it aloud: *"The OAuth token used to make this call expired 20705 day(s) ago."* Twenty thousand days is roughly fifty-six years. Then show the `expire time` field: `1970-01-01T00:00:00Z`. Nothing expired. That is the Unix epoch, which is what you get when a timestamp is computed from a token the server could not decode. The credential was not old — it was the **wrong variable**. This episode is about the general skill: when an error's *content* is nonsense, stop reading the words and start reading the shape.

*   **The Architecture (1:00 – 3:00):**
    Plain English on why this class of bug is so good at hiding. A config loader hands out several credentials — a personal access key for the CLI, a private-app token for the API, a developer key for a third family of endpoints. They are all opaque strings on the same object, so grabbing the wrong one is a one-word mistake that typechecks perfectly. The failure surfaces far away, inside a vendor SDK, wearing the costume of an expired credential. And the natural response — "I'll regenerate the token" — produces a brand-new credential that fails *identically*, which then convinces you the problem is somewhere else entirely. Explain the tell: an expiry of epoch zero means "could not parse," never "expired."

*   **Step-by-Step Implementation (3:00 – 8:00):**

    *   **Step 1 — Separate the credential from the caller (3:00 – 4:30).** Before touching any script, prove the credential independently with the dumbest possible call — `GET /crm/v3/owners?limit=1` with a bearer header. It returns 200. The credential is fine. That single result reassigns the entire investigation from "bad token" to "bad usage," and it takes fifteen seconds.

    *   **Step 2 — Diff how each script authenticates (4:30 – 6:00).** The money move. Loop over every script and print which field it destructures from the shared loader. Twelve scripts, ten reaching for `token`, two reaching for `personalKey`. The two outliers are exactly the two that fail. Emphasize the technique over the finding: when some callers work and others don't, tabulate the difference mechanically instead of reading them one at a time.

    *   **Step 3 — Watch the fix expose a second bug (6:00 – 7:15).** Point both scripts at `token` and re-run. They now succeed — and one of them creates a brand-new custom object, because it had been provisioning `app_settings` while the app reads `app_configs`. The auth bug had been *masking* a naming drift. Show the sharper failure underneath: two downstream scripts resolve that object with a single `find()` across both names, taking whichever the API lists first. With both present, they write to the wrong object and exit 0. Fix it by preferring the canonical name explicitly, never by relying on array order.

    *   **Step 4 — Know when to stop patching (7:15 – 8:00).** The last script 400s with "required field: type". Add it — and the error becomes a generic "Invalid request." Try carrying the whole GET response through; identical failure. At this point you have proven the rejected part is the nested payload, not the field list, and you are out of cheap information. Commit the verified half, record the evidence at the call site, warn in the README, and stop. Shipping a documented broken step beats shipping a blind guess that looks fixed.

*   **Testing & Wrap-up (8:00 – 10:00):**
    The real proof of idempotency is running the whole sequence against a portal that is **already** provisioned and seeing every step report a no-op — "already exists," "nothing to do," "0 descriptions updated." A script that is safe to re-run says so out loud on every line. Verify the three settings-dependent scripts all resolve to the same objectTypeId your config maps, then close on the theme: an error message is a hypothesis authored by someone who could not see your code. Treat it as evidence, not as a diagnosis.

**💻 Screen-Ready Code Snippets:**

**The error that lies — epoch zero means "unparseable", not "expired":**
```json
{
  "category": "EXPIRED_AUTHENTICATION",
  "message": "The OAuth token used to make this call expired 20705 day(s) ago.",
  "context": { "expire time": ["1970-01-01T00:00:00Z"] }
}
```

**Step 1 — clear the credential in fifteen seconds:**
```bash
curl -s -o /dev/null -w "%{http_code}\n" \
  -H "Authorization: Bearer $HUBSPOT_DEV_SERVICE_KEY" \
  https://api.hubapi.com/crm/v3/owners?limit=1
# 200  → the credential is fine; the caller is wrong
```

**Step 2 — tabulate how every caller authenticates:**
```bash
for f in src/scripts/provision-*.ts; do
  printf "%-38s " "$(basename $f)"
  grep -oE 'const \{[^}]*\} = loadEnv\(\)' "$f" | sed 's/const //;s/ = loadEnv()//'
done
# provision-app-settings.ts     { personalKey, portal }   ← the two that fail
# provision-asana-property.ts   { personalKey }
# provision-objects.ts          { token }                 ← the ten that work
```

**The one-word fix:**
```diff
-  const { personalKey } = loadEnv();
-  const client = new Client({ accessToken: personalKey });
+  const { token } = loadEnv();
+  const client = new Client({ accessToken: token });
```

**Step 3 — never let array order pick your object:**
```ts
// Before: returns whichever the API happened to list first.
const appSettings = schemas.results.find(
  s => s.name === 'app_configs' || s.name === 'app_settings',
);

// After: prefer the canonical name, explicitly.
const appSettings =
  schemaList.find(s => s.name === 'app_configs') ??
  schemaList.find(s => s.name === 'app_settings');
```

**What idempotency actually looks like when you prove it:**
```
– linear_id already exists (hasUniqueValue=true)
– Content Piece ↔ Video — definition already exists
– app_configs already exists - nothing to create.
– asana_sync_token already exists, skipping
– enterpret_quotes already exists — nothing to do
  0 description(s) updated.
```
