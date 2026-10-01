import type { LinearWebhookPayload, UpsertResult } from './types';
import { rolloutProperties } from './changelog-source';
import { LINEAR_STATE_TO_CONTENT_STAGE, LINEAR_STATE_TO_CHANGELOG_STAGE } from './mapping';
import { parseProjectMap, parseUnmappedProjects, type ProjectMap, type UnmappedProject } from './mapping';
import { getPortalConfig, DEFAULT_APP_SETTINGS } from './portal-config';
import type { AppSettings } from './portal-config';
import {
  HS_BASE,
  objectPath,
  objectSearchPath,
  pipelinesPath,
  defaultAssociationPath,
  datedObjectPath,
  datedObjectSearchPath,
} from './hs-api';

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
  const res = await fetch(`${HS_BASE}${objectSearchPath(objectTypeId)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ filterGroups, properties, limit: 1, sorts: [], query: '', after: '0' }),
  });
  if (!res.ok) throw new Error(`HubSpot search failed ${res.status}: ${await res.text()}`);
  return res.json() as Promise<{ results: Array<{ id: string; properties: Record<string, string | null> }> }>;
}

async function hsCreate(objectTypeId: string, properties: Record<string, string>): Promise<{ id: string }> {
  const token = getToken();
  const res = await fetch(`${HS_BASE}${objectPath(objectTypeId)}`, {
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
    `${HS_BASE}${objectPath(objectTypeId, idValue)}?idProperty=${idProperty}`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ properties }),
    },
  );
  if (res.status === 404) {
    try {
      const created = await hsCreate(objectTypeId, properties);
      return { id: created.id, action: 'created' };
    } catch (createErr) {
      const msg = createErr instanceof Error ? createErr.message : String(createErr);
      if (msg.includes('409')) {
        // A concurrent request already created the record — the first writer won,
        // and it set the same stage we would have set. Treat this as a no-op.
        console.log(`HubSpot 409 conflict for ${idProperty}=${idValue}: concurrent create won, treating as skipped`);
        return { id: idValue, action: 'skipped' as const };
      }
      throw createErr;
    }
  }
  if (!res.ok) throw new Error(`HubSpot upsert failed ${res.status}: ${await res.text()}`);
  const updated = await res.json() as { id: string };
  return { id: updated.id, action: 'updated' };
}

export async function hsUpdate(objectTypeId: string, objectId: string, properties: Record<string, string>): Promise<void> {
  const token = getToken();
  const res = await fetch(`${HS_BASE}${objectPath(objectTypeId, objectId)}`, {
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
    `${HS_BASE}${objectPath(objectTypeId, encodeURIComponent(linearIssueId))}?idProperty=linear_id&properties=hs_pipeline_stage`,
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
  // Derived from the issue description every time, because milestones move.
  // Every key is present — '' clears a date that has been removed, where an
  // omitted key would leave a stale one in place forever.
  const rollout = rolloutProperties(data.description);

  const currentStageId = await getCurrentStage(objectTypeId, data.id);
  if (currentStageId === stageId) {
    // The stage has not moved, but the TIMELINE may have: a date brought
    // forward, pushed back or deleted, with the issue sitting in the same
    // state throughout. Returning here — as this did — meant a date change
    // produced no write at all, and the pipeline kept sorting on the old one.
    //
    // Safe from the echo loop this skip belongs to: that loop is
    // HubSpot → Linear → HubSpot, and writing a HubSpot property does not
    // notify Linear. The stage itself is still left alone.
    console.log(`Stage unchanged for Linear ${data.id}; refreshing rollout dates only`);
    await refreshDerivedProperties(objectTypeId, data.id, data.description);
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
    ...rollout,
    ...(data.description ? { notes: data.description } : {}),
  };

  // remove content_type if empty to avoid overwriting user-set value
  if (!properties.content_type) delete properties.content_type;

  return hsUpsertByUniqueProperty(objectTypeId, 'linear_id', data.id, properties);
}


/**
 * Refreshes only what is derived from the issue description.
 *
 * Writes the notes and the rollout dates, and deliberately touches neither the
 * pipeline stage nor anything a person may have set in HubSpot.
 *
 * Exists because both echo guards — the one in LinearWebhook and the one in
 * upsertContent — skip on the stage, and an issue can have its TIMELINE edited
 * while sitting in the same state throughout. Adding a date to an existing
 * issue is exactly that shape, and before this it produced no write at all.
 *
 * Safe with respect to the loop those guards protect: that loop is
 * HubSpot → Linear → HubSpot, and writing a HubSpot property does not notify
 * Linear. The guards exist to stop a stage being overwritten, not to stop the
 * record reflecting the issue.
 */
export async function refreshDerivedProperties(
  objectTypeId: string,
  linearId: string,
  description: string | undefined,
): Promise<void> {
  const properties: Record<string, string> = {
    ...rolloutProperties(description),
    ...(description ? { notes: description } : {}),
  };
  await hsUpsertByUniqueProperty(objectTypeId, 'linear_id', linearId, properties);
}

export async function findContentByAsanaTaskUrl(
  objectTypeId: string,
  asanaTaskUrl: string,
): Promise<{ id: string; pipelineStage: string | null; pipeline: string | null } | null> {
  const response = await hsSearch(
    objectTypeId,
    [{ propertyName: 'asana_task_url', operator: 'EQ', value: asanaTaskUrl }],
    ['asana_task_url', 'hs_pipeline_stage', 'hs_pipeline'],
  );
  const record = response.results[0];
  if (!record) return null;
  return {
    id: record.id,
    pipelineStage: record.properties.hs_pipeline_stage ?? null,
    pipeline: record.properties.hs_pipeline ?? null,
  };
}

export async function getAsanaSyncToken(
  objectTypeId: string,
  recordId: string,
): Promise<string | null> {
  const token = getToken();
  const res = await fetch(
    `${HS_BASE}${objectPath(objectTypeId, recordId)}?properties=asana_sync_token`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (!res.ok) throw new Error(`HubSpot GET failed ${res.status}: ${await res.text()}`);
  const data = await res.json() as { properties: { asana_sync_token: string | null } };
  return data.properties.asana_sync_token ?? null;
}

export async function setAsanaSyncToken(
  objectTypeId: string,
  recordId: string,
  syncToken: string,
): Promise<void> {
  await hsUpdate(objectTypeId, recordId, { asana_sync_token: syncToken });
}

export async function getFellowLastSync(
  objectTypeId: string,
  recordId: string,
): Promise<string | null> {
  const token = getToken();
  const res = await fetch(
    `${HS_BASE}${objectPath(objectTypeId, recordId)}?properties=fellow_last_sync`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (!res.ok) throw new Error(`HubSpot GET failed ${res.status}: ${await res.text()}`);
  const data = await res.json() as { properties: { fellow_last_sync: string | null } };
  return data.properties.fellow_last_sync ?? null;
}

export async function setFellowLastSync(
  objectTypeId: string,
  recordId: string,
  isoDate: string,
): Promise<void> {
  await hsUpdate(objectTypeId, recordId, { fellow_last_sync: isoDate });
}

export async function findContactByEmail(email: string): Promise<string | null> {
  const token = getToken();
  const res = await fetch(
    `${HS_BASE}${objectPath('contacts', encodeURIComponent(email))}?idProperty=email&properties=email`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`HubSpot contact lookup failed ${res.status}: ${await res.text()}`);
  const data = await res.json() as { id: string };
  return data.id;
}

export interface ProjectsPipelineConfig {
  pipelineId: string;
  executionStageId: string;
  completedStageId: string;
}

export async function resolveProjectsPipeline(): Promise<ProjectsPipelineConfig> {
  const token = getToken();
  const res = await fetch(`${HS_BASE}${pipelinesPath('projects')}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`Projects pipeline lookup failed ${res.status}: ${await res.text()}`);
  const data = await res.json() as { results: Array<{ id: string; label: string; stages: Array<{ id: string; label: string }> }> };

  const pipeline = data.results.find(p => p.label === 'Project Pipeline') ?? data.results[0];
  if (!pipeline) throw new Error('No Projects pipeline found in HubSpot');

  const find = (label: string) => {
    const stage = pipeline.stages.find(s => s.label === label);
    if (!stage) throw new Error(`Projects pipeline has no "${label}" stage`);
    return stage.id;
  };

  return {
    pipelineId: pipeline.id,
    executionStageId: find('Execution'),
    completedStageId: find('Completed'),
  };
}

export async function upsertFellowProject(
  fellowActionItemId: string,
  properties: Record<string, string>,
): Promise<UpsertResult> {
  const token = getToken();

  // Search for existing project by dedup key
  const searchRes = await fetch(`${HS_BASE}${datedObjectSearchPath('projects')}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      filterGroups: [{ filters: [{ propertyName: 'fellow_action_item_id', operator: 'EQ', value: fellowActionItemId }] }],
      properties: ['fellow_action_item_id'],
      limit: 1,
    }),
  });
  if (!searchRes.ok) throw new Error(`Project search failed ${searchRes.status}: ${await searchRes.text()}`);
  const searchData = await searchRes.json() as { results: Array<{ id: string }> };

  if (searchData.results.length > 0) {
    const projectId = searchData.results[0].id;
    const patchRes = await fetch(`${HS_BASE}${datedObjectPath('projects', projectId)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ properties }),
    });
    if (!patchRes.ok) throw new Error(`Project update failed ${patchRes.status}: ${await patchRes.text()}`);
    return { id: projectId, action: 'updated' };
  }

  const createRes = await fetch(`${HS_BASE}${datedObjectPath('projects')}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ properties }),
  });
  if (!createRes.ok) throw new Error(`Project create failed ${createRes.status}: ${await createRes.text()}`);
  const created = await createRes.json() as { id: string };
  return { id: created.id, action: 'created' };
}

export async function associateProjectToContact(projectId: string, contactId: string): Promise<void> {
  const token = getToken();
  const res = await fetch(
    `${HS_BASE}${defaultAssociationPath('projects', projectId, 'contacts', contactId)}`,
    {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}` },
    },
  );
  if (!res.ok) throw new Error(`Project-contact association failed ${res.status}: ${await res.text()}`);
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

/**
 * The Linear project map, as stored on app_configs.
 *
 * Separate from readAppSettings because that returns the three values a person
 * chooses in the form, and this is a lookup table. Returns an empty map on any
 * failure, which means label-only classification — the behaviour that predates
 * the map, and a safer degradation than refusing to sync.
 */
export async function readProjectState(
  portalId: number,
): Promise<{ recordId: string | null; map: ProjectMap; unmapped: UnmappedProject[] }> {
  const objectTypeId = getPortalConfig(portalId).appConfig.objectTypeId;
  if (!objectTypeId) return { recordId: null, map: {}, unmapped: [] };
  try {
    const response = await hsSearch(objectTypeId, [], ['linear_project_map', 'linear_unmapped_projects']);
    const record = response.results[0];
    return {
      recordId: record?.id ?? null,
      map: parseProjectMap(record?.properties.linear_project_map),
      unmapped: parseUnmappedProjects(record?.properties.linear_unmapped_projects),
    };
  } catch {
    return { recordId: null, map: {}, unmapped: [] };
  }
}

/**
 * Record a project the sync has seen but nobody has mapped.
 *
 * Written only when the project is genuinely new — already-seen and
 * already-mapped projects write nothing, so the common case costs one read
 * that was happening anyway. A failure here is swallowed: not noticing a new
 * project is a missed prompt, and must never cost the sync the issue itself.
 */
export async function recordUnmappedProject(
  portalId: number,
  recordId: string,
  seen: UnmappedProject[],
  project: UnmappedProject,
): Promise<void> {
  const objectTypeId = getPortalConfig(portalId).appConfig.objectTypeId;
  if (!objectTypeId || !recordId) return;
  try {
    const next = [...seen, project];
    await hsUpdate(objectTypeId, recordId, {
      linear_unmapped_projects: JSON.stringify(next),
    });
  } catch (err) {
    console.error('Could not record an unmapped project:', err instanceof Error ? err.message : err);
  }
}

/**
 * The connected YouTube channel id.
 *
 * Read from `app_configs`, where the OAuth callback already recorded it — the
 * same value `youtube-auth?action=status` reports back. `YOUTUBE_CHANNEL_ID`
 * overrides it, because a secret is the only way to point a sync at a channel
 * the callback never wrote, but it is an override rather than the source.
 *
 * It used to be the source, and that was a mistake: it made an operator copy a
 * value the app already knew into a second store that nothing validated and no
 * setup doc listed. Unset, it disabled the analytics half of the sync in
 * silence — no error, no note, and blank analytics fields that looked exactly
 * like a channel with no impressions.
 *
 * Returns null rather than throwing. Analytics are an enhancement to the sync;
 * failing to discover a channel id must not cost the statistics.
 */
export async function readYouTubeChannelId(portalId: number): Promise<string | null> {
  const override = process.env.YOUTUBE_CHANNEL_ID?.trim();
  if (override) return override;

  const objectTypeId = getPortalConfig(portalId).appConfig.objectTypeId;
  if (!objectTypeId) return null;

  try {
    const response = await hsSearch(objectTypeId, [], ['youtube_channel_id']);
    return response.results[0]?.properties.youtube_channel_id || null;
  } catch {
    return null;
  }
}
