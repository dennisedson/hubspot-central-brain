#!/usr/bin/env bash
#
# Upload the project to a non-dev portal with the workflow action URLs pointed
# at that portal, then put the working tree back.
#
# WHY THIS EXISTS
# ---------------
# `hs project upload --account=<staging|prod>` on its own ships whatever
# actionUrl is committed — which is the DEV portal's. CI got a rewrite step
# (see set-action-urls.sh); a developer running `npm run upload:staging` from
# their laptop did not, so the same wrong-portal deploy was still one command
# away.
#
# The rewrite edits tracked files, so this refuses to run on a dirty
# workflow-actions directory (it would have nothing safe to restore to) and
# restores them on any exit path, including a failed upload or a Ctrl-C.
#
# Usage: upload-to-portal.sh <target-portal-id> <hs-account-name>

set -euo pipefail

TARGET_PORTAL_ID="${1:?usage: upload-to-portal.sh <target-portal-id> <hs-account-name>}"
ACCOUNT="${2:?usage: upload-to-portal.sh <target-portal-id> <hs-account-name>}"
ACTIONS_DIR="src/app/workflow-actions"

if ! git diff --quiet -- "$ACTIONS_DIR" || ! git diff --cached --quiet -- "$ACTIONS_DIR"; then
  echo "error: $ACTIONS_DIR has uncommitted changes." >&2
  echo "       This script rewrites those files and restores them afterwards," >&2
  echo "       which would discard your edits. Commit or stash them first." >&2
  exit 1
fi

restore() {
  echo "Restoring $ACTIONS_DIR to the committed (dev) URLs"
  git checkout -- "$ACTIONS_DIR"
}
trap restore EXIT

"$(dirname "$0")/set-action-urls.sh" "$TARGET_PORTAL_ID" "$ACTIONS_DIR"

hs project upload --account="$ACCOUNT"
