import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getLinearTeams, main } from '../functions/AppSettingsApi';

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
