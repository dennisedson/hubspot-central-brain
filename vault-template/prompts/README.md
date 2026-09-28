# Cowork prompts

Paste one of these into Cowork with the Obsidian folder connected. Each is self-contained —
Cowork has none of the `hubspot-central-brain` repo's context, so ids and property names are
inline.

## ⚠️ These are Unverified

Nobody has watched Cowork execute them. The **API facts** inside — portal ids, object type ids,
property names, endpoint paths — are verified against the live dev portal. The **prompt phrasing**,
and every assumption about what Cowork does with a connected folder, is not.

Treat them as starting points to edit, not instructions to trust. When one turns out to be wrong,
fix it here so the next run starts better.

## Vault name

The vault is **`Dev-Central-Brain`**. No spaces, deliberately: a space has to be written `%20`
in an `obsidian://` URI, and a raw one produces a link that silently does nothing.

```
obsidian://open?vault=Dev-Central-Brain&file=changelogs%2Fexample.md
```

`Dev-Central-Brain` is already filled in wherever a prompt builds one of these links. If you
rename the vault, update it here and in `changelog-from-linear.md` — and note that
`vault-template.test.ts` pins the name, so it will tell you if the two drift apart.

## Prompts

| File | What it does |
|---|---|
| `enterpret-sync.md` | Enterpret themes and quotes → HubSpot properties + theme notes |
| `weekly-content-planning.md` | Pipeline vs top Enterpret themes |
| `coverage-gaps.md` | Themes with no content record |
| `changelog-from-linear.md` | Linear issue → changelog draft + HubSpot record |
| `daily-pipeline-digest.md` | Morning pipeline summary into today's daily note |

## Portals

| Portal | id | content_piece | video |
|---|---|---|---|
| dev | 51869810 | `2-67505887` | `2-67505890` |
| staging | 51869787 | `2-67508770` | `2-67508774` |
| prod | 22047910 | `2-67508928` | `2-67508933` |

**Use dev for anything involving the changelog pipeline.** Staging and prod have no changelog
pipeline id configured — see issue #21.
