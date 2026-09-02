# CMS Dashboard Rescaffold — Design

**Date:** 2026-09-02
**Component:** `central-brain-cms` (`src/cms-assets/central-brain-dashboard`)
**Status:** Approved, ready for implementation plan

## Problem

The component currently deployed to dev (build #147) works, but carries three artifacts left behind by the deploy-failure investigation documented in [episode 13](../../walkthroughs/13-The%20Empty%20Error:%20Bisecting%20a%20Deploy%20That%20Refuses%20to%20Talk.md):

1. `assets/.gitkeep` and `styles/.gitkeep` — placeholder directories added to test a hypothesis that turned out to be wrong. Nothing references them.
2. All styling lives in a 33-key JavaScript object inside the island, applied via `style={...}`. The styles were inlined under the theory that CSS modules broke the deploy. They did not — `fields` did.
3. The module title is hardcoded because `export const fields` cannot deploy (a HubSpot platform bug, reproduced with their own reference markup in builds #143–#145).

Items 1 and 2 are in scope. Item 3 stays as-is until HubSpot resolves the platform bug.

## Goal

Match HubSpot's official 2026.03 reference layout (`hubspot-project-components/2026.03/components/cms-asset`) for structure and styling, with no change in rendered behaviour.

## Non-goals

- Converting `.jsx` to `.tsx` (considered and declined; larger diff, more CI surface on a component with a history of opaque deploy failures)
- Recovering the configurable title — blocked on the platform bug
- Any change to data fetching, the module, or the component's three JSON config files

## Design

### File changes

| Action | Path |
|---|---|
| Add | `styles/dashboard.module.css` |
| Delete | `assets/.gitkeep`, and the `assets/` directory |
| Delete | `styles/.gitkeep` |
| Edit | `components/islands/DashboardIsland.jsx` |
| Unchanged | `cms-assets.json`, `package.json`, `cms-assets-hsmeta.json`, `components/modules/Dashboard/index.jsx` |

`assets/` is dropped rather than kept empty: nothing references it, and git cannot track an empty directory, so it would silently vanish in CI regardless.

### Style extraction

The island imports the stylesheet as `css` and replaces every `style={styles.x}` with `className={css.x}`:

```js
import css from '../../styles/dashboard.module.css';
```

Three sites compose styles by object-spreading today. Each becomes class composition:

| Today | Becomes |
|---|---|
| `{...styles.dot, ...(s.ok ? styles.dotGreen : styles.dotGrey)}` | `` className={`${css.dot} ${s.ok ? css.dotGreen : css.dotGrey}`} `` |
| `{...styles.settingsRow, borderBottom: 'none'}` | `` className={`${css.settingsRow} ${css.settingsRowLast}`} `` |
| `count > 0 ? styles.stageCardActive : styles.stageCard` | `` className={`${css.stageCard} ${count > 0 ? css.stageCardActive : ''}`} `` |

### Duplication removed

Three key pairs currently duplicate a base to vary one property. CSS modules express these as base + modifier, so the extraction reduces rather than transcribes:

- `stageCardActive` repeats all five `stageCard` properties to change `border-left-color`
- `dotGreen` / `dotGrey` each repeat all three `dot` properties to change `background`
- `badgeMine` repeats all five `badge` properties to change `background` and `color`

### Behaviour

Unchanged. Same markup, same conditional logic, same data fetching, same hardcoded title, no `fields` export.

## Risk

CSS modules were present in the original failing builds (`61aabbe` shipped `Dashboard.module.css`), so this reintroduces a variable that was in the room during the failures.

The evidence says it is safe: builds #143–#145 failed with *no* CSS module present, and build #146 passed with inline styles. The discriminating variable was `export const fields`, not stylesheets. But the claim is only proven by a green deploy.

**If the deploy goes red:** revert to inline styles and record it in the support ticket — it would mean CSS modules are a *second*, independent trigger of the same empty-error failure, which materially changes the bug report.

## Verification

1. Push to `develop`, which triggers `Deploy › Dev`.
2. Confirm `Building central-brain-cms ... DONE` **and** `Deploying central-brain-cms ... DONE`.
3. Confirm the run's overall conclusion is `success` — a component can report DONE inside a deploy that fails as a whole.
4. Visually confirm the dashboard still renders on the CMS page.

Success is a green run with both lines present. Anything else is a failure and triggers the revert path above.
