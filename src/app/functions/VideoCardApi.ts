import { getPortalConfig } from '../lib/portal-config';
import { HS_BASE, objectPath } from '../lib/hs-api';

/**
 * Backing API for the Video card. Reads one video record's identity and
 * metrics so the card can render without the extension needing CRM read
 * scopes of its own — the same shape as TaskStatusApi, RelatedContentApi and
 * the other card backends here.
 *
 * Deliberately read-only. The card's two actions (sync, suggest) call
 * youtube_sync and video_ai_suggestions directly, so nothing here mutates and
 * a broken card can never write to a record.
 */

const VIDEO_PROPERTIES = [
  'title',
  'youtube_video_id',
  'youtube_url',
  'view_count',
  'like_count',
  'comment_count',
  'impressions',
  'click_through_rate',
  'average_view_duration',
  'utm_link',
  'campaign_name',
  'website_url',
  'hs_lastmodifieddate',
] as const;

interface VideoCardContext {
  accountId?: number;
  params?: Record<string, string | string[] | undefined>;
  parameters?: Record<string, string | undefined>;
  query?: Record<string, string | undefined>;
  body?: Record<string, string | undefined>;
}

export interface VideoCardPayload {
  objectId: string;
  title: string | null;
  youtubeVideoId: string | null;
  youtubeUrl: string | null;
  /** Null where the property is unset — distinct from a real zero. */
  viewCount: string | null;
  likeCount: string | null;
  commentCount: string | null;
  impressions: string | null;
  clickThroughRate: string | null;
  averageViewDuration: string | null;
  utmLink: string | null;
  campaignName: string | null;
  websiteUrl: string | null;
  lastModified: string | null;
}

function param(ctx: VideoCardContext, key: string): string | undefined {
  const q = ctx.params?.[key];
  const fromQuery = Array.isArray(q) ? q[0] : q;
  return fromQuery ?? ctx.parameters?.[key] ?? ctx.query?.[key] ?? ctx.body?.[key];
}

function getToken(): string {
  const token = process.env.PRIVATE_APP_ACCESS_TOKEN ?? process.env.HS_ACCESS_TOKEN;
  if (!token) throw new Error('No HubSpot access token available');
  return token;
}

export async function readVideoCard(
  objectTypeId: string,
  objectId: string,
): Promise<VideoCardPayload> {
  const url = `${HS_BASE}${objectPath(objectTypeId, objectId)}?properties=${VIDEO_PROPERTIES.join(',')}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${getToken()}` } });
  if (!res.ok) throw new Error(`HubSpot read failed ${res.status}: ${(await res.text()).slice(0, 200)}`);

  const body = (await res.json()) as { properties?: Record<string, string | null> };
  const p = body.properties ?? {};
  return {
    objectId,
    title: p.title ?? null,
    youtubeVideoId: p.youtube_video_id ?? null,
    youtubeUrl: p.youtube_url ?? null,
    viewCount: p.view_count ?? null,
    likeCount: p.like_count ?? null,
    commentCount: p.comment_count ?? null,
    impressions: p.impressions ?? null,
    clickThroughRate: p.click_through_rate ?? null,
    averageViewDuration: p.average_view_duration ?? null,
    utmLink: p.utm_link ?? null,
    campaignName: p.campaign_name ?? null,
    websiteUrl: p.website_url ?? null,
    lastModified: p.hs_lastmodifieddate ?? null,
  };
}

export const main = async (
  context: VideoCardContext,
): Promise<{ statusCode: number; body: string }> => {
  const objectId = param(context, 'objectId');
  if (!objectId) {
    return { statusCode: 400, body: JSON.stringify({ error: 'objectId is required' }) };
  }

  const portalId = context.accountId ?? parseInt(param(context, 'portalId') ?? '0', 10);
  if (!portalId) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Missing portalId' }) };
  }

  try {
    const config = getPortalConfig(portalId);
    const payload = await readVideoCard(config.video.objectTypeId, objectId);
    return { statusCode: 200, body: JSON.stringify(payload) };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('VideoCardApi failed:', message);
    return { statusCode: 500, body: JSON.stringify({ error: message }) };
  }
};

export default main;
