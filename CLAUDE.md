# Working in this repo

**Start every session here.** Read `docs/PROJECT-CONTEXT.md` — what this
project is, what actually works today, and the decisions that are already
settled — and the most recent dated entries of `CHANGELOG.md`. Then confirm the
direction you are about to take against them, and say so if it contradicts a
decision recorded there rather than re-litigating it in code.

Read `docs/ARCHITECTURE.md` before changing sync behaviour. Most of this
repo's worst bugs came from not knowing which component owned a decision.

This work happens on more than one machine. Anything a future session needs to
know belongs in this file or in `docs/`, not in a chat window.

## Tests are not optional

**Every behaviour change ships with a test. Every bug fix starts with a failing
test.** Write the test, watch it fail, then fix it — a fix you never saw fail is
a guess.

This is the rule because of what happened without it. The Linear teams list was
truncated at 50 of several hundred, the user list at 250 of 452, the project
list at 250 of 1,592, the `'any'` sentinel sent lookups to a team that does not
exist, and the webhook synced every team on an unconfigured portal. Every one
of them reached a live portal, and every one was in a file with no coverage.

Concretely:

- A bug fix with no failing test first is not finished.
- 300 lines of new behaviour with no new tests is not finished.
- `npm run validate` must exit 0 before you open a PR. It runs lint, typecheck,
  the suite, and the three UI-extension typechecks — `cards`, `pages` and
  `settings`. Run it locally: CI's test job typechecks only `cards` and `pages`,
  so a type error in `src/app/settings/` passes a PR and is caught by the deploy
  workflows instead.
- Mock by **intent, not call order** — route a fetch mock on the URL or the
  query it carries. Order-based mocks break the moment a request is added.
- Mock what the API **actually** returns. Linear answers a bogus id with a null
  node, not an HTTP error; mock a throw and the bug hides behind the catch.
- Keep a **control** in the test file: the case that was already correct. It is
  what proves a fix did not break the ordinary path.

## Traps in this codebase

Each of these cost a day at least once.

- **Paginate every Linear connection.** Linear defaults a connection to 50 and
  caps a page at 250. One request is a page, not a set. Use `fetchAllPages`.
- **Never sort a list you have not finished fetching.** Truncate to 250 and sort
  alphabetically and it reads as a complete A–Z sweep with the middle missing.
  That is what hid the user-list bug.
- **Never let an id reach the screen as a label.** A `Select` whose `value`
  matches no option renders the raw UUID and flags the field invalid — so a
  silent empty list downstream becomes an accusation against the user.
- **Primary display properties cannot be cleared.** That is why `linear_team_id`
  uses the sentinel `'any'`. Read sentinels through their named predicate
  (`isAnyTeam`), never a truthiness check — `'any'` is truthy.
- **HubSpot drops null properties** when a handler returns `body` as an object.
  Never let `null` be the success case; return a string. `JSON.stringify`'d
  bodies keep their nulls.
- **UI extensions are remote components.** No raw DOM elements — a bare
  `<strong>` takes down the whole view. Use `<Text format={{ fontWeight: 'bold' }}>`.
  `src/app/__tests__/ui-no-raw-html.test.ts` enforces this.
- **The settings form has one editable copy and two entrances.** Edit
  `src/app/pages/LinearSettingsForm.tsx` and nothing else.
  `src/app/settings/LinearSettingsForm.tsx` is **generated** by
  `npm run sync:settings-form`, which `npm run build` runs first, and
  `settings-form-in-sync.test.ts` fails while the two differ. The duplication is
  not a choice: HubSpot copies each extension directory to its own temp root and
  resolves from there, so an import that leaves the directory cannot resolve
  (`Could not resolve "../pages/LinearSettingsForm.tsx"`). Sharing by import —
  including via `../lib` — is not available.
- **A `type: "settings"` component does render.** This file said it rendered
  nowhere for a private app, which was true when written on 2026-09-29: the
  app's entry under Connected apps had Overview and Insights and no Settings
  tab. The platform's tabs are now Overview / Settings / App cards, the probe in
  PR #100 rendered, and `src/app/settings/SettingsPage.tsx` is live at Connected
  apps → the app → Settings. `src/app/pages/SettingsApp.tsx` is still the
  Content Command Center page and the other entrance. Issue #88, PRs #100–#102.
- **An app function is killed at 20 seconds.** Observed, not documented:
  `The serverless function 'changelog_draft_api' timed out. Task timed out after
  20.00 seconds.` There is no timeout field in a function's hsmeta, so it cannot
  be raised, and `hubspot.fetch`'s timeout is the extension's patience with the
  request rather than the function's permission to keep running. That makes
  generation speed a correctness concern: changelog drafting defaults to Sonnet
  with thinking **off** because Opus with adaptive thinking does not reliably
  finish in time. See `src/app/lib/changelog-model.ts`.
- **Deploys lie.** `hs project upload` prints "DONE" while the build is still
  BUILDING, and containers lag 60–75s after `[deployed]`. Verify the
  postcondition, never the exit code or the status line.
- **Live data.** Nothing is ever deleted from Linear. Imports upsert on
  `linear_id`; previews write nothing.

## Process

- Branch off `develop`, PR back into it. There is no staging environment.
- Never push to a branch whose PR is already merged — the commits strand.
  Check first, do not remember: `gh pr view <n> --json state`. This has gone
  wrong six times, and every time the rule was already written down.
- `develop` is the base branch, and it was briefly deleted by GitHub's
  delete-branch-on-merge after a `develop` → `master` PR. It has been restored.
  If `develop` is missing, recreate it from `master` rather than branching off
  `master` and leaving the model behind.
- Confirm a UI change renders before building the next thing on top of it.
- `hs project dev` runs the extension locally and shows the real exception.
  Deploying to read a generic error message is the slow path.
- **`npm run validate` does not prove the project will build.** Two failures in
  one day passed lint, typecheck, the whole suite, `hs project validate` AND
  CI's Dry-Run Validate, then failed at upload: a function entrypoint that was
  never compiled, and a UI extension importing across directories. There is no
  `--dry-run` on `hs project upload`. Where a build constraint can be checked
  statically, encode it as a test — `extension-imports-stay-local.test.ts` and
  `function-entrypoints.test.ts` exist because nothing else catches those.

## The review bot is switched off

`claude-code-review.yml` was removed on 2026-10-01. It never produced a review:
the green checks were skips, and the red ones were auth failures. Issue #98
records the one-field fix and how to put it back.

The `@claude` workflow (`claude.yml`) is still present and uses the same
federation, so it will fail the same way until that fix is applied. It is
mention-triggered, so it costs nothing to leave in place.

## The review bot skipped silently — why a green check meant nothing

Kept because the mechanism still applies to `claude.yml` and to anything else
built on `claude-code-action`, and because it is the reason not to trust a fast
green check. There is no code-review bot on PRs today.

`claude-code-action` refuses to run unless the workflow file on the PR branch is
**byte-identical to the copy on the default branch**, which here is `master`. It
is a security check: it stops a PR from editing the reviewer to exfiltrate
secrets.

The consequence is specific to this repo's branching. Work happens on `develop`
and is promoted to `master`, so **any workflow change sitting on `develop` makes
every open PR skip review** until `master` catches up. And a skip is reported as
a **successful** check that finishes in under fifteen seconds.

So a green `claude-review` does not mean the code was reviewed. Check the
duration: under ~15s is a skip, a real review is 30s or more. If it skipped, the
log says `Skipping action due to workflow validation`.

When you change a workflow file, expect review to skip on that PR and on every
other open PR until the change reaches `master`. That is working as designed.

## Episode guides

Whenever we successfully implement a new feature, solve a major bug, or reach a logical stopping point, you must automatically generate a "YouTube Episode Guide." 

The goal of this guide is to translate the work we just did into a highly focused, under-10-minute video tutorial where the viewer walks away knowing how to build one specific thing.

Each episode guide should be added as its on numbered file with title eg 01-Stop the Echo: Building Bulletproof Bidirectional Sync and placed in the `docs/walkthroughs` directory 


Format the output strictly as follows:

## 🎬 YouTube Episode Guide: [Insert Catchy Title]

**🎯 Core Learning Objective:** 
"By the end of this video, you will know how to..." (State exactly what the viewer will be able to build or implement).

**⏱️ The 10-Minute Script Outline:**
*   **Hook & Demo (0:00 - 1:00):** A script hook explaining what we are building, why it's crucial for the app, and a description of the final working demo.
*   **The Architecture (1:00 - 3:00):** A plain-English explanation of how the feature works conceptually before looking at the code.
*   **Step-by-Step Implementation (3:00 - 8:00):** Break down the code we just wrote into 3 to 4 bite-sized logical steps. Tell me which files to open and what code to explain on screen. Keep it focused only on the new logic.
*   **Testing & Wrap-up (8:00 - 10:00):** How to test the feature to prove it works, and a quick summary of what was learned.

**💻 Screen-Ready Code Snippets:**
Provide the cleaned-up, highly readable snippets of the code we just wrote, stripped of unnecessary boilerplate, so I can easily show them on screen or paste them into a description/GitHub Gist.