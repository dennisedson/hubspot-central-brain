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
57 episode guides (numbered 01–56, plus an `07b`) were written as features
shipped and bugs were solved.

## 3. Where things actually stand — 2026-09-30

Sources for this section: `docs/OPERATOR-GUIDE.md` §0 and §6, `docs/TEST-PLAN.md`
§7, the open issues, and the code. **This machine cannot reach either portal or
the Obsidian vault** — testing happens elsewhere — so every portal-state claim
below is sourced from a document or a commit, never from a live check.

Baseline that *is* verified here: `npm run validate` exits 0, with **999 tests
across 44 files**.

### 3.1 Works end to end

- **The content spine.** Linear issue → `content_piece` → Asana task, and stage
  changes travelling both ways. `docs/TEST-PLAN.md` §2.1–2.5 records observed
  outcomes on dev; the operator guide calls it "exercised daily, 11 records in
  dev" as of 2026-09-29.
- **Echo suppression and dedup.** `[hs-sync]` origin tags, unique `linear_id`
  with atomic upsert, and a stage-match skip. These are the oldest and
  most-tested paths in the repo (`linear-webhook.test.ts`, `hubspot-client.test.ts`).
- **The unconfigured-portal gate.** Since 2026-09-29 a portal whose settings were
  never answered syncs nothing. This was added *after* 34 unwanted Content Pieces
  reached production.
- **Assignee-first sync.** "Issues assigned to me, wherever they live" is a
  complete configuration; excluded issues are **archived, not skipped**.
- **Fellow → HubSpot Projects**, per the operator guide's status table.
- **The four record cards** — Task Status, Related Content, Meeting
  Intelligence, Enterpret Insights — render. (The Enterpret one renders whatever
  is stored, which today is nothing; see 3.3.)
- **Preflight.** `npm run preflight` asserts object type ids, pipelines, stages
  and every property the app reads or writes, and fingerprints the key in use. It
  is what replaced the staging portal.

### 3.2 Built but unverified

Treat everything here as "the code exists and has unit tests; nobody has watched
it work."

- **The Video layer.** `docs/OPERATOR-GUIDE.md` (2026-09-29) calls it "new,
  unproven — no live Google or Anthropic call has ever been made."
  `docs/TEST-PLAN.md` §3 contradicts that: it records a connected channel
  (`UCUp_0p0PFfaIEkUz5qMLLVw`) as an observed result. **These two documents
  disagree and the disagreement has not been resolved.** The daily sync has been
  on a GitHub Actions cron since 2026-09-28.
- **The 2026-09-30 settings work** — project routing UI, historical-import
  preview, unmapped-project banner. The webhook half of project routing *is*
  tested (`linear-webhook.test.ts` covers `classifyIssue` and the project map).
  The `AppSettingsApi` half — project list filtering, the unmapped merge, the
  import gate — was six commits that touched **no test file**. This is the gap
  that PR #77 was opened about.
- **Cowork prompts.** Six prompts in `vault-template/prompts/`. Marked unverified
  since the day they were written; nobody has watched Cowork execute one.
- **`provision:workflows` against an already-provisioned portal.** Creating
  workflows on a fresh portal works. Updating existing ones returned
  `400 Invalid request to flow update`; a fix was committed (`71ba6da`,
  2026-09-09) and has never been run against a live portal. Edit existing
  workflows in the UI until someone confirms it.

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
  exist. Nobody has run it end to end.

### 3.5 Things that are open but appear already done

- **Issue #21** ("Changelog pipeline ID is empty for staging and prod") is still
  open, but `src/app/lib/portal-config.ts` now carries a prod changelog pipeline
  (`940329858`) and its four stages, set by `3d3916f` on 2026-09-29. Staging no
  longer exists. Verify against the portal, then close it.
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

A `changelog_entry` object still exists on both portals holding **0 records**
each. It is vestigial and pending deletion; `provision-asana-property.ts`
already treats its absence as the expected state. Do not build on it.

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
- **`src/app/pages/SettingsApp.tsx` is the settings page.** A `type: "settings"`
  component renders nowhere for this private app; one was built and deleted
  (PR #60). HubSpot Projects allows one page per project, so the Content Command
  Center, the settings view and the Changelog Manager are three views behind one
  entry point.
- **Asana is polled, not pushed.** HubSpot strips the `X-Hook-Secret` header, so
  the push webhook could never complete handshake. `AsanaPoll` replaced it.
- **The "(Daily)" HubSpot workflows really are daily — but the schedule is not
  provisioned.** Verified on dev: both carry
  `enrollmentSchedule: {"type":"DAILY","timeOfDay":{"hour":17,"minute":0}}`.
  That is a **top-level field, separate from `enrollmentCriteria`**, whose
  `type: 'MANUAL'` describes the enrolment criteria and not the cadence —
  reading one for the other is how this was previously documented backwards.
  `provision-workflows.ts` creates these workflows **without** a schedule and
  `isEnabled: false`; the dev schedule was set by hand in the UI, and a newly
  provisioned portal needs the same (Edit → Enrollment triggers → "On a
  schedule"). The script preserves an existing schedule on re-run.

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

- **Close the test gap in `AppSettingsApi`** left by the 2026-09-30 settings
  work (§3.2). This is the highest-value thing an incoming session can do.
- **Verify the 2026-09-30 settings UI on a live portal.** Five of the last ten
  settings commits were fixes for a view that would not render at all.
- **Resolve the video-layer contradiction** between the operator guide and the
  test plan (§3.2), and make one of them right.
- **Rotate every credential before go-live** — issue #17, still open and still a
  blocker. Every key in `.env` has been used from a personal machine.
- **Close or re-verify issue #21** (§3.5).
- **Run the vault promotion path once**, end to end, and record the result.
- **Delete `changelog_entry` from both portals** once someone confirms 0 records.
- **Decide the Breeze probe**: put one tool in a workflow, or formally drop it.

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
   report 999+ tests across 44+ files. If it is already red, that is the task.
5. **Branch off `develop`.** Never work on `develop` or `master` directly, and
   never push to a branch whose PR is already merged.
6. **Write the failing test first.** Every behaviour change ships with a test;
   every bug fix starts with a test you have watched fail.
7. **Remember what this machine cannot do.** It cannot reach either portal, the
   Obsidian vault or the local `.env` — those live on the testing machine. Do not
   assert portal state you have not been shown; mark it unverified instead.
8. **When you finish something**, write the episode guide (`CLAUDE.md` says how)
   and add a dated entry to `CHANGELOG.md`.
