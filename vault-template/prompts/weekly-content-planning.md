# Weekly content planning

> ⚠️ Unverified — see `README.md`.

**Portal:** dev `51869810` · `content_piece` = `2-67505887` · content pipeline = `926238627`

## 1. Pull the current pipeline

```
POST https://api.hubapi.com/crm/objects/2026-03/2-67505887/search
Authorization: Bearer $HS_TOKEN
Content-Type: application/json

{"filterGroups":[{"filters":[{"propertyName":"hs_pipeline","operator":"EQ","value":"926238627"}]}],
 "properties":["title","content_type","hs_pipeline_stage","target_date","topic_tags","enterpret_theme"],
 "limit":100}
```

Content pipeline stages, in order:
`1418659999` Idea · `1418660000` Outline · `1418660001` Drafting · `1418660002` Editing ·
`1418660003` Review · `1418660004` Published · `1418660005` Archived

## 2. Pull the top Enterpret themes for the last 30 days over MCP

## 3. Produce a summary in this week's daily note

- What is in flight, by stage
- What is overdue against `target_date`
- Top themes **with** matching content, and the record links
- Top themes **without** any content — the gap list
- Suggested next three pieces, each with the theme it addresses

Write it under `## Pipeline` in `daily/<today>.md`, creating the note from
`templates/daily-note.md` if it does not exist.
