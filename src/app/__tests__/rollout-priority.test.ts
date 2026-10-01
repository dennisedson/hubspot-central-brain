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
  it('returns every key even when there is nothing to store', () => {
    // An omitted property leaves whatever was there before. A date removed
    // upstream has to be CLEARED, which means sending '' for it.
    const props = rolloutProperties('no timeline here');

    expect(Object.keys(props).sort()).toEqual([
      'rollout_live_date',
      'rollout_priority_date',
      'rollout_priority_stage',
      'rollout_private_beta_date',
      'rollout_public_beta_date',
    ]);
    expect(Object.values(props).every(v => v === '')).toBe(true);
  });

  it('clears a date that has been removed upstream', () => {
    const before = rolloutProperties('### Timeline\n\n**Live Date:** 2099-01-01');
    expect(before.rollout_live_date).toBe('2099-01-01');

    const after = rolloutProperties('### Timeline\n\n(date removed)');
    expect(after.rollout_live_date).toBe('');
    expect(after.rollout_priority_date).toBe('');
  });

  it('follows a date that moved', () => {
    const moved = rolloutProperties('### Timeline\n\n**Live Date:** 2099-09-01');
    expect(moved.rollout_live_date).toBe('2099-09-01');
  });

  it('splits milestones into their own properties', () => {
    const props = rolloutProperties([
      '### Timeline',
      '',
      '**Private Beta Date:** 2099-01-01',
      '**Public Beta Date:** 2099-03-01',
      '**Live Date:** 2099-06-01',
    ].join('\n'), new Date('2098-01-01T00:00:00Z'));

    expect(props.rollout_private_beta_date).toBe('2099-01-01');
    expect(props.rollout_public_beta_date).toBe('2099-03-01');
    expect(props.rollout_live_date).toBe('2099-06-01');
    // The sort key is the soonest one still ahead.
    expect(props.rollout_priority_date).toBe('2099-01-01');
    expect(props.rollout_priority_stage).toBe('Private Beta');
  });

  it('never stores whether a date is upcoming', () => {
    // It is relative to today: correct for one day, wrong after.
    const props = rolloutProperties('### Timeline\n\n**Live Date:** 2099-01-01');
    expect(Object.keys(props)).not.toContain('rollout_priority_upcoming');
  });

  it('stores nothing for epoch zero', () => {
    const props = rolloutProperties(`### Timeline\n\n**Live Date:** ${EPOCH_ZERO}`);
    expect(props.rollout_live_date).toBe('');
  });
});
