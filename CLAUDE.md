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
  the three UI-extension typechecks, and the suite.
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
- **`src/app/pages/SettingsApp.tsx` is the page people actually open.** A
  `type: "settings"` component renders nowhere for this private app.
- **Deploys lie.** `hs project upload` prints "DONE" while the build is still
  BUILDING, and containers lag 60–75s after `[deployed]`. Verify the
  postcondition, never the exit code or the status line.
- **Live data.** Nothing is ever deleted from Linear. Imports upsert on
  `linear_id`; previews write nothing.

## Process

- Branch off `develop`, PR back into it. There is no staging environment.
- Never push to a branch whose PR is already merged — the commits strand.
- Confirm a UI change renders before building the next thing on top of it.
- `hs project dev` runs the extension locally and shows the real exception.
  Deploying to read a generic error message is the slow path.

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