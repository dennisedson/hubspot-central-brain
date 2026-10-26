# Operator Guide — setting up and running the Central Brain

You are the driver. This walks the whole system from a fresh portal to daily use.

It assumes the tooling is installed — **Node 20+**, the HubSpot CLI, Obsidian, Cowork — and
that you have the repo cloned. It does **not** assume anything exists in the portal.

> **Node 20, not 18.** The CLI pulls ink → string-width, which uses the `v` regex flag
> introduced in Node 20, so on 18 the module fails to parse and the CLI never starts:
> `SyntaxError: Invalid regular expression flags`. This guide said "Node 18+" until
> 2026-10-02.

`README.md` covers the developer path — build, deploy, CI. This is the operator path: what a
person clicks, connects and authorises to make the thing actually run.

---

## 0. What you are switching on, and what state it's in

Be honest with yourself about this before you start, because several of these layers will
happily accept setup effort and give nothing back yet.

Last reviewed against the code, the merged PRs and both portals on **2026-10-20**.

| Layer | What it does | Status |
|---|---|---|
| **Content spine** | Linear ↔ HubSpot ↔ Asana | **Working on dev.** On prod, Linear → HubSpot runs (the webhook), but **HubSpot → Linear/Asana does not: all eight prod workflows are switched off** (checked 2026-10-20). They can be turned on as they are — §1.8 |
| **Digest doc links** | Each digest's release name and Google Doc, from Linear, on your entries in it | **Working on prod.** The webhook has been writing them since 2026-10-20; a one-off sweep on 2026-10-26 filled the Spring Spotlight entries. The daily workflow exists on both portals but is off — §1.8, §4b |
| **Fellow → tasks** | Meeting action items become HubSpot Projects | **In doubt.** Every path on `api.fellow.app` now answers `404` with an HTML page, including the root, and prod has never set `fellow_last_sync`. Found by the credential probe, not yet diagnosed — §6.3 |
| **Changelog** | Linear issue → Changelog record → pipeline | **Working, carrying records.** 70 changelog records on prod, and the drafting prompts measured against them |
| **Changelog drafting** | Draft a post or a digest entry from the record, with Claude | **Working.** Card on the record, prompts in version control, model and thinking selectable — §4b |
| **Rollout dates** | Milestone dates parsed from the Linear description, board sorted by the next one | **Working.** `rollout_*` properties; `1970-01-01` treated as unset |
| **Cards** | Linear / Asana Status, Related Content, Enterpret Insights, Changelog Draft (Content), Meeting Intelligence (Contacts), YouTube (Video) | **Working** |
| **App settings surface** | Settings reachable from Connected apps → the app → **Settings** | **Working since 2026-10-01.** This guide previously said it did not exist; the platform's tabs changed — §1.5 |
| **Video** | YouTube OAuth, metrics sync, AI suggestions, UTM attribution | **Partly proven.** Live Google and Anthropic calls have both now been made. Dev is connected; **prod's refresh token is dead** (`invalid_grant`) and needs re-authorising — §4.2. The daily sync is a HubSpot workflow since 2026-10-20, off on both portals — §4.3 |
| **Credential health** | Probe of every external credential, from inside the app | **Working, on demand.** `PORTAL=prod npm run health`. Its daily cron was removed in #125 — §1.7 |
| **Breeze agent tools** | Ask Breeze about your pipeline | **Blocked.** Returns UNAUTHORIZED — see `docs/walkthroughs/` |
| **Enterpret** | Friction themes on content | **Blocked.** No API key obtainable; data arrives out-of-band (#12) |
| **Social / LinkedIn** | Auto-drafted posts | **Blocked.** HubSpot Social not connected (#18) |
| **Cowork prompts** | Vault automations | **Unverified.** Nobody has watched Cowork run them |

Sections 1–3 give you the working system. Section 4 is the Video layer and 4b is changelog
drafting. Section 6 is what will not work no matter how correctly you set it up.

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
PORTAL=dev npm run provision:changelog-drafting     # rollout dates, draft + prompt properties
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
hs secrets add HS_ACCESS_TOKEN        # 25 components — nothing works without it
hs secrets add LINEAR_API_KEY         # 4
hs secrets add ASANA_API_KEY          # 5
hs secrets add SYNC_SHARED_SECRET     # 7
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

### 1.5 Settings — two entrances, one form

Pick your **Linear team** and **assignee filter**. This writes to the App Config record,
which the sync functions read at runtime. Skip it and syncs run against an unset team —
and in fact sync nothing at all, because an unanswered portal is treated as inert.

Either entrance works and both render the same form:

1. **Connected apps → HubSpot Central Brain → Settings**
2. **Content Command Center → ⚙ Settings** (this one has a Back link)

> This guide said on 2026-09-29 that the first of those did not exist, on the grounds
> that a `type: "settings"` component renders nowhere for a private app. That was a
> correct reading of the portal at the time — the app's entry had Overview and Insights
> and no Settings tab. **The platform's tabs are now Overview / Settings / App cards**
> and the component renders. Issue #88, PRs #100–#102.
>
> The form is also where you set the **changelog drafting prompts, model and thinking**
> (§4b).

### 1.6 Confirm it's alive

Open the settings form (§1.5). If its Linear team and assignee lists fill, the functions are
deployed and can reach Linear. Then the credentials, which is §1.7.

**Do not curl `settings-api` to check.** It answered 200 until 2026-10-15; since #126/#127 it
publishes no URL — the form calls it by uid — so a curl answers 404 by design. Only functions
with a named caller in `function-endpoints-are-justified.test.ts` keep a public URL: workflow
actions, webhooks, the Breeze tools, `app-health` and the dashboard's `dashboard-data`.

```bash
npx hs app logs --app=<appId> --type=serverless-gateway-execution --since=10m
```

Note the log type: workflow actions and webhooks reach their functions through the public
gateway, so those invocations land in `serverless-gateway-execution`. `serverless-execution`
showed silence for them whether or not anything ran — the wrong stream, and misleading.

### 1.7 Confirm the credentials are alive, not just present

`npm run preflight` (§5b) checks *structure* — object ids, pipelines, stages, properties.
A revoked key passes every one of its checks. Three credentials have died silently on this
project: the HubSpot service key (a day to diagnose), the YouTube refresh token, and
`ANTHROPIC_API_KEY`, which was invalid in `.env` **and on both portals at once**.

So the app probes its own credentials. Ask it:

```bash
PORTAL=prod npm run health      # or PORTAL=dev
```

That posts to the public `app-health` function with the portal's `SYNC_SECRET` from `.env`
and prints each check. The function returns **200 even when degraded** — a non-2xx would be
indistinguishable from the endpoint being down — so the script reads `.checks[]`, not the
status code. `unconfigured` means the credential is not set on that portal, which is not a
failure.

**It runs when you run it.** A daily `credential-health.yml` did this until #125 removed it
on 2026-10-15: its prod job declared `environment: Prod` to reach the secret, inherited the
deploy approval gate, and fourteen runs queued behind a reviewer while the job's absence from
the failure list read as "all clear". Run `npm run health` before trusting a quiet portal.

The endpoint requires the shared secret because it is public and every probe costs a real
third-party call — unauthenticated, anyone could spend this portal's Anthropic credits.

### 1.8 Turn the workflows on

`provision:workflows` creates every workflow **switched off**, and the "(Daily)" ones with **no
schedule**. Nothing runs until you turn it on, and a daily runs only once it has a schedule:
**Edit → Enrollment triggers → "On a schedule" → Daily, 17:00**, then turn it on. Re-running
the script keeps both.

As of 2026-10-20, all eight on prod are off. What each is safe to switch on:

| Workflow | Turn on? |
|---|---|
| Content / Changelog → Sync to Linear + Asana | **Yes.** Both carry `linearTeamId: 'any'`, which is fine for stage syncs since 2026-10-20 — `SyncToLinear` asks each issue for its team. A note promoted from the vault would get `no_team_for_create` instead of a Linear issue until a real team is set on the action |
| Asana → Poll for Stage Changes (Daily) | **Yes.** Schedule it first |
| Content / Video → Associate Related Content | **Yes** |
| Changelog Rollup Docs (Daily) | **Yes**, once it exists on the portal (`provision:workflows` after a deploy) — §4b |
| YouTube → Sync Metrics (Daily) | **Only once the portal's YouTube token is alive** — §4.2. Prod's is dead, so it would fail daily |
| Fellow → Sync Action Items to Tasks (Daily) | **Not yet.** Every Fellow path answers 404 — §6.3 |
| Content → Generate LinkedIn Draft | Pointless until HubSpot Social is connected (#18) |

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

**Read this first, and note that it replaces what this section said on 2026-09-29.** It
claimed none of this had ever been exercised against real Google credentials. That is no
longer true, and `docs/TEST-PLAN.md` §3 was the document that had it right:

- **Dev is connected.** Channel `UCUp_0p0PFfaIEkUz5qMLLVw`, recorded as an observed
  result in the test plan.
- **Prod's refresh token is dead.** The credential probe got
  `{"error":"invalid_grant","error_description":"Bad Request"}` on 2026-10-01 — the second
  time this has happened. Re-authorise it (§4.2), and publish the consent screen first
  (§4.1) or it will die again in seven days.
- **No daily sync runs on either portal right now.** The GitHub cron that synced dev was
  replaced on 2026-10-20 by the *YouTube → Sync Metrics (Daily)* workflow, which is off on
  both (§4.3). Turn prod's on only after re-authorising, or it fails every day.

The card rendering (test plan §5) still has never been run by anyone.

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

**Daily: the *YouTube → Sync Metrics (Daily)* workflow.** Schedule it and switch it on (§1.8)
once the portal's YouTube token is alive. **By hand: the Sync button on the Video card**, for
one record or the whole portal.

The two use two doors. The card calls `youtube_sync` by uid, privately. The workflow posts to
`youtube_sync_action` at `/youtube-sync`, which refuses a call without the shared secret —
`provision:workflows` fills in the workflow's `sharedSecret` field.

> **Until 2026-10-20 the daily sync was a GitHub Actions cron**, `youtube-sync.yml`. It was
> put there on the belief that HubSpot has no scheduler, read off `type: 'MANUAL'` in the
> workflows' `enrollmentCriteria` — which describes **which records enter**, not the cadence.
> The cadence is `enrollmentSchedule`, a separate top-level field; dev's Asana and Fellow
> dailies carry `{"type":"DAILY","timeOfDay":{"hour":17,"minute":0}}` and run (PR #85). The
> cron outlived the correction: it synced dev only, ran hours late (≈15:30 against 09:00), and
> called `/youtube-sync` with no secret because the function checked none.

What the cron did well, and the workflow does not: it **failed loudly on a sync that
"succeeded" with nothing done**. In the workflow, a sync that cannot authenticate or reach
YouTube answers 500 and shows as a failed action; one that finds zero Video records answers
200 with `recordsFound: 0` in its output fields — look there, not just at the green tick.

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

## 4b. Changelog drafting

On a Content record in the changelog pipeline, the **Changelog Draft** card drafts the post
conversationally. Two modes, chosen by you rather than inferred: **standalone** (a change
that earns its own announcement) and **rollup** (an entry inside a monthly digest, where the
digest owns the title, teaser and call to action).

Run `PORTAL=<portal> npm run provision:changelog-drafting` first. It adds `changelog_draft`
and `changelog_draft_mode` to `content_piece`, the `rollout_*` date properties, and the
prompt/model settings to App Config. Safe to re-run.

### The 20-second ceiling is the thing to know

**HubSpot kills an app function at 20 seconds.** Observed, not documented:

```
[runServerlessFunction] The serverless function 'changelog_draft_api' timed out.
Task timed out after 20.00 seconds.
```

There is no timeout field in a function's hsmeta, so it cannot be raised, and
`hubspot.fetch`'s configurable timeout is the extension's patience with the request — not the
function's permission to keep running. The function gives itself a 16s budget so it can return
a useful error of its own instead of being cut off mid-sentence with a generic RequestId.

That makes generation speed a correctness concern rather than a nicety, and it is why the
defaults are what they are:

| Setting | Default | Why |
|---|---|---|
| `changelog_model` | **Sonnet** (`claude-sonnet-5-5`) | Fast enough to finish a standalone post inside 20s. Opus demonstrably is not — the first turn succeeded and the follow-up timed out |
| `changelog_thinking` | **off** | Thinking happens *before* any output appears, so it is the worst thing to spend the budget on. It also bills as output |

Opus and Haiku stay selectable from the settings form; Opus fits comfortably for the
two-to-four-sentence rollup entries. Cost is not the reason for the defaults — a realistic
month is under a dollar on any of the three. Model ids are pinned exactly, never to an alias,
so a model moving under this feature would show up in a diff.

### The prompts

Both live in `src/app/lib/changelog-prompts.ts`, in version control, so a wording change shows
up in a diff rather than being discovered from its output. The settings form can override
either per portal, and **an empty override means "use the shipped default"** — that is
deliberate, so a portal that has not customised its wording keeps receiving improvements.
Writing the current default into the property would freeze that portal at today's text
silently.

Drafts are stored in `changelog_draft`, **never in `notes`**. `notes` holds the Linear issue
description and is rewritten on every webhook, so anything a person wrote there would be
destroyed the next time the issue moved.

### Digest doc links — from the Linear release

Digests are **Linear releases** in the *Monthly Changelog Rollups* pipeline — the monthly rollups
and the Spotlights. Put an issue in one and its entry here gets `changelog_rollup` set to the
release name — so "everything in October", or in Spring Spotlight, is one filter — and, once the
release links a Google Doc, `changelog_doc_url` set to it. Add **Changelog Rollup** to the board's
cards to see it there (board view → view configuration → **Card settings** → **Card contents**).

- **Attach the digest's Google Doc to the release** in Linear, as a link. Whoever owns the
  digest can do it; it only has to happen once per month.
- **The release's doc wins.** It replaces whatever the entry held, including a doc made with
  Create Doc. The old value is in the property's history.
- **Moving an issue to next month's release** moves the name, and clears the old month's doc
  until the new release has one.
- **Every release in the pipeline counts**, Spotlights included. An issue in two of them at once —
  say October and Spring Spotlight — gets neither, and is reported instead. A release with two
  Google Docs linked sets the name but no doc.
- **Only your entries are touched.** Issues in the release that belong to someone else never
  become records here.

The link usually lands within seconds, from the Linear webhook. What the webhook cannot see —
the doc being attached after the issues, or a release completing and rolling its unfinished
issues forward — is caught by the **Changelog Rollup Docs (Daily)** workflow. The link reaches
the Asana task the next time the entry changes stage, as Create Doc links do.

**Setting it up on a portal, in this order** — the property must exist before the code writes it:

1. `PORTAL=<portal> npm run provision:changelog-drafting` — adds `changelog_rollup`.
2. Deploy.
3. `PORTAL=<portal> npm run provision:workflows` — creates *Changelog Rollup Docs (Daily)*,
   disabled and unscheduled. Edit → Enrollment triggers → "On a schedule", then turn it on.
   It also re-sends every existing workflow through the update path. Since 2026-10-20 that
   keeps each action's live team id and version, and a re-run on dev changed nothing
   (`PROJECT-CONTEXT.md` §3.2). If it prints `⚠ … linearTeamId is 'any'`, that workflow
   already held the sentinel. Stage syncs still work — they use each issue's own team — but a
   note promoted from the vault cannot create a Linear issue until that action has a real team.
4. `npm run preflight`.

Each run reports in the workflow's history: `syncStatus` is `ok`, `partial` (out of time — the
next run finishes) or `error` (a read failed and nothing was written, or a write failed partway
— `detail` says which), with counts and, in `detail`, every entry it deliberately left alone and
why.

---

## 5. Daily use — the loops that actually run

**Work enters three ways.** Tag a Linear issue and the webhook upserts a Content or Changelog
record. Create a Content record by hand in HubSpot. Or let the daily Fellow sync turn meeting
action items into tasks against the right contact — once Fellow answers again (§6.3).

**Then the spine carries it** — on a portal whose workflows are switched on (§1.8). Moving a
Content record's stage fires *Content → Sync to Linear + Asana*, pushing the new state to the
linked issue and task. Changes made directly in Asana return via the daily poll.

**You watch it from the records.** A Content record shows live Linear/Asana state, related
content by tag or theme, and the friction theme behind it. A Contact shows meeting history and
what it produced.

**Cowork is where you ask questions across all of it** — the morning digest, weekly planning,
coverage gaps. That is the part you drive by hand, and it is where the system is most useful
soonest.

---

## 5c. Install the app — deploying is not installing

**A deployed project is not an installed app, and nothing in the deploy tells you so.**

`app-hsmeta.json` declares `auth.type: static`, and a static-auth app has to be explicitly
installed into the target account. Until it is, the project shows **Ready** with a deployed
build while the portal shows **Not installed**.

```bash
npx hs project app-install-status   # check
npx hs project install-app
```

Or in the portal: **Projects → the project → the app → Distribution → Install now**.

**What works without it, and what does not.** The serverless functions answer perfectly well —
they authenticate with the `HS_ACCESS_TOKEN` secret you set by hand, which has nothing to do
with installation. So `curl` against any endpoint returns 200 and everything looks live.

The **UI extensions do not exist** until the app is installed: no CRM cards, and no app settings
page.

**Why that cascades further than it looks.** The settings page is the only way to set
`linear_team_id`, which is a *required* property on the App Config object. No settings page means
no App Config record. And the YouTube OAuth callback writes the connected channel onto that
record — finding none, it tries to create one, and the create is rejected:

```
Error creating app_settings. Some required properties were not set.
"properties": ["linear_team_id"]
```

So an uninstalled app surfaces as a YouTube authorisation failure complaining about a Linear
property. Install first, set the Linear team second, authorise YouTube third.

## 5b. Before you deploy to another portal — preflight

```bash
PORTAL=prod npm run preflight
```

Asserts that the target portal's live schema matches `src/app/lib/portal-config.ts`: every
object type id, every pipeline id, every stage id, and the 30 properties listed in
`REQUIRED_PROPERTIES` (11 on Content, 9 on Video, 10 on App Config). Read-only — schemas,
pipelines and properties, all GETs, so re-running costs nothing.

> **That list is behind the code.** None of the `rollout_*` properties, `changelog_draft`,
> `changelog_draft_mode` or the drafting settings are in it, and `rollout_priority_date` is
> load-bearing — the pipeline board orders every column by it. A portal missing them passes
> preflight and then sorts on nothing. See the rule two paragraphs down, which this is
> currently in breach of.

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
- **YouTube push notifications** are blocked by the platform, not by missing work.
  HubSpot's serverless gateway accepts only `application/json` bodies and YouTube's
  WebSub hub sends `application/atom+xml`, so notifications are rejected with 415
  before any code runs. Subscription and hub verification both work, which makes
  it worse: a subscription verifies, looks established, and delivers nothing.
  Metrics update on the daily poll only.

### 6.3 Newly in doubt — needs a person, not a guess

- **Fellow.** The credential probe added on 2026-10-01 found **every** path on
  `api.fellow.app` answering `404` with an HTML page, the root included, and prod has
  **never** set `fellow_last_sync`. An HTML body from an API host usually means the base
  URL moved or the API is gone — a different problem from a rejected credential, and one
  that must not be answered by guessing a replacement URL. Until someone establishes
  whether the Fellow integration still exists, treat the "Fellow → tasks" row in §0 as
  unverified rather than working. `fellow-client.ts` is what the probe mirrors.
- **Prod's YouTube refresh token** is dead (`invalid_grant`) and `?action=status` will keep
  answering `connected` while a token-shaped string sits in the secret — §4.2.

---

## Troubleshooting, by symptom

| Symptom | Likely cause |
|---|---|
| YouTube auth fails with `Error creating app_settings … ["linear_team_id"]` | The app is not installed, so there is no settings page, so no App Config record exists for the callback to update — §5c |
| CI: `HUBSPOT_ACCOUNT_ID … is required but was not set` | Not a typo — `project-validate` reads `DEFAULT_ACCOUNT_ID` and derives that name itself. The job was missing `environment:`, and an environment secret read from a job without one resolves to an **empty string** rather than failing |
| `SyntaxError: Invalid regular expression flags` from any `hs` command | Node 18. The HubSpot CLI pulls ink → string-width, which uses the `v` regex flag from Node 20, so the module fails to parse and the CLI never runs. Use Node 20+ |
| `settings form is STALE — run: npm run sync:settings-form` | You edited `src/app/settings/LinearSettingsForm.tsx`, which is generated. Move the change to `src/app/pages/LinearSettingsForm.tsx` and re-run the sync |
| A card times out with a generic RequestId and no error of ours | The 20-second app-function ceiling — §4b. Not raisable; there is no timeout field in an hsmeta |
| The Settings tab is blank or errors | A cross-directory import. HubSpot bundles each extension directory alone, so `settings/` cannot import from `pages/` — the file is generated into `settings/` instead |
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
