import type { LinearState } from './types';
import { HS_SYNC_TAG } from './mapping';
import { isRollupPipeline, ROLLUP_PIPELINE_ID, type RollupRelease } from './rollup-doc';

const LINEAR_API = 'https://api.linear.app/graphql';

interface GraphQLResponse<T> {
  data: T;
  errors?: Array<{ message: string }>;
}

async function gql<T>(apiKey: string, query: string, variables: Record<string, unknown>): Promise<T> {
  const response = await fetch(LINEAR_API, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: apiKey,
    },
    body: JSON.stringify({ query, variables }),
  });

  if (!response.ok) {
    throw new Error(`Linear API HTTP error: ${response.status} ${response.statusText}`);
  }

  const result = (await response.json()) as GraphQLResponse<T>;
  if (result.errors?.length) {
    throw new Error(`Linear GraphQL error: ${result.errors[0].message}`);
  }
  return result.data;
}

export async function getLinearStates(apiKey: string, teamId: string): Promise<LinearState[]> {
  const query = `
    query GetTeamStates($teamId: String!) {
      team(id: $teamId) {
        states { nodes { id name type } }
      }
    }
  `;
  const data = await gql<{ team: { states: { nodes: LinearState[] } } | null }>(apiKey, query, { teamId });
  if (!data.team) throw new Error(`Linear team not found: ${teamId}`);
  const states = data.team.states.nodes;
  console.log(`Linear team ${teamId} states: ${states.map(s => s.name).join(', ')}`);
  return states;
}

export async function findStateIdByName(
  apiKey: string,
  teamId: string,
  stateName: string,
): Promise<string | null> {
  const states = await getLinearStates(apiKey, teamId);
  const lower = stateName.toLowerCase();
  return states.find(s => s.name.toLowerCase() === lower)?.id ?? null;
}

export interface IssueWorkflow {
  /** The state the issue is in now, by name. */
  currentState: string;
  /** Every workflow state of the team the issue is in now. */
  states: LinearState[];
}

/**
 * An issue's current state, and the states of the team it is in NOW — one
 * query, both halves of what SyncToLinear needs to decide whether to move it.
 *
 * Asked of the issue, not of a configured team. With assignee-first sync the
 * settings hold the sentinel 'any', and Linear answers team(id: "any") with
 * "Entity not found: Team"; and an issue moved to another team would otherwise
 * be handed a state id from the wrong one. The current state is what stops a
 * many-to-one stage map bouncing an issue Linear already has right. States are
 * paged strictly: a team with more than a page of them is refused rather than
 * half-searched.
 */
export async function getIssueWorkflow(apiKey: string, issueId: string): Promise<IssueWorkflow> {
  const data = await gql<{
    issue: {
      state: { name: string };
      team: { states: { nodes: LinearState[]; pageInfo: { hasNextPage: boolean } } };
    } | null;
  }>(
    apiKey,
    `query($issueId: String!) {
       issue(id: $issueId) {
         state { name }
         team { states(first: 250) { nodes { id name type } pageInfo { hasNextPage } } }
       }
     }`,
    { issueId },
  );
  if (!data.issue) throw new Error(`Linear issue not found: ${issueId}`);
  const { nodes, pageInfo } = data.issue.team.states;
  if (pageInfo.hasNextPage) {
    throw new Error(`The team of issue ${issueId} has more than 250 workflow states; refusing to search part of them`);
  }
  return { currentState: data.issue.state.name, states: nodes };
}

export async function updateLinearIssueState(
  apiKey: string,
  issueId: string,
  stateId: string,
): Promise<void> {
  const mutation = `
    mutation UpdateIssueState($issueId: String!, $stateId: String!) {
      issueUpdate(id: $issueId, input: { stateId: $stateId }) {
        success
        issue { id state { name } }
      }
    }
  `;
  const data = await gql<{ issueUpdate: { success: boolean } }>(apiKey, mutation, { issueId, stateId });
  if (!data.issueUpdate.success) {
    throw new Error(`Linear issueUpdate returned success: false for issue ${issueId}`);
  }
}

export interface CreatedLinearIssue {
  id: string;
  identifier: string;
  url: string;
}

export interface CreateIssueInput {
  teamId: string;
  title: string;
  description?: string;
  /** Omit to let Linear use the team's default state (normally Backlog). */
  stateId?: string;
}

/**
 * Create a Linear issue.
 *
 * The description ALWAYS carries HS_SYNC_TAG, and this function appends it
 * rather than trusting the caller to remember. Linear fires a webhook for every
 * issue that appears, including the ones we create; `LinearWebhook` skips any
 * payload whose description contains the tag, and that skip is the only thing
 * standing between this call and a second HubSpot record for work that already
 * has one.
 *
 * Putting the tag here rather than at the call site is the point. A caller who
 * forgot it would not fail here — it would succeed, and fail a minute later
 * somewhere else, as a duplicate record nobody can trace back to this line.
 */
export async function createIssue(
  apiKey: string,
  input: CreateIssueInput,
): Promise<CreatedLinearIssue> {
  const description = input.description?.includes(HS_SYNC_TAG)
    ? input.description
    : [input.description?.trim(), HS_SYNC_TAG].filter(Boolean).join('\n\n');

  const mutation = `
    mutation CreateIssue($input: IssueCreateInput!) {
      issueCreate(input: $input) {
        success
        issue { id identifier url }
      }
    }
  `;

  const data = await gql<{ issueCreate: { success: boolean; issue: CreatedLinearIssue | null } }>(
    apiKey,
    mutation,
    {
      input: {
        teamId: input.teamId,
        title: input.title,
        description,
        ...(input.stateId ? { stateId: input.stateId } : {}),
      },
    },
  );

  // success: false with no error array is Linear's way of refusing without
  // explaining. Returning a half-built object here would hand the caller an
  // undefined issue id to write into HubSpot.
  if (!data.issueCreate.success || !data.issueCreate.issue) {
    throw new Error(`Linear issueCreate returned success: false for team ${input.teamId}`);
  }
  return data.issueCreate.issue;
}

export interface LinearIssueDetail {
  identifier: string;
  title: string;
  state: string;
  assignee: string | null;
  updatedAt: string;
  url: string;
}

interface LinearIssueNode {
  identifier: string;
  title: string;
  updatedAt: string;
  url: string;
  state: { name: string } | null;
  assignee: { displayName: string } | null;
}

/**
 * The project an issue belongs to, or null.
 *
 * Separate from getLinearIssue because it is on the webhook's hot path and
 * needs one field, not a record summary. Called only when a project map is
 * configured AND the payload carried no project — with no map the label
 * decides and this is never reached.
 */
export async function getIssueProject(apiKey: string, issueId: string): Promise<{ id: string; name: string } | null> {
  try {
    const data = await gql<{ issue: { project?: { id: string; name: string } | null } | null }>(
      apiKey,
      `query($issueId: String!) { issue(id: $issueId) { project { id name } } }`,
      { issueId },
    );
    return data.issue?.project ?? null;
  } catch (err) {
    // An unreachable lookup must not fail the webhook. Returning null means
    // the label decides, which is the behaviour that predates the map.
    console.error('Could not read the issue project:', err instanceof Error ? err.message : err);
    return null;
  }
}

export async function getLinearIssue(apiKey: string, issueId: string): Promise<LinearIssueDetail | null> {
  const query = `
    query GetIssue($issueId: String!) {
      issue(id: $issueId) {
        identifier
        title
        updatedAt
        url
        state { name }
        assignee { displayName }
      }
    }
  `;
  const data = await gql<{ issue: LinearIssueNode | null }>(apiKey, query, { issueId });
  if (!data.issue) return null;
  return {
    identifier: data.issue.identifier,
    title: data.issue.title,
    state: data.issue.state?.name ?? 'Unknown',
    assignee: data.issue.assignee?.displayName ?? null,
    updatedAt: data.issue.updatedAt,
    url: data.issue.url,
  };
}

export interface Connection<T> {
  nodes: T[];
  pageInfo: { hasNextPage: boolean; endCursor?: string | null };
}

/** Linear caps a page at 250. */
const MAX_PAGE_SIZE = 250;
/** 40 pages of 250 is 10,000 nodes — far past anything this app reads. */
const MAX_PAGES = 40;

/**
 * Every node of one connection — or an error. Never part of it.
 *
 * Deliberately not AppSettingsApi's fetchAllPages, which returns what it has
 * when a later page fails. That is right for a settings dropdown and wrong for
 * the rollup sweep: there, an issue missing from a partial list reads as "not
 * in a rollup", and the sweep would clear a real link. So a failed page, a
 * missing cursor and running out of pages all throw.
 *
 * `first` and `after` are this function's variables; the query must declare
 * them and `variables` must not set them.
 */
export async function fetchEveryPage<D, T>(
  apiKey: string,
  query: string,
  variables: Record<string, unknown>,
  select: (data: D) => Connection<T> | null | undefined,
  pageSize = MAX_PAGE_SIZE,
): Promise<T[]> {
  const nodes: T[] = [];
  let after: string | null = null;
  for (let page = 0; page < MAX_PAGES; page++) {
    const data = await gql<D>(apiKey, query, { ...variables, first: pageSize, after });
    const conn = select(data);
    if (!conn) throw new Error('Linear returned no connection to page through');
    nodes.push(...conn.nodes);
    if (!conn.pageInfo.hasNextPage) return nodes;
    if (!conn.pageInfo.endCursor) throw new Error('Linear reported another page without a cursor');
    after = conn.pageInfo.endCursor;
  }
  throw new Error(`Linear connection ran past ${MAX_PAGES} pages; refusing to return part of it`);
}

/** A digest has a handful of links. A full page of them is not something to pick from. */
const LINKS_PAGE = 50;
/** Releases travel with their first page of issues. Verified under Linear's
 *  complexity limit at these sizes on 2026-10-20. */
const RELEASES_PAGE = 50;
const ISSUES_PAGE = 50;

interface LinkConnection {
  nodes: Array<{ url: string }>;
  pageInfo: { hasNextPage: boolean };
}

function linkUrls(links: LinkConnection, releaseName: string): string[] {
  if (links.pageInfo.hasNextPage) {
    throw new Error(`Release "${releaseName}" has more than ${LINKS_PAGE} links; refusing to pick a doc from part of them`);
  }
  return links.nodes.map(n => n.url);
}

export interface ReleaseDetail {
  name: string;
  pipelineId: string;
  linkUrls: string[];
}

/**
 * One release's name, pipeline and linked URLs. The webhook knows the id from
 * its payload; it asks for the pipeline here when the payload did not say.
 */
export async function getRelease(apiKey: string, releaseId: string): Promise<ReleaseDetail> {
  // An unknown id comes back as HTTP 200 with `Entity not found: Release` and
  // null data (observed 2026-10-20), which gql throws on. The null check is for
  // the null node Linear returns elsewhere for a bogus id.
  const data = await gql<{ release: { name: string; pipeline: { id: string }; links: LinkConnection } | null }>(
    apiKey,
    `query($id: String!) {
       release(id: $id) {
         name
         pipeline { id }
         links(first: ${LINKS_PAGE}) { nodes { url } pageInfo { hasNextPage } }
       }
     }`,
    { id: releaseId },
  );
  if (!data.release) throw new Error(`Linear release not found: ${releaseId}`);
  return {
    name: data.release.name,
    pipelineId: data.release.pipeline.id,
    linkUrls: linkUrls(data.release.links, data.release.name),
  };
}

interface ReleaseNode {
  id: string;
  name: string;
  pipeline: { id: string };
  links: LinkConnection;
  issues: Connection<{ id: string }>;
}

const ROLLUP_RELEASES = `
  query($first: Int!, $after: String, $pipelineId: ID!) {
    releases(first: $first, after: $after, filter: { pipeline: { id: { eq: $pipelineId } } }) {
      nodes {
        id
        name
        pipeline { id }
        links(first: ${LINKS_PAGE}) { nodes { url } pageInfo { hasNextPage } }
        issues(first: ${ISSUES_PAGE}) { nodes { id } pageInfo { hasNextPage endCursor } }
      }
      pageInfo { hasNextPage endCursor }
    }
  }`;

const RELEASE_ISSUES = `
  query($id: String!, $first: Int!, $after: String) {
    release(id: $id) {
      issues(first: $first, after: $after) { nodes { id } pageInfo { hasNextPage endCursor } }
    }
  }`;

/**
 * Every release in the rollup pipeline — monthly rollups and Spotlights — with
 * its links and ALL of its issue ids. Filtered by pipeline id in the query, and
 * checked again here.
 *
 * One request in the ordinary case: each release's first page of issues rides
 * along with it. A release with more issues than that is re-read to the end.
 */
export async function listRollupReleases(apiKey: string): Promise<RollupRelease[]> {
  const releases = await fetchEveryPage<{ releases: Connection<ReleaseNode> }, ReleaseNode>(
    apiKey,
    ROLLUP_RELEASES,
    { pipelineId: ROLLUP_PIPELINE_ID },
    d => d.releases,
    RELEASES_PAGE,
  );

  const rollups: RollupRelease[] = [];
  for (const r of releases.filter(r => isRollupPipeline(r.pipeline?.id))) {
    const issues = r.issues.pageInfo.hasNextPage
      ? await fetchEveryPage<{ release: { issues: Connection<{ id: string }> } | null }, { id: string }>(
          apiKey,
          RELEASE_ISSUES,
          { id: r.id },
          d => d.release?.issues,
        )
      : r.issues.nodes;
    rollups.push({
      id: r.id,
      name: r.name,
      pipelineId: r.pipeline.id,
      linkUrls: linkUrls(r.links, r.name),
      issueIds: issues.map(i => i.id),
    });
  }
  return rollups;
}
