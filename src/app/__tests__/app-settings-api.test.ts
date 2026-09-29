import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getLinearTeams } from '../functions/AppSettingsApi';

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
