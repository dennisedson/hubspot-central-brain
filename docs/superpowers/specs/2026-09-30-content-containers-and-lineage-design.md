# Content containers and lineage — design

**Status:** proposed, not scheduled. Future enhancement.
**Date:** 2026-09-30
**Tracking issue:** see `enhancement` / `phase-5`

---

## 1. What this is for

Two things we cannot currently express about `content_piece` records:

1. **A monthly changelog rollup.** One published post gathers many changelog
   entries. Today each entry is a record and the rollup is either another
   unrelated record or nothing at all — there is no way to ask "what went into
   September's rollup?"
2. **A video series.** Several videos belong to one series, in order. Today they
   are unconnected records that happen to share a `topic_tags` value.

Both are *containment*: many records belong to one container. Neither is
expressible as a property, because the fact involves two records.

---

## 2. The rule this design follows

> **If the fact can be true of the record alone, it is a property.
> If stating it requires naming another record, it is an association label.**

This is the whole decision procedure, and most of this document is applying it.

`content_piece` already carries the record-level taxonomy:

| property | values |
|---|---|
| `content_type` | Blog Post, Video, Tutorial, Talk, Changelog, Documentation, Social |
| `topic_tags` | API, CRM, Workflows, UI Extensions, Integrations, Developer Platform |

Neither of those should grow to carry containment. "This entry is in the
September rollup" names a second record, so it is a label.

---

## 3. What HubSpot gives us

Verified 2026-09-30 against the docs:

- **Up to 50 association labels per object type pair.** A paired label and its
  inverse count as **one**.
- **A single association can carry several labels at once** — appending is
  supported; sending one label replaces the set.
- **Association labels require a Professional or Enterprise subscription.**
- **Associations carry labels, not data.** There is no place to put a number on
  an association, which decides §5.3 below.

And what this repo already has, from `src/scripts/association-definitions.ts`:

| pair | definition | route |
|---|---|---|
| content_piece ↔ content_piece | **labeled**, `cb_related_content` | `POST /crm/associations/2026-03/{a}/{b}/labels` |
| video ↔ video | **labeled**, `cb_related_video` | same |
| content_piece → video | unlabeled | `POST /crm/v3/schemas/{type}/associations` |

A custom object has **no unlabeled association with itself**, which is why the
self-referential pairings had to be labeled in the first place. That is the
machinery this design extends — it is not new ground.

Label names must pass `collidesWithUnlabeledName`: `content_piece_to_content_piece`
is rejected as a case-insensitive conflict, which is why the existing names are
prefixed `cb_`.

---

## 4. Design

### 4.1 One containment label, not one per use case

Add a single paired label on `content_piece ↔ content_piece`:

| | |
|---|---|
| name | `cb_contains` |
| label | **Includes** |
| inverse label | **Included in** |

A rollup *Includes* its changelog entries; each entry is *Included in* the
rollup. A series *Includes* its episodes. Same structure, one label pair, one
toward the 50.

**What kind of container it is stays on the container record**, as a new
property:

| property | values |
|---|---|
| `container_kind` | *(empty)*, Rollup, Series |

This is the rule from §2 applied honestly: "is this a rollup or a series" is
true of the container by itself, so it is a property. "This piece belongs in
that container" needs two records, so it is a label. Keeping them separate also
means a third container kind later is a property option, not a new association
definition and a provisioning run.

`content_type` is left alone — a rollup is still a Blog Post, and a series
container is still whatever it is. `container_kind` composes with it rather
than competing.

### 4.2 Video series: containers and members are both `content_piece`

The series container is a `content_piece` with `container_kind: Series`. The
members are `content_piece` records with `content_type: Video`.

They are **not** the `video` records. Those represent the published YouTube
asset, and they already associate to their `content_piece` through the existing
cross-type definition — so the series reaches the published videos transitively,
and we avoid having to provision a *labeled* `content_piece ↔ video` definition,
which would be a new route for that pair.

### 4.3 Ordering is a property, because it has to be

A series has episode order. An association cannot carry a number, so order goes
on the member:

| property | type |
|---|---|
| `container_position` | number |

**Known limitation:** a piece that belongs to two containers can only hold one
position. Accepted rather than solved — a junction object would model it
properly and is not worth it for this. Revisit only if it actually happens.

### 4.4 Second tranche: lineage

Not required by either use case, listed because it is the other thing labels
unlock and it would reuse the same provisioning path:

| name | label / inverse | means |
|---|---|---|
| `cb_derived_from` | **Source for** / **Derived from** | the talk that became a blog post that became a video |
| `cb_supersedes` | **Supersedes** / **Superseded by** | the 2026-03 guide replacing the v3 one |
| `cb_promotes` | **Promotes** / **Promoted by** | a social post and the piece it points at |

All three are asymmetric, which is exactly why a property cannot express them
without duplicating and desyncing state on both records.

---

## 5. The ownership problem

**The constraint:** the sync is assignee-first. With `assigneeFilter: 'mine'`,
only issues assigned to the configured user reach HubSpot. A monthly changelog
rollup may well be owned by someone else — in which case the rollup's Linear
issue never syncs, the container record never exists, and there is nothing for
the entries to be *Included in*.

This is the part of the feature most likely to fail quietly, so it gets the most
attention.

### 5.1 Primary: a container does not need a Linear issue

**A rollup or a series is an editorial container, not a task.** It should be
creatable directly in HubSpot — or from the Obsidian vault, which already
creates records — without any Linear issue behind it.

This removes the dependency entirely rather than working around it. It is also
less code than any filtering change.

**To verify before building:** `linear_id` is a *unique* property on
`content_piece` (see `src/scripts/patch-unique-property.ts`). HubSpot is
understood to enforce uniqueness only among records that have a value, leaving
records with no value legal — but that is **unverified against the portal** and
must be confirmed, because a container created without a `linear_id` depends on
it. If it turns out empty values collide, the fallback is a synthetic id
(`container:2026-09`) that cannot match a real Linear id.

### 5.2 Escape hatch: an explicit include label

For the broader case — any issue you care about but do not own — a Linear label
`hs-include` forces a sync regardless of the assignee filter.

**This must not reopen the hole that put 34 unwanted records on production.**
It is safe only because it is:

- **per-issue and explicit** — someone has to put the label on, so nothing is
  swept in by a filter that fails open;
- **evaluated after `isConfigured`** — an unconfigured portal still syncs
  nothing, which is the invariant that gate exists to hold;
- **additive only** — it can include an issue the assignee filter would have
  excluded; it can never exclude one, and it must not bypass the `ignore`
  project kind.

In `LinearWebhook.ts` this sits with the assignee filter, not before the
configuration gate.

### 5.3 Rejected: syncing issues you subscribe to

Linear subscriptions are noisy and change without intent. It would quietly widen
the sync, which is the failure mode this codebase has already paid for once.

---

## 6. What changes

| file | change |
|---|---|
| `src/app/lib/related-content-associations.ts` | `SELF_ASSOCIATION_LABELS` becomes keyed by relationship kind, not just object type; add the new `AssociationLabelSpec`s |
| `src/scripts/association-definitions.ts` | new pairings for each label; each generated name checked against `collidesWithUnlabeledName` |
| `src/scripts/provision-associations.ts` | provision the new labels; idempotent as now |
| `src/app/functions/AssociateRelatedContent.ts` | new workflow-action input selecting the relationship kind; resolve its typeId rather than the single hardcoded one |
| `src/app/functions/LinearWebhook.ts` | §5.2 include label, placed with the assignee filter |
| `src/scripts/provision-objects.ts` | `container_kind` and `container_position` properties |
| `src/app/functions/RelatedContentApi.ts` + card | group related records by label instead of one flat list |
| `src/app/__tests__/` | per `CLAUDE.md`: each of the above ships with a test, written failing first |

Contained — one map, one input field, two properties. Not a redesign.

---

## 7. To verify before building

1. **Empty `linear_id` on a unique property** — §5.1. Blocks the primary
   approach if it fails.
2. **Whether association labels are usable in list filters and reporting.** The
   API docs do not say. If a view like "everything in the September rollup" has
   to be built from labels and labels do not filter, that view costs more than
   expected. Properties are definitely filterable; labels are not confirmed.
3. **Portal subscription tier** — labels need Professional or Enterprise. Both
   portals are presumed to qualify; not checked.

---

## 8. Out of scope

- Any junction object for many-to-many with per-pair data (§4.3).
- Automatic rollup membership. Which entries belong in a month's rollup is an
  editorial decision; this spec gives it somewhere to live, not a rule that
  decides it.
- Changes to `content_type` or `topic_tags`.
