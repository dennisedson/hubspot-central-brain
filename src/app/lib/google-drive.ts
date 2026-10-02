import { markdownToHtml } from './markdown-to-html';

/**
 * Creating a Google Doc from a changelog draft.
 *
 * ONE SCOPE, AND THE NARROW ONE
 * -----------------------------
 * Only `drive.file` — per-file access to what this app creates. Not the Docs
 * API, not `drive.metadata.readonly`, not full `drive`.
 *
 * That is a design constraint, not a detail. `drive.file` cannot see a folder
 * someone made by hand, so the original plan — walk an existing `year/month`
 * hierarchy — required a restricted scope and a Workspace admin's approval,
 * which could have blocked the feature outright. Creating our own folder
 * instead keeps everything inside what `drive.file` already covers.
 *
 * Drive access is per-file by id, so the folder can be dragged anywhere in
 * Drive afterwards, renamed, or filed under year/month by hand, and this keeps
 * working.
 *
 * RAW FETCH, NOT googleapis
 * -------------------------
 * creator-console does this with the `googleapis` package on Firebase. A heavy
 * SDK inside a HubSpot serverless function is a known failure here: the
 * Anthropic SDK returned HTTP 502 with HubSpot's HTML error page in 0.6s,
 * before any error handling ran. Every client in this codebase uses fetch.
 */

const DRIVE_API = 'https://www.googleapis.com/drive/v3';
const DRIVE_UPLOAD = 'https://www.googleapis.com/upload/drive/v3';

export const GOOGLE_DOC_MIME = 'application/vnd.google-apps.document';
export const GOOGLE_FOLDER_MIME = 'application/vnd.google-apps.folder';

/** The folder created on first use, if the portal has not got one yet. */
export const DEFAULT_FOLDER_NAME = 'Changelog Drafts';

export class DriveError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = 'DriveError';
  }
}

async function driveFetch(
  accessToken: string,
  url: string,
  init: RequestInit,
): Promise<Record<string, unknown>> {
  const res = await fetch(url, {
    ...init,
    headers: { ...(init.headers ?? {}), Authorization: `Bearer ${accessToken}` },
  });
  const text = await res.text();
  if (!res.ok) {
    throw new DriveError(`Drive ${res.status}: ${text.slice(0, 300)}`, res.status);
  }
  return text ? (JSON.parse(text) as Record<string, unknown>) : {};
}

/** Creates the folder this app files its documents in. */
export async function createFolder(accessToken: string, name: string): Promise<string> {
  const body = await driveFetch(accessToken, `${DRIVE_API}/files?fields=id`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, mimeType: GOOGLE_FOLDER_MIME }),
  });
  const id = body.id as string | undefined;
  if (!id) throw new DriveError('Drive created a folder but returned no id');
  return id;
}

/**
 * Confirms a stored folder id still exists and is reachable.
 *
 * A folder can be deleted or trashed by the person who owns it, and a stale id
 * would otherwise surface as an opaque 404 on the next upload. Returns false
 * rather than throwing so the caller can make a new one.
 */
export async function folderExists(accessToken: string, folderId: string): Promise<boolean> {
  try {
    const body = await driveFetch(
      accessToken,
      `${DRIVE_API}/files/${encodeURIComponent(folderId)}?fields=id,trashed,mimeType`,
      { method: 'GET' },
    );
    return body.trashed !== true && body.mimeType === GOOGLE_FOLDER_MIME;
  } catch {
    return false;
  }
}

export interface CreatedDoc {
  documentId: string;
  documentUrl: string;
}

/**
 * Uploads the draft as HTML and has Drive convert it to a Google Doc.
 *
 * One request. HTML rather than Markdown because Drive documents HTML as a
 * conversion source, while Markdown appears in the guide's prose but not in its
 * MIME table — not something to gamble a feature on.
 */
export async function createDocFromMarkdown(
  accessToken: string,
  title: string,
  markdown: string,
  folderId: string,
): Promise<CreatedDoc> {
  const boundary = `cb-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const metadata = {
    name: title,
    mimeType: GOOGLE_DOC_MIME,
    parents: [folderId],
  };

  const body = [
    `--${boundary}`,
    'Content-Type: application/json; charset=UTF-8',
    '',
    JSON.stringify(metadata),
    `--${boundary}`,
    'Content-Type: text/html; charset=UTF-8',
    '',
    markdownToHtml(markdown),
    `--${boundary}--`,
    '',
  ].join('\r\n');

  const created = await driveFetch(
    accessToken,
    `${DRIVE_UPLOAD}/files?uploadType=multipart&fields=id`,
    {
      method: 'POST',
      headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
      body,
    },
  );

  const documentId = created.id as string | undefined;
  if (!documentId) throw new DriveError('Drive created a document but returned no id');

  return {
    documentId,
    documentUrl: `https://docs.google.com/document/d/${documentId}/edit`,
  };
}
