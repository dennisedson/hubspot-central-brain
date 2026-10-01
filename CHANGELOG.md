# Changelog

What has happened to the Central Brain, newest first. Written to be read by a
person catching up, so related commits are grouped into the change they
represent rather than listed one by one.

New to the project? Start with [`docs/PROJECT-CONTEXT.md`](docs/PROJECT-CONTEXT.md),
then the top few entries here.

Dates are the dates the work landed. Numbers in brackets are pull requests
unless the text says issue.

---

## 2026-09-30

### Shared instructions, so both machines know the rules — [#77] (open)

The trigger: the settings rebuild below shipped **333 lines with no new tests**.
The suite sat at 999 before it and 999 after. Every rule the other machine's
session had been following lived in a chat window.

- `CLAUDE.md` rewritten. It had held exactly one rule (generate episode guides);
  it now carries the testing rule with its receipts, how to test rather than just
  that you must, the seven traps that have each cost a day, and the process.
  Also renamed `claude.md` → `CLAUDE.md` — macOS's case-insensitive filesystem
  had hidden that the lowercase name is not picked up on a case-sensitive one.
- `docs/ARCHITECTURE.md` added: six Mermaid diagrams covering the whole system,
  the Linear webhook's guard chain, the settings record, the data model, what is
  actually scheduled, and the four separate homes credentials live in.
- `provision-asana-property.ts` no longer exits 1 when `changelog_entry` is
  missing — its absence is now the expected state.

### The changelog object, decided twice in five minutes

`351b42d` split changelog records onto their own custom object, adding an
`objectTypeId` per pipeline. `8008340` reverted it. **A changelog is content**:
separate objects mean duplicate properties, duplicate associations and routing
complexity for no benefit, and the workflow actions already discriminate on an
`objectType` input field rather than on which object called them. The 2026-08-26
decision stands.

### Settings: routing Linear projects, and importing history — [#63]–[#76]

A full day of making the settings page usable by the operator rather than by its
author. In rough order:

- **The view would not render at all.** Three separate causes, each found only by
  deploying: the root element was missing after a revert ([#63], [#64]); a raw
  `<strong>` took the whole view down, because UI extensions are remote
  components with no DOM ([#68]); and after the second, the page was stripped
  back to a version known to render and rebuilt from there ([#69], [#70]).
  `src/app/__tests__/ui-no-raw-html.test.ts` now enforces the second one.
- **Import preview** ([#65], [#66]). The historical import writes nothing until
  you have seen what it would write and chosen from it.
- **Project routing** ([#65], [#67]). Linear projects map to `content`,
  `changelog` or `ignore`. Classification consults the project map first and
  falls back to the label, and the **live webhook routes by the same map** — the
  import and the webhook must not disagree about what a project is. Projects
  seen in the wild that nobody has routed raise a banner.
- **"Any team" left nobody to pick as the assignee** ([#71]). The sentinel
  `'any'` is truthy, so a truthiness check read it as a real team id and the
  assignee dropdown queried a team that does not exist. Episode 55.
- **One page is not a list** ([#72]). The user list was truncated at 250 of 452
  and the project list at 250 of 1,592 — then sorted alphabetically, so both read
  as complete A–Z sweeps with the middle missing. Both now paginate.
- **Project list scoped to your work** ([#73], [#74], [#75]). Filtering by project
  *membership* returned projects the operator had no issues in; it now filters by
  projects they are assigned issues in. Stale unmapped projects are no longer
  merged back into the routing list.
- **The import is gated on routing being done** ([#76]). Importing before the
  projects are mapped imports everything as content.

The `AppSettingsApi` half of this work — the project queries, the unmapped merge,
the import gate — landed across six commits that touched **no test file**. That
gap is open.

### Other

- CI: the Claude review workflow reads its WIF config from secrets rather than
  variables, and the OIDC step now fails loudly instead of passing a bad token
  downstream (`b9af4f7`, `e540cf9`).
- Issue [#62] filed: **evaluate HubDB** for app configuration and sync state.
  Deliberately not an MVP change — it records the reasoning and the four things
  to check so it is a decision next time rather than an assumption.
- Episodes 55 and 56 written.

---

## 2026-09-29

The production-readiness day — 46 commits, 26 pull requests. Production went
from "deployed" to "actually guarded."

### Staging was deleted — [#37]

There were three portals. Staging pointed at the **real production Asana
project**, the same project and the same two sections as prod, while having no
changelog pipeline of its own. It had been unmaintained for the life of the
project. An environment nobody keeps current gives false confidence and becomes
somewhere wrong-portal writes can originate.

Deleting the entry from `portal-config.ts` was the safety change, not deleting
the workflow — `getPortalConfig` throws on an unknown portal, so the removal
converts "silently writes to the wrong portal" into "refuses to start." The
branch model is now feature branch → `develop` → dev, `master` → prod by hand.
Episode 53.

### Preflight replaced it — [#36], [#42], [#43], [#52]

`npm run preflight` asserts, against the live target portal and before a prod
deploy: object type ids exist, pipelines exist, stages exist inside them, and
every property the app reads or writes exists on its object. It also checks the
Projects object is active and prints a **fingerprint of the key in use**, because
the same credential lives in four different places and rotating one does not
rotate the others. It deliberately does not check secrets — `hs project deploy`
already does, and a second list that could disagree would be worse than none.

### The webhook now fails closed — [#46], [#47]

Production had its Linear webhook registered before its settings were saved, and
**34 Content Pieces arrived from teams nobody had chosen**, against live data.
The defaults were permissive — an empty team id skipped the team filter and
`assigneeFilter: 'all'` excluded nobody — so the portal that should have synced
nothing synced everything. `isConfigured()` is now checked *before* the team
filter, and that order is load-bearing.

### Assignee-first sync — [#55], [#56]

"Issues assigned to me, wherever they live" is now a complete configuration; a
team is optional on top of it. Measured on production: **83 issues assigned to
one person across four teams, 75 of them outside the single configured team** —
the filter was capturing 5% of the work it was meant to.

### Importing the issues that predate the webhook — [#48]–[#54]

A backfill script first ([#48]), then the same thing from the settings page
([#50]). Two bugs in it were about where a key comes from: `LINEAR_API_KEY` was
read from `process.env` instead of through `loadEnv`, and it needed resolving per
portal ([#54]).

### Settings page, first round — [#57]–[#61]

The import section had been placed inside `Form`, so it never rendered at all
([#57]). The button was then moved to the page people actually open ([#59]), and
the `type: "settings"` component was deleted outright ([#60]) — it renders
nowhere for a private app. `src/app/pages/SettingsApp.tsx` is the settings page.

### Also

- **The Linear teams list was showing the first 50** of several hundred ([#44],
  [#45]). Linear defaults a connection to 50 and caps a page at 250; one request
  is a page, not a set.
- **Prod's changelog pipeline was configured** (`3d3916f`), which is the substance
  of issue [#21] — still open, worth verifying and closing.
- **App scopes trimmed** to the ones the app actually uses ([#40], [#41]). An
  unfulfillable scope fails the whole install without naming itself.
- **CI: the validate job could not see its secrets** ([#38]). A GitHub
  *environment* secret read from a job with no `environment:` resolves to an
  empty string rather than failing. Same job also needed Node 20 for the CLI.
- **Operator guide caught up with what actually shipped** ([#39]), including that
  deploying is not installing — and the guide had never said so.

---

## 2026-09-28

### Outline became the threshold — episode 52

The vault got a front door into HubSpot, and the rule that governs it: **ideas
never reach the CRM.** A note promoted to `content_piece` lands at **Outline**,
not Idea, and Outline is the single threshold that creates **both** the Linear
issue and the Asana task. Two thresholds would give you a record with an issue
and no task and no way to tell whether that was the rule working or a failure.

That required a create path where only an update path had existed — and with it
the two things a create path chosen by a missing id always needs: the `[hs-sync]`
origin tag (written inside the client, so a caller cannot forget it) and the id
write-back in the same run. Without the write-back the create branch is taken
again on every subsequent update; the demo for that episode is fifty identical
Linear issues, created four minutes apart, with every call returning 200.

### YouTube

- The daily sync is **actually daily** now — a GitHub Actions cron. HubSpot
  Projects serverless has no scheduler, and the three workflows named "(Daily)"
  enrol with `type: 'MANUAL'`. They only ever ran when somebody pressed
  something.
- The channel id moved from a secret to the `app_configs` record — a function can
  read a secret but cannot write one, and the OAuth callback needs to write.
- Stopped requesting `impressions` and `click_through_rate`: they are not metrics
  of the Analytics `reports.query` surface, which answers
  `400 Unknown identifier`.
- **The analytics signal must never be null.** HubSpot drops null properties when
  a handler returns `body` as an object, so a skipped analytics call was
  indistinguishable from a successful one. Episode 51.
- Video card: the watch URL is derived rather than stored, and the sync button
  both 500'd and, when it worked, swept every video instead of the one you were
  looking at.

### Vault documentation, corrected by running it

Five fixes from following the setup as a stranger would: a space in the vault
name, one machine's repo path hardcoded, a clone instruction pointing at a branch
without the template, SETUP and the operator guide disagreeing about Cowork, and
no statement of how the prompts are actually run.

---

## 2026-09-14

- **An end-to-end test plan** (`docs/TEST-PLAN.md`) — a script for driving the
  system by hand with recorded outcomes rather than predictions, plus a
  do-not-file list. Six commits immediately after it are the plan auditing
  itself: a test that named the API identifier instead of what the screen shows,
  one that described a create as an update, one that attributed the Asana task to
  the wrong step.
- **Excluded issues are archived, not skipped.** Skipping leaves the HubSpot
  record frozen at its last synced stage — still in the pipeline, looking live,
  tracking nothing, returning 200 the whole time.
- Asana tasks are now assigned, and carry the target date.
- The status card called a linked record "Not linked to Asana."

## 2026-09-10 – 2026-09-11

- The Video layer got its surface (the Video card) and its coverage — the
  libraries, the sync orchestration, the attribution gates and the card's read
  API.
- **WebSub push notifications: half-working and therefore worse than broken.**
  Subscription and hub verification both succeed; delivery cannot, because
  HubSpot's gateway accepts only `application/json` and YouTube's hub sends
  `application/atom+xml`. A subscription that verifies, looks established and
  delivers nothing. Episode 49.
- URL query params come from `context.params` and arrive as arrays — discovered
  rather than documented. Episode 48.
- The Claude client calls the Messages API over `fetch` rather than the SDK.
- A placeholder refresh token is now treated as absent, not as a token.
- Corrected in the docs: the runtime secret store is `hs secrets`, not
  `hs app secret`.

## 2026-09-09

- **The Video layer was ported from Creator Console** (a Firebase app) onto
  HubSpot. Most of a port is deletion — episode 47.
- **An operator guide** (`docs/OPERATOR-GUIDE.md`): the whole journey from a
  fresh portal to daily use, written for the person clicking rather than the
  person deploying, and honest about which layers give nothing back yet.
- **The setup path was made reproducible from the README** by executing it as a
  stranger, which found a broken provisioning path and a misleading auth error:
  an expired private app token reports as `expired 20705 day(s) ago` — epoch
  zero, meaning unparseable, not old. Episodes 45 and 46.
- Breeze agent tools declared `WORKFLOWS` alongside `AGENTS`. **The UNAUTHORIZED
  error did not move, and has not moved since.** Issue [#23].
- The two inferred HubSpot API shapes were confirmed against the docs (issue [#8]).
- Workflow action input fields take exactly one `supportedValueType`, with a test.

## 2026-09-07 – 2026-09-08

- **Three Breeze agent tools** — Content Pipeline Query, Friction Finder, Meeting
  Router — built, then fixed through deploy blockers, published so they appear in
  the agent builder, and corrected where counts and dates disagreed with what the
  tool listed. Episodes 41 and 42.
- **The deploy had been shipping the wrong portal's URLs.** The `sed` that
  substituted action URLs stopped matching and exited 0. It now points at the
  target portal and verifies that it happened. Episode 43.
- **CI triggered on a branch that does not exist** — zero checks, silently.
  Episode 44.
- Phase 5 filed as issues [#23]–[#34]: Breeze Studio agents, Knowledge Vaults,
  Data Agent actions, goal tracking, the webhooks journal, AEO, intent signals.

## 2026-09-04

- **AI-friendly descriptions on every custom property** (issue [#22]). Connectors
  and agents read schema descriptions as context, so a field's description is
  part of the prompt. Episode 40.

## 2026-09-03

- **The dated-API migration finished** (issue [#14]). Associations, properties,
  pipelines and schemas moved to the `2026-03` paths — and schemas turned out to
  live under a different base path from every other CRM family, which is the kind
  of thing you only learn by probing a live portal. Episodes 35 and 38.
- **Self-associations that actually work** (issue [#3]). Labeled, discovered at
  runtime rather than assumed. Without `provision:associations` the
  `associate_related_content` action 4xxs on every call — the quiet one.
- **Enterpret reads synced data instead of calling the API** (issue [#12]). The
  live HTTP call was removed; the card renders what was stored. Episode 36.
- **A Changelog Manager view** (issue [#13]), as a third route inside the one
  page HubSpot Projects allows. It compared stage ids to labels at first and
  showed nothing. Episode 37.
- **The Obsidian vault scaffolding**: folder tree, note templates carrying the
  frontmatter contract, a Cowork prompt library (marked unverified from the
  start), structural tests, and a beginner's setup guide. The linkage is
  write-once in each direction so the two systems cannot echo at each other.
  Episode 39.
- `npm run validate` unblocked (issue [#5]) and the UI extensions typechecked by
  CI for the first time (issue [#6]). Cards pass `portalId` explicitly —
  `hubspot.serverless()` does not populate `accountId` (issue [#7]).
- Claude Code GitHub Actions added ([#20]).

## 2026-09-02

The largest single day in the project — 66 commits, most of Phase 4.

- **The Content Command Center**, an app page with a kanban board over the
  content pipeline. HubSpot Projects allows **one page per project**, so the
  command center, the settings view and the Changelog Manager were merged behind
  one entry point.
- **The Linear/Asana status card**: pipeline-aware drift comparison, single-record
  reads on both clients, and a live cross-system status inside a HubSpot record.
  Episode 27.
- **Related Content, Meeting Intelligence and the social draft generator.**
  Related content is scored and explains its reasoning; social drafts are
  template-driven and never overwrite a human's text. Episodes 28 and 29.
- **The Enterpret card scaffolded and deployed without its key** — finished
  except for an integration that could not be obtained. Episode 30.
- **API paths centralised** ahead of the dated migration, then the CRM objects
  family migrated. The tests were pinned to the URL first, because a migration
  you cannot verify is a rewrite you are hoping about. Episodes 31 and 32.
- **The CMS React dashboard**, and the bisect that produced it. A deploy failing
  with an empty error message, bisected rung by rung from a minimum-viable
  component up — and the first conclusion (that the `fields` export was the
  cause) was wrong and had to be retracted, because the harness was
  non-deterministic. Episodes 23–26.
- CI stopped deploying every build twice (`--skip-auto-deploy`).

## 2026-09-01

- **`AsanaPoll` replaced the Asana push webhook.** HubSpot strips the
  `X-Hook-Secret` header, so the handshake could never complete. The poll stores
  its sync token on the App Config record — a function can read a secret but
  cannot write one, so a CRM record is the only writable persistence available.
  Episode 20.
- **Fellow meeting action items sync to HubSpot Projects**, deduped on
  `fellow_action_item_id`, with pipeline and stage ids resolved dynamically by
  label instead of hardcoded. Episode 21.
- Settings calls switched back to `hubspot.serverless()`: the app-function type
  needs it, not a CMS-style `hubspot.fetch()` to an `hs-sites.com` URL.

## 2026-08-31

- **An Asana → HubSpot webhook listener** with echo prevention, closing the loop
  so a change made in Asana reaches the CRM. Episode 19.

## 2026-08-28

Five bugs in one session, all in the Linear/Asana chain — episode 17.

- Linear webhook labels arrive as a **flat array**, not GraphQL `nodes`.
- Skip the upsert when the HubSpot stage already matches, to stop Linear's
  double-fire triggering the workflow twice.
- The dedup read uses `GET`, not search: **search index replication lag** let two
  webhooks each complete a write before either could see the other's.
- Asana's `GET /tasks` **silently ignores custom field filters**; the workspace
  search endpoint is the one that honours them. Episode 18.
- `asana_task_url` is written back after the first sync, so later runs skip the
  search entirely. Episode 13.
- `hs_object_id` is not auto-injected into a custom action's callback body; it
  has to be passed as an explicit `objectId` field.

## 2026-08-26 – 2026-08-27

- **`changelog_entry` was consolidated into `content_piece` with two pipelines**
  (`ab353d7`) — the decision that still stands. Episode 15.
- **The Asana integration**: `SyncToAsana`, upsert-on-sync, section-aware task
  creation, and `asana_task_url` provisioned on the schema. Episode 13.
- **Dev routed to a dedicated test Asana project** rather than the real one.
  Episode 14.
- **Atomic upserts via a unique `linear_id`.** Search-then-create produced
  duplicate records under concurrent webhooks. PATCH-by-idProperty needs
  `hasUniqueValue`, which HubSpot will not set on an existing property that holds
  data — so the fix was a new property, and a script that deletes and recreates
  it, with `linear_issue_id` kept for display.
- `provision:workflows` added, using the automation v4 flows API.

## 2026-08-24 – 2026-08-25

- **The app settings page**, and the discovery that `@hubspot/api-client` at
  runtime makes private app-functions fail to invoke — rewritten on native
  `fetch`. Episode 10.
- **No UUIDs on screen**: the Linear team and member inputs became dropdowns.
  Episode 07b.
- Linear teams are looked up **by key**, so short identifiers like `DAD` work.
- Assignee filtering added to the webhook.
- Sentry telemetry, because function logs were otherwise invisible. Episode 09.

## 2026-08-14

- **Multi-portal provisioning and a per-portal config map** — one codebase,
  several portals, resolved at runtime. Episode 05.
- **The webhook auth marathon.** HMAC verification was built, debugged, restored,
  rebuilt as query-token auth, and finally removed: HubSpot's gateway strips both
  custom headers *and* query params, so neither scheme can be verified at the
  function. Episode 07.
- Functions are bundled with esbuild so local `lib/` imports actually ship.
- `PRIVATE_APP_ACCESS_TOKEN` is a reserved name; the secret is `HS_ACCESS_TOKEN`.
- Several CI traps: Node 20 for HubSpot CLI v8, `master` not `main`,
  `hs-sites.com` for function URLs, and `sed` substitution of the action URL
  before upload. Episode 06.

## 2026-08-10 – 2026-08-12 — Phase 1+2 — [#1]

The foundation, in one week.

- TypeScript, ESLint (flat config, strict) and Vitest.
- HMAC-SHA256 verification, and the pipeline-stage ↔ Linear-state mapping tables.
- A type-safe HubSpot CRM client with upsert logic (episode 02) and a Linear
  GraphQL client.
- `LinearWebhook` — the receiver, with echo suppression via the `[hs-sync]` tag
  from day one (episode 01).
- `SyncToLinear` — the first custom workflow action, HubSpot back to Linear
  (episodes 03 and 08).
- Portal provisioning for custom objects and pipelines (episode 04).

[#1]: https://github.com/dennisedson/hubspot-central-brain/issues/1
[#3]: https://github.com/dennisedson/hubspot-central-brain/issues/3
[#5]: https://github.com/dennisedson/hubspot-central-brain/issues/5
[#6]: https://github.com/dennisedson/hubspot-central-brain/issues/6
[#7]: https://github.com/dennisedson/hubspot-central-brain/issues/7
[#8]: https://github.com/dennisedson/hubspot-central-brain/issues/8
[#12]: https://github.com/dennisedson/hubspot-central-brain/issues/12
[#13]: https://github.com/dennisedson/hubspot-central-brain/issues/13
[#14]: https://github.com/dennisedson/hubspot-central-brain/issues/14
[#20]: https://github.com/dennisedson/hubspot-central-brain/issues/20
[#21]: https://github.com/dennisedson/hubspot-central-brain/issues/21
[#22]: https://github.com/dennisedson/hubspot-central-brain/issues/22
[#23]: https://github.com/dennisedson/hubspot-central-brain/issues/23
[#34]: https://github.com/dennisedson/hubspot-central-brain/issues/34
[#36]: https://github.com/dennisedson/hubspot-central-brain/issues/36
[#37]: https://github.com/dennisedson/hubspot-central-brain/issues/37
[#38]: https://github.com/dennisedson/hubspot-central-brain/issues/38
[#39]: https://github.com/dennisedson/hubspot-central-brain/issues/39
[#40]: https://github.com/dennisedson/hubspot-central-brain/issues/40
[#41]: https://github.com/dennisedson/hubspot-central-brain/issues/41
[#42]: https://github.com/dennisedson/hubspot-central-brain/issues/42
[#43]: https://github.com/dennisedson/hubspot-central-brain/issues/43
[#44]: https://github.com/dennisedson/hubspot-central-brain/issues/44
[#45]: https://github.com/dennisedson/hubspot-central-brain/issues/45
[#46]: https://github.com/dennisedson/hubspot-central-brain/issues/46
[#47]: https://github.com/dennisedson/hubspot-central-brain/issues/47
[#48]: https://github.com/dennisedson/hubspot-central-brain/issues/48
[#50]: https://github.com/dennisedson/hubspot-central-brain/issues/50
[#52]: https://github.com/dennisedson/hubspot-central-brain/issues/52
[#54]: https://github.com/dennisedson/hubspot-central-brain/issues/54
[#55]: https://github.com/dennisedson/hubspot-central-brain/issues/55
[#56]: https://github.com/dennisedson/hubspot-central-brain/issues/56
[#57]: https://github.com/dennisedson/hubspot-central-brain/issues/57
[#59]: https://github.com/dennisedson/hubspot-central-brain/issues/59
[#60]: https://github.com/dennisedson/hubspot-central-brain/issues/60
[#61]: https://github.com/dennisedson/hubspot-central-brain/issues/61
[#62]: https://github.com/dennisedson/hubspot-central-brain/issues/62
[#63]: https://github.com/dennisedson/hubspot-central-brain/issues/63
[#64]: https://github.com/dennisedson/hubspot-central-brain/issues/64
[#65]: https://github.com/dennisedson/hubspot-central-brain/issues/65
[#66]: https://github.com/dennisedson/hubspot-central-brain/issues/66
[#67]: https://github.com/dennisedson/hubspot-central-brain/issues/67
[#68]: https://github.com/dennisedson/hubspot-central-brain/issues/68
[#69]: https://github.com/dennisedson/hubspot-central-brain/issues/69
[#70]: https://github.com/dennisedson/hubspot-central-brain/issues/70
[#71]: https://github.com/dennisedson/hubspot-central-brain/issues/71
[#72]: https://github.com/dennisedson/hubspot-central-brain/issues/72
[#73]: https://github.com/dennisedson/hubspot-central-brain/issues/73
[#74]: https://github.com/dennisedson/hubspot-central-brain/issues/74
[#75]: https://github.com/dennisedson/hubspot-central-brain/issues/75
[#76]: https://github.com/dennisedson/hubspot-central-brain/issues/76
[#77]: https://github.com/dennisedson/hubspot-central-brain/pull/77
