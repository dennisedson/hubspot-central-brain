## 🎬 YouTube Episode Guide: Five Failures Between a Green Deploy and a Working App

**🎯 Core Learning Objective:**
"By the end of this video, you will know why a successful deploy to a fresh HubSpot portal tells you almost nothing about whether the app works — and how to read five failures that each point somewhere other than their cause."

**⏱️ The 10-Minute Script Outline:**

*   **Hook & Demo (0:00 - 1:00):**
    Open on green. The deploy succeeded. The preflight passed 12 of 12. `curl` against every endpoint returns `200`. The project page says **Ready**.

    Then the one screen that disagrees: the portal, saying **Not installed**.

    Say the thesis plainly: *"Every signal I had was green, and the app did not exist in the portal. This video is about five failures in a row where the error message pointed somewhere other than the problem."*

*   **The Architecture (1:00 - 3:00):**
    Before the failures, the thing that explains most of them: **a HubSpot Projects app has four separate credential stores**, and which one is broken determines which half of the system lies to you.

    Draw it:
    - `hs secrets` — read by the deployed functions at runtime
    - local `.env` — read by provisioning scripts
    - GitHub environment secrets — read by CI
    - the app's own install grant — read by the UI extensions

    The consequence is the useful part: **the functions never see the service key, and the provisioning scripts never see the runtime token.** So a dead service key breaks provisioning and CI while every endpoint keeps answering `200`. And an uninstalled app removes the cards and settings page while leaving the functions perfectly healthy, because they authenticate with a secret that has nothing to do with installation.

    That is why "curl returns 200" felt like proof and proved nothing.

*   **Step-by-Step Implementation (3:00 - 8:00):**

    **Failure 1 — Deploying is not installing (3:00 - 4:15).**
    Show the Distribution tab: **Not installed**, beside a deployed build. `auth.type: static` in the manifest means the app must be explicitly installed. Nothing in the deploy says so, and nothing in our docs mentioned it — no `install-app`, no `app-install-status`, not a sentence.

    **Failure 2 — which surfaced as a YouTube error about Linear (4:15 - 5:15).**
    The best one. Authorising YouTube failed with:

    ```
    Error creating app_settings. Some required properties were not set.
    "properties": ["linear_team_id"]
    ```

    Walk the chain backwards on screen: app not installed → no settings page → no way to set the Linear team → no App Config record → the YouTube callback tries to *create* one → rejected for a required Linear property. **Five links between symptom and cause, and the error names the last one.**

    **Failure 3 — a deactivated standard object (5:15 - 6:00).**
    The install itself failed with "Something went wrong while installing the app" — no code, no scope, nothing. The Projects object was **deactivated** on that portal. A scope against a deactivated object cannot be granted, and one unfulfillable scope fails the whole install without naming itself. Developer sandboxes have everything switched on; real portals do not.

    **Failure 4 — the invalidated service key (6:00 - 7:00).**
    Then provisioning started returning `401 Authentication credentials not found`, which reads as *you sent no token*. The token was present and correct; it had been silently invalidated.

    Teach the diagnostic, because it is one command: **run the same check against the other portal.** Dev passing while prod 401s isolates it to the credential instantly. Same code, same endpoint, different key.

    **Failure 5 — rotating it in one place (7:00 - 8:00).**
    Rotate the key, update `.env`, local preflight goes green. Trigger the deploy — CI still `401`s. The GitHub environment secret still held the dead key.

    The lesson generalises: **a credential with two homes and no link between them will be updated in one.** And the local success actively misleads, because it looks like proof the rotation worked.

*   **Testing & Wrap-up (8:00 - 10:00):**
    Two things to take away.

    **Verify the postcondition that matters, not the nearest green thing.** "The deploy succeeded" is not "the app is installed." "`curl` returns 200" is not "the app works." Each of these is a real signal about something *adjacent* to the question being asked.

    **When an error names a component that makes no sense, believe the nonsense.** A YouTube flow complaining about `linear_team_id` was not a red herring — it was an accurate report from five links down a dependency chain. The instinct to dismiss it as unrelated is what costs the afternoon.

    Close on what we changed: the operator guide now documents installation, the credential table, and Projects activation as a prerequisite — because every one of these was a gap in the docs before it was a failure in the portal.

**💻 Screen-Ready Code Snippets:**

**1. The check that a green deploy does not perform**

```bash
npx hs project app-install-status   # deployed ≠ installed
npx hs project install-app
```

**2. Which credential lives where** — the table from `docs/OPERATOR-GUIDE.md` §1.1a

```
hs secrets (account-level)    → the deployed functions, at runtime   HS_ACCESS_TOKEN
local .env                    → provisioning scripts and preflight   HUBSPOT_<PORTAL>_SERVICE_KEY
GitHub environment secrets    → CI: preflight and deploys            HUBSPOT_<PORTAL>_SERVICE_KEY
the app's install grant       → the UI extensions (cards, settings)  —
```

**3. The one-command diagnosis for a dead key**

```bash
PORTAL=dev  npm run preflight   # All 12 check(s) passed
PORTAL=prod npm run preflight   # 401 INVALID_AUTHENTICATION
# Same script, same endpoint. The variable is the credential.
```

**4. Why the callback could not recover**

```ts
// writeYouTubeConfig falls through to a create when no record exists — and the
// create can never succeed on a portal where linear_team_id is required, since
// the YouTube flow has no business knowing a Linear team id.
const existing = await findAppConfigRecord(objectTypeId, token);
const method = existing ? 'PATCH' : 'POST';
```

**5. The scope asymmetry that is easy to get backwards**

```
app-hsmeta.json requiredScopes   → what runs at RUNTIME. No schema writes at all.
the service key's private app    → a SUPERSET. Provisioning writes schemas and
                                   properties, including on Projects, so it also
                                   needs project-object-write.
```
