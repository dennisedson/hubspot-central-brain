# Project context

**Read this before you start work.** It exists because this repo is worked from
more than one machine, by more than one agent, and a session that starts cold
re-opens settled decisions and rebuilds things that already exist. That has cost
real damage: on 2026-09-30 a settings rebuild shipped 333 lines with **zero new
tests** — the suite sat at 999 before and after — because the rules lived in one
machine's chat history instead of in the repo.

This document is orientation and current state. It does **not** explain how the
system works internally — that is [`ARCHITECTURE.md`](ARCHITECTURE.md), and it
is the other file to read before changing sync behaviour. The rules you must
follow while working are in [`../CLAUDE.md`](../CLAUDE.md).

Everything below is checkable. Where something could not be verified from this
machine it says so.

---

## 1. What this project is

A **HubSpot Projects app** — serverless functions, custom workflow actions, UI
extensions and provisioning scripts — that makes a HubSpot portal the system of
record for developer-relations content. Internally it is "the Central Brain".

It connects:

| System | Direction | Mechanism |
|---|---|---|
| **Linear** | both ways | webhook in (`LinearWebhook`), workflow action out (`SyncToLinear`) |
| **Asana** | both ways | workflow action out (`SyncToAsana`), polling back (`AsanaPoll`) |
| **Fellow** | in | `FellowSync` — meeting action items become HubSpot Projects |
| **YouTube** | in | `YouTubeSync` — daily metrics onto `video` records |
| **Enterpret** | in, out-of-band | CRM read only; nothing server-side writes the data |
| **Anthropic** | out | `ChangelogDraft` (the Changelog Draft card) and `VideoAiSuggestions` |
| **Obsidian vault** | out | local markdown, driven by Cowork prompts in `vault-template/prompts/` |

The HubSpot side is one custom object doing most of the work — `content_piece`,
carrying **two pipelines** (content and changelog) — plus `video` and a single
settings record (`app_configs` on dev, `app_settings` on prod).

Two portals, and only two: **dev `51869810`**, **prod `22047910`**.

## 2. Who it is for, and what it solves

One developer-relations operator (Dennis, at HubSpot) whose work is scattered
across five trackers. An idea starts in a note, becomes a Linear issue, becomes
an Asana task for the content team, produces a video, and generates a changelog
entry — and until this app existed, none of those knew about each other. There
was no single place to answer "what is in flight, and where is it stuck?"

The bet is that the CRM is that place: pipelines already model stages,
associations already model relationships, and workflow actions already model
"when this moves, do that." So the trackers stay where the people are, and the
portal holds the joined-up view.

Secondary, and the reason for `docs/walkthroughs/`: the build itself is content.
Episode guides are written as features ship and bugs are solved —
`docs/walkthroughs/README.md` indexes them and says which ones later changes have
overtaken. **There is one gap:** nothing between PR #79 and PR #109 — the whole of
2026-10-01, 31 merged PRs — has a guide. The run picks up again at 57.

## 3. Where things actually stand — 2026-10-20

Sources for this section: the code, the merged PRs, and **read-only checks of
both portals made on 2026-10-20** from the machine with `.env` — schema lists,
workflow states, deployed actions, properties. Where a claim is older and was not
re-checked, it says so. The Obsidian vault lives on the other machine and was not
checked.

Baseline: `npm run validate` exits 0 with **1,322 tests across 67 files** on
`feat/youtube-daily-in-hubspot` (1,142 across 55 on 2026-10-02; 999 across 44 on
2026-09-30).

Portal state, checked 2026-10-20:
- **Prod `22047910`** was deployed twice that day (#129, #135), so it carries the
  rollup doc links (#128), the provisioning fix (#130) and the `SyncToLinear`
  team fix (#133). **All eight Central Brain workflows on prod are switched
  off**, so HubSpot → Linear/Asana sync does not run there; Linear → HubSpot
  (the webhook) does.
- **`changelog_entry` is gone from both portals.**
- **Dev `51869810`** has its workflows on, except the two dailies created that
  day — *Changelog Rollup Docs* and *YouTube → Sync Metrics* — which are off and
  unscheduled.

### 3.1 Works end to end

- **The content spine — on dev.** Linear issue → `content_piece` → Asana task,
  and stage changes travelling both ways. `docs/TEST-PLAN.md` §2.1–2.5 records
  observed outcomes on dev. **On prod only the Linear → HubSpot half runs**: the
  workflows that carry stage changes back out are off (above). They can be
  switched on as they are — operator guide §1.8.
- **Echo suppression and dedup.** `[hs-sync]` origin tags, unique `linear_id`
  with atomic upsert, and a stage-match skip. These are the oldest and
  most-tested paths in the repo (`linear-webhook.test.ts`, `hubspot-client.test.ts`).
- **The unconfigured-portal gate.** Since 2026-09-29 a portal whose settings were
  never answered syncs nothing. This was added *after* 34 unwanted Content Pieces
  reached production.
- **Assignee-first sync.** "Issues assigned to me, wherever they live" is a
  complete configuration; excluded issues are **archived, not skipped**.
- **Fellow → HubSpot Projects**, per the operator guide's status table — but
  **that status is now in doubt.** The credential probe added in PR #93 found
  every path on `api.fellow.app` answering `404` with an HTML page, the root
  included, and prod's `fellow_last_sync` has never been set (PR #104). Nobody
  has guessed a replacement URL; that needs someone who knows whether the
  integration still exists. Treat Fellow as unverified until it is re-probed.
- **The app settings surface.** Since 2026-10-01 the settings form is reachable
  at Connected apps → the app → **Settings**, as well as from the Content
  Command Center. One implementation, two entrances — see §4 for why the file
  exists twice and which copy is editable. Issue #88, PRs #100–#102.
- **The five record cards** — Linear / Asana Status, Related Content, Enterpret
  Insights and Changelog Draft on `content_piece`, Meeting Intelligence on
  Contacts, plus YouTube on `video` — render. (The Enterpret one renders
  whatever is stored, which today is nothing; see 3.3.)
- **Changelog drafting.** Two prompts in version control, a Changelog Draft card
  on the record, and per-portal model and thinking settings. Defaults are Sonnet
  with thinking **off** because HubSpot kills an app function at 20 seconds and
  Opus with adaptive thinking does not reliably finish. PRs #87, #89, #94, #96.
- **Rollout milestone dates.** Parsed from `notes` into `rollout_*` properties,
  with the pipeline board ordering each column by the next milestone. Epoch zero
  (`1970-01-01`) is treated as no date. PRs #105, #108, #109.
- **A credential health check, on demand.** `PORTAL=prod npm run health` asks
  the `app-health` function to probe every external credential from inside the
  app. It found two things nothing else would have (§3.2). It used to run daily
  from `credential-health.yml`; #125 removed that because the prod job sat behind
  the deploy approval gate and fourteen runs queued unreported.
- **Preflight.** `npm run preflight` asserts object type ids, pipelines, stages
  and the 45 properties in its `REQUIRED_PROPERTIES` list — `rollout_*`,
  changelog drafting and `changelog_rollup` included — and fingerprints the key in
  use. It is what replaced the staging portal. Prod passed all 13 checks on
  2026-10-20.

### 3.2 Built but unverified

Treat everything here as "the code exists and has unit tests; nobody has watched
it work."

- **The Video layer.** The contradiction this section used to record is
  **resolved, in the test plan's favour.** `docs/OPERATOR-GUIDE.md` said on
  2026-09-29 that "no live Google or Anthropic call has ever been made";
  `docs/TEST-PLAN.md` §3 recorded a connected channel
  (`UCUp_0p0PFfaIEkUz5qMLLVw`) as an observed result. Both calls have since
  demonstrably happened, and both left evidence:
  - **Anthropic** was reached for real by the changelog draft card, which is how
    `ANTHROPIC_API_KEY` was discovered to be invalid in `.env` and on both
    portals at once (PR #93). The replacement key authenticates on prod.
  - **Google** answered the credential probe, and the answer was that **prod's
    YouTube refresh token is dead** — `{"error":"invalid_grant"}` (PR #104). The
    second time that has happened; see the consent-screen trap in
    `OPERATOR-GUIDE.md` §4.1.

  **No daily sync runs on either portal right now.** It was a GitHub Actions
  cron from 2026-09-28 — dev only, hours late, and calling `/youtube-sync` with
  no secret. On 2026-10-20 it became the *YouTube → Sync Metrics (Daily)*
  workflow, behind the shared secret (§4); that workflow is off on both portals,
  and prod's must stay off until its token is re-authorised.
- **The 2026-09-30 settings work** — project routing UI, historical-import
  preview, unmapped-project banner. **The test gap is closed.** PR #82
  ("test(settings): cover the project routing work, and fix what it exposed")
  covered the `AppSettingsApi` half — project list filtering, the unmapped
  merge, the import gate — in `src/app/__tests__/app-settings-api.test.ts`, and
  PR #80 fixed the batching bug those tests exposed (83 issues selected, 33
  imported, reported as success). PR #77 is merged.
- **Cowork prompts.** Six prompts in `vault-template/prompts/`. Marked unverified
  since the day they were written; nobody has watched Cowork execute one.
- **`provision:workflows` against an already-provisioned portal — confirmed on
  dev 2026-10-20, and fixed.** The `400 Invalid request to flow update` fix
  (`71ba6da`) holds: every PUT landed, and `isEnabled` and the daily schedules
  survived. But the first run also rewrote two things — `linearTeamId` to the
  `'any'` sentinel on both sync workflows, which broke HubSpot → Linear sync,
  and `actionTypeVersion` from 75 to 0 on three others. Dev was restored from a
  snapshot; `src/scripts/flow-actions.ts` now carries both over from the live
  flow, and a re-run on dev diffed **identical** across all 9 workflows. Not yet
  run on prod.
- **Rollup doc links** (#128, deployed to both portals 2026-10-20). Monthly
  changelog rollups are Linear releases; the webhook and a daily sweep put each
  rollup's Google Doc and name on my entries in it. `changelog_rollup` is
  provisioned on both portals and the action is deployed on both. Unit-tested end
  to end, and the Linear queries were run read-only against the workspace — but
  three things are unobserved: an `Issue` webhook carrying `releases` (if it does
  not, the sweep still delivers within a day), the first live run of *Changelog
  Rollup Docs (Daily)* (exists on dev, off; not yet created on prod), and a doc
  on October's release, which had none. Operator guide §4b.
- **Workflow-action authentication.** Every action URL is public. Four actions
  check the shared secret end to end — the two sync actions, rollup docs and
  related content — and since 2026-10-20 the YouTube sync makes five. Seven do
  not yet, each named with its reason in `NOT_YET_AUTHENTICATED` in
  `workflow-actions.test.ts`, which also stops a new one joining them. None calls
  Anthropic; the cost of an unauthenticated call is a triggered sync or a write.

### 3.3 Paused or blocked — do not spend time here without new information

- **Breeze agent tools**, since **2026-09-09**. The three tools deploy, publish
  and appear in the agent builder, then refuse to execute:
  `The requesting portal is not authorized to execute tool`. Every action
  declaring `WORKFLOWS` works; only the three declaring `AGENTS` fail — same app,
  same portal, same build. **The decisive test is still unrun**: no Breeze tool
  has ever been placed in a workflow, so the path believed to work has never
  actually been exercised. That is the cheapest next probe. Issue #23.
- **Enterpret** (#12). No API key is obtainable. The read side works and the live
  HTTP call was deliberately removed. What is missing is a *writer* — and it
  cannot be server-side, because a HubSpot serverless function cannot reach an
  MCP server. `vault-template/prompts/enterpret-sync.md` is the only writer. An
  empty Enterpret card means nobody has run the sync; it is not a fault.
- **Social / LinkedIn** (#18). The action is deployed but HubSpot Social is not
  connected and it is enrolled in no live workflow.
- **YouTube push notifications.** Blocked by the platform. HubSpot's serverless
  gateway accepts only `application/json`; YouTube's WebSub hub sends
  `application/atom+xml` and is rejected `415` before any code runs. Subscription
  and hub verification both succeed, which makes it look wired. Metrics update on
  the daily poll only.
- **`impressions` and `click_through_rate`.** Not metrics of the YouTube
  Analytics `reports.query` surface — asking returns
  `400 Unknown identifier (impressions)`. Left unwritten rather than zeroed.

### 3.4 Built and never run

- **Vault promotion.** A note with `promote: true` becomes a `content_piece` at
  Outline, which fans out to both Linear and Asana. The code, the prompt
  (`vault-template/prompts/promote-note.md`) and the test plan step (§6.4) all
  exist. Nobody has run it end to end. **On a portal whose sync workflow carries
  `linearTeamId: 'any'` — prod — it cannot create the Linear issue**: since
  2026-10-20 `SyncToLinear` answers `no_team_for_create` rather than failing.
  A real team on the action, or a "team for new issues" setting, would fix it.

### 3.5 Issue tracker versus reality

- **Issue #21** ("Changelog pipeline ID is empty for staging and prod") **was
  closed** as completed on 2026-10-01. `src/app/lib/portal-config.ts` carries the
  prod changelog pipeline (`940329858`) and its four stages, set by `3d3916f`.
  Issue **#17** ("Rotate all credentials before go-live") was also closed on
  2026-10-01 — it is no longer the go-live blocker §5 used to call it.
- **Issue #88** ("Can a private app get a Settings tab?") is still open but is
  answered: yes, and it renders. The implementation shipped in PRs #100–#102.
  What remains is the last checkbox on the issue — recording the answer in
  `ARCHITECTURE.md`, now done in its §3 — and deciding whether a component that
  deploys `DONE` to a surface that does not exist is worth raising as a
  platform/DX bug.
- **Issue #78** (content containers and lineage) is still open, but its rollup
  half is superseded: digests are Linear releases (#128). The
  video-series half still stands.
- **Issues #23–#34 and #62** are Phase 5 — explicitly post-MVP. They are a
  backlog, not work in progress.

---

## 4. Decisions already made — do not reopen these

Each of these was decided against a real alternative. Reopening one costs a day
and lands back in the same place. If you believe one is wrong, say so explicitly
and bring new evidence; do not quietly re-litigate it in code.

### Staging was removed, in favour of feature branches — 2026-09-29

There were three portals. Staging pointed at the **real production Asana
project** — same project, same sections — while having no changelog pipeline of
its own. An environment nobody keeps current does not merely fail to help; it
gives false confidence and becomes somewhere wrong-portal writes can originate.

The one thing staging could uniquely have caught is per-portal provisioning
drift, and the replacement for that is `npm run preflight` — a check that fails
loudly before a prod deploy, not a third portal that fails silently.

The model now: **feature branch off `develop` → PR into `develop` → `develop`
deploys to dev → merge to `master`, then trigger Deploy › Prod by hand.**
Production never deploys on push. Commit `c4383b0`, PR #37, episode 53.

### A changelog is a second pipeline on `content_piece`, never its own object

A changelog *is* content. Separate objects meant duplicate properties, duplicate
associations and routing complexity for no benefit. The workflow actions
distinguish the two with an `objectType: 'content' | 'changelog'` input field,
never by which HubSpot object they were called from.

This was decided on 2026-08-26 (`ab353d7`, episode 15) — **and re-decided on
2026-09-30**, when `351b42d` routed changelog issues to a separate custom object
and `8008340` reverted it five minutes later. If you find yourself adding an
`objectTypeId` per pipeline, you are repeating that afternoon.

The `changelog_entry` object is **gone from both portals** (checked 2026-10-20).
Do not bring it back.

### Digests are Linear releases — 2026-10-20, membership amended 2026-10-26

A digest is a release in Linear's *Monthly Changelog Rollups* pipeline — a
monthly rollup (`October 2026 Changelog Rollup`) or a Spotlight
(`Spring 2027 Spotlight`) — owned by whoever writes it, with its Google Doc
linked on the release. Membership arrives on the issue webhook, so HubSpot needs
no digest record and no association label for it — the rollup half of the
containers design (#78) is superseded.

**Every release in that pipeline counts, matched by the pipeline's id.** It was
the name pattern until 2026-10-26, which left Spotlight issues showing no release;
the operator chose the whole pipeline over a separate "all releases" property,
accepting that an issue in both a monthly rollup and a Spotlight gets neither
(skipped and reported). The release's doc overrides whatever an entry holds; only
a rollup release's doc is ever cleared. Spec
`docs/superpowers/specs/2026-10-20-rollup-doc-link-design.md`.

### Scheduled work is a HubSpot "(Daily)" workflow, not a GitHub cron — 2026-10-20

HubSpot workflows run on a schedule: the cadence is the top-level
`enrollmentSchedule`, separate from `enrollmentCriteria`, whose `type: 'MANUAL'`
says which records enrol. Misreading one for the other put the YouTube sync on a
GitHub cron for three weeks — dev only, hours late, and calling its endpoint with
no secret. A daily workflow covers every portal, logs where the rest of the app
logs, and posts with the shared secret. The cost: the schedule and the on switch
are set by hand in the UI after `provision:workflows`, and a run that "succeeds"
with nothing done shows as green — read the output fields. `npm run health` is
deliberately on demand rather than scheduled (#125).

### Ideas stay local. Outline is the single threshold.

The vault *is* the idea stage. A thought that lives in your tracker makes the
tracker a list of maybes, so nothing below Outline leaves your machine — no
Linear issue, no Asana task, no CRM record.

Promotion to **Outline** is one threshold that creates **both** the Linear issue
and the Asana task. Two separate thresholds would produce a record with an issue
and no task, and no way to tell whether that was the rule working or the Asana
call failing. Commits `438a193` / `19633fa` / `4bef303`, 2026-09-28, episode 52.

### HubDB was evaluated and deferred — issue #62

`app_configs` is a CRM custom object holding both configuration and sync state.
That was never a considered choice against alternatives; it was the only
writable, portal-scoped persistence a serverless function has without leaving
the platform. HubDB is plausibly better, and issue #62 records the reasoning,
the two failures it would have prevented, and the four things to check first
(scopes, tier, write latency on hot paths, migration). **It is recorded as a
decision for next time, not a task.** Not an MVP change.

### Smaller ones, same standing

- **`linear_team_id` uses the sentinel `'any'`**, not `''`, because it is the
  object's primary display property and HubSpot will not let one be cleared.
  Read it through `isAnyTeam()` — `'any'` is truthy.
- **The settings form has two entrances and one editable copy.** This bullet
  used to read "a `type: "settings"` component renders nowhere for this private
  app" — true of the portal on 2026-09-29, when the app's entry showed Overview
  and Insights, and **false since the platform's tabs became Overview /
  Settings / App cards.** The surface works (PR #100). Both
  `pages/SettingsApp.tsx` and `settings/SettingsPage.tsx` render
  `LinearSettingsForm`; `pages/LinearSettingsForm.tsx` is the only copy anyone
  edits and `settings/LinearSettingsForm.tsx` is generated by
  `npm run sync:settings-form`, because HubSpot bundles each extension directory
  in isolation and an import cannot leave one. `ARCHITECTURE.md` §3 has the
  detail. HubSpot Projects still allows one *page* per project, so the Content
  Command Center, the settings view and the Changelog Manager remain three views
  behind one page entry point.
- **Asana is polled, not pushed.** HubSpot strips the `X-Hook-Secret` header, so
  the push webhook could never complete handshake. `AsanaPoll` replaced it.
- **The "(Daily)" HubSpot workflows really are daily — but the schedule is not
  provisioned.** See the scheduling decision above. `provision-workflows.ts`
  creates every workflow **without** a schedule and `isEnabled: false`; set both
  by hand (operator guide §1.8). The script preserves them on re-run — and since
  2026-10-20 it also preserves each action's team id and version.
- **Merges into `master` are merge commits, never squash** — promotions and the
  repairs alike. `CLAUDE.md` → Process has why; it went wrong three times in one
  day (#131, #129) before it was written down.

---

## 5. Direction

### What "shippable MVP" means here

The MVP is **the content spine, running on production, driven by one operator's
real work** — not feature completeness. Concretely, all of:

1. Prod provisioned and preflight-clean, with settings saved so `isConfigured`
   is true before the Linear webhook is registered.
2. A Linear issue creating a `content_piece` and an Asana task, stage changes
   travelling in both directions, and nothing echoing.
3. The changelog pipeline carrying real records rather than being wired and idle.
4. The operator able to configure the app from the settings page without help —
   team or assignee, project routing, and a historical import that previews
   before it writes.
5. Every behaviour in that path covered by a test.

Everything else — video, Breeze, Enterpret, social, goals, AEO — is Phase 5 and
is tracked as such (#23–#34, #62).

### What remains before it

As of 2026-10-20. The first item is the one that stands between prod and MVP
point 2.

- **Turn on prod's workflows.** All eight are off, so stage changes do not leave
  HubSpot on prod. The two sync workflows can go on as they are — their
  `linearTeamId: 'any'` stopped mattering for stage syncs on 2026-10-20 — and so
  can the Asana poll (schedule it first) and the two Associate workflows. Operator
  guide §1.8 lists each, with what to leave off and why.
- **Create and schedule *Changelog Rollup Docs (Daily)* on prod**
  (`PORTAL=prod npm run provision:workflows` — safe to re-run since #130), and
  attach the digest's Google Doc to `October 2026 Changelog Rollup` in Linear.
- **Re-authorise YouTube on prod.** The refresh token is dead
  (`invalid_grant`, PR #104) and `?action=status` will keep answering
  `connected` while a token-shaped string sits in the secret. Operator guide
  §4.1–§4.2; publish the consent screen first or it will die again in 7 days.
  Only then turn on prod's *YouTube → Sync Metrics (Daily)*.
- **Find out whether Fellow still exists.** Every path on `api.fellow.app`
  404s with HTML and prod has never set `fellow_last_sync` (§3.1). Either a URL
  changed or the integration is gone; both need a person, not a guess.
- **Authenticate the seven remaining workflow actions** named in
  `NOT_YET_AUTHENTICATED` (§3.2), the Breeze three once their call shape is
  known. Each is a secret check in the function, a `sharedSecret` input on the
  action, and a field in `provision:workflows`; the test then makes them leave
  the list.
- **Run the vault promotion path once**, end to end, and record the result —
  and decide where a new issue's team comes from on an `'any'` portal (§3.4).
- **Decide the Breeze probe**: put one tool in a workflow, or formally drop it.
- **Write the missing episode guides** for 2026-10-01 (#79–#109), or record the
  gap as permanent (§2).

Done since 2026-10-02, for the avoidance of re-doing it: preflight now covers the
`rollout_*`, drafting and rollup properties; `changelog_entry` is gone from dev;
`provision:workflows`' update path is confirmed and fixed (#130); the dashboard's
public endpoints became one secret-gated door (#127); the YouTube sync left
GitHub. Earlier: the `AppSettingsApi` test gap (PR #82), the settings UI on a
live portal (PRs #100–#102), credential rotation (#17), issue #21.

---

## 6. Before you start — checklist

1. **Read** [`../CLAUDE.md`](../CLAUDE.md) (the rules, the traps, the process),
   this file, [`ARCHITECTURE.md`](ARCHITECTURE.md) if you are touching sync
   behaviour, and the top two or three dated entries of
   [`../CHANGELOG.md`](../CHANGELOG.md).
2. **Check what changed since this file was written.**
   `git log --oneline -30` and `gh pr list --state all --limit 20`. If the log
   disagrees with §3, the log wins — and fix §3.
3. **Confirm your intended direction against §4.** If your plan contradicts a
   decision there, stop and say so before writing code.
4. **Run `npm run validate` before you change anything.** It must exit 0 and
   report at least the count in §3 (1,322 across 67 files on 2026-10-20). If it
   is already red, that is the task. It does **not** prove the project will
   build — run `npm run build` too, and see `CLAUDE.md`.
5. **Branch off `develop`.** Never work on `develop` or `master` directly, and
   never push to a branch whose PR is already merged.
6. **Write the failing test first.** Every behaviour change ships with a test;
   every bug fix starts with a test you have watched fail.
7. **Know what your machine can reach.** Portal access needs `.env` with the
   portal keys; on 2026-10-20 the development machine had one and reached both
   portals, where until then only the testing machine did. The Obsidian vault is
   on the testing machine. Do not assert portal state you have not checked —
   read-only checks are cheap (`npm run preflight`, the schema and flow listings);
   mark anything else unverified. Writes to a portal want the user's say-so.
8. **When you finish something**, write the episode guide (`CLAUDE.md` says how)
   and add a dated entry to `CHANGELOG.md`.
