# Syncing Enterpret → HubSpot over MCP

**Run this from the work machine**, where Enterpret MCP is connected. It needs no code from this repo — everything required is below.

## Why it works this way

The Enterpret Insights card reads HubSpot properties. It does **not** call Enterpret. Two reasons:

1. No Enterpret API key is obtainable.
2. MCP connects Enterpret to an AI assistant. A HubSpot serverless function cannot reach an MCP server — different runtime, different trust boundary.

So Enterpret data is written into HubSpot out-of-band, and the card reads what's stored. Nothing to rotate, no failure mode at render time, and no dependency on Enterpret being up.

## What you need on the work machine

- Enterpret MCP connected to Claude
- A HubSpot private-app token for the target portal — `HUBSPOT_<PORTAL>_SERVICE_KEY` from this repo's `.env`

## Target fields

On the **Content Piece** custom object:

| Property | Type | Holds |
|---|---|---|
| `enterpret_theme` | string | the friction theme, e.g. `webhook retries` |
| `enterpret_quote_count` | number | how many quotes back it |
| `enterpret_quotes` | textarea | **JSON array** of quote objects |

`enterpret_quotes` shape — every field optional, the card degrades gracefully:

```json
[
  {
    "text": "Webhook retries silently drop after the third attempt.",
    "source": "Support ticket #4821",
    "sentiment": "negative",
    "createdAt": "2026-08-14T00:00:00Z"
  }
]
```

`sentiment` is normalised on read, so `negative` / `NEGATIVE` / a numeric score all work. Malformed JSON, an empty string, or a missing property all render as "no quotes" rather than an error — so a partial sync is safe.

## Portal reference

| Portal | ID | content_piece objectTypeId |
|---|---|---|
| dev | 51869810 | `2-67505887` |
| staging | 51869787 | `2-67508770` |
| prod | 22047910 | `2-67508928` |

## Paste this into Claude on the work machine

> I have Enterpret connected over MCP and a HubSpot private-app token in `$HS_TOKEN`.
>
> For the HubSpot **dev** portal (51869810), custom object `2-67505887`:
>
> 1. Read all records, requesting properties `title`, `enterpret_theme`:
>    ```
>    GET https://api.hubapi.com/crm/objects/2026-03/2-67505887?limit=100&properties=title,enterpret_theme
>    Authorization: Bearer $HS_TOKEN
>    ```
> 2. For each record that has a non-empty `enterpret_theme`, query Enterpret over MCP for the developer quotes backing that theme. Take at most 5, most recent first.
> 3. Write them back, one PATCH per record:
>    ```
>    PATCH https://api.hubapi.com/crm/objects/2026-03/2-67505887/{recordId}
>    Authorization: Bearer $HS_TOKEN
>    Content-Type: application/json
>
>    {"properties":{
>       "enterpret_quotes":"<JSON array as a STRING>",
>       "enterpret_quote_count":"<count>"
>    }}
>    ```
>    `enterpret_quotes` is a textarea, so the JSON array must be **stringified** — a JSON string containing JSON, not a nested object.
>
> Skip records with no theme. Don't overwrite `enterpret_quotes` with an empty array if Enterpret returns nothing — leave the existing value alone. Report how many records you updated and how many you skipped.

Then swap the portal ID and objectTypeId from the table for staging and prod.

## Checking it worked

```bash
curl -s -H "Authorization: Bearer $HS_TOKEN" \
  "https://api.hubapi.com/crm/objects/2026-03/2-67505887/{recordId}?properties=enterpret_theme,enterpret_quote_count,enterpret_quotes" \
  | python3 -m json.tool
```

Then open that record in HubSpot — the Enterpret Insights card is on the **record tab** and should show the theme, the count, a sentiment summary, and the quotes.

## Notes

- **Re-running is safe.** Each PATCH replaces `enterpret_quotes` wholesale; there is no append or merge.
- **The card never calls Enterpret**, so a stale sync shows stale quotes rather than an error. Freshness is however recently this ran.
- If you later get a real Enterpret API key, live fetching could come back — but this design is better regardless: no secret across three portals, and no render-time dependency on a third party.
