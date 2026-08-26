import { describe, it, expect, vi, beforeEach } from 'vitest';
import { updateTaskPipelineStage, findTaskByLinearIssueUrl, createTask } from '@lib/asana-client';

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

describe('createTask', () => {
  it('POSTs to /tasks with name, project, and custom fields', async () => {
    mockSuccess({ gid: 'new-task-99' });
    const customFields = { '1213736210804469': 'https://linear.app/issue/ENG-5', '1202184607659964': 'stage-gid-abc' };
    const result = await createTask('asana_pat', 'proj-1', 'My new task', customFields);

    expect(result).toEqual({ gid: 'new-task-99' });
    expect(mockFetch).toHaveBeenCalledWith(
      'https://app.asana.com/api/1.0/tasks',
      expect.objectContaining({ method: 'POST' }),
    );
    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.data.name).toBe('My new task');
    expect(body.data.projects).toEqual(['proj-1']);
    expect(body.data.custom_fields).toEqual(customFields);
  });

  it('throws when the API returns a non-ok response', async () => {
    mockError(400);
    await expect(createTask('pat', 'proj', 'title', {})).rejects.toThrow('400');
  });
});
