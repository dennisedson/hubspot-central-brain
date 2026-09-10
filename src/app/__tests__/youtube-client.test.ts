import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  VIDEO_BATCH_SIZE,
  chunkVideoIds,
  fetchVideoBatch,
  videoBatchKey,
} from '@lib/youtube-client';

/**
 * The YouTube Data API client.
 *
 * The behaviour worth pinning is the conditional-request path. A 304 is the
 * normal case on a channel whose back catalogue rarely moves, and `fetch`
 * reports a 304 as NOT ok — so a handler that checks `res.ok` first turns every
 * cache hit into a thrown error. That ordering is load-bearing and invisible,
 * which is exactly what a test is for.
 */

const originalFetch = globalThis.fetch;

function mockResponse(init: {
  status: number;
  body?: unknown;
  etagHeader?: string;
}): Response {
  return {
    status: init.status,
    ok: init.status >= 200 && init.status < 300,
    headers: { get: (h: string) => (h.toLowerCase() === 'etag' ? (init.etagHeader ?? null) : null) },
    json: async () => init.body ?? {},
    text: async () => JSON.stringify(init.body ?? {}),
  } as unknown as Response;
}

describe('chunkVideoIds', () => {
  it('batches at the API limit', () => {
    const ids = Array.from({ length: 120 }, (_, i) => `v${i}`);
    const batches = chunkVideoIds(ids);
    expect(batches).toHaveLength(3);
    expect(batches[0]).toHaveLength(VIDEO_BATCH_SIZE);
    expect(batches[2]).toHaveLength(120 - VIDEO_BATCH_SIZE * 2);
  });

  it('loses no ids and preserves order', () => {
    const ids = Array.from({ length: 137 }, (_, i) => `v${i}`);
    expect(chunkVideoIds(ids).flat()).toEqual(ids);
  });

  it('returns no batches for no ids', () => {
    expect(chunkVideoIds([])).toEqual([]);
  });

  it('honours an explicit size', () => {
    expect(chunkVideoIds(['a', 'b', 'c'], 2)).toEqual([['a', 'b'], ['c']]);
  });
});

describe('videoBatchKey', () => {
  it('is stable for the same ids in the same order', () => {
    expect(videoBatchKey(['a', 'b'])).toBe(videoBatchKey(['a', 'b']));
  });

  it('differs when the batch differs', () => {
    expect(videoBatchKey(['a', 'b'])).not.toBe(videoBatchKey(['a', 'c']));
  });

  it('is order-sensitive, because a reordered batch is a different request', () => {
    expect(videoBatchKey(['a', 'b'])).not.toBe(videoBatchKey(['b', 'a']));
  });
});

describe('fetchVideoBatch', () => {
  beforeEach(() => {
    globalThis.fetch = vi.fn() as unknown as typeof fetch;
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('short-circuits an empty batch without calling YouTube', async () => {
    const out = await fetchVideoBatch('tok', []);
    expect(out).toEqual({ notModified: false, etag: null, items: [] });
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('sends no If-None-Match on a first run', async () => {
    (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
      mockResponse({ status: 200, body: { etag: 'E1', items: [] } }),
    );
    await fetchVideoBatch('tok', ['a']);
    const init = (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0][1] as RequestInit;
    expect((init.headers as Record<string, string>)['If-None-Match']).toBeUndefined();
  });

  it('replays a stored ETag as If-None-Match', async () => {
    (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
      mockResponse({ status: 200, body: { etag: 'E2', items: [] } }),
    );
    await fetchVideoBatch('tok', ['a'], 'E1');
    const init = (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0][1] as RequestInit;
    expect((init.headers as Record<string, string>)['If-None-Match']).toBe('E1');
  });

  it('treats 304 as success and keeps the stored ETag', async () => {
    // The load-bearing case: fetch reports 304 as !ok, so a naive ok-check
    // would throw on every cache hit.
    (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
      mockResponse({ status: 304 }),
    );
    const out = await fetchVideoBatch('tok', ['a'], 'E1');
    expect(out.notModified).toBe(true);
    expect(out.etag).toBe('E1');
    expect(out.items).toEqual([]);
  });

  it('returns items and the new ETag on a 200', async () => {
    const items = [{ id: 'a', statistics: { viewCount: '10' } }];
    (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
      mockResponse({ status: 200, body: { etag: 'E2', items } }),
    );
    const out = await fetchVideoBatch('tok', ['a'], 'E1');
    expect(out.notModified).toBe(false);
    expect(out.etag).toBe('E2');
    expect(out.items).toEqual(items);
  });

  it('falls back to the ETag header when the body carries none', async () => {
    (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
      mockResponse({ status: 200, body: { items: [] }, etagHeader: 'H1' }),
    );
    expect((await fetchVideoBatch('tok', ['a'])).etag).toBe('H1');
  });

  it('reports null rather than undefined when there is no validator at all', async () => {
    (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
      mockResponse({ status: 200, body: { items: [] } }),
    );
    expect((await fetchVideoBatch('tok', ['a'])).etag).toBeNull();
  });

  it('throws on a real error status', async () => {
    (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
      mockResponse({ status: 403, body: { error: 'quota' } }),
    );
    await expect(fetchVideoBatch('tok', ['a'])).rejects.toThrow(/403/);
  });

  it('requests every id in the batch', async () => {
    (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
      mockResponse({ status: 200, body: { items: [] } }),
    );
    await fetchVideoBatch('tok', ['a', 'b', 'c']);
    const url = String((globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0]);
    expect(decodeURIComponent(url)).toContain('id=a,b,c');
  });

  it('authenticates with the access token it was given', async () => {
    (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
      mockResponse({ status: 200, body: { items: [] } }),
    );
    await fetchVideoBatch('TOKEN123', ['a']);
    const init = (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0][1] as RequestInit;
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer TOKEN123');
  });
});
