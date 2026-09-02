import { getPortalConfig, DEFAULT_APP_SETTINGS } from '../lib/portal-config';
import type { AppSettings } from '../lib/portal-config';
import { HS_BASE, objectPath, objectSearchPath } from '../lib/hs-api';

interface SettingsContext {
  accountId?: number;
  parameters?: Record<string, string | undefined>;
  query?: Record<string, string | undefined>;
  body?: Record<string, string | undefined>;
}

function param(ctx: SettingsContext, key: string): string | undefined {
  return ctx.parameters?.[key] ?? ctx.query?.[key] ?? ctx.body?.[key];
}

interface LinearTeam {
  id: string;
  name: string;
}

interface LinearMember {
  id: string;
  name: string;
}

const LINEAR_API = 'https://api.linear.app/graphql';

async function linearQuery(gql: string, variables: Record<string, unknown>, apiKey: string) {
  const res = await fetch(LINEAR_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: apiKey },
    body: JSON.stringify({ query: gql, variables }),
  });
  if (!res.ok) throw new Error(`Linear API error ${res.status}: ${await res.text()}`);
  return res.json() as Promise<{ data: Record<string, unknown> }>;
}

async function getLinearTeams(apiKey: string): Promise<LinearTeam[]> {
  try {
    const data = await linearQuery(`query { teams { nodes { id name } } }`, {}, apiKey);
    return (data.data?.teams as { nodes: LinearTeam[] } | undefined)?.nodes ?? [];
  } catch {
    return [];
  }
}

async function getLinearTeamMembers(teamId: string, apiKey: string): Promise<LinearMember[]> {
  try {
    const data = await linearQuery(
      `query($id: String!) { team(id: $id) { members { nodes { id name } } } }`,
      { id: teamId },
      apiKey,
    );
    const team = data.data?.team as { members: { nodes: LinearMember[] } } | undefined;
    return team?.members?.nodes ?? [];
  } catch {
    return [];
  }
}

async function hsSearch(objectTypeId: string, props: string[], token: string) {
  const res = await fetch(`${HS_BASE}${objectSearchPath(objectTypeId)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ filterGroups: [], properties: props, limit: 1, sorts: [], query: '', after: '0' }),
  });
  if (!res.ok) throw new Error(`HubSpot search failed ${res.status}: ${await res.text()}`);
  return res.json() as Promise<{ results: Array<{ id: string; properties: Record<string, string> }> }>;
}

async function hsCreate(objectTypeId: string, properties: Record<string, string>, token: string) {
  const res = await fetch(`${HS_BASE}${objectPath(objectTypeId)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ properties, associations: [] }),
  });
  if (!res.ok) throw new Error(`HubSpot create failed ${res.status}: ${await res.text()}`);
}

async function hsUpdate(objectTypeId: string, objectId: string, properties: Record<string, string>, token: string) {
  const res = await fetch(`${HS_BASE}${objectPath(objectTypeId, objectId)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ properties }),
  });
  if (!res.ok) throw new Error(`HubSpot update failed ${res.status}: ${await res.text()}`);
}

export async function main(context: SettingsContext): Promise<{ statusCode: number; body: string }> {
  const portalId = context.accountId ?? parseInt(param(context, 'portalId') ?? '0', 10);
  if (!portalId) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Missing portalId' }) };
  }

  const token = process.env.PRIVATE_APP_ACCESS_TOKEN ?? process.env.HS_ACCESS_TOKEN;
  const linearApiKey = process.env.LINEAR_API_KEY;

  if (!token) {
    return { statusCode: 500, body: JSON.stringify({ error: 'No HubSpot access token available' }) };
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

  const action = param(context, 'action') ?? 'getSettings';

  if (action === 'getSettings') {
    try {
      const result = await hsSearch(
        objectTypeId,
        ['linear_team_id', 'assignee_filter', 'linear_assignee_id'],
        token,
      );
      const record = result.results[0];
      const settings: AppSettings = record
        ? {
            linearTeamId: record.properties.linear_team_id ?? '',
            assigneeFilter: (record.properties.assignee_filter as AppSettings['assigneeFilter']) ?? 'all',
            linearAssigneeId: record.properties.linear_assignee_id ?? '',
          }
        : { ...DEFAULT_APP_SETTINGS };

      const [teams, teamMembers] = await Promise.all([
        linearApiKey ? getLinearTeams(linearApiKey) : Promise.resolve<LinearTeam[]>([]),
        linearApiKey && settings.linearTeamId
          ? getLinearTeamMembers(settings.linearTeamId, linearApiKey)
          : Promise.resolve<LinearMember[]>([]),
      ]);

      return { statusCode: 200, body: JSON.stringify({ ...settings, teams, teamMembers }) };
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      return { statusCode: 500, body: JSON.stringify({ error: 'Failed to load settings', detail }) };
    }
  }

  if (action === 'loadTeamMembers') {
    const teamId = param(context, 'teamId');
    if (!teamId || !linearApiKey) {
      return { statusCode: 200, body: JSON.stringify({ teamMembers: [] }) };
    }
    const teamMembers = await getLinearTeamMembers(teamId, linearApiKey);
    return { statusCode: 200, body: JSON.stringify({ teamMembers }) };
  }

  if (action === 'saveSettings') {
    const linearTeamId = param(context, 'linearTeamId');
    const assigneeFilter = param(context, 'assigneeFilter');
    const linearAssigneeId = param(context, 'linearAssigneeId');
    if (!linearTeamId || !assigneeFilter) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Missing required fields' }) };
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
      return { statusCode: 200, body: JSON.stringify({ ok: true }) };
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      return { statusCode: 500, body: JSON.stringify({ error: 'Failed to save settings', detail }) };
    }
  }

  return { statusCode: 400, body: JSON.stringify({ error: `Unknown action: ${action}` }) };
}
