import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getIssueWorkflow } from '@lib/linear-client';

/**
 * Its own file because linear-client.test.ts queues responses in call order.
 * Shapes are what Linear returned for DEVADV-876 on 2026-10-20.
 */

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

const ok = (body: unknown) => ({ ok: true, status: 200, statusText: 'OK', json: async () => body });

const DEVADV_STATES = ['Triage', 'Duplicate', 'Backlog', 'Canceled', 'In Review', 'Todo', 'In Progress', 'Done']
  .map((name, i) => ({ id: `st-${i}`, name, type: 'unstarted' }));

function issueWithStates(states = DEVADV_STATES, hasNextPage = false, current = 'Todo') {
  return { data: { issue: { state: { name: current }, team: { states: { nodes: states, pageInfo: { hasNextPage } } } } } };
}

beforeEach(() => {
  mockFetch.mockReset();
});

describe('getIssueWorkflow', () => {
  it("returns the issue's current state and its own team's states, asking about the issue — not a team", async () => {
    mockFetch.mockImplementation(async (_url: string, init: { body: string }) => {
      const { query, variables } = JSON.parse(init.body);
      expect(query).toContain('issue(id: $issueId)');
      expect(query).toContain('state { name }');
      expect(query).not.toContain('team(id');
      expect(variables.issueId).toBe('DEVADV-876');
      return ok(issueWithStates(DEVADV_STATES, false, 'In Progress'));
    });

    const workflow = await getIssueWorkflow('k', 'DEVADV-876');
    expect(workflow.currentState).toBe('In Progress');
    expect(workflow.states.map(s => s.name)).toEqual(DEVADV_STATES.map(s => s.name));
  });

  it('throws on the error Linear sends for an unknown issue', async () => {
    mockFetch.mockResolvedValue(ok({ data: null, errors: [{ message: 'Entity not found: Issue' }] }));
    await expect(getIssueWorkflow('k', 'nope')).rejects.toThrow(/Entity not found/);
  });

  it("throws rather than return part of a team's states", async () => {
    mockFetch.mockResolvedValue(ok(issueWithStates(DEVADV_STATES.slice(0, 2), true)));
    await expect(getIssueWorkflow('k', 'DEVADV-876')).rejects.toThrow(/states/);
  });
});
