import { getPortalConfig } from '../lib/portal-config';
import { parseTopicTags, scoreRelated } from '../lib/related-content';
import type { RelatedCandidate } from '../lib/related-content';
import { verifySharedSecret } from '../lib/shared-secret';

const HS_BASE = 'https://api.hubapi.com';
const CANDIDATE_LIMIT = 100;
const DEFAULT_MAX_ASSOCIATIONS = 3;
const HARD_MAX_ASSOCIATIONS = 5;

type RelatedObjectType = 'content' | 'video';

/** See RelatedContentApi — `video` has no theme property, only free-text `tags`. */
const TYPE_PROPERTIES: Record<RelatedObjectType, { tagProp: string; themeProp: string | null }> = {
  content: { tagProp: 'topic_tags', themeProp: 'enterpret_theme' },
  video: { tagProp: 'tags', themeProp: null },
};

interface AssociateRelatedContentBody {
  callbackId?: string;
  hs_object_id?: string | number;
  object?: { objectId?: string | number; objectType?: string };
  inputFields?: {
    sharedSecret?: string;
    objectId?: string;
    objectType?: string;
    maxAssociations?: string | number;
  };
}

interface AssociateRelatedContentContext {
  accountId: number;
  body?: AssociateRelatedContentBody;
}

interface HsRecord {
  id: string;
  properties: Record<string, string | null>;
}

interface Candidate extends RelatedCandidate {
  title: string;
}

function json(statusCode: number, payload: unknown) {
  return { statusCode, body: JSON.stringify(payload) };
}

/**
 * Workflow actions must not fail loudly — a non-2xx response makes HubSpot retry
 * and eventually park the enrollment. Every recoverable problem comes back as a
 * 200 with a descriptive status instead.
 */
function outcome(fields: Record<string, string | number>) {
  return json(200, { outputFields: fields });
}

function reason(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function toCandidate(record: HsRecord, tagProp: string, themeProp: string | null): Candidate {
  return {
    id: record.id,
    title: record.properties.title || 'Untitled',
    topicTags: parseTopicTags(record.properties[tagProp]),
    enterpretTheme: themeProp ? record.properties[themeProp] ?? null : null,
  };
}

/**
 * Creates the *default* (unlabeled) association between two records of the given
 * object types. This requires a default association definition to exist between
 * those two object types in the portal — see the note in the hsmeta description.
 */
async function associateDefault(
  token: string,
  objectTypeId: string,
  fromId: string,
  toId: string,
): Promise<void> {
  const res = await fetch(
    `${HS_BASE}/crm/v4/objects/${objectTypeId}/${fromId}/associations/default/${objectTypeId}/${toId}`,
    { method: 'PUT', headers: { Authorization: `Bearer ${token}` } },
  );
  if (!res.ok) {
    throw new Error(`Association ${fromId}->${toId} failed ${res.status}: ${await res.text()}`);
  }
}

export async function main(context: AssociateRelatedContentContext) {
  const expectedSecret = process.env.SYNC_SHARED_SECRET;
  if (!expectedSecret) {
    console.error('SYNC_SHARED_SECRET is not set');
    return json(500, { error: 'Server misconfiguration' });
  }

  const inputFields = context.body?.inputFields ?? {};
  if (!verifySharedSecret(inputFields.sharedSecret, expectedSecret)) {
    console.warn('Rejected AssociateRelatedContent request: invalid shared secret');
    return json(401, { error: 'Unauthorized' });
  }

  const token = process.env.PRIVATE_APP_ACCESS_TOKEN ?? process.env.HS_ACCESS_TOKEN;
  if (!token) {
    console.error('No HubSpot access token available');
    return json(500, { error: 'Server misconfiguration' });
  }

  const rawObjectId = inputFields.objectId ?? context.body?.object?.objectId ?? context.body?.hs_object_id;
  const objectId = rawObjectId === undefined || rawObjectId === null ? '' : String(rawObjectId);
  if (!objectId) {
    console.warn('AssociateRelatedContent: no triggering record id in payload');
    return outcome({ associationStatus: 'skipped', associationsCreated: 0, relatedTitles: '' });
  }

  const requestedType = inputFields.objectType ?? 'content';
  if (requestedType !== 'content' && requestedType !== 'video') {
    console.warn(`AssociateRelatedContent: unsupported objectType "${requestedType}"`);
    return outcome({ associationStatus: 'skipped', associationsCreated: 0, relatedTitles: '' });
  }
  const objectType: RelatedObjectType = requestedType;

  let objectTypeId: string;
  try {
    const config = getPortalConfig(context.accountId);
    objectTypeId = objectType === 'video' ? config.video.objectTypeId : config.content.objectTypeId;
  } catch {
    console.error(`No portal config for ${context.accountId}`);
    return json(500, { error: `No portal config for ${context.accountId}` });
  }

  const parsedMax = Number(inputFields.maxAssociations);
  const maxAssociations = Math.min(
    Number.isFinite(parsedMax) && parsedMax > 0 ? Math.floor(parsedMax) : DEFAULT_MAX_ASSOCIATIONS,
    HARD_MAX_ASSOCIATIONS,
  );

  const { tagProp, themeProp } = TYPE_PROPERTIES[objectType];
  const properties = ['title', tagProp, ...(themeProp ? [themeProp] : [])];
  const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };

  const [sourceOutcome, candidateOutcome] = await Promise.allSettled([
    (async () => {
      const res = await fetch(
        `${HS_BASE}/crm/v3/objects/${objectTypeId}/${objectId}?properties=${properties.join(',')}`,
        { headers },
      );
      if (!res.ok) throw new Error(`Could not read record ${objectId}: ${res.status}`);
      return await res.json() as HsRecord;
    })(),
    (async () => {
      const res = await fetch(`${HS_BASE}/crm/v3/objects/${objectTypeId}/search`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          filterGroups: [],
          properties,
          sorts: [{ propertyName: 'hs_lastmodifieddate', direction: 'DESCENDING' }],
          limit: CANDIDATE_LIMIT,
          after: '0',
        }),
      });
      if (!res.ok) throw new Error(`Candidate search failed ${res.status}: ${await res.text()}`);
      const data = await res.json() as { results?: HsRecord[] };
      return data.results ?? [];
    })(),
  ]);

  if (sourceOutcome.status === 'rejected') {
    console.error('AssociateRelatedContent source read failed:', reason(sourceOutcome.reason));
    return outcome({ associationStatus: 'failed', associationsCreated: 0, relatedTitles: '' });
  }
  if (candidateOutcome.status === 'rejected') {
    console.error('AssociateRelatedContent search failed:', reason(candidateOutcome.reason));
    return outcome({ associationStatus: 'failed', associationsCreated: 0, relatedTitles: '' });
  }

  const source = toCandidate(sourceOutcome.value, tagProp, themeProp);
  const candidates = candidateOutcome.value.map(r => toCandidate(r, tagProp, themeProp));
  const winners = scoreRelated(source, candidates).slice(0, maxAssociations);

  if (winners.length === 0) {
    return outcome({ associationStatus: 'no_matches', associationsCreated: 0, relatedTitles: '' });
  }

  const results = await Promise.allSettled(
    winners.map(w => associateDefault(token, objectTypeId, objectId, w.candidate.id)),
  );

  const created: string[] = [];
  const failures: string[] = [];
  results.forEach((result, i) => {
    if (result.status === 'fulfilled') {
      created.push(winners[i].candidate.title);
    } else {
      failures.push(reason(result.reason));
    }
  });

  failures.forEach(f => console.error('AssociateRelatedContent association failed:', f));

  const associationStatus =
    created.length === winners.length ? 'success' : created.length > 0 ? 'partial' : 'failed';

  console.warn(
    `AssociateRelatedContent ${objectType} ${objectId}: ${created.length}/${winners.length} associated (${associationStatus})`,
  );

  return outcome({
    associationStatus,
    associationsCreated: created.length,
    relatedTitles: created.join('; '),
  });
}
