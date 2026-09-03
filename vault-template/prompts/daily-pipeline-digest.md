# Daily pipeline digest

> ⚠️ Unverified — see `README.md`.

**Portal:** dev `51869810` · `content_piece` = `2-67505887` · content pipeline = `926238627`

## 1. Pull the pipeline

```
POST https://api.hubapi.com/crm/objects/2026-03/2-67505887/search
Authorization: Bearer $HS_TOKEN
Content-Type: application/json

{"filterGroups":[{"filters":[{"propertyName":"hs_pipeline","operator":"EQ","value":"926238627"}]}],
 "properties":["title","content_type","hs_pipeline_stage","target_date","linear_issue_url"],
 "sorts":[{"propertyName":"hs_lastmodifieddate","direction":"DESCENDING"}],
 "limit":100}
```

## 2. Write the digest into today's daily note

Under `## Pipeline` in `daily/<today>.md`, created from `templates/daily-note.md` if missing:

- **In review** — `hs_pipeline_stage` = `1418660003`
- **Overdue** — `target_date` in the past and stage is not `1418660004` (Published) or
  `1418660005` (Archived)
- **Shipped yesterday** — moved to `1418660004`
- **Stalled** — no modification in 14 days and not Published or Archived

Keep it short enough to read before coffee. Skip empty sections rather than printing "none".
