import { describe, it, expect } from 'vitest';
import {
  ROLLUP_PIPELINE_ID,
  isRollupPipeline,
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

describe('isRollupPipeline', () => {
  // A digest is any release in Linear's "Monthly Changelog Rollups" pipeline —
  // monthly rollups and Spotlights alike (decided 2026-10-26). Matched by the
  // pipeline's id, which survives a rename; names do not matter.
  it('accepts the Monthly Changelog Rollups pipeline', () => {
    expect(ROLLUP_PIPELINE_ID).toBe('b597dbf5-1813-447d-ba29-2a13106b9274');
    expect(isRollupPipeline(ROLLUP_PIPELINE_ID)).toBe(true);
  });

  it.each([['another pipeline', 'pipe-other'], ['empty', ''], ['null', null], ['undefined', undefined]])(
    'rejects %s',
    (_label, id) => expect(isRollupPipeline(id as string | null | undefined)).toBe(false),
  );
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
  it('maps each issue to its rollup releases and collects every rollup doc', () => {
    const plan = planSweep([
      { id: 'r-oct', name: 'October 2026 Changelog Rollup', pipelineId: ROLLUP_PIPELINE_ID, linkUrls: [OCT_DOC], issueIds: ['i-1', 'i-2'] },
      { id: 'r-nov', name: 'November 2026 Changelog Rollup', pipelineId: ROLLUP_PIPELINE_ID, linkUrls: [], issueIds: ['i-3'] },
    ]);
    expect(plan.issueRollups.get('i-1')).toEqual([OCT]);
    expect(plan.issueRollups.get('i-3')).toEqual([NOV_NO_DOC]);
    expect([...plan.rollupDocIds]).toEqual([googleDocId(OCT_DOC)]);
  });

  it('gives an issue in two releases both of them', () => {
    const plan = planSweep([
      { id: 'r-oct', name: 'October 2026 Changelog Rollup', pipelineId: ROLLUP_PIPELINE_ID, linkUrls: [OCT_DOC], issueIds: ['i-1'] },
      { id: 'r-nov', name: 'November 2026 Changelog Rollup', pipelineId: ROLLUP_PIPELINE_ID, linkUrls: [], issueIds: ['i-1'] },
    ]);
    expect(plan.issueRollups.get('i-1')).toEqual([OCT, NOV_NO_DOC]);
  });

  it('includes a Spotlight — membership is the pipeline, not the name', () => {
    const plan = planSweep([
      { id: 'r-spring', name: 'Spring 2027 Spotlight', pipelineId: ROLLUP_PIPELINE_ID, linkUrls: [], issueIds: ['i-555'] },
    ]);
    expect(plan.issueRollups.get('i-555')).toEqual([{ name: 'Spring 2027 Spotlight', doc: { kind: 'none' } }]);
  });

  it('ignores releases in any other pipeline', () => {
    const plan = planSweep([
      { id: 'r-x', name: 'October 2026 Changelog Rollup', pipelineId: 'pipe-other', linkUrls: [OWN_DOC], issueIds: ['i-1'] },
    ]);
    expect(plan.issueRollups.size).toBe(0);
    expect(plan.rollupDocIds.size).toBe(0);
  });

  it('counts the docs of an ambiguous release as rollup docs', () => {
    // So a link written before the second doc appeared can still be recognised,
    // and cleared, later.
    const plan = planSweep([
      { id: 'r-oct', name: 'October 2026 Changelog Rollup', pipelineId: ROLLUP_PIPELINE_ID, linkUrls: [OCT_DOC, NOV_DOC], issueIds: [] },
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

  it('changes nothing, and says why, for an issue in two rollup releases', () => {
    const decision = decideEntry(EMPTY, [OCT, NOV_NO_DOC], ROLLUP_DOCS);
    expect(decision.changes).toEqual({});
    expect(decision.skipped).toMatch(/in 2 rollup releases/);
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
