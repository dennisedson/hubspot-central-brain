#!/usr/bin/env bash
#
# Point every workflow-action `actionUrl` at the portal being deployed to.
#
# WHY THIS EXISTS
# ---------------
# The hsmeta files are committed carrying the DEV portal's URLs, so a local
# `hs project upload` just works. Every other environment must rewrite them
# before upload — otherwise its workflow actions call back into the dev portal,
# hitting dev's serverless functions with dev's token against dev's records.
# Nothing surfaces that: the action still returns 200 and the workflow still
# looks green.
#
# This replaced six per-file lines of the form
#
#     sed -i 's|${SYNC_TO_LINEAR_URL}|https://<portal>.hs-sites.com/...|g' <one file>
#
# which had silently become no-ops. The `${...}` placeholders they matched were
# removed from the hsmeta files in 5db1c67, and sed exits 0 when it matches
# nothing — so staging and prod deploys kept "succeeding" while shipping dev
# URLs. Two things follow from that failure:
#
#   1. The rewrite is by PORTAL ID across the whole directory, so a newly added
#      action is covered the day it lands. The three Breeze agent tools were
#      added without matching sed lines and nobody noticed.
#   2. The rewrite is VERIFIED, and a bad verify fails the deploy. A
#      substitution step that cannot fail is a substitution step that cannot be
#      trusted.
#
# Usage: set-action-urls.sh <target-portal-id> [actions-dir]

set -euo pipefail

DEV_PORTAL_ID=51869810
TARGET_PORTAL_ID="${1:?usage: set-action-urls.sh <target-portal-id> [actions-dir]}"
ACTIONS_DIR="${2:-src/app/workflow-actions}"

if ! [[ "$TARGET_PORTAL_ID" =~ ^[0-9]+$ ]]; then
  echo "error: target portal id must be numeric, got '$TARGET_PORTAL_ID'" >&2
  exit 1
fi

shopt -s nullglob
files=("$ACTIONS_DIR"/*-hsmeta.json)

if [ ${#files[@]} -eq 0 ]; then
  echo "error: no *-hsmeta.json files found in $ACTIONS_DIR" >&2
  exit 1
fi

echo "Rewriting actionUrl host to portal $TARGET_PORTAL_ID in ${#files[@]} file(s)"

# perl -pi rather than sed -i: portable across GNU and BSD/macOS.
perl -pi -e "s|https://${DEV_PORTAL_ID}\\.hs-sites\\.com|https://${TARGET_PORTAL_ID}.hs-sites.com|g" "${files[@]}"

# --- verify ---------------------------------------------------------------
# Every actionUrl must now name the target portal, and nothing may be left
# unresolved. Anything else fails the deploy rather than shipping quietly.
failures=0

for f in "${files[@]}"; do
  url="$(grep -o '"actionUrl"[[:space:]]*:[[:space:]]*"[^"]*"' "$f" | head -1 | sed 's/.*:[[:space:]]*"//; s/"$//')"

  if [ -z "$url" ]; then
    echo "  SKIP $(basename "$f") — no actionUrl"
    continue
  fi

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

if [ "$failures" -gt 0 ]; then
  echo "error: $failures workflow action(s) would deploy with the wrong actionUrl" >&2
  exit 1
fi

echo "All ${#files[@]} workflow action URL(s) point at portal $TARGET_PORTAL_ID"
