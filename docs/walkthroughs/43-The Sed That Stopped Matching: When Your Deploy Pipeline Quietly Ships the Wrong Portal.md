## 🎬 YouTube Episode Guide: The Sed That Stopped Matching: When Your Deploy Pipeline Quietly Ships the Wrong Portal

**🎯 Core Learning Objective:**
"By the end of this video, you will know how to replace per-file placeholder substitution in a multi-portal HubSpot deploy with a single portal-aware rewrite that *verifies its own output* — so a substitution step can never again succeed at doing nothing."

**⏱️ The 10-Minute Script Outline:**

*   **Hook & Demo (0:00 - 1:00):** Open `deploy-prod.yml`. Six confident lines of `sed -i 's|${SYNC_TO_LINEAR_URL}|https://22047910...|g'`. Now open the file they rewrite: there is no `${SYNC_TO_LINEAR_URL}` in it — there is a hardcoded *dev* portal URL. Every one of those seds matches nothing, exits 0, and the deploy goes green. Production workflow actions are POSTing to the development portal. Show `grep -c` proving all nine action URLs point at the same dev portal id.

*   **The Architecture (1:00 - 3:00):** One codebase, three portals. Workflow action `hsmeta` files carry an `actionUrl` — an absolute, portal-specific URL. The original design put `${VAR}` placeholders in the files and substituted them at deploy time. Then somebody hit a local `hs project upload` that shipped the literal placeholder, and fixed it the obvious way: hardcode the dev URL so local uploads work. That one reasonable commit silently disarmed the entire staging and prod pipeline, because **`sed` treats "matched nothing" as success**. The lesson is not "don't use sed." It is that a transformation step must assert its postcondition, or it is decoration. So: rewrite by *portal id* across the whole directory — which covers files added tomorrow — then verify every URL and exit non-zero if any is wrong.

*   **Step-by-Step Implementation (3:00 - 8:00):**
    1.  **Prove the bug before touching anything** — `grep -rn '\${' src/app/workflow-actions/` returns nothing, while the workflows still substitute those placeholders. Then `grep -ho 'https://[0-9]*\.hs-sites' src/app/workflow-actions/*.json | sort | uniq -c` → `9 https://51869810.hs-sites`. Nine actions, one portal, three environments.
    2.  **Rewrite by portal id, not by filename** (`.github/scripts/set-action-urls.sh`) — one `perl -pi` over `*-hsmeta.json` swapping the dev host for the target host. `perl` rather than `sed -i` so it runs the same on macOS and Linux. This is what makes newly added actions safe: three Breeze agent tools had shipped with no sed line at all.
    3.  **Verify, and fail the deploy** — loop the files, pull each `actionUrl`, and reject anything that still holds a `${` or names a different portal. Print one `ok` line per file so the deploy log shows exactly what will ship. `exit 1` on any failure.
    4.  **Delete the dead config** — with no `${...}` left anywhere, the `*_URL` variables in `hsprofile.dev/staging/prod.json` are decoration that implies substitution still happens. Remove them so the next person doesn't trust a mechanism that isn't running.

*   **Testing & Wrap-up (8:00 - 10:00):** Test the script the way you'd test any other code — on a copy. `cp src/app/workflow-actions/*.json /tmp/wa/`, run it for staging, and watch nine `ok` lines and `uniq -c` flip to the staging portal. Then break it on purpose: drop in a file containing `"actionUrl": "${SYNC_TO_LINEAR_URL}"`, re-run, and confirm `FAIL … unresolved placeholder` and `exit=1`. Wrap-up: the original seds were never *wrong*, they just stopped being *relevant* — and nothing in the pipeline was able to notice the difference. Any build step that transforms files should be able to fail.

**💻 Screen-Ready Code Snippets:**

**Before — six lines that match nothing and exit 0:**
```yaml
- name: Set sync function URLs
  run: |
    sed -i 's|${SYNC_TO_LINEAR_URL}|https://22047910.hs-sites.com/hs/serverless/sync-to-linear|g' src/app/workflow-actions/sync-to-linear-hsmeta.json
    sed -i 's|${SYNC_TO_ASANA_URL}|https://22047910.hs-sites.com/hs/serverless/sync-to-asana|g' src/app/workflow-actions/sync-to-asana-hsmeta.json
    # …four more, none of which match anything any more
```

**After — one call, covering every action, that can fail:**
```yaml
- name: Point workflow action URLs at this portal
  run: .github/scripts/set-action-urls.sh 22047910
```

**The rewrite — by portal id, so new actions are covered automatically:**
```bash
#!/usr/bin/env bash
set -euo pipefail

DEV_PORTAL_ID=51869810
TARGET_PORTAL_ID="${1:?usage: set-action-urls.sh <target-portal-id> [actions-dir]}"
ACTIONS_DIR="${2:-src/app/workflow-actions}"

shopt -s nullglob
files=("$ACTIONS_DIR"/*-hsmeta.json)
[ ${#files[@]} -eq 0 ] && { echo "error: no hsmeta files in $ACTIONS_DIR" >&2; exit 1; }

# perl -pi, not sed -i: portable across GNU and BSD/macOS.
perl -pi -e "s|https://${DEV_PORTAL_ID}\\.hs-sites\\.com|https://${TARGET_PORTAL_ID}.hs-sites.com|g" "${files[@]}"
```

**The verify — the half that actually prevents the outage:**
```bash
failures=0
for f in "${files[@]}"; do
  url="$(grep -o '"actionUrl"[[:space:]]*:[[:space:]]*"[^"]*"' "$f" | head -1 | sed 's/.*:[[:space:]]*"//; s/"$//')"
  [ -z "$url" ] && { echo "  SKIP $(basename "$f") — no actionUrl"; continue; }

  if [[ "$url" == *'${'* ]]; then
    echo "  FAIL $(basename "$f") — unresolved placeholder: $url" >&2
    failures=$((failures + 1))
  elif [[ "$url" != "https://${TARGET_PORTAL_ID}.hs-sites.com/"* ]]; then
    echo "  FAIL $(basename "$f") — points at another portal: $url" >&2
    failures=$((failures + 1))
  else
    echo "  ok   $(basename "$f") — $url"
  fi
done

[ "$failures" -gt 0 ] && { echo "error: $failures action(s) would deploy with the wrong actionUrl" >&2; exit 1; }
echo "All ${#files[@]} workflow action URL(s) point at portal $TARGET_PORTAL_ID"
```

**Proving it on a copy, both directions:**
```console
$ cp src/app/workflow-actions/*.json /tmp/wa/ && .github/scripts/set-action-urls.sh 51869787 /tmp/wa
Rewriting actionUrl host to portal 51869787 in 9 file(s)
  ok   breeze-content-pipeline-hsmeta.json — https://51869787.hs-sites.com/hs/serverless/breeze-content-pipeline
  …
All 9 workflow action URL(s) point at portal 51869787

$ printf '{"config":{"actionUrl":"${SYNC_TO_LINEAR_URL}"}}' > /tmp/wa/broken-hsmeta.json
$ .github/scripts/set-action-urls.sh 22047910 /tmp/wa; echo "exit=$?"
  FAIL broken-hsmeta.json — unresolved placeholder: ${SYNC_TO_LINEAR_URL}
error: 10 workflow action(s) would deploy with the wrong actionUrl
exit=1
```
