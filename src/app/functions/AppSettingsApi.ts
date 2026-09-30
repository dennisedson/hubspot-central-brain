import { getPortalConfig, DEFAULT_APP_SETTINGS, isConfigured } from '../lib/portal-config';
import type { AppSettings } from '../lib/portal-config';
import { HS_BASE, objectPath, objectSearchPath } from '../lib/hs-api';
import { upsertContent } from '../lib/hubspot-client';
import { HS_SYNC_TAG, isAnyTeam, classifyIssue, parseProjectMap, parseUnmappedProjects } from '../lib/mapping';

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
 * Every node of a Linear connection, paged.
 *
 * Shared because this was the same bug three times. Linear defaults a
 * connection to 50 and caps a page at 250, so a single request is a page, not
 * a set — and a truncated list does not look truncated once it is sorted.
 * Measured against the live workspace: 452 active users, of which one page
 * held 250, ordered "Abby Mueller … Zhuangda Zhu" — a complete-looking A-to-Z
 * sweep missing 202 people from the middle. The person configuring the portal
 * was #347, so he could not find himself in the list of people he might be.
 *
 * Returns what it has if a later page fails: a partial list beats nothing, as
 * long as no caller sorts it into looking whole without paging first.
 */
async function fetchAllPages<T>(
  apiKey: string,
  connection: 'teams' | 'users' | 'projects',
  query: string,
): Promise<T[]> {
  const nodes: T[] = [];
  let after: string | null = null;

  try {
    for (let page = 0; page < MAX_PAGES; page++) {
      const data: { data: Record<string, unknown> } = await linearQuery(
        query,
        { first: LINEAR_PAGE_SIZE, after },
        apiKey,
      );

      const conn = data.data?.[connection] as
        | { nodes: T[]; pageInfo: { hasNextPage: boolean; endCursor: string | null } }
        | undefined;
      if (!conn) break;

      nodes.push(...(conn.nodes ?? []));
      if (!conn.pageInfo?.hasNextPage || !conn.pageInfo.endCursor) break;
      after = conn.pageInfo.endCursor;
    }
  } catch {
    return nodes;
  }

  return nodes;
}

/** The API's order is not meaningful, and a person scanning hundreds of names needs somewhere to start. */
function byName<T extends { name: string }>(a: T, b: T): number {
  return a.name.localeCompare(b.name);
}

/** Every Linear team the API key can see. */
export async function getLinearTeams(apiKey: string): Promise<LinearTeam[]> {
  const teams = await fetchAllPages<LinearTeam>(
    apiKey,
    'teams',
    `query($first: Int!, $after: String) {
       teams(first: $first, after: $after) {
         nodes { id name }
         pageInfo { hasNextPage endCursor }
       }
     }`,
  );
  return teams.sort(byName);
}

/**
 * Everyone active in the workspace.
 *
 * Needed because the assignee list used to come from the selected team, and
 * with "Any team" there is no team to ask. Suspended accounts are filtered
 * out — they are not people anyone should be able to declare themselves to be.
 */
export async function getWorkspaceMembers(apiKey: string): Promise<LinearMember[]> {
  const users = await fetchAllPages<LinearMember>(
    apiKey,
    'users',
    `query($first: Int!, $after: String) {
       users(first: $first, after: $after, filter: { active: { eq: true } }) {
         nodes { id name }
         pageInfo { hasNextPage endCursor }
       }
     }`,
  );
  return users.sort(byName);
}

/** Every Linear project, so the settings page can offer a row per project. */
export async function getLinearProjects(apiKey: string): Promise<LinearTeam[]> {
  const projects = await fetchAllPages<LinearTeam>(
    apiKey,
    'projects',
    `query($first: Int!, $after: String) {
       projects(first: $first, after: $after) {
         nodes { id name }
         pageInfo { hasNextPage endCursor }
       }
     }`,
  );
  return projects.sort(byName);
}

/** Projects where a specific person is a member. */
async function getMemberProjects(apiKey: string, memberId: string): Promise<LinearTeam[]> {
  const projects: LinearTeam[] = [];
  let after: string | null = null;

  try {
    for (let page = 0; page < MAX_PAGES; page++) {
      const data = await linearQuery(
        `query($first: Int!, $after: String, $memberId: String!) {
           projects(first: $first, after: $after, filter: { members: { id: { eq: $memberId } } }) {
             nodes { id name }
             pageInfo { hasNextPage endCursor }
           }
         }`,
        { first: LINEAR_PAGE_SIZE, after, memberId },
        apiKey,
      );

      const conn = data.data?.projects as
        | { nodes: LinearTeam[]; pageInfo: { hasNextPage: boolean; endCursor: string | null } }
        | undefined;
      if (!conn) break;
      projects.push(...(conn.nodes ?? []));
      if (!conn.pageInfo?.hasNextPage || !conn.pageInfo.endCursor) break;
      after = conn.pageInfo.endCursor;
    }
  } catch {
    return projects;
  }

  return projects.sort(byName);
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
  project?: { id: string; name: string } | null;
  assignee?: { id: string; name: string } | null;
}

/**
 * One page of issues assigned to a person, across every team they belong to.
 *
 * This is the path that matters. A team-scoped filter stops covering someone's
 * work the day they join another team, silently — measured on production, 75
 * of 83 assigned issues sat outside the single configured team.
 */
async function fetchAssignedPage(
  apiKey: string,
  assigneeId: string,
  after: string | null,
  pageSize: number = BACKFILL_PAGE_SIZE,
): Promise<{ nodes: BackfillIssue[]; hasNextPage: boolean; endCursor: string | null }> {
  const data = await linearQuery(
    `query($id: String!, $first: Int!, $after: String) {
       user(id: $id) {
         assignedIssues(first: $first, after: $after) {
           nodes {
             id identifier title description url
             state { id name type }
             labels { nodes { id name } }
             team { id name }
             project { id name }
             assignee { id name }
           }
           pageInfo { hasNextPage endCursor }
         }
       }
     }`,
    { id: assigneeId, first: pageSize, after },
    apiKey,
  );

  const conn = (data.data?.user as { assignedIssues?: { nodes: BackfillIssue[]; pageInfo: { hasNextPage: boolean; endCursor: string | null } } } | undefined)?.assignedIssues;
  return {
    nodes: conn?.nodes ?? [],
    hasNextPage: conn?.pageInfo?.hasNextPage ?? false,
    endCursor: conn?.pageInfo?.endCursor ?? null,
  };
}

/** One page of a team's issues, oldest first so the order is stable across runs. */
async function fetchIssuePage(
  apiKey: string,
  teamId: string,
  after: string | null,
  pageSize: number = BACKFILL_PAGE_SIZE,
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
             project { id name }
             assignee { id name }
           }
           pageInfo { hasNextPage endCursor }
         }
       }
     }`,
    { teamId, first: pageSize, after },
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
        ['linear_team_id', 'assignee_filter', 'linear_assignee_id', 'linear_project_map', 'linear_unmapped_projects'],
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
        // isAnyTeam, not a truthiness check. The "any team" sentinel is the
        // string 'any' — linear_team_id is the App Config object's primary
        // display property and HubSpot refuses to let it be cleared — so a
        // truthy test sent 'any' to a team-scoped query, which matches no team
        // and yields nobody to pick from.
        linearApiKey
          ? isAnyTeam(settings.linearTeamId)
            ? getWorkspaceMembers(linearApiKey)
            : getLinearTeamMembers(settings.linearTeamId, linearApiKey)
          : Promise.resolve<LinearMember[]>([]),
      ]);

      const projectMap = parseProjectMap(record?.properties.linear_project_map);
      const unmapped = parseUnmappedProjects(record?.properties.linear_unmapped_projects);

      const useFilter = settings.assigneeFilter === 'mine' && settings.linearAssigneeId;
      const memberProjects = linearApiKey
        ? useFilter
          ? await getMemberProjects(linearApiKey, settings.linearAssigneeId)
          : await getLinearProjects(linearApiKey)
        : [];

      const seen = new Set(memberProjects.map(p => p.id));
      const extras: LinearTeam[] = [];
      for (const id of Object.keys(projectMap)) {
        if (!seen.has(id)) extras.push({ id, name: id });
      }
      for (const u of unmapped) {
        if (!seen.has(u.id)) extras.push({ id: u.id, name: u.name });
      }
      const projects = [...memberProjects, ...extras.sort(byName)];

      return {
        statusCode: 200,
        body: JSON.stringify({
          ...settings,
          teams,
          teamMembers,
          projects,
          projectMap,
          unmappedProjects: unmapped,
        }),
      };
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      return { statusCode: 500, body: JSON.stringify({ error: 'Failed to load settings', detail }) };
    }
  }

  if (action === 'loadTeamMembers') {
    const teamId = param(context, 'teamId');
    if (!linearApiKey) {
      return { statusCode: 200, body: JSON.stringify({ teamMembers: [] }) };
    }
    // "Any team" — whether that arrives as the 'any' sentinel or as nothing at
    // all — means the assignee can be anyone in the workspace rather than
    // anyone on a team.
    const teamMembers = isAnyTeam(teamId ?? '')
      ? await getWorkspaceMembers(linearApiKey)
      : await getLinearTeamMembers(teamId as string, linearApiKey);
    return { statusCode: 200, body: JSON.stringify({ teamMembers }) };
  }

  if (action === 'saveSettings') {
    const linearTeamId = param(context, 'linearTeamId');
    const assigneeFilter = param(context, 'assigneeFilter');
    const linearAssigneeId = param(context, 'linearAssigneeId');
    // linearTeamId is optional now — empty means "any team, filtered by
    // assignee". isConfigured is what decides whether the result is usable.
    if (!assigneeFilter) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Missing required fields' }) };
    }
    if (!isConfigured({
      linearTeamId: linearTeamId ?? '',
      assigneeFilter: assigneeFilter as AppSettings['assigneeFilter'],
      linearAssigneeId: linearAssigneeId ?? '',
    })) {
      return {
        statusCode: 400,
        body: JSON.stringify({
          error: 'Choose a Linear team, or filter by "mine" and pick yourself. Without one of those nothing bounds the sync.',
        }),
      };
    }

    const properties: Record<string, string> = {
      linear_team_id: linearTeamId ?? '',
      assignee_filter: assigneeFilter,
      linear_assignee_id: linearAssigneeId ?? '',
    };

    // Re-parsed before storing, so a malformed value from the page cannot be
    // written and then break every later read.
    const projectMapRaw = param(context, 'projectMap');
    if (projectMapRaw !== undefined) {
      const map = parseProjectMap(projectMapRaw);
      properties.linear_project_map = JSON.stringify(map);

      // Anything the new map covers is decided, so it stops being a prompt.
      // Done here rather than in the page so the list cannot drift from the
      // map that supposedly resolved it.
      const existing = await hsSearch(objectTypeId, ['linear_unmapped_projects'], token);
      const stillUnmapped = parseUnmappedProjects(
        existing.results[0]?.properties.linear_unmapped_projects,
      ).filter(u => !map[u.id]);
      properties.linear_unmapped_projects = JSON.stringify(stillUnmapped);
    }

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

  // Shared by the preview and the import: everything eligible, already
  // filtered by the same rules the webhook applies.
  async function eligibleIssues(hsToken: string) {
    const current = await hsSearch(
      objectTypeId,
      ['linear_team_id', 'assignee_filter', 'linear_assignee_id', 'linear_project_map'],
      hsToken,
    );
    const record = current.results[0];
    const settings: AppSettings = {
      linearTeamId: record?.properties.linear_team_id ?? '',
      assigneeFilter: (record?.properties.assignee_filter as AppSettings['assigneeFilter']) ?? 'all',
      linearAssigneeId: record?.properties.linear_assignee_id ?? '',
    };

    const projectMap = parseProjectMap(record?.properties.linear_project_map);

    if (!isConfigured(settings)) {
      throw new Error('Choose a Linear team, or filter by "mine" and pick yourself, then save.');
    }
    if (!linearApiKey) throw new Error('LINEAR_API_KEY is not set on this portal.');
    const apiKey: string = linearApiKey;

    // Every page at once. A preview writes nothing, so it is not bound by the
    // per-request budget an import is.
    const issues: BackfillIssue[] = [];
    let after: string | null = null;
    for (let page = 0; page < 40; page++) {
      const result: { nodes: BackfillIssue[]; hasNextPage: boolean; endCursor: string | null } =
        isAnyTeam(settings.linearTeamId)
        ? await fetchAssignedPage(apiKey, settings.linearAssigneeId, after, 250)
        : await fetchIssuePage(apiKey, settings.linearTeamId, after, 250);
      issues.push(...result.nodes);
      if (!result.hasNextPage || !result.endCursor) break;
      after = result.endCursor;
    }

    let skippedEcho = 0, skippedAssignee = 0, skippedIgnored = 0;
    const eligible = issues.filter(issue => {
      if (issue.description?.includes(HS_SYNC_TAG)) { skippedEcho++; return false; }
      const assigneeId = issue.assignee?.id ?? null;
      if (settings.assigneeFilter === 'assigned' && !assigneeId) { skippedAssignee++; return false; }
      if (settings.assigneeFilter === 'mine' && assigneeId !== settings.linearAssigneeId) {
        skippedAssignee++; return false;
      }
      // Mapped to "ignore": not content, not a changelog, not wanted.
      if (classifyIssue(issue.labels.nodes, issue.project?.id, projectMap) === 'ignore') {
        skippedIgnored++; return false;
      }
      return true;
    });

    return { eligible, scanned: issues.length, skippedEcho, skippedAssignee, skippedIgnored, projectMap };
  }

  // Read-only. Nothing is written, so this is safe to run repeatedly and is
  // what the settings page shows before anyone commits to an import — the CLI
  // has had a dry run since it was written and the button did not, which was
  // the wrong way round.
  if (action === 'backfillPreview') {
    try {
      const { eligible, scanned, skippedEcho, skippedAssignee, skippedIgnored, projectMap } = await eligibleIssues(token);
      return {
        statusCode: 200,
        body: JSON.stringify({
          scanned,
          skippedEcho,
          skippedAssignee,
          skippedIgnored,
          issues: eligible.map(i => ({
            id: i.id,
            identifier: i.identifier,
            title: i.title,
            state: i.state.name,
            team: i.team.name,
            project: i.project?.name ?? null,
            kind: classifyIssue(i.labels.nodes, i.project?.id, projectMap),
          })),
        }),
      };
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      return { statusCode: 400, body: JSON.stringify({ error: detail }) };
    }
  }

  // Imports exactly the ids it is given. The caller decides what and how many,
  // so each request is bounded by construction — no stored cursor, and closing
  // the page cannot leave a half-walked position behind.
  if (action === 'backfill') {
    const idsParam = param(context, 'ids');
    if (!idsParam) {
      return { statusCode: 400, body: JSON.stringify({ error: 'No issues selected.' }) };
    }
    const wanted = new Set(idsParam.split(',').map(x => x.trim()).filter(Boolean));

    try {
      const { eligible, projectMap } = await eligibleIssues(token);
      const chosen = eligible.filter(i => wanted.has(i.id));

      let created = 0, updated = 0;
      const errors: string[] = [];
      for (const issue of chosen) {
        const pipelineKey = classifyIssue(issue.labels.nodes, issue.project?.id, projectMap) === 'changelog' ? 'changelog' : 'content';
        try {
          // The same upsert the webhook calls, matching on linear_id — so a
          // repeated or overlapping import updates rather than duplicating.
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
        } catch (err) {
          errors.push(`${issue.identifier}: ${err instanceof Error ? err.message : String(err)}`);
        }
      }

      return {
        statusCode: 200,
        body: JSON.stringify({ requested: wanted.size, imported: chosen.length, created, updated, errors }),
      };
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      return { statusCode: 500, body: JSON.stringify({ error: 'Import failed', detail }) };
    }
  }

  return { statusCode: 400, body: JSON.stringify({ error: `Unknown action: ${action}` }) };
}
