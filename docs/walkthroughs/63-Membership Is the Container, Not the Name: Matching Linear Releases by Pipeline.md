## 🎬 YouTube Episode Guide: Membership Is the Container, Not the Name

**🎯 Core Learning Objective:**
"By the end of this video, you will know how to work out why a synced value is 'missing' before you force a resync, and how to switch a membership rule from matching names to matching the container's stable id, including what to do when a webhook payload may or may not tell you the container."

**⏱️ The 10-Minute Script Outline:**

*   **Hook & Demo (0:00 - 1:00):**
    "Linear shows DEVADV-555 in a release. HubSpot shows nothing. My first instinct was to force a full resync. The sync would have changed nothing."

    Show the Linear sidebar: *Monthly Changelog Rollups · Spring 2027 Spotlight · Apr 1*. Then the HubSpot record with an empty *Changelog Rollup*. Then the punchline: the preview of a full sweep says "would update 0 records".

*   **The Architecture (1:00 - 3:00):**
    Plain English. Before resyncing, ask which rule decided the outcome. Here the rule was "a digest is a release **named** `<Month> <Year> Changelog Rollup`". Spotlights live in the same pipeline but have different names, so they were never mirrored, and that was by design.

    The fix is to change what counts as membership: **the container, matched by its id.** Every release in the *Monthly Changelog Rollups* pipeline counts. An id survives a rename; a name pattern doesn't survive a new kind of release.

    State the trade-off out loud, because the operator chose it knowingly: an issue in both October and Spring Spotlight is now in *two* digests, so it gets neither and is reported.

*   **Step-by-Step Implementation (3:00 - 8:00):**

    **Step 1: Preview before you force (3:00 - 4:15).**
    Show the dry-run script. It runs the sweep's real reads and real `decideEntry` and skips the `batchUpdate`. The result is 0 changes. Then the release-by-release report: every monthly entry is correct, and 12 Spotlight issues have a record but an empty release. Now the gap is a fact, not a guess.

    **Step 2: Turn the rule into an id (4:15 - 5:15).**
    `rollup-doc.ts`: `isMonthlyRollup(name)` becomes `isRollupPipeline(id)` against `ROLLUP_PIPELINE_ID`. `RollupRelease` gains `pipelineId`, and `planSweep` filters on it. Tests first: the Spotlight is now included, a release from another pipeline with an October-looking name is excluded, and both failed before the change.

    **Step 3: Ask Linear by pipeline (5:15 - 6:15).**
    `listRollupReleases` filters with `releases(filter: { pipeline: { id: { eq: $pipelineId } } })`, checked live first (a made-up id returns `[]`, the real one returns all 8 releases), then checks the pipeline again client-side. `getRelease` returns name, pipeline and links in one query.

    **Step 4: When the payload might not tell you (6:15 - 8:00).**
    Linear's schema says the issue webhook carries each release's pipeline, but nobody has seen a live payload with it. So the webhook works in three tiers:
    - the payload places the release in **another** pipeline: no call, nothing written;
    - the payload places it **in** the rollup pipeline, or says nothing: look it up;
    - the lookup fails: write the name only if the payload itself said "rollup pipeline". Without that, there's nothing to go on, so it reports instead.

*   **Testing & Wrap-up (8:00 - 10:00):**
    Run the four suites: rule, Linear client, sweep, webhook. Show the two webhook tests that make the tiers concrete: "asks Linear for the pipeline when the payload doesn't say" and "writes nothing, and says why, when Linear cannot be reached and the payload named no pipeline". Then the backfill: after deploy, one sweep fills the 12 Spotlight records, previewed first.

    Recap: a missing value is a question about a rule before it's a reason to resync; match membership on the container's id, not on a name; and when an input field is only documented, design for both its presence and its absence.

**💻 Screen-Ready Code Snippets:**

The rule: `src/app/lib/rollup-doc.ts`:

```ts
/** Linear's "Monthly Changelog Rollups" pipeline — monthly rollups AND Spotlights. */
export const ROLLUP_PIPELINE_ID = 'b597dbf5-1813-447d-ba29-2a13106b9274';

export function isRollupPipeline(pipelineId: string | null | undefined): boolean {
  return pipelineId === ROLLUP_PIPELINE_ID;
}
```

Asking Linear by container: `src/app/lib/linear-client.ts`:

```graphql
query($first: Int!, $after: String, $pipelineId: ID!) {
  releases(first: $first, after: $after, filter: { pipeline: { id: { eq: $pipelineId } } }) {
    nodes { id name pipeline { id } links(first: 50) { … } issues(first: 50) { … } }
    pageInfo { hasNextPage endCursor }
  }
}
```

The webhook's three tiers: `src/app/functions/LinearWebhook.ts`:

```ts
const candidates = issue.releases.filter(r => !r.pipeline?.id || isRollupPipeline(r.pipeline.id));
for (const candidate of candidates) {
  try {
    const release = await getRelease(apiKey, candidate.id);
    if (isRollupPipeline(release.pipelineId)) rollups.push({ name: release.name, doc: pickRollupDoc(release.linkUrls) });
  } catch (err) {
    // The payload's own word is enough to write the name. Without it, nothing to go on.
    if (isRollupPipeline(candidate.pipeline?.id)) rollups.push({ name: candidate.name, doc: { kind: 'none' } });
  }
}
```

The preview that came before any write:

```text
[prod] Linear: 6 monthly rollup releases
[prod] HubSpot: 9 of 16 rollup issues have a record; 9 records considered in all
[prod] would update 0 record(s), clearing 0 doc link(s)
```
