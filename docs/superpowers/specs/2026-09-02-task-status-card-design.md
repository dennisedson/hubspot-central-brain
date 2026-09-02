# Linear/Asana Status Card — Design

**Date:** 2026-09-02
**Roadmap:** Phase 4 (UI Extensions), first task — "Build Linear/Asana Status Card for Content and Changelog records"
**Status:** Approved, ready for implementation plan

## Problem

A `content_piece` record shows its pipeline stage, but nothing about the Linear issue or Asana task it is synced with. To answer "who owns this, when did it last move, and is the sync actually correct?" you have to open two other tools.

The roadmap outcome is: *see task status without leaving HubSpot.*

## Goal

A read-only CRM card on `content_piece` records showing live Linear issue and Asana task status side by side, and flagging when either has drifted out of sync with the HubSpot pipeline stage.

## Non-goals

- **No write actions.** No state changes, no reconcile button. The roadmap task is "see task status"; reconciliation is a separate decision with real risk.
- No card on `video` records — the roadmap covers those under the later Related Content Card.
- No new custom object properties. Everything needed is already on `content_piece`.

## Why live, not stored

The record's pipeline stage is already the HubSpot-side mirror of Linear state, kept current by the existing bidirectional sync. A card reading only stored fields would restate what is already on screen.

The value is in what the sync does *not* store: assignee, last-updated time, issue title, Asana section — and, critically, whether the two sides actually agree.

## Architecture

```
content_piece record
      │  context.crm.objectId
      ▼
TaskStatusCard.tsx  ──  hubspot.serverless('task_status_api', { parameters })
      │
      ▼
TaskStatusApi.ts
      ├── read record: linear_issue_id, asana_task_id, hs_pipeline, hs_pipeline_stage
      ├── getLinearIssue()  ─┐
      ├── getAsanaTask()    ─┴─ in parallel, failures isolated
      ├── computeDrift() per source, pipeline-aware
      └── { statusCode, body: JSON }
```

The card calls the function **by uid** via `hubspot.serverless()`, matching the pattern proven in `SettingsApp.tsx`. That path returns `{ statusCode, body }` with `body` as a JSON string; the function reads inputs through the existing `param()` helper shape (`ctx.parameters ?? ctx.query ?? ctx.body`). Both details were hard-won in earlier commits (`da8f677`, `71a7997`) — reuse them rather than rediscover them.

## Files

| Action | Path | Responsibility |
|---|---|---|
| Create | `src/app/cards/task-status-hsmeta.json` | Card component config |
| Create | `src/app/cards/TaskStatusCard.tsx` | Card UI |
| Create | `src/app/cards/package.json` | Card deps (`@hubspot/ui-extensions`, react) |
| Create | `src/app/cards/tsconfig.json` | Card TS config |
| Create | `src/app/functions/TaskStatusApi.ts` | Endpoint: read record, fetch both, compute drift |
| Create | `src/app/functions/TaskStatusApi-hsmeta.json` | Function config + secrets |
| Create | `src/app/lib/drift.ts` | Pipeline-aware comparison |
| Modify | `src/app/lib/linear-client.ts` | Add `getLinearIssue()` |
| Modify | `src/app/lib/asana-client.ts` | Add `getAsanaTask()` |
| Modify | `.github/workflows/deploy-{dev,staging,prod}.yml` | Substitute per-portal object type ID |
| Create | `src/app/__tests__/drift.test.ts` | Drift logic, both pipelines |

`linear-client.ts` is currently write-only — `getLinearStates`, `findStateIdByName`, `updateLinearIssueState`. There is no way to read a single issue, so `getLinearIssue()` is genuinely new, not a refactor.

`drift.ts` is a separate module rather than an addition to `mapping.ts`, keeping the mapping tables pure data and the comparison independently testable.

## Drift must be pipeline-aware

This is the subtle requirement and the most likely source of a wrong implementation.

`content_piece` carries **two pipelines** (content and changelog, consolidated per walkthrough 15), and `mapping.ts` holds **separate tables for each**: `LINEAR_STATE_TO_CONTENT_STAGE` vs `LINEAR_STATE_TO_CHANGELOG_STAGE`, and likewise `ASANA_STAGE_TO_CONTENT_STAGE` vs `ASANA_STAGE_TO_CHANGELOG_STAGE`.

The function must read the record's `hs_pipeline`, resolve it against `portal-config` to decide which pipeline the record is on, and select the matching table. Using the content table on a changelog record would report false drift on every changelog record — a bug that looks like a broken sync and would send someone hunting the wrong thing.

### The mappings are many-to-one in both directions

Discovered while planning, and the single most likely source of false drift reports.

`CONTENT_STAGE_TO_LINEAR_STATE` maps **both** `drafting` and `editing` to Linear `In Progress`. `LINEAR_STATE_TO_CHANGELOG_STAGE` maps **both** `Backlog` and `Canceled` to `identified`. So neither comparison direction alone is correct:

- Forward only: an `editing` record with Linear `In Progress` reports drift, because the reverse of `In Progress` is `drafting`. Wrong.
- Reverse only: an `identified` changelog record with Linear `Canceled` reports drift, because the forward of `identified` is `Backlog`. Also wrong.

The comparison must therefore accept **either** direction matching:

```
inSync = FORWARD[stage] === externalState || REVERSE[externalState] === stage
```

Both false positives above resolve to in-sync, while a genuine mismatch (`drafting` vs `Done`) still fails both checks and correctly reports drift. The same rule applies to Asana, whose tables are lossy in the same way (`drafting` and `editing` share one enum GID).

Asana drift is computed symmetrically. The tables already exist, so it costs almost nothing, and showing drift for only one system on a card named "Linear/Asana Status" would be an odd asymmetry.

## Response contract

```json
{
  "linear": {
    "identifier": "DAD-142",
    "title": "Add webhook retry",
    "state": "In Progress",
    "assignee": "dennis",
    "updatedAt": "2026-09-02T18:04:00.000Z",
    "url": "https://linear.app/...",
    "drift": { "inSync": false, "expectedStage": "Editing", "actualStage": "Drafting" }
  },
  "asana": {
    "name": "Draft blog post",
    "section": "In Review",
    "assignee": "dennis",
    "url": "https://app.asana.com/...",
    "drift": { "inSync": true }
  },
  "pipeline": "content",
  "stageLabel": "Drafting",
  "errors": { "linear": null, "asana": null }
}
```

`linear` or `asana` is `null` when the record carries no corresponding ID — a normal empty state, not an error. `drift` is `null` when a state cannot be mapped to any stage, which is reported as unknown rather than as drift.

## Error handling

Each source resolves independently. Linear failing must never blank the Asana half.

| Condition | Card shows |
|---|---|
| Both IDs present, both fetch | Full status for both, drift per source |
| No `linear_issue_id` | "Not linked to Linear" empty row |
| Linear API errors | Inline error row for Linear; Asana still renders |
| Neither ID present | Single empty state for the card |
| Function itself fails | Card-level error with a retry |

## Per-portal object type ID — SUPERSEDED

> **This section was wrong.** Build #177 rejected the type id outright:
> `The object name '2-67505887' is invalid ... If this is supposed to be a custom object, prefix it with 'p_'`.
>
> Card `objectTypes` takes the custom object **name**, not the per-portal type id. `p_content_piece` is identical in every portal, so no substitution is needed and none is used. The `sed` step briefly added to the three deploy workflows was removed in `700ce22`.
>
> The original reasoning below is kept because the underlying observation was correct — `content_piece` really does have a different type id per portal (dev `2-67505887`, staging `2-67508770`, prod `2-67508928`) — but it was solving a problem the platform does not have here.

## Card location

`crm.record.tab`.

`crm.record.sidebar` would suit a compact status readout better, but `crm.record.tab` is the only location confirmed valid in the official 2026.03 sample. Given this project's recent history of opaque deploy failures, the plan starts on the confirmed value and treats sidebar as a follow-up experiment — a one-line change, cheap to test now that deploys are reliable.

## Testing

Vitest for `drift.ts` and the response shaping with mocked `fetch`, matching the existing `src/app/__tests__` patterns. Required cases:

- content-pipeline record, states agree → in sync
- content-pipeline record, states differ → drift with correct expected stage
- **changelog-pipeline record whose state agrees → in sync** (the false-drift trap; fails if the content table is used)
- unmappable state → `null`, not drift
- Linear rejects, Asana resolves → Asana data intact, Linear error populated

The card UI has no unit-test harness. It is verified by a green deploy plus opening a real record.

## Verification

1. `npm run validate` — note the pre-existing lint error in `src/scripts/provision-app-settings.ts:53` fails this before tests run; typecheck and tests must be confirmed separately until that is fixed.
2. Green CI run: `Building`/`Deploying` DONE for the new components **and** overall run conclusion `success`.
3. Open a `content_piece` record on dev with both a Linear issue and an Asana task; confirm both render.
4. Open a changelog-pipeline record; confirm it does **not** report false drift.
