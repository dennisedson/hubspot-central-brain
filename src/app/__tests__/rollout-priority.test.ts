import { describe, it, expect } from 'vitest';
import {
  parseRolloutNotes, milestones, rolloutPriority, isTentative, EPOCH_ZERO, rolloutProperties,
} from '../lib/changelog-source';

/**
 * Which changelog should be written next.
 *
 * Decided by the beta and live milestones: in-development dates are too far
 * out to action, and a tentative date is not a commitment.
 */

const notes = (timeline: string) => `**Rollout ID:** 1
**Name:** A thing
**State:** In Development

### Timeline

${timeline}
`;

describe('epoch zero', () => {
  it('is dropped — it is no date, not an old one', () => {
    // 10 of the 23 dates on production are 1970-01-01. Sorting ascending would
    // put the records we know LEAST about at the top, looking most urgent.
    const s = parseRolloutNotes(notes(`**Public Beta Date:** ${EPOCH_ZERO}`));
    expect(milestones(s)).toEqual([]);
    expect(rolloutPriority(s)).toBeNull();
  });

  it('does not drop a real date that merely sorts early', () => {
    const s = parseRolloutNotes(notes('**Public Beta Date:** 1999-06-01'));
    expect(milestones(s)).toHaveLength(1);
  });
});

describe('isTentative', () => {
  it('catches the obvious spellings', () => {
    for (const v of ['2026-10-01 (Tentative)', 'TBD', '2027-01-01 estimated', '2026-05-01 (est.)']) {
      expect(isTentative(v), v).toBe(true);
    }
  });

  it('leaves a plain date alone', () => {
    expect(isTentative('2026-10-01')).toBe(false);
  });
});

describe('milestones', () => {
  it('takes beta and live dates, earliest first', () => {
    const s = parseRolloutNotes(notes([
      '**Live Date:** 2027-01-01',
      '**Private Beta Date:** 2026-06-01',
      '**Public Beta Date:** 2026-09-01',
    ].join('\n')));

    expect(milestones(s).map(m => `${m.stage} ${m.date}`)).toEqual([
      'Private Beta 2026-06-01',
      'Public Beta 2026-09-01',
      'Live 2027-01-01',
    ]);
  });

  it('ignores in-development dates — too far out to action', () => {
    const s = parseRolloutNotes(notes('**In Development Date:** 2026-02-01'));
    expect(milestones(s)).toEqual([]);
  });

  it('skips a tentative milestone rather than promising it', () => {
    const s = parseRolloutNotes(notes([
      '**Public Beta Date:** 2026-09-01 (Tentative)',
      '**Live Date:** 2027-01-01',
    ].join('\n')));

    expect(milestones(s).map(m => m.stage)).toEqual(['Live']);
  });

  it('reads the Marketing Release Date that production actually carries today', () => {
    const s = parseRolloutNotes(notes('**Marketing Release Date:** 2026-10-01'));
    expect(milestones(s)).toEqual([
      { stage: 'Marketing Release', label: 'Marketing Release Date', date: '2026-10-01' },
    ]);
  });
});

describe('rolloutPriority', () => {
  const today = new Date('2026-10-01T00:00:00Z');

  it('is the earliest milestone still ahead — the next thing forcing action', () => {
    const s = parseRolloutNotes(notes([
      '**Live Date:** 2027-03-01',
      '**Public Beta Date:** 2026-12-01',
    ].join('\n')));

    expect(rolloutPriority(s, today)).toEqual({
      date: '2026-12-01', stage: 'Public Beta', upcoming: true,
    });
  });

  it('ignores a milestone already passed when a later one is ahead', () => {
    const s = parseRolloutNotes(notes([
      '**Private Beta Date:** 2026-01-01',
      '**Live Date:** 2026-11-01',
    ].join('\n')));

    expect(rolloutPriority(s, today)?.stage).toBe('Live');
  });

  it('falls back to the most recent past milestone, marked not upcoming', () => {
    // Shipped work still orders sensibly; it is just not pending.
    const s = parseRolloutNotes(notes([
      '**Private Beta Date:** 2025-01-01',
      '**Live Date:** 2025-06-01',
    ].join('\n')));

    expect(rolloutPriority(s, today)).toEqual({
      date: '2025-06-01', stage: 'Live', upcoming: false,
    });
  });

  it('counts today itself as upcoming', () => {
    const s = parseRolloutNotes(notes('**Live Date:** 2026-10-01'));
    expect(rolloutPriority(s, today)?.upcoming).toBe(true);
  });

  it('is null when there is nothing to go on', () => {
    expect(rolloutPriority(parseRolloutNotes('no timeline at all'))).toBeNull();
  });
});

/**
 * Dates move. A milestone can be brought forward, pushed back, or deleted
 * entirely — and a stored date that never updates is worse than no date,
 * because it is wrong with the same confidence as a right one.
 */
describe('rolloutProperties', () => {
  it('declines to write anything when the notes carry no dates', () => {
    // This is what protects a date typed into HubSpot by hand. Most issues
    // have no timeline — the rollout tooling adds it going forward and does
    // not backfill — so writing '' for every key on every sync would blank a
    // manual entry the next time anything touched the issue.
    expect(rolloutProperties('no timeline here')).toBeNull();
    expect(rolloutProperties('**State:** Live\n**Name:** An older issue')).toBeNull();
  });

  it('clears a milestone removed from a timeline that still has others', () => {
    // Once the notes carry dates, Linear is authoritative over all of them.
    const before = rolloutProperties([
      '### Timeline', '',
      '**Public Beta Date:** 2099-01-01',
      '**Live Date:** 2099-06-01',
    ].join('\n'), new Date('2098-01-01T00:00:00Z'));
    expect(before!.rollout_public_beta_date).toBe('2099-01-01');

    const after = rolloutProperties('### Timeline\n\n**Live Date:** 2099-06-01');
    expect(after!.rollout_public_beta_date).toBe('');
    expect(after!.rollout_live_date).toBe('2099-06-01');
  });

  it('cannot clear a timeline emptied completely — a known, deliberate gap', () => {
    // An emptied timeline is indistinguishable from one that never existed,
    // so the stored dates stay until someone clears them by hand. Preferring
    // that to wiping manual entries is the trade: one is a stale date, the
    // other is destroyed work.
    expect(rolloutProperties('### Timeline\n\n(all dates removed)')).toBeNull();
  });

  it('follows a date that moved', () => {
    const moved = rolloutProperties('### Timeline\n\n**Live Date:** 2099-09-01');
    expect(moved!.rollout_live_date).toBe('2099-09-01');
  });

  it('splits milestones into their own properties', () => {
    const props = rolloutProperties([
      '### Timeline',
      '',
      '**Private Beta Date:** 2099-01-01',
      '**Public Beta Date:** 2099-03-01',
      '**Live Date:** 2099-06-01',
    ].join('\n'), new Date('2098-01-01T00:00:00Z'));

    expect(props!.rollout_private_beta_date).toBe('2099-01-01');
    expect(props!.rollout_public_beta_date).toBe('2099-03-01');
    expect(props!.rollout_live_date).toBe('2099-06-01');
    // The sort key is the soonest one still ahead.
    expect(props!.rollout_priority_date).toBe('2099-01-01');
    expect(props!.rollout_priority_stage).toBe('Private Beta');
  });

  it('never stores whether a date is upcoming', () => {
    // It is relative to today: correct for one day, wrong after.
    const props = rolloutProperties('### Timeline\n\n**Live Date:** 2099-01-01');
    expect(Object.keys(props!)).not.toContain('rollout_priority_upcoming');
  });

  it('treats an epoch-zero-only timeline as no opinion at all', () => {
    // Ten production records are exactly this. 1970-01-01 is unset, so the
    // source has nothing to say and a manual entry survives.
    expect(rolloutProperties(`### Timeline\n\n**Live Date:** ${EPOCH_ZERO}`)).toBeNull();
  });
});
