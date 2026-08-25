import type { LinearWebhookPayload, UpsertResult } from './types';
import { LINEAR_STATE_TO_CONTENT_STAGE, LINEAR_STATE_TO_CHANGELOG_STAGE } from './mapping';
import { getPortalConfig, DEFAULT_APP_SETTINGS } from './portal-config';
import type { AppSettings } from './portal-config';

const HS_BASE = 'https://api.hubapi.com';

function getToken(): string {
  const token = process.env.PRIVATE_APP_ACCESS_TOKEN ?? process.env.HS_ACCESS_TOKEN;
  if (!token) throw new Error('No HubSpot access token available');
  return token;
}

async function hsSearch(
  objectTypeId: string,
  filters: Array<{ propertyName: string; operator: string; value: string }>,
  properties: string[],
): Promise<{ results: Array<{ id: string; properties: Record<string, string | null> }> }> {
  const token = getToken();
  const filterGroups = filters.length > 0 ? [{ filters }] : [];
  const res = await fetch(`${HS_BASE}/crm/v3/objects/${objectTypeId}/search`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ filterGroups, properties, limit: 1, sorts: [], query: '', after: '0' }),
  });
  if (!res.ok) throw new Error(`HubSpot search failed ${res.status}: ${await res.text()}`);
  return res.json() as Promise<{ results: Array<{ id: string; properties: Record<string, string | null> }> }>;
}

async function hsCreate(objectTypeId: string, properties: Record<string, string>): Promise<{ id: string }> {
  const token = getToken();
  const res = await fetch(`${HS_BASE}/crm/v3/objects/${objectTypeId}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ properties, associations: [] }),
  });
  if (!res.ok) throw new Error(`HubSpot create failed ${res.status}: ${await res.text()}`);
  return res.json() as Promise<{ id: string }>;
}

async function hsUpdate(objectTypeId: string, objectId: string, properties: Record<string, string>): Promise<void> {
  const token = getToken();
  const res = await fetch(`${HS_BASE}/crm/v3/objects/${objectTypeId}/${objectId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ properties }),
  });
  if (!res.ok) throw new Error(`HubSpot update failed ${res.status}: ${await res.text()}`);
}

export async function findByLinearId(
  objectTypeId: string,
  linearIssueId: string,
): Promise<string | null> {
  const response = await hsSearch(
    objectTypeId,
    [{ propertyName: 'linear_issue_id', operator: 'EQ', value: linearIssueId }],
    ['linear_issue_id'],
  );
  return response.results[0]?.id ?? null;
}

export async function getCurrentStage(
  objectTypeId: string,
  linearIssueId: string,
): Promise<string | null> {
  const response = await hsSearch(
    objectTypeId,
    [{ propertyName: 'linear_issue_id', operator: 'EQ', value: linearIssueId }],
    ['linear_issue_id', 'hs_pipeline_stage'],
  );
  return response.results[0]?.properties?.hs_pipeline_stage ?? null;
}

export async function archiveContentByLinearId(
  linearIssueId: string,
  portalId: number,
): Promise<UpsertResult | null> {
  const config = getPortalConfig(portalId);
  const objectTypeId = config.content.objectTypeId;
  const existingId = await findByLinearId(objectTypeId, linearIssueId);
  if (!existingId) {
    return null;
  }

  await hsUpdate(objectTypeId, existingId, { hs_pipeline_stage: config.content.stageIds.archived });
  return { id: existingId, action: 'updated' };
}

export async function upsertContent(
  payload: LinearWebhookPayload,
  portalId: number,
): Promise<UpsertResult> {
  const { data } = payload;
  const config = getPortalConfig(portalId);
  const stageName = LINEAR_STATE_TO_CONTENT_STAGE[data.state.name] ?? 'idea';
  const stageId = config.content.stageIds[stageName] ?? stageName;
  const objectTypeId = config.content.objectTypeId;

  const properties: Record<string, string> = {
    title: data.title,
    linear_issue_id: data.id,
    linear_issue_url: data.url,
    hs_pipeline: config.content.pipelineId,
    hs_pipeline_stage: stageId,
    ...(data.description ? { notes: data.description } : {}),
  };

  const existingId = await findByLinearId(objectTypeId, data.id);
  if (existingId) {
    await hsUpdate(objectTypeId, existingId, properties);
    return { id: existingId, action: 'updated' };
  }

  const created = await hsCreate(objectTypeId, properties);
  return { id: created.id, action: 'created' };
}

export async function upsertChangelog(
  payload: LinearWebhookPayload,
  portalId: number,
): Promise<UpsertResult> {
  const { data } = payload;
  const config = getPortalConfig(portalId);
  const stageName = LINEAR_STATE_TO_CHANGELOG_STAGE[data.state.name] ?? 'identified';
  const stageId = config.changelog.stageIds[stageName] ?? stageName;
  const objectTypeId = config.changelog.objectTypeId;

  const properties: Record<string, string> = {
    title: data.title,
    linear_issue_id: data.id,
    linear_issue_url: data.url,
    hs_pipeline: config.changelog.pipelineId,
    hs_pipeline_stage: stageId,
    ...(data.description ? { notes: data.description } : {}),
  };

  const existingId = await findByLinearId(objectTypeId, data.id);
  if (existingId) {
    await hsUpdate(objectTypeId, existingId, properties);
    return { id: existingId, action: 'updated' };
  }

  const created = await hsCreate(objectTypeId, properties);
  return { id: created.id, action: 'created' };
}

export async function readAppSettings(portalId: number): Promise<AppSettings> {
  const config = getPortalConfig(portalId);
  const objectTypeId = config.appConfig.objectTypeId;
  if (!objectTypeId) return { ...DEFAULT_APP_SETTINGS };

  try {
    const response = await hsSearch(
      objectTypeId,
      [],
      ['linear_team_id', 'assignee_filter', 'linear_assignee_id'],
    );
    const record = response.results[0];
    if (!record) return { ...DEFAULT_APP_SETTINGS };
    return {
      linearTeamId: record.properties.linear_team_id ?? '',
      assigneeFilter: (record.properties.assignee_filter as AppSettings['assigneeFilter']) ?? 'all',
      linearAssigneeId: record.properties.linear_assignee_id ?? '',
    };
  } catch {
    return { ...DEFAULT_APP_SETTINGS };
  }
}
