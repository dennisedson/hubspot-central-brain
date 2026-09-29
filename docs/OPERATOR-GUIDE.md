# Operator Guide — setting up and running the Central Brain

You are the driver. This walks the whole system from a fresh portal to daily use.

It assumes the tooling is installed (Node 18+, the HubSpot CLI, Obsidian, Cowork) and that
you have the repo cloned. It does **not** assume anything exists in the portal.

`README.md` covers the developer path — build, deploy, CI. This is the operator path: what a
person clicks, connects and authorises to make the thing actually run.

---

## 0. What you are switching on, and what state it's in

Be honest with yourself about this before you start, because three of these layers will
happily accept setup effort and give nothing back yet.

| Layer | What it does | Status |
|---|---|---|
| **Content spine** | Linear ↔ HubSpot ↔ Asana, Fellow → tasks | **Working.** Exercised daily, 11 records in dev |
| **Changelog** | Linear issue → Changelog record → pipeline | **Working, idle.** Wired end to end, 0 records |
| **Cards** | Task Status, Related Content, Meeting Intelligence, Enterpret Insights | **Working** |
| **Video** | YouTube OAuth, metrics sync, AI suggestions, UTM attribution | **New, unproven.** Code complete; no live Google or Anthropic call has ever been made |
| **Breeze agent tools** | Ask Breeze about your pipeline | **Blocked.** Returns UNAUTHORIZED — see `docs/walkthroughs/` |
| **Enterpret** | Friction themes on content | **Blocked.** No API key obtainable; data arrives out-of-band (#12) |
| **Social / LinkedIn** | Auto-drafted posts | **Blocked.** HubSpot Social not connected (#18) |
| **Cowork prompts** | Vault automations | **Unverified.** Nobody has watched Cowork run them |

Sections 1–3 give you the working system. Section 4 is the new Video layer. Section 6 is
what will not work no matter how correctly you set it up.

---

## 1. HubSpot portal

### 1.1 Credentials on your machine

Copy `.env.example` → `.env` and fill it in. The names matter — `src/scripts/script-env.ts`
reads them literally, and a missing one exits immediately rather than failing later.

Per portal you need `SERVICE_KEY` (private app token, the one the provisioning scripts
authenticate with), `PERSONAL_ACCESS_KEY` (for the CLI), `DEVELOPER_KEY` (the automation
actions API rejects OAuth tokens and needs this instead), and `SYNC_SECRET`.

> If provisioning returns `401`, regenerate the private app token in the portal before
> debugging anything else. An expired one reports as `expired 20705 day(s) ago` — epoch
> zero, meaning "unparseable", not "old".

### 1.2 Provision the data model

`hs project upload` deploys the app but creates none of the objects it depends on. A
deployed app against an unprovisioned portal fails on every call, with nothing explaining
why. Run these in order — all read before they write, so they are safe to re-run:

```bash
PORTAL=dev npm run provision                        # objects, pipelines, associations
PORTAL=dev npm run patch:unique-property            # unique linear_id
PORTAL=dev npm run provision:associations           # pairings provision misses (#3)
PORTAL=dev npm run provision:app-settings           # App Config object
PORTAL=dev npm run provision:asana-property
PORTAL=dev npm run provision:asana-sync-token
PORTAL=dev npm run provision:fellow-sync
PORTAL=dev npm run provision:youtube-config         # required before YouTube auth
PORTAL=dev npm run provision:enterpret-quotes
PORTAL=dev npm run provision:property-descriptions  # last — describes the rest
```

Order matters in three places: everything needs the objects from `provision`;
`asana-sync-token`, `fellow-sync` and `youtube-config` all write onto App Config;
`property-descriptions` only describes properties that already exist.

**Skipping `provision:associations` is the one that fails silently** — without it the
Related Content action 4xxs on every association call.

### 1.3 App secrets

The deployed functions read secrets from HubSpot, **not** from your `.env`. Ten exist; the
first four are required for the working system, the rest gate specific features.

> **Use `hs secrets`, not `hs app secret`.** There are two stores. `hs app secret`
> (BETA) is app-scoped and is *not* what the deploy validates against — a secret added
> there still fails the deploy as missing. Every working secret in this project lives in
> the account-level `hs secrets` store, and the deploy's own error message names it:
> "Create it by running `hs secrets add`". Check with `hs secrets list`.
>
> **All ten must exist before the app will deploy.** A secret named in a function's hsmeta
> but absent from the portal fails the *deploy*, not the build — and it fails the whole
> deploy, so one missing secret blocks every component. That is what happened on build #225.
>
> **`YOUTUBE_REFRESH_TOKEN` is a chicken-and-egg**: `youtube_auth` requires it, but
> `youtube_auth` is what produces it. Create it now with a placeholder value (`pending`),
> deploy, run the authorisation, then replace it with the real token. The code has a
> `pending_secret` connection state for exactly this window.

```bash
hs secrets add HS_ACCESS_TOKEN        # 21 functions — nothing works without it
hs secrets add LINEAR_API_KEY         # 3
hs secrets add ASANA_API_KEY          # 4
hs secrets add SYNC_SHARED_SECRET     # 3
hs secrets add LINEAR_WEBHOOK_SECRET  # inbound Linear webhook verification
hs secrets add FELLOW_API_KEY         # Fellow sync
hs secrets add ANTHROPIC_API_KEY      # Video AI suggestions
hs secrets add YOUTUBE_CLIENT_ID      # ┐
hs secrets add YOUTUBE_CLIENT_SECRET  # ├ Video — see §4
hs secrets add YOUTUBE_REFRESH_TOKEN  # ┘ placeholder first — see above
```

### 1.4 Deploy, then finish the wiring

```bash
npm run build
npx hs project upload --skip-auto-deploy
npx hs project deploy --deploy-latest-build
PORTAL=dev npm run provision:workflows      # needs the deployed actions to exist
```

### 1.5 Settings page

In the portal, open the app's settings page and pick your **Linear team** and **assignee
filter**. This writes to the App Config record, which the sync functions read at runtime.
Skip it and syncs run against an unset team.

### 1.6 Confirm it's alive

```bash
curl -s -o /dev/null -w "%{http_code}\n" \
  https://<portalId>.hs-sites.com/hs/serverless/settings-api      # expect 200
npx hs app logs --app=<appId> --type=serverless-gateway-execution --since=10m
```

Note the log type: these functions are reached through a public gateway URL, so invocations
land in `serverless-gateway-execution`. `serverless-execution` shows silence whether or not
anything ran — it is the wrong stream and will mislead you.

---

## 2. Obsidian vault

The thinking and drafting layer. It is a folder of markdown files; there is no API and no
auth.

Full walkthrough, written for someone who has never opened Obsidian:
[`vault-template/SETUP.md`](../vault-template/SETUP.md). The short version:

1. Get the template onto the machine — **the folder name becomes the vault name**, and the
   prompts build `obsidian://` links against it, so it must be exactly `Dev-Central-Brain`
   (hyphens, no spaces — a space would have to be written `%20` in the URI). No clone needed,
   and note the branch: `vault-template/` does not exist on `master`.
   ```bash
   mkdir -p ~/Dev-Central-Brain
   curl -sL https://github.com/dennisedson/hubspot-central-brain/archive/refs/heads/develop.tar.gz \
     | tar -xz --strip-components=2 -C ~/Dev-Central-Brain hubspot-central-brain-develop/vault-template
   ```
2. Obsidian → **Open folder as vault** → choose it → trust the author.
3. **Settings → Core plugins → Templates**, then set the template folder to `templates`.
4. Learn the frontmatter contract: `hubspot_id` + `hubspot_portal` at the top of a note say
   which record it is about. Leave `hubspot_id` as `""` until the record exists.

Your notes live outside git — back them up like any other folder.

---

## 3. Cowork project

Cowork is the orchestrator and, early on, the interface you actually use. It reaches
everything the serverless layer does not yet automate.

1. **Create a project** for this work.
2. **Add the vault as a connected folder**: `~/Dev-Central-Brain`. Cowork reads and writes
   the notes directly — no integration required.
3. **Connect the tools you have**: Linear, Asana, Fellow, Slack, Google Calendar. Enterpret
   too, if your account has it — that connector is currently the *only* route to Enterpret
   data (see §6).
4. **Open [`prompts/README.md`](../vault-template/prompts/README.md)** in the vault. Those
   are ready-made instructions to paste in — daily pipeline digest, weekly content planning,
   changelog-from-Linear, coverage gaps, Enterpret sync.

> **Treat the prompts as drafts.** The HubSpot ids and property names inside them are
> verified against the live portal; the phrasing and every assumption about how Cowork
> behaves with a connected folder are not — nobody has watched one run. When one is wrong,
> fix the file so the next run starts better.

---

## 4. YouTube (the Video layer)

**Read this first: none of this section has been exercised against real Google credentials.**
The code is complete and unit-tested against mocks. You will be the first person to run it,
so expect to debug it rather than to switch it on.

### 4.1 Google side

1. In Google Cloud, create (or reuse) a project and enable the **YouTube Data API v3** and
   **YouTube Analytics API**.
2. Configure the OAuth consent screen — then **check its publishing status**.

   > **A consent screen left in `Testing` expires every refresh token after 7 days.**
   > Google does this silently: no warning, no email, nothing in any log. The
   > connection simply stops working about a week after you set it up, and
   > `?action=status` keeps answering `connected` the whole time because the
   > secret still holds a token-shaped string. The only symptom is `youtube-sync`
   > returning `Token has been expired or revoked`.
   >
   > Press **Publish app** so the status reads **In production**. With YouTube's
   > sensitive scopes and no Google verification you get an "unverified app"
   > interstitial at the consent screen (Advanced → Go to …) and a 100-user cap.
   > Both are fine for a single channel — verification only removes the warning.
3. Create an **OAuth client ID** (Web application). Its redirect URI must be the deployed
   function:
   ```
   https://<portalId>.hs-sites.com/hs/serverless/youtube-auth
   ```
4. Put the client id and secret into HubSpot as `YOUTUBE_CLIENT_ID` / `YOUTUBE_CLIENT_SECRET`.

### 4.2 Authorise

`provision:youtube-config` must have run first — the flow writes connection state onto four
App Config properties, and without them a successful connection still reads as
"disconnected", silently, because HubSpot omits unknown properties rather than erroring.

The `youtube-auth` endpoint takes three actions:

| Action | Does |
|---|---|
| `authorize` | Returns the Google consent URL to open |
| `status` | Reports `connected` / `pending_secret` / `disconnected` |
| `disconnect` | Revokes the refresh token and clears the state |

Open the `authorize` URL, grant access, and Google redirects back to the callback. The
exchange yields a **refresh token** — store it as the `YOUTUBE_REFRESH_TOKEN` app secret.

A refresh token can die while everything still reports healthy — see the publishing-status
warning in §4.1. Re-authorising is the same flow as the first time: open `authorize`, grant
access, take the new refresh token, then

```bash
hs secrets update YOUTUBE_REFRESH_TOKEN   # `update`, not `add` — it already exists
```

and redeploy, because secrets are injected at deploy time.

`pending_secret` is a real state, not a bug: the channel is known and the code exchanged,
but the refresh token is not yet set, so no API call can be made. `status` will say so.

### 4.3 Sync metrics

**The schedule lives in GitHub, not in HubSpot.** `.github/workflows/youtube-sync.yml` runs it
daily on a cron and can be triggered by hand from the Actions tab.

That is not a stylistic choice. HubSpot Projects serverless has no scheduler, and a HubSpot
workflow cannot supply one either: `buildPollWorkflow` enrols with `type: MANUAL`, because there
is no cron trigger for a custom object. The three provisioned workflows named "(Daily)" are
therefore not daily — they run when something enrols a record. Do not go looking for a recurrence
setting on them; there isn't one.

`provision:workflows` still creates **YouTube → Sync Metrics** as a workflow action, so the sync
can be used as a step inside some other workflow. That was never what made it recur.

> **The scheduled Action only runs from the default branch.** GitHub runs `schedule` triggers from
> `master` alone, so the cron is inert until the workflow file is merged there. `workflow_dispatch`
> works from anywhere in the meantime.

The job asserts postconditions rather than the HTTP status: it fails on a non-empty `errors`
array, fails when `analyticsStatus` starts `failed:`, warns on `skipped:`, and warns when no Video
records are found — that last one being indistinguishable from a broken search.

The sync finds every Video record
carrying a `youtube_video_id`, fetches statistics in batches of 50, and writes `view_count`,
`like_count`, `comment_count` plus the analytics figures.

The analytics half needs a channel id, which the sync reads off `app_configs` — the value
the OAuth callback already recorded. **There is nothing to configure.** If the response
carries `"analyticsStatus": "skipped: no channel id …"`, the connection never completed; fix that
rather than setting anything by hand.

Analytics means `average_view_duration` and nothing else. `impressions` and
`click_through_rate` are not metrics of `reports.query` — requesting them returns
`400 Unknown identifier (impressions)` — so those two properties stay blank permanently.

`YOUTUBE_CHANNEL_ID` exists as a secret **override**, for pointing a sync at a channel the
callback never wrote. It is not part of setup, and it is deliberately absent from §1.3.

Verify by **postcondition, not response code**:

```bash
npx hs app logs --app=<appId> --type=serverless-gateway-execution --tail
```

### 4.4 AI suggestions

`video-ai-suggestions` takes a `recordId` and returns suggested titles, description and tags
from Claude.

**It returns them; it does not write them.** Nothing here overwrites a human's title or
description — and there is no suggestions property on the Video object to write into, so
persisting them is a real follow-up that starts with provisioning a property.

---

## 5. Daily use — the loops that actually run

**Work enters three ways.** Tag a Linear issue and the webhook upserts a Content or Changelog
record. Create a Content record by hand in HubSpot. Or let the daily Fellow sync turn meeting
action items into tasks against the right contact.

**Then the spine carries it.** Moving a Content record's stage fires *Content → Sync to Linear
+ Asana*, pushing the new state to the linked issue and task. Changes made directly in Asana
return via the daily poll.

**You watch it from the records.** A Content record shows live Linear/Asana state, related
content by tag or theme, and the friction theme behind it. A Contact shows meeting history and
what it produced.

**Cowork is where you ask questions across all of it** — the morning digest, weekly planning,
coverage gaps. That is the part you drive by hand, and it is where the system is most useful
soonest.

---

## 5b. Before you deploy to another portal — preflight

```bash
PORTAL=prod npm run preflight
```

Asserts that the target portal's live schema matches `src/app/lib/portal-config.ts`: every
object type id, every pipeline id, every stage id, and all 28 properties the app reads or
writes. Read-only — schemas, pipelines and properties, all GETs, so re-running costs nothing.

`.github/workflows/deploy-prod.yml` runs it before the upload, so a prod deploy cannot proceed
over drift.

**Why it exists.** This replaced the staging environment. Staging's one real value was catching
per-portal provisioning drift — ids and properties differ per portal, so code that works on dev
fails on prod because something was never created there. Staging never caught it: it went
unmaintained, pointed at the *real* BuildRel Asana project, and had no changelog pipeline of its
own. A check beats an environment here for one reason — it fails loudly, where a stale
environment fails silently.

It earned that on its first run against prod, reporting two faults nobody had recorded:

```
FAIL [pipeline] content/changelog has no pipelineId configured
FAIL [property] app_configs is missing: youtube_channel_id, youtube_channel_title,
     youtube_connection_status, youtube_last_sync
```

The second is the one that matters. HubSpot *omits* unknown properties rather than erroring, so
a YouTube connection would have completed successfully and then read as `disconnected` forever,
with nothing in any log.

**It does not check secrets**, deliberately. `hs project deploy` already validates those and
names the missing one; a second list that could disagree with the deploy would be worse than no
list.

**Add to `REQUIRED_PROPERTIES` in `src/scripts/preflight.ts`** whenever a property becomes
load-bearing. `youtube_url`, `source_url` and `asana_task_id` were each provisioned-but-unwritten
or read-but-absent, and every one was found by a person noticing something blank.

## 6. What will not work, however correctly you set it up

Two different things get filed here, and conflating them makes the system look worse than it
is. A **blocked** feature has no route forward. A **human-initiated** one works and is waiting
for someone to start it.

### 6.1 Blocked

- **Breeze agent tools** return `UNAUTHORIZED`. The tools deploy, publish and appear in the
  agent builder; execution is refused upstream of the code. Every action declaring
  `WORKFLOWS` works and only the three declaring `AGENTS` fail — same app, same portal, same
  build. **The decisive test is still unrun**: no Breeze tool has ever been placed in a
  workflow, so the path believed to work has never actually been exercised. That is the
  cheapest next probe.
- **Social/LinkedIn drafting** exists as a deployed action but HubSpot Social is not
  connected, and it is not enrolled in any live workflow (#18).
- **`impressions` and `click_through_rate`** are never populated. They are not metrics of the
  Analytics API's `reports.query` — asking returns `400 Unknown identifier (impressions)`.
  They live in YouTube Studio and the bulk Reporting API, a separate integration. Left
  unwritten rather than zeroed, because "zero impressions" is a claim YouTube never made.

### 6.2 Works, but somebody has to start it

Neither of these can be server-side: a HubSpot serverless function cannot reach an MCP server
and cannot write to a local disk. So the write happens from the work machine and HubSpot renders
what was stored. That is the architecture, not a shortfall.

- **Enterpret.** The read side works — `EnterpretInsightsApi` makes one CRM read and renders
  three properties, degrading gracefully on partial data. The live HTTP call was deliberately
  removed. What is missing is a *writer*: nothing populates `enterpret_theme`,
  `enterpret_quote_count` or `enterpret_quotes`. `vault-template/prompts/enterpret-sync.md`,
  run where Enterpret MCP is connected, is the only one. See `docs/enterpret-mcp-sync.md` (#12).
- **Vault promotion.** Built, never run. A note with `promote: true` becomes a `content_piece`
  at Outline, which creates both the Linear issue and the Asana task.
  `vault-template/prompts/promote-note.md` is what starts it.

An empty Enterpret card means nobody has run the sync. It is not a fault to report.
- **`provision:workflows` on an already-provisioned portal** — creating workflows on a fresh
  portal is fine; updating existing ones has a fix that has not yet been run against a live
  portal. Edit existing workflows in the UI until it is confirmed.
- **YouTube push notifications** are blocked by the platform, not by missing work.
  HubSpot's serverless gateway accepts only `application/json` bodies and YouTube's
  WebSub hub sends `application/atom+xml`, so notifications are rejected with 415
  before any code runs. Subscription and hub verification both work, which makes
  it worse: a subscription verifies, looks established, and delivers nothing.
  Metrics update on the daily poll only.

---

## Troubleshooting, by symptom

| Symptom | Likely cause |
|---|---|
| CI: `HUBSPOT_ACCOUNT_ID … is required but was not set` | Not a typo — `project-validate` reads `DEFAULT_ACCOUNT_ID` and derives that name itself. The job was missing `environment:`, and an environment secret read from a job without one resolves to an **empty string** rather than failing |
| CI: `SyntaxError: Invalid regular expression flags` | Node 18. The HubSpot CLI pulls ink → string-width, which uses the `v` regex flag from Node 20, so the module fails to parse and the CLI never runs |
| A deploy reports `[deployed]` but the endpoint serves old code | Container propagation. Build #269 needed ~75s after reporting deployed. Poll the postcondition until it flips rather than testing once |
| Provisioning script exits `401` | Private app token expired — regenerate it |
| `expired 20705 day(s) ago` | Epoch zero: the token is unparseable, not old — wrong variable or wrong token |
| Everything deploys, nothing works | Data model never provisioned — §1.2 |
| A function 500s on a secret | Secret set in `.env` instead of the `hs secrets` store — §1.3 |
| Association calls 4xx | `provision:associations` skipped |
| Property writes rejected, group error | Property group derived rather than read — it is `app_configs_information`, not `app_configsinformation` |
| YouTube says disconnected after connecting | `provision:youtube-config` not run |
| `serverless-execution` logs are empty | Wrong log stream — use `serverless-gateway-execution` |
| Agent tool returns UNAUTHORIZED | Known, unresolved — §6 |
| Deploy still says a secret is missing after you added it | Wrong store — `hs app secret` is not what the deploy checks. Re-add with `hs secrets add` and confirm via `hs secrets list` |
| Build succeeds, deploy fails on a secret | The secret is named in an hsmeta but absent from the portal. Create it, even as a placeholder — one missing secret fails the entire deploy |
| `Token has been expired or revoked` from `youtube-sync` | The refresh token is dead while `status` still says `connected`. Almost always a consent screen left in **Testing**, which expires refresh tokens after 7 days — §4.1. Publish the app, re-authorise, `hs secrets update YOUTUBE_REFRESH_TOKEN`, redeploy |
| Cannot deploy `youtube_auth` without a refresh token | Chicken-and-egg — create `YOUTUBE_REFRESH_TOKEN` as `pending`, authorise, then replace it |
