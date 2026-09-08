## 🎬 YouTube Episode Guide: Zero Checks — When Your CI Trigger Names a Branch That Doesn't Exist

**🎯 Core Learning Objective:**
"By the end of this video, you will know how to audit your GitHub Actions branch filters against the branches that actually exist in your repo — and you'll understand why fixing the filter on your working branch does *not* protect your default branch until the fix lands there too."

**⏱️ The 10-Minute Script Outline:**

*   **Hook & Demo (0:00 – 1:00):**
    Open on the GitHub banner: "This branch is 161 commits ahead of and 3 commits behind master." Ask the obvious question — how does a branch I never work on get *ahead* of me? Click into those 3 commits: a merged PR adding two workflow files. Then the gut-punch: scroll to the PR's checks tab. It's empty. Not failing — *empty*. Zero checks ran. Merged clean into the default branch with nothing verifying it. The demo we build toward: proving why, and fixing it correctly.

*   **The Architecture (1:00 – 3:00):**
    Plain English, no code yet. A GitHub Actions `pull_request` trigger has a `branches:` filter — a list of *base* branches the workflow cares about. If a PR's target isn't in that list, the workflow doesn't run. Not "runs and passes." Doesn't run. And here's the trap: **GitHub does not validate that those branch names exist.** A typo, or a repo created with `master` while the workflow was authored assuming `main`, produces a filter that silently matches nothing. Every other branch in the list kept working, which is exactly why nobody noticed — CI looked healthy because it *was* healthy, just never on the branch that mattered most.

*   **Step-by-Step Implementation (3:00 – 8:00):**

    *   **Step 1 — Prove the gap (3:00 – 4:30).** Open `.github/workflows/ci.yml`. Read line 6: `branches: [main, staging, develop]`. Now run `git ls-remote --heads origin` in the terminal and read the output aloud. There's `master`, `staging`, `develop` — and no `main`. Land the point on screen: the filter names three branches, only two of them exist, and the missing one is the default branch. Every PR into `master` has been unchecked since day one.

    *   **Step 2 — The one-line fix (4:30 – 5:30).** Change `main` to `master` on line 6, and fix the comment on line 1 so the file doesn't lie to the next reader. Emphasize the comment: a stale comment is how the bug survives its own fix.

    *   **Step 3 — Verify the YAML, don't eyeball it (5:30 – 6:45).** This is the transferable habit. Parse the file and assert on the *parsed* value, not the diff. Show the `js-yaml` one-liner. Call out the genuinely weird part: YAML 1.1 parses the bare key `on` as boolean `true`, so you reach for `d.on || d[true]`. Confirm the branches array and that both jobs survived.

    *   **Step 4 — The twist that makes this episode (6:45 – 8:00).** Run `git show origin/master:.github/workflows/ci.yml`. Master still says `main`. Explain the merge-commit rule: for `pull_request` events, Actions evaluates the workflow from the *merge* of head into base. A PR whose head branch predates the fix produces a merge commit that still contains the broken filter — so it *still* gets zero checks. The fix isn't real until it's on `master` itself. This is the difference between fixing a file and fixing a system.

*   **Testing & Wrap-up (8:00 – 10:00):**
    Test: open a throwaway PR targeting `master` from a branch that contains the fix, and watch the checks attach for the first time. Then open one from a branch that *doesn't*, and watch it stay empty — that's the merge-commit rule, demonstrated rather than asserted. Wrap on the general lesson: any config that names an external identifier — a branch, a portal ID, an env name, a secret key — needs a check that the identifier exists. Systems that fail by doing nothing are the ones that survive longest, because "no error" reads as "no problem."

**💻 Screen-Ready Code Snippets:**

**The bug — a filter naming a branch that was never created:**
```yaml
# CI — runs on every pull request targeting main, staging, or develop
name: CI

on:
  pull_request:
    branches: [main, staging, develop]   # ← `main` does not exist. Default is `master`.
```

**Proving it, in one command:**
```bash
git ls-remote --heads origin | awk '{print $2}'
# refs/heads/develop
# refs/heads/master     ← the default branch
# refs/heads/staging
# ...no refs/heads/main
```

**The fix:**
```yaml
# CI — runs on every pull request targeting master, staging, or develop
name: CI

on:
  pull_request:
    branches: [master, staging, develop]
```

**Verify the parsed value, not the diff (note the YAML 1.1 `on` → `true` gotcha):**
```bash
node -e "
const yaml = require('js-yaml'), fs = require('fs');
const d = yaml.load(fs.readFileSync('.github/workflows/ci.yml', 'utf8'));
const trig = d.on || d[true];        // YAML 1.1 parses bare 'on' as boolean true
console.log('branches:', JSON.stringify(trig.pull_request.branches));
console.log('jobs:', Object.keys(d.jobs).join(', '));
"
# branches: ["master","staging","develop"]
# jobs: lint-typecheck-test, validate
```

**The check most people skip — is the fix on the branch it's meant to protect?**
```bash
git show origin/master:.github/workflows/ci.yml | sed -n '4,6p'
# on:
#   pull_request:
#     branches: [main, staging, develop]   ← still broken on master
```
