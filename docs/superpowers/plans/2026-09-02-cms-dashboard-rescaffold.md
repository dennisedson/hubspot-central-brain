# CMS Dashboard Rescaffold Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract the dashboard island's inline style object into a CSS module at the theme root and remove the placeholder directories, matching HubSpot's 2026.03 reference layout with no change in rendered behaviour.

**Architecture:** The island currently holds a 33-key JavaScript object applied via `style={...}`. That object becomes `styles/dashboard.module.css`, imported by the island as `css` and applied via `className={...}`. Three spots that compose styles by object-spreading become multi-class strings. Verification is a CI deploy, not a unit test.

**Tech Stack:** HubSpot CMS React (`@hubspot/cms-components` 1.2.70), platform version 2026.03, JSX (not TypeScript), CSS Modules via the HubSpot build pipeline, GitHub Actions → `hs project upload` + `hs project deploy`.

## Global Constraints

- Component is `central-brain-cms` at `src/cms-assets/central-brain-dashboard`. Deploys only via CI on push to `develop`; there is no local `~/.hscli` auth.
- ~~**Do NOT add `export const fields` to the module.** It cannot deploy.~~ **RETRACTED:** `fields` deploys fine. The failures came from a double-deploy race in CI (fixed in `a9d8393`), and the missing `fields` export was later found to be why the module would not render at all.
- `@hubspot/cms-components` and `@hubspot/cms-dev-server` stay pinned at exactly `1.2.70`.
- Do not modify `cms-assets.json`, `cms-assets-hsmeta.json`, `package.json`, or `components/modules/Dashboard/index.jsx`.
- Rendered output must be pixel-identical to build #147. This is a refactor, not a redesign.
- Class names are camelCase to match the existing object keys, so `css.bigStat` resolves against `.bigStat`.
- Use multi-class composition (`` `${css.a} ${css.b}` ``), never the CSS Modules `composes:` keyword — one less build feature to depend on in a component with a history of opaque deploy failures.

## Testing Note

There is no meaningful unit-test surface for a pure style extraction. The repo's vitest suite covers `src/app/lib` and does not touch `src/cms-assets`; eslint is scoped to `src/**/*.{ts,tsx}` and the island is `.jsx`, so neither tool inspects the changed files. The real gate is the CI deploy plus a visual check. Task 2 is that gate — do not skip it, and do not claim success from a green *build* line alone.

---

### Task 1: Extract styles into a CSS module

**Files:**
- Create: `src/cms-assets/central-brain-dashboard/styles/dashboard.module.css`
- Modify: `src/cms-assets/central-brain-dashboard/components/islands/DashboardIsland.jsx`
- Delete: `src/cms-assets/central-brain-dashboard/styles/.gitkeep`
- Delete: `src/cms-assets/central-brain-dashboard/assets/.gitkeep` (and with it the empty `assets/` directory)

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `styles/dashboard.module.css` exporting these class names for the island — `root`, `header`, `headerLeft`, `logo`, `title`, `subtitle`, `refreshBtn`, `body`, `grid`, `card`, `cardTitle`, `bigStat`, `bigStatLabel`, `statRow`, `dot`, `dotGreen`, `dotGrey`, `statLabel`, `statValue`, `settingsRow`, `settingsRowLast`, `badge`, `badgeMine`, `pipeline`, `stageGrid`, `stageCard`, `stageCardActive`, `stageName`, `stageCount`, `loading`, `error`.

- [x] **Step 1: Create the stylesheet**

Create `src/cms-assets/central-brain-dashboard/styles/dashboard.module.css`:

```css
.root {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  background: #f7f8fa;
  min-height: 100vh;
  color: #1a1a2e;
}

.header {
  background: linear-gradient(135deg, #ff7a59 0%, #f25c2a 100%);
  padding: 28px 40px;
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.headerLeft {
  display: flex;
  align-items: center;
  gap: 12px;
}

.logo {
  width: 36px;
  height: 36px;
  background: rgba(255, 255, 255, 0.2);
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 18px;
}

.title {
  color: #fff;
  font-size: 22px;
  font-weight: 700;
  margin: 0;
  letter-spacing: -0.3px;
}

.subtitle {
  color: rgba(255, 255, 255, 0.75);
  font-size: 13px;
  margin: 2px 0 0;
}

.refreshBtn {
  background: rgba(255, 255, 255, 0.15);
  border: 1px solid rgba(255, 255, 255, 0.3);
  color: #fff;
  padding: 8px 16px;
  border-radius: 6px;
  cursor: pointer;
  font-size: 13px;
  font-weight: 500;
}

.body {
  padding: 32px 40px;
  max-width: 1200px;
  margin: 0 auto;
}

.grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 20px;
  margin-bottom: 28px;
}

.card {
  background: #fff;
  border-radius: 12px;
  padding: 24px;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.08);
}

.cardTitle {
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.8px;
  color: #8c8ca1;
  margin: 0 0 16px;
}

.bigStat {
  font-size: 36px;
  font-weight: 700;
  color: #ff7a59;
  line-height: 1;
  margin: 0 0 4px;
}

.bigStatLabel {
  font-size: 13px;
  color: #8c8ca1;
}

.statRow {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}

/* .dot is the base; .dotGreen / .dotGrey are modifiers applied alongside it. */
.dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
}

.dotGreen {
  background: #00bda5;
}

.dotGrey {
  background: #c5c5d2;
}

.statLabel {
  font-size: 13px;
  color: #516f90;
  flex: 1;
}

.statValue {
  font-size: 13px;
  font-weight: 600;
  color: #1a1a2e;
}

/* .settingsRowLast must follow .settingsRow — equal specificity, source order wins. */
.settingsRow {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 0;
  border-bottom: 1px solid #f0f1f5;
}

.settingsRowLast {
  border-bottom: none;
}

/* .badgeMine must follow .badge — equal specificity, source order wins. */
.badge {
  background: #eaf4fb;
  color: #0091ae;
  font-size: 11px;
  font-weight: 600;
  padding: 3px 8px;
  border-radius: 20px;
}

.badgeMine {
  background: #fff4e5;
  color: #f5a623;
}

.pipeline {
  background: #fff;
  border-radius: 12px;
  padding: 24px;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.08);
  margin-bottom: 28px;
}

.stageGrid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
  gap: 12px;
  margin-top: 16px;
}

/* .stageCardActive must follow .stageCard — equal specificity, source order wins. */
.stageCard {
  background: #f7f8fa;
  border-radius: 8px;
  padding: 14px 16px;
  border-left: 3px solid #e5e8ef;
}

.stageCardActive {
  border-left-color: #ff7a59;
}

.stageName {
  font-size: 12px;
  color: #516f90;
  margin: 0 0 6px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.stageCount {
  font-size: 24px;
  font-weight: 700;
  color: #1a1a2e;
  line-height: 1;
}

.loading {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 60px;
  color: #8c8ca1;
  font-size: 14px;
  gap: 10px;
}

.error {
  background: #fff3f3;
  border: 1px solid #fcd9da;
  border-radius: 8px;
  padding: 16px 20px;
  color: #c87872;
  font-size: 14px;
}
```

- [x] **Step 2: Replace the island's style object with the import**

In `components/islands/DashboardIsland.jsx`, replace lines 1–34 (the `import` line through the closing `};` of the `styles` object) with:

```jsx
import { useState, useEffect, useCallback } from 'react';
import css from '../../styles/dashboard.module.css';
```

Leave `getBase()`, `formatTime()`, and `assigneeLabel()` exactly as they are.

- [x] **Step 3: Convert every style prop to a className**

Replace the entire `return (...)` block of `DashboardIsland` with:

```jsx
  return (
    <div className={css.root}>
      <div className={css.header}>
        <div className={css.headerLeft}>
          <div className={css.logo}>🧠</div>
          <div>
            <h1 className={css.title}>{title}</h1>
            <p className={css.subtitle}>{lastRefresh ? `Updated ${formatTime(lastRefresh)}` : 'Loading…'}</p>
          </div>
        </div>
        <button className={css.refreshBtn} onClick={load} disabled={loading}>
          {loading ? 'Refreshing…' : '↻ Refresh'}
        </button>
      </div>

      <div className={css.body}>
        {error && <div className={css.error}>{error}</div>}

        {loading && !pipeline && (
          <div className={css.loading}>Loading dashboard data…</div>
        )}

        {!loading && (
          <>
            <div className={css.grid}>
              <div className={css.card}>
                <p className={css.cardTitle}>Content Pipeline</p>
                <div className={css.bigStat}>{totalActive}</div>
                <div className={css.bigStatLabel}>active records</div>
              </div>

              <div className={css.card}>
                <p className={css.cardTitle}>Sync Health</p>
                {syncStatus.map(s => (
                  <div key={s.label} className={css.statRow}>
                    <div className={`${css.dot} ${s.ok ? css.dotGreen : css.dotGrey}`} />
                    <span className={css.statLabel}>{s.label}</span>
                    <span className={css.statValue}>{s.value}</span>
                  </div>
                ))}
              </div>

              <div className={css.card}>
                <p className={css.cardTitle}>Linear Settings</p>
                {settings ? (
                  <>
                    <div className={css.settingsRow}>
                      <span className={css.statLabel}>Team</span>
                      <span className={css.statValue}>
                        {settings.teams?.find(t => t.id === settings.linearTeamId)?.name ?? settings.linearTeamId ?? '—'}
                      </span>
                    </div>
                    <div className={`${css.settingsRow} ${css.settingsRowLast}`}>
                      <span className={css.statLabel}>Filter</span>
                      <span className={settings.assigneeFilter === 'mine' ? `${css.badge} ${css.badgeMine}` : css.badge}>
                        {assigneeLabel(settings.assigneeFilter)}
                      </span>
                    </div>
                  </>
                ) : (
                  <span className={css.statLabel}>—</span>
                )}
              </div>
            </div>

            <div className={css.pipeline}>
              <p className={css.cardTitle}>Pipeline Breakdown</p>
              <div className={css.stageGrid}>
                {activeStages.map(stage => {
                  const count = recordsByStage[stage.id]?.length ?? 0;
                  return (
                    <div key={stage.id} className={`${css.stageCard} ${count > 0 ? css.stageCardActive : ''}`}>
                      <p className={css.stageName}>{stage.label}</p>
                      <div className={css.stageCount}>{count}</div>
                    </div>
                  );
                })}
                {activeStages.length === 0 && (
                  <span className={css.statLabel}>No pipeline data</span>
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
```

- [x] **Step 4: Verify no `style=` or `styles.` references survive**

Run:

```bash
grep -n "style=\|styles\." src/cms-assets/central-brain-dashboard/components/islands/DashboardIsland.jsx
```

Expected: no output. Any hit is a missed conversion — fix it before continuing.

- [x] **Step 5: Remove the placeholder directories**

```bash
git rm src/cms-assets/central-brain-dashboard/styles/.gitkeep
git rm src/cms-assets/central-brain-dashboard/assets/.gitkeep
```

- [x] **Step 6: Confirm the component's file inventory**

Run:

```bash
find src/cms-assets -type f | sort
```

Expected exactly:

```
src/cms-assets/central-brain-dashboard/cms-assets.json
src/cms-assets/central-brain-dashboard/components/islands/DashboardIsland.jsx
src/cms-assets/central-brain-dashboard/components/modules/Dashboard/index.jsx
src/cms-assets/central-brain-dashboard/package.json
src/cms-assets/central-brain-dashboard/styles/dashboard.module.css
src/cms-assets/cms-assets-hsmeta.json
```

- [x] **Step 7: Confirm the rest of the repo still passes**

Run: `npm run validate`
Expected: PASS. This does not inspect the changed files (see Testing Note) — it confirms nothing else regressed.

- [x] **Step 8: Commit**

```bash
git add src/cms-assets/
git commit -m "refactor(cms): extract island styles into a CSS module

Replaces the 33-key inline style object with styles/dashboard.module.css,
matching HubSpot's 2026.03 reference layout. Drops the .gitkeep placeholder
dirs left over from the deploy investigation.

Base-plus-modifier classes remove three duplications the object carried:
stageCardActive repeated all five stageCard properties to change one,
dotGreen/dotGrey repeated dot, and badgeMine repeated badge.

Rendered output unchanged. No fields export.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: Deploy and verify

**Files:** none modified — this task is the verification gate.

**Interfaces:**
- Consumes: the commit produced by Task 1.
- Produces: a confirmed-green deploy, or a revert.

- [x] **Step 1: Push to trigger the deploy**

```bash
git push origin develop
```

- [x] **Step 2: Wait for the run to complete**

```bash
gh run list --branch develop --limit 1 --json databaseId,status,conclusion,headSha \
  -q '.[0] | "\(.databaseId) \(.status) \(.conclusion) \(.headSha[0:7])"'
```

Poll until `status` is `completed`. Record the `databaseId`.

- [x] **Step 3: Confirm both the build and deploy lines**

```bash
gh run view <databaseId> --log | grep -iE "Building central-brain-cms|Deploying central-brain-cms" | sort -u
```

Expected: both `Building central-brain-cms  ... DONE` and `Deploying central-brain-cms  ... DONE`.

A `Building ... DONE` line on its own means nothing — every failed deploy in this component's history built cleanly.

- [x] **Step 4: Confirm the run's overall conclusion**

The `conclusion` from Step 2 must be `success`. A component can print `DONE` inside a deploy that fails as a whole; throughout the original investigation fifteen components reported DONE in runs that failed. Both signals are required.

- [ ] **Step 5: Visually confirm the dashboard**

Open the CMS page on the dev portal and confirm the dashboard renders as it did at build #147 — orange gradient header, three cards, pipeline breakdown grid, working refresh button.

- [ ] **Step 6: If the deploy went red, revert**

```bash
git revert --no-edit HEAD
git push origin develop
```

Then record the finding: CSS modules would be a **second, independent trigger** of the same empty-error failure, separate from `export const fields`. That materially widens the HubSpot support report beyond the builds #143–#145 repro, so add it to the ticket rather than treating it as a local styling problem.

---

## Self-Review

**Spec coverage:**
- Extract inline styles to CSS module → Task 1, Steps 1–3
- Drop `.gitkeep` placeholders and `assets/` → Task 1, Step 5
- Match reference layout (`styles/` at theme root) → Task 1, Step 1 path
- Behaviour unchanged → Task 1 Step 4 grep, Task 2 Step 5 visual check
- Do not touch the four unchanged files → Global Constraints, verified by Task 1 Step 6
- Risk / revert path → Task 2, Step 6
- Verification via green deploy → Task 2, Steps 3–4

No spec requirement is unimplemented.

**Placeholder scan:** No TBD/TODO. Every code step carries complete content; the CSS and JSX are given in full rather than described.

**Type consistency:** The 31 class names in Step 1 are the exact set consumed in Step 3. `settingsRowLast`, `stageCardActive`, `dotGreen`, `dotGrey`, and `badgeMine` are used only as second classes alongside their bases, matching the base-plus-modifier CSS. The import binding is `css` in both Step 2 and Step 3.
