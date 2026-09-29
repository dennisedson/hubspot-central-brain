import { describe, it, expect, vi, afterEach } from 'vitest';
import { getLinearIssue } from '../lib/linear-client';
import { getAsanaTask } from '../lib/asana-client';

afterEach(() => vi.unstubAllGlobals());

function stubFetch(payload: unknown, ok = true, status = 200) {
  const fn = vi.fn().mockResolvedValue({
    ok,
    status,
    statusText: 'x',
    json: async () => payload,
    text: async () => JSON.stringify(payload),
  });
  vi.stubGlobal('fetch', fn);
  return fn;
}

describe('getLinearIssue', () => {
  it('maps a Linear issue to the detail shape', async () => {
    stubFetch({
      data: {
        issue: {
          identifier: 'DAD-142',
          title: 'Add webhook retry',
          updatedAt: '2026-09-02T18:04:00.000Z',
          url: 'https://linear.app/x/issue/DAD-142',
          state: { name: 'In Progress' },
          assignee: { displayName: 'dennis' },
        },
      },
    });
    const issue = await getLinearIssue('key', 'abc');
    expect(issue).toEqual({
      identifier: 'DAD-142',
      title: 'Add webhook retry',
      state: 'In Progress',
      assignee: 'dennis',
      updatedAt: '2026-09-02T18:04:00.000Z',
      url: 'https://linear.app/x/issue/DAD-142',
    });
  });

  it('returns null when the issue does not exist', async () => {
    stubFetch({ data: { issue: null } });
    expect(await getLinearIssue('key', 'gone')).toBeNull();
  });

  it('tolerates an unassigned issue', async () => {
    stubFetch({
      data: {
        issue: {
          identifier: 'DAD-1', title: 't', updatedAt: 'u', url: 'l',
          state: { name: 'Todo' }, assignee: null,
        },
      },
    });
    expect((await getLinearIssue('key', 'a'))?.assignee).toBeNull();
  });

  it('throws on a transport failure', async () => {
    stubFetch({}, false, 500);
    await expect(getLinearIssue('key', 'a')).rejects.toThrow(/Linear API HTTP error/);
  });
});

describe('getAsanaTask', () => {
  it('maps an Asana task to the detail shape', async () => {
    stubFetch({
      data: {
        name: 'Draft blog post',
        permalink_url: 'https://app.asana.com/0/1/2',
        assignee: { name: 'dennis' },
        custom_fields: [
          { gid: '1202184607659964', enum_value: { gid: '1202184607667441' } },
        ],
      },
    });
    expect(await getAsanaTask('key', '2')).toEqual({
      name: 'Draft blog post',
      stageGid: '1202184607667441',
      assignee: 'dennis',
      url: 'https://app.asana.com/0/1/2',
    });
  });

  it('returns null when the task is gone', async () => {
    stubFetch({ errors: [{ message: 'Not Found' }] }, false, 404);
    expect(await getAsanaTask('key', 'gone')).toBeNull();
  });

  it('tolerates a task with no pipeline stage field', async () => {
    stubFetch({
      data: { name: 't', permalink_url: 'u', assignee: null, custom_fields: [] },
    });
    const task = await getAsanaTask('key', '2');
    expect(task?.stageGid).toBeNull();
    expect(task?.assignee).toBeNull();
  });
});
