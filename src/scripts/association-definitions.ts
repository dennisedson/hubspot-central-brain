/**
 * The content_piece / video association definitions the app needs, and the
 * idempotent logic that creates them.
 *
 * WHY THIS EXISTS (issue #3)
 * -------------------------
 * `provision-objects.ts` creates both custom objects with
 * `associatedObjects: ['CONTACT', 'COMPANY']` and nothing else. The
 * `associate_related_content` workflow action associates content to content and
 * video to video — same object type on both sides — and with no definition
 * between those two types every association call 4xxs.
 *
 * TWO CREATION ROUTES, ON PURPOSE
 * -------------------------------
 * Self-referential pairings (content ↔ content, video ↔ video) take
 * `POST /crm/v4/associations/{type}/{type}/labels`, which creates a LABELED
 * definition. This works — a custom object can be associated with itself — but
 * only through the label: no unlabeled/default definition exists between a
 * custom object and itself, so `PUT …/associations/default/…` is a dead end and
 * `AssociateRelatedContent` associates by typeId instead.
 *
 * The name must be distinct. `content_piece_to_content_piece` is rejected with
 * `conflicts with unlabeled association name … (case-insensitive match)`, so
 * the definitions are named `cb_related_content` / `cb_related_video` — see
 * `collidesWithUnlabeledName`, which every generated name is checked against.
 *
 * The cross-type pairing (content_piece → video) goes through
 * `POST /crm/v3/schemas/{objectType}/associations`, the post-creation
 * equivalent of `associatedObjects`, which creates the unlabeled definition.
 * That endpoint rejects `fromObjectTypeId === toObjectTypeId`, which is why the
 * self-referential pairings cannot use it.
 *
 * WHAT "PROVISIONED" MEANS PER ROUTE
 * ----------------------------------
 * A labels-route pairing is only provisioned once its OWN label is present, and
 * the run reports that label's typeId — that is the number the workflow action
 * looks up at call time. A schema-route pairing is provisioned as soon as any
 * definition exists between the two types.
 *
 * Kept free of `loadEnv()` and of any top-level side effect so the planning and
 * request-building can be unit tested without a portal.
 */

import {
  HS_BASE,
  associationLabelsPath,
  schemaAssociationsPath,
} from '../app/lib/hs-api';
import {
  RELATED_CONTENT_LABEL,
  RELATED_VIDEO_LABEL,
  findAssociationTypeId,
  type AssociationLabelSpec,
  type AssociationLabelsResponse,
} from '../app/lib/related-content-associations';
import type { PortalConfig } from '../app/lib/portal-config';

export type { AssociationLabelsResponse };

/**
 * How a definition is created, and therefore what counts as provisioned.
 *
 * - `labels` — `POST /crm/v4/associations/{a}/{b}/labels`, a labeled definition
 *   the app associates through by typeId.
 * - `schema` — `POST /crm/v3/schemas/{a}/associations`, the unlabeled one.
 */
export type PairingRoute = 'labels' | 'schema';

/** One association definition the app requires between two object types. */
export interface AssociationPairing {
  /** Stable identifier used in logs and tests. */
  key: string;
  fromObjectTypeId: string;
  toObjectTypeId: string;
  route: PairingRoute;
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
  /** This pairing's own labeled definition exists — its typeId is reported. */
  | 'defined-labeled'
  /** A definition exists, but this pairing's label is not among the types. */
  | 'defined-without-label';

export type PairingAction = 'create' | 'skip';

export interface HsRequest {
  method: string;
  url: string;
  body?: Record<string, string>;
}

/** A pairing's state plus the typeId that state implies. */
export interface PairingStatus {
  state: PairingState;
  /** The labeled definition's typeId, or `null` when it is not defined. */
  typeId: number | null;
}

export interface EnsureResult {
  pairing: AssociationPairing;
  /** What the run did. `failed` never throws — every pairing is attempted. */
  outcome: 'created' | 'skipped' | 'failed';
  /** State after the run. `null` when the state could not be read. */
  state: PairingState | null;
  /** typeId of the labeled definition, when the run could read one. */
  typeId: number | null;
  detail: string;
}

/**
 * HubSpot's rejection of a labels `name` that duplicates the auto-generated
 * unlabeled association name. This is the failure the `cb_`-prefixed names
 * exist to avoid; seeing it means a name regressed to the `{a}_to_{a}` form.
 */
export const UNLABELED_NAME_CONFLICT = 'conflicts with unlabeled association name';

/**
 * The three definitions the app needs.
 *
 * The two self-referential pairings are what `AssociateRelatedContent` actually
 * associates through. `content_piece → video` is the cross-type pairing nothing
 * calls today; it is kept because the data model wants it and because it is the
 * one pairing whose unlabeled definition can be created at all.
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
      route: 'labels',
      name: RELATED_CONTENT_LABEL.name,
      label: RELATED_CONTENT_LABEL.label,
      description: 'Content Piece ↔ Content Piece',
    },
    {
      key: 'content_to_video',
      fromObjectTypeId: content,
      toObjectTypeId: video,
      route: 'schema',
      name: 'content_piece_to_video',
      label: 'Related Video',
      description: 'Content Piece ↔ Video',
    },
    {
      key: 'video_to_video',
      fromObjectTypeId: video,
      toObjectTypeId: video,
      route: 'labels',
      name: RELATED_VIDEO_LABEL.name,
      label: RELATED_VIDEO_LABEL.label,
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

/** The name/label a labels-route pairing is matched by when reading it back. */
export function labelSpecFor(pairing: AssociationPairing): AssociationLabelSpec {
  return { name: pairing.name, label: pairing.label };
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
 * Labels-route pairings send `label` + `name` and no `inverseLabel`: the
 * relationship is symmetric, and HubSpot 500s when `label` and `inverseLabel`
 * are the same string.
 */
export function definitionRequest(pairing: AssociationPairing): HsRequest {
  if (pairing.route === 'labels') {
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
 * Classify a `GET …/labels` payload for one pairing.
 *
 * `null` stands for a 404 — no definition at all, same as an empty `results`.
 * Anything else is decided by whether THIS pairing's label is among the types:
 * that is the definition the workflow action associates through, and its typeId
 * is what the caller needs to report.
 */
export function classifyExisting(
  payload: AssociationLabelsResponse | null,
  pairing: AssociationPairing,
): PairingStatus {
  const results = payload?.results ?? [];
  if (results.length === 0) return { state: 'undefined', typeId: null };

  const typeId = findAssociationTypeId(payload, labelSpecFor(pairing));
  return typeId === null
    ? { state: 'defined-without-label', typeId: null }
    : { state: 'defined-labeled', typeId };
}

/**
 * Whether the pairing is usable as it stands.
 *
 * A labels-route pairing needs its own label — an unlabeled definition alone
 * leaves `AssociateRelatedContent` with no typeId to send. A schema-route
 * pairing only needs a definition to exist.
 */
export function isProvisioned(
  pairing: AssociationPairing,
  state: PairingState | null,
): boolean {
  if (state === null || state === 'undefined') return false;
  return pairing.route === 'schema' || state === 'defined-labeled';
}

/**
 * The idempotency decision. Anything already provisioned is left alone —
 * re-running must never duplicate or clobber a definition, including one an
 * admin created by hand in the data model builder.
 *
 * A labels-route pairing that has an unlabeled definition but not its own label
 * is still `create`: the label is the missing piece, and adding it does not
 * touch what is already there.
 */
export function planFor(
  pairing: AssociationPairing,
  state: PairingState | null,
): PairingAction {
  return isProvisioned(pairing, state) ? 'skip' : 'create';
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
): Promise<PairingStatus> {
  const res = await send(token, existingDefinitionsRequest(pairing));
  if (res.status === 404) return { state: 'undefined', typeId: null };
  if (!res.ok) throw new Error(`GET labels → ${res.status}: ${res.text}`);

  const payload = res.text
    ? (JSON.parse(res.text) as AssociationLabelsResponse)
    : {};
  return classifyExisting(payload, pairing);
}

function alreadyExists(res: RawResponse): boolean {
  return (
    res.status === 409 ||
    res.text.includes('already exists') ||
    res.text.includes('ALREADY_EXISTS') ||
    res.text.includes('DUPLICATE')
  );
}

function failureDetail(pairing: AssociationPairing, res: RawResponse): string {
  if (res.text.includes(UNLABELED_NAME_CONFLICT)) {
    return `HubSpot reserves the name "${pairing.name}" for the unlabeled association — ` +
      'give the definition a distinct name';
  }
  return `${res.status}: ${res.text}`;
}

/**
 * Create every missing definition. Never throws for a single pairing — one
 * rejected pairing must not stop the others from being created, and the caller
 * needs the full picture to report.
 */
export async function ensureAssociationDefinitions(
  token: string,
  pairings: AssociationPairing[],
): Promise<EnsureResult[]> {
  const results: EnsureResult[] = [];

  for (const pairing of pairings) {
    try {
      const before = await readState(token, pairing);

      if (planFor(pairing, before.state) === 'skip') {
        results.push({
          pairing,
          outcome: 'skipped',
          state: before.state,
          typeId: before.typeId,
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
          typeId: null,
          detail: failureDetail(pairing, res),
        });
        continue;
      }

      // Re-read: the POST's own response is not proof the app can use the
      // pairing. Only the labels GET reports the typeId, and it is the typeId
      // the workflow action will look up at call time.
      const after = await readState(token, pairing);
      results.push({
        pairing,
        outcome: alreadyExists(res) ? 'skipped' : 'created',
        state: after.state,
        typeId: after.typeId,
        detail: alreadyExists(res) ? 'definition already exists' : 'definition created',
      });
    } catch (err: unknown) {
      results.push({
        pairing,
        outcome: 'failed',
        state: null,
        typeId: null,
        detail: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return results;
}

/** Pairings that will still break `AssociateRelatedContent`. */
export function unusablePairings(results: EnsureResult[]): EnsureResult[] {
  return results.filter(r => !isProvisioned(r.pairing, r.state));
}
