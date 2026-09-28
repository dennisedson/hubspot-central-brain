# Promote a note to HubSpot

> ⚠️ Unverified — see `README.md`. API facts checked; phrasing is a starting point.

I have this vault connected as a folder and a HubSpot private-app token in `$HS_TOKEN`.

**Portal:** dev `51869810` · `content_piece` = `2-67505887` · content pipeline = `926238627`

This vault is the idea stage. An idea never reaches HubSpot on its own — it reaches HubSpot
when I tick `promote` on the note, which is the moment I have decided the work is real.
Promotion lands the record at **Outline**, not Idea, because Outline is the threshold where
the app creates the Linear issue and the Asana task.

## 1. Find the notes I have promoted

Every `.md` file under `content/` whose frontmatter has **both**:

- `promote: true`
- `hubspot_id` empty or missing

Both conditions matter. `hubspot_id` already filled means the record exists and this note
has been promoted before — creating another would give one idea two records, each syncing
to its own Linear issue.

Skip notes under `changelogs/` even if one has `promote: true`. Changelog records are born
from a Linear issue, and their pipeline has no Outline stage to promote into.

If nothing matches, say so and stop. Do not go looking for notes to promote.

## 2. Create the HubSpot record, at Outline

For each matching note:

```
POST https://api.hubapi.com/crm/objects/2026-03/2-67505887
Authorization: Bearer $HS_TOKEN
Content-Type: application/json

{"properties":{
   "title":"<the note's H1, or its filename without .md>",
   "content_type":"<content_type from frontmatter>",
   "hs_pipeline":"926238627",
   "hs_pipeline_stage":"1418660000",
   "source_url":"obsidian://open?vault=Dev-Central-Brain&file=content%2F<filename>.md",
   "topic_tags":"<topic_tags from frontmatter, semicolon-separated>",
   "enterpret_theme":"<enterpret_theme from frontmatter, omit if empty>"
}}
```

`1418660000` is **Outline**. Do not use `1418659999` (Idea) — a record at Idea creates no
Linear issue and no Asana task, so promoting into it does nothing visible and looks broken.

Content pipeline stages, in order:
`1418659999` Idea · `1418660000` Outline · `1418660001` Drafting · `1418660002` Editing ·
`1418660003` Review · `1418660004` Published · `1418660005` Archived

## 3. Close the loop — both directions

The response carries the new record's `id`. Two writes, and neither is optional:

1. **Into the note** — set `hubspot_id` to that id. This is what stops step 1 finding the
   note again on the next run.
2. **Onto the record** — `source_url`, already in the POST above. Check it came back set.

A record with no `source_url` is a record nobody can get back to the note from. A note with
no `hubspot_id` gets promoted again tomorrow, and again the day after.

Leave `promote: true` in the note. It is a record of the decision, and `hubspot_id` is what
actually guards against a second run.

## 4. What happens next, without you

Nothing else to run. The record landing at Outline fires the app's own workflow, which
creates the Linear issue and the Asana task. Give it a minute, then check the record has
`linear_issue_url` and `asana_task_url` filled in.

**If `linear_issue_url` stays empty**, the record was created but the fan-out did not run —
check the stage really is `1418660000` and not `1418659999`.

## Rules

- Never create a record for a note whose `hubspot_id` is already set
- Never create a record at Idea — Outline or nothing
- Do not promote notes I have not ticked, however good they look
- Report which notes you promoted, the record id each got, and anything you skipped and why
