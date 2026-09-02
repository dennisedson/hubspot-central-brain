import { getPortalConfig } from '../lib/portal-config';
import { parseTopicTags, scoreRelated } from '../lib/related-content';
import type { RelatedCandidate } from '../lib/related-content';

const HS_BASE = 'https://api.hubapi.com';
const CANDIDATE_LIMIT = 100;
const RESULT_LIMIT = 5;

type RelatedObjectType = 'content' | 'video';

interface RelatedContentContext {
  accountId?: number;
  parameters?: Record<string, string | undefined>;
  query?: Record<string, string | undefined>;
  body?: Record<string, string | undefined>;
}

/**
 * Per-object-type property mapping. `content_piece` carries a real multi-select
 * `topic_tags` plus `enterpret_theme`; `video` only has a free-text `tags`
 * property and no theme, so its theme is always null. Requesting a property a
 * schema does not have makes CRM search 400, so these lists must stay accurate.
 */
const TYPE_PROPERTIES: Record<RelatedObjectType, { tagProp: string; themeProp: string | null }> = {
  content: { tagProp: 'topic_tags', themeProp: 'enterpret_theme' },
  video: { tagProp: 'tags', themeProp: null },
};

interface HsRecord {
  id: string;
  properties: Record<string, string | null>;
}

interface Candidate extends RelatedCandidate {
  title: string;
  url: string;
}

function param(ctx: RelatedContentContext, key: string): string | undefined {
  return ctx.parameters?.[key] ?? ctx.query?.[key] ?? ctx.body?.[key];
}

function json(statusCode: number, payload: unknown) {
  return { statusCode, body: JSON.stringify(payload) };
}

function reason(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function recordUrl(portalId: number, objectTypeId: string, recordId: string): string {
  return `https://app.hubspot.com/contacts/${portalId}/record/${objectTypeId}/${recordId}`;
}

function toCandidate(
  record: HsRecord,
  portalId: number,
  objectTypeId: string,
  tagProp: string,
  themeProp: string | null,
): Candidate {
  return {
    id: record.id,
    title: record.properties.title || 'Untitled',
    topicTags: parseTopicTags(record.properties[tagProp]),
    enterpretTheme: themeProp ? record.properties[themeProp] ?? null : null,
    url: recordUrl(portalId, objectTypeId, record.id),
  };
}

export async function main(context: RelatedContentContext) {
  const token = process.env.PRIVATE_APP_ACCESS_TOKEN ?? process.env.HS_ACCESS_TOKEN;
  const objectId = param(context, 'objectId');
  const requestedType = param(context, 'objectType');
  const requestedTypeId = param(context, 'objectTypeId');
  const portalId = context.accountId;

  if (!token) return json(500, { error: 'No HubSpot access token' });
  if (!objectId) return json(400, { error: 'objectId is required' });
  if (!portalId) return json(400, { error: 'accountId missing from context' });
  if (requestedType && requestedType !== 'content' && requestedType !== 'video') {
    return json(400, { error: `objectType must be "content" or "video", got "${requestedType}"` });
  }

  let config;
  try {
    config = getPortalConfig(portalId);
  } catch {
    return json(500, { error: `No portal config for ${portalId}` });
  }

  // The card knows the numeric objectTypeId of the record it is rendered on but
  // not which logical type that is (the ids differ per portal), so resolve that
  // here when it is supplied and fall back to the explicit objectType parameter.
  let objectType: RelatedObjectType;
  if (requestedTypeId === config.video.objectTypeId) {
    objectType = 'video';
  } else if (requestedTypeId === config.content.objectTypeId) {
    objectType = 'content';
  } else if (requestedType === 'content' || requestedType === 'video') {
    objectType = requestedType;
  } else if (requestedTypeId) {
    return json(400, { error: `Unrecognized objectTypeId "${requestedTypeId}" for portal ${portalId}` });
  } else {
    objectType = 'content';
  }

  const objectTypeId =
    objectType === 'video' ? config.video.objectTypeId : config.content.objectTypeId;

  const { tagProp, themeProp } = TYPE_PROPERTIES[objectType];
  const properties = ['title', tagProp, ...(themeProp ? [themeProp] : [])];
  const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };

  // The source read and the candidate search are independent — run them together
  // so a slow search never serializes behind the record fetch.
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
    return json(502, { error: reason(sourceOutcome.reason) });
  }

  const errors: { candidates: string | null } = { candidates: null };
  if (candidateOutcome.status === 'rejected') {
    errors.candidates = reason(candidateOutcome.reason);
  }

  const source = toCandidate(sourceOutcome.value, portalId, objectTypeId, tagProp, themeProp);
  const candidates =
    candidateOutcome.status === 'fulfilled'
      ? candidateOutcome.value.map(r => toCandidate(r, portalId, objectTypeId, tagProp, themeProp))
      : [];

  const related = scoreRelated(source, candidates)
    .slice(0, RESULT_LIMIT)
    .map(r => ({
      id: r.candidate.id,
      title: r.candidate.title,
      score: r.score,
      matchedTags: r.matchedTags,
      matchedTheme: r.matchedTheme,
      url: r.candidate.url,
    }));

  return json(200, {
    related,
    source: {
      id: source.id,
      title: source.title,
      topicTags: source.topicTags,
      enterpretTheme: source.enterpretTheme,
    },
    objectType,
    candidatesScanned: candidates.length,
    errors,
  });
}
