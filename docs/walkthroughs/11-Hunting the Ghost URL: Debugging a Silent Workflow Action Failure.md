## 🎬 YouTube Episode Guide: Hunting the Ghost URL: Debugging a Silent Workflow Action Failure

**🎯 Core Learning Objective:**
"By the end of this video, you will know how to diagnose a HubSpot workflow action that silently returns 401 without ever calling your function — and how to permanently fix it by forcing a clean re-registration."

---

**⏱️ The 10-Minute Script Outline:**

*   **Hook & Demo (0:00 - 1:00):**
    "The workflow runs. The event log says 401 Unauthorized. But here's the thing — our serverless function was *never called*. Not once. Zero entries in monitoring. So where is that 401 coming from? Today we hunt it down, kill it, and prove the fix works — live — by moving a HubSpot card and watching Linear update in real time."

*   **The Architecture (1:00 - 3:00):**
    Two things happen when you deploy a HubSpot project-based app with a `workflow-action` component:
    1. HubSpot **registers** an action definition in its automation system, storing the `actionUrl` at that moment.
    2. On every subsequent deploy, HubSpot updates labels, input fields, output fields — but **does not update `actionUrl`** for an existing registration.

    So if the very first successful deploy had a wrong `actionUrl` — say, from an early CI commit that used the wrong URL format — every workflow trigger forever after silently hits that wrong URL. Your function sits untouched while HubSpot's own API server returns 401. The monitoring shows nothing because monitoring only tracks calls *to your function*, not calls to a stale ghost URL.

*   **Step-by-Step Implementation (3:00 - 8:00):**

    **Step 1 — Prove the function isn't being called (3:00 - 4:30)**
    Open the workflow event log: it shows `{"error":"Unauthorized"}`. Note: workflow action calls route through HubSpot's internal infrastructure and **never appear in Endpoint Functions monitoring** — even when working correctly. So monitoring absence alone proves nothing. Instead, add a distinctive marker to your function's 401 response (`Unauthorized-HSB-v3`) and redeploy. Trigger the workflow again. Still plain `{"error":"Unauthorized"}` — without your marker. That's the smoking gun: your code is not running at all.

    **Step 2 — Find the ghost URL in git history (4:30 - 5:30)**
    Run `git log --all -- .github/workflows/deploy-dev.yml` and look at the early commits. Find the commit that first added the sed substitution — it used `https://api.hubspot.com/integrations/v1/49103173/serverless/sync-to-linear`, an old-style HubSpot API endpoint that doesn't exist. That's what was baked into the first registration. Every deploy since has been updating everything *except* that URL.

    **Step 3 — Force a fresh registration (5:30 - 7:30)**
    HubSpot won't update `actionUrl` on a re-deploy of the same UID, but it *will* create a brand new registration for a new UID. Change `"uid": "sync_to_linear_action"` to `"uid": "sync_to_linear_v2"` in the workflow-action hsmeta. Add `--force` to the CI deploy step to bypass the component-removal warning. Before deploying, remove the old action from any workflows using it (HubSpot blocks deletion of in-use definitions). Then deploy — old ghost registration deleted, new clean registration created with the correct `hs-sites.com` URL.

    **Step 4 — Fix the stage ID mismatch (7:30 - 8:00)**
    First real call succeeds in reaching the function — but returns 400: `Unknown HubSpot stage: "1418660002"`. The `hs_pipeline_stage` property sends a numeric stage *ID*, not a name. Our mapping used names like `"editing"`. The fix: reverse-lookup the ID against `portal-config.ts` (which already has name→ID mappings) using `Object.entries(stageIds).find(([, id]) => id === hubspotStage)?.[0]`.

*   **Testing & Wrap-up (8:00 - 10:00):**
    Turn the workflow on. Move a content piece to a new pipeline stage. Within seconds, the Linear issue state updates to match. Check the workflow event log — it now shows `syncStatus: success` and `linearStateName`. Both directions of sync are live: Linear changes flow into HubSpot, HubSpot stage changes flow back to Linear. The key lesson: a HubSpot workflow action registration is **write-once for `actionUrl`** — if your first deploy had the wrong URL, you'll never see your function called until you force a new UID.

---

**💻 Screen-Ready Code Snippets:**

**Renamed UID in workflow-action hsmeta:**
```json
{
  "uid": "sync_to_linear_v2",
  "type": "workflow-action",
  "config": {
    "actionUrl": "${SYNC_TO_LINEAR_URL}",
    "isPublished": true
  }
}
```

**Force deploy in CI (deploy-dev.yml):**
```yaml
- name: Configure HubSpot CLI account
  env:
    DEFAULT_ACCOUNT_ID: ${{ secrets.HUBSPOT_DEV_ACCOUNT_ID }}
    DEFAULT_PERSONAL_ACCESS_KEY: ${{ secrets.HUBSPOT_DEV_PERSONAL_ACCESS_KEY }}
  run: |
    mkdir -p ~/.hscli
    printf "defaultAccount: ci\naccounts:\n  - name: ci\n    accountId: %s\n    env: prod\n    authType: personalaccesskey\n    personalAccessKey: '%s'\n    auth:\n      tokenInfo:\n        accessToken: null\n        expiresAt: null\n" \
      "$DEFAULT_ACCOUNT_ID" "$DEFAULT_PERSONAL_ACCESS_KEY" > ~/.hscli/config.yml

- name: Deploy project
  run: hs project deploy --deploy-latest-build --force
```

**Stage ID reverse-lookup in SyncToLinear.ts:**
```typescript
const config = getPortalConfig(context.accountId);
const stageIds = objectType === 'changelog'
  ? config.changelog.stageIds
  : config.content.stageIds;

// HubSpot sends stage IDs ("1418660002"), not names ("editing")
const stageName = Object.entries(stageIds).find(([, id]) => id === hubspotStage)?.[0];

const stageMap = objectType === 'changelog'
  ? CHANGELOG_STAGE_TO_LINEAR_STATE
  : CONTENT_STAGE_TO_LINEAR_STATE;

const targetStateName = stageName
  ? (stageMap as Record<string, string>)[stageName]
  : undefined;
```
