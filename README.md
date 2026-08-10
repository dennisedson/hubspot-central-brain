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
npm run validate    # HubSpot project-validate dry run
```

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
| `ci.yml`          | PR → main/staging/develop | Lint, typecheck, test, project-validate |
| `deploy-dev.yml`  | Push to `develop`    | Upload to dev sandbox                  |
| `deploy-staging.yml` | Push to `staging` | Upload to staging sandbox              |
| `deploy-prod.yml` | Push to `main`       | Upload to production portal            |

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
develop  →  staging  →  main
  ↓            ↓          ↓
 dev         staging    production
```

Feature branches → PR into `develop` → CI runs → merge → auto-deploy to dev.
Promote to staging by merging `develop` → `staging`.
Release to production by merging `staging` → `main`.

### Branch Protection (recommended)

On `main`:
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
