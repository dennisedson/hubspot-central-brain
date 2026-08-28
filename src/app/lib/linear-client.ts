import type { LinearState } from './types';

const LINEAR_API = 'https://api.linear.app/graphql';

interface GraphQLResponse<T> {
  data: T;
  errors?: Array<{ message: string }>;
}

async function gql<T>(apiKey: string, query: string, variables: Record<string, string>): Promise<T> {
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
  return states.find(s => s.name === stateName)?.id ?? null;
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
