import { getPortalConfig } from '../lib/portal-config';
import { hsUpdate } from '../lib/hubspot-client';
import { generateSocialDraft } from '../lib/social-draft';
import { HS_BASE, objectPath } from '../lib/hs-api';

const READ_PROPERTIES = [
  'title',
  'content_type',
  'published_url',
  'topic_tags',
  'enterpret_theme',
  'social_post_draft',
];

interface GenerateSocialDraftContext {
  accountId?: number;
  parameters?: Record<string, unknown>;
  query?: Record<string, unknown>;
  body?: Record<string, unknown> & { inputFields?: Record<string, unknown> };
}

function str(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return undefined;
}

/**
 * Inputs can arrive as a query string (direct call), a JSON body, or nested
 * under `inputFields` when HubSpot Workflows invokes the custom action.
 */
function param(ctx: GenerateSocialDraftContext, key: string): string | undefined {
  return (
    str(ctx.parameters?.[key]) ??
    str(ctx.query?.[key]) ??
    str(ctx.body?.[key]) ??
    str(ctx.body?.inputFields?.[key])
  );
}

function isTruthy(value: string | undefined): boolean {
  if (!value) return false;
  return ['true', '1', 'yes', 'on'].includes(value.trim().toLowerCase());
}

function json(statusCode: number, payload: Record<string, unknown>) {
  return { statusCode, body: JSON.stringify(payload) };
}

/** Every response carries outputFields so Workflows can branch on the result. */
function result(
  statusCode: number,
  payload: Record<string, unknown>,
  outputFields: Record<string, string>,
) {
  return json(statusCode, { ...payload, outputFields });
}

export async function main(context: GenerateSocialDraftContext) {
  const token = process.env.PRIVATE_APP_ACCESS_TOKEN ?? process.env.HS_ACCESS_TOKEN;
  const objectId = param(context, 'objectId') ?? str(context.body?.hs_object_id);
  const force = isTruthy(param(context, 'force'));
  const portalId = context.accountId;

  if (!token) return result(500, { error: 'No HubSpot access token' }, { draftStatus: 'error', reason: 'no_access_token' });
  if (!objectId) return result(400, { error: 'objectId is required' }, { draftStatus: 'error', reason: 'missing_object_id' });
  if (!portalId) return result(400, { error: 'accountId missing from context' }, { draftStatus: 'error', reason: 'missing_account_id' });

  const objectTypeId = getPortalConfig(portalId).content.objectTypeId;
  const url = `${HS_BASE}${objectPath(objectTypeId, objectId)}?properties=${READ_PROPERTIES.join(',')}`;

  let record: { properties: Record<string, string | null> };
  try {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) {
      return result(
        res.status === 404 ? 404 : 502,
        { error: `Could not read content piece ${objectId}: ${res.status}` },
        { draftStatus: 'error', reason: `read_failed_${res.status}` },
      );
    }
    record = await res.json() as { properties: Record<string, string | null> };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return result(502, { error: `Could not read content piece ${objectId}: ${message}` }, { draftStatus: 'error', reason: 'read_failed' });
  }

  const props = record.properties ?? {};
  const existingDraft = (props.social_post_draft ?? '').trim();

  // A human may have rewritten the generated draft in HubSpot. Never clobber
  // their edit unless the caller explicitly asks us to regenerate.
  if (existingDraft && !force) {
    console.log(`GenerateSocialDraft: skipping ${objectId} — social_post_draft already has content`);
    return result(
      200,
      { skipped: true, reason: 'draft already exists', objectId },
      { draftStatus: 'skipped', reason: 'draft already exists' },
    );
  }

  const draft = generateSocialDraft({
    title: props.title,
    contentType: props.content_type,
    publishedUrl: props.published_url,
    topicTags: props.topic_tags,
    enterpretTheme: props.enterpret_theme,
  });

  try {
    await hsUpdate(objectTypeId, objectId, { social_post_draft: draft });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`GenerateSocialDraft: write failed for ${objectId}:`, message);
    return result(502, { error: `Could not write social_post_draft: ${message}` }, { draftStatus: 'error', reason: 'write_failed' });
  }

  console.log(`GenerateSocialDraft: wrote ${draft.length}-char draft to ${objectId}${force && existingDraft ? ' (forced overwrite)' : ''}`);
  return result(
    200,
    {
      skipped: false,
      objectId,
      overwritten: Boolean(existingDraft),
      draftLength: draft.length,
      draft,
    },
    {
      draftStatus: existingDraft ? 'regenerated' : 'generated',
      draftLength: String(draft.length),
    },
  );
}
