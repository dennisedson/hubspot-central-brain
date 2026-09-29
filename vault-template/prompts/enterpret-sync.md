# Enterpret → HubSpot + vault

> ⚠️ Unverified — see `README.md`. API facts checked; phrasing is a starting point.

I have Enterpret connected over MCP, this vault connected as a folder, and a HubSpot
private-app token in `$HS_TOKEN`.

**Portal:** dev `51869810` · **Object:** `content_piece` = `2-67505887`

## 1. Find content that needs Enterpret data

```
GET https://api.hubapi.com/crm/objects/2026-03/2-67505887?limit=100&properties=title,enterpret_theme
Authorization: Bearer $HS_TOKEN
```

## 2. For each record with a non-empty `enterpret_theme`

Query Enterpret over MCP for the developer quotes backing that theme. Take at most 5, newest first.

## 3. Write them back to HubSpot

```
PATCH https://api.hubapi.com/crm/objects/2026-03/2-67505887/{recordId}
Content-Type: application/json

{"properties":{
   "enterpret_quotes":"<the JSON array, STRINGIFIED>",
   "enterpret_quote_count":"<count>"
}}
```

**`enterpret_quotes` is a textarea.** The array must be a JSON *string* containing JSON — not a
nested object. Getting this wrong fails silently: the property saves and the card shows nothing.

Each quote object: `{"text":"…","source":"…","sentiment":"negative","createdAt":"2026-08-14T00:00:00Z"}`
Sentiment is `positive`, `negative` or `neutral`.

## 4. Write a theme note in the vault

Create `references/enterpret/themes/<slug>.md` from `templates/enterpret-theme.md`, with the
quotes in the body and `quote_count` / `dominant_sentiment` / `synced` filled in.

## Rules

- Skip records with no `enterpret_theme`
- **Never** overwrite `enterpret_quotes` with an empty array — leave the existing value if
  Enterpret returns nothing
- Report how many records you updated, how many you skipped, and which theme notes you wrote
