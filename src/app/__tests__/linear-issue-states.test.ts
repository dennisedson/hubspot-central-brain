import { describe, it, expect, vi, beforeEach } from 'vitest';
import { findIssueStateIdByName } from '@lib/linear-client';

/**
 * Its own file because linear-client.test.ts queues responses in call order.
 * Shapes are what Linear returned for DEVADV-876 on 2026-10-20.
 */

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

const ok = (body: unknown) => ({ ok: true, status: 200, statusText: 'OK', json: async () => body });

const DEVADV_STATES = ['Triage', 'Duplicate', 'Backlog', 'Canceled', 'In Review', 'Todo', 'In Progress', 'Done']
  .map((name, i) => ({ id: `st-${i}`, name, type: 'unstarted' }));

function issueWithStates(states = DEVADV_STATES, hasNextPage = false) {
  return { data: { issue: { team: { states: { nodes: states, pageInfo: { hasNextPage } } } } } };
}

beforeEach(() => {
  mockFetch.mockReset();
});

describe('findIssueStateIdByName', () => {
  it("finds the state in the issue's own team, asking about the issue — not a team", async () => {
    mockFetch.mockImplementation(async (_url: string, init: { body: string }) => {
      const { query, variables } = JSON.parse(init.body);
      expect(query).toContain('issue(id: $issueId)');
      expect(query).not.toContain('team(id');
      expect(variables.issueId).toBe('DEVADV-876');
      return ok(issueWithStates());
    });

    expect(await findIssueStateIdByName('k', 'DEVADV-876', 'In Review')).toBe('st-4');
  });

  it('matches the state name case-insensitively', async () => {
    mockFetch.mockResolvedValue(ok(issueWithStates()));
    expect(await findIssueStateIdByName('k', 'DEVADV-876', 'in progress')).toBe('st-6');
  });

  it("is null when the issue's team has no state by that name", async () => {
    mockFetch.mockResolvedValue(ok(issueWithStates()));
    expect(await findIssueStateIdByName('k', 'DEVADV-876', 'Published')).toBeNull();
  });

  it('throws on the error Linear sends for an unknown issue', async () => {
    mockFetch.mockResolvedValue(ok({ data: null, errors: [{ message: 'Entity not found: Issue' }] }));
    await expect(findIssueStateIdByName('k', 'nope', 'Done')).rejects.toThrow(/Entity not found/);
  });

  it('throws rather than search part of a team\'s states', async () => {
    mockFetch.mockResolvedValue(ok(issueWithStates(DEVADV_STATES.slice(0, 2), true)));
    await expect(findIssueStateIdByName('k', 'DEVADV-876', 'Done')).rejects.toThrow(/states/);
  });
});
