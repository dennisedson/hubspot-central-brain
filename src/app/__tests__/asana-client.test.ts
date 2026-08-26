import { describe, it, expect, vi, beforeEach } from 'vitest';
import { updateTaskPipelineStage, findTaskByLinearIssueUrl } from '@lib/asana-client';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

function mockSuccess(data: unknown) {
  mockFetch.mockResolvedValueOnce({
    ok: true,
    json: async () => ({ data }),
  });
}

function mockError(status: number) {
  mockFetch.mockResolvedValueOnce({ ok: false, status, statusText: 'Error', text: async () => 'Bad request' });
}

beforeEach(() => vi.clearAllMocks());

describe('updateTaskPipelineStage', () => {
  it('PATCHes the task with the correct custom field payload', async () => {
    mockSuccess({ gid: 'task-1', name: 'My task' });
    await updateTaskPipelineStage('asana_pat', 'task-1', 'stage-gid-123');

    expect(mockFetch).toHaveBeenCalledWith(
      'https://app.asana.com/api/1.0/tasks/task-1',
      expect.objectContaining({
        method: 'PUT',
        headers: expect.objectContaining({ Authorization: 'Bearer asana_pat' }),
      }),
    );

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.data.custom_fields['1202184607659964']).toBe('stage-gid-123');
  });

  it('throws when the API returns a non-ok response', async () => {
    mockError(403);
    await expect(updateTaskPipelineStage('pat', 'task-1', 'gid')).rejects.toThrow('403');
  });
});

describe('findTaskByLinearIssueUrl', () => {
  it('returns the task GID when a matching task is found', async () => {
    mockSuccess([{ gid: 'task-42', name: 'Found it' }]);
    const result = await findTaskByLinearIssueUrl('asana_pat', 'proj-1', 'https://linear.app/issue/ENG-1');
    expect(result).toBe('task-42');
  });

  it('returns null when no tasks match', async () => {
    mockSuccess([]);
    const result = await findTaskByLinearIssueUrl('asana_pat', 'proj-1', 'https://linear.app/issue/ENG-99');
    expect(result).toBeNull();
  });

  it('searches using the Linear Issue URL custom field GID', async () => {
    mockSuccess([]);
    await findTaskByLinearIssueUrl('asana_pat', 'proj-1', 'https://linear.app/issue/ENG-1');
    const url = mockFetch.mock.calls[0][0] as string;
    expect(url).toContain('1213736210804469');
    expect(url).toContain('proj-1');
  });

  it('throws when the API returns a non-ok response', async () => {
    mockError(500);
    await expect(findTaskByLinearIssueUrl('pat', 'proj', 'url')).rejects.toThrow('500');
  });
});
