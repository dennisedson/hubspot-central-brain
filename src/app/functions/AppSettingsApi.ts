import { getPortalConfig, DEFAULT_APP_SETTINGS } from '../lib/portal-config';
import type { AppSettings } from '../lib/portal-config';

interface EndpointContext {
  method: string;
  body: Record<string, string | undefined>;
  query?: Record<string, string>;
  accountId?: number;
}

const HS_BASE = 'https://api.hubapi.com';

async function hsSearch(objectTypeId: string, props: string[], token: string) {
  const res = await fetch(`${HS_BASE}/crm/v3/objects/${objectTypeId}/search`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ filterGroups: [], properties: props, limit: 1, sorts: [], query: '', after: '0' }),
  });
  if (!res.ok) throw new Error(`HubSpot search failed ${res.status}: ${await res.text()}`);
  return res.json() as Promise<{ results: Array<{ id: string; properties: Record<string, string> }> }>;
}

async function hsCreate(objectTypeId: string, properties: Record<string, string>, token: string) {
  const res = await fetch(`${HS_BASE}/crm/v3/objects/${objectTypeId}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ properties, associations: [] }),
  });
  if (!res.ok) throw new Error(`HubSpot create failed ${res.status}: ${await res.text()}`);
}

async function hsUpdate(objectTypeId: string, objectId: string, properties: Record<string, string>, token: string) {
  const res = await fetch(`${HS_BASE}/crm/v3/objects/${objectTypeId}/${objectId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ properties }),
  });
  if (!res.ok) throw new Error(`HubSpot update failed ${res.status}: ${await res.text()}`);
}

export async function main(context: EndpointContext): Promise<{ statusCode: number; body: string }> {
  // accountId is the portal ID for authenticated calls from UI extensions;
  // query.portalId is the fallback that hubspot.fetch() appends as a query param
  const portalId = context.accountId ?? parseInt(context.query?.portalId ?? '0', 10);
  if (!portalId) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Missing portalId — context.accountId and query.portalId both unavailable' }) };
  }

  const token = process.env.PRIVATE_APP_ACCESS_TOKEN ?? process.env.HS_ACCESS_TOKEN;
  if (!token) {
    return { statusCode: 500, body: JSON.stringify({ error: 'No access token available' }) };
  }

  let objectTypeId: string;
  try {
    objectTypeId = getPortalConfig(portalId).appConfig.objectTypeId;
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    return { statusCode: 500, body: JSON.stringify({ error: 'Portal not configured', detail }) };
  }

  if (!objectTypeId) {
    return { statusCode: 500, body: JSON.stringify({ error: 'App config object type not configured' }) };
  }

  if (context.method === 'GET') {
    try {
      const result = await hsSearch(objectTypeId, ['linear_team_id', 'assignee_filter', 'linear_assignee_id'], token);
      const record = result.results[0];
      if (!record) {
        return { statusCode: 200, body: JSON.stringify(DEFAULT_APP_SETTINGS) };
      }
      const settings: AppSettings = {
        linearTeamId: record.properties.linear_team_id ?? '',
        assigneeFilter: (record.properties.assignee_filter as AppSettings['assigneeFilter']) ?? 'all',
        linearAssigneeId: record.properties.linear_assignee_id ?? '',
      };
      return { statusCode: 200, body: JSON.stringify(settings) };
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      return { statusCode: 500, body: JSON.stringify({ error: 'Failed to load settings', detail }) };
    }
  }

  if (context.method === 'POST') {
    const { linearTeamId, assigneeFilter, linearAssigneeId } = context.body ?? {};
    if (!linearTeamId || !assigneeFilter) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Missing settings payload' }) };
    }

    const properties: Record<string, string> = {
      linear_team_id: linearTeamId,
      assignee_filter: assigneeFilter,
      linear_assignee_id: linearAssigneeId ?? '',
    };

    try {
      const existing = await hsSearch(objectTypeId, ['linear_team_id'], token);
      const existingId = existing.results[0]?.id;
      if (existingId) {
        await hsUpdate(objectTypeId, existingId, properties, token);
      } else {
        await hsCreate(objectTypeId, properties, token);
      }
      console.log(`Saved app settings for portal ${portalId}`);
      return { statusCode: 200, body: JSON.stringify({ ok: true }) };
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      return { statusCode: 500, body: JSON.stringify({ error: 'Failed to save settings', detail }) };
    }
  }

  return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
}
