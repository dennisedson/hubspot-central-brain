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

> **All ten must exist before the app will deploy.** A secret named in a function's hsmeta
> but absent from the portal fails the *deploy*, not the build — and it fails the whole
> deploy, so one missing secret blocks every component. That is what happened on build #225.
>
> **`YOUTUBE_REFRESH_TOKEN` is a chicken-and-egg**: `youtube_auth` requires it, but
> `youtube_auth` is what produces it. Create it now with a placeholder value (`pending`),
> deploy, run the authorisation, then replace it with the real token. The code has a
> `pending_secret` connection state for exactly this window.

```bash
hs app secret add HS_ACCESS_TOKEN        # 21 functions — nothing works without it
hs app secret add LINEAR_API_KEY         # 3
hs app secret add ASANA_API_KEY          # 4
hs app secret add SYNC_SHARED_SECRET     # 3
hs app secret add LINEAR_WEBHOOK_SECRET  # inbound Linear webhook verification
hs app secret add FELLOW_API_KEY         # Fellow sync
hs app secret add ANTHROPIC_API_KEY      # Video AI suggestions
hs app secret add YOUTUBE_CLIENT_ID      # ┐
hs app secret add YOUTUBE_CLIENT_SECRET  # ├ Video — see §4
hs app secret add YOUTUBE_REFRESH_TOKEN  # ┘ placeholder first — see above
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

1. Copy the template out of the repo — **the folder name becomes the vault name**, and the
   prompts build `obsidian://` links against it, so it must be exactly `Dev- Central-Brain`
   (hyphen after `Dev`, space before `Central`):
   ```bash
   cp -R vault-template/ ~/"Dev- Central-Brain"
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
2. **Add the vault as a connected folder**: `~/Dev- Central-Brain`. Cowork reads and writes
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
2. Configure the OAuth consent screen.
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

`pending_secret` is a real state, not a bug: the channel is known and the code exchanged,
but the refresh token is not yet set, so no API call can be made. `status` will say so.

### 4.3 Sync metrics

Point a daily workflow at `youtube-sync`, or call it directly. It finds every Video record
carrying a `youtube_video_id`, fetches statistics in batches of 50, and writes `view_count`,
`like_count`, `comment_count` plus the analytics figures.

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

## 6. What will not work, however correctly you set it up

Do not spend an afternoon on these expecting a result.

- **Breeze agent tools** return `UNAUTHORIZED`. The tools deploy, publish and appear in the
  agent builder; execution is refused upstream of the code. Every action declaring
  `WORKFLOWS` works and only the three declaring `AGENTS` fail — same app, same portal, same
  build.
- **Enterpret** has no obtainable API key. The property and card exist; data has to arrive
  through Cowork's connector rather than a live call (#12).
- **Social/LinkedIn drafting** exists as a deployed action but HubSpot Social is not
  connected, and it is not enrolled in any live workflow (#18).
- **`provision:workflows` on an already-provisioned portal** — creating workflows on a fresh
  portal is fine; updating existing ones has a fix that has not yet been run against a live
  portal. Edit existing workflows in the UI until it is confirmed.
- **The whole Video layer** is untested against live credentials. It is written, not proven.

---

## Troubleshooting, by symptom

| Symptom | Likely cause |
|---|---|
| Provisioning script exits `401` | Private app token expired — regenerate it |
| `expired 20705 day(s) ago` | Epoch zero: the token is unparseable, not old — wrong variable or wrong token |
| Everything deploys, nothing works | Data model never provisioned — §1.2 |
| A function 500s on a secret | Secret set in `.env` instead of `hs app secret` — §1.3 |
| Association calls 4xx | `provision:associations` skipped |
| Property writes rejected, group error | Property group derived rather than read — it is `app_configs_information`, not `app_configsinformation` |
| YouTube says disconnected after connecting | `provision:youtube-config` not run |
| `serverless-execution` logs are empty | Wrong log stream — use `serverless-gateway-execution` |
| Agent tool returns UNAUTHORIZED | Known, unresolved — §6 |
| Build succeeds, deploy fails on a secret | The secret is named in an hsmeta but absent from the portal. Create it, even as a placeholder — one missing secret fails the entire deploy |
| Cannot deploy `youtube_auth` without a refresh token | Chicken-and-egg — create `YOUTUBE_REFRESH_TOKEN` as `pending`, authorise, then replace it |
