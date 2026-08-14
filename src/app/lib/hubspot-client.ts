import { Client } from '@hubspot/api-client';
import { FilterOperatorEnum } from '@hubspot/api-client/lib/codegen/crm/objects/models/Filter';
import type { LinearWebhookPayload, UpsertResult } from './types';
import { LINEAR_STATE_TO_CONTENT_STAGE, LINEAR_STATE_TO_CHANGELOG_STAGE } from './mapping';
import { getPortalConfig } from './portal-config';

export function createHubSpotClient(token?: string): Client {
  return new Client({ accessToken: token ?? process.env.PRIVATE_APP_ACCESS_TOKEN });
}

export async function findByLinearId(
  client: Client,
  objectTypeId: string,
  linearIssueId: string,
): Promise<string | null> {
  const response = await client.crm.objects.searchApi.doSearch(objectTypeId, {
    filterGroups: [{
      filters: [{
        propertyName: 'linear_issue_id',
        operator: FilterOperatorEnum.Eq,
        value: linearIssueId,
      }],
    }],
    properties: ['linear_issue_id'],
    limit: 1,
    sorts: [],
    query: '',
    after: '0',
  });
  return response.results[0]?.id ?? null;
}

export async function getCurrentStage(
  client: Client,
  objectTypeId: string,
  linearIssueId: string,
): Promise<string | null> {
  const response = await client.crm.objects.searchApi.doSearch(objectTypeId, {
    filterGroups: [{
      filters: [{
        propertyName: 'linear_issue_id',
        operator: FilterOperatorEnum.Eq,
        value: linearIssueId,
      }],
    }],
    properties: ['linear_issue_id', 'hs_pipeline_stage'],
    limit: 1,
    sorts: [],
    query: '',
    after: '0',
  });
  return response.results[0]?.properties?.hs_pipeline_stage ?? null;
}

export async function archiveContentByLinearId(
  client: Client,
  linearIssueId: string,
  portalId: number,
): Promise<UpsertResult | null> {
  const config = getPortalConfig(portalId);
  const objectTypeId = config.content.objectTypeId;
  const existingId = await findByLinearId(client, objectTypeId, linearIssueId);
  if (!existingId) {
    return null;
  }

  await client.crm.objects.basicApi.update(objectTypeId, existingId, {
    properties: { hs_pipeline_stage: config.content.stageIds.archived },
  });
  return { id: existingId, action: 'updated' };
}

export async function upsertContent(
  client: Client,
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

  const existingId = await findByLinearId(client, objectTypeId, data.id);
  if (existingId) {
    await client.crm.objects.basicApi.update(objectTypeId, existingId, { properties });
    return { id: existingId, action: 'updated' };
  }

  const created = await client.crm.objects.basicApi.create(objectTypeId, { properties, associations: [] });
  return { id: created.id, action: 'created' };
}

export async function upsertChangelog(
  client: Client,
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

  const existingId = await findByLinearId(client, objectTypeId, data.id);
  if (existingId) {
    await client.crm.objects.basicApi.update(objectTypeId, existingId, { properties });
    return { id: existingId, action: 'updated' };
  }

  const created = await client.crm.objects.basicApi.create(objectTypeId, { properties, associations: [] });
  return { id: created.id, action: 'created' };
}
