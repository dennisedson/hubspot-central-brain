import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getLinearStates, findStateIdByName, updateLinearIssueState, createIssue } from '@lib/linear-client';
import { HS_SYNC_TAG } from '@lib/mapping';

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
    json: async () => ({ data: { team: { states: { nodes: STATES } } } }),
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

describe('createIssue', () => {
  function mockCreated(issue: unknown = { id: 'iss-1', identifier: 'ENG-7', url: 'https://linear.app/t/issue/ENG-7' }) {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ data: { issueCreate: { success: true, issue } } }),
    });
  }

  function sentInput(): Record<string, string> {
    return JSON.parse(String(mockFetch.mock.calls[0][1].body)).variables.input;
  }

  it('returns the created issue id and url', async () => {
    mockCreated();
    const issue = await createIssue('lin_key', { teamId: 'team-1', title: 'Promoted note' });
    expect(issue.id).toBe('iss-1');
    expect(issue.url).toBe('https://linear.app/t/issue/ENG-7');
  });

  // THE echo-loop guard. Linear fires a webhook for the issue we just created;
  // LinearWebhook skips any description carrying this tag. Without it that
  // webhook creates a SECOND HubSpot record for work that already has one.
  it('always tags the description, even when the caller passes none', async () => {
    mockCreated();
    await createIssue('lin_key', { teamId: 'team-1', title: 'Promoted note' });
    expect(sentInput().description).toContain(HS_SYNC_TAG);
  });

  it('tags a description the caller did supply, keeping their text', async () => {
    mockCreated();
    await createIssue('lin_key', { teamId: 'team-1', title: 'x', description: 'Context for the issue.' });
    const description = sentInput().description;
    expect(description).toContain('Context for the issue.');
    expect(description).toContain(HS_SYNC_TAG);
  });

  // A caller that already tagged its text must not end up with two tags — the
  // guard reads `includes`, so a double tag is harmless, but a description that
  // grows a tag per call is the kind of thing nobody notices until it is ugly.
  it('does not tag twice when the description already carries the tag', async () => {
    mockCreated();
    await createIssue('lin_key', { teamId: 'team-1', title: 'x', description: `Already ${HS_SYNC_TAG} tagged` });
    const occurrences = sentInput().description.split(HS_SYNC_TAG).length - 1;
    expect(occurrences).toBe(1);
  });

  it('sends the state id when given one, so the issue opens at the right state', async () => {
    mockCreated();
    await createIssue('lin_key', { teamId: 'team-1', title: 'x', stateId: 'st-todo' });
    expect(sentInput().stateId).toBe('st-todo');
  });

  // Omitted rather than sent as undefined: Linear then applies the team default
  // instead of rejecting a null state.
  it('omits stateId entirely when none is given', async () => {
    mockCreated();
    await createIssue('lin_key', { teamId: 'team-1', title: 'x' });
    expect('stateId' in sentInput()).toBe(false);
  });

  it('throws when the API returns success: false', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ data: { issueCreate: { success: false, issue: null } } }),
    });
    await expect(createIssue('lin_key', { teamId: 'team-1', title: 'x' })).rejects.toThrow('success: false');
  });

  // success: true with no issue would otherwise hand the caller an undefined id
  // to write into HubSpot, which is worse than failing.
  it('throws when the API reports success but returns no issue', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ data: { issueCreate: { success: true, issue: null } } }),
    });
    await expect(createIssue('lin_key', { teamId: 'team-1', title: 'x' })).rejects.toThrow('success: false');
  });

  it('throws when the API returns GraphQL errors', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ errors: [{ message: 'Team not found' }] }),
    });
    await expect(createIssue('lin_key', { teamId: 'nope', title: 'x' })).rejects.toThrow('Team not found');
  });
});
