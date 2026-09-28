# End-to-end test plan

A script for driving the Central Brain by hand and deciding, for each piece,
whether it works. Every expected result below was observed on the dev portal —
these are recorded outcomes, not predictions.

Setup instructions live in [`OPERATOR-GUIDE.md`](OPERATOR-GUIDE.md). This
assumes setup is done and asks a different question: **does it work?**

---

## Before you start

**Read section 7 first.** Four things are known-broken. Filing them as bugs
wastes your afternoon and everyone else's.

**Keep the log stream open in a second terminal.** It is the only place that
reliably tells the truth when something looks wrong:

```bash
npx hs app logs --app=49103173 --type=serverless-gateway-execution --tail
```

Note the type. `serverless-execution` is the wrong stream and shows silence
whether or not anything ran — it has misled people on this project before.

**Record results as you go.** A blank in the outcome column is a result too.

| Test | Outcome | Notes |
|---|---|---|
| 1.1 – 7.x | | |

---

## 1. Environment

### 1.1 The app is deployed and answering

```bash
curl -s -o /dev/null -w "%{http_code}\n" \
  https://51869810.hs-sites.com/hs/serverless/settings-api
```

**Expect** `200`.
**If not** — nothing else in this plan will pass. Check the latest deploy
succeeded before continuing.

### 1.2 The data model exists

Open **Settings → Data Management → Objects → Custom Objects**.

**Expect** exactly four. The UI lists objects by their **plural label**, not the
internal name the API uses, so you are looking for:

| Shown in the UI | Internal name (what the code uses) |
|---|---|
| Content Pieces | `content_piece` |
| Changelog Entries | `changelog_entry` |
| Videos | `video` |
| App Configs | `app_configs` |

**Fail signal** — a fifth object, **App Settings**, alongside App Configs. Those
are not interchangeable: the app reads `app_configs`, and a stray `app_settings`
shadows it in two provisioning scripts.

### 1.3 Settings are configured

Open the app's settings page.

**Expect** a Linear team and assignee filter already selected.
**Why it matters** — the sync functions read these at runtime. Unset means syncs
run against no team and quietly do nothing useful.

---

## 2. Content spine

This is the oldest and most exercised path. If anything here fails, treat it as
a regression rather than a new-feature problem.

### 2.1 Linear issue creates a Content record — and the Asana task

Tag a Linear issue with the configured label. **Put the issue in `Todo`, not
`Backlog`, and check that before you start.**

The state is not incidental — it decides half of what this test expects.
`Todo` maps to **Outline**, and Outline is the threshold at which work fans out
into Asana. `Backlog` maps to **Idea**, and nothing is created at Idea: no
Asana task, and no Linear issue in the other direction either. An issue tagged
in Backlog therefore produces a Content record and *no task*, which is correct
behaviour and looks exactly like the Asana sync being broken.

More happens here than the name suggests. The webhook creates the record *with a
pipeline stage already set*, and the sync workflow enrols on any
`hs_pipeline_stage` change with a known value — which the initial set satisfies.
So the whole chain fires immediately, without anyone touching a stage.

**Expect** a Content record in HubSpot within a minute, carrying
`linear_issue_url` and a hidden `linear_issue_id`.
**Expect the stage to match the Linear state, not to start at Idea.** The
webhook maps it on creation: Backlog → Idea, Todo → Outline, In Progress →
Drafting, In Review → Review, Done → Published, Canceled → Archived. An issue
in Todo therefore appears in **Outline**, which is correct. Anything unmapped
falls back to Idea.
**Expect** a **task in Asana**, created by that same enrolment — because the
issue is in `Todo` and the record therefore landed at Outline.
**Expect** `asana_task_url` on the HubSpot record. That write-back is a separate
call after the create, and it is the proof the two are linked.
**Fail signal** — the record and the Asana task both exist but `asana_task_url`
is empty. The task was created and never linked, and every later stage change
will create another one.
**Not a bug** — no Asana task at all when the issue was in `Backlog`. Check the
Linear state before filing anything. Move the issue to `Todo` and the task
appears within a minute; that transition is itself the cleanest way to see the
threshold working.
**Where to look on failure** — the gateway stream, for a `linear-webhook`
execution. No entry at all means the webhook never arrived; an entry with an
error means it arrived and we rejected it. Those are very different bugs.

### 2.2 Stage change updates both sides

Move that Content record's pipeline stage.

The link already exists from 2.1, so this is the **update** path.

**Expect** the linked Linear issue's state changes to match.
**Expect** the **same** Asana task moves section — no new task.
**Expect also** the *Linear / Asana Status* card reflects the new state.
**Fail signal** — a second Asana task appears. That means `asana_task_url` was
never written back in 2.1, so the sync could not find the existing task and
created another.

**Moving it *back* to Idea is a fair test and does not undo anything.** The
Outline threshold suppresses task *creation* only. A task that already exists
still follows the record down to **New Idea** in Asana, and the Linear issue
still moves to Backlog. Leaving Asana asserting a stage HubSpot had stopped
believing would be the worse bug.

### 2.2b A record created at Outline with no Linear issue

This is the other direction — the one the vault uses. You can exercise it
without Obsidian: create a Content record by hand, set its stage to **Outline**,
and leave `linear_issue_id` empty.

**Expect** a **new Linear issue** in the configured team, in `Todo`.
**Expect** `linear_issue_id` and `linear_issue_url` on the HubSpot record within
a minute. This write-back is the whole test.
**Expect** the new issue's description to contain `[hs-sync]`.
**Expect exactly one HubSpot record** — still the one you made.

**Fail signal — a second Content record appears.** The `[hs-sync]` tag is
missing from the issue description, so our own webhook did not recognise the
issue as ours and created a record for it.
**Fail signal — `linear_issue_id` stays empty while the issue exists.** The
issue was created and never linked. Move the stage again and you will get a
*third* issue, then a fourth: one per stage change, with every response a 200.
The workflow action reports `syncStatus: created_unlinked` when it knows this
has happened — check the action's output before assuming the create failed.

**Do the same at Idea and expect nothing.** No Linear issue, no Asana task,
`syncStatus: skipped`. That is the rule, not a failure.

### 2.3 Asana change flows back

Change the task's section in Asana, then trigger the poll. It needs the **App
Config record's id** — that record is where the Asana sync token lives:

```bash
curl -s -X POST https://51869810.hs-sites.com/hs/serverless/asana-poll \
  -H 'Content-Type: application/json' \
  -d '{"hs_object_id":"60786952492"}'
```

**Expect** `{"outputFields":{"syncStatus":"success","processed":"N"}}`, and the
HubSpot record's stage updates to match.

**Expect `processed: 0` on the first run, whatever you changed.** Asana's Events
API answers an unknown sync token with a fresh token and *no history*, and
`asana_sync_token` on the App Config record is currently empty — so the first
poll only establishes the token. Change the section again, poll again, and the
second run reports it. This is not a bug and it will look exactly like one.

**Fail signal** — `400 Missing hs_object_id`. The body was empty. The poll reads
and writes its sync token on that record and cannot run without it.

### 2.4 Cards render on a Content record

Open any Content record.

**Expect** three cards: *Linear / Asana Status*, *Related Content*, *Enterpret
Insights*.
**Expect** Enterpret Insights to be empty or say it has no data — see 7.3. That
is correct behaviour, not a failure.

### 2.5 Unassignment archives the record and clears the Asana task

Only applies when `assignee_filter` is `mine` or `assigned` — on `all` nothing is
ever excluded. Yours is `mine`.

In Linear, **unassign yourself** from the issue (or reassign it to someone else).

**Expect** the HubSpot record moves to the **Archived** stage within a minute.
**Why** — it would otherwise sit in the pipeline at its last synced stage,
looking live while it had quietly stopped tracking. Archived makes that visible.

**Then check Asana.** The task is tagged **Canceled** *and* has **no assignee** —
it should have left your My Tasks entirely.
**Why** — Canceled on its own is not enough. A Canceled task still sits in the
assignee's My Tasks looking like a live to-do: labelled dead, behaving alive.
Archived work has to leave the queue, not just get a label.

Then **reassign yourself** in Linear.

**Expect** the record returns to the stage mapped from the Linear state — *not*
to wherever it sat before. Archived is a stage, not a delete, and the normal
upsert writes the mapped stage on the way back. An issue in `Todo` returns to
**Outline**.

**Expect no *second* Asana task**, whichever state you reassign into. The
Outline threshold gates creation, and the task already exists.

**Expect the Asana task to stay unassigned.** This is deliberate, not a missed
case. Nothing in Asana distinguishes "the sync unassigned this" from "a person
unassigned this on purpose", so reassigning automatically would overrule a real
decision. Reassign it by hand if you want it back.

**Not a bug** — archiving by hand while the issue is still assigned to you does
not stick. The next Linear update pulls it back out: Linear remains the source
of truth for stage.

**Not a bug** — no other stage change touches the Asana assignee. Only the move
into Archived does. If a routine stage change ever clears an assignee, that *is*
a bug worth filing.

**Changelog records are skipped, not archived.** That pipeline has no Archived
stage to move to.

---

## 3. Video — connection

### 3.1 Connection status

```bash
curl -s "https://51869810.hs-sites.com/hs/serverless/youtube-auth?action=status&portalId=51869810"
```

**Expect**

```json
{"status":"connected","connected":true,"hasRefreshTokenSecret":true,
 "channelId":"UCUp_0p0PFfaIEkUz5qMLLVw","channelTitle":"dennis edson", ...}
```

**If `pending_secret`** — the channel is authorised but `YOUTUBE_REFRESH_TOKEN`
is still a placeholder. That is a real state, not an error. Set the secret and
redeploy.
**If `disconnected`** — re-run the authorisation flow, operator guide §4.2.

### 3.2 The token actually refreshes

The status above only proves a secret exists. This proves it works:

```bash
curl -s -X POST https://51869810.hs-sites.com/hs/serverless/youtube-sync \
  -H 'Content-Type: application/json' -d '{}'
```

**Expect** a JSON outcome with `"errors":[]`.
**Why this is the real test** — the sync exchanges the refresh token for an
access token *before* it searches for records. A clean response means that
exchange succeeded. A `500` means it did not.

---

## 4. Video — sync

### 4.1 Metrics land on a record

Create a Video record with `youtube_video_id` set to a real video on the test
channel, then run the sync from 3.2.

**Expect** `recordsFound` ≥ 1, `recordsUpdated` ≥ 1, `errors: []`, and
`view_count` / `like_count` / `comment_count` populated on the record.

**Expect `recordsFound: 0` if you sync immediately after creating the record.**
This is HubSpot search indexing lag, not a bug — the record is not yet
searchable. Wait a minute and run it again. It was mistaken for a bug during
development.

### 4.2 Analytics populate

`average_view_duration` comes from the YouTube Analytics API — a different API
from the one behind 4.1, with its own quota and permissions.

**Expect** the sync response to carry `"analyticsStatus": "ok"`, and
`average_view_duration` to be written on the record.

**Why that field is the test, not the property.** The figure can legitimately be
`0`, so a blank-looking record does not tell you whether analytics ran and found
nothing or never ran at all. `"ok"` means the call happened.

**Expect `impressions` and `click_through_rate` to stay blank — permanently.**
`reports.query` does not serve them; asking returns
`400 Unknown identifier (impressions)`. See section 7. They are left unwritten
rather than set to `0`, because "zero impressions" is a claim YouTube never
made.

**Fail signal** — `"analyticsStatus": "skipped: no channel id …"`. The sync reads the
channel id from `app_configs`, where the OAuth callback recorded it, so this
means the connection never completed. Re-check 3.1; you should not need to set
anything by hand.

> `YOUTUBE_CHANNEL_ID` exists as a **secret override** for pointing a sync at a
> channel the callback never wrote. It is not part of normal setup. This test
> used to require it, which was wrong — the app already knew the value.

### 4.3 Unset versus zero

On a Video record that has never synced, check the metrics.

**Expect** the card shows `—`, not `0`. A video with no views and a video never
synced must not look identical.

---

## 5. Video — the card

The backend is verified; the rendering is not. **This section has never been
run by anyone.** Expect to find things.

### 5.1 The card appears

Open a Video record.

**Expect** a **YouTube** tab.
**If absent** — the card did not deploy. Check the latest build.

### 5.2 It renders the record

**Expect** the video id as a tag, a *Watch on YouTube* link, two rows of stats,
and a line reading "Record updated …".

### 5.3 Sync from the card

There are two sync buttons, and the difference matters.

**Press *Sync this video*.**

**Expect** a spinner, then `Updated this video.`, with the stats refreshing in
place. Only this record is touched.
**Why it reads rather than searches** — a single-record sync fetches the record
by id, so it is immune to the HubSpot search indexing lag that makes a freshly
created record report `recordsFound: 0` in 4.1.

**Press *Sync all videos*.**

**Expect** `Updated N of N video record(s).` — every Video record on the
portal, which is the right behaviour for the nightly workflow and the reason
this is a separate, explicitly labelled button.

**Expect also** that *Sync this video* is disabled when the record has no
`youtube_video_id`, or when YouTube is not connected. *Sync all videos* is
disabled only on the connection, since it does not depend on this record.

**Fail signal** — `HTTP 500`. The handler resolves the portal from
`accountId`, which a gateway request carries and a card's
`hubspot.serverless()` call does not, so it falls back to the `portalId`
parameter the card sends. A 500 here means that fallback is gone; a 400 saying
`Missing portalId` means the card stopped sending it.

### 5.4 AI suggestions

Press **Suggest metadata**.

**Expect a wait of roughly 13 seconds** with an explicit loading message. This
is normal — it is a real model call.
**Expect** three to five titles, each expandable to reveal reasoning, plus a
description and tags.
**Expect the line "Nothing below has been saved."** Suggestions are shown, never
applied. If anything on the record changed, that is a serious bug — report it.

### 5.5 The connection banner is honest

If YouTube is in `pending_secret`, the card should say *"Authorised, but not
finished"* and explain the refresh token — not "not connected". Reporting it as
a failure sends people re-authorising when the fix is a secret.

---

## 6. Vault and Cowork

### 6.1 The vault opens

Follow [`vault-template/SETUP.md`](../vault-template/SETUP.md).

**Expect** the vault named exactly `Dev-Central-Brain` — hyphens, no spaces.
The prompts build `obsidian://` links against that name; anything else silently
breaks every link, with no error and no dialog.
**Expect** seven folders: `daily/`, `meetings/`, `content/`, `changelogs/`,
`references/`, `templates/` and `prompts/`. The first five look empty — their
`.gitkeep` files are hidden dotfiles.

### 6.2 Templates insert

**Settings → Core plugins → Templates**, folder set to `templates`. Then
`Cmd+P` → *Insert template*.

**Expect** frontmatter with `hubspot_object`, `hubspot_id`, `hubspot_portal`,
`hubspot_pipeline` and `content_type`. `hubspot_id` is empty until the record
exists — that pair is what ties the note to a CRM record.
**Expect `promote` on the content brief, rendered as an unticked checkbox** in
the properties panel. That checkbox is the entire user interface for 6.4. If it
shows as the text `false` instead, the value was quoted somewhere and Obsidian
is treating it as a string.

### 6.3 Cowork reads the vault

Connect `~/Dev-Central-Brain` as a folder in Cowork and ask it to list your
content notes.

**Expect** it can read them.
**Expect to edit the prompts.** They are explicitly unverified — nobody has
watched Cowork execute them. When one is wrong, fix the file rather than filing
a bug.

### 6.4 Promoting a note creates the record — at Outline

This is the vault's only front door into HubSpot. **Unverified end to end** —
nobody has watched Cowork run it.

Make a note in `content/` from `templates/content-brief.md`, leave `hubspot_id`
empty, and tick **promote** in the properties panel. Then run
`prompts/promote-note.md`.

**Expect** a `content_piece` at **Outline** (`1418660000`), not Idea.
**Expect** `source_url` on the record, an `obsidian://` link that opens the note.
**Expect** `hubspot_id` written back into the note's frontmatter.
**Then expect the fan-out**, within a minute and without you doing anything: a
Linear issue and an Asana task, because Outline is the threshold for both. This
is the same path as 2.2b, reached from the vault instead of by hand.

**Expect running it twice to be a no-op.** The second run finds `hubspot_id`
already set and skips the note. If it creates a second record, the write-back in
step 3 did not happen — that is the bug, not the duplicate.

**Fail signal** — the record exists at Idea. Nothing fans out from Idea, so the
record will sit there looking finished and connected to nothing. Check the stage
id in the prompt: Outline is `1418660000`, Idea is `1418659999`.

**An untick is not an undo.** Clearing `promote` after the record exists changes
nothing — `hubspot_id` is what the prompt reads, and the record is already out
there. Delete the record by hand if you want it gone.

---

---

## 7. Known broken — do not file these

Verified as blocked. Each has been investigated and documented.

| Area | Symptom | Why |
|---|---|---|
| **Breeze agent tools** | `The requesting portal is not authorized to execute tool` | Deploys, publishes, appears in the agent builder, refuses to execute. Every action declaring `WORKFLOWS` works; only the three declaring `AGENTS` fail — same app, portal and build |
| **YouTube push notifications** | Metrics only update on the poll | HubSpot's gateway accepts only `application/json`; YouTube's hub sends `application/atom+xml`, rejected `415` before any code runs |
| **Enterpret** | Card shows no data | No obtainable API key; data arrives out-of-band via Cowork (#12) |
| **Social / LinkedIn** | Drafts are not published | HubSpot Social not connected (#18); the action exists but is in no live workflow |

---

**`impressions` and `click_through_rate` are never populated.** The YouTube
Analytics API's `reports.query` has no such metrics — requesting them returns
`400 Unknown identifier (impressions) given in field parameters.metrics`. They
exist in YouTube Studio and in the bulk Reporting API, which is a different
integration. The properties are left blank rather than zeroed. Do not file this.

## 8. When something fails

Capture these four things. Without them a fresh debugging session starts from
nothing:

1. **What you did**, precisely enough to repeat
2. **The gateway log** around that moment —
   `npx hs app logs --app=49103173 --type=serverless-gateway-execution --since=10m`
3. **The full response**, including status code. An HTML error page means the
   function crashed or the gateway rejected the request *before* our code; JSON
   means our code ran and handled it. Those are different bugs.
4. **Whether it ever worked**, and what changed in between

Two failure shapes seen repeatedly on this project, worth recognising:

**Green but empty.** A deploy, script or sync reports success while doing
nothing. Always verify the postcondition — the record, the property, the log
entry — not the status code.

**An error that names the wrong cause.** `expired 20705 day(s) ago` meant a
credential that could not be parsed, not an old one. Read the shape of an error,
not only its words.
