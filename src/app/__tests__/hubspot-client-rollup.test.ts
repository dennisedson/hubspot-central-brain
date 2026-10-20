import { describe, it, expect, vi, beforeEach } from 'vitest';
import { updateByLinearId, searchAll, batchUpdate } from '@lib/hubspot-client';

/**
 * The HubSpot calls the rollup paths make. Its own file because
 * hubspot-client.test.ts queues responses in call order.
 */

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

const BASE = 'https://api.hubapi.com/crm/objects/2026-03/2-content';
const reply = (status: number, body: unknown = {}) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
  text: async () => JSON.stringify(body),
});

beforeEach(() => {
  mockFetch.mockReset();
  process.env.HS_ACCESS_TOKEN = 'tok';
});

describe('updateByLinearId', () => {
  it('PATCHes the record by linear_id', async () => {
    mockFetch.mockResolvedValue(reply(200, { id: '101' }));
    expect(await updateByLinearId('2-content', 'iss-1', { changelog_rollup: 'October 2026 Changelog Rollup' })).toBe(true);
    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toBe(`${BASE}/iss-1?idProperty=linear_id`);
    expect(init.method).toBe('PATCH');
    expect(JSON.parse(init.body)).toEqual({ properties: { changelog_rollup: 'October 2026 Changelog Rollup' } });
  });

  it('answers false on 404 and never falls back to creating a record', async () => {
    mockFetch.mockResolvedValue(reply(404, { message: 'not found' }));
    expect(await updateByLinearId('2-content', 'iss-1', { changelog_rollup: 'x' })).toBe(false);
    expect(mockFetch).toHaveBeenCalledOnce();
  });

  it('throws on any other failure', async () => {
    mockFetch.mockResolvedValue(reply(400, { message: 'Property "changelog_rollup" does not exist' }));
    await expect(updateByLinearId('2-content', 'iss-1', { changelog_rollup: 'x' })).rejects.toThrow(/400/);
  });
});

describe('searchAll', () => {
  it('pages to the end and ORs the filter groups', async () => {
    mockFetch.mockImplementation(async (_url: string, init: { body: string }) => {
      const body = JSON.parse(init.body);
      expect(body.filterGroups).toEqual([
        { filters: [{ propertyName: 'changelog_doc_url', operator: 'HAS_PROPERTY' }] },
        { filters: [{ propertyName: 'changelog_rollup', operator: 'HAS_PROPERTY' }] },
      ]);
      return body.after === 'page-2'
        ? reply(200, { results: [{ id: '2', properties: {} }] })
        : reply(200, { results: [{ id: '1', properties: {} }], paging: { next: { after: 'page-2' } } });
    });
    const rows = await searchAll(
      '2-content',
      [
        [{ propertyName: 'changelog_doc_url', operator: 'HAS_PROPERTY' }],
        [{ propertyName: 'changelog_rollup', operator: 'HAS_PROPERTY' }],
      ],
      ['linear_id'],
    );
    expect(rows.map(r => r.id)).toEqual(['1', '2']);
    expect(mockFetch.mock.calls[0][0]).toBe(`${BASE}/search`);
  });

  it('throws rather than return the first page when a later one fails', async () => {
    mockFetch.mockImplementation(async (_url: string, init: { body: string }) =>
      JSON.parse(init.body).after
        ? reply(500, { message: 'boom' })
        : reply(200, { results: [{ id: '1', properties: {} }], paging: { next: { after: 'page-2' } } }),
    );
    await expect(searchAll('2-content', [[{ propertyName: 'linear_id', operator: 'IN', values: ['a'] }]], []))
      .rejects.toThrow(/500/);
  });
});

describe('batchUpdate', () => {
  it('POSTs the inputs to batch/update', async () => {
    mockFetch.mockResolvedValue(reply(200, { status: 'COMPLETE', results: [] }));
    await batchUpdate('2-content', [{ id: '101', properties: { changelog_doc_url: '' } }]);
    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toBe(`${BASE}/batch/update`);
    expect(JSON.parse(init.body)).toEqual({ inputs: [{ id: '101', properties: { changelog_doc_url: '' } }] });
  });

  it('treats 207 Multi-Status as the failure it is', async () => {
    mockFetch.mockResolvedValue(reply(207, { status: 'COMPLETE', errors: [{ message: 'Property values were not valid' }] }));
    await expect(batchUpdate('2-content', [{ id: '101', properties: { changelog_rollup: 'x' } }]))
      .rejects.toThrow(/Property values were not valid/);
  });

  it('refuses more than 100 inputs and makes no call for none', async () => {
    const many = Array.from({ length: 101 }, (_, i) => ({ id: String(i), properties: {} }));
    await expect(batchUpdate('2-content', many)).rejects.toThrow(/at most 100/);
    await batchUpdate('2-content', []);
    expect(mockFetch).not.toHaveBeenCalled();
  });
});
