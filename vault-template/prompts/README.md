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

## How you actually run one

These are **not** automation. Nothing schedules them, nothing watches for changes, and nothing
runs unless you run it.

1. Open the `.md` file.
2. Copy the whole thing.
3. Paste it into a Cowork conversation in the project that has this vault connected.
4. Send.

That is it. Each file is written in the first person because it *is* a message from you to
Cowork: it states your setup, then the job. `daily-` and `weekly-` describe how often you would
choose to run one, not a scheduler. If Cowork supports recurring tasks, the daily digest is the
obvious first candidate — but get one manual run working before automating something nobody has
watched succeed.

### The token

Every prompt that touches HubSpot sends `Authorization: Bearer $HS_TOKEN`. That is a HubSpot
**private app token** — the same kind the provisioning scripts use as `SERVICE_KEY`, created in
the portal under Settings → Integrations → Private Apps.

**How Cowork gets hold of it is not established.** Depending on what your Cowork can do, it may
be a shell environment variable it can read, something you paste into the conversation, or
unnecessary because a HubSpot connector handles auth. Work this out first — it is the most
likely reason a prompt fails before doing anything interesting.

### Start here

**`daily-pipeline-digest.md`.** It needs only HubSpot and the vault, so when it fails there are
only two things it can be.

Leave `enterpret-sync.md` until last. It needs the token *and* Enterpret over MCP *and* the
vault, and Enterpret has no obtainable API key — that connector is the only route to the data,
which makes it the hardest prompt to debug, not the gentlest.

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
| `promote-note.md` | Ticked `promote` → HubSpot record at **Outline** (the vault's one front door) |
| `changelog-from-linear.md` | Linear issue → changelog draft + HubSpot record — ⚠️ collides with the webhook, read its warning |
| `daily-pipeline-digest.md` | Morning pipeline summary into today's daily note |

## Portals

| Portal | id | content_piece | video |
|---|---|---|---|
| dev | 51869810 | `2-67505887` | `2-67505890` |
| staging | 51869787 | `2-67508770` | `2-67508774` |
| prod | 22047910 | `2-67508928` | `2-67508933` |

**Use dev for anything involving the changelog pipeline.** Staging and prod have no changelog
pipeline id configured — see issue #21.
