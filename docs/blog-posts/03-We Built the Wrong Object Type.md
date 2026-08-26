# We Built the Wrong Object Type

*The story behind Episode 15: One Object, Two Pipelines*

---

We built a separate custom object for changelogs. It seemed like the right call at the time.

Blog posts, tutorials, and videos are content. Changelogs are a product communication artifact — different lifecycle, different stakeholders, different pipeline stages. They felt like a different *thing*. So we created `changelog_entry` as its own HubSpot custom object with its own Changelog Lifecycle pipeline.

A few weeks in, we realized we'd created more problems than we'd solved.

## What We Got Wrong

**We were modeling the tool, not the data.**

A changelog entry is still a piece of content. It has a title, a Linear issue URL, an Asana task, a target publish date, topic tags. It goes through an editorial process. It gets assigned, reviewed, published. The fact that its lifecycle stages are named differently ("Identified" instead of "Idea") doesn't make it a fundamentally different entity — it just means it goes through different checkpoints.

By creating a separate object type, we multiplied everything:
- Two sets of HubSpot workflow actions (one per object type)
- Two functions to upsert records (`upsertContent` and `upsertChangelog`)
- Two portal configs with duplicated property maps
- Two places to look when debugging why a record wasn't syncing
- No easy way to build a single "all open work" view in HubSpot

The code duplication was particularly rough. `upsertChangelog` was nearly identical to `upsertContent` with different pipeline IDs. Any bug fix or enhancement had to be applied twice.

## The Question That Changed Our Thinking

The moment we stepped back and asked *"does a changelog need its own object type, or just its own pipeline?"* the answer was obvious.

HubSpot custom objects support multiple pipelines. A single `content_piece` record can be in either the Content Lifecycle pipeline or the Changelog Lifecycle pipeline. The object type defines the *shape* of the data (what properties it has). The pipeline defines the *workflow* it goes through. Shape and workflow are different axes — we'd been conflating them.

We consolidated `changelog_entry` into `content_piece` by:
1. Adding a second pipeline ("Changelog Lifecycle") to the existing object
2. Adding a `content_type` property to distinguish changelogs in views and filters
3. Replacing `upsertChangelog` with a `pipelineKey` parameter on `upsertContent`

```typescript
// Before: two functions
await upsertContent(payload, portalId);
await upsertChangelog(payload, portalId);

// After: one function, one parameter
await upsertContent(payload, portalId, 'content');
await upsertContent(payload, portalId, 'changelog');
```

The portal config went from flat to nested:

```typescript
// Before
content: {
  pipelineId: '926238627',
  stageIds: { idea: '...', ... }
}

// After
content: {
  pipelines: {
    content: { pipelineId: '926238627', stageIds: { idea: '...', ... } },
    changelog: { pipelineId: '926240000', stageIds: { identified: '...', ... } },
  }
}
```

## Was It Worth the Refactor?

Yes — and it was less painful than expected. We were working with test data only, so no real records needed migrating. All 84 tests updated to the new config shape and still passed. The net diff was 89 lines removed.

More importantly, we can now build a single HubSpot view showing all open work — blog posts, tutorials, and changelogs — filtered by pipeline. One object to query. One set of workflow actions to maintain.

## When to Use a Separate Object vs. a Separate Pipeline

The rule we'd apply going forward: use a separate object type when the *data shape* is genuinely different (different properties, different associations). Use a separate pipeline when the *workflow* is different but the data is the same.

Changelogs and blog posts share properties. They go through different workflows. One object, two pipelines.

If we were modeling something like a video production schedule — with unique properties like shot lists, upload queues, and thumbnail approvals — that might deserve its own object. The properties are different enough that merging it with `content_piece` would be awkward.

The tell: if you're duplicating your property definitions and most of your handler code, you probably don't need a separate object.

---

*Watch the clean build in [Episode 15: One Object, Two Pipelines](../walkthroughs/15-One%20Object%20Two%20Pipelines%3A%20Consolidating%20HubSpot%20Custom%20Objects.md)*
