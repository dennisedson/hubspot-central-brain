/**
 * The content_piece / video association definitions the app needs, and the
 * idempotent logic that creates them.
 *
 * WHY THIS EXISTS (issue #3)
 * -------------------------
 * `provision-objects.ts` creates both custom objects with
 * `associatedObjects: ['CONTACT', 'COMPANY']` and nothing else. The
 * `associate_related_content` workflow action then calls
 *
 *     PUT /crm/v4/objects/{typeId}/{fromId}/associations/default/{typeId}/{toId}
 *
 * with the SAME objectTypeId on both sides (see `AssociateRelatedContent.ts` —
 * it associates content to content, or video to video, never across types).
 * With no definition between those two types the call 4xxs every time, so the
 * action can never create an association.
 *
 * TWO CREATION ROUTES, ON PURPOSE
 * -------------------------------
 * Cross-type pairings (content_piece -> video) go through
 * `POST /crm/v3/schemas/{objectType}/associations`. That is the post-creation
 * equivalent of `associatedObjects` and it creates the *unlabeled* definition,
 * which is exactly what the `…/associations/default/…` call needs.
 *
 * Same-type pairings (content_piece -> content_piece, video -> video) cannot
 * use that endpoint: it rejects `fromObjectTypeId === toObjectTypeId` with
 * `ObjectSchemaError.CANNOT_ASSOCIATE_OBJECT_TYPE_WITH_ITSELF`. The only
 * remaining route is `POST /crm/v4/associations/{type}/{type}/labels`, which
 * creates a labeled definition.
 *
 * SELF-REFERENTIAL SUPPORT IS NOT CONFIRMED
 * -----------------------------------------
 * HubSpot documents same-object associations for STANDARD objects (contact to
 * contact, company to company) and its own docs list "contacts and contacts" as
 * a valid pairing for labels. It documents nothing either way about a CUSTOM
 * object paired with itself, and the schema endpoint's dedicated
 * CANNOT_ASSOCIATE_OBJECT_TYPE_WITH_ITSELF error is evidence of a deliberate
 * block at the object-schema layer. So `ensureAssociationDefinitions` ATTEMPTS
 * the self-referential pairings and reports precisely what the portal said —
 * it does not assume they succeed.
 *
 * Even when the label POST succeeds, a labeled definition is not automatically
 * the unlabeled one. That is why every pairing is re-read afterwards and
 * classified: `defined-unlabeled` means the workflow action will work,
 * `defined-labeled-only` means it still will not.
 *
 * Kept free of `loadEnv()` and of any top-level side effect so the planning and
 * request-building can be unit tested without a portal.
 */

import {
  HS_BASE,
  associationLabelsPath,
  schemaAssociationsPath,
} from '../app/lib/hs-api';
import type { PortalConfig } from '../app/lib/portal-config';

/** One association definition the app requires between two object types. */
export interface AssociationPairing {
  /** Stable identifier used in logs and tests. */
  key: string;
  fromObjectTypeId: string;
  toObjectTypeId: string;
  /** Internal name of the definition. Lowercase, snake_case, unique per portal. */
  name: string;
  /** Label shown in HubSpot. Only used on the labels route. */
  label: string;
  /** Human description used in log lines. */
  description: string;
}

/** What a pairing looks like in the portal right now. */
export type PairingState =
  /** No association definition of any kind between the two types. */
  | 'undefined'
  /** A definition exists and includes the unlabeled type — default associations work. */
  | 'defined-unlabeled'
  /** A definition exists but only with labels — `…/associations/default/…` will still fail. */
  | 'defined-labeled-only';

export type PairingAction = 'create' | 'skip';

export interface HsRequest {
  method: string;
  url: string;
  body?: Record<string, string>;
}

/** One entry of the `GET …/labels` response. */
export interface AssociationTypeSpec {
  typeId?: number;
  category?: string;
  label?: string | null;
}

export interface AssociationLabelsResponse {
  results?: AssociationTypeSpec[];
}

export interface EnsureResult {
  pairing: AssociationPairing;
  /** What the run did. `failed` never throws — every pairing is attempted. */
  outcome: 'created' | 'skipped' | 'failed';
  /** State after the run. `null` when the state could not be read. */
  state: PairingState | null;
  detail: string;
}

/** HubSpot's rejection of a schema-level association from a type to itself. */
export const SELF_ASSOCIATION_REJECTION = 'CANNOT_ASSOCIATE_OBJECT_TYPE_WITH_ITSELF';

/**
 * The three definitions the app needs.
 *
 * `AssociateRelatedContent` only ever associates a record to another record of
 * the SAME type, so the two self-referential pairings are the ones that unblock
 * it. `content_piece -> video` is the cross-type pairing nothing calls today;
 * it is created because it is the only one of the three whose creation route is
 * certain to work, which makes a run that fails on the other two easy to read.
 */
export function associationPairingsFor(
  content: string,
  video: string,
): AssociationPairing[] {
  return [
    {
      key: 'content_to_content',
      fromObjectTypeId: content,
      toObjectTypeId: content,
      name: 'content_piece_to_content_piece',
      label: 'Related Content',
      description: 'Content Piece ↔ Content Piece',
    },
    {
      key: 'content_to_video',
      fromObjectTypeId: content,
      toObjectTypeId: video,
      name: 'content_piece_to_video',
      label: 'Related Video',
      description: 'Content Piece ↔ Video',
    },
    {
      key: 'video_to_video',
      fromObjectTypeId: video,
      toObjectTypeId: video,
      name: 'video_to_video',
      label: 'Related Video',
      description: 'Video ↔ Video',
    },
  ];
}

/** `associationPairingsFor` keyed off an already-provisioned portal's config. */
export function requiredAssociationPairings(config: PortalConfig): AssociationPairing[] {
  return associationPairingsFor(config.content.objectTypeId, config.video.objectTypeId);
}

/** True when both sides of the pairing are the same object type. */
export function isSelfReferential(pairing: AssociationPairing): boolean {
  return pairing.fromObjectTypeId === pairing.toObjectTypeId;
}

/** The GET that answers "does a definition already exist for this pairing?". */
export function existingDefinitionsRequest(pairing: AssociationPairing): HsRequest {
  return {
    method: 'GET',
    url: `${HS_BASE}${associationLabelsPath(pairing.fromObjectTypeId, pairing.toObjectTypeId)}`,
  };
}

/**
 * The POST that creates the definition.
 *
 * Self-referential pairings take the v4 labels route with `label` only and no
 * `inverseLabel`: the relationship is symmetric, and HubSpot 500s when `label`
 * and `inverseLabel` are the same string.
 */
export function definitionRequest(pairing: AssociationPairing): HsRequest {
  if (isSelfReferential(pairing)) {
    return {
      method: 'POST',
      url: `${HS_BASE}${associationLabelsPath(pairing.fromObjectTypeId, pairing.toObjectTypeId)}`,
      body: { name: pairing.name, label: pairing.label },
    };
  }

  return {
    method: 'POST',
    url: `${HS_BASE}${schemaAssociationsPath(pairing.fromObjectTypeId)}`,
    body: {
      fromObjectTypeId: pairing.fromObjectTypeId,
      toObjectTypeId: pairing.toObjectTypeId,
      name: pairing.name,
    },
  };
}

/**
 * Classify a `GET …/labels` payload.
 *
 * `null` stands for a 404 — the pairing has no definition, same as an empty
 * `results`. The unlabeled type is the one HubSpot returns with `label: null`.
 */
export function classifyExisting(payload: AssociationLabelsResponse | null): PairingState {
  const results = payload?.results ?? [];
  if (results.length === 0) return 'undefined';
  return results.some(type => type.label === null || type.label === undefined)
    ? 'defined-unlabeled'
    : 'defined-labeled-only';
}

/**
 * The idempotency decision. Anything already defined is left alone — re-running
 * must never duplicate or clobber a definition, including one an admin created
 * by hand in the data model builder.
 */
export function planFor(state: PairingState): PairingAction {
  return state === 'undefined' ? 'create' : 'skip';
}

interface RawResponse {
  ok: boolean;
  status: number;
  text: string;
}

async function send(token: string, request: HsRequest): Promise<RawResponse> {
  const res = await fetch(request.url, {
    method: request.method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    ...(request.body ? { body: JSON.stringify(request.body) } : {}),
  });
  return { ok: res.ok, status: res.status, text: await res.text() };
}

/** A 404 means "no definition for this pairing", not "something went wrong". */
async function readState(
  token: string,
  pairing: AssociationPairing,
): Promise<{ state: PairingState; raw: string }> {
  const res = await send(token, existingDefinitionsRequest(pairing));
  if (res.status === 404) return { state: 'undefined', raw: res.text };
  if (!res.ok) throw new Error(`GET labels → ${res.status}: ${res.text}`);

  const payload = res.text
    ? (JSON.parse(res.text) as AssociationLabelsResponse)
    : {};
  return { state: classifyExisting(payload), raw: res.text };
}

function alreadyExists(res: RawResponse): boolean {
  return (
    res.status === 409 ||
    res.text.includes('already exists') ||
    res.text.includes('ALREADY_EXISTS') ||
    res.text.includes('DUPLICATE')
  );
}

/**
 * Create every missing definition. Never throws for a single pairing — a
 * rejected self-referential pairing must not stop the cross-type one from being
 * created, and the caller needs the full picture to report.
 */
export async function ensureAssociationDefinitions(
  token: string,
  pairings: AssociationPairing[],
): Promise<EnsureResult[]> {
  const results: EnsureResult[] = [];

  for (const pairing of pairings) {
    try {
      const before = await readState(token, pairing);

      if (planFor(before.state) === 'skip') {
        results.push({
          pairing,
          outcome: 'skipped',
          state: before.state,
          detail: 'definition already exists',
        });
        continue;
      }

      const res = await send(token, definitionRequest(pairing));

      if (!res.ok && !alreadyExists(res)) {
        results.push({
          pairing,
          outcome: 'failed',
          state: null,
          detail: res.text.includes(SELF_ASSOCIATION_REJECTION)
            ? `HubSpot refuses to associate ${pairing.fromObjectTypeId} with itself (${SELF_ASSOCIATION_REJECTION})`
            : `${res.status}: ${res.text}`,
        });
        continue;
      }

      // Re-read: a successful label POST does not guarantee the unlabeled type
      // the workflow action depends on.
      const after = await readState(token, pairing);
      results.push({
        pairing,
        outcome: alreadyExists(res) ? 'skipped' : 'created',
        state: after.state,
        detail: alreadyExists(res) ? 'definition already exists' : 'definition created',
      });
    } catch (err: unknown) {
      results.push({
        pairing,
        outcome: 'failed',
        state: null,
        detail: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return results;
}

/** Pairings that will still break `AssociateRelatedContent`. */
export function unusablePairings(results: EnsureResult[]): EnsureResult[] {
  return results.filter(r => r.state !== 'defined-unlabeled');
}
