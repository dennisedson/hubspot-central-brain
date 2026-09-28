import { describe, it, expect } from 'vitest';
import {
  LINEAR_STATE_TO_CONTENT_STAGE,
  LINEAR_STATE_TO_CHANGELOG_STAGE,
  CONTENT_STAGE_TO_LINEAR_STATE,
  CHANGELOG_STAGE_TO_LINEAR_STATE,
  LINEAR_CHANGELOG_LABEL,
  FANOUT_STAGES,
  isFanoutStage,
} from '@lib/mapping';

describe('LINEAR_STATE_TO_CONTENT_STAGE', () => {
  it('maps "Done" to "published"', () =>
    expect(LINEAR_STATE_TO_CONTENT_STAGE['Done']).toBe('published'));
  it('maps "In Progress" to "drafting"', () =>
    expect(LINEAR_STATE_TO_CONTENT_STAGE['In Progress']).toBe('drafting'));
  it('maps "Backlog" to "idea"', () =>
    expect(LINEAR_STATE_TO_CONTENT_STAGE['Backlog']).toBe('idea'));
  it('maps "Canceled" to "archived"', () =>
    expect(LINEAR_STATE_TO_CONTENT_STAGE['Canceled']).toBe('archived'));
});

describe('CONTENT_STAGE_TO_LINEAR_STATE', () => {
  it('maps "published" to "Done"', () =>
    expect(CONTENT_STAGE_TO_LINEAR_STATE['published']).toBe('Done'));
  it('maps "editing" to "In Progress" (same bucket as drafting)', () =>
    expect(CONTENT_STAGE_TO_LINEAR_STATE['editing']).toBe('In Progress'));
  it('maps "archived" to "Canceled"', () =>
    expect(CONTENT_STAGE_TO_LINEAR_STATE['archived']).toBe('Canceled'));
});

describe('LINEAR_STATE_TO_CHANGELOG_STAGE', () => {
  it('maps "In Review" to "reviewing"', () =>
    expect(LINEAR_STATE_TO_CHANGELOG_STAGE['In Review']).toBe('reviewing'));
  it('maps "Done" to "published"', () =>
    expect(LINEAR_STATE_TO_CHANGELOG_STAGE['Done']).toBe('published'));
});

describe('CHANGELOG_STAGE_TO_LINEAR_STATE', () => {
  it('maps "published" to "Done"', () =>
    expect(CHANGELOG_STAGE_TO_LINEAR_STATE['published']).toBe('Done'));
  it('maps "reviewing" to "In Review"', () =>
    expect(CHANGELOG_STAGE_TO_LINEAR_STATE['reviewing']).toBe('In Review'));
});

describe('constants', () => {
  it('LINEAR_CHANGELOG_LABEL is "changelog"', () =>
    expect(LINEAR_CHANGELOG_LABEL).toBe('changelog'));
});

/**
 * The Outline threshold, shared by the Linear and Asana fan-out.
 *
 * It lives in mapping.ts rather than in either handler because two copies would
 * eventually disagree, and a record with a Linear issue but no Asana task looks
 * identical to a record whose Asana call failed.
 */
describe('isFanoutStage', () => {
  it.each(['outline', 'drafting', 'editing', 'review', 'published'])(
    '%s is at or past the threshold', stage => {
      expect(isFanoutStage(stage)).toBe(true);
    });

  // Rule 1: the vault is the idea stage, and an idea never fans out.
  it('idea is below the threshold', () => {
    expect(isFanoutStage('idea')).toBe(false);
  });

  // Archived is not "later than Outline" — it is off to the side. Opening a
  // Linear issue for work that arrived dead is noise, not tracking.
  it('archived is outside the threshold rather than past it', () => {
    expect(isFanoutStage('archived')).toBe(false);
  });

  it('an unknown or missing stage never fans out', () => {
    expect(isFanoutStage(undefined)).toBe(false);
    expect(isFanoutStage('identified')).toBe(false);
    expect(isFanoutStage('')).toBe(false);
  });

  // Every stage named must be a real ContentStage. A typo here would silently
  // disable the fan-out for that stage with no type error at the call site,
  // because isFanoutStage takes a plain string.
  it('names only stages the content pipeline actually has', () => {
    for (const stage of FANOUT_STAGES) {
      expect(Object.keys(CONTENT_STAGE_TO_LINEAR_STATE)).toContain(stage);
    }
  });
});
