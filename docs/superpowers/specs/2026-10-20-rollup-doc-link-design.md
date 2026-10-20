# Rollup doc links from Linear releases — design

**Status:** approved 2026-10-20, being built on `feat/rollup-doc-link`.
**Supersedes:** the *rollup* half of
[`2026-09-30-content-containers-and-lineage-design.md`](2026-09-30-content-containers-and-lineage-design.md)
(issue #78). The video-series half of that spec is unaffected.

---

## 1. What this is for

Changelog entries go out in a monthly digest — "the October rollup", "the
November rollup". The digest is written by someone else, in a Google Doc they
own. Each of my entries that is going into a digest should carry a link to that
doc, without anyone copying it by hand, and without the digest owner's Linear
issue ever becoming a record in my portal.

## 2. Linear already holds membership: releases

The team tracks digests as **Linear releases**. Verified against the workspace
on 2026-10-20:

| | |
|---|---|
| pipeline | **Monthly Changelog Rollups**, type `scheduled` |
| releases | `October 2026 Changelog Rollup` (In Progress, 6 issues), `November 2026 Changelog Rollup`, … through `August 2027 Changelog Rollup` |
| also in the pipeline | `Spring 2027 Spotlight` (24 issues), `Fall 2027 Spotlight` |
| October's links / documents | none yet |

Of October's six issues, two are assigned to me (DEVADV-876, DEVADV-319). The
rest belong to other people or no one, and under assignee-first sync they never
reach HubSpot. That is the point: this feature only ever updates records that
already exist.

What Linear's API gives us (public schema, `packages/sdk/src/schema.graphql`):

- `Issue.releases` — an issue can be in several releases.
- `IssueWebhookPayload.releases: [ReleaseChildWebhookPayload!]!` — `id`, `name`,
  `pipeline { id name type }`, `stage`, `version`. **No links.** Not yet
  observed on a live webhook.
- `Release.links` — external links (`url`, `label`). `EntityExternalLinkCreateInput`
  has a `releaseId`, so a link can be attached to a release.
- `ReleaseFilter.name: StringComparator` — supports `endsWith`.
- Completing a release in a **scheduled** pipeline "may move non-closed issues to
  a new release". So October → November can happen with nobody touching the
  issue.

## 3. Decisions

| question | answer |
|---|---|
| which releases count | **monthly rollups only** — name matches `<Month> <Year> Changelog Rollup`. Spotlights are ignored. |
| where the digest's doc lives | **a Google Docs link on the Linear release** (`docs.google.com/document/d/<id>`). Whoever owns the digest adds it once. |
| where it lands on the entry | **`changelog_doc_url`** — for a rollup entry the digest doc *is* its doc, and `SyncToAsana` already carries that property to the Asana task's Draft file field |
| precedence | **the release's link overrides whatever the entry holds** — a hand-pasted link or a Create Doc document. The old value survives in HubSpot property history. |
| when | **immediately from the webhook, plus a daily sweep** |
| also mirror the release name | **yes** — `changelog_rollup`, so "everything in October" is one HubSpot filter |

## 4. The rule

For one entry, given the monthly rollups its issue is in *according to Linear*:

| issue is in… | that release's doc | `changelog_doc_url` | `changelog_rollup` |
|---|---|---|---|
| one monthly rollup | one Google Doc | **set to it** | set to the release name |
| one monthly rollup | none | **cleared** if it is a rollup doc, else left | set to the release name |
| one monthly rollup | two different Google Docs | left; reported | set to the release name |
| no monthly rollup | — | **cleared** if it is a rollup doc, else left | cleared |
| two or more monthly rollups | — | left; reported | left; reported |

**"A rollup doc"** means its Google Doc id matches the doc id of a Google Docs
link on *any* monthly rollup release, including one whose link set is
ambiguous. That is how a link this feature wrote is told apart from one a person
pasted or Create Doc made, without storing provenance. Doc links are compared by
document id, not by URL string, so `…/edit` and `…/edit?tab=t.0` are the same
doc.

## 5. Two paths

### 5.1 The webhook — set only

`LinearWebhook` already receives every update to my issues, and the payload
names its releases. After its existing write — in **both** branches, the upsert
and the "stage already matches" branch, because adding an issue to a release
does not change its state and that branch is the one that will fire — it:

1. picks the payload's monthly rollups; none, or more than one → does nothing;
2. reads that release's links from Linear (one query) and picks the doc;
3. writes `changelog_rollup`, and `changelog_doc_url` when there is exactly one
   doc, by **PATCH on `linear_id`, which can never create a record**.

It never clears. A payload with no `releases` field changes nothing. The whole
step is wrapped so that **nothing in it can fail the stage sync**: a Linear
error, an unprovisioned property or a 404 is logged and reported in the
response body as `rollup`, and the webhook still answers 200.

The webhook gains `LINEAR_API_KEY` in its `secretKeys`. That secret already
exists on both portals (`sync_to_linear` declares it), so this does not hit the
"secret that does not exist yet" deploy deadlock.

### 5.2 The daily sweep — set and clear

A new workflow action, `RollupDocSync`, enrolled daily on the App Config record
the same way the Asana poll is. It:

1. lists every monthly rollup release with its links and **all** its issue ids;
2. finds the entries to consider — `linear_id IN` those issue ids, plus every
   entry that already has `changelog_doc_url` or `changelog_rollup` set (so it
   can clear what has gone stale);
3. applies the rule to each, and batch-updates only entries whose values change;
4. returns `outputFields` with counts — updated, cleared, skipped and why.

It authenticates with `SYNC_SHARED_SECRET`, like `SyncToLinear`. It stops
before writing if its 16-second budget runs out during reads, and between batch
chunks if it runs out during writes, returning `partial` — the next run picks up
the rest. It never creates a record.

**Pagination is strict.** The sweep's decisions depend on knowing an issue is
*not* in a rollup, so a partial list would clear real links. Every Linear
connection is paged to the end, and any failure or truncation throws and aborts
the run before anything is written. This is deliberately *not*
`AppSettingsApi`'s `fetchAllPages`, which returns what it has when a later page
fails — right for a settings dropdown, wrong here.

## 6. Units

| unit | does |
|---|---|
| `src/app/lib/rollup-doc.ts` | **pure**. `isMonthlyRollup(name)`, `googleDocId(url)`, `pickRollupDoc(urls)`, `decideEntry(...)`. All of the rule lives here. |
| `src/app/lib/linear-client.ts` | `getReleaseDocLinks(apiKey, releaseId)`, `listMonthlyRollups(apiKey)`, and a strict paginator they share |
| `src/app/lib/hubspot-client.ts` | `updateByLinearId` (PATCH by `idProperty`, 404 → `false`, never creates), `searchContentPaged`, `batchUpdateContent` |
| `src/app/lib/hs-api.ts` | `objectBatchUpdatePath` |
| `src/app/functions/LinearWebhook.ts` | §5.1 |
| `src/app/functions/RollupDocSync.ts` + hsmeta + workflow-action hsmeta | §5.2 |
| `src/scripts/provision-changelog-drafting.ts` | adds `changelog_rollup` |
| `src/scripts/provision-workflows.ts` | adds **"Changelog Rollup Docs (Daily)"**, App Config, disabled, no schedule — set it by hand like the other dailies |
| `src/scripts/preflight.ts` | `changelog_rollup` joins `REQUIRED_PROPERTIES` (`changelog_doc_url` is already there) |

**Naming constraint.** `provision-workflows.ts` finds actions by substring, in
order: anything whose uid or name contains `linear`, `poll`, `asana`, `youtube`,
`fellow`, `social` or `associate related` is taken for an existing action. The
new action is uid `rollup_doc_sync_v1`, named "Sync Rollup Doc Links", and a
test pins that it matches none of those words.

## 7. Tests

Written failing first, per `CLAUDE.md`. Mocks route on URL and GraphQL query
text, never call order, and return what the APIs return.

- `rollup-doc.test.ts` — every row of §4; the control (an entry with its own doc
  whose issue is in no rollup is left alone); Spotlight names rejected; doc-id
  comparison across URL variants; Sheets and non-Google links ignored.
- `linear-client.test.ts` — the strict paginator follows pages, throws on a
  failed page, throws when a page cap is hit with more remaining; links
  `hasNextPage` throws.
- `linear-webhook.test.ts` — the stage-already-matches branch writes the link
  (the rollout-date regression shape); a Linear failure still answers 200 with
  the stage synced; a Spotlight-only payload makes no Linear call; a payload
  with no `releases` makes no write; existing tests stay green as the control.
- `rollup-doc-sync.test.ts` — sets; Oct → Nov clears the old link and sets the
  new; an issue in two rollups is skipped; a second page of issues is fetched;
  nothing is ever POSTed to a create endpoint; unchanged entries are not
  written; a bad secret is rejected; a failed Linear page aborts with no writes.
- `hs-api.test.ts`, `function-endpoints-are-justified.test.ts`,
  `workflow-actions.test.ts` — the new path, the allowlist entry, and the naming
  constraint.

## 8. Rollout order — the property must exist before the code writes it

Writing a property a portal does not have fails the write. The webhook step is
guarded, so the stage sync survives, but nothing rollup-related would land.

1. `PORTAL=dev npm run provision:changelog-drafting` (adds `changelog_rollup`)
2. merge → dev deploys
3. `PORTAL=dev npm run provision:workflows`, then set the new workflow's daily
   schedule and enable it in the UI
4. attach the digest's Google Doc to `October 2026 Changelog Rollup` in Linear
5. run the workflow once; DEVADV-876 and DEVADV-319 get the link and nothing
   else changes
6. the same on prod, then `npm run preflight`

## 9. To verify on the live system

1. That adding an issue to a release sends an `Issue` webhook with `releases`
   populated. If it does not, the sweep still delivers within a day.
2. That a link can be attached to a release in Linear's UI. The API supports it.

## 10. Known limitations

- The link reaches the Asana task's Draft file field the next time the entry
  changes stage, because that is when `SyncToAsana` runs. Create Doc links
  behave the same today.
- A release with more than one Google Doc link sets nothing until it has one.
- Identifying rollups by name means a renamed release stops counting. The names
  are systematic today; the pattern is one constant.

## 11. Out of scope

- The `hs-include` label, `cb_contains`, `container_kind` — releases make them
  unnecessary for rollups.
- Writing anything to Linear.
- Spotlight digests.
