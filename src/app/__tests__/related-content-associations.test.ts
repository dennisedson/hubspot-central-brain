import { describe, it, expect } from 'vitest';
import {
  RELATED_CONTENT_LABEL,
  RELATED_VIDEO_LABEL,
  SELF_ASSOCIATION_LABELS,
  USER_DEFINED,
  collidesWithUnlabeledName,
  findAssociationTypeId,
  labeledAssociationBody,
} from '../lib/related-content-associations';

/**
 * Issue #3. Two things are pinned here and neither is negotiable:
 *
 * 1. The definition names must never take the `{a}_to_{a}` form. HubSpot
 *    reserves it for the unlabeled association and answers the labels POST with
 *    `conflicts with unlabeled association name … (case-insensitive match)`.
 *    That 400 is the original bug.
 * 2. The typeId is READ, never written down. 99 is the dev portal's number for
 *    "Related Content" and means nothing on staging or prod.
 */

describe('collidesWithUnlabeledName', () => {
  it('flags the auto-generated self-referential name HubSpot reserves', () => {
    expect(collidesWithUnlabeledName('content_piece_to_content_piece')).toBe(true);
    expect(collidesWithUnlabeledName('video_to_video')).toBe(true);
  });

  it('does not flag a cross-type name — the two sides differ', () => {
    expect(collidesWithUnlabeledName('content_piece_to_video')).toBe(false);
  });

  it('does not flag a name with no `_to_` separator at all', () => {
    expect(collidesWithUnlabeledName('cb_related_content')).toBe(false);
  });
});

describe('the provisioned label specs', () => {
  it('never uses a name that collides with the unlabeled association (regression)', () => {
    // This is the exact 400 that made issue #3 unfixable:
    //   Association definition name 'content_piece_to_content_piece' conflicts
    //   with unlabeled association name 'content_piece_to_content_piece'
    for (const spec of Object.values(SELF_ASSOCIATION_LABELS)) {
      expect(collidesWithUnlabeledName(spec.name)).toBe(false);
    }
  });

  it('names both self-referential definitions distinctly and in snake_case', () => {
    expect(RELATED_CONTENT_LABEL).toEqual({ name: 'cb_related_content', label: 'Related Content' });
    expect(RELATED_VIDEO_LABEL).toEqual({ name: 'cb_related_video', label: 'Related Video' });
    expect(RELATED_CONTENT_LABEL.name).not.toBe(RELATED_VIDEO_LABEL.name);
    expect(RELATED_CONTENT_LABEL.name).toMatch(/^[a-z][a-z0-9_]*$/);
    expect(RELATED_VIDEO_LABEL.name).toMatch(/^[a-z][a-z0-9_]*$/);
  });

  it('is keyed by the objectType AssociateRelatedContent accepts', () => {
    expect(SELF_ASSOCIATION_LABELS.content).toBe(RELATED_CONTENT_LABEL);
    expect(SELF_ASSOCIATION_LABELS.video).toBe(RELATED_VIDEO_LABEL);
  });
});

/** The dev portal's real answer: typeId 99 labeled, plus its unlabeled inverse. */
const DEV_LABELS = {
  results: [
    { category: 'USER_DEFINED', typeId: 99, label: 'Related Content' },
    { category: 'USER_DEFINED', typeId: 100, label: null },
  ],
};

describe('findAssociationTypeId', () => {
  it('returns the typeId of the matching label', () => {
    expect(findAssociationTypeId(DEV_LABELS, RELATED_CONTENT_LABEL)).toBe(99);
  });

  it('never returns the paired inverse, which carries a null label', () => {
    // typeId 100 would point the relationship the wrong way.
    expect(findAssociationTypeId(DEV_LABELS, RELATED_CONTENT_LABEL)).not.toBe(100);
  });

  it('ignores the unlabeled type even when it is the only one defined', () => {
    expect(findAssociationTypeId({ results: [{ typeId: 1, label: null }] }, RELATED_CONTENT_LABEL))
      .toBeNull();
    expect(findAssociationTypeId({ results: [{ typeId: 1 }] }, RELATED_CONTENT_LABEL)).toBeNull();
  });

  it('matches the label case-insensitively and ignores surrounding whitespace', () => {
    expect(findAssociationTypeId(
      { results: [{ typeId: 42, label: '  related CONTENT ' }] },
      RELATED_CONTENT_LABEL,
    )).toBe(42);
  });

  it('falls back to the internal name when the portal returns one', () => {
    expect(findAssociationTypeId(
      { results: [{ typeId: 7, name: 'cb_related_video', label: 'Renamed by an admin' }] },
      RELATED_VIDEO_LABEL,
    )).toBe(7);
  });

  it('prefers the label match over a name match on a different type', () => {
    expect(findAssociationTypeId(
      {
        results: [
          { typeId: 7, name: 'cb_related_content', label: 'Something else' },
          { typeId: 99, label: 'Related Content' },
        ],
      },
      RELATED_CONTENT_LABEL,
    )).toBe(99);
  });

  it('returns null for an unprovisioned portal', () => {
    expect(findAssociationTypeId({ results: [] }, RELATED_CONTENT_LABEL)).toBeNull();
    expect(findAssociationTypeId({}, RELATED_CONTENT_LABEL)).toBeNull();
    expect(findAssociationTypeId(null, RELATED_CONTENT_LABEL)).toBeNull();
    expect(findAssociationTypeId(undefined, RELATED_CONTENT_LABEL)).toBeNull();
  });

  it('returns null when the label belongs to a different pairing', () => {
    expect(findAssociationTypeId(DEV_LABELS, RELATED_VIDEO_LABEL)).toBeNull();
  });

  it('skips an entry with no usable typeId', () => {
    expect(findAssociationTypeId(
      { results: [{ label: 'Related Content' }] },
      RELATED_CONTENT_LABEL,
    )).toBeNull();
  });
});

describe('labeledAssociationBody', () => {
  it('is the exact array HubSpot answered 201 to', () => {
    expect(labeledAssociationBody(99)).toEqual([
      { associationCategory: 'USER_DEFINED', associationTypeId: 99 },
    ]);
  });

  it('carries whatever typeId it is handed — nothing is hardcoded', () => {
    expect(labeledAssociationBody(41)[0].associationTypeId).toBe(41);
    expect(labeledAssociationBody(41)[0].associationCategory).toBe(USER_DEFINED);
  });
});
