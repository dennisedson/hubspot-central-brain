import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getLinearTeams, getWorkspaceMembers, getLinearProjects, main } from '../functions/AppSettingsApi';

/**
 * Listing Linear teams for the settings page.
 *
 * This exists because the query used to be `teams { nodes { … } }` with no
 * arguments, and Linear defaults a connection to 50. On a large workspace the
 * settings page offered the first fifty teams and gave no sign that more
 * existed — prod returned exactly 50 of several hundred, which reads as "my
 * team is missing" rather than "this list is truncated".
 *
 * Nothing had test coverage, which is how it shipped.
 */

const originalFetch = globalThis.fetch;

function page(names: string[], hasNextPage: boolean, endCursor: string | null = 'CUR') {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      data: {
        teams: {
          nodes: names.map((name) => ({ id: `id-${name}`, name })),
          pageInfo: { hasNextPage, endCursor },
        },
      },
    }),
    text: async () => '',
  } as unknown as Response;
}

beforeEach(() => {
  globalThis.fetch = vi.fn() as unknown as typeof fetch;
});
afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

const mockFetch = () => globalThis.fetch as unknown as ReturnType<typeof vi.fn>;

describe('getLinearTeams', () => {
  it('follows pagination instead of returning the first page', async () => {
    mockFetch()
      .mockResolvedValueOnce(page(['Alpha', 'Bravo'], true, 'cur-1'))
      .mockResolvedValueOnce(page(['Charlie'], false, null));

    const teams = await getLinearTeams('key');

    expect(teams.map((t) => t.name)).toEqual(['Alpha', 'Bravo', 'Charlie']);
    expect(mockFetch().mock.calls).toHaveLength(2);
  });

  it('asks for 250 — Linear\'s maximum — not the default 50', async () => {
    mockFetch().mockResolvedValueOnce(page(['Only'], false, null));
    await getLinearTeams('key');

    const body = JSON.parse(mockFetch().mock.calls[0][1].body as string);
    expect(body.variables.first).toBe(250);
    expect(body.query).toContain('hasNextPage');
  });

  it('passes the previous endCursor as `after`', async () => {
    mockFetch()
      .mockResolvedValueOnce(page(['A'], true, 'cur-abc'))
      .mockResolvedValueOnce(page(['B'], false, null));

    await getLinearTeams('key');

    expect(JSON.parse(mockFetch().mock.calls[0][1].body as string).variables.after).toBeNull();
    expect(JSON.parse(mockFetch().mock.calls[1][1].body as string).variables.after).toBe('cur-abc');
  });

  it('stops when hasNextPage is true but no cursor comes back', async () => {
    // Otherwise this pages forever on the same cursor until the gateway kills
    // the function, which looks like a hang rather than a bad response.
    mockFetch().mockResolvedValue(page(['A'], true, null));
    const teams = await getLinearTeams('key');

    expect(teams).toHaveLength(1);
    expect(mockFetch().mock.calls).toHaveLength(1);
  });

  it('caps the number of pages so a bad cursor cannot spin forever', async () => {
    mockFetch().mockResolvedValue(page(['Loop'], true, 'same-cursor-every-time'));
    await getLinearTeams('key');

    expect(mockFetch().mock.calls.length).toBeLessThanOrEqual(25);
  });

  it('keeps the pages it already has when a later one fails', async () => {
    // A partial list is worse than a complete one and better than nothing —
    // but it must never be silently presented as complete, which is why the
    // first page is returned rather than discarded.
    mockFetch()
      .mockResolvedValueOnce(page(['Kept'], true, 'cur-1'))
      .mockRejectedValueOnce(new Error('network'));

    const teams = await getLinearTeams('key');
    expect(teams.map((t) => t.name)).toEqual(['Kept']);
  });

  it('sorts alphabetically, since the API order is not meaningful', async () => {
    mockFetch().mockResolvedValueOnce(page(['Zulu', 'alpha', 'Mike'], false, null));
    const teams = await getLinearTeams('key');
    expect(teams.map((t) => t.name)).toEqual(['alpha', 'Mike', 'Zulu']);
  });

  it('returns an empty list rather than throwing when the very first call fails', async () => {
    mockFetch().mockRejectedValueOnce(new Error('unauthorised'));
    expect(await getLinearTeams('key')).toEqual([]);
  });
});

/**
 * Who can be picked as "you" when the team is "Any team".
 *
 * `ANY_TEAM` is the sentinel `'any'`, not an empty string — `linear_team_id` is
 * the App Config object's primary display property, so HubSpot will not let it
 * be cleared. Every consumer was taught to read it through `isAnyTeam()`
 * except the two assignee lookups below, which still asked "is this string
 * truthy?". `'any'` is truthy, so they queried Linear for a team whose id is
 * literally "any", got nothing back, and returned an empty list.
 *
 * On screen that empty list is not an empty dropdown. The saved assignee id is
 * still the Select's value, and with no option matching it the page renders the
 * raw UUID and flags the field invalid — so the one person who configured the
 * portal correctly is told their own name is a bad value.
 */

const DEV_PORTAL = 51869810;

interface LinearReply { data: Record<string, unknown> }

function linearReply(body: LinearReply) {
  return { ok: true, status: 200, json: async () => body, text: async () => '' } as unknown as Response;
}

/** Routes each call by what it actually asks for, as the live APIs would. */
function routeFetch(hsRecord: Record<string, string>) {
  return (url: string, init?: { body?: string }) => {
    if (!String(url).includes('api.linear.app')) {
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({ results: [{ id: 'cfg-1', properties: hsRecord }] }),
        text: async () => '',
      } as unknown as Response);
    }

    const query = String(JSON.parse(init?.body ?? '{}').query ?? '');
    if (query.includes('team(id:')) {
      // Linear answers a bogus team id with a null node, not an HTTP error.
      return Promise.resolve(linearReply({ data: { team: null } }));
    }
    if (query.includes('users(')) {
      return Promise.resolve(
        linearReply({ data: { users: { nodes: [{ id: 'u-dennis', name: 'Dennis Edson' }] } } }),
      );
    }
    if (query.includes('projects(')) {
      return Promise.resolve(linearReply({ data: { projects: { nodes: [] } } }));
    }
    return Promise.resolve(
      linearReply({ data: { teams: { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } } } }),
    );
  };
}

describe('assignee options with the "any team" sentinel', () => {
  beforeEach(() => {
    process.env.PRIVATE_APP_ACCESS_TOKEN = 'hs-token';
    process.env.LINEAR_API_KEY = 'linear-key';
  });

  it('offers the whole workspace on load when the saved team is "any"', async () => {
    mockFetch().mockImplementation(
      routeFetch({ linear_team_id: 'any', assignee_filter: 'mine', linear_assignee_id: 'u-dennis' }),
    );

    const res = await main({ accountId: DEV_PORTAL, parameters: { action: 'getSettings' } });
    const body = JSON.parse(res.body) as { teamMembers: Array<{ id: string }> };

    expect(res.statusCode).toBe(200);
    expect(body.teamMembers.map(m => m.id)).toContain('u-dennis');
  });

  it('offers the whole workspace when "Any team" is chosen in the dropdown', async () => {
    mockFetch().mockImplementation(
      routeFetch({ linear_team_id: 'any', assignee_filter: 'mine', linear_assignee_id: '' }),
    );

    const res = await main({
      accountId: DEV_PORTAL,
      parameters: { action: 'loadTeamMembers', teamId: 'any' },
    });
    const body = JSON.parse(res.body) as { teamMembers: Array<{ id: string }> };

    expect(body.teamMembers.map(m => m.id)).toContain('u-dennis');
  });

  it('still scopes to the team when a real team is selected', async () => {
    mockFetch().mockImplementation((url: string, init?: { body?: string }) => {
      const query = String(JSON.parse(init?.body ?? '{}').query ?? '');
      if (String(url).includes('api.linear.app') && query.includes('team(id:')) {
        return Promise.resolve(
          linearReply({ data: { team: { members: { nodes: [{ id: 'u-team', name: 'Team Member' }] } } } }),
        );
      }
      return routeFetch({})(url, init);
    });

    const res = await main({
      accountId: DEV_PORTAL,
      parameters: { action: 'loadTeamMembers', teamId: 'real-team-id' },
    });
    const body = JSON.parse(res.body) as { teamMembers: Array<{ id: string }> };

    expect(body.teamMembers.map(m => m.id)).toEqual(['u-team']);
  });
});

/**
 * Paging the other two Linear connections.
 *
 * This is the third time the same bug. `getLinearTeams` was fixed when prod
 * returned 50 teams of several hundred; the two lookups written afterwards
 * copied the shape of the broken version, asking for one page and presenting
 * it as the whole set.
 *
 * Measured against the live workspace: 452 active users, of which the single
 * page held 250 — and the person configuring the portal was #347, so he was
 * missing from the list of people he could declare himself to be.
 *
 * What makes it invisible is the sort. Truncate to an arbitrary 250 and then
 * order alphabetically and the result reads "Abby Mueller … Zhuangda Zhu" — a
 * complete-looking A-to-Z sweep with 202 people absent from the middle. A
 * truncated list must never be sorted into looking whole.
 */

function connectionPage(
  key: 'users' | 'projects',
  names: string[],
  hasNextPage: boolean,
  endCursor: string | null = 'CUR',
) {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      data: {
        [key]: {
          nodes: names.map(name => ({ id: `id-${name}`, name })),
          pageInfo: { hasNextPage, endCursor },
        },
      },
    }),
    text: async () => '',
  } as unknown as Response;
}

describe('getWorkspaceMembers', () => {
  it('follows pagination instead of returning the first 250', async () => {
    mockFetch()
      .mockResolvedValueOnce(connectionPage('users', ['Abby'], true, 'cur-1'))
      .mockResolvedValueOnce(connectionPage('users', ['Dennis'], false, null));

    const members = await getWorkspaceMembers('key');

    expect(members.map(m => m.name)).toEqual(['Abby', 'Dennis']);
    expect(mockFetch().mock.calls).toHaveLength(2);
  });

  it('asks for 250 per page and passes the cursor', async () => {
    mockFetch()
      .mockResolvedValueOnce(connectionPage('users', ['A'], true, 'cur-abc'))
      .mockResolvedValueOnce(connectionPage('users', ['B'], false, null));

    await getWorkspaceMembers('key');

    const first = JSON.parse(mockFetch().mock.calls[0][1].body as string);
    const second = JSON.parse(mockFetch().mock.calls[1][1].body as string);
    expect(first.variables.first).toBe(250);
    expect(first.variables.after).toBeNull();
    expect(second.variables.after).toBe('cur-abc');
  });

  it('still asks only for active users', async () => {
    // Suspended accounts are not people anyone should be able to pick.
    mockFetch().mockResolvedValueOnce(connectionPage('users', ['A'], false, null));
    await getWorkspaceMembers('key');

    const body = JSON.parse(mockFetch().mock.calls[0][1].body as string);
    expect(body.query).toContain('active');
  });

  it('keeps the pages it has when a later one fails', async () => {
    mockFetch()
      .mockResolvedValueOnce(connectionPage('users', ['Kept'], true, 'cur-1'))
      .mockRejectedValueOnce(new Error('network'));

    expect((await getWorkspaceMembers('key')).map(m => m.name)).toEqual(['Kept']);
  });
});

describe('getLinearProjects', () => {
  it('follows pagination instead of returning the first 250', async () => {
    mockFetch()
      .mockResolvedValueOnce(connectionPage('projects', ['Rollouts'], true, 'cur-1'))
      .mockResolvedValueOnce(connectionPage('projects', ['Advocacy'], false, null));

    const projects = await getLinearProjects('key');

    expect(projects.map(p => p.name)).toEqual(['Advocacy', 'Rollouts']);
    expect(mockFetch().mock.calls).toHaveLength(2);
  });

  it('caps the page count so a bad cursor cannot spin forever', async () => {
    mockFetch().mockResolvedValue(connectionPage('projects', ['Loop'], true, 'same-cursor'));
    await getLinearProjects('key');

    expect(mockFetch().mock.calls.length).toBeLessThanOrEqual(25);
  });
});

/**
 * The backfill action's own bound.
 *
 * Its comment used to say "the caller decides what and how many, so each
 * request is bounded by construction". The caller was a page with a Select All
 * button. Selecting all 83 assigned issues produced 33 records on production
 * and a success message.
 *
 * A bound that lives only in the caller is not a bound, so the action now
 * refuses an oversized request outright rather than starting work it cannot
 * finish and reporting whatever it managed.
 */
describe('backfill request size', () => {
  beforeEach(() => {
    process.env.PRIVATE_APP_ACCESS_TOKEN = 'hs-token';
    process.env.LINEAR_API_KEY = 'linear-key';
  });

  it('refuses more ids than one invocation can finish', async () => {
    const ids = Array.from({ length: 83 }, (_, i) => `id-${i}`).join(',');

    const res = await main({ accountId: DEV_PORTAL, parameters: { action: 'backfill', ids } });

    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.body) as { error: string };
    expect(body.error).toMatch(/83/);
    expect(body.error).toMatch(/15/);
  });

  it('rejects before doing any work, so nothing is half-written', async () => {
    mockFetch().mockImplementation(() => {
      throw new Error('no request should have been made');
    });
    const ids = Array.from({ length: 40 }, (_, i) => `id-${i}`).join(',');

    const res = await main({ accountId: DEV_PORTAL, parameters: { action: 'backfill', ids } });

    expect(res.statusCode).toBe(400);
    expect(mockFetch()).not.toHaveBeenCalled();
  });

  it('still accepts a batch of exactly the maximum', async () => {
    mockFetch().mockImplementation(
      routeFetch({ linear_team_id: 'any', assignee_filter: 'mine', linear_assignee_id: 'u-dennis' }),
    );
    const ids = Array.from({ length: 15 }, (_, i) => `id-${i}`).join(',');

    const res = await main({ accountId: DEV_PORTAL, parameters: { action: 'backfill', ids } });

    // Nothing matches these ids, so nothing is written — but it was allowed to try.
    expect(res.statusCode).toBe(200);
    expect((JSON.parse(res.body) as { requested: number }).requested).toBe(15);
  });
});

/**
 * The project list the settings page offers, and what saving does to it.
 *
 * None of this had coverage. It shipped on 2026-09-30 across six commits that
 * touched no test file, in the same area that had already produced four
 * truncation bugs and a fail-open webhook.
 *
 * The workspace has 1,592 projects and 452 active users; the person configuring
 * the portal has issues in 7 projects. Those numbers are why the filtering
 * exists, and why "fall back to everything" is a bigger deal than it looks.
 */

interface ProjectRef { id: string; name: string }

/**
 * Serves the settings page's whole fan-out, routed by what each call asks for.
 *
 * `assigneeProjects: null` makes the assigned-issues query FAIL, as opposed to
 * returning nobody — the code has to tell those apart and until now it could not.
 */
function settingsFetch(opts: {
  record?: Record<string, string>;
  assigneeProjects?: ProjectRef[] | null;
  allProjects?: ProjectRef[];
}) {
  const { record = {}, assigneeProjects = [], allProjects = [] } = opts;
  return (url: string, init?: { body?: string }) => {
    if (!String(url).includes('api.linear.app')) {
      return Promise.resolve({
        ok: true, status: 200,
        json: async () => ({ results: [{ id: 'cfg-1', properties: record }] }),
        text: async () => '',
      } as unknown as Response);
    }
    const query = String(JSON.parse(init?.body ?? '{}').query ?? '');

    if (query.includes('assignedIssues')) {
      if (assigneeProjects === null) {
        return Promise.resolve({ ok: false, status: 500, text: async () => 'boom' } as unknown as Response);
      }
      return Promise.resolve(linearReply({
        data: { user: { assignedIssues: {
          nodes: assigneeProjects.map(p => ({ project: p })),
          pageInfo: { hasNextPage: false, endCursor: null },
        } } },
      }));
    }
    if (query.includes('projects(')) {
      return Promise.resolve(linearReply({
        data: { projects: { nodes: allProjects, pageInfo: { hasNextPage: false, endCursor: null } } },
      }));
    }
    if (query.includes('users(')) {
      return Promise.resolve(linearReply({
        data: { users: { nodes: [{ id: 'u-dennis', name: 'Dennis Edson' }], pageInfo: { hasNextPage: false, endCursor: null } } },
      }));
    }
    return Promise.resolve(linearReply({
      data: { teams: { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } } },
    }));
  };
}

const MINE = { linear_team_id: 'any', assignee_filter: 'mine', linear_assignee_id: 'u-dennis' };

async function getSettings(fetchImpl: ReturnType<typeof settingsFetch>) {
  mockFetch().mockImplementation(fetchImpl);
  const res = await main({ accountId: DEV_PORTAL, parameters: { action: 'getSettings' } });
  return JSON.parse(res.body) as { projects: ProjectRef[]; projectMap: Record<string, string> };
}

describe('the project list offered for routing', () => {
  beforeEach(() => {
    process.env.PRIVATE_APP_ACCESS_TOKEN = 'hs-token';
    process.env.LINEAR_API_KEY = 'linear-key';
  });

  it('offers the projects you have issues in, not every project in the workspace', async () => {
    const body = await getSettings(settingsFetch({
      record: MINE,
      assigneeProjects: [{ id: 'p-roll', name: 'Rollouts' }, { id: 'p-vid', name: 'Video Strategy' }],
      allProjects: Array.from({ length: 200 }, (_, i) => ({ id: `p-${i}`, name: `Project ${i}` })),
    }));

    expect(body.projects.map(p => p.id)).toEqual(['p-roll', 'p-vid']);
  });

  it('deduplicates — 69 issues in one project is one row, not 69', async () => {
    const body = await getSettings(settingsFetch({
      record: MINE,
      assigneeProjects: Array.from({ length: 69 }, () => ({ id: 'p-roll', name: 'Rollouts' })),
    }));

    expect(body.projects).toEqual([{ id: 'p-roll', name: 'Rollouts' }]);
  });

  it('falls back to every project when not filtering by assignee', async () => {
    const body = await getSettings(settingsFetch({
      record: { linear_team_id: 'team-1', assignee_filter: 'all', linear_assignee_id: '' },
      allProjects: [{ id: 'p-a', name: 'Alpha' }, { id: 'p-b', name: 'Bravo' }],
    }));

    expect(body.projects.map(p => p.name)).toEqual(['Alpha', 'Bravo']);
  });

  it('names a mapped project that has dropped out of your issues', async () => {
    // Map a project, then stop having issues in it — reassigned, or closed.
    // It must stay in the list so the mapping remains editable, but it was
    // being listed with its UUID as its name: the same raw-id-on-screen defect
    // as the assignee field, in the same view.
    const body = await getSettings(settingsFetch({
      record: { ...MINE, linear_project_map: JSON.stringify({ 'p-old': 'changelog' }) },
      assigneeProjects: [{ id: 'p-roll', name: 'Rollouts' }],
      allProjects: [{ id: 'p-roll', name: 'Rollouts' }, { id: 'p-old', name: 'Retired Project' }],
    }));

    const old = body.projects.find(p => p.id === 'p-old');
    expect(old).toBeDefined();
    expect(old!.name).toBe('Retired Project');
  });

  it('does not dump the whole workspace when you genuinely have no projects', async () => {
    // An empty result and a failed request are different facts. Showing 1,592
    // rows because someone has no project work is not a helpful default.
    const body = await getSettings(settingsFetch({
      record: MINE,
      assigneeProjects: [],
      allProjects: Array.from({ length: 1592 }, (_, i) => ({ id: `p-${i}`, name: `Project ${i}` })),
    }));

    expect(body.projects).toEqual([]);
  });

  it('does fall back to every project when the lookup actually fails', async () => {
    const body = await getSettings(settingsFetch({
      record: MINE,
      assigneeProjects: null,
      allProjects: [{ id: 'p-a', name: 'Alpha' }],
    }));

    expect(body.projects.map(p => p.id)).toEqual(['p-a']);
  });

  it('says so plainly when a mapped project no longer exists in Linear', async () => {
    // Deleted, or outside what this key can see. Still not a bare UUID.
    const body = await getSettings(settingsFetch({
      record: { ...MINE, linear_project_map: JSON.stringify({ 'p-gone-1234-abcd': 'content' }) },
      assigneeProjects: [{ id: 'p-roll', name: 'Rollouts' }],
      allProjects: [{ id: 'p-roll', name: 'Rollouts' }],
    }));

    const gone = body.projects.find(p => p.id === 'p-gone-1234-abcd');
    expect(gone!.name).toMatch(/Unavailable project/);
    expect(gone!.name).not.toBe('p-gone-1234-abcd');
  });
});

/**
 * Saving the routing map, and what it does to the "nobody has mapped this yet"
 * list that drives the banner.
 */
describe('saveSettings and the unmapped list', () => {
  beforeEach(() => {
    process.env.PRIVATE_APP_ACCESS_TOKEN = 'hs-token';
    process.env.LINEAR_API_KEY = 'linear-key';
  });

  /** Captures what was PATCHed to HubSpot. */
  function captureWrites() {
    const writes: Array<Record<string, string>> = [];
    mockFetch().mockImplementation((url: string, init?: { method?: string; body?: string }) => {
      if (String(url).includes('api.linear.app')) {
        return Promise.resolve(linearReply({ data: {} }));
      }
      if (init?.method === 'PATCH' || init?.method === 'POST') {
        const parsed = JSON.parse(init.body ?? '{}') as { properties?: Record<string, string> };
        if (parsed.properties) writes.push(parsed.properties);
      }
      return Promise.resolve({
        ok: true, status: 200,
        json: async () => ({ results: [{ id: 'cfg-1', properties: {
          linear_unmapped_projects: JSON.stringify([{ id: 'p-stale', name: 'Stale Project' }]),
        } }] }),
        text: async () => '',
      } as unknown as Response);
    });
    return writes;
  }

  it('clears the unmapped list when a routing map is saved', async () => {
    const writes = captureWrites();

    const res = await main({ accountId: DEV_PORTAL, parameters: {
      action: 'saveSettings',
      linearTeamId: 'any', assigneeFilter: 'mine', linearAssigneeId: 'u-dennis',
      projectMap: JSON.stringify({ 'p-roll': 'changelog' }),
    } });

    expect(res.statusCode).toBe(200);
    const saved = writes.find(w => 'linear_unmapped_projects' in w);
    expect(saved).toBeDefined();
    expect(JSON.parse(saved!.linear_unmapped_projects)).toEqual([]);
  });

  it('leaves the unmapped list alone when no map was submitted', async () => {
    // Changing only the assignee must not silently dismiss the banner.
    const writes = captureWrites();

    await main({ accountId: DEV_PORTAL, parameters: {
      action: 'saveSettings',
      linearTeamId: 'any', assigneeFilter: 'mine', linearAssigneeId: 'u-dennis',
    } });

    expect(writes.some(w => 'linear_unmapped_projects' in w)).toBe(false);
  });

  it('refuses a configuration that would leave the sync unbounded', async () => {
    captureWrites();

    const res = await main({ accountId: DEV_PORTAL, parameters: {
      action: 'saveSettings',
      linearTeamId: 'any', assigneeFilter: 'mine', linearAssigneeId: '',
    } });

    expect(res.statusCode).toBe(400);
  });
});

/**
 * The preview, which is the only thing standing between a click and writing to
 * production. It applies the same filters the webhook does, so if it is wrong
 * the person approves an import that is not what they were shown.
 */
describe('backfillPreview', () => {
  beforeEach(() => {
    process.env.PRIVATE_APP_ACCESS_TOKEN = 'hs-token';
    process.env.LINEAR_API_KEY = 'linear-key';
  });

  const issue = (over: Record<string, unknown>) => ({
    id: 'i-1', identifier: 'ENG-1', title: 'An issue', description: '',
    url: 'https://linear.app/i/1',
    state: { id: 's', name: 'Todo', type: 'unstarted' },
    labels: { nodes: [] },
    team: { id: 't-1', name: 'Team' },
    project: null,
    assignee: { id: 'u-dennis', name: 'Dennis Edson' },
    ...over,
  });

  function previewFetch(nodes: unknown[], record: Record<string, string>) {
    mockFetch().mockImplementation((url: string, init?: { body?: string }) => {
      if (!String(url).includes('api.linear.app')) {
        return Promise.resolve({
          ok: true, status: 200,
          json: async () => ({ results: [{ id: 'cfg-1', properties: record }] }),
          text: async () => '',
        } as unknown as Response);
      }
      const query = String(JSON.parse(init?.body ?? '{}').query ?? '');
      if (query.includes('assignedIssues')) {
        return Promise.resolve(linearReply({
          data: { user: { assignedIssues: { nodes, pageInfo: { hasNextPage: false, endCursor: null } } } },
        }));
      }
      return Promise.resolve(linearReply({ data: {} }));
    });
  }

  it('counts each reason an issue was set aside, separately', async () => {
    previewFetch(
      [
        issue({ id: 'ok-1' }),
        issue({ id: 'ok-2', project: { id: 'p-roll', name: 'Rollouts' } }),
        issue({ id: 'echo', description: 'written by us [hs-sync]' }),
        issue({ id: 'theirs', assignee: { id: 'u-someone-else', name: 'Someone Else' } }),
        issue({ id: 'ignored', project: { id: 'p-skip', name: 'Not Wanted' } }),
      ],
      { ...MINE, linear_project_map: JSON.stringify({ 'p-roll': 'changelog', 'p-skip': 'ignore' }) },
    );

    const res = await main({ accountId: DEV_PORTAL, parameters: { action: 'backfillPreview' } });
    const body = JSON.parse(res.body) as {
      scanned: number; skippedEcho: number; skippedAssignee: number; skippedIgnored: number;
      issues: Array<{ id: string; kind: string }>;
    };

    expect(body.scanned).toBe(5);
    expect(body.skippedEcho).toBe(1);
    expect(body.skippedAssignee).toBe(1);
    expect(body.skippedIgnored).toBe(1);
    expect(body.issues.map(i => i.id)).toEqual(['ok-1', 'ok-2']);
  });

  it('shows which pipeline each issue would land in, using the project map', async () => {
    previewFetch(
      [
        issue({ id: 'a', project: { id: 'p-roll', name: 'Rollouts' } }),
        issue({ id: 'b', project: { id: 'p-vid', name: 'Video' } }),
        issue({ id: 'c' }),
      ],
      { ...MINE, linear_project_map: JSON.stringify({ 'p-roll': 'changelog', 'p-vid': 'content' }) },
    );

    const res = await main({ accountId: DEV_PORTAL, parameters: { action: 'backfillPreview' } });
    const body = JSON.parse(res.body) as { issues: Array<{ id: string; kind: string }> };

    // The 69-of-83 case: routing comes from the project, not from a label
    // nobody uses. An unmapped project still defaults to content.
    expect(body.issues).toEqual([
      expect.objectContaining({ id: 'a', kind: 'changelog' }),
      expect.objectContaining({ id: 'b', kind: 'content' }),
      expect.objectContaining({ id: 'c', kind: 'content' }),
    ]);
  });

  it('writes nothing — it is a preview', async () => {
    previewFetch([issue({})], MINE);

    await main({ accountId: DEV_PORTAL, parameters: { action: 'backfillPreview' } });

    const writes = mockFetch().mock.calls.filter(
      ([, init]) => init?.method === 'POST' && !String(init.body ?? '').includes('query'),
    );
    // The only POSTs are HubSpot searches and Linear queries, never an object write.
    expect(writes.every(([url]) => String(url).includes('/search') || String(url).includes('linear'))).toBe(true);
  });

  it('refuses to preview an unconfigured portal', async () => {
    previewFetch([], { linear_team_id: 'any', assignee_filter: 'mine', linear_assignee_id: '' });

    const res = await main({ accountId: DEV_PORTAL, parameters: { action: 'backfillPreview' } });

    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toMatch(/Choose a Linear team/);
  });
});

/**
 * Prompt overrides on the App Config record.
 *
 * The invariant worth protecting: the shipped default is never written to the
 * property. A portal that has not deliberately changed its wording keeps an
 * empty value and therefore keeps receiving improvements to the prompt. Store
 * the default once and that portal is frozen at today's text, with nothing on
 * screen to say so.
 */
describe('changelog prompt overrides', () => {
  beforeEach(() => {
    process.env.PRIVATE_APP_ACCESS_TOKEN = 'hs-token';
    process.env.LINEAR_API_KEY = 'linear-key';
  });

  function capture(record: Record<string, string> = {}) {
    const writes: Array<Record<string, string>> = [];
    mockFetch().mockImplementation((url: string, init?: { method?: string; body?: string }) => {
      if (String(url).includes('api.linear.app')) return Promise.resolve(linearReply({ data: {} }));
      if (init?.method === 'PATCH' || init?.method === 'POST') {
        const parsed = JSON.parse(init.body ?? '{}') as { properties?: Record<string, string> };
        if (parsed.properties) writes.push(parsed.properties);
      }
      return Promise.resolve({
        ok: true, status: 200,
        json: async () => ({ results: [{ id: 'cfg-1', properties: record }] }),
        text: async () => '',
      } as unknown as Response);
    });
    return writes;
  }

  const base = {
    action: 'saveSettings',
    linearTeamId: 'any', assigneeFilter: 'mine', linearAssigneeId: 'u-dennis',
  };

  it('hands the page both the override and the default', async () => {
    const body = await getSettings(settingsFetch({
      record: { ...MINE, changelog_prompt_rollup: 'my own rollup wording' },
      assigneeProjects: [{ id: 'p-roll', name: 'Rollouts' }],
    }) as never) as unknown as {
      prompts: { standalone: string; rollup: string };
      promptDefaults: { standalone: string; rollup: string };
    };

    expect(body.prompts.rollup).toBe('my own rollup wording');
    expect(body.prompts.standalone).toBe('');
    // The page cannot import the defaults, so the API has to send them.
    expect(body.promptDefaults.standalone).toContain('HubSpot Developer Changelog Assistant');
    expect(body.promptDefaults.rollup).toContain('Digest Entry');
  });

  it('stores an override that was typed', async () => {
    const writes = capture();

    await main({ accountId: DEV_PORTAL, parameters: { ...base, promptRollup: 'shorter please' } });

    const saved = writes.find(w => 'changelog_prompt_rollup' in w);
    expect(saved!.changelog_prompt_rollup).toBe('shorter please');
  });

  it('clears the override when the field is submitted empty', async () => {
    const writes = capture({ changelog_prompt_rollup: 'previously customised' });

    await main({ accountId: DEV_PORTAL, parameters: { ...base, promptRollup: '' } });

    const saved = writes.find(w => 'changelog_prompt_rollup' in w);
    expect(saved!.changelog_prompt_rollup).toBe('');
  });

  it('leaves an override untouched when the field was not submitted', async () => {
    const writes = capture({ changelog_prompt_rollup: 'previously customised' });

    await main({ accountId: DEV_PORTAL, parameters: base });

    expect(writes.some(w => 'changelog_prompt_rollup' in w)).toBe(false);
    expect(writes.some(w => 'changelog_prompt_standalone' in w)).toBe(false);
  });

  it('never writes the shipped default into the property', async () => {
    // The whole point. If saving stored the default, this portal would stop
    // receiving every later improvement to the prompt and nothing would say so.
    const writes = capture();

    await main({ accountId: DEV_PORTAL, parameters: base });

    for (const w of writes) {
      expect(w.changelog_prompt_standalone ?? '').not.toContain('HubSpot Developer Changelog Assistant');
      expect(w.changelog_prompt_rollup ?? '').not.toContain('Digest Entry');
    }
  });
});
