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
 * MIGRATION STATE
 * ---------------
 * Everything is on dated paths EXCEPT schemas. Verified 2026-09-03 by calling
 * both surfaces against a live portal and diffing the response shapes:
 *
 *     objects       /crm/objects/2026-03/{type}            list/single/search/batch  200, identical
 *     associations  /crm/objects/2026-03/{t}/{id}/associations/{t}   GET 200, PUT 201, DELETE 204
 *     assoc labels  /crm/associations/2026-03/{a}/{b}/labels          200, identical
 *     properties    /crm/properties/2026-03/{type}                    200, identical
 *     pipelines     /crm/pipelines/2026-03/{type}                     200, identical
 *     schemas       NO DATED EQUIVALENT — /crm/schemas/2026-03,
 *                   /crm/schemas/2026-03/{type} and
 *                   /crm/custom-objects/2026-03/schemas all return 404
 *
 * Note associations hang off the OBJECTS family, not the associations one:
 * `/crm/v4/objects/{t}/{id}/associations/{t}` became
 * `/crm/objects/2026-03/{t}/{id}/associations/{t}`. The `/crm/associations/`
 * family covers label definitions only. Guessing that from the v4 shape would
 * have been wrong, which is why each family was probed rather than inferred.
 *
 * MIGRATING THE REST
 * ------------------
 * Change the family's prefix constant below, update the matching expectations
 * in `src/app/__tests__/hs-api.test.ts`, and every call site moves with it.
 * The objects flip on 2026-09-02 was one line; it moved 20 call sites and
 * failed 56 URL assertions, each naming its old and new string. The remaining
 * families moved the same way on 2026-09-03, producing 43 more.
 *
 * Do NOT flip a family on the strength of the pattern alone. Call both
 * surfaces first and diff the responses — a dated version is a new API
 * version, so response shapes can change, and CI cannot catch it because
 * these functions deploy without ever calling the API.
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

/** MIGRATED 2026-09-02. Verified live: list, single, search, batch/read all
 *  return identical response shapes on v3 and dated. */
const OBJECTS_V3 = OBJECTS_DATED;

/** MIGRATED 2026-09-03. Associations hang off the OBJECTS family, not the
 *  associations one. Verified live: GET 200 with identical shape, PUT 201,
 *  DELETE 204 on `/crm/objects/2026-03/{type}/{id}/associations/{type}`. */
const ASSOCIATION_OBJECTS_V4 = OBJECTS_DATED;

/** MIGRATED 2026-09-03. Verified live: labels GET returns identical shape. */
const ASSOCIATIONS_V4 = `/crm/associations/${HS_API_VERSION}`;

/** MIGRATED 2026-09-03. Verified live: identical shape on both surfaces. */
const PROPERTIES_V3 = `/crm/properties/${HS_API_VERSION}`;

/** STILL LEGACY — no dated equivalent exists yet. Verified 2026-09-03: all of
 *  /crm/schemas/2026-03, /crm/schemas/2026-03/{type} and
 *  /crm/custom-objects/2026-03/schemas return 404. Recheck on a later version. */
// LEGACY v3 — migrate to dated per issue #14
const SCHEMAS_V3 = '/crm/v3/schemas';

/** MIGRATED 2026-09-03. Verified live: identical shape on both surfaces. */
const PIPELINES_V3 = `/crm/pipelines/${HS_API_VERSION}`;

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

/**
 * Create a *labeled* association between two records (PUT).
 *
 * The body is an array of association types:
 *
 *     [{ "associationCategory": "USER_DEFINED", "associationTypeId": 99 }]
 *
 * Unlike `defaultAssociationPath` this needs no unlabeled definition — only a
 * labeled one, which is the single route that works for a custom object paired
 * with itself. typeIds are PER-PORTAL: read them from `associationLabelsPath`
 * at runtime, never hardcode one.
 */
// LEGACY v4 — migrate to dated per issue #14
export function labeledAssociationPath(
  fromObjectType: string,
  fromId: string,
  toObjectType: string,
  toId: string,
): string {
  return `${ASSOCIATION_OBJECTS_V4}/${fromObjectType}/${fromId}/associations/${toObjectType}/${toId}`;
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
 * GET lists every defined type for the pairing with its `typeId`, which is how
 * `labeledAssociationPath` callers discover the id to send. An empty `results`
 * array means no association definition exists between the two types at all.
 *
 * POST creates a labeled definition — `{ name, label }` for a symmetric label,
 * plus `inverseLabel` for a paired one. `label` and `inverseLabel` must differ;
 * sending the same string for both makes HubSpot 500.
 *
 * `name` must NOT be the `{a}_to_{a}` form HubSpot generates for the unlabeled
 * association: it is rejected as `conflicts with unlabeled association name`
 * (case-insensitive). See `related-content-associations.ts`.
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
 * `ObjectSchemaError.CANNOT_ASSOCIATE_OBJECT_TYPE_WITH_ITSELF`. That is a limit
 * of THIS endpoint only — a custom object can be associated with itself, via a
 * labeled definition created through `associationLabelsPath`.
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
