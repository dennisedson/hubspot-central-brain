# HubSpot Central Brain

A HubSpot Projects app that powers the "Central Brain" system — syncing content, changelogs, and video records between HubSpot and external tools (Linear, Asana, Fellow, YouTube).

## Prerequisites

- Node 18+
- HubSpot CLI (`@hubspot/cli` — installed as a dev dependency)
- Three HubSpot portals: dev sandbox, staging sandbox, production

## Quick Start

```bash
npm install
npm run lint        # ESLint (flat config, strict TS)
npm run typecheck   # tsc --noEmit
npm test            # Vitest
npm run validate    # all of the above + the three UI-extension typechecks
```

## Setup (first run against a portal)

`hs project upload` deploys the app, but it does **not** create the data model the
app depends on. A freshly deployed portal has no Content, Changelog, Video or App
Settings objects, no pipelines and no association definitions — every function will
fail until the provisioning scripts below have run.

Scripts select a portal with `PORTAL=dev|staging|prod` (defaults to `dev`) and read
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
PORTAL=dev npm run provision:enterpret-quotes # enterpret_quotes on Content
PORTAL=dev npm run provision:property-descriptions  # run last — describes the rest
```

Order matters in three places: everything needs the objects from `provision`;
`asana-sync-token` and `fellow-sync` both write onto the App Settings object;
and `property-descriptions` only describes properties that already exist, so it
goes last.

Skipping `provision:associations` is the one that bites quietly — without it the
`associate_related_content` workflow action 4xxs on every association call.

### 3. App secrets

The deployed functions read secrets from HubSpot, **not** from `.env`. All six must
exist or the functions fail at runtime:

```bash
hs app secret add HS_ACCESS_TOKEN
hs app secret add LINEAR_API_KEY
hs app secret add LINEAR_WEBHOOK_SECRET
hs app secret add ASANA_API_KEY
hs app secret add FELLOW_API_KEY
hs app secret add SYNC_SHARED_SECRET
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

### 5. Obsidian vault (optional)

The thinking/drafting layer is a plain folder of markdown. See
[`vault-template/SETUP.md`](vault-template/SETUP.md) — written for someone who has
never opened Obsidian.

## Project Structure

```
src/app/
  functions/          # Serverless functions (webhook receivers, sync jobs)
  workflow-actions/   # Custom workflow actions
  webhooks/           # Webhook handler configs
  extensions/         # UI extensions (CRM cards, app pages)
  lib/                # Shared types, mapping configs, helpers
  __tests__/          # Unit tests (Vitest)
```

## CI/CD

All pipelines live in `.github/workflows/`:

| Workflow          | Trigger              | What it does                           |
| ----------------- | -------------------- | -------------------------------------- |
| `ci.yml`          | PR → master/staging/develop | Lint, typecheck, test, project-validate |
| `deploy-dev.yml`  | Push to `develop`    | Upload to dev sandbox                  |
| `deploy-staging.yml` | Push to `staging` | Upload to staging sandbox              |
| `deploy-prod.yml` | Manual (`workflow_dispatch`) | Upload to production portal    |

### GitHub Secrets (per environment)

| Secret                               | Environment | Description                    |
| ------------------------------------ | ----------- | ------------------------------ |
| `HUBSPOT_DEV_ACCOUNT_ID`            | dev         | Dev sandbox portal ID          |
| `HUBSPOT_DEV_PERSONAL_ACCESS_KEY`   | dev         | Dev sandbox PAK                |
| `HUBSPOT_STAGING_ACCOUNT_ID`        | staging     | Staging sandbox portal ID      |
| `HUBSPOT_STAGING_PERSONAL_ACCESS_KEY` | staging   | Staging sandbox PAK            |
| `HUBSPOT_PROD_ACCOUNT_ID`           | production  | Production portal ID           |
| `HUBSPOT_PROD_PERSONAL_ACCESS_KEY`  | production  | Production portal PAK          |

### Branch Strategy

```
develop  →  staging  →  master
  ↓            ↓           ↓
 dev         staging    production
```

Work lands directly on `develop` → auto-deploys to dev.
Promote to staging by merging `develop` → `staging`.
Release to production by merging into `master`, then triggering
**Deploy › Prod** manually — production never deploys on push.

### Branch Protection (recommended)

On `master`:
- Require PR reviews (1+)
- Require status checks to pass (CI)
- No direct pushes

On `staging`:
- Require status checks to pass

## Local Development

```bash
# Point CLI at your dev sandbox
npx hs init          # follow prompts, select dev portal
npx hs project dev   # watch mode — uploads on save
```

## Environment Config

Copy `.env.example` → `.env` and fill in your portal credentials. The `.env` file is gitignored and only used for local reference — CI/CD reads secrets from GitHub.
