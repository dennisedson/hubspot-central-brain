# HubSpot Central Brain

A HubSpot Projects app that powers the "Central Brain" system — syncing content, changelogs, and video records between HubSpot and external tools (Linear, Asana, Fellow, YouTube).

## Prerequisites

- **Node 20+.** `package.json` still declares `engines.node >=18` and the
  serverless bundle targets Node 18 (`esbuild --target=node18`), but **the
  HubSpot CLI needs 20**: it pulls ink → string-width, which uses the `v` regex
  flag introduced in Node 20, so on 18 the module fails to parse and the CLI
  never starts — `SyntaxError: Invalid regular expression flags`. CI runs the
  test job on 18 and every job that touches the CLI on 20.
- HubSpot CLI (`@hubspot/cli` — installed as a dev dependency)
- Two HubSpot portals: dev sandbox `51869810` and production `22047910`

## Quick Start

```bash
npm install
npm run lint        # ESLint (flat config, strict TS)
npm run typecheck   # tsc --noEmit
npm test            # Vitest
npm run validate    # all of the above + the three UI-extension typechecks
```

> **`npm run validate` does not prove the project will build.** Two failures in
> one day passed lint, typecheck, the whole suite, `hs project validate` and
> CI's Dry-Run Validate, then failed at `hs project upload` — which has no
> `--dry-run`. See `CLAUDE.md`.

> Setting this up as an operator rather than a developer? [`docs/OPERATOR-GUIDE.md`](docs/OPERATOR-GUIDE.md) walks the whole journey — portal, vault, Cowork, YouTube auth — and says which layers do not work yet. To verify it afterwards, [`docs/TEST-PLAN.md`](docs/TEST-PLAN.md) is a test script with recorded expected results and a do-not-file list.

## Setup (first run against a portal)

`hs project upload` deploys the app, but it does **not** create the data model the
app depends on. A freshly deployed portal has no Content, Video or App Config
object, no pipelines and no association definitions — every function will
fail until the provisioning scripts below have run.

Scripts select a portal with `PORTAL=dev|prod` (defaults to `dev`) and read
the matching `HUBSPOT_<PORTAL>_*` variables from `.env`. All of them read before they
write, so they are safe to re-run.

### 1. Credentials

Copy `.env.example` → `.env` and fill it in. `HUBSPOT_<PORTAL>_SERVICE_KEY` is the
private app token the scripts authenticate with; if provisioning 401s, regenerate it
in the portal rather than debugging the script.

### 2. Provision the data model — in this order

```bash
PORTAL=dev npm run provision                  # objects, pipelines, associations
PORTAL=dev npm run patch:unique-property      # unique linear_id on content_piece
PORTAL=dev npm run provision:associations     # pairings provision-objects misses (#3)
PORTAL=dev npm run provision:app-settings     # App Settings object
PORTAL=dev npm run provision:asana-property   # asana_task_url on Content + Changelog
PORTAL=dev npm run provision:asana-sync-token # needs App Settings to exist
PORTAL=dev npm run provision:fellow-sync      # needs App Settings to exist
PORTAL=dev npm run provision:youtube-config   # needed before YouTube auth
PORTAL=dev npm run provision:enterpret-quotes # enterpret_quotes on Content
PORTAL=dev npm run provision:changelog-drafting     # rollout dates, draft + prompt properties
PORTAL=dev npm run provision:property-descriptions  # run last — describes the rest
```

Order matters in three places: everything needs the objects from `provision`;
`asana-sync-token` and `fellow-sync` both write onto the App Settings object;
and `property-descriptions` only describes properties that already exist, so it
goes last.

Skipping `provision:associations` is the one that bites quietly — without it the
`associate_related_content` workflow action 4xxs on every association call.

### 3. App secrets

The deployed functions read secrets from HubSpot, **not** from `.env`. All **ten**
must exist before the app will *deploy* — a secret named in a function's hsmeta but
absent from the portal fails the whole deploy, so one missing secret blocks every
component.

**Use `hs secrets`, not `hs app secret`.** There are two stores and only the
account-level one is what the deploy validates against; a secret added with
`hs app secret` (BETA) still fails the deploy as missing. The deploy's own error
message names the right command. Check with `hs secrets list`.

```bash
hs secrets add HS_ACCESS_TOKEN        # named by 25 components — nothing works without it
hs secrets add LINEAR_API_KEY
hs secrets add LINEAR_WEBHOOK_SECRET
hs secrets add ASANA_API_KEY
hs secrets add FELLOW_API_KEY
hs secrets add SYNC_SHARED_SECRET
hs secrets add ANTHROPIC_API_KEY      # changelog drafting + video suggestions
hs secrets add YOUTUBE_CLIENT_ID
hs secrets add YOUTUBE_CLIENT_SECRET
hs secrets add YOUTUBE_REFRESH_TOKEN  # placeholder `pending` first — see the operator guide §1.3
```

### 4. Deploy, then finish the wiring

```bash
npm run build
npx hs project upload --skip-auto-deploy
npx hs project deploy --deploy-latest-build
```

Two steps must come **after** the deploy, because they need the app and its live
function URLs to exist:

```bash
PORTAL=dev npm run provision:workflows        # reads the deployed action definitions
PORTAL=dev npm run provision:asana-webhook <function-url>
```

> **Known broken (2026-09-09, still unconfirmed):** on a portal whose workflows
> already exist, `provision:workflows` fails with `400 Invalid request to flow
> update`. Creating workflows on a fresh portal (POST) is unaffected — only
> updating existing ones. Prod now carries all 8 workflows, which exercises the
> create path and says nothing about the update path. Until someone re-runs it
> and reports, edit existing workflows in the HubSpot UI.
>
> New workflows arrive `isEnabled: false` with no `enrollmentSchedule`. The two
> "(Daily)" poll workflows need enabling and a schedule set by hand — Edit →
> Enrollment triggers → "On a schedule" — which is how dev's run at 17:00. The
> script preserves an existing schedule on re-run.


### 5. Obsidian vault (optional)

The thinking/drafting layer is a plain folder of markdown. See
[`vault-template/SETUP.md`](vault-template/SETUP.md) — written for someone who has
never opened Obsidian.

## Project Structure

```
src/app/
  functions/          # Serverless app functions (webhook receivers, sync jobs, card APIs)
  workflow-actions/   # Custom workflow action definitions (hsmeta only)
  cards/              # CRM record cards
  pages/              # The one project page — Content Command Center + settings
  settings/           # The app Settings tab (Connected apps → the app → Settings)
  lib/                # Shared types, mapping configs, helpers
  telemetry/          # Telemetry extension hsmeta
  __tests__/          # Unit tests (Vitest)
src/scripts/          # Provisioning, preflight, backfills — run with tsx, never deployed
src/theme/            # CMS theme (central-brain-dashboard)
```

Each UI-extension directory (`cards/`, `pages/`, `settings/`) carries **its own
`package.json` and `tsconfig.json`**, which is why they need their own typecheck
scripts — the root typecheck cannot see them. HubSpot also bundles each one in
isolation, so **no relative import may leave an extension directory** — not into
a sibling extension and not into `lib/`;
`extension-imports-stay-local.test.ts` enforces that. Serverless functions are
exempt because `esbuild --bundle` inlines `../lib` before the upload, so HubSpot
only ever sees one self-contained file.

## CI/CD

All pipelines live in `.github/workflows/`:

| Workflow          | Trigger              | What it does                           |
| ----------------- | -------------------- | -------------------------------------- |
| `ci.yml`          | PR → master/develop  | Lint, typecheck, test, `typecheck:cards` + `typecheck:pages`, then HubSpot Dry-Run Validate. **Does not run `typecheck:settings`** — `npm run validate` locally does |
| `deploy-dev.yml`  | Push to `develop`    | All three extension typechecks, build, rewrite action URLs, upload to dev sandbox |
| `deploy-prod.yml` | Manual (`workflow_dispatch`) | Same, plus `npm run preflight` against prod before anything uploads |
| `youtube-sync.yml` | Cron `0 9 * * *` + manual | Sync YouTube metrics, asserting postconditions. **Dev only** — the portal input defaults to `51869810` |
| `credential-health.yml` | Cron `0 13 * * *` + manual | Asks the `app-health` function on both portals to probe every external credential |
| `claude.yml`      | `@claude` mention    | Mention-triggered assistant. Shares the broken federation config described in issue #98, so it will fail until that is fixed |

`claude-code-review.yml` was **removed on 2026-10-01** (PR #99). It never
produced a review: the green checks were skips and the red ones were auth
failures. Issue #98 has the one-field fix and how to put it back.

### GitHub Secrets (per environment)

The environments are named `dev` and `Prod`. (A `staging` environment also still
exists in GitHub, left over from the portal deleted on 2026-09-29.)

| Secret                               | Environment | Used by | Description                    |
| ------------------------------------ | ----------- | ------- | ------------------------------ |
| `HUBSPOT_DEV_ACCOUNT_ID`            | dev         | `ci.yml`, `deploy-dev.yml` | Dev sandbox portal ID |
| `HUBSPOT_DEV_PERSONAL_ACCESS_KEY`   | dev         | `ci.yml`, `deploy-dev.yml` | Dev sandbox PAK |
| `HUBSPOT_DEV_SYNC_SECRET`           | dev         | `credential-health.yml` | Authenticates the health probe. Not currently set — the dev check warns and skips |
| `HUBSPOT_PROD_ACCOUNT_ID`           | Prod        | `deploy-prod.yml` | Production portal ID |
| `HUBSPOT_PROD_PERSONAL_ACCESS_KEY`  | Prod        | `deploy-prod.yml` | Production portal PAK |
| `HUBSPOT_PROD_SERVICE_KEY`          | Prod        | `deploy-prod.yml` → `preflight` | Private app token the preflight reads the schema with |
| `HUBSPOT_PROD_DEVELOPER_KEY`        | Prod        | `deploy-prod.yml` → `preflight` | The automation actions API rejects OAuth tokens |
| `HUBSPOT_PROD_SYNC_SECRET`          | Prod        | `deploy-prod.yml`, `credential-health.yml` | Authenticates the health probe |
| `ASANA_API_KEY`                     | Prod        | `deploy-prod.yml` → `preflight` | |

> An **environment** secret is invisible to a job that does not declare
> `environment:` — `secrets.X` resolves to an empty string rather than failing.
> That is what broke CI's validate job (#38), and the symptom named a variable
> the workflow file never mentions.

### Branch Strategy

```
feature/*  →  develop  →  master
                 ↓            ↓
                dev       production
```

**Work happens on a feature branch, not on `develop`.** Branch from `develop`,
open a PR back into it — that PR is what runs CI. Merging deploys to the dev
sandbox automatically.

Release to production by merging `develop` into `master`, then triggering
**Deploy › Prod** manually. Production never deploys on push.

> **`develop` is long-lived and must not be deleted.** GitHub's
> delete-branch-on-merge removed it once after a `develop` → `master` PR; it has
> been restored. If it is missing again, recreate it from `master` rather than
> branching features off `master`.
>
> **Never push to a branch whose PR is already merged** — the commits strand
> with no warning. `gh pr view <n> --json state` first. This has gone wrong six
> times.

> **There is no staging portal.** There was one, and it was carried unmaintained
> long enough to become a hazard: it pointed at the *real* BuildRel Asana
> project — the same project and sections as production — while having no
> changelog pipeline of its own. An environment nobody keeps current gives
> false confidence and is somewhere wrong-portal writes can originate.
>
> Dev already does the job: it runs the same code against a dedicated test Asana
> project with a fully provisioned data model. What staging could uniquely have
> caught is per-portal provisioning drift, and the answer to that is a check that
> fails loudly before a prod deploy, not a third portal that fails silently.

### Branch Protection (recommended)

On `master`:
- Require PR reviews (1+)
- Require status checks to pass (CI)
- No direct pushes

On `develop`:
- Require status checks to pass

## Local Development

```bash
# Point CLI at your dev sandbox
npx hs init          # follow prompts, select dev portal
npx hs project dev   # watch mode — uploads on save
```

## Environment Config

Copy `.env.example` → `.env` and fill in your portal credentials. The `.env` file is gitignored and only used for local reference — CI/CD reads secrets from GitHub.
