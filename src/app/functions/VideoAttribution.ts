import { getPortalConfig } from '../lib/portal-config';
import { hsUpdate } from '../lib/hubspot-client';
import { HS_BASE, objectPath } from '../lib/hs-api';
import { buildUtmLink, isUtmMedium, UtmError, DEFAULT_UTM_MEDIUM } from '../lib/utm';

/**
 * Video attribution — the link between a published video and the deals it
 * sources. Ported from the Firebase Creator Console's `getCampaigns`,
 * `createCampaign`, `linkCampaign`, `saveWebsiteLink` and `workflowGenerateUtm`.
 *
 * WHAT COLLAPSED, AND WHY
 * -----------------------
 * The old design needed five HTTP endpoints because campaign state lived in
 * Firestore and had to be pushed into HubSpot. Here the CRM *is* the store, so
 * four of the five stop being endpoints at all:
 *
 *   getCampaigns / createCampaign  ->  gone. A campaign is the `campaign_name`
 *                                      string already on the video record (or
 *                                      typed into the workflow), so there is
 *                                      nothing to list and nothing to create.
 *                                      Nothing here calls the Marketing
 *                                      Campaigns API — that surface has no
 *                                      builder in hs-api.ts, and it 403s on
 *                                      portals without Marketing Hub Pro,
 *                                      which is what made the old
 *                                      `getCampaigns` return an empty list and
 *                                      the UI look broken.
 *   linkCampaign / saveWebsiteLink ->  one PATCH at the end of this handler.
 *   workflowGenerateUtm            ->  this handler.
 *
 * SAFETY RAILS (both bypassed by `force`)
 * ---------------------------------------
 *   - Stage gate: the record must be in the video pipeline's published stage.
 *     The workflow is expected to enrol on that transition, but a re-enrolment
 *     or a hand-run must not mint a link for a draft.
 *   - Never clobber: a `utm_link` already on the record is left alone. Someone
 *     has pasted that exact string into a YouTube description; regenerating it
 *     silently orphans every click already attributed to it.
 */

/**
 * Everything the handler reads. `hs_pipeline_stage` drives the stage gate;
 * `title` becomes `utm_content`; the other three are the Attribution
 * properties confirmed on the live object.
 */
const READ_PROPERTIES = [
  'title',
  'hs_pipeline_stage',
  'website_url',
  'campaign_name',
  'utm_link',
];

interface VideoAttributionContext {
  accountId?: number;
  params?: Record<string, unknown>;
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
function param(ctx: VideoAttributionContext, key: string): string | undefined {
  return (
    str(Array.isArray(ctx.params?.[key]) ? (ctx.params?.[key] as unknown[])[0] : ctx.params?.[key]) ??
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

/** Trim a property that HubSpot may return as null, '' or whitespace. */
function prop(properties: Record<string, string | null>, name: string): string {
  const value = properties[name];
  return typeof value === 'string' ? value.trim() : '';
}

export async function main(context: VideoAttributionContext) {
  const token = process.env.PRIVATE_APP_ACCESS_TOKEN ?? process.env.HS_ACCESS_TOKEN;
  const objectId = param(context, 'objectId') ?? str(context.body?.hs_object_id);
  const force = isTruthy(param(context, 'force'));
  const portalId = context.accountId;

  if (!token) return result(500, { error: 'No HubSpot access token' }, { attributionStatus: 'error', reason: 'no_access_token' });
  if (!objectId) return result(400, { error: 'objectId is required' }, { attributionStatus: 'error', reason: 'missing_object_id' });
  if (!portalId) return result(400, { error: 'accountId missing from context' }, { attributionStatus: 'error', reason: 'missing_account_id' });

  const videoConfig = getPortalConfig(portalId).video;
  const objectTypeId = videoConfig.objectTypeId;
  const url = `${HS_BASE}${objectPath(objectTypeId, objectId)}?properties=${READ_PROPERTIES.join(',')}`;

  let record: { properties: Record<string, string | null> };
  try {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) {
      return result(
        res.status === 404 ? 404 : 502,
        { error: `Could not read video ${objectId}: ${res.status}` },
        { attributionStatus: 'error', reason: `read_failed_${res.status}` },
      );
    }
    record = await res.json() as { properties: Record<string, string | null> };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return result(502, { error: `Could not read video ${objectId}: ${message}` }, { attributionStatus: 'error', reason: 'read_failed' });
  }

  const props = record.properties ?? {};
  const existingLink = prop(props, 'utm_link');
  const stage = prop(props, 'hs_pipeline_stage');

  // Gate 1 — the video must actually be published.
  if (stage !== videoConfig.stageIds.public && !force) {
    console.log(`VideoAttribution: skipping ${objectId} — stage ${stage || '(none)'} is not the published stage`);
    return result(
      200,
      { skipped: true, reason: 'video is not in the published stage', objectId, stage },
      { attributionStatus: 'skipped', reason: 'not_published_stage' },
    );
  }

  // Gate 2 — a link that is already in the wild is never regenerated.
  if (existingLink && !force) {
    console.log(`VideoAttribution: skipping ${objectId} — utm_link already set`);
    return result(
      200,
      { skipped: true, reason: 'utm_link already exists', objectId, utmLink: existingLink },
      { attributionStatus: 'skipped', reason: 'link already exists', utmLink: existingLink },
    );
  }

  // A workflow input wins over the stored property, so one action can both set
  // the destination/campaign and generate the link. That is `saveWebsiteLink`
  // and `linkCampaign` folded into this call.
  const destinationUrl = param(context, 'destinationUrl') ?? prop(props, 'website_url');
  const campaignName = param(context, 'campaignName') ?? prop(props, 'campaign_name');
  const mediumInput = param(context, 'utmMedium');
  const medium = isUtmMedium(mediumInput) ? mediumInput : DEFAULT_UTM_MEDIUM;

  let link: ReturnType<typeof buildUtmLink>;
  try {
    link = buildUtmLink({
      destinationUrl,
      campaignName,
      medium,
      content: prop(props, 'title'),
    });
  } catch (err) {
    if (err instanceof UtmError) {
      // A missing destination or campaign is a data problem on the record, not
      // a fault. FAIL_CONTINUE territory: report it and let the workflow branch.
      console.warn(`VideoAttribution: cannot build a link for ${objectId}: ${err.message}`);
      return result(400, { error: err.message, objectId }, { attributionStatus: 'error', reason: err.code });
    }
    throw err;
  }

  // Write back the generated link plus any input-supplied attribution values,
  // so the record ends up carrying the inputs the link was built from.
  const properties: Record<string, string> = { utm_link: link.url };
  if (destinationUrl && destinationUrl !== prop(props, 'website_url')) {
    properties.website_url = destinationUrl;
  }
  if (campaignName && campaignName !== prop(props, 'campaign_name')) {
    properties.campaign_name = campaignName;
  }

  try {
    await hsUpdate(objectTypeId, objectId, properties);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`VideoAttribution: write failed for ${objectId}:`, message);
    return result(502, { error: `Could not write attribution properties: ${message}` }, { attributionStatus: 'error', reason: 'write_failed' });
  }

  console.log(`VideoAttribution: wrote utm_link for ${objectId} (campaign ${link.params.utm_campaign})${force && existingLink ? ' (forced overwrite)' : ''}`);
  return result(
    200,
    {
      skipped: false,
      objectId,
      overwritten: Boolean(existingLink),
      utmLink: link.url,
      destinationUrl: link.destinationUrl,
      params: link.params,
      propertiesWritten: Object.keys(properties),
    },
    {
      attributionStatus: existingLink ? 'regenerated' : 'generated',
      utmLink: link.url,
      campaign: link.params.utm_campaign,
      medium: link.params.utm_medium,
    },
  );
}
