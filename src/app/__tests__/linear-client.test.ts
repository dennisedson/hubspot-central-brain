import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getLinearStates, findStateIdByName, updateLinearIssueState } from '@lib/linear-client';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

const STATES = [
  { id: 'st-1', name: 'Backlog', type: 'backlog' },
  { id: 'st-2', name: 'In Progress', type: 'started' },
  { id: 'st-3', name: 'Done', type: 'completed' },
];

function mockStatesResponse() {
  mockFetch.mockResolvedValueOnce({
    ok: true,
    json: async () => ({ data: { teams: { nodes: [{ states: { nodes: STATES } }] } } }),
  });
}

beforeEach(() => vi.clearAllMocks());

describe('getLinearStates', () => {
  it('returns the states array from the API', async () => {
    mockStatesResponse();
    const result = await getLinearStates('lin_key', 'team-1');
    expect(result).toEqual(STATES);
    expect(mockFetch).toHaveBeenCalledWith(
      'https://api.linear.app/graphql',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ Authorization: 'lin_key' }),
      }),
    );
  });
});

describe('findStateIdByName', () => {
  it('returns the id of a matching state', async () => {
    mockStatesResponse();
    expect(await findStateIdByName('lin_key', 'team-1', 'In Progress')).toBe('st-2');
  });

  it('returns null when no state matches', async () => {
    mockStatesResponse();
    expect(await findStateIdByName('lin_key', 'team-1', 'Nonexistent')).toBeNull();
  });
});

describe('updateLinearIssueState', () => {
  it('resolves when the API returns success: true', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ data: { issueUpdate: { success: true, issue: { id: 'i-1', state: { name: 'Done' } } } } }),
    });
    await expect(updateLinearIssueState('lin_key', 'i-1', 'st-3')).resolves.toBeUndefined();
  });

  it('throws when the API returns success: false', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ data: { issueUpdate: { success: false } } }),
    });
    await expect(updateLinearIssueState('lin_key', 'i-1', 'st-3')).rejects.toThrow('success: false');
  });

  it('throws when the API returns GraphQL errors', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ errors: [{ message: 'Not authorized' }] }),
    });
    await expect(updateLinearIssueState('lin_key', 'i-1', 'st-3')).rejects.toThrow('Not authorized');
  });

  it('throws when the HTTP request fails', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 503, statusText: 'Service Unavailable' });
    await expect(updateLinearIssueState('lin_key', 'i-1', 'st-3')).rejects.toThrow('503');
  });
});
