# Changelog from a Linear issue

> ⚠️ Unverified — see `README.md`.

**Portal:** dev `51869810` · `content_piece` = `2-67505887` · changelog pipeline = `929918080`

Use dev. Staging and prod have no changelog pipeline configured (issue #21).

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
   "source_url":"obsidian://open?vault=Dev-%20Central-Brain&file=changelogs%2F<slug>.md"
}}
```

Changelog stages: `1426412984` Identified · `1426412985` Drafting · `1426413056` Reviewing ·
`1426413057` Published

## 4. Close the loop

Put the returned record id into the note's `hubspot_id`. Both sides now point at each other and
neither is synced again.
