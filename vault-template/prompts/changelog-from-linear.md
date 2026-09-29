# Changelog from a Linear issue

> ⚠️ Unverified — see `README.md`.

> ## 🛑 Read this before running it
>
> **Step 3 creates a HubSpot record that already exists.** The app's `LinearWebhook`
> creates a `content_piece` for every tagged Linear issue, automatically, within a minute
> of the issue appearing. Running this prompt today therefore produces **two records for
> one issue** — one from the webhook keyed on `linear_id`, one from the POST below keyed on
> nothing. They do not merge and neither knows about the other.
>
> The duplicate is the quiet kind: both records look correct, both carry the same title, and
> only one of them is the one the sync keeps updating.
>
> **Until this is resolved, run steps 1, 2 and 4 only.** Draft the note, then find the record
> the webhook already made — search `content_piece` for the issue's `linear_issue_url` — and
> PATCH `source_url` onto *that* record rather than creating a new one.
>
> Contrast `promote-note.md`, which has no collision: nothing else creates a record for a
> note, because the vault is the only place that idea exists.

**Portal:** dev `51869810` · `content_piece` = `2-67505887` · changelog pipeline = `929918080`

Use dev. Prod has no changelog pipeline configured (issue #21).

## 1. Read the Linear issue over MCP

## 2. Draft the changelog note

Create `changelogs/<slug>.md` from `templates/changelog.md`. Fill `linear_issue_url`, and write
*what changed*, *who it affects*, and migration notes if any. Developer-facing prose, not a commit
message.

## 3. Create the HubSpot record

```
POST https://api.hubapi.com/crm/objects/2026-03/2-67505887
Authorization: Bearer $HS_TOKEN
Content-Type: application/json

{"properties":{
   "title":"…",
   "content_type":"changelog",
   "hs_pipeline":"929918080",
   "hs_pipeline_stage":"1426412984",
   "linear_issue_url":"…",
   "source_url":"obsidian://open?vault=Dev-Central-Brain&file=changelogs%2F<slug>.md"
}}
```

Changelog stages: `1426412984` Identified · `1426412985` Drafting · `1426413056` Reviewing ·
`1426413057` Published

## 4. Close the loop

Put the returned record id into the note's `hubspot_id`. Both sides now point at each other and
neither is synced again.
