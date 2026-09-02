import { getPortalConfig } from '../lib/portal-config';
import { sortAndCapMeetings, MEETING_CAP } from '../lib/meeting-format';
import type { NormalisedMeeting, RawMeeting } from '../lib/meeting-format';

const HS_BASE = 'https://api.hubapi.com';

/**
 * How many associated ids we pull before sorting client-side. The v3 batch/read
 * endpoint accepts at most 100 inputs, so this is the ceiling either way.
 */
const ASSOCIATION_LIMIT = 100;

/** How many content records the card shows. */
const CONTENT_CAP = 10;

interface MeetingIntelligenceContext {
  accountId?: number;
  parameters?: Record<string, string | undefined>;
  query?: Record<string, string | undefined>;
  body?: Record<string, string | undefined>;
}

export interface ContentSummary {
  id: string;
  title: string;
  contentType: string | null;
  pipelineStage: string | null;
  linearIssueUrl: string | null;
  targetDate: string | null;
}

interface AssociationResults {
  results?: Array<{ toObjectId?: string | number }>;
}

interface BatchReadResults {
  results?: Array<{ id: string; properties?: Record<string, string | null> }>;
}

function param(ctx: MeetingIntelligenceContext, key: string): string | undefined {
  return ctx.parameters?.[key] ?? ctx.query?.[key] ?? ctx.body?.[key];
}

function json(statusCode: number, payload: unknown) {
  return { statusCode, body: JSON.stringify(payload) };
}

function reason(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function authHeaders(token: string) {
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };
}

/**
 * List the ids of `toObjectType` records associated with a contact.
 *
 * CRM v4 associations: GET /crm/v4/objects/{fromObjectType}/{id}/associations/{toObjectType}
 * responds with `{ results: [{ toObjectId, associationTypes }] }`. `toObjectType`
 * accepts a standard object name ("meetings") or a custom objectTypeId ("2-1234").
 */
async function listAssociatedIds(
  token: string,
  contactId: string,
  toObjectType: string,
): Promise<string[]> {
  const url =
    `${HS_BASE}/crm/v4/objects/contacts/${encodeURIComponent(contactId)}` +
    `/associations/${encodeURIComponent(toObjectType)}?limit=${ASSOCIATION_LIMIT}`;

  const res = await fetch(url, { headers: authHeaders(token) });
  if (res.status === 404) return [];
  if (!res.ok) {
    throw new Error(`Association lookup (contacts -> ${toObjectType}) failed ${res.status}: ${await res.text()}`);
  }

  const data = (await res.json()) as AssociationResults;
  return (data.results ?? [])
    .map(r => (r.toObjectId === undefined || r.toObjectId === null ? '' : String(r.toObjectId)))
    .filter(id => id !== '');
}

/** Read a set of records by id in one call. Returns [] for an empty id list. */
async function batchReadObjects(
  token: string,
  objectType: string,
  ids: string[],
  properties: string[],
): Promise<Array<{ id: string; properties: Record<string, string | null> }>> {
  if (ids.length === 0) return [];

  const res = await fetch(`${HS_BASE}/crm/v3/objects/${encodeURIComponent(objectType)}/batch/read`, {
    method: 'POST',
    headers: authHeaders(token),
    body: JSON.stringify({ properties, inputs: ids.map(id => ({ id })) }),
  });
  if (!res.ok) {
    throw new Error(`Batch read of ${objectType} failed ${res.status}: ${await res.text()}`);
  }

  const data = (await res.json()) as BatchReadResults;
  return (data.results ?? []).map(r => ({ id: String(r.id), properties: r.properties ?? {} }));
}

/**
 * Recent HubSpot meetings for a contact, most recent first.
 *
 * Two hops: associations give us the meeting ids, batch/read gives us their
 * properties. Ordering is applied client-side by `sortAndCapMeetings` because
 * the associations endpoint makes no ordering guarantee — which also means a
 * contact with more than ASSOCIATION_LIMIT meetings may not surface its true
 * newest few. Acceptable for a read-only recency card.
 */
export async function fetchContactMeetings(
  token: string,
  contactId: string,
): Promise<NormalisedMeeting[]> {
  const ids = await listAssociatedIds(token, contactId, 'meetings');
  const records = await batchReadObjects(token, 'meetings', ids, [
    'hs_meeting_title',
    'hs_meeting_start_time',
    'hs_meeting_end_time',
    'hs_meeting_outcome',
    'hs_timestamp',
  ]);
  return sortAndCapMeetings(records as RawMeeting[], MEETING_CAP);
}

/** `content_piece` records associated with a contact. */
export async function fetchContactContent(
  token: string,
  contactId: string,
  contentObjectTypeId: string,
): Promise<ContentSummary[]> {
  const ids = await listAssociatedIds(token, contactId, contentObjectTypeId);
  const records = await batchReadObjects(token, contentObjectTypeId, ids.slice(0, CONTENT_CAP), [
    'title',
    'content_type',
    'hs_pipeline_stage',
    'linear_issue_url',
    'target_date',
  ]);

  return records.map(r => ({
    id: r.id,
    title: r.properties.title || 'Untitled',
    contentType: r.properties.content_type || null,
    pipelineStage: r.properties.hs_pipeline_stage || null,
    linearIssueUrl: r.properties.linear_issue_url || null,
    targetDate: r.properties.target_date || null,
  }));
}

export async function main(context: MeetingIntelligenceContext) {
  const token = process.env.PRIVATE_APP_ACCESS_TOKEN ?? process.env.HS_ACCESS_TOKEN;
  const contactId = param(context, 'contactId');
  const portalId = context.accountId;

  if (!token) return json(500, { error: 'No HubSpot access token' });
  if (!contactId) return json(400, { error: 'contactId is required' });
  if (!portalId) return json(400, { error: 'accountId missing from context' });

  let contentObjectTypeId: string;
  try {
    contentObjectTypeId = getPortalConfig(portalId).content.objectTypeId;
  } catch {
    return json(500, { error: `No portal config for ${portalId}` });
  }

  // Independent sources: one failing must never blank the other.
  const [meetingsOutcome, contentOutcome] = await Promise.allSettled([
    fetchContactMeetings(token, contactId),
    fetchContactContent(token, contactId, contentObjectTypeId),
  ]);

  const errors: { meetings: string | null; content: string | null } = {
    meetings: null,
    content: null,
  };

  let meetings: NormalisedMeeting[] = [];
  if (meetingsOutcome.status === 'rejected') {
    errors.meetings = reason(meetingsOutcome.reason);
  } else {
    meetings = meetingsOutcome.value;
  }

  let content: ContentSummary[] = [];
  if (contentOutcome.status === 'rejected') {
    errors.content = reason(contentOutcome.reason);
  } else {
    content = contentOutcome.value;
  }

  return json(200, { meetings, content, errors });
}
