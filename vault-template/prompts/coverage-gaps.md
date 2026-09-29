# Enterpret coverage gaps

> ⚠️ Unverified — see `README.md`.

**Portal:** dev `51869810` · `content_piece` = `2-67505887`

Which developer pain points have no content addressing them?

## 1. Every theme currently referenced in HubSpot

```
POST https://api.hubapi.com/crm/objects/2026-03/2-67505887/search
Authorization: Bearer $HS_TOKEN
Content-Type: application/json

{"filterGroups":[],
 "properties":["title","enterpret_theme","hs_pipeline_stage"],
 "limit":100}
```

## 2. Top themes by volume from Enterpret over MCP

## 3. The gap

Themes with a high quote count and **no** `content_piece` carrying that `enterpret_theme`.
Rank by quote count descending.

For each gap, write a stub in `content/` from `templates/content-brief.md` with
`enterpret_theme` filled in and `hubspot_id` left empty — a candidate, not yet a HubSpot record.

Report the ranked gaps and which stubs you created. Do not create HubSpot records without asking.
