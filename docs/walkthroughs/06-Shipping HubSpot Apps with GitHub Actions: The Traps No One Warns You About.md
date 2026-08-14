## 🎬 YouTube Episode Guide: Shipping HubSpot Apps with GitHub Actions: The Traps No One Warns You About

**🎯 Core Learning Objective:**
"By the end of this video, you will know how to set up a working GitHub Actions CI/CD pipeline that compiles TypeScript and deploys a HubSpot Project app to multiple portals — including how to avoid three specific traps that will silently break your deploys."

**⏱️ The 10-Minute Script Outline:**

*   **Hook & Demo (0:00 - 1:00):** Push to `develop`, watch GitHub Actions go green, open HubSpot and see the updated app live — in under 2 minutes. Then we'll show the three error screens we had to fight through to get here, so you can skip straight to working.

*   **The Architecture (1:00 - 3:00):** Three branches, three GitHub environments, three HubSpot portals. `develop` → dev, `staging` → staging, `main` → production. Each environment has two secrets: the portal's account ID and its Service Key. The workflow compiles TypeScript, then uses HubSpot's official `project-upload` GitHub Action. Simple in theory — three gotchas in practice.

*   **Step-by-Step Implementation (3:00 - 8:00):**
    1.  **The workflow structure** — Show a complete `deploy-dev.yml`. Highlight: `environment: dev`, `npm run build` before the upload step, and the two required secrets.
    2.  **Trap 1: Node version** — `@hubspot/cli@8.0.0` requires Node 20. Using Node 18 crashes with `SyntaxError: Invalid regular expression flags` before the CLI does anything. Fix: `node-version: 20`.
    3.  **Trap 2: Multi-line commit messages** — The HubSpot upload action uses bash `eval` to construct the `hs project upload --message '...'` command. Multi-line commit message bodies cause each line to be eval'd as a separate shell command. Fix: keep every commit that triggers a deploy to a single-line subject. No body, no trailers.
    4.  **Trap 3: Variable substitution** — If you use `${VARIABLE_NAME}` placeholders in an `hsmeta.json` file, the `--use-env` flag does NOT read from the step's `env:` block. Fix: add a `sed` step before the upload to replace placeholders directly in the file.

*   **Testing & Wrap-up (8:00 - 10:00):** Push a one-line commit, watch the green check, verify the app updated in HubSpot. Recap the three traps. Mention that staging and prod deploys work identically — just different branches and environment secrets.

**💻 Screen-Ready Code Snippets:**

```yaml
# .github/workflows/deploy-dev.yml
name: Deploy › Dev

on:
  push:
    branches: [develop]

jobs:
  deploy:
    runs-on: ubuntu-latest
    environment: dev
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: 20        # must be 20+ for @hubspot/cli@8
          cache: npm

      - run: npm ci

      - name: Build functions      # compile TS before upload
        run: npm run build

      # Trap 3 fix: substitute placeholder URLs before HubSpot sees them
      - name: Set sync function URL
        run: sed -i 's|${SYNC_TO_LINEAR_URL}|https://api.hubspot.com/integrations/v1/APP_ID/serverless/sync-to-linear|g' src/app/workflow-actions/sync-to-linear-hsmeta.json

      - name: Install HubSpot CLI
        uses: HubSpot/hubspot-project-actions/install-hubspot-cli@v1.1.0

      - name: Upload project
        uses: HubSpot/hubspot-project-actions/project-upload@v1.1.0
        env:
          DEFAULT_ACCOUNT_ID: ${{ secrets.HUBSPOT_DEV_ACCOUNT_ID }}
          DEFAULT_PERSONAL_ACCESS_KEY: ${{ secrets.HUBSPOT_DEV_PERSONAL_ACCESS_KEY }}
```

```bash
# Trap 2 fix: always single-line commit messages on deploy branches
git commit -m "feat: add portal config map"   # ✅
git commit -m "feat: add portal config map

Detailed explanation here...
Co-Authored-By: ..."                           # ❌ breaks CI
```

```json
// tsconfig.functions.json — compile TS in-place for HubSpot upload
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "outDir": "src/app",
    "rootDir": "src/app",
    "declaration": false,
    "sourceMap": false
  },
  "include": ["src/app/**/*.ts"]
}
```
