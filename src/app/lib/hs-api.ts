/**
 * Single source of truth for the HubSpot API host, API version and every CRM
 * path this app builds.
 *
 * WHY THIS EXISTS (issue #14)
 * ---------------------------
 * HubSpot is retiring the non-date-based API versions (`/crm/v3/`, `/crm/v4/`)
 * in favour of dated ones (`/crm/objects/2026-03/...`). Version `2026-09` lands
 * shortly after `2026-03`. With version strings scattered across call sites,
 * every bump was an N-file change; here it is a one-line change per family.
 *
 * TWO FAMILIES LIVE HERE, ON PURPOSE
 * ----------------------------------
 * 1. LEGACY builders (`objectPath`, `propertiesPath`, `schemasPath`,
 *    `pipelinesPath`, the association builders) still emit `/crm/v3/` and
 *    `/crm/v4/` because that is exactly what the portal is called with today.
 *    Each is tagged `migrate to dated per issue #14` — grep that phrase to find
 *    everything still awaiting migration.
 * 2. DATED builders (`datedObjectPath`, `datedObjectSearchPath`) emit
 *    `/crm/objects/${HS_API_VERSION}/...`. The Fellow → Projects sync already
 *    runs on these.
 *
 * MIGRATING A FAMILY
 * ------------------
 * Change the family's prefix constant below to the dated shape, update the
 * matching expectation in `src/app/__tests__/hs-api.test.ts`, and every call
 * site moves with it. Moving the whole CRM objects family is exactly:
 *
 *     const OBJECTS_V3 = '/crm/v3/objects';  ->  const OBJECTS_V3 = OBJECTS_DATED;
 *
 * The test file is the checklist: a builder cannot be flipped without its
 * assertion failing first, which is what makes the blast radius visible.
 *
 * ENCODING CONTRACT — IMPORTANT
 * -----------------------------
 * These builders perform NO percent-encoding. They interpolate their arguments
 * verbatim. Call sites that need `encodeURIComponent` keep doing it themselves,
 * at the call site, exactly as before. This is deliberate: encoding inside the
 * builders would silently change the URLs of the call sites that do not encode
 * today.
 *
 * Builders return a PATH (leading slash, no host). Compose with `HS_BASE`, and
 * append any query string at the call site:
 *
 *   fetch(`${HS_BASE}${objectPath(typeId, id)}?properties=${props.join(',')}`)
 */

/** API host. Every HubSpot request in this app goes here. */
export const HS_BASE = 'https://api.hubapi.com';

/**
 * The dated API version. Used ONLY by the `dated*` builders below — legacy
 * builders intentionally do not reference it until their family is migrated.
 */
export const HS_API_VERSION = '2026-03';

// ---------------------------------------------------------------------------
// FAMILY PREFIXES — the migration surface
//
// Every builder below is composed from one of these. Moving a whole family off
// a non-date-based version is a ONE-LINE change to its prefix here; the
// builders, and therefore all 34 call sites, follow automatically. The
// assertions in `src/app/__tests__/hs-api.test.ts` are what tell you the flip
// landed and which family moved.
// ---------------------------------------------------------------------------

/** Dated prefix. Already in production for the Fellow -> Projects sync. */
const OBJECTS_DATED = `/crm/objects/${HS_API_VERSION}`;

/** To migrate the CRM objects family: change this to `OBJECTS_DATED`. */
// LEGACY v3 — migrate to dated per issue #14
const OBJECTS_V3 = '/crm/v3/objects';

// LEGACY v4 — migrate to dated per issue #14
const ASSOCIATION_OBJECTS_V4 = '/crm/v4/objects';

// LEGACY v4 — migrate to dated per issue #14
const ASSOCIATIONS_V4 = '/crm/v4/associations';

// LEGACY v3 — migrate to dated per issue #14
const PROPERTIES_V3 = '/crm/v3/properties';

// LEGACY v3 — migrate to dated per issue #14
const SCHEMAS_V3 = '/crm/v3/schemas';

// LEGACY v3 — migrate to dated per issue #14
const PIPELINES_V3 = '/crm/v3/pipelines';

// ---------------------------------------------------------------------------
// CRM objects
// ---------------------------------------------------------------------------

/**
 * A CRM object collection (`id` omitted) or a single record (`id` given).
 *
 * `objectType` is a standard object name (`contacts`) or a custom objectTypeId
 * (`2-67505887`).
 */
// LEGACY v3 — migrate to dated per issue #14
export function objectPath(objectType: string, id?: string): string {
  return id === undefined
    ? `${OBJECTS_V3}/${objectType}`
    : `${OBJECTS_V3}/${objectType}/${id}`;
}

/** CRM search endpoint for an object type (POST). */
// LEGACY v3 — migrate to dated per issue #14
export function objectSearchPath(objectType: string): string {
  return `${OBJECTS_V3}/${objectType}/search`;
}

/** Read many records of one object type by id in a single call (POST). */
// LEGACY v3 — migrate to dated per issue #14
export function objectBatchReadPath(objectType: string): string {
  return `${OBJECTS_V3}/${objectType}/batch/read`;
}

// ---------------------------------------------------------------------------
// Associations (v4)
// ---------------------------------------------------------------------------

/**
 * List the records of `toObjectType` associated with one record (GET).
 * Responds with `{ results: [{ toObjectId, associationTypes }] }`.
 */
// LEGACY v4 — migrate to dated per issue #14
export function associationListPath(
  fromObjectType: string,
  fromId: string,
  toObjectType: string,
): string {
  return `${ASSOCIATION_OBJECTS_V4}/${fromObjectType}/${fromId}/associations/${toObjectType}`;
}

/**
 * Create the *default* (unlabeled) association between two records (PUT).
 * Requires a default association definition to exist between the two types.
 */
// LEGACY v4 — migrate to dated per issue #14
export function defaultAssociationPath(
  fromObjectType: string,
  fromId: string,
  toObjectType: string,
  toId: string,
): string {
  return `${ASSOCIATION_OBJECTS_V4}/${fromObjectType}/${fromId}/associations/default/${toObjectType}/${toId}`;
}

/** Create associations in bulk between two object types (POST). */
// LEGACY v4 — migrate to dated per issue #14
export function associationBatchCreatePath(
  fromObjectType: string,
  toObjectType: string,
): string {
  return `${ASSOCIATIONS_V4}/${fromObjectType}/${toObjectType}/batch/create`;
}

/**
 * The association *definitions* (a.k.a. types/labels) between two object types.
 *
 * GET lists every defined type for the pairing, including the unlabeled one
 * (`label: null`) that `defaultAssociationPath` needs. An empty `results` array
 * means no association definition exists between the two types at all.
 *
 * POST creates a labeled definition — `{ name, label }` for a symmetric label,
 * plus `inverseLabel` for a paired one. `label` and `inverseLabel` must differ;
 * sending the same string for both makes HubSpot 500.
 */
// LEGACY v4 — migrate to dated per issue #14
export function associationLabelsPath(
  fromObjectType: string,
  toObjectType: string,
): string {
  return `${ASSOCIATIONS_V4}/${fromObjectType}/${toObjectType}/labels`;
}

// ---------------------------------------------------------------------------
// Schema / properties / pipelines
// ---------------------------------------------------------------------------

/**
 * The property collection for an object type (`propertyName` omitted) or a
 * single property definition (`propertyName` given).
 */
// LEGACY v3 — migrate to dated per issue #14
export function propertiesPath(objectType: string, propertyName?: string): string {
  return propertyName === undefined
    ? `${PROPERTIES_V3}/${objectType}`
    : `${PROPERTIES_V3}/${objectType}/${propertyName}`;
}

/** All custom object schemas in the portal. Callers append `?limit=…`. */
// LEGACY v3 — migrate to dated per issue #14
export function schemasPath(): string {
  return SCHEMAS_V3;
}

/**
 * The association definitions declared on one schema (POST to add one).
 *
 * This is the post-creation equivalent of the `associatedObjects` field on
 * `POST /crm/v3/schemas`: the body is `{ fromObjectTypeId, toObjectTypeId, name }`
 * and it creates the *unlabeled* definition, which is what
 * `defaultAssociationPath` requires.
 *
 * It rejects `fromObjectTypeId === toObjectTypeId` with
 * `ObjectSchemaError.CANNOT_ASSOCIATE_OBJECT_TYPE_WITH_ITSELF`, so
 * same-object-type pairings have to go through `associationLabelsPath` instead.
 */
// LEGACY v3 — migrate to dated per issue #14
export function schemaAssociationsPath(objectType: string): string {
  return `${SCHEMAS_V3}/${objectType}/associations`;
}

/**
 * Every pipeline for an object type (`pipelineId` omitted) or one pipeline
 * with its stages (`pipelineId` given).
 */
// LEGACY v3 — migrate to dated per issue #14
export function pipelinesPath(objectType: string, pipelineId?: string): string {
  return pipelineId === undefined
    ? `${PIPELINES_V3}/${objectType}`
    : `${PIPELINES_V3}/${objectType}/${pipelineId}`;
}

// ---------------------------------------------------------------------------
// Dated API — already migrated (Fellow → Projects sync)
// ---------------------------------------------------------------------------

/**
 * Dated equivalent of `objectPath`. This is the shape the legacy builders above
 * are heading toward.
 */
export function datedObjectPath(objectType: string, id?: string): string {
  return id === undefined
    ? `${OBJECTS_DATED}/${objectType}`
    : `${OBJECTS_DATED}/${objectType}/${id}`;
}

/** Dated equivalent of `objectSearchPath`. */
export function datedObjectSearchPath(objectType: string): string {
  return `${OBJECTS_DATED}/${objectType}/search`;
}
