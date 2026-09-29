# Obsidian Vault Scaffolding for Cowork — Design

**Date:** 2026-09-03
**Related:** issue #12 (Enterpret MCP sync), strategy doc §6 "Obsidian + Cowork Layer"
**Status:** Approved, ready for implementation plan

## Problem

The strategy doc positions Obsidian as the thinking and drafting layer — "a local folder of markdown files, which makes it trivially accessible to Cowork. This layer doesn't require any API integration — just a connected folder." It suggests a vault structure and lists a dozen Cowork workflows that assume one exists.

None of it exists yet, and the vault will live on a different machine from this repo. The Enterpret MCP sync (#12) is the first workflow that needs it.

## Goal

A version-controlled vault skeleton in this repo that can be materialized anywhere, carrying the folder structure, note templates, the note↔record linkage convention, and a starting library of Cowork prompts.

## Why a template in the repo, not a vault

The vault is not on this machine and Cowork runs on another. A template:

- survives the machine split — materialize it wherever the vault lives
- is reviewable in a PR, so conventions are agreed rather than accreted
- can be re-materialized if the vault is lost or a second one is needed
- keeps the linkage contract versioned alongside the code that depends on it

## Non-goals

- **No continuous two-way sync.** See the linkage contract below.
- **No Obsidian plugins or `.obsidian/` config.** The vault's own settings are the user's; this ships content and structure only.
- **Not creating the vault.** Materialization is a documented copy, run by the user on the machine that holds it.

## Structure

```
vault-template/
├── README.md
├── daily/.gitkeep
├── meetings/.gitkeep
├── content/.gitkeep
├── changelogs/.gitkeep
├── references/
│   ├── .gitkeep
│   └── enterpret/
│       ├── README.md
│       └── themes/.gitkeep
├── templates/
│   ├── content-brief.md
│   ├── changelog.md
│   ├── meeting-note.md
│   ├── enterpret-theme.md
│   └── daily-note.md
└── prompts/
    ├── README.md
    ├── enterpret-sync.md
    ├── weekly-content-planning.md
    ├── coverage-gaps.md
    ├── changelog-from-linear.md
    └── daily-pipeline-digest.md
```

Folders match the strategy doc's §6.1 exactly, plus `references/enterpret/` and `prompts/`.

**Every empty directory carries a `.gitkeep`.** Git does not track empty directories. That exact gap cost a deploy cycle earlier in this project when `assets/` and `styles/` existed locally but never reached CI.

## The linkage contract

A note and a HubSpot record point at each other. This is the piece that makes every Cowork workflow possible, so it is specified rather than left to convention.

### Note → HubSpot, via frontmatter

```yaml
---
hubspot_object: content_piece      # always content_piece — see the changelog note below
hubspot_id: "60962462621"
hubspot_portal: 51869810
hubspot_pipeline: content          # content | changelog
content_type: blog_post            # mirrors the HubSpot property
topic_tags: [api, crm]
enterpret_theme: webhook retries
---
```

`hubspot_id` and `hubspot_portal` together are the durable pointer. The mirrored fields exist so Cowork can filter and group notes without a HubSpot round-trip; they are a cache, and HubSpot is authoritative if they disagree.

### HubSpot → note, via `source_url`

`source_url` is already defined in the strategy doc as "Link to the draft (Google Doc, Obsidian note, etc.)". It holds:

```
obsidian://open?vault=<vault-name>&file=<url-encoded-path>
```

### Written once, never continuously synced

Both sides are written at creation and not maintained by a background process. This is deliberate.

The Linear sync in this project needed `[hs-sync]` origin markers to stop echo loops — a change in one system triggering a change in the other, triggering the first again (walkthrough 01). A continuously synced note would reintroduce exactly that, with the added difficulty that a local file has no webhook and no revision history to arbitrate with.

One-time linkage avoids the problem outright. If a note is renamed or moved, the link breaks visibly and is repaired by hand — which is preferable to a loop that corrupts quietly.

### `hubspot_object` is always `content_piece`

A `changelog_entry` custom object exists on the portals (`2-67505888` on dev) but is **vestigial**: it holds zero records, and the only reference to it in the codebase is `src/scripts/provision-asana-property.ts`, which predates the consolidation of changelog into `content_piece`'s second pipeline (walkthrough 15, "One Object Two Pipelines").

Notes in `changelogs/` therefore point at `content_piece` records with `hubspot_pipeline: changelog`. Pointing them at `changelog_entry` would link them to an object nothing reads.

## Enterpret research folder

`references/enterpret/themes/<slug>.md` — one note per friction theme:

```yaml
---
enterpret_theme: webhook retries
quote_count: 12
dominant_sentiment: negative
synced: 2026-09-03
---
```

Body carries the quotes with their sources. Drafts reference them as `[[webhook-retries]]`.

This is not redundant with the `enterpret_quotes` HubSpot property. Same source, two consumers: HubSpot holds structured JSON that the Enterpret Insights card renders; Obsidian holds linkable prose for drafting. The card needs machine-readable, the writer needs readable.

## Cowork prompts

One file per workflow described in strategy §6.2:

| File | Workflow |
|---|---|
| `enterpret-sync.md` | Enterpret themes/quotes → HubSpot properties + theme notes (#12) |
| `weekly-content-planning.md` | Cross-reference pipeline against top Enterpret themes |
| `coverage-gaps.md` | Themes with no corresponding content record |
| `changelog-from-linear.md` | Linear issue → changelog draft + HubSpot record |
| `daily-pipeline-digest.md` | Morning pipeline summary into a daily note |

Each is **self-contained** — portal IDs, object type ids, property names and API paths inline — because a Cowork session has none of this repo's context. Same constraint that shaped `docs/enterpret-mcp-sync.md`.

### These prompts are unverified

Stated plainly in `prompts/README.md` as well as here. They are written from the strategy doc's descriptions and from API shapes verified against the live portal, but **no one has watched Cowork execute them**. They are starting points to edit, not instructions to trust. The API facts inside them are verified; the prompt phrasing and the assumptions about what Cowork does with a folder are not.

## Materialization

`vault-template/README.md` documents:

1. Copy the tree to the vault location (`cp -R vault-template/ ~/path/to/vault/`)
2. Open it in Obsidian once so it creates `.obsidian/`
3. Connect the folder in Cowork
4. Fill the vault name into `prompts/README.md` where the `obsidian://` URI needs it

Re-running the copy is safe for folders but would overwrite templates and prompts, so the README says to copy selectively after the first time.

## Verification

This ships no runtime code, so the checks are structural:

1. Every folder in the tree exists after a copy, including the empty ones — proves the `.gitkeep` files do their job
2. Every template parses as valid YAML frontmatter plus markdown
3. Every portal id, object type id and property name appearing in a prompt matches `src/app/lib/portal-config.ts` and `src/scripts/provision-objects.ts` — a wrong id in a self-contained prompt is undetectable from the Cowork side
4. `npm run validate` still passes — nothing here should touch it
