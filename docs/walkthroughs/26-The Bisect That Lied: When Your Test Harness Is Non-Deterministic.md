## 🎬 YouTube Episode Guide: The Bisect That Lied — When Your Test Harness Is Non-Deterministic

**🎯 Core Learning Objective:**
"By the end of this video, you will know how to detect that your build pipeline is non-deterministic — that identical code produces different results — and why you must prove determinism *before* you trust any bisect, correlation, or 'fix' you derive from it. You'll also learn the one git command that settles it in three seconds."

**⏱️ The 10-Minute Script Outline:**

*   **Hook & Demo (0:00 - 1:00):**
    "Two episodes ago I ran a beautiful bisect. Seven builds, a perfect correlation, a confident conclusion. I convicted a line of code and filed it as a platform bug. I was completely wrong — and the code I convicted turned out to be the thing that made the feature work at all."
    Show the two commits side by side, then the payoff:
    ```
    green 8960439 tree: 45df867feb8070854142ed686685eb8496edcaba
    red   210e350 tree: 45df867feb8070854142ed686685eb8496edcaba
    ```
    "Same tree hash. The entire repository, bit for bit. One deployed green. One deployed red. Thirty-six minutes apart. Everything I concluded from twenty builds of code changes was noise."

*   **The Architecture (1:00 - 3:00):**
    Explain the actual bug in plain English, because it's beautifully mundane.
    The CI workflow had two steps:
    1. `hs project upload` — builds the project. **And also deploys it.** That's the part nobody knew.
    2. `hs project deploy --deploy-latest-build --force` — deploys the same build. Again.
    Every build deployed twice. Most components tolerate that; a theme does not. It deploys successfully exactly once, and the second attempt dies with an empty-bodied internal error.
    Now the punchline: **which attempt fails is a race.** Sometimes upload wins and the deploy step fails, turning the run red. Sometimes upload's deploy fails and the deploy step succeeds — and the run goes *green*, because `hs project upload` exits 0 even when a component inside it failed.
    Draw it on screen — the mirror image is the whole story:
    | Step | run #165 | run #172 |
    |---|---|---|
    | `Upload project` | theme **FAILED** | theme **DONE** |
    | `Deploy project` | theme **DONE** | theme **FAILED** |
    "Identical inputs. Inverted outputs. That is a coin flip wearing the costume of a test result."

*   **Step-by-Step Implementation (3:00 - 8:00):**

    **Step 1 — Notice the impossible thing (3:00 - 4:15).**
    The moment the investigation turned: after restoring the template to a known-green version and *still* failing, restore the **entire component** to byte-identical with the last green build. It failed again.
    "Reverting to a known-good state and still failing is not a mystery. It's a proof. It proves the input isn't what determines the output. The instant you see it, stop reading your own code — the answer is not in there."
    Show the three-second command that makes it undeniable:
    ```bash
    git rev-parse 8960439^{tree}
    git rev-parse HEAD^{tree}
    ```

    **Step 2 — Find the second deploy (4:15 - 5:45).**
    The clue was hiding in a log everyone had already read. Show how attributing each log line **to its step** cracks it — the same component appearing in two different steps of one run:
    ```bash
    gh run view <id> --log \
      | grep -iE "cbrain-theme +\.\.\. (DONE|FAILED)" \
      | awk -F'\t' '{print $2"\t"$3}' | sort -u
    ```
    "I'd been grepping logs for hours. I was grepping for the *message*. The information I needed was in the *column I was throwing away* — which step each line came from."

    **Step 3 — Fix it, and hit the version trap (5:45 - 7:00).**
    `hs project upload --skip-auto-deploy`. Push. It fails immediately: `Unknown arguments: skip-auto-deploy`.
    "The flag exists on my machine and not in CI. The `install-hubspot-cli` action puts an older CLI on PATH than the one `package.json` pins. My local was 8.14.0; CI was something older."
    Fix: route through the pinned version with `npx`, so CI runs the CLI you actually verified. Green.

    **Step 4 — Go back and unconvict the innocent (7:00 - 8:00).**
    This is the part most tutorials skip. Re-read the old evidence with the new knowledge:
    ```
    build #143 (the "fields is guilty" build)
      Upload project  -> central-brain-cms DONE     <- first deploy SUCCEEDED
      Deploy project  -> central-brain-cms FAILED   <- only the second failed
    ```
    "`fields` deployed fine. It always deployed fine. It broke *re-deploy*. And because I'd told everyone it was undeployable, the module shipped without a `fields` export — which is exactly why the page rendered `custom widget definition not found`. My wrong conclusion caused the next bug."

*   **Testing & Wrap-up (8:00 - 10:00):**
    Add the `fields` export back. Deploy green. Reload the page — the dashboard renders.
    Then go correct the previous episode and the spec on camera. "Leaving a confident, wrong conclusion in your docs is worse than leaving no conclusion. Somebody — probably you in three weeks — will build on it."
    Recap the transferable rules:
    1. **Before trusting a bisect, prove the harness is deterministic.** Deploy the same commit twice.
    2. **Reverting to green and still failing = the input isn't the cause.** Stop reading code.
    3. **Attribute log lines to their step.** Same message, different step, different meaning.
    4. **A tool that exits 0 on internal failure will hand you false greens.**
    5. **When you overturn a conclusion, go back and unconvict what you blamed.**

**💻 Screen-Ready Code Snippets:**

**The three seconds that ended a twenty-build investigation:**

```bash
# If these match and the deploys disagreed, your pipeline is non-deterministic.
git rev-parse <last-green-commit>^{tree}
git rev-parse HEAD^{tree}
# 45df867feb8070854142ed686685eb8496edcaba
# 45df867feb8070854142ed686685eb8496edcaba
```

**Attribute every log line to its step — the grep that found the double deploy:**

```bash
gh run view <run-id> --log \
  | grep -iE "cbrain-theme +\.\.\. (DONE|FAILED)|Deployed build" \
  | awk -F'\t' '{print $2"\t"$3}' \
  | sed 's/2026[^ ]* //' | sort -u

# Upload project   - Deploying cbrain-theme ... DONE      <- deploy #1
# Deploy project   - Deploying cbrain-theme ... FAILED    <- deploy #2, same build
```

**The fix — one flag, plus the pinned CLI that actually has it:**

```yaml
      - name: Upload project
        run: npx hs project upload --skip-auto-deploy

      - name: Deploy project
        run: npx hs project deploy --deploy-latest-build --force
```

```bash
# Why npx: the flag exists in the pinned CLI, not the action-installed one.
npx hs --version                      # 8.14.0  -> has --skip-auto-deploy
# CI's install-hubspot-cli@v1.1.0     # older   -> "Unknown arguments"
```

**Diff against your own last-green build, not against the reference docs:**

```bash
# This is what exonerates innocent code.
git diff <last-green-commit>..HEAD -- src/theme
```

> Three things in this theme diverged from HubSpot's official sample: `host_template_types`, an empty `fields.json` group, and empty-string paths in `theme.json`. All three were sitting in a **green** build. Diffing against the reference would have "fixed" three innocent files and buried the real cause deeper.

**The retraction, stated plainly:**

| Claimed in episode 13 | Actually true |
|---|---|
| `export const fields` cannot deploy | It deploys fine; it broke only the *redundant second* deploy |
| A HubSpot platform bug worth a support ticket | Our own workflow deployed every build twice |
| 7-for-7 correlation proves causation | The harness was a coin flip weighted by build timing |
| Workaround: ship without `fields` | That's what made the module fail to render at all |
