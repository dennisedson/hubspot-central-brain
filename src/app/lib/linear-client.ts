import type { LinearState } from './types';
import { HS_SYNC_TAG } from './mapping';

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
