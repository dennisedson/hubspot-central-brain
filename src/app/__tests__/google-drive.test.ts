import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  createFolder, folderExists, createDocFromMarkdown,
  GOOGLE_DOC_MIME, GOOGLE_FOLDER_MIME, DriveError,
} from '../lib/google-drive';

/**
 * Only `drive.file` is requested, so everything here must stay inside what this
 * app itself created. That is why the folder is created rather than found: a
 * folder someone made by hand is invisible to this scope, and reaching it would
 * have needed a restricted scope and an admin's approval.
 */

const originalFetch = globalThis.fetch;
beforeEach(() => { globalThis.fetch = vi.fn() as unknown as typeof fetch; });
afterEach(() => { globalThis.fetch = originalFetch; vi.restoreAllMocks(); });
const mockFetch = () => globalThis.fetch as unknown as ReturnType<typeof vi.fn>;

const ok = (body: unknown) => ({ ok: true, status: 200, text: async () => JSON.stringify(body) });

describe('createFolder', () => {
  it('creates a Drive folder and returns its id', async () => {
    mockFetch().mockResolvedValue(ok({ id: 'folder-1' }));
    expect(await createFolder('tok', 'Changelog Drafts')).toBe('folder-1');

    const [, init] = mockFetch().mock.calls[0];
    expect(JSON.parse(init.body as string)).toEqual({
      name: 'Changelog Drafts', mimeType: GOOGLE_FOLDER_MIME,
    });
  });

  it('fails loudly when Drive returns no id', async () => {
    mockFetch().mockResolvedValue(ok({}));
    await expect(createFolder('tok', 'x')).rejects.toThrow(/no id/);
  });

  it('surfaces the status on an error', async () => {
    mockFetch().mockResolvedValue({ ok: false, status: 403, text: async () => 'insufficient scope' });
    await expect(createFolder('tok', 'x')).rejects.toThrow(/403/);
  });
});

describe('folderExists', () => {
  it('is true for a live folder', async () => {
    mockFetch().mockResolvedValue(ok({ id: 'f', trashed: false, mimeType: GOOGLE_FOLDER_MIME }));
    expect(await folderExists('tok', 'f')).toBe(true);
  });

  it('is false once trashed — a stale id would otherwise 404 on upload', async () => {
    mockFetch().mockResolvedValue(ok({ id: 'f', trashed: true, mimeType: GOOGLE_FOLDER_MIME }));
    expect(await folderExists('tok', 'f')).toBe(false);
  });

  it('is false for an id that is not a folder', async () => {
    mockFetch().mockResolvedValue(ok({ id: 'f', trashed: false, mimeType: GOOGLE_DOC_MIME }));
    expect(await folderExists('tok', 'f')).toBe(false);
  });

  it('returns false rather than throwing when Drive refuses', async () => {
    // The caller makes a new folder; it should not have to catch for that.
    mockFetch().mockResolvedValue({ ok: false, status: 404, text: async () => 'not found' });
    expect(await folderExists('tok', 'gone')).toBe(false);
  });
});

describe('createDocFromMarkdown', () => {
  it('uploads HTML and asks Drive to convert it, in one request', async () => {
    mockFetch().mockResolvedValue(ok({ id: 'doc-1' }));

    const result = await createDocFromMarkdown(
      'tok', 'A changelog', '# Title\n\nSome **bold** text.', 'folder-1',
    );

    expect(result).toEqual({
      documentId: 'doc-1',
      documentUrl: 'https://docs.google.com/document/d/doc-1/edit',
    });
    expect(mockFetch().mock.calls).toHaveLength(1);

    const [url, init] = mockFetch().mock.calls[0];
    expect(String(url)).toContain('uploadType=multipart');
    const body = String(init.body);
    // Metadata part: converted into a Doc, inside our folder.
    expect(body).toContain(`"mimeType":"${GOOGLE_DOC_MIME}"`);
    expect(body).toContain('"parents":["folder-1"]');
    // Media part: HTML, because Drive documents HTML as a conversion source
    // while Markdown's support is stated in prose but absent from the MIME table.
    expect(body).toContain('Content-Type: text/html; charset=UTF-8');
    expect(body).toContain('<h1>Title</h1>');
    expect(body).toContain('<strong>bold</strong>');
  });

  it('uses CRLF between multipart sections, as the format requires', async () => {
    mockFetch().mockResolvedValue(ok({ id: 'd' }));
    await createDocFromMarkdown('tok', 't', 'x', 'f');
    expect(String(mockFetch().mock.calls[0][1].body)).toContain('\r\n');
  });

  it('throws a DriveError carrying the status', async () => {
    mockFetch().mockResolvedValue({ ok: false, status: 401, text: async () => 'bad token' });
    await expect(createDocFromMarkdown('tok', 't', 'x', 'f')).rejects.toBeInstanceOf(DriveError);
  });
});
