import { createHubSpotClient } from '../lib/hubspot-client';
import { getPortalConfig, DEFAULT_APP_SETTINGS } from '../lib/portal-config';
import type { AppSettings } from '../lib/portal-config';

interface AppSettingsContext {
  body: {
    method: 'GET' | 'POST';
    settings?: AppSettings;
  };
  accountId: number;
}

export async function main(context: AppSettingsContext): Promise<{ statusCode: number; body: string }> {
  const client = createHubSpotClient();
  const portalConfig = getPortalConfig(context.accountId);
  const objectTypeId = portalConfig.appConfig.objectTypeId;

  if (!objectTypeId) {
    console.error('appConfig objectTypeId not configured for portal', context.accountId);
    return { statusCode: 500, body: JSON.stringify({ error: 'App config object type not configured' }) };
  }

  if (context.body.method === 'GET') {
    try {
      const response = await client.crm.objects.searchApi.doSearch(objectTypeId, {
        filterGroups: [],
        properties: ['linear_team_id', 'assignee_filter', 'linear_assignee_id'],
        limit: 1,
        sorts: [],
        query: '',
        after: '0',
      });

      const record = response.results[0];
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
      console.error('Failed to load settings:', err);
      return { statusCode: 200, body: JSON.stringify(DEFAULT_APP_SETTINGS) };
    }
  }

  if (context.body.method === 'POST') {
    const settings = context.body.settings;
    if (!settings) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Missing settings payload' }) };
    }

    const properties: Record<string, string> = {
      linear_team_id: settings.linearTeamId,
      assignee_filter: settings.assigneeFilter,
      linear_assignee_id: settings.linearAssigneeId ?? '',
    };

    try {
      const existing = await client.crm.objects.searchApi.doSearch(objectTypeId, {
        filterGroups: [],
        properties: ['linear_team_id'],
        limit: 1,
        sorts: [],
        query: '',
        after: '0',
      });

      const existingId = existing.results[0]?.id;
      if (existingId) {
        await client.crm.objects.basicApi.update(objectTypeId, existingId, { properties });
      } else {
        await client.crm.objects.basicApi.create(objectTypeId, { properties, associations: [] });
      }

      console.log(`Saved app settings for portal ${context.accountId}`);
      return { statusCode: 200, body: JSON.stringify({ ok: true }) };
    } catch (err) {
      console.error('Failed to save settings:', err);
      return { statusCode: 500, body: JSON.stringify({ error: 'Failed to save settings' }) };
    }
  }

  return { statusCode: 400, body: JSON.stringify({ error: 'Unknown method' }) };
}
