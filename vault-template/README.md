# Vault template

A skeleton for the Obsidian vault described in the strategy doc, §6 "Obsidian + Cowork Layer".
Copy it to wherever the vault lives — it is version-controlled here because the vault sits on a
different machine from this repo, and Cowork on another again.

## Materializing it

```bash
cp -R vault-template/ ~/path/to/your-vault/
```

1. Open the folder in Obsidian once, so it creates `.obsidian/`
2. Connect the folder in Cowork
3. Put your vault's name into `prompts/README.md` where the `obsidian://` URI needs it

Re-running the copy is safe for the folders but **overwrites templates and prompts**. After the
first time, copy selectively.

## Folders

| Folder | Holds |
|---|---|
| `daily/` | daily notes, journal, quick captures |
| `meetings/` | meeting notes, from Fellow via Cowork |
| `content/` | drafts and outlines for content tracked in HubSpot |
| `changelogs/` | changelog drafts |
| `references/` | research, links, saved resources |
| `references/enterpret/themes/` | one note per Enterpret friction theme |
| `templates/` | reusable note templates |
| `prompts/` | saved Cowork prompts |

## The linkage contract

A note and a HubSpot record point at each other. Both sides are written **once, when the note is
created**, and are never maintained by a background process.

### Note → HubSpot, in frontmatter

```yaml
---
hubspot_object: content_piece
hubspot_id: "60962462621"
hubspot_portal: 51869810
hubspot_pipeline: content        # content | changelog
content_type: blog_post
topic_tags: [api, crm]
enterpret_theme: webhook retries
---
```

`hubspot_id` + `hubspot_portal` are the durable pointer. The other fields mirror HubSpot
properties so Cowork can filter notes without a round-trip — they are a **cache**, and HubSpot
wins if they disagree.

### HubSpot → note, in `source_url`

```
obsidian://open?vault=<vault-name>&file=<url-encoded-path>
```

`source_url` is defined in the strategy doc as "Link to the draft (Google Doc, Obsidian note, etc.)".

### Why it is not continuously synced

The Linear sync in this project needed `[hs-sync]` origin markers to stop echo loops — a change in
one system triggering a change in the other, triggering the first again. A continuously synced
local file would reintroduce that, with no webhook and no revision history to arbitrate with.

Writing each side once avoids it. If a note is renamed the link breaks **visibly** and is repaired
by hand, which beats a loop that corrupts quietly.

### `hubspot_object` is always `content_piece`

A `changelog_entry` object exists on the portals (`2-67505888` on dev) but is vestigial — zero
records, referenced only by `src/scripts/provision-asana-property.ts`, predating the consolidation
of changelog into `content_piece`'s second pipeline. Changelog notes use `content_piece` with
`hubspot_pipeline: changelog`.

## Portal reference

| Portal | id | content_piece | video |
|---|---|---|---|
| dev | 51869810 | `2-67505887` | `2-67505890` |
| staging | 51869787 | `2-67508770` | `2-67508774` |
| prod | 22047910 | `2-67508928` | `2-67508933` |
