# Obsidian Vault Scaffolding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A version-controlled Obsidian vault skeleton in `vault-template/` — folders, note templates, a documented note↔HubSpot linkage contract, and a starting library of Cowork prompts — materializable on whichever machine holds the vault.

**Architecture:** Content only, no runtime code. The vault lives on a different machine from this repo and Cowork runs on another, so this ships a tree that is copied into place rather than a vault that is created. Verification is structural: the tree survives a copy, every template parses, and every ID inside a prompt matches the codebase.

**Tech Stack:** Markdown with YAML frontmatter. No dependencies, no build step. Verified with a Node script under Vitest, matching the repo's existing test runner.

## Global Constraints

- **Every empty directory gets a `.gitkeep`.** Git does not track empty directories. This exact gap cost a deploy cycle earlier in this project when `assets/` and `styles/` existed locally but never reached CI.
- **`hubspot_object` is always `content_piece`.** The `changelog_entry` object (`2-67505888` on dev) is vestigial: zero records, referenced only by `src/scripts/provision-asana-property.ts`. Changelog notes use `content_piece` with `hubspot_pipeline: changelog`.
- **The linkage is written once at creation, never continuously synced.** No background process maintains it. A broken link is repaired by hand.
- **Every prompt is self-contained** — portal ids, object type ids, property names and API paths inline. A Cowork session has none of this repo's context.
- **Every prompt carries an "unverified" banner.** Nobody has watched Cowork execute these.
- **API paths in prompts use the dated surface** — `/crm/objects/2026-03/...` — except schemas, which has no dated equivalent (issue #14).
- Do not modify anything under `src/`, `.github/`, or `package.json` except where a task says so explicitly.

## Verified reference values

Copy these verbatim. They were read from `src/app/lib/portal-config.ts` and confirmed against the live dev portal.

| Portal | id | content_piece | video | content pipeline | changelog pipeline |
|---|---|---|---|---|---|
| dev | 51869810 | `2-67505887` | `2-67505890` | `926238627` | `929918080` |
| staging | 51869787 | `2-67508770` | `2-67508774` | `926239377` | **not provisioned (#21)** |
| prod | 22047910 | `2-67508928` | `2-67508933` | `926239383` | **not provisioned (#21)** |

Dev changelog stages: `identified=1426412984`, `drafting=1426412985`, `reviewing=1426413056`, `published=1426413057`
Dev content stages: `idea=1418659999`, `outline=1418660000`, `drafting=1418660001`, `editing=1418660002`, `review=1418660003`, `published=1418660004`, `archived=1418660005`

`content_type` options: `blog_post`, `video`, `tutorial`, `talk`, `changelog`, `documentation`, `social`
`topic_tags` options: `api`, `crm`, `workflows`, `ui_extensions`, `integrations`, `developer_platform`

Enterpret properties on `content_piece`: `enterpret_theme` (string), `enterpret_quote_count` (number), `enterpret_quotes` (textarea holding a **stringified** JSON array).

**Prompts must target dev only** for anything touching the changelog pipeline, until #21 is fixed.

---

### Task 1: Folder tree and the conventions README

**Files:**
- Create: `vault-template/README.md`
- Create: `vault-template/{daily,meetings,content,changelogs}/.gitkeep`
- Create: `vault-template/references/.gitkeep`, `vault-template/references/enterpret/themes/.gitkeep`
- Create: `vault-template/templates/.gitkeep`, `vault-template/prompts/.gitkeep`

**Interfaces:**
- Produces: the directory layout every later task writes into, and the canonical statement of the linkage contract that templates and prompts both reference.

- [ ] **Step 1: Create the tree with keepfiles**

```bash
mkdir -p vault-template/{daily,meetings,content,changelogs,templates,prompts}
mkdir -p vault-template/references/enterpret/themes
for d in daily meetings content changelogs templates prompts references references/enterpret/themes; do
  touch "vault-template/$d/.gitkeep"
done
```

- [ ] **Step 2: Write `vault-template/README.md`**

````markdown
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
````

- [ ] **Step 3: Verify the tree survives a copy**

```bash
rm -rf /tmp/vault-check && cp -R vault-template/ /tmp/vault-check/
find /tmp/vault-check -type d | sort
```

Expected: all nine directories present, including the empty ones.

- [ ] **Step 4: Commit**

```bash
git add vault-template/
git commit -m "feat(vault): folder tree and linkage contract README

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: Note templates

**Files:**
- Create: `vault-template/templates/content-brief.md`
- Create: `vault-template/templates/changelog.md`
- Create: `vault-template/templates/meeting-note.md`
- Create: `vault-template/templates/enterpret-theme.md`
- Create: `vault-template/templates/daily-note.md`

**Interfaces:**
- Consumes: the frontmatter contract from Task 1's README.
- Produces: five templates whose frontmatter keys are asserted by Task 4's test — `hubspot_object`, `hubspot_id`, `hubspot_portal`, `hubspot_pipeline`, `content_type`, `topic_tags`, `enterpret_theme`.

- [ ] **Step 1: `templates/content-brief.md`**

```markdown
---
hubspot_object: content_piece
hubspot_id: ""
hubspot_portal: 51869810
hubspot_pipeline: content
content_type: blog_post
topic_tags: []
enterpret_theme: ""
---

# {{title}}

## Why this, why now

<!-- What developer problem does this solve? Link the Enterpret theme if there is one:
     [[../references/enterpret/themes/<slug>]] -->

## Outline

-

## Draft

## Sources

<!-- Enterpret quotes, Slack threads, community posts, Linear issues -->
```

Notes: `content_type` must be one of `blog_post`, `video`, `tutorial`, `talk`, `changelog`,
`documentation`, `social`. `topic_tags` values come from `api`, `crm`, `workflows`,
`ui_extensions`, `integrations`, `developer_platform`.

- [ ] **Step 2: `templates/changelog.md`**

```markdown
---
hubspot_object: content_piece
hubspot_id: ""
hubspot_portal: 51869810
hubspot_pipeline: changelog
content_type: changelog
topic_tags: []
linear_issue_url: ""
---

# {{title}}

## What changed

## Who it affects

## Migration notes

<!-- Anything a developer must do. Omit the section if nothing. -->

## Linear

<!-- linear_issue_url above; paste the issue summary here for drafting context -->
```

Note `hubspot_object` is `content_piece`, not `changelog_entry` — see the README.

- [ ] **Step 3: `templates/meeting-note.md`**

```markdown
---
date: ""
attendees: []
fellow_url: ""
hubspot_contact_ids: []
---

# {{title}}

## Notes

## Action items

- [ ]

## Content ideas

<!-- Anything here that should become a HubSpot Content record.
     Cowork prompt: prompts/weekly-content-planning.md -->
```

This template has no `hubspot_object` — a meeting is not a content record. It links to contacts
instead, which is what the Meeting Intelligence card surfaces from the other direction.

- [ ] **Step 4: `templates/enterpret-theme.md`**

```markdown
---
enterpret_theme: ""
quote_count: 0
dominant_sentiment: neutral
synced: ""
---

# {{theme}}

## Quotes

<!-- One block per quote: text, source, sentiment, date -->

> 

— source, date

## Content addressing this

<!-- [[../../content/<note>]] links to drafts grounded in this theme -->
```

`dominant_sentiment` is one of `positive`, `negative`, `neutral` — matching
`normaliseSentiment` in `src/app/lib/enterpret-client.ts`.

- [ ] **Step 5: `templates/daily-note.md`**

```markdown
---
date: ""
---

# {{date}}

## Pipeline

<!-- prompts/daily-pipeline-digest.md drops the summary here -->

## Notes

## Captures

<!-- Quick thoughts. Review these for anything that should become a HubSpot record. -->
```

- [ ] **Step 6: Commit**

```bash
git add vault-template/templates/
git commit -m "feat(vault): note templates carrying the frontmatter contract

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: Cowork prompts

**Files:**
- Create: `vault-template/prompts/README.md`
- Create: `vault-template/prompts/enterpret-sync.md`
- Create: `vault-template/prompts/weekly-content-planning.md`
- Create: `vault-template/prompts/coverage-gaps.md`
- Create: `vault-template/prompts/changelog-from-linear.md`
- Create: `vault-template/prompts/daily-pipeline-digest.md`

**Interfaces:**
- Consumes: the portal/pipeline reference values from this plan's header; the frontmatter contract from Task 1.
- Produces: prompt files whose embedded ids are asserted by Task 4's test against `src/app/lib/portal-config.ts`.

- [ ] **Step 1: `prompts/README.md`**

````markdown
# Cowork prompts

Paste one of these into Cowork with the Obsidian folder connected. Each is self-contained —
Cowork has none of the `hubspot-central-brain` repo's context, so ids and property names are
inline.

## ⚠️ These are unverified

Nobody has watched Cowork execute them. The **API facts** inside — portal ids, object type ids,
property names, endpoint paths — are verified against the live dev portal. The **prompt phrasing**,
and every assumption about what Cowork does with a connected folder, is not.

Treat them as starting points to edit, not instructions to trust. When one turns out to be wrong,
fix it here so the next run starts better.

## Before first use

Replace `<VAULT_NAME>` throughout with your actual vault name, so the `obsidian://` links resolve.

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
````

- [ ] **Step 2: `prompts/enterpret-sync.md`**

````markdown
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
````

- [ ] **Step 3: `prompts/weekly-content-planning.md`**

````markdown
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
````

- [ ] **Step 4: `prompts/coverage-gaps.md`**

````markdown
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
````

- [ ] **Step 5: `prompts/changelog-from-linear.md`**

````markdown
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
   "source_url":"obsidian://open?vault=<VAULT_NAME>&file=changelogs%2F<slug>.md"
}}
```

Changelog stages: `1426412984` Identified · `1426412985` Drafting · `1426413056` Reviewing ·
`1426413057` Published

## 4. Close the loop

Put the returned record id into the note's `hubspot_id`. Both sides now point at each other and
neither is synced again.
````

- [ ] **Step 6: `prompts/daily-pipeline-digest.md`**

````markdown
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
````

- [ ] **Step 7: Commit**

```bash
git add vault-template/prompts/
git commit -m "feat(vault): Cowork prompt library, marked unverified

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: Structural verification

**Files:**
- Create: `src/app/__tests__/vault-template.test.ts`

**Interfaces:**
- Consumes: the tree from Task 1, templates from Task 2, prompts from Task 3; `PORTAL_CONFIGS` ids via `src/app/lib/portal-config.ts`.
- Produces: nothing consumed downstream — this is the gate.

Why a test rather than a checklist: a wrong portal id inside a self-contained prompt is invisible
from Cowork's side. The failure mode is a Cowork session quietly reading the wrong portal.

- [ ] **Step 1: Write the test**

```ts
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

/**
 * The vault template ships no runtime code, so these checks are structural.
 *
 * The important one is the id assertion: prompts are deliberately self-contained,
 * which means a stale portal or object-type id inside one cannot be caught by
 * anything on the Cowork side. It would just read the wrong portal.
 */

const ROOT = path.resolve(__dirname, '../../../vault-template');

const REQUIRED_DIRS = [
  'daily', 'meetings', 'content', 'changelogs',
  'references', 'references/enterpret/themes',
  'templates', 'prompts',
];

const TEMPLATES = [
  'content-brief.md', 'changelog.md', 'meeting-note.md',
  'enterpret-theme.md', 'daily-note.md',
];

const PROMPTS = [
  'README.md', 'enterpret-sync.md', 'weekly-content-planning.md',
  'coverage-gaps.md', 'changelog-from-linear.md', 'daily-pipeline-digest.md',
];

function read(rel: string): string {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

describe('vault template structure', () => {
  it.each(REQUIRED_DIRS)('%s exists', dir => {
    expect(fs.statSync(path.join(ROOT, dir)).isDirectory()).toBe(true);
  });

  // Git does not track empty directories. Without .gitkeep these vanish on
  // clone — the same way assets/ and styles/ did earlier in this project.
  it.each(REQUIRED_DIRS)('%s has a .gitkeep so it survives a clone', dir => {
    expect(fs.existsSync(path.join(ROOT, dir, '.gitkeep'))).toBe(true);
  });

  it('has a README', () => {
    expect(read('README.md')).toContain('linkage contract');
  });
});

describe('note templates', () => {
  it.each(TEMPLATES)('%s exists and opens with YAML frontmatter', file => {
    const body = read(path.join('templates', file));
    expect(body.startsWith('---\n')).toBe(true);
    expect(body.indexOf('\n---', 3)).toBeGreaterThan(0);
  });

  it.each(['content-brief.md', 'changelog.md'])(
    '%s points at content_piece, never the vestigial changelog_entry',
    file => {
      const body = read(path.join('templates', file));
      expect(body).toContain('hubspot_object: content_piece');
      expect(body).not.toContain('changelog_entry');
    },
  );

  it('changelog template uses the changelog pipeline', () => {
    expect(read('templates/changelog.md')).toContain('hubspot_pipeline: changelog');
  });

  it('enterpret theme template uses a sentiment normaliseSentiment produces', () => {
    const body = read('templates/enterpret-theme.md');
    expect(['positive', 'negative', 'neutral'].some(s =>
      body.includes(`dominant_sentiment: ${s}`))).toBe(true);
  });
});

describe('Cowork prompts', () => {
  it.each(PROMPTS)('%s exists', file => {
    expect(fs.existsSync(path.join(ROOT, 'prompts', file))).toBe(true);
  });

  it.each(PROMPTS.filter(f => f !== 'README.md'))(
    '%s carries the unverified banner',
    file => {
      expect(read(path.join('prompts', file))).toContain('Unverified');
    },
  );

  // The load-bearing assertion. Every id a prompt embeds must match the codebase.
  it('every id in every prompt matches portal-config', () => {
    const config = fs.readFileSync(
      path.resolve(__dirname, '../lib/portal-config.ts'), 'utf8');

    const KNOWN = ['51869810', '2-67505887', '2-67505890', '926238627', '929918080'];
    for (const id of KNOWN) expect(config).toContain(id);

    for (const file of PROMPTS) {
      const body = read(path.join('prompts', file));
      // object type ids look like 2-XXXXXXXX; every one must be real
      for (const m of body.matchAll(/\b2-\d{7,9}\b/g)) {
        expect(config, `${file} references unknown object type ${m[0]}`)
          .toContain(m[0]);
      }
      // 9-10 digit ids in prompts are portals or pipelines; all must be real
      for (const m of body.matchAll(/\b\d{9,10}\b/g)) {
        expect(config, `${file} references unknown id ${m[0]}`).toContain(m[0]);
      }
    }
  });

  it('no prompt uses the changelog pipeline against staging or prod', () => {
    for (const file of PROMPTS) {
      const body = read(path.join('prompts', file));
      if (body.includes('929918080')) {
        expect(body, `${file} must scope changelog work to dev`).toContain('51869810');
        expect(body).not.toContain('51869787');
        expect(body).not.toContain('22047910');
      }
    }
  });
});
```

- [ ] **Step 2: Run it**

Run: `npx vitest run src/app/__tests__/vault-template.test.ts`
Expected: PASS. If the id assertion fails it names the offending file and id — fix the prompt, not the test.

- [ ] **Step 3: Confirm nothing else regressed**

Run: `npm run validate`
Expected: exits 0.

- [ ] **Step 4: Commit**

```bash
git add src/app/__tests__/vault-template.test.ts
git commit -m "test(vault): structural checks incl. prompt id verification

Prompts are self-contained by design, so a stale portal or object-type id
inside one is invisible from the Cowork side — it would silently read the
wrong portal. This asserts every embedded id exists in portal-config.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage:**
- Folder tree matching strategy §6.1 → Task 1
- `.gitkeep` in every empty dir → Task 1 Step 1, asserted Task 4
- Linkage contract documented → Task 1 Step 2 README
- Written-once rationale (echo loops) → Task 1 Step 2
- `hubspot_object` always `content_piece` → Task 1 README, Task 2 Steps 1–2, asserted Task 4
- Five templates → Task 2
- Enterpret theme folder + note shape → Task 1 tree, Task 2 Step 4
- Five prompts, self-contained → Task 3
- Unverified banner → Task 3 Steps 1–6, asserted Task 4
- Materialization instructions → Task 1 README
- Verification 1 (tree survives copy) → Task 1 Step 3, Task 4
- Verification 2 (templates parse) → Task 4
- Verification 3 (ids match) → Task 4
- Verification 4 (`validate` passes) → Task 4 Step 3

No spec requirement is unimplemented.

**Placeholder scan:** No TBD/TODO. `<slug>`, `<VAULT_NAME>`, `<today>`, `{{title}}` are deliberate template placeholders documented at their use site, not unfinished work. Every file's full content is given.

**Type consistency:** Frontmatter keys are identical across Task 1's README, Task 2's templates and Task 4's assertions — `hubspot_object`, `hubspot_id`, `hubspot_portal`, `hubspot_pipeline`, `content_type`, `topic_tags`, `enterpret_theme`. Sentiment values match `normaliseSentiment`. Portal, object-type, pipeline and stage ids are identical between this plan's header table, Task 3's prompts and Task 4's `KNOWN` list.
