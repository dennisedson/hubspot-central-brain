/**
 * Changelog digests — the releases in Linear's rollup pipeline — and the doc each links to.
 *
 * The team tracks each digest as a Linear release — "October 2026 Changelog
 * Rollup", "Spring 2027 Spotlight" — in the "Monthly Changelog Rollups"
 * pipeline. Whoever owns a digest attaches its Google Doc to the release as a
 * link, and every entry of mine in that release should carry the link in
 * `changelog_doc_url`, and the release's name in `changelog_rollup`.
 * See docs/superpowers/specs/2026-10-20-rollup-doc-link-design.md.
 *
 * Pure and I/O-free so the webhook and the daily sweep decide through the same
 * rule, and so the rule is tested once, without a portal or a workspace.
 */

/**
 * The Linear release pipeline whose releases are digests: "Monthly Changelog
 * Rollups". It holds the monthly rollups AND the Spotlights ("Spring 2027
 * Spotlight"), and since 2026-10-26 every release in it counts — the operator
 * wanted Spotlight membership on the cards too.
 *
 * Matched by id, which survives a rename. It used to be the name pattern
 * `<Month> <Year> Changelog Rollup`, which is why Spotlight issues showed no
 * release at all.
 */
export const ROLLUP_PIPELINE_ID = 'b597dbf5-1813-447d-ba29-2a13106b9274';

export function isRollupPipeline(pipelineId: string | null | undefined): boolean {
  return pipelineId === ROLLUP_PIPELINE_ID;
}

/**
 * Compared by this id, never by URL string: `…/edit`, `…/edit?tab=t.0` and
 * `…/u/1/d/…` are one document, and a string comparison would see three.
 */
const GOOGLE_DOC = /^https:\/\/docs\.google\.com\/document\/(?:u\/\d+\/)?d\/([A-Za-z0-9_-]+)/;

/** The document id of a Google Docs URL; null for Sheets, Slides and every other link. */
export function googleDocId(url: string | null | undefined): string | null {
  if (!url) return null;
  return GOOGLE_DOC.exec(url.trim())?.[1] ?? null;
}

export type RollupDoc =
  | { kind: 'one'; url: string }
  | { kind: 'none' }
  | { kind: 'ambiguous'; urls: string[] };

/**
 * Exactly one Google Doc, or why not. Two different docs decide nothing:
 * guessing which is the digest would put a plausible wrong link on every entry
 * in the month.
 */
export function pickRollupDoc(urls: string[]): RollupDoc {
  const byId = new Map<string, string>();
  for (const url of urls) {
    const id = googleDocId(url);
    if (id && !byId.has(id)) byId.set(id, url.trim());
  }
  const docs = [...byId.values()];
  if (docs.length === 0) return { kind: 'none' };
  if (docs.length === 1) return { kind: 'one', url: docs[0] };
  return { kind: 'ambiguous', urls: docs };
}

/** A release in the rollup pipeline, as the sweep reads it from Linear. */
export interface RollupRelease {
  id: string;
  name: string;
  pipelineId: string;
  linkUrls: string[];
  issueIds: string[];
}

/** One rollup release an issue is in, with its digest doc resolved. */
export interface IssueRollup {
  name: string;
  doc: RollupDoc;
}

/** The two properties this feature owns on a content_piece. '' means unset. */
export interface RollupFields {
  changelog_doc_url: string;
  changelog_rollup: string;
}

export interface SweepPlan {
  /** Linear issue id → the rollup releases it is in. */
  issueRollups: Map<string, IssueRollup[]>;
  /** The id of every Google Doc linked on any rollup release — ambiguous ones included. */
  rollupDocIds: Set<string>;
}

export function planSweep(releases: RollupRelease[]): SweepPlan {
  const issueRollups = new Map<string, IssueRollup[]>();
  const rollupDocIds = new Set<string>();
  for (const release of releases) {
    if (!isRollupPipeline(release.pipelineId)) continue;
    for (const url of release.linkUrls) {
      const id = googleDocId(url);
      if (id) rollupDocIds.add(id);
    }
    const rollup: IssueRollup = { name: release.name, doc: pickRollupDoc(release.linkUrls) };
    for (const issueId of release.issueIds) {
      issueRollups.set(issueId, [...(issueRollups.get(issueId) ?? []), rollup]);
    }
  }
  return { issueRollups, rollupDocIds };
}

export interface Decision {
  /** Only the properties whose value changes. Empty when nothing does. */
  changes: Partial<RollupFields>;
  /** Why something was deliberately left alone, for a person to read. */
  skipped?: string;
}

/**
 * What one entry should hold, given the rollup releases its issue is in
 * according to Linear. The spec's §4 table, row for row.
 *
 * Precedence runs one way: a release that HAS a doc overwrites whatever the
 * entry holds. Clearing runs the other: only "a rollup doc" — the doc of ANY
 * rollup release — is ever cleared. That is how a link this feature wrote is
 * told apart from one a person pasted or Create Doc made, without storing where
 * each came from.
 */
export function decideEntry(
  current: RollupFields,
  rollups: IssueRollup[],
  rollupDocIds: ReadonlySet<string>,
): Decision {
  if (rollups.length > 1) {
    return {
      changes: {},
      skipped: `in ${rollups.length} rollup releases (${rollups.map(r => r.name).join(', ')})`,
    };
  }

  const currentDocId = googleDocId(current.changelog_doc_url);
  const holdsRollupDoc = currentDocId !== null && rollupDocIds.has(currentDocId);
  const desired: RollupFields = { ...current };
  let skipped: string | undefined;

  if (rollups.length === 0) {
    desired.changelog_rollup = '';
    if (holdsRollupDoc) desired.changelog_doc_url = '';
  } else {
    const [rollup] = rollups;
    desired.changelog_rollup = rollup.name;
    if (rollup.doc.kind === 'one') {
      // The same document under another URL form is not a change.
      if (googleDocId(rollup.doc.url) !== currentDocId) desired.changelog_doc_url = rollup.doc.url;
    } else if (rollup.doc.kind === 'none') {
      if (holdsRollupDoc) desired.changelog_doc_url = '';
    } else {
      skipped = `${rollup.name} links ${rollup.doc.urls.length} Google Docs`;
    }
  }

  const changes: Partial<RollupFields> = {};
  if (desired.changelog_doc_url !== current.changelog_doc_url) changes.changelog_doc_url = desired.changelog_doc_url;
  if (desired.changelog_rollup !== current.changelog_rollup) changes.changelog_rollup = desired.changelog_rollup;
  return skipped ? { changes, skipped } : { changes };
}

/**
 * The webhook's write. Set-only, which is why it needs no read of the entry:
 * clearing a stale link needs the entry's current value and every rollup's doc,
 * and that is the daily sweep's job.
 */
export function webhookChanges(rollup: IssueRollup): Partial<RollupFields> {
  return rollup.doc.kind === 'one'
    ? { changelog_rollup: rollup.name, changelog_doc_url: rollup.doc.url }
    : { changelog_rollup: rollup.name };
}
