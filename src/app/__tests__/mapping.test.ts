import { describe, it, expect } from 'vitest';
import {
  LINEAR_STATE_TO_CONTENT_STAGE,
  LINEAR_STATE_TO_CHANGELOG_STAGE,
  CONTENT_STAGE_TO_LINEAR_STATE,
  CHANGELOG_STAGE_TO_LINEAR_STATE,
  LINEAR_CHANGELOG_LABEL,
} from '@lib/mapping';

describe('LINEAR_STATE_TO_CONTENT_STAGE', () => {
  it('maps "Done" to "published"', () =>
    expect(LINEAR_STATE_TO_CONTENT_STAGE['Done']).toBe('published'));
  it('maps "In Progress" to "drafting"', () =>
    expect(LINEAR_STATE_TO_CONTENT_STAGE['In Progress']).toBe('drafting'));
  it('maps "Backlog" to "idea"', () =>
    expect(LINEAR_STATE_TO_CONTENT_STAGE['Backlog']).toBe('idea'));
  it('maps "Cancelled" to "archived"', () =>
    expect(LINEAR_STATE_TO_CONTENT_STAGE['Cancelled']).toBe('archived'));
});

describe('CONTENT_STAGE_TO_LINEAR_STATE', () => {
  it('maps "published" to "Done"', () =>
    expect(CONTENT_STAGE_TO_LINEAR_STATE['published']).toBe('Done'));
  it('maps "editing" to "In Progress" (same bucket as drafting)', () =>
    expect(CONTENT_STAGE_TO_LINEAR_STATE['editing']).toBe('In Progress'));
  it('maps "archived" to "Cancelled"', () =>
    expect(CONTENT_STAGE_TO_LINEAR_STATE['archived']).toBe('Cancelled'));
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
