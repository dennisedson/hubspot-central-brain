/**
 * The self-referential association definitions the Related Content feature
 * associates through, and the runtime lookup that turns one into a typeId.
 *
 * WHY THIS EXISTS (issue #3)
 * --------------------------
 * `AssociateRelatedContent` associates a record to another record of the SAME
 * custom object type — content to content, video to video. That works, but only
 * through a LABELED association:
 *
 *     PUT /crm/objects/2026-03/{type}/{fromId}/associations/{type}/{toId}
 *     [{ "associationCategory": "USER_DEFINED", "associationTypeId": 99 }]
 *
 * There is no unlabeled/default definition between a custom object and itself,
 * so `PUT …/associations/default/…` answers
 * `A default association between ObjectTypeId{…} and ObjectTypeId{…same…} does
 * not exist` and can never be made to work.
 *
 * THE NAME COLLISION
 * ------------------
 * `POST /crm/associations/2026-03/{type}/{type}/labels` rejects the obvious name:
 *
 *     name: "content_piece_to_content_piece"
 *     -> 400 Association definition name 'content_piece_to_content_piece'
 *        conflicts with unlabeled association name
 *        'content_piece_to_content_piece' (case-insensitive match)
 *
 * HubSpot reserves the `{a}_to_{a}` form for the unlabeled association it names
 * itself. Every definition this app creates therefore carries a distinct
 * `cb_`-prefixed name — see `collidesWithUnlabeledName`, which is asserted
 * against every generated name so the collision cannot come back.
 *
 * typeIds ARE PER-PORTAL
 * ----------------------
 * "Related Content" is typeId 99 on the dev portal. It will be a different
 * number on staging and prod. Nothing here hardcodes one: callers read
 * `GET /crm/associations/2026-03/{type}/{type}/labels` and match on the name/label
 * they provisioned, which is exactly what `findAssociationTypeId` does.
 *
 * Pure and I/O-free so both the app function and the provisioning script can
 * share it, and so it can be unit tested without a portal.
 */

/** The identity of one association definition, as provisioned and as read back. */
export interface AssociationLabelSpec {
  /** Internal name sent on the labels POST. Never the `{a}_to_{a}` form. */
  name: string;
  /** Label shown in HubSpot, and what the labels GET echoes back. */
  label: string;
}

/** The category every association definition this app creates comes back under. */
export const USER_DEFINED = 'USER_DEFINED';

/** content_piece ↔ content_piece. */
export const RELATED_CONTENT_LABEL: AssociationLabelSpec = {
  name: 'cb_related_content',
  label: 'Related Content',
};

/** video ↔ video. */
export const RELATED_VIDEO_LABEL: AssociationLabelSpec = {
  name: 'cb_related_video',
  label: 'Related Video',
};

/**
 * The label each object type associates to itself through, keyed the same way
 * `AssociateRelatedContent` keys its property map.
 */
export const SELF_ASSOCIATION_LABELS: Record<'content' | 'video', AssociationLabelSpec> = {
  content: RELATED_CONTENT_LABEL,
  video: RELATED_VIDEO_LABEL,
};

/** One entry of a `GET /crm/associations/2026-03/{from}/{to}/labels` response. */
export interface AssociationTypeSpec {
  typeId?: number;
  category?: string;
  /** `null` on the unlabeled definition and on the paired inverse. */
  label?: string | null;
  /** Not every HubSpot response carries this, which is why label is matched first. */
  name?: string;
}

export interface AssociationLabelsResponse {
  results?: AssociationTypeSpec[];
}

/**
 * True for the `{a}_to_{a}` name HubSpot reserves for the unlabeled association
 * between a type and itself. Sending one to the labels endpoint is a hard 400.
 */
export function collidesWithUnlabeledName(name: string): boolean {
  const sides = name.split('_to_');
  return sides.length === 2 && sides[0].length > 0 && sides[0] === sides[1];
}

function sameText(value: string | null | undefined, expected: string): boolean {
  return typeof value === 'string' && value.trim().toLowerCase() === expected.trim().toLowerCase();
}

/**
 * The typeId to PUT with, or `null` when the portal has not been provisioned.
 *
 * Only LABELED entries are candidates. A self-referential definition comes back
 * as a pair — the forward type carrying the label, and an inverse carrying
 * `label: null` — and associating through the inverse would point the
 * relationship the wrong way, so a null label is never selected. `label` is
 * matched before `name` because `label` is the field the endpoint always
 * returns.
 */
export function findAssociationTypeId(
  payload: AssociationLabelsResponse | null | undefined,
  spec: AssociationLabelSpec,
): number | null {
  const labeled = (payload?.results ?? []).filter(
    (type): type is AssociationTypeSpec & { typeId: number } =>
      typeof type.typeId === 'number' && typeof type.label === 'string' && type.label.length > 0,
  );

  const byLabel = labeled.find(type => sameText(type.label, spec.label));
  if (byLabel) return byLabel.typeId;

  const byName = labeled.find(type => sameText(type.name, spec.name));
  return byName ? byName.typeId : null;
}

/** The body of a labeled association PUT. Verified against the dev portal (201). */
export function labeledAssociationBody(
  associationTypeId: number,
): Array<{ associationCategory: string; associationTypeId: number }> {
  return [{ associationCategory: USER_DEFINED, associationTypeId }];
}
