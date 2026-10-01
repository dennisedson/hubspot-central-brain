# Architecture

How the Central Brain fits together. Read this before changing sync behaviour —
most of the bugs in this repo's history came from not knowing which component
owned a decision.

GitHub renders the diagrams below. Both machines see this file because it is
checked in; nothing here lives in a chat window or a local note.

---

## 1. The whole system

```mermaid
flowchart LR
    subgraph local["LOCAL — your machine"]
        vault["Obsidian vault<br/>notes, ideas, changelog drafts"]
        cowork["Cowork<br/>runs vault-template/prompts/"]
        vault <--> cowork
    end

    subgraph ext["EXTERNAL SYSTEMS"]
        linear["Linear<br/>issues"]
        asana["Asana<br/>tasks"]
        fellow["Fellow<br/>meeting action items"]
        yt["YouTube<br/>videos + analytics"]
        enterpret["Enterpret<br/>customer feedback"]
    end

    subgraph hs["HUBSPOT PORTAL"]
        content["content_piece<br/>TWO pipelines: content + changelog"]
        video["video"]
        cfg["app_configs / app_settings<br/>one record, holds all settings"]
    end

    vault -->|"promote to Outline"| linear
    vault -->|"promote to Outline"| asana
    linear <-->|"webhook out / workflow action back"| content
    asana <-->|"workflow action out / webhook + poll back"| content
    fellow -->|FellowSync| content
    yt -->|"YouTubeSync (daily)"| video
    enterpret -->|card reads on demand| hs
    cfg -.->|"gates every sync"| content
```

**The rule that matters:** a note becomes an Outline before anything leaves
your machine. Ideas stay local. Promotion to Outline is the single threshold
that creates both the Linear issue and the Asana task.

---

## 2. Linear → HubSpot (the path that writes records)

This is the flow that once created 34 unwanted records on production. Every
guard below exists because something got through.

```mermaid
flowchart TD
    hook["Linear webhook fires"] --> type{"type == Issue?"}
    type -->|no| skip1["200 skipped"]
    type -->|yes| echo{"description contains<br/>[hs-sync] tag?"}
    echo -->|yes| skip2["200 skipped — our own write"]
    echo -->|no| proj["look up project<br/>(only if a map exists)"]
    proj --> record["record project if nobody<br/>has mapped it yet"]
    record --> classify["classifyIssue:<br/>project map, then label,<br/>then default to content"]
    classify --> ign{"mapped to ignore?"}
    ign -->|yes| skip3["200 skipped"]
    ign -->|no| conf{"isConfigured?"}
    conf -->|no| skip4["200 refused —<br/>settings never answered"]
    conf -->|yes| team{"isAnyTeam OR<br/>team matches?"}
    team -->|no| skip5["200 skipped"]
    team -->|yes| act{"action == remove?"}
    act -->|yes| arch["archive the record"]
    act -->|no| assignee{"passes assignee filter?"}
    assignee -->|no| arch2["ARCHIVE, not skip —<br/>a frozen record lies"]
    assignee -->|yes| stage{"current stage already<br/>maps to this state?"}
    stage -->|yes| skip6["200 skipped — echo"]
    stage -->|no| up["upsertContent<br/>content or changelog pipeline"]

    style conf fill:#ffe6e6
    style skip4 fill:#ffe6e6
```

**`isConfigured` is checked before the team filter, and that order is load-bearing.**
The team filter fails open — an empty team id skips it — so an unconfigured
portal accepted every team until the gate above it existed.

**Excluded issues are archived, not skipped.** Skipping leaves the HubSpot
record frozen at its last synced stage: still in the pipeline, looking live, no
longer tracking anything, returning 200 the whole time.

---

## 3. Settings — one record gates everything

```mermaid
flowchart TD
    page["SettingsApp.tsx<br/>(reached from Content Command Center)"]
    api["AppSettingsApi.ts"]
    cfg["app_configs record"]
    linear["Linear API"]

    page -->|getSettings| api
    api -->|"teams, users, projects<br/>ALL PAGED"| linear
    api --> cfg
    cfg --> api
    api --> page
    page -->|saveSettings| api
    api -->|"refuses unless isConfigured"| cfg
    cfg -.->|read on every webhook| hook["LinearWebhook"]
    cfg -.->|read on every import| imp["backfillPreview / backfill"]
```

Stored on the single `app_configs` record:

| property | notes |
|---|---|
| `linear_team_id` | **primary display property** — HubSpot will not let it be cleared, so "any team" is the sentinel string `'any'`, never `''`. Always read it through `isAnyTeam()`. |
| `assignee_filter` | `all` \| `assigned` \| `mine` |
| `linear_assignee_id` | required when the filter is `mine` |
| `linear_project_map` | `{ projectId: 'content' \| 'changelog' \| 'ignore' }` |
| `linear_unmapped_projects` | projects seen in the wild that nobody has routed yet; drives the banner |

---

## 4. The data model

```mermaid
flowchart LR
    cp["content_piece"]
    p1["pipeline: content<br/>idea → outline → drafting →<br/>editing → review → published → archived"]
    p2["pipeline: changelog<br/>identified → drafting →<br/>reviewing → published"]
    cp --> p1
    cp --> p2
    v["video"]
    cfg["app_configs (dev) /<br/>app_settings (prod)"]
    ce["changelog_entry<br/>VESTIGIAL — 0 records"]

    style ce stroke-dasharray: 5 5
```

**A changelog is content.** It lives on `content_piece` in a second pipeline,
not in its own object — separate objects meant duplicate properties, duplicate
associations and routing complexity for no benefit. The workflow actions
distinguish the two with an `objectType: 'content' | 'changelog'` input field,
never by which HubSpot object they were called from.

`changelog_entry` still exists on both portals and holds zero records on each.
It is a leftover from before that consolidation.

---

## 5. What runs on a schedule, and what does not

| Thing | Trigger | Reality |
|---|---|---|
| `YouTubeSync` | GitHub Actions cron, daily | genuinely daily |
| "(Daily)" HubSpot workflows | `enrollmentSchedule` | genuinely daily at 17:00 — verified on dev. But the schedule is **set by hand in the UI**, not provisioned: a new portal gets the workflow without one |
| `AsanaPoll` | workflow action | pull-based, because Asana webhooks proved unreliable |
| `LinearWebhook` | Linear push | real-time |
| Deploys | merge to `develop` → Dev, `master` → Prod | see the deploy traps in `CLAUDE.md` |

---

## 6. Credentials — four separate homes

Getting these confused has cost more time than any bug in the app.

```mermaid
flowchart TD
    a["hs secrets<br/>runtime functions<br/>HS_ACCESS_TOKEN, LINEAR_API_KEY"]
    b["hs app secret (BETA)<br/>NOT validated at deploy"]
    c["local .env<br/>provisioning + preflight<br/>HUBSPOT_&lt;PORTAL&gt;_SERVICE_KEY"]
    d["GitHub ENVIRONMENT secrets<br/>CI only"]
```

A GitHub **environment** secret is invisible to a job that does not declare
`environment:` — `secrets.X` then resolves to an empty string rather than
failing. Rotating a key in one home does not rotate it in the others;
`npm run preflight` prints a key fingerprint so you can tell which one a portal
is actually using.
