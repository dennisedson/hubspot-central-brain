# Rollup Doc Links Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Put each monthly changelog rollup's Google Doc — linked on its Linear release — onto every `content_piece` entry whose issue is in that release, and clear it when it no longer applies.

**Architecture:** One pure module holds the whole rule (`rollup-doc.ts`). The Linear webhook applies it set-only, after its stage write, using the release list already in the payload plus one query for the release's links. A daily workflow action (`RollupDocSync`) reads every monthly rollup with strict pagination and sets and clears to match. Neither path can create a record.

**Tech Stack:** TypeScript, HubSpot Projects app functions and custom workflow actions, Linear GraphQL, Vitest.

**Spec:** [`docs/superpowers/specs/2026-10-20-rollup-doc-link-design.md`](../specs/2026-10-20-rollup-doc-link-design.md)

## Global Constraints

- Branch `feat/rollup-doc-link`, off `develop`; PR back into `develop`.
- Every behaviour change ships with a test written first and watched failing. Mock by intent (route on URL / GraphQL query text), never call order. Mock what the API actually returns.
- Monthly rollup = name matching `^(January|…|December) \d{4} Changelog Rollup$`. Spotlights never count.
- Doc links compared by Google Doc id, never by URL string.
- The release's doc overrides whatever the entry holds. Only a rollup doc is ever cleared.
- Writes touch only `changelog_doc_url` and `changelog_rollup`. Nothing ever creates a `content_piece`.
- The sweep's Linear and HubSpot reads are strict: a failed or truncated page throws, and no write happens.
- The webhook's rollup step can never fail the webhook or the stage sync.
- New workflow action: uid `rollup_doc_sync_v1`, name `Sync Rollup Doc Links` — no word the provisioning matchers claim.
- HubSpot kills a function at 20s; the sweep budgets 16s.
- `npm run validate` exits 0 before the PR.

---

## File structure

| file | responsibility |
|---|---|
| `src/app/lib/rollup-doc.ts` (new) | pure rule: names, doc ids, picking a doc, planning the sweep, deciding one entry, the webhook's write |
| `src/app/lib/linear-client.ts` | `fetchEveryPage` (strict paginator), `getReleaseLinkUrls`, `listMonthlyRollups` |
| `src/app/lib/hs-api.ts` | `objectBatchUpdatePath` |
| `src/app/lib/hubspot-client.ts` | `updateByLinearId` (never creates), `searchAll` (strict), `batchUpdate` (≤100, 207-aware) |
| `src/app/lib/types.ts` | `LinearIssue.releases` |
| `src/app/functions/LinearWebhook.ts` | `applyRollup`, called after both stage writes |
| `src/app/functions/linear-webhook-hsmeta.json` | `LINEAR_API_KEY` |
| `src/app/functions/RollupDocSync.ts` (new) | the daily sweep |
| `src/app/functions/rollup-doc-sync-hsmeta.json` (new) | function definition |
| `src/app/workflow-actions/rollup-doc-sync-hsmeta.json` (new) | workflow action definition |
| `src/scripts/provision-changelog-drafting.ts` | `changelog_rollup` property |
| `src/scripts/provision-workflows.ts` | discovers the action; creates "Changelog Rollup Docs (Daily)" |
| `src/scripts/preflight.ts` | `changelog_rollup` required |
| tests | `rollup-doc.test.ts`, `linear-rollups.test.ts`, `hubspot-client-rollup.test.ts` (new); `hs-api`, `linear-webhook`, `rollup-doc-sync` (new), `workflow-actions`, `function-endpoints-are-justified` |
| docs | `ARCHITECTURE.md`, `OPERATOR-GUIDE.md` §4b, `PROJECT-CONTEXT.md` §3.2, `CHANGELOG.md`, episode guide 59 |

---

### Task 1: The rule — `rollup-doc.ts`

**Files:**
- Create: `src/app/lib/rollup-doc.ts`
- Test: `src/app/__tests__/rollup-doc.test.ts`

**Interfaces:**
- Produces: `isMonthlyRollup(name: string): boolean`; `ROLLUP_NAME_SUFFIX = 'Changelog Rollup'`; `googleDocId(url: string | null | undefined): string | null`; `type RollupDoc = {kind:'one';url} | {kind:'none'} | {kind:'ambiguous';urls}`; `pickRollupDoc(urls: string[]): RollupDoc`; `interface RollupRelease { id; name; linkUrls: string[]; issueIds: string[] }`; `interface IssueRollup { name; doc: RollupDoc }`; `interface RollupFields { changelog_doc_url: string; changelog_rollup: string }`; `planSweep(releases: RollupRelease[]): { issueRollups: Map<string, IssueRollup[]>; rollupDocIds: Set<string> }`; `decideEntry(current: RollupFields, rollups: IssueRollup[], rollupDocIds: ReadonlySet<string>): { changes: Partial<RollupFields>; skipped?: string }`; `webhookChanges(rollup: IssueRollup): Partial<RollupFields>`

- [ ] **Step 1: Write the failing test** — `src/app/__tests__/rollup-doc.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  isMonthlyRollup,
  googleDocId,
  pickRollupDoc,
  planSweep,
  decideEntry,
  webhookChanges,
  type IssueRollup,
  type RollupFields,
} from '@lib/rollup-doc';

const OCT_DOC = 'https://docs.google.com/document/d/1OctoberDocId_abc/edit';
const NOV_DOC = 'https://docs.google.com/document/d/1NovemberDocId_xyz/edit';
const OWN_DOC = 'https://docs.google.com/document/d/1MyOwnStandaloneDoc/edit';

const OCT: IssueRollup = { name: 'October 2026 Changelog Rollup', doc: { kind: 'one', url: OCT_DOC } };
const NOV_NO_DOC: IssueRollup = { name: 'November 2026 Changelog Rollup', doc: { kind: 'none' } };
const ROLLUP_DOCS = new Set([googleDocId(OCT_DOC)!, googleDocId(NOV_DOC)!]);
const EMPTY: RollupFields = { changelog_doc_url: '', changelog_rollup: '' };

describe('isMonthlyRollup', () => {
  it.each([
    'October 2026 Changelog Rollup',
    'January 2027 Changelog Rollup',
    '  August 2027 Changelog Rollup ',
  ])('accepts %s', name => expect(isMonthlyRollup(name)).toBe(true));

  it.each([
    'Spring 2027 Spotlight', // same Linear pipeline, not a changelog digest
    'Fall 2027 Spotlight',
    'October 2026 Changelog Rollup (draft)',
    'Holiday Changelog Rollup',
    'Octember 2026 Changelog Rollup',
    'october 2026 changelog rollup',
  ])('rejects %s', name => expect(isMonthlyRollup(name)).toBe(false));
});

describe('googleDocId', () => {
  it('reads the id from the URL forms Google hands out', () => {
    expect(googleDocId('https://docs.google.com/document/d/abc-123_X/edit')).toBe('abc-123_X');
    expect(googleDocId('https://docs.google.com/document/d/abc-123_X/edit?tab=t.0')).toBe('abc-123_X');
    expect(googleDocId('https://docs.google.com/document/u/1/d/abc-123_X/view')).toBe('abc-123_X');
  });

  it('is null for anything that is not a Google Doc', () => {
    expect(googleDocId('https://docs.google.com/spreadsheets/d/abc/edit')).toBeNull();
    expect(googleDocId('https://linear.app/hubspot/issue/DEVADV-1')).toBeNull();
    expect(googleDocId('')).toBeNull();
    expect(googleDocId(null)).toBeNull();
  });
});

describe('pickRollupDoc', () => {
  it('picks the one Google Doc among other links', () => {
    expect(pickRollupDoc(['https://example.com/brief', OCT_DOC, 'https://docs.google.com/spreadsheets/d/s/edit']))
      .toEqual({ kind: 'one', url: OCT_DOC });
  });

  it('treats one doc linked twice, in two URL forms, as one', () => {
    expect(pickRollupDoc([OCT_DOC, OCT_DOC.replace('/edit', '/edit?tab=t.0')])).toEqual({ kind: 'one', url: OCT_DOC });
  });

  it('is none when no link is a Google Doc', () => {
    expect(pickRollupDoc([])).toEqual({ kind: 'none' });
    expect(pickRollupDoc(['https://example.com'])).toEqual({ kind: 'none' });
  });

  it('refuses to choose between two different docs', () => {
    expect(pickRollupDoc([OCT_DOC, NOV_DOC])).toEqual({ kind: 'ambiguous', urls: [OCT_DOC, NOV_DOC] });
  });
});

describe('planSweep', () => {
  it('maps each issue to its monthly rollups and collects every rollup doc', () => {
    const plan = planSweep([
      { id: 'r-oct', name: 'October 2026 Changelog Rollup', linkUrls: [OCT_DOC], issueIds: ['i-1', 'i-2'] },
      { id: 'r-nov', name: 'November 2026 Changelog Rollup', linkUrls: [], issueIds: ['i-3'] },
    ]);
    expect(plan.issueRollups.get('i-1')).toEqual([OCT]);
    expect(plan.issueRollups.get('i-3')).toEqual([NOV_NO_DOC]);
    expect([...plan.rollupDocIds]).toEqual([googleDocId(OCT_DOC)]);
  });

  it('gives an issue in two releases both of them', () => {
    const plan = planSweep([
      { id: 'r-oct', name: 'October 2026 Changelog Rollup', linkUrls: [OCT_DOC], issueIds: ['i-1'] },
      { id: 'r-nov', name: 'November 2026 Changelog Rollup', linkUrls: [], issueIds: ['i-1'] },
    ]);
    expect(plan.issueRollups.get('i-1')).toEqual([OCT, NOV_NO_DOC]);
  });

  it('ignores releases that are not monthly rollups', () => {
    const plan = planSweep([{ id: 'r-spot', name: 'Spring 2027 Spotlight', linkUrls: [OWN_DOC], issueIds: ['i-1'] }]);
    expect(plan.issueRollups.size).toBe(0);
    expect(plan.rollupDocIds.size).toBe(0);
  });

  it('counts the docs of an ambiguous release as rollup docs', () => {
    // So a link written before the second doc appeared can still be recognised,
    // and cleared, later.
    const plan = planSweep([
      { id: 'r-oct', name: 'October 2026 Changelog Rollup', linkUrls: [OCT_DOC, NOV_DOC], issueIds: [] },
    ]);
    expect(plan.rollupDocIds).toEqual(new Set([googleDocId(OCT_DOC), googleDocId(NOV_DOC)]));
  });
});

describe('decideEntry', () => {
  // The control: the ordinary case, correct before this feature existed.
  it('leaves an entry with its own doc alone when its issue is in no rollup', () => {
    expect(decideEntry({ changelog_doc_url: OWN_DOC, changelog_rollup: '' }, [], ROLLUP_DOCS)).toEqual({ changes: {} });
  });

  it('sets the release doc and name on an entry that has neither', () => {
    expect(decideEntry(EMPTY, [OCT], ROLLUP_DOCS)).toEqual({
      changes: { changelog_doc_url: OCT_DOC, changelog_rollup: 'October 2026 Changelog Rollup' },
    });
  });

  it('overrides a doc the entry already had — the release takes precedence', () => {
    expect(decideEntry({ changelog_doc_url: OWN_DOC, changelog_rollup: '' }, [OCT], ROLLUP_DOCS).changes).toEqual({
      changelog_doc_url: OCT_DOC,
      changelog_rollup: 'October 2026 Changelog Rollup',
    });
  });

  it('writes nothing when the entry holds the same doc under another URL form', () => {
    const current = { changelog_doc_url: `${OCT_DOC}?tab=t.0`, changelog_rollup: 'October 2026 Changelog Rollup' };
    expect(decideEntry(current, [OCT], ROLLUP_DOCS)).toEqual({ changes: {} });
  });

  it("clears October's doc when the issue moves to a November release with no doc yet", () => {
    const current = { changelog_doc_url: OCT_DOC, changelog_rollup: 'October 2026 Changelog Rollup' };
    expect(decideEntry(current, [NOV_NO_DOC], ROLLUP_DOCS).changes).toEqual({
      changelog_doc_url: '',
      changelog_rollup: 'November 2026 Changelog Rollup',
    });
  });

  it('keeps a hand-pasted doc when the release has none', () => {
    expect(decideEntry({ changelog_doc_url: OWN_DOC, changelog_rollup: '' }, [NOV_NO_DOC], ROLLUP_DOCS).changes)
      .toEqual({ changelog_rollup: 'November 2026 Changelog Rollup' });
  });

  it('clears a rollup doc and the name when the issue leaves every rollup', () => {
    const current = { changelog_doc_url: OCT_DOC, changelog_rollup: 'October 2026 Changelog Rollup' };
    expect(decideEntry(current, [], ROLLUP_DOCS).changes).toEqual({ changelog_doc_url: '', changelog_rollup: '' });
  });

  it('leaves the doc and reports, but still names the release, when it links two docs', () => {
    const twoDocs: IssueRollup = {
      name: 'October 2026 Changelog Rollup',
      doc: { kind: 'ambiguous', urls: [OCT_DOC, NOV_DOC] },
    };
    const decision = decideEntry({ changelog_doc_url: OWN_DOC, changelog_rollup: '' }, [twoDocs], ROLLUP_DOCS);
    expect(decision.changes).toEqual({ changelog_rollup: 'October 2026 Changelog Rollup' });
    expect(decision.skipped).toMatch(/2 Google Docs/);
  });

  it('changes nothing, and says why, for an issue in two monthly rollups', () => {
    const decision = decideEntry(EMPTY, [OCT, NOV_NO_DOC], ROLLUP_DOCS);
    expect(decision.changes).toEqual({});
    expect(decision.skipped).toMatch(/in 2 monthly rollups/);
  });
});

describe('webhookChanges', () => {
  it('writes the name and the doc when the release has one', () => {
    expect(webhookChanges(OCT)).toEqual({ changelog_rollup: 'October 2026 Changelog Rollup', changelog_doc_url: OCT_DOC });
  });

  it('writes only the name otherwise — the webhook never clears', () => {
    expect(webhookChanges(NOV_NO_DOC)).toEqual({ changelog_rollup: 'November 2026 Changelog Rollup' });
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run src/app/__tests__/rollup-doc.test.ts`
Expected: FAIL — `Failed to resolve import "@lib/rollup-doc"`.

- [ ] **Step 3: Implement** — `src/app/lib/rollup-doc.ts`:

```ts
/**
 * Monthly changelog rollups, and the digest doc each one links to.
 *
 * The team tracks each monthly digest as a Linear release — "October 2026
 * Changelog Rollup" — in the "Monthly Changelog Rollups" pipeline. Whoever owns
 * a digest attaches its Google Doc to the release as a link, and every entry of
 * mine in that release should carry the link in `changelog_doc_url`.
 * See docs/superpowers/specs/2026-10-20-rollup-doc-link-design.md.
 *
 * Pure and I/O-free so the webhook and the daily sweep decide through the same
 * rule, and so the rule is tested once, without a portal or a workspace.
 */

/**
 * Recognised by NAME, not by pipeline: the same pipeline holds Spotlight
 * releases ("Spring 2027 Spotlight", 24 issues) that are not changelog digests.
 * Anchored at both ends, so "October 2026 Changelog Rollup (draft)" is not one.
 */
const MONTHLY_ROLLUP =
  /^(January|February|March|April|May|June|July|August|September|October|November|December) \d{4} Changelog Rollup$/;

/** What Linear is asked to filter on. The full pattern is still checked here. */
export const ROLLUP_NAME_SUFFIX = 'Changelog Rollup';

export function isMonthlyRollup(name: string): boolean {
  return MONTHLY_ROLLUP.test(name.trim());
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

/** A monthly rollup release as the sweep reads it from Linear. */
export interface RollupRelease {
  id: string;
  name: string;
  linkUrls: string[];
  issueIds: string[];
}

/** One monthly rollup an issue is in, with its digest doc resolved. */
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
  /** Linear issue id → the monthly rollups it is in. */
  issueRollups: Map<string, IssueRollup[]>;
  /** The id of every Google Doc linked on any monthly rollup — ambiguous ones included. */
  rollupDocIds: Set<string>;
}

export function planSweep(releases: RollupRelease[]): SweepPlan {
  const issueRollups = new Map<string, IssueRollup[]>();
  const rollupDocIds = new Set<string>();
  for (const release of releases) {
    if (!isMonthlyRollup(release.name)) continue;
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
 * What one entry should hold, given the monthly rollups its issue is in
 * according to Linear. The spec's §4 table, row for row.
 *
 * Precedence runs one way: a release that HAS a doc overwrites whatever the
 * entry holds. Clearing runs the other: only "a rollup doc" — the doc of ANY
 * monthly rollup — is ever cleared. That is how a link this feature wrote is
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
      skipped: `in ${rollups.length} monthly rollups (${rollups.map(r => r.name).join(', ')})`,
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
```

- [ ] **Step 4: Run it and watch it pass** — `npx vitest run src/app/__tests__/rollup-doc.test.ts` → all PASS.

- [ ] **Step 5: Commit** — `git add src/app/lib/rollup-doc.ts src/app/__tests__/rollup-doc.test.ts && git commit -m "feat(rollup): the rule for a monthly rollup's digest doc"`

---

### Task 2: Reading rollups from Linear

**Files:**
- Modify: `src/app/lib/linear-client.ts` (append)
- Test: `src/app/__tests__/linear-rollups.test.ts` (new file — the existing `linear-client.test.ts` queues responses in call order, and a routed `mockImplementation` would leak into it)

**Interfaces:**
- Consumes: `isMonthlyRollup`, `ROLLUP_NAME_SUFFIX`, `RollupRelease` (Task 1)
- Produces: `fetchEveryPage<D, T>(apiKey, query, variables, select: (data: D) => Connection<T> | null | undefined, pageSize?): Promise<T[]>`; `getReleaseLinkUrls(apiKey: string, releaseId: string): Promise<string[]>`; `listMonthlyRollups(apiKey: string): Promise<RollupRelease[]>`

- [ ] **Step 0: Confirm the real query shapes against Linear (read-only)** — run both queries below with `LINEAR_API_KEY` from `.env` and confirm: the `endsWith` filter is accepted, the nested query is under Linear's complexity limit, and an unknown release id comes back as a GraphQL error (or a null node). Mock accordingly.

- [ ] **Step 1: Write the failing test** — `src/app/__tests__/linear-rollups.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fetchEveryPage, getReleaseLinkUrls, listMonthlyRollups } from '@lib/linear-client';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

type Gql = { query: string; variables: Record<string, unknown> };
const ok = (data: unknown) => ({ ok: true, status: 200, statusText: 'OK', json: async () => ({ data }) });
const httpError = { ok: false, status: 500, statusText: 'Server Error', json: async () => ({}) };

/** Route every Linear call on what it asks for, never on call order. */
function route(handler: (gql: Gql) => unknown) {
  mockFetch.mockImplementation(async (_url: string, init: { body: string }) => handler(JSON.parse(init.body) as Gql));
}

const OCT_DOC = 'https://docs.google.com/document/d/1OctDoc/edit';

function release(id: string, name: string, links: string[], issues: string[], moreIssues = false) {
  return {
    id,
    name,
    links: { nodes: links.map(url => ({ url })), pageInfo: { hasNextPage: false } },
    issues: {
      nodes: issues.map(i => ({ id: i })),
      pageInfo: { hasNextPage: moreIssues, endCursor: moreIssues ? 'first-page-end' : null },
    },
  };
}

beforeEach(() => mockFetch.mockReset());

describe('fetchEveryPage', () => {
  const QUERY = 'query($first: Int!, $after: String) { things(first: $first, after: $after) { nodes { id } pageInfo { hasNextPage endCursor } } }';
  const select = (d: { things: { nodes: { id: string }[]; pageInfo: { hasNextPage: boolean; endCursor: string | null } } }) => d.things;

  it('follows the cursor to the last page', async () => {
    route(({ variables }) =>
      variables.after === null
        ? ok({ things: { nodes: [{ id: 'a' }], pageInfo: { hasNextPage: true, endCursor: 'c1' } } })
        : ok({ things: { nodes: [{ id: 'b' }], pageInfo: { hasNextPage: false, endCursor: null } } }),
    );
    expect(await fetchEveryPage('k', QUERY, {}, select)).toEqual([{ id: 'a' }, { id: 'b' }]);
  });

  it('throws rather than return the first page when a later one fails', async () => {
    route(({ variables }) =>
      variables.after === null
        ? ok({ things: { nodes: [{ id: 'a' }], pageInfo: { hasNextPage: true, endCursor: 'c1' } } })
        : httpError,
    );
    await expect(fetchEveryPage('k', QUERY, {}, select)).rejects.toThrow(/500/);
  });

  it('throws when Linear reports another page without a cursor', async () => {
    route(() => ok({ things: { nodes: [{ id: 'a' }], pageInfo: { hasNextPage: true, endCursor: null } } }));
    await expect(fetchEveryPage('k', QUERY, {}, select)).rejects.toThrow(/cursor/);
  });

  it('throws when the pages never end', async () => {
    let n = 0;
    route(() => ok({ things: { nodes: [{ id: String(n) }], pageInfo: { hasNextPage: true, endCursor: `c${n++}` } } }));
    await expect(fetchEveryPage('k', QUERY, {}, select)).rejects.toThrow(/refusing/);
  });
});

describe('listMonthlyRollups', () => {
  it('returns monthly rollups with their links and issues, and asks Linear to filter by suffix', async () => {
    route(({ query, variables }) => {
      if (query.includes('releases(')) {
        expect(variables.suffix).toBe('Changelog Rollup');
        return ok({
          releases: {
            nodes: [
              release('r-oct', 'October 2026 Changelog Rollup', [OCT_DOC, 'https://example.com'], ['i-1', 'i-2']),
              // Ends with the suffix, so Linear's filter lets it through; the
              // full pattern does not.
              release('r-hol', 'Holiday Changelog Rollup', [], ['i-9']),
            ],
            pageInfo: { hasNextPage: false, endCursor: null },
          },
        });
      }
      throw new Error(`unexpected query: ${query}`);
    });

    expect(await listMonthlyRollups('k')).toEqual([
      { id: 'r-oct', name: 'October 2026 Changelog Rollup', linkUrls: [OCT_DOC, 'https://example.com'], issueIds: ['i-1', 'i-2'] },
    ]);
  });

  it('reads every issue of a release whose issues overflow the first page', async () => {
    route(({ query, variables }) => {
      if (query.includes('releases(')) {
        return ok({
          releases: {
            nodes: [release('r-oct', 'October 2026 Changelog Rollup', [], ['i-1'], true)],
            pageInfo: { hasNextPage: false, endCursor: null },
          },
        });
      }
      if (query.includes('release(id: $id)') && query.includes('issues(')) {
        expect(variables.id).toBe('r-oct');
        return variables.after === null
          ? ok({ release: { issues: { nodes: [{ id: 'i-1' }, { id: 'i-2' }], pageInfo: { hasNextPage: true, endCursor: 'p2' } } } })
          : ok({ release: { issues: { nodes: [{ id: 'i-3' }], pageInfo: { hasNextPage: false, endCursor: null } } } });
      }
      throw new Error(`unexpected query: ${query}`);
    });

    const [oct] = await listMonthlyRollups('k');
    expect(oct.issueIds).toEqual(['i-1', 'i-2', 'i-3']);
  });

  it('refuses to pick a doc from part of a release\'s links', async () => {
    route(() =>
      ok({
        releases: {
          nodes: [{
            ...release('r-oct', 'October 2026 Changelog Rollup', [OCT_DOC], []),
            links: { nodes: [{ url: OCT_DOC }], pageInfo: { hasNextPage: true } },
          }],
          pageInfo: { hasNextPage: false, endCursor: null },
        },
      }),
    );
    await expect(listMonthlyRollups('k')).rejects.toThrow(/links/);
  });
});

describe('getReleaseLinkUrls', () => {
  it('returns the URLs linked on the release', async () => {
    route(({ query, variables }) => {
      expect(query).toContain('links(');
      expect(variables.id).toBe('r-oct');
      return ok({ release: { name: 'October 2026 Changelog Rollup', links: { nodes: [{ url: OCT_DOC }], pageInfo: { hasNextPage: false } } } });
    });
    expect(await getReleaseLinkUrls('k', 'r-oct')).toEqual([OCT_DOC]);
  });

  it('throws on a null release rather than reporting no links', async () => {
    route(() => ok({ release: null }));
    await expect(getReleaseLinkUrls('k', 'nope')).rejects.toThrow(/not found/);
  });

  it('throws on a GraphQL error', async () => {
    route(() => ({ ok: true, status: 200, json: async () => ({ errors: [{ message: 'Entity not found: Release' }] }) }));
    await expect(getReleaseLinkUrls('k', 'nope')).rejects.toThrow(/Entity not found/);
  });
});
```

- [ ] **Step 2: Run it and watch it fail** — `npx vitest run src/app/__tests__/linear-rollups.test.ts` → FAIL, `fetchEveryPage is not a function`.

- [ ] **Step 3: Implement** — append to `src/app/lib/linear-client.ts` (and add the import at the top):

```ts
import { isMonthlyRollup, ROLLUP_NAME_SUFFIX, type RollupRelease } from './rollup-doc';
```

```ts
export interface Connection<T> {
  nodes: T[];
  pageInfo: { hasNextPage: boolean; endCursor?: string | null };
}

/** Linear caps a page at 250. */
const MAX_PAGE_SIZE = 250;
/** 40 pages of 250 is 10,000 nodes — far past anything this app reads. */
const MAX_PAGES = 40;

/**
 * Every node of one connection — or an error. Never part of it.
 *
 * Deliberately not AppSettingsApi's fetchAllPages, which returns what it has
 * when a later page fails. That is right for a settings dropdown and wrong for
 * the rollup sweep: there, an issue missing from a partial list reads as "not
 * in a rollup", and the sweep would clear a real link. So a failed page, a
 * missing cursor and running out of pages all throw.
 *
 * `first` and `after` are this function's variables; the query must declare
 * them and `variables` must not set them.
 */
export async function fetchEveryPage<D, T>(
  apiKey: string,
  query: string,
  variables: Record<string, unknown>,
  select: (data: D) => Connection<T> | null | undefined,
  pageSize = MAX_PAGE_SIZE,
): Promise<T[]> {
  const nodes: T[] = [];
  let after: string | null = null;
  for (let page = 0; page < MAX_PAGES; page++) {
    const data = await gql<D>(apiKey, query, { ...variables, first: pageSize, after });
    const conn = select(data);
    if (!conn) throw new Error('Linear returned no connection to page through');
    nodes.push(...conn.nodes);
    if (!conn.pageInfo.hasNextPage) return nodes;
    if (!conn.pageInfo.endCursor) throw new Error('Linear reported another page without a cursor');
    after = conn.pageInfo.endCursor;
  }
  throw new Error(`Linear connection ran past ${MAX_PAGES} pages; refusing to return part of it`);
}

/** A digest has a handful of links. A full page of them is not something to pick from. */
const LINKS_PAGE = 50;
/** Releases and their first page of issues travel together; kept small for Linear's complexity limit. */
const RELEASES_PAGE = 50;
const ISSUES_PAGE = 50;

interface LinkConnection {
  nodes: Array<{ url: string }>;
  pageInfo: { hasNextPage: boolean };
}

function linkUrls(links: LinkConnection, releaseName: string): string[] {
  if (links.pageInfo.hasNextPage) {
    throw new Error(`Release "${releaseName}" has more than ${LINKS_PAGE} links; refusing to pick a doc from part of them`);
  }
  return links.nodes.map(n => n.url);
}

/** The URLs linked on one release. The webhook knows the id from its payload. */
export async function getReleaseLinkUrls(apiKey: string, releaseId: string): Promise<string[]> {
  const data = await gql<{ release: { name: string; links: LinkConnection } | null }>(
    apiKey,
    `query($id: String!) {
       release(id: $id) { name links(first: ${LINKS_PAGE}) { nodes { url } pageInfo { hasNextPage } } }
     }`,
    { id: releaseId },
  );
  // Linear can answer an unknown id with a null node rather than an error.
  if (!data.release) throw new Error(`Linear release not found: ${releaseId}`);
  return linkUrls(data.release.links, data.release.name);
}

interface ReleaseNode {
  id: string;
  name: string;
  links: LinkConnection;
  issues: Connection<{ id: string }>;
}

const ROLLUP_RELEASES = `
  query($first: Int!, $after: String, $suffix: String!) {
    releases(first: $first, after: $after, filter: { name: { endsWith: $suffix } }) {
      nodes {
        id
        name
        links(first: ${LINKS_PAGE}) { nodes { url } pageInfo { hasNextPage } }
        issues(first: ${ISSUES_PAGE}) { nodes { id } pageInfo { hasNextPage endCursor } }
      }
      pageInfo { hasNextPage endCursor }
    }
  }`;

const RELEASE_ISSUES = `
  query($id: String!, $first: Int!, $after: String) {
    release(id: $id) {
      issues(first: $first, after: $after) { nodes { id } pageInfo { hasNextPage endCursor } }
    }
  }`;

/**
 * Every monthly rollup release, with its links and ALL of its issue ids.
 *
 * One request in the ordinary case: each release's first page of issues rides
 * along with it. A release with more issues than that is re-read to the end.
 */
export async function listMonthlyRollups(apiKey: string): Promise<RollupRelease[]> {
  const releases = await fetchEveryPage<{ releases: Connection<ReleaseNode> }, ReleaseNode>(
    apiKey,
    ROLLUP_RELEASES,
    { suffix: ROLLUP_NAME_SUFFIX },
    d => d.releases,
    RELEASES_PAGE,
  );

  const rollups: RollupRelease[] = [];
  for (const r of releases.filter(r => isMonthlyRollup(r.name))) {
    const issues = r.issues.pageInfo.hasNextPage
      ? await fetchEveryPage<{ release: { issues: Connection<{ id: string }> } | null }, { id: string }>(
          apiKey,
          RELEASE_ISSUES,
          { id: r.id },
          d => d.release?.issues,
        )
      : r.issues.nodes;
    rollups.push({ id: r.id, name: r.name, linkUrls: linkUrls(r.links, r.name), issueIds: issues.map(i => i.id) });
  }
  return rollups;
}
```

- [ ] **Step 4: Run it and watch it pass** — `npx vitest run src/app/__tests__/linear-rollups.test.ts src/app/__tests__/linear-client.test.ts` → PASS (the second file is the control).

- [ ] **Step 5: Commit** — `git commit -m "feat(linear): read monthly rollup releases with strict pagination"`

---

### Task 3: HubSpot writes that never create, and strict reads

**Files:**
- Modify: `src/app/lib/hs-api.ts` (after `objectBatchReadPath`), `src/app/lib/hubspot-client.ts` (after `hsUpdate`)
- Test: `src/app/__tests__/hs-api.test.ts`, `src/app/__tests__/hubspot-client-rollup.test.ts` (new)

**Interfaces:**
- Produces: `objectBatchUpdatePath(objectType: string): string`; `updateByLinearId(objectTypeId, linearId, properties): Promise<boolean>`; `interface SearchFilter { propertyName; operator: 'EQ' | 'IN' | 'HAS_PROPERTY'; value?; values? }`; `interface HsRow { id: string; properties: Record<string, string | null> }`; `searchAll(objectTypeId, filterGroups: SearchFilter[][], properties: string[]): Promise<HsRow[]>`; `BATCH_UPDATE_LIMIT = 100`; `batchUpdate(objectTypeId, inputs: Array<{ id: string; properties: Record<string, string> }>): Promise<void>`

- [ ] **Step 1: Write the failing tests**

In `hs-api.test.ts`, add `objectBatchUpdatePath` to the import and:

```ts
describe('objectBatchUpdatePath', () => {
  it('builds the batch update path for an object type', () => {
    expect(objectBatchUpdatePath('2-67505887')).toBe('/crm/objects/2026-03/2-67505887/batch/update');
  });
});
```

`src/app/__tests__/hubspot-client-rollup.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { updateByLinearId, searchAll, batchUpdate } from '@lib/hubspot-client';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

const BASE = 'https://api.hubapi.com/crm/objects/2026-03/2-content';
const reply = (status: number, body: unknown = {}) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
  text: async () => JSON.stringify(body),
});

beforeEach(() => {
  mockFetch.mockReset();
  process.env.HS_ACCESS_TOKEN = 'tok';
});

describe('updateByLinearId', () => {
  it('PATCHes the record by linear_id', async () => {
    mockFetch.mockResolvedValue(reply(200, { id: '101' }));
    expect(await updateByLinearId('2-content', 'iss-1', { changelog_rollup: 'October 2026 Changelog Rollup' })).toBe(true);
    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toBe(`${BASE}/iss-1?idProperty=linear_id`);
    expect(init.method).toBe('PATCH');
    expect(JSON.parse(init.body)).toEqual({ properties: { changelog_rollup: 'October 2026 Changelog Rollup' } });
  });

  it('answers false on 404 and never falls back to creating a record', async () => {
    mockFetch.mockResolvedValue(reply(404, { message: 'not found' }));
    expect(await updateByLinearId('2-content', 'iss-1', { changelog_rollup: 'x' })).toBe(false);
    expect(mockFetch).toHaveBeenCalledOnce();
  });

  it('throws on any other failure', async () => {
    mockFetch.mockResolvedValue(reply(400, { message: 'Property "changelog_rollup" does not exist' }));
    await expect(updateByLinearId('2-content', 'iss-1', { changelog_rollup: 'x' })).rejects.toThrow(/400/);
  });
});

describe('searchAll', () => {
  it('pages to the end and ORs the filter groups', async () => {
    mockFetch.mockImplementation(async (_url: string, init: { body: string }) => {
      const body = JSON.parse(init.body);
      expect(body.filterGroups).toEqual([
        { filters: [{ propertyName: 'changelog_doc_url', operator: 'HAS_PROPERTY' }] },
        { filters: [{ propertyName: 'changelog_rollup', operator: 'HAS_PROPERTY' }] },
      ]);
      return body.after === 'page-2'
        ? reply(200, { results: [{ id: '2', properties: {} }] })
        : reply(200, { results: [{ id: '1', properties: {} }], paging: { next: { after: 'page-2' } } });
    });
    const rows = await searchAll(
      '2-content',
      [
        [{ propertyName: 'changelog_doc_url', operator: 'HAS_PROPERTY' }],
        [{ propertyName: 'changelog_rollup', operator: 'HAS_PROPERTY' }],
      ],
      ['linear_id'],
    );
    expect(rows.map(r => r.id)).toEqual(['1', '2']);
    expect(mockFetch.mock.calls[0][0]).toBe(`${BASE}/search`);
  });

  it('throws rather than return the first page when a later one fails', async () => {
    mockFetch.mockImplementation(async (_url: string, init: { body: string }) =>
      JSON.parse(init.body).after
        ? reply(500, { message: 'boom' })
        : reply(200, { results: [{ id: '1', properties: {} }], paging: { next: { after: 'page-2' } } }),
    );
    await expect(searchAll('2-content', [[{ propertyName: 'linear_id', operator: 'IN', values: ['a'] }]], []))
      .rejects.toThrow(/500/);
  });
});

describe('batchUpdate', () => {
  it('POSTs the inputs to batch/update', async () => {
    mockFetch.mockResolvedValue(reply(200, { status: 'COMPLETE', results: [] }));
    await batchUpdate('2-content', [{ id: '101', properties: { changelog_doc_url: '' } }]);
    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toBe(`${BASE}/batch/update`);
    expect(JSON.parse(init.body)).toEqual({ inputs: [{ id: '101', properties: { changelog_doc_url: '' } }] });
  });

  it('treats 207 Multi-Status as the failure it is', async () => {
    mockFetch.mockResolvedValue(reply(207, { status: 'COMPLETE', errors: [{ message: 'Property values were not valid' }] }));
    await expect(batchUpdate('2-content', [{ id: '101', properties: { changelog_rollup: 'x' } }]))
      .rejects.toThrow(/Property values were not valid/);
  });

  it('refuses more than 100 inputs and makes no call for none', async () => {
    const many = Array.from({ length: 101 }, (_, i) => ({ id: String(i), properties: {} }));
    await expect(batchUpdate('2-content', many)).rejects.toThrow(/at most 100/);
    await batchUpdate('2-content', []);
    expect(mockFetch).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run and watch them fail** — `npx vitest run src/app/__tests__/hs-api.test.ts src/app/__tests__/hubspot-client-rollup.test.ts` → FAIL (missing exports).

- [ ] **Step 3: Implement**

`hs-api.ts`, after `objectBatchReadPath`:

```ts
/**
 * Update up to 100 records of one object type in one call (POST).
 * Body: `{ "inputs": [{ "id": "4201", "properties": { … } }] }`.
 *
 * Answers 207 Multi-Status when some inputs fail and others land. 207 is `ok`,
 * so callers must check the status explicitly.
 */
// LEGACY v3 — migrate to dated per issue #14
export function objectBatchUpdatePath(objectType: string): string {
  return `${OBJECTS_V3}/${objectType}/batch/update`;
}
```

`hubspot-client.ts`: add `objectBatchUpdatePath` to the `./hs-api` import, then after `hsUpdate`:

```ts
/**
 * Writes to the record whose `linear_id` matches — and never creates one.
 *
 * hsUpsertByUniqueProperty creates on 404, which is right for the sync, where
 * the issue IS the record, and wrong for anything that only annotates records
 * the sync already made. A 404 here answers false.
 */
export async function updateByLinearId(
  objectTypeId: string,
  linearId: string,
  properties: Record<string, string>,
): Promise<boolean> {
  const token = getToken();
  const res = await fetch(
    `${HS_BASE}${objectPath(objectTypeId, encodeURIComponent(linearId))}?idProperty=linear_id`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ properties }),
    },
  );
  if (res.status === 404) return false;
  if (!res.ok) throw new Error(`HubSpot update by linear_id failed ${res.status}: ${await res.text()}`);
  return true;
}

export interface SearchFilter {
  propertyName: string;
  operator: 'EQ' | 'IN' | 'HAS_PROPERTY';
  value?: string;
  values?: string[];
}

export interface HsRow {
  id: string;
  properties: Record<string, string | null>;
}

const SEARCH_PAGE = 100;
/** 100 pages of 100 is HubSpot's own ceiling of 10,000 on one search. */
const MAX_SEARCH_PAGES = 100;

/**
 * Every record matching ANY of the filter groups, paged to the end.
 *
 * hsSearch asks for one result, which is all a lookup needs. This is for a
 * caller that acts on a record's absence as much as its presence, so it throws
 * rather than hand back part of the set.
 */
export async function searchAll(
  objectTypeId: string,
  filterGroups: SearchFilter[][],
  properties: string[],
): Promise<HsRow[]> {
  const token = getToken();
  const rows: HsRow[] = [];
  let after: string | undefined;
  for (let page = 0; page < MAX_SEARCH_PAGES; page++) {
    const res = await fetch(`${HS_BASE}${objectSearchPath(objectTypeId)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        filterGroups: filterGroups.map(filters => ({ filters })),
        properties,
        limit: SEARCH_PAGE,
        ...(after ? { after } : {}),
      }),
    });
    if (!res.ok) throw new Error(`HubSpot search failed ${res.status}: ${await res.text()}`);
    const body = (await res.json()) as { results?: HsRow[]; paging?: { next?: { after?: string } } };
    rows.push(...(body.results ?? []));
    after = body.paging?.next?.after;
    if (!after) return rows;
  }
  throw new Error(`HubSpot search ran past ${MAX_SEARCH_PAGES} pages; refusing to return part of it`);
}

export const BATCH_UPDATE_LIMIT = 100;

/**
 * Updates up to 100 records in one call.
 *
 * 207 means some inputs failed and others landed. It is `ok`, so it is checked
 * for by name — a partial failure reported as success is the shape of every
 * quiet bug this repo has had.
 */
export async function batchUpdate(
  objectTypeId: string,
  inputs: Array<{ id: string; properties: Record<string, string> }>,
): Promise<void> {
  if (inputs.length === 0) return;
  if (inputs.length > BATCH_UPDATE_LIMIT) {
    throw new Error(`batchUpdate takes at most ${BATCH_UPDATE_LIMIT} inputs, got ${inputs.length}`);
  }
  const token = getToken();
  const res = await fetch(`${HS_BASE}${objectBatchUpdatePath(objectTypeId)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ inputs }),
  });
  if (res.status === 207) {
    const body = (await res.json()) as { errors?: Array<{ message?: string }> };
    const messages = (body.errors ?? []).map(e => e.message ?? 'unknown error').join('; ');
    throw new Error(`HubSpot batch update partly failed: ${messages.slice(0, 300)}`);
  }
  if (!res.ok) throw new Error(`HubSpot batch update failed ${res.status}: ${await res.text()}`);
}
```

- [ ] **Step 4: Run and watch them pass** — same command, plus `src/app/__tests__/hubspot-client.test.ts` as the control.

- [ ] **Step 5: Commit** — `git commit -m "feat(hubspot): update by linear_id without creating, strict search, batch update"`

---

### Task 4: The webhook sets the rollup

**Files:**
- Modify: `src/app/lib/types.ts` (`LinearIssue`), `src/app/functions/LinearWebhook.ts`, `src/app/functions/linear-webhook-hsmeta.json`
- Test: `src/app/__tests__/linear-webhook.test.ts`

**Interfaces:**
- Consumes: `isMonthlyRollup`, `pickRollupDoc`, `webhookChanges`, `RollupDoc` (Task 1); `getReleaseLinkUrls` (Task 2); `updateByLinearId` (Task 3)
- Produces: response bodies gain an optional `rollup` object: `{ release, wrote: string[], skipped?, linkError?, error? }`

- [ ] **Step 1: Write the failing tests** — in `linear-webhook.test.ts`, add `updateByLinearId: vi.fn().mockResolvedValue(true),` to the `@lib/hubspot-client` mock factory, then append:

```ts
describe('LinearWebhook — monthly rollup', () => {
  const OCT_DOC = 'https://docs.google.com/document/d/1OctDoc/edit';
  const linearFetch = vi.fn();

  beforeEach(() => {
    linearFetch.mockReset();
    vi.stubGlobal('fetch', linearFetch);
    process.env.LINEAR_API_KEY = 'lin_key';
    // Routed on intent: the only Linear call this path makes reads one release's links.
    linearFetch.mockImplementation(async (url: string, init: { body: string }) => {
      const { query, variables } = JSON.parse(init.body);
      if (url === 'https://api.linear.app/graphql' && query.includes('links(') && variables.id === 'rel-oct') {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            data: { release: { name: 'October 2026 Changelog Rollup', links: { nodes: [{ url: OCT_DOC }], pageInfo: { hasNextPage: false } } } },
          }),
        };
      }
      throw new Error(`unexpected fetch: ${url}`);
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.LINEAR_API_KEY;
  });

  const withReleases = (releases: Array<{ id: string; name: string }>) => ({
    ...baseCtx,
    body: { ...baseCtx.body, data: { ...baseCtx.body.data, releases } },
  });
  const inOctober = () => withReleases([{ id: 'rel-oct', name: 'October 2026 Changelog Rollup' }]);

  it('writes the digest doc in the stage-already-matches branch', async () => {
    // Adding an issue to a release does not change its state, so this is the
    // branch that fires — the shape of the rollout-date bug.
    const { getCurrentStage, updateByLinearId } = await import('@lib/hubspot-client');
    vi.mocked(getCurrentStage).mockResolvedValue('stage-idea');

    const result = await main(inOctober());

    expect(updateByLinearId).toHaveBeenCalledWith('2-content', 'lin-1', {
      changelog_rollup: 'October 2026 Changelog Rollup',
      changelog_doc_url: OCT_DOC,
    });
    expect(JSON.parse(result.body).rollup.wrote).toEqual(['changelog_rollup', 'changelog_doc_url']);
  });

  it('writes it after an upsert too', async () => {
    const { upsertContent, updateByLinearId } = await import('@lib/hubspot-client');
    const result = await main(inOctober());
    expect(upsertContent).toHaveBeenCalledOnce();
    expect(updateByLinearId).toHaveBeenCalledOnce();
    expect(JSON.parse(result.body).ok).toBe(true);
  });

  it('still syncs the stage, and still names the release, when Linear cannot be reached', async () => {
    linearFetch.mockRejectedValue(new Error('ECONNRESET'));
    const { upsertContent, updateByLinearId } = await import('@lib/hubspot-client');

    const result = await main(inOctober());
    const body = JSON.parse(result.body);

    expect(result.statusCode).toBe(200);
    expect(upsertContent).toHaveBeenCalledOnce();
    expect(updateByLinearId).toHaveBeenCalledWith('2-content', 'lin-1', { changelog_rollup: 'October 2026 Changelog Rollup' });
    expect(body.ok).toBe(true);
    expect(body.rollup.linkError).toMatch(/ECONNRESET/);
  });

  it('still answers 200 when the rollup write itself fails', async () => {
    const { updateByLinearId } = await import('@lib/hubspot-client');
    vi.mocked(updateByLinearId).mockRejectedValue(new Error('Property "changelog_rollup" does not exist'));

    const result = await main(inOctober());
    const body = JSON.parse(result.body);

    expect(result.statusCode).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.rollup.error).toMatch(/does not exist/);
  });

  it('makes no Linear call and no write for an issue only in a Spotlight', async () => {
    const { updateByLinearId } = await import('@lib/hubspot-client');
    await main(withReleases([{ id: 'rel-spot', name: 'Spring 2027 Spotlight' }]));
    expect(linearFetch).not.toHaveBeenCalled();
    expect(updateByLinearId).not.toHaveBeenCalled();
  });

  it('writes nothing for an issue in two monthly rollups', async () => {
    const { updateByLinearId } = await import('@lib/hubspot-client');
    const result = await main(withReleases([
      { id: 'rel-oct', name: 'October 2026 Changelog Rollup' },
      { id: 'rel-nov', name: 'November 2026 Changelog Rollup' },
    ]));
    expect(updateByLinearId).not.toHaveBeenCalled();
    expect(JSON.parse(result.body).rollup.skipped).toMatch(/2 monthly rollups/);
  });

  it('writes nothing when the payload carries no releases field', async () => {
    // The control: every payload before this feature looked like this.
    const { updateByLinearId } = await import('@lib/hubspot-client');
    const result = await main(baseCtx);
    expect(updateByLinearId).not.toHaveBeenCalled();
    expect(linearFetch).not.toHaveBeenCalled();
    expect(JSON.parse(result.body).rollup).toBeUndefined();
  });
});
```

(Add `afterEach` to the vitest import. Check first whether the file stubs `fetch` at module scope; if it does, restore that stub in `afterEach` instead of `vi.unstubAllGlobals()`.)

- [ ] **Step 2: Run and watch them fail** — `npx vitest run src/app/__tests__/linear-webhook.test.ts` → the new tests FAIL (no `rollup` in the body, `updateByLinearId` never called); the existing ones still PASS.

- [ ] **Step 3: Implement**

`types.ts`, in `LinearIssue`:

```ts
  /** The releases the issue is in. Linear's schema puts them on every Issue
   *  webhook (`IssueWebhookPayload.releases`), but no live payload has been
   *  observed carrying them yet — so absent means "not said", never "none". */
  releases?: Array<{ id: string; name: string }>;
```

`LinearWebhook.ts` — imports:

```ts
import {
  getCurrentStage,
  upsertContent,
  archiveContentByLinearId,
  refreshDerivedProperties,
  readAppSettings,
  readProjectState,
  recordUnmappedProject,
  updateByLinearId,
} from '../lib/hubspot-client';
import type { LinearIssue, LinearWebhookPayload } from '../lib/types';
import { getIssueProject, getReleaseLinkUrls } from '../lib/linear-client';
import { isMonthlyRollup, pickRollupDoc, webhookChanges, type RollupDoc } from '../lib/rollup-doc';
```

The helper, above `main`:

```ts
/**
 * Puts the monthly rollup an issue is in — and the digest's doc, when its
 * release links one — on the entry.
 *
 * Runs after the stage write, in BOTH branches that make one. Adding an issue
 * to a release does not change its state, so the "stage already matches"
 * branch is the one that will usually fire; leaving it out is how rollout
 * dates once went unwritten.
 *
 * Set-only. Clearing a stale link needs the entry's current value and every
 * rollup's doc, which is the daily sweep's job (RollupDocSync).
 *
 * Never fails the webhook. The stage has already synced, and a doc link is not
 * worth reporting that as a failure, so whatever goes wrong is logged and
 * returned for the response body.
 */
async function applyRollup(objectTypeId: string, issue: LinearIssue): Promise<Record<string, unknown> | undefined> {
  if (!issue.releases) return undefined;
  const rollups = issue.releases.filter(r => isMonthlyRollup(r.name));
  if (rollups.length === 0) return undefined;
  if (rollups.length > 1) {
    return { skipped: `in ${rollups.length} monthly rollups`, releases: rollups.map(r => r.name) };
  }

  const [release] = rollups;
  let doc: RollupDoc = { kind: 'none' };
  let linkError: string | undefined;
  try {
    const apiKey = process.env.LINEAR_API_KEY;
    if (!apiKey) throw new Error('LINEAR_API_KEY is not set');
    doc = pickRollupDoc(await getReleaseLinkUrls(apiKey, release.id));
  } catch (err) {
    // The name is still worth writing: it came from the payload, not this call.
    linkError = err instanceof Error ? err.message : String(err);
    console.error(`LinearWebhook: could not read links for release ${release.id}: ${linkError}`);
  }

  const changes = webhookChanges({ name: release.name, doc });
  try {
    const found = await updateByLinearId(objectTypeId, issue.id, changes);
    const skipped = !found
      ? 'no record for this issue'
      : doc.kind === 'ambiguous'
        ? `release links ${doc.urls.length} Google Docs`
        : undefined;
    return {
      release: release.name,
      wrote: found ? Object.keys(changes) : [],
      ...(skipped ? { skipped } : {}),
      ...(linkError ? { linkError } : {}),
    };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    console.error(`LinearWebhook: could not write rollup fields for ${issue.id}: ${error}`);
    return { release: release.name, wrote: [], error };
  }
}
```

In the stage-already-matches branch, after `await refreshDerivedProperties(...)`:

```ts
        const rollup = await applyRollup(portalConfig.content.objectTypeId, payload.data);
        return {
          statusCode: 200,
          body: JSON.stringify({ skipped: true, reason: 'stage already matches', refreshed: true, ...(rollup ? { rollup } : {}) }),
        };
```

After `upsertContent`:

```ts
    const result = await upsertContent(payload, context.accountId, pipelineKey);
    const rollup = await applyRollup(portalConfig.content.objectTypeId, payload.data);

    console.log(`${result.action} ${isChangelog ? 'changelog' : 'content'} ${result.id} for Linear ${payload.data.id}`);
    return { statusCode: 200, body: JSON.stringify({ ok: true, ...result, ...(rollup ? { rollup } : {}) }) };
```

`linear-webhook-hsmeta.json`: `"secretKeys": ["LINEAR_WEBHOOK_SECRET", "HS_ACCESS_TOKEN", "LINEAR_API_KEY"]`.

> Side effect to report in the PR: `LinearWebhook.ts` already reads `process.env.LINEAR_API_KEY` for `getIssueProject` (project-map routing when the payload has no project), but the hsmeta never declared it — so that lookup has never been able to run in production. Declaring the secret switches it on.

- [ ] **Step 4: Run and watch them pass** — `npx vitest run src/app/__tests__/linear-webhook.test.ts` → all PASS.

- [ ] **Step 5: Commit** — `git commit -m "feat(webhook): set the monthly rollup and its digest doc on the entry"`

---

### Task 5: The daily sweep — `RollupDocSync`

**Files:**
- Create: `src/app/functions/RollupDocSync.ts`, `src/app/functions/rollup-doc-sync-hsmeta.json`, `src/app/workflow-actions/rollup-doc-sync-hsmeta.json`
- Modify: `src/app/__tests__/function-endpoints-are-justified.test.ts`, `src/app/__tests__/workflow-actions.test.ts`
- Test: `src/app/__tests__/rollup-doc-sync.test.ts` (new)

**Interfaces:**
- Consumes: `listMonthlyRollups` (Task 2); `searchAll`, `batchUpdate`, `BATCH_UPDATE_LIMIT`, `HsRow` (Task 3); `planSweep`, `decideEntry` (Task 1); `verifySharedSecret`; `getPortalConfig`
- Produces: `main(context: { accountId: number; body?: { inputFields?: { sharedSecret?: string } } })` → `{ statusCode, body }`, body `{ outputFields: { syncStatus: 'ok'|'partial'|'error', updated, cleared, skipped, detail } }` (all strings)

- [ ] **Step 1: Write the failing test** — `src/app/__tests__/rollup-doc-sync.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@lib/portal-config', async () => ({
  ...(await vi.importActual<typeof import('@lib/portal-config')>('@lib/portal-config')),
  getPortalConfig: vi.fn().mockReturnValue({ content: { objectTypeId: '2-content' } }),
}));

const { main } = await import('../functions/RollupDocSync');

const OCT_DOC = 'https://docs.google.com/document/d/1OctDoc/edit';
const OWN_DOC = 'https://docs.google.com/document/d/1OwnDoc/edit';
const HS = 'https://api.hubapi.com/crm/objects/2026-03/2-content';

interface FakeRelease { id: string; name: string; links: string[]; issues: string[] }
interface FakeEntry { id: string; linear_id?: string; changelog_doc_url?: string; changelog_rollup?: string }

/** A Linear workspace and a HubSpot portal, answering by intent. */
function world(releases: FakeRelease[], entries: FakeEntry[], opts: { failIssuePage?: boolean; onSearch?: () => void } = {}) {
  const writes: Array<{ id: string; properties: Record<string, string> }> = [];
  const ISSUES_PAGE = 50;
  const ok = (body: unknown, status = 200) => ({ ok: true, status, json: async () => body, text: async () => JSON.stringify(body) });

  const fetchImpl = async (url: string, init: { method?: string; body: string }) => {
    const body = JSON.parse(init.body);

    if (url === 'https://api.linear.app/graphql') {
      if (body.query.includes('releases(')) {
        const nodes = releases
          .filter(r => r.name.endsWith(body.variables.suffix))
          .map(r => ({
            id: r.id,
            name: r.name,
            links: { nodes: r.links.map(u => ({ url: u })), pageInfo: { hasNextPage: false } },
            issues: {
              nodes: r.issues.slice(0, ISSUES_PAGE).map(id => ({ id })),
              pageInfo: { hasNextPage: r.issues.length > ISSUES_PAGE, endCursor: r.issues.length > ISSUES_PAGE ? 'p1' : null },
            },
          }));
        return ok({ data: { releases: { nodes, pageInfo: { hasNextPage: false, endCursor: null } } } });
      }
      if (body.query.includes('release(id: $id)') && body.query.includes('issues(')) {
        if (opts.failIssuePage) return { ok: false, status: 500, statusText: 'Server Error', json: async () => ({}) };
        const r = releases.find(x => x.id === body.variables.id)!;
        const start = body.variables.after ? Number(body.variables.after) : 0;
        const page = r.issues.slice(start, start + body.variables.first);
        const next = start + page.length;
        return ok({ data: { release: { issues: {
          nodes: page.map(id => ({ id })),
          pageInfo: { hasNextPage: next < r.issues.length, endCursor: next < r.issues.length ? String(next) : null },
        } } } });
      }
    }

    if (url === `${HS}/search`) {
      opts.onSearch?.();
      const matches = (e: FakeEntry) => body.filterGroups.some((g: { filters: Array<{ propertyName: keyof FakeEntry; operator: string; values?: string[] }> }) =>
        g.filters.every(f =>
          f.operator === 'IN' ? f.values!.includes(e[f.propertyName] ?? '') : f.operator === 'HAS_PROPERTY' ? Boolean(e[f.propertyName]) : false));
      const results = entries.filter(matches).map(e => ({
        id: e.id,
        properties: { linear_id: e.linear_id ?? null, changelog_doc_url: e.changelog_doc_url ?? null, changelog_rollup: e.changelog_rollup ?? null },
      }));
      return ok({ results });
    }

    if (url === `${HS}/batch/update`) {
      writes.push(...body.inputs);
      return ok({ status: 'COMPLETE', results: body.inputs });
    }

    throw new Error(`unexpected ${init.method ?? 'GET'} ${url}`);
  };

  const fetchMock = vi.fn(fetchImpl);
  vi.stubGlobal('fetch', fetchMock);
  return { writes, fetchMock };
}

const ctx = (sharedSecret = 'shh') => ({ accountId: 999, body: { inputFields: { sharedSecret } } });
const out = (res: { body: string }) => JSON.parse(res.body).outputFields;

const OCTOBER: FakeRelease = { id: 'r-oct', name: 'October 2026 Changelog Rollup', links: [OCT_DOC], issues: ['iss-876', 'iss-1453'] };

beforeEach(() => {
  process.env.SYNC_SHARED_SECRET = 'shh';
  process.env.LINEAR_API_KEY = 'lin_key';
  process.env.HS_ACCESS_TOKEN = 'tok';
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('RollupDocSync', () => {
  it("sets October's doc and name on my entry, and creates nothing for issues that aren't mine", async () => {
    // iss-1453 is in the release but not in HubSpot — someone else's, or nobody's.
    const { writes, fetchMock } = world([OCTOBER], [{ id: '101', linear_id: 'iss-876' }]);

    const res = await main(ctx());

    expect(writes).toEqual([{ id: '101', properties: { changelog_doc_url: OCT_DOC, changelog_rollup: 'October 2026 Changelog Rollup' } }]);
    expect(out(res)).toMatchObject({ syncStatus: 'ok', updated: '1', cleared: '0' });
    // Every HubSpot call was a search or a batch update — never a create.
    for (const [url] of fetchMock.mock.calls) {
      if (String(url).startsWith(HS)) expect(url).toMatch(/\/(search|batch\/update)$/);
    }
  });

  it("clears October's doc and moves the name when the issue rolls on to November", async () => {
    const november: FakeRelease = { id: 'r-nov', name: 'November 2026 Changelog Rollup', links: [], issues: ['iss-876'] };
    const october: FakeRelease = { ...OCTOBER, issues: [] };
    const { writes } = world([october, november], [
      { id: '101', linear_id: 'iss-876', changelog_doc_url: OCT_DOC, changelog_rollup: 'October 2026 Changelog Rollup' },
    ]);

    const res = await main(ctx());

    expect(writes).toEqual([{ id: '101', properties: { changelog_doc_url: '', changelog_rollup: 'November 2026 Changelog Rollup' } }]);
    expect(out(res)).toMatchObject({ updated: '1', cleared: '1' });
  });

  it('writes nothing for an entry with its own doc whose issue is in no rollup', async () => {
    // The control.
    const { writes } = world([OCTOBER], [{ id: '102', linear_id: 'iss-other', changelog_doc_url: OWN_DOC }]);
    const res = await main(ctx());
    expect(writes).toEqual([]);
    expect(out(res)).toMatchObject({ syncStatus: 'ok', updated: '0' });
  });

  it('leaves alone, and reports, an issue in two monthly rollups', async () => {
    const november: FakeRelease = { id: 'r-nov', name: 'November 2026 Changelog Rollup', links: [], issues: ['iss-876'] };
    const { writes } = world([OCTOBER, november], [{ id: '101', linear_id: 'iss-876' }]);
    const res = await main(ctx());
    expect(writes).toEqual([]);
    expect(out(res).skipped).toBe('1');
    expect(out(res).detail).toMatch(/iss-876: in 2 monthly rollups/);
  });

  it('reads past the first page of a release\'s issues', async () => {
    const issues = Array.from({ length: 60 }, (_, i) => `iss-${i}`);
    const { writes } = world([{ ...OCTOBER, issues }], [{ id: '155', linear_id: 'iss-55' }]);
    await main(ctx());
    expect(writes).toEqual([{ id: '155', properties: { changelog_doc_url: OCT_DOC, changelog_rollup: 'October 2026 Changelog Rollup' } }]);
  });

  it('writes nothing at all when a Linear page fails', async () => {
    const issues = Array.from({ length: 60 }, (_, i) => `iss-${i}`);
    const { writes } = world([{ ...OCTOBER, issues }], [
      { id: '101', linear_id: 'iss-55', changelog_doc_url: OCT_DOC, changelog_rollup: 'October 2026 Changelog Rollup' },
    ], { failIssuePage: true });
    const res = await main(ctx());
    expect(writes).toEqual([]);
    expect(out(res)).toMatchObject({ syncStatus: 'error' });
    expect(out(res).detail).toMatch(/nothing written/);
  });

  it('leaves a record with no linear_id alone, even holding a rollup doc', async () => {
    const { writes } = world([OCTOBER], [{ id: '103', changelog_doc_url: OCT_DOC }]);
    await main(ctx());
    expect(writes).toEqual([]);
  });

  it('ignores Spotlight releases', async () => {
    const spotlight: FakeRelease = { id: 'r-spot', name: 'Spring 2027 Spotlight', links: [OWN_DOC], issues: ['iss-876'] };
    const { writes } = world([spotlight], [{ id: '101', linear_id: 'iss-876' }]);
    await main(ctx());
    expect(writes).toEqual([]);
  });

  it('stops before writing when the reads use up the time budget', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const { writes } = world([OCTOBER], [{ id: '101', linear_id: 'iss-876' }], {
      onSearch: () => vi.setSystemTime(Date.now() + 17_000),
    });
    const res = await main(ctx());
    expect(writes).toEqual([]);
    expect(out(res)).toMatchObject({ syncStatus: 'partial' });
  });

  it('rejects a request without the shared secret, and calls nothing', async () => {
    const { fetchMock } = world([OCTOBER], []);
    const res = await main(ctx('wrong'));
    expect(res.statusCode).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run and watch it fail** — `npx vitest run src/app/__tests__/rollup-doc-sync.test.ts` → FAIL, cannot resolve `../functions/RollupDocSync`.

- [ ] **Step 3: Implement** — `src/app/functions/RollupDocSync.ts`:

```ts
import { listMonthlyRollups } from '../lib/linear-client';
import { searchAll, batchUpdate, BATCH_UPDATE_LIMIT, type HsRow } from '../lib/hubspot-client';
import { planSweep, decideEntry, type SweepPlan } from '../lib/rollup-doc';
import { verifySharedSecret } from '../lib/shared-secret';
import { getPortalConfig } from '../lib/portal-config';

/**
 * The daily rollup sweep: puts each monthly rollup's digest doc on my entries
 * in it, and clears the ones that have gone stale.
 *
 * WHY A SWEEP AS WELL AS THE WEBHOOK
 * ---------------------------------
 * The webhook hears about an issue when the issue changes. Two things change
 * the answer without touching any issue: the digest owner attaching the doc to
 * the release, and a scheduled release completing and moving its unfinished
 * issues on to the next one. Nothing reports either, so once a day this reads
 * every monthly rollup and makes the entries match.
 *
 * It never creates a record. It considers only entries that already exist —
 * those whose linear_id Linear reports in a rollup, plus every entry already
 * carrying a rollup field — and writes only changelog_doc_url and
 * changelog_rollup.
 *
 * See docs/superpowers/specs/2026-10-20-rollup-doc-link-design.md.
 */

/** HubSpot kills an app function at 20s. Leave room to say what happened. */
const BUDGET_MS = 16_000;
/** Values per IN filter. */
const IN_CHUNK = 100;
const PROPERTIES = ['linear_id', 'changelog_doc_url', 'changelog_rollup'];

interface RollupDocSyncContext {
  accountId: number;
  body?: { inputFields?: { sharedSecret?: string } };
}

interface Result {
  statusCode: number;
  body: string;
}

interface Counts {
  updated: number;
  cleared: number;
  skipped: string[];
}

/**
 * Workflow actions answer 200 for anything recoverable: a non-2xx makes HubSpot
 * retry and eventually park the enrollment. The status says what happened.
 */
function outcome(syncStatus: 'ok' | 'partial' | 'error', counts: Counts, detail = ''): Result {
  const notes = [detail, ...counts.skipped].filter(Boolean).join('; ');
  return {
    statusCode: 200,
    body: JSON.stringify({
      outputFields: {
        syncStatus,
        updated: String(counts.updated),
        cleared: String(counts.cleared),
        skipped: String(counts.skipped.length),
        detail: notes.slice(0, 1000),
      },
    }),
  };
}

function reason(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

async function findEntries(objectTypeId: string, issueIds: string[]): Promise<HsRow[]> {
  const byId = new Map<string, HsRow>();
  for (let i = 0; i < issueIds.length; i += IN_CHUNK) {
    const rows = await searchAll(
      objectTypeId,
      [[{ propertyName: 'linear_id', operator: 'IN', values: issueIds.slice(i, i + IN_CHUNK) }]],
      PROPERTIES,
    );
    for (const row of rows) byId.set(row.id, row);
  }
  // Entries written before whose issue may since have left every rollup. Found
  // by what they carry, because Linear no longer lists them anywhere.
  const carrying = await searchAll(
    objectTypeId,
    [
      [{ propertyName: 'changelog_doc_url', operator: 'HAS_PROPERTY' }],
      [{ propertyName: 'changelog_rollup', operator: 'HAS_PROPERTY' }],
    ],
    PROPERTIES,
  );
  for (const row of carrying) byId.set(row.id, row);
  return [...byId.values()];
}

export async function main(context: RollupDocSyncContext): Promise<Result> {
  const expected = process.env.SYNC_SHARED_SECRET;
  if (!expected) {
    console.error('SYNC_SHARED_SECRET is not set');
    return { statusCode: 500, body: JSON.stringify({ error: 'Server misconfiguration' }) };
  }
  if (!verifySharedSecret(context.body?.inputFields?.sharedSecret, expected)) {
    console.warn('Rejected RollupDocSync request: invalid shared secret');
    return { statusCode: 401, body: JSON.stringify({ error: 'Unauthorized' }) };
  }
  const apiKey = process.env.LINEAR_API_KEY;
  if (!apiKey) {
    console.error('LINEAR_API_KEY is not set');
    return { statusCode: 500, body: JSON.stringify({ error: 'Server misconfiguration' }) };
  }

  const deadline = Date.now() + BUDGET_MS;
  const objectTypeId = getPortalConfig(context.accountId).content.objectTypeId;
  const counts: Counts = { updated: 0, cleared: 0, skipped: [] };

  // Every read, before any write. A partial read makes an issue look as though
  // it left its rollup, so any failure ends the run with nothing written.
  let plan: SweepPlan;
  let entries: HsRow[];
  try {
    plan = planSweep(await listMonthlyRollups(apiKey));
    entries = await findEntries(objectTypeId, [...plan.issueRollups.keys()]);
  } catch (err) {
    console.error(`RollupDocSync: read failed: ${reason(err)}`);
    return outcome('error', counts, `nothing written: ${reason(err)}`);
  }

  const updates: Array<{ id: string; properties: Record<string, string> }> = [];
  for (const entry of entries) {
    const linearId = entry.properties.linear_id;
    // Not tracked from Linear, so "its issue is in no rollup" is not known.
    if (!linearId) continue;
    const decision = decideEntry(
      {
        changelog_doc_url: entry.properties.changelog_doc_url ?? '',
        changelog_rollup: entry.properties.changelog_rollup ?? '',
      },
      plan.issueRollups.get(linearId) ?? [],
      plan.rollupDocIds,
    );
    if (decision.skipped) counts.skipped.push(`${linearId}: ${decision.skipped}`);
    if (Object.keys(decision.changes).length > 0) {
      updates.push({ id: entry.id, properties: decision.changes as Record<string, string> });
    }
  }

  for (let i = 0; i < updates.length; i += BATCH_UPDATE_LIMIT) {
    if (Date.now() > deadline) {
      return outcome('partial', counts, `out of time with ${updates.length - i} update(s) left; the next run finishes them`);
    }
    const chunk = updates.slice(i, i + BATCH_UPDATE_LIMIT);
    try {
      await batchUpdate(objectTypeId, chunk);
    } catch (err) {
      console.error(`RollupDocSync: write failed: ${reason(err)}`);
      return outcome('error', counts, `write failed: ${reason(err)}`);
    }
    counts.updated += chunk.length;
    counts.cleared += chunk.filter(u => u.properties.changelog_doc_url === '').length;
  }

  console.log(`RollupDocSync: ${counts.updated} updated, ${counts.cleared} doc link(s) cleared, ${counts.skipped.length} skipped`);
  return outcome('ok', counts);
}
```

`src/app/functions/rollup-doc-sync-hsmeta.json`:

```json
{
  "uid": "rollup_doc_sync",
  "type": "app-function",
  "config": {
    "entrypoint": "/app/functions/RollupDocSync.js",
    "endpoint": {
      "path": "rollup-doc-sync",
      "methods": ["POST"]
    },
    "secretKeys": ["LINEAR_API_KEY", "SYNC_SHARED_SECRET", "HS_ACCESS_TOKEN"]
  }
}
```

`src/app/workflow-actions/rollup-doc-sync-hsmeta.json`:

```json
{
  "uid": "rollup_doc_sync_v1",
  "type": "workflow-action",
  "config": {
    "actionUrl": "https://51869810.hs-sites.com/hs/serverless/rollup-doc-sync",
    "isPublished": true,
    "supportedClients": [{ "client": "WORKFLOWS" }],
    "objectTypes": [],
    "inputFields": [
      {
        "typeDefinition": { "name": "sharedSecret", "type": "string", "fieldType": "text" },
        "supportedValueTypes": ["STATIC_VALUE"],
        "isRequired": true
      }
    ],
    "outputFields": [
      { "typeDefinition": { "name": "syncStatus", "type": "string", "fieldType": "text" } },
      { "typeDefinition": { "name": "updated", "type": "string", "fieldType": "text" } },
      { "typeDefinition": { "name": "cleared", "type": "string", "fieldType": "text" } },
      { "typeDefinition": { "name": "skipped", "type": "string", "fieldType": "text" } },
      { "typeDefinition": { "name": "detail", "type": "string", "fieldType": "text" } }
    ],
    "labels": {
      "en": {
        "actionName": "Sync Rollup Doc Links",
        "appDisplayName": "Central Brain",
        "actionDescription": "Copies each monthly changelog rollup's Google Doc from its release onto the entries in it, and clears links that no longer apply",
        "actionCardContent": "Rollup doc links → changelog entries",
        "inputFieldLabels": { "sharedSecret": "Shared Secret" },
        "inputFieldDescriptions": {
          "sharedSecret": "Shared secret that authenticates this request; must match the SYNC_SHARED_SECRET function secret"
        },
        "outputFieldLabels": {
          "syncStatus": "Sync Status",
          "updated": "Entries Updated",
          "cleared": "Doc Links Cleared",
          "skipped": "Entries Skipped",
          "detail": "Detail"
        }
      }
    }
  }
}
```

`function-endpoints-are-justified.test.ts`, in `PUBLIC_BY_DESIGN` with the workflow actions: `rollup_doc_sync: 'workflow-action actionUrl',`

`workflow-actions.test.ts`, appended:

```ts
/**
 * provision-workflows.ts finds each action by SUBSTRING, in order, and takes
 * the first match. An action whose uid or name contained one of these words
 * would be handed out as that other action's id, and a workflow would call the
 * wrong function — with a 200.
 */
const CLAIMED_BY_PROVISIONING = ['linear', 'asana', 'poll', 'youtube', 'fellow', 'social', 'associate_related', 'associate related'];

describe('rollup-doc-sync-hsmeta.json', () => {
  it('uses a uid and name the provisioning matchers do not claim', () => {
    const action = load('rollup-doc-sync-hsmeta.json') as { uid?: string; config: { labels?: { en?: { actionName?: string } } } };
    const uid = (action.uid ?? '').toLowerCase();
    const name = (action.config.labels?.en?.actionName ?? '').toLowerCase();
    for (const word of CLAIMED_BY_PROVISIONING) {
      expect(uid, `uid contains "${word}"`).not.toContain(word);
      expect(name, `actionName contains "${word}"`).not.toContain(word);
    }
  });
});
```

- [ ] **Step 4: Run and watch it pass** — `npx vitest run src/app/__tests__/rollup-doc-sync.test.ts src/app/__tests__/workflow-actions.test.ts src/app/__tests__/function-endpoints-are-justified.test.ts src/app/__tests__/function-entrypoints.test.ts` → PASS.

- [ ] **Step 5: Commit** — `git commit -m "feat(rollup): daily sweep that sets and clears rollup doc links"`

---

### Task 6: Provisioning and preflight

**Files:**
- Modify: `src/scripts/provision-changelog-drafting.ts`, `src/scripts/provision-workflows.ts`, `src/scripts/preflight.ts`

These scripts run `main()` on import and have no unit tests; the naming constraint they depend on is pinned by Task 5's `workflow-actions.test.ts` case, and `npm run typecheck` covers the edits.

- [ ] **Step 1:** `provision-changelog-drafting.ts` — after `changelog_doc_url`:

```ts
    // The monthly rollup release the issue is in ("October 2026 Changelog
    // Rollup"), mirrored from Linear by the webhook and the daily sweep, so a
    // month's entries are one HubSpot filter. Text, not a select: release names
    // come from Linear, and a new month must not need a provisioning run.
    { name: 'changelog_rollup', label: 'Changelog Rollup', type: 'string', fieldType: 'text' },
```

and add `changelog_rollup — which monthly rollup release the issue is in` to the header comment.

- [ ] **Step 2:** `preflight.ts` — in `REQUIRED_PROPERTIES.content`, after `'changelog_doc_url'`:

```ts
    // Mirrored from the issue's Linear release. The rollup sweep reads it to
    // find entries whose rollup has gone stale.
    'changelog_rollup',
```

- [ ] **Step 3:** `provision-workflows.ts`:
  - add `rollupDocSyncId: string;` to `discoverActionIds`'s return type;
  - after the `generateSocialDraftAction` lookup:

```ts
  // Matched exactly, by uid or full name. Its name avoids every word the
  // matchers above claim — workflow-actions.test.ts holds that — and exact
  // matching keeps a future action from being mistaken for it.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rollupDocSyncAction = actions.find((a: any) =>
    a.uid === 'rollup_doc_sync_v1' || a.labels?.en?.actionName === 'Sync Rollup Doc Links',
  );
```

  - with the other guards:

```ts
  if (!rollupDocSyncAction) {
    throw new Error(
      `Could not find the rollup doc sync action. Make sure you have deployed the project before running this script. Found UIDs: ${actions.map((a: any) => a.uid ?? a.id).join(', ')}`,
    );
  }
```

  - return `rollupDocSyncId: \`1-${rollupDocSyncAction.id}\``;
  - `buildPollWorkflow(name, appConfigObjectTypeId, asanaPollId, fields: Record<string, string> = {})` and use `fields` in its action;
  - destructure `rollupDocSyncId` in `main` and, after the YouTube step:

```ts
  // Step 8b: App Config daily rollup doc sweep. The webhook sets a rollup's doc
  // as issues change; this catches what no webhook announces — the doc being
  // attached after the issues, and a completed release rolling its unfinished
  // issues on to next month. Authenticated, unlike the polls above.
  const rollupWorkflowName = 'Changelog Rollup Docs (Daily)';
  await upsertWorkflow(rollupWorkflowName, buildPollWorkflow(
    rollupWorkflowName,
    config.appConfig.objectTypeId,
    rollupDocSyncId,
    fieldSpec([{ name: 'sharedSecret', value: sharedSecret }]),
  ));
```

- [ ] **Step 4:** `npm run typecheck && npm run lint` → exit 0.

- [ ] **Step 5: Commit** — `git commit -m "chore(provision): changelog_rollup property and the daily rollup doc workflow"`

---

### Task 7: Docs, validate, PR

- [ ] **Step 1:** `docs/ARCHITECTURE.md` — record that `changelog_doc_url` now has three writers (Create Doc, a person, the rollup paths), that a monthly rollup's doc wins, and that only a rollup doc is ever cleared; that the webhook's rollup step is set-only and cannot fail the webhook; that the sweep's reads are strict.
- [ ] **Step 2:** `docs/OPERATOR-GUIDE.md` §4b — "Digest doc links": attach the Google Doc to the release in Linear; the provisioning order from the spec §8; scheduling the daily workflow by hand; what `syncStatus` / `detail` mean.
- [ ] **Step 3:** `docs/PROJECT-CONTEXT.md` §3.2 — built but unverified: the rollup doc link, with the two live checks from spec §9.
- [ ] **Step 4:** `CHANGELOG.md` — a 2026-10-20 entry.
- [ ] **Step 5:** `docs/walkthroughs/59-…md` — the episode guide, in the CLAUDE.md format.
- [ ] **Step 6:** `npm run validate` → exit 0, test count above the 1,181 baseline.
- [ ] **Step 7:** commit, push `feat/rollup-doc-link`, open a PR into `develop` that lists the rollout order (spec §8), the two live checks (spec §9) and the `LINEAR_API_KEY` side effect on `getIssueProject`.
