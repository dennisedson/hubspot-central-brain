import { getPortalConfig, DEFAULT_APP_SETTINGS, isConfigured } from '../lib/portal-config';
import type { AppSettings } from '../lib/portal-config';
import { HS_BASE, objectPath, objectSearchPath } from '../lib/hs-api';
import { upsertContent } from '../lib/hubspot-client';
import { HS_SYNC_TAG, LINEAR_CHANGELOG_LABEL } from '../lib/mapping';

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

/**
 * How many issues one invocation imports.
 *
 * Deliberately small. Each issue costs a HubSpot search plus a create or
 * update, and a serverless function has seconds rather than minutes — so this
 * imports a page per call and hands the cursor back, instead of trying to
 * finish a several-hundred-issue workspace in one request and timing out
 * halfway with no record of where it got to.
 */
const BACKFILL_PAGE_SIZE = 15;

interface BackfillIssue {
  id: string;
  identifier: string;
  title: string;
  description?: string;
  url: string;
  state: { id: string; name: string; type: string };
  labels: { nodes: Array<{ id: string; name: string }> };
  team: { id: string; name: string };
  assignee?: { id: string; name: string } | null;
}

/** One page of a team's issues, oldest first so the order is stable across runs. */
async function fetchIssuePage(
  apiKey: string,
  teamId: string,
  after: string | null,
): Promise<{ nodes: BackfillIssue[]; hasNextPage: boolean; endCursor: string | null }> {
  const data = await linearQuery(
    `query($teamId: String!, $first: Int!, $after: String) {
       team(id: $teamId) {
         issues(first: $first, after: $after, orderBy: createdAt) {
           nodes {
             id identifier title description url
             state { id name type }
             labels { nodes { id name } }
             team { id name }
             assignee { id name }
           }
           pageInfo { hasNextPage endCursor }
         }
       }
     }`,
    { teamId, first: BACKFILL_PAGE_SIZE, after },
    apiKey,
  );

  const conn = (data.data?.team as { issues?: { nodes: BackfillIssue[]; pageInfo: { hasNextPage: boolean; endCursor: string | null } } } | undefined)?.issues;
  return {
    nodes: conn?.nodes ?? [],
    hasNextPage: conn?.pageInfo?.hasNextPage ?? false,
    endCursor: conn?.pageInfo?.endCursor ?? null,
  };
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

  if (action === 'backfill') {
    // Importing into a portal nobody has configured is exactly how 34 unwanted
    // records arrived on production. Same gate the webhook uses.
    const current = await hsSearch(
      objectTypeId,
      ['linear_team_id', 'assignee_filter', 'linear_assignee_id', 'linear_backfill_cursor', 'linear_backfill_count'],
      token,
    );
    const record = current.results[0];
    const settings: AppSettings = {
      linearTeamId: record?.properties.linear_team_id ?? '',
      assigneeFilter: (record?.properties.assignee_filter as AppSettings['assigneeFilter']) ?? 'all',
      linearAssigneeId: record?.properties.linear_assignee_id ?? '',
    };

    if (!isConfigured(settings)) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Choose a Linear team and save your settings before importing.' }),
      };
    }
    if (!linearApiKey) {
      return { statusCode: 500, body: JSON.stringify({ error: 'LINEAR_API_KEY is not set on this portal.' }) };
    }

    const reset = param(context, 'reset') === 'true';
    const cursor = reset ? null : (record?.properties.linear_backfill_cursor || null);
    const alreadyImported = reset ? 0 : parseInt(record?.properties.linear_backfill_count || '0', 10) || 0;

    try {
      const page = await fetchIssuePage(linearApiKey, settings.linearTeamId, cursor);

      let created = 0, updated = 0, skipped = 0;
      for (const issue of page.nodes) {
        // Issues our own sync wrote. Re-importing them would be circular.
        if (issue.description?.includes(HS_SYNC_TAG)) { skipped++; continue; }

        const assigneeId = issue.assignee?.id ?? null;
        if (settings.assigneeFilter === 'assigned' && !assigneeId) { skipped++; continue; }
        if (settings.assigneeFilter === 'mine' && assigneeId !== settings.linearAssigneeId) { skipped++; continue; }

        const pipelineKey = issue.labels.nodes.some(l => l.name === LINEAR_CHANGELOG_LABEL) ? 'changelog' : 'content';
        // The same upsert the webhook calls, matching on linear_id — so a
        // resumed or repeated run updates rather than duplicating.
        const result = await upsertContent(
          {
            action: 'update',
            type: 'Issue',
            data: {
              id: issue.id,
              identifier: issue.identifier,
              title: issue.title,
              description: issue.description,
              state: issue.state,
              labels: issue.labels.nodes,
              url: issue.url,
              team: issue.team,
              assignee: issue.assignee ?? null,
            },
            organizationId: 'backfill',
            webhookTimestamp: Date.now(),
            webhookId: 'backfill',
          },
          portalId,
          pipelineKey,
        );
        if (result.action === 'created') created++; else updated++;
      }

      const totalImported = alreadyImported + created + updated;
      const done = !page.hasNextPage || !page.endCursor;

      // Persist before returning. A browser closed mid-import then resumes from
      // here rather than starting over — which is the whole point of storing a
      // cursor instead of looping inside one request.
      if (record?.id) {
        await hsUpdate(
          objectTypeId,
          record.id,
          {
            linear_backfill_cursor: done ? '' : (page.endCursor ?? ''),
            linear_backfill_count: String(totalImported),
          },
          token,
        );
      }

      return {
        statusCode: 200,
        body: JSON.stringify({
          scanned: page.nodes.length,
          created, updated, skipped,
          totalImported,
          done,
        }),
      };
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      // The cursor is untouched on failure, so retrying repeats this page
      // rather than skipping it. The upsert is idempotent, so that is safe.
      return { statusCode: 500, body: JSON.stringify({ error: 'Import failed', detail }) };
    }
  }

  return { statusCode: 400, body: JSON.stringify({ error: `Unknown action: ${action}` }) };
}
