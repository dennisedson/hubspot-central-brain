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

async function hsUpsertByUniqueProperty(
  objectTypeId: string,
  idProperty: string,
  idValue: string,
  properties: Record<string, string>,
): Promise<UpsertResult> {
  const token = getToken();
  const res = await fetch(
    `${HS_BASE}/crm/v3/objects/${objectTypeId}/${idValue}?idProperty=${idProperty}`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ properties }),
    },
  );
  if (res.status === 404) {
    const created = await hsCreate(objectTypeId, properties);
    return { id: created.id, action: 'created' };
  }
  if (!res.ok) throw new Error(`HubSpot upsert failed ${res.status}: ${await res.text()}`);
  const updated = await res.json() as { id: string };
  return { id: updated.id, action: 'updated' };
}

export async function hsUpdate(objectTypeId: string, objectId: string, properties: Record<string, string>): Promise<void> {
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
  // Use GET by unique property (linear_id) instead of POST search — the search index
  // has replication lag that breaks dedup when two Linear webhook events arrive within
  // milliseconds of each other (e.g. issue create + label assignment double-fire).
  const token = getToken();
  const res = await fetch(
    `${HS_BASE}/crm/v3/objects/${objectTypeId}/${encodeURIComponent(linearIssueId)}?idProperty=linear_id&properties=hs_pipeline_stage`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`HubSpot GET failed ${res.status}: ${await res.text()}`);
  const data = await res.json() as { properties: { hs_pipeline_stage: string | null } };
  return data.properties.hs_pipeline_stage ?? null;
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

  await hsUpdate(objectTypeId, existingId, { hs_pipeline_stage: config.content.pipelines.content.stageIds.archived });
  return { id: existingId, action: 'updated' };
}

export async function upsertContent(
  payload: LinearWebhookPayload,
  portalId: number,
  pipelineKey: 'content' | 'changelog' = 'content',
): Promise<UpsertResult> {
  const { data } = payload;
  const config = getPortalConfig(portalId);
  const stateMap = pipelineKey === 'changelog' ? LINEAR_STATE_TO_CHANGELOG_STAGE : LINEAR_STATE_TO_CONTENT_STAGE;
  const stageName = stateMap[data.state.name] ?? (pipelineKey === 'changelog' ? 'identified' : 'idea');
  const pipelineConfig = config.content.pipelines[pipelineKey];
  const stageId = pipelineConfig.stageIds[stageName] ?? stageName;
  const objectTypeId = config.content.objectTypeId;

  // Skip if the record already has this exact stage — prevents duplicate workflow
  // triggers when Linear fires two rapid webhook events for the same action
  // (e.g. issue creation + label assignment arriving near-simultaneously).
  const currentStageId = await getCurrentStage(objectTypeId, data.id);
  if (currentStageId === stageId) {
    console.log(`Skipping upsert for Linear ${data.id}: stage already ${stageId}`);
    return { id: data.id, action: 'skipped' as const };
  }

  const properties: Record<string, string> = {
    title: data.title,
    linear_id: data.id,       // unique property — used as atomic upsert key
    linear_issue_id: data.id, // non-unique — kept for display and search
    linear_issue_url: data.url,
    hs_pipeline: pipelineConfig.pipelineId,
    hs_pipeline_stage: stageId,
    content_type: pipelineKey === 'changelog' ? 'changelog' : '',
    ...(data.description ? { notes: data.description } : {}),
  };

  // remove content_type if empty to avoid overwriting user-set value
  if (!properties.content_type) delete properties.content_type;

  return hsUpsertByUniqueProperty(objectTypeId, 'linear_id', data.id, properties);
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
