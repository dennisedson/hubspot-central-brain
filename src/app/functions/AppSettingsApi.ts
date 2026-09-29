import { getPortalConfig, DEFAULT_APP_SETTINGS } from '../lib/portal-config';
import type { AppSettings } from '../lib/portal-config';
import { HS_BASE, objectPath, objectSearchPath } from '../lib/hs-api';

interface SettingsContext {
  accountId?: number;
  params?: Record<string, string | string[] | undefined>;
  parameters?: Record<string, string | undefined>;
  query?: Record<string, string | undefined>;
  body?: Record<string, string | undefined>;
}

function param(ctx: SettingsContext, key: string): string | undefined {
  // HubSpot delivers URL query params in `params`, and their values are
  // ARRAYS, not strings — reading one straight through yields e.g. ["status"],
  // which compares unequal to "status" and has no .split().
  const q = ctx.params?.[key];
  const fromQuery = Array.isArray(q) ? q[0] : q;
  return fromQuery ?? ctx.parameters?.[key] ?? ctx.query?.[key] ?? ctx.body?.[key];
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

/** Linear's per-page maximum. Asking for more is an error, not a bigger page. */
const LINEAR_PAGE_SIZE = 250;

/**
 * Stop after this many pages. A guard, not a limit anyone should hit: 25 pages
 * is 6,250 teams. It exists so a malformed `endCursor` cannot spin this
 * function until the gateway kills it.
 */
const MAX_PAGES = 25;

/**
 * Every Linear team the API key can see, paged.
 *
 * Paging is not optional here. The query used to be `teams { nodes { … } }`
 * with no arguments, and Linear defaults a connection to **50** — so on a large
 * workspace the settings page offered the first fifty teams in whatever order
 * the API returned them, with no indication that more existed. Prod returned
 * exactly 50 out of several hundred, which reads as "my team is missing"
 * rather than "this list is truncated".
 */
export async function getLinearTeams(apiKey: string): Promise<LinearTeam[]> {
  const teams: LinearTeam[] = [];
  let after: string | null = null;

  try {
    for (let page = 0; page < MAX_PAGES; page++) {
      const data: { data: Record<string, unknown> } = await linearQuery(
        `query($first: Int!, $after: String) {
           teams(first: $first, after: $after) {
             nodes { id name }
             pageInfo { hasNextPage endCursor }
           }
         }`,
        { first: LINEAR_PAGE_SIZE, after },
        apiKey,
      );

      const connection = data.data?.teams as
        | { nodes: LinearTeam[]; pageInfo: { hasNextPage: boolean; endCursor: string | null } }
        | undefined;
      if (!connection) break;

      teams.push(...(connection.nodes ?? []));
      if (!connection.pageInfo?.hasNextPage || !connection.pageInfo.endCursor) break;
      after = connection.pageInfo.endCursor;
    }
  } catch {
    // An empty list renders as "no teams" in the settings page, which is a
    // better failure than a half-page presented as the whole set — but return
    // what we already have rather than discarding it.
    return teams;
  }

  // Alphabetical, because the API's order is not meaningful and a person
  // scanning several hundred names needs somewhere to start.
  return teams.sort((a, b) => a.name.localeCompare(b.name));
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
