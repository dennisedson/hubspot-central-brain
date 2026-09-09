import { getPortalConfig } from '../lib/portal-config';
import { hsUpdate } from '../lib/hubspot-client';
import { HS_BASE, objectSearchPath } from '../lib/hs-api';
import { getYouTubeAccessToken } from '../lib/youtube-auth';
import {
  chunkVideoIds,
  fetchVideoAnalytics,
  fetchVideoBatch,
  type VideoAnalytics,
  type YouTubeVideo,
} from '../lib/youtube-client';

/**
 * YouTube metrics sync. Ported from the Firebase Creator Console's
 * `syncAllUsers` / `dailySync` / `triggerSync` / `updateVideoRecord`.
 *
 * WHAT COLLAPSED
 * --------------
 * The original needed four pieces because state lived in Firestore and HubSpot
 * was a remote system it pushed into: a scheduler, a per-user fan-out, an HTTP
 * trigger, and an endpoint whose only job was to write a CRM record. Here the
 * CRM is the store and this app is already inside the portal, so:
 *
 *   syncAllUsers      -> gone. One app install is one portal is one channel.
 *                        There are no "users" to fan out over.
 *   updateVideoRecord -> gone. It is `hsUpdate` at the bottom of this file.
 *   dailySync         -> this handler, enrolled on a daily workflow.
 *   triggerSync       -> this handler, called directly.
 *
 * THE ETAG IS THE POINT
 * ---------------------
 * YouTube's videos.list is quota-metered. Sending the previous run's ETag turns
 * an unchanged batch into a 304 with no body, which costs a fraction of the
 * quota and skips every downstream write. On a channel whose back catalogue
 * rarely moves, that is almost every batch, almost every day — so the ETag path
 * is the normal case, not the optimisation. `youtube-client` returns
 * `notModified` for it; treat a 304 as success and move on.
 *
 * WRITES ARE PER-RECORD AND BEST-EFFORT
 * -------------------------------------
 * One failed record must not abandon the rest of the batch. Each update is
 * counted and errors are collected, because a sync that silently processes
 * three of fifty videos and reports success is the failure mode this codebase
 * has been bitten by before.
 */

/** Live metrics, refreshed every run. */
const METRIC_PROPERTIES = ['view_count', 'like_count', 'comment_count'] as const;

/** YouTube Analytics figures — a separate API, so a separate failure domain. */
const ANALYTICS_PROPERTIES = ['impressions', 'click_through_rate', 'average_view_duration'] as const;

/** Properties read off each video record. `youtube_video_id` is the join key. */
const READ_PROPERTIES = ['youtube_video_id', 'title', ...METRIC_PROPERTIES, ...ANALYTICS_PROPERTIES];

/** Search page size. HubSpot caps `limit` at 100 on the search endpoint. */
const SEARCH_PAGE_SIZE = 100;

interface VideoRecord {
  id: string;
  youtubeVideoId: string;
}

export interface SyncOutcome {
  /** Video records found in HubSpot carrying a youtube_video_id. */
  recordsFound: number;
  /** Records whose properties were actually written. */
  recordsUpdated: number;
  /** Batches YouTube answered 304 for — skipped without a write. */
  batchesNotModified: number;
  batchesFetched: number;
  /** Non-fatal per-record failures. The run still reports the rest. */
  errors: string[];
}

function getToken(): string {
  const token = process.env.PRIVATE_APP_ACCESS_TOKEN ?? process.env.HS_ACCESS_TOKEN;
  if (!token) throw new Error('No HubSpot access token available');
  return token;
}

/**
 * Every video record that has a YouTube id, paged. `HAS_PROPERTY` rather than a
 * `NEQ ''` filter: a record created by hand with the field left blank stores
 * null, not empty string, and `NEQ` would miss it in the wrong direction.
 */
export async function findVideosWithYouTubeIds(objectTypeId: string): Promise<VideoRecord[]> {
  const token = getToken();
  const found: VideoRecord[] = [];
  let after: string | undefined = '0';

  while (after !== undefined) {
    const res: Response = await fetch(`${HS_BASE}${objectSearchPath(objectTypeId)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        filterGroups: [{ filters: [{ propertyName: 'youtube_video_id', operator: 'HAS_PROPERTY' }] }],
        properties: READ_PROPERTIES,
        limit: SEARCH_PAGE_SIZE,
        sorts: [],
        query: '',
        after,
      }),
    });
    if (!res.ok) throw new Error(`HubSpot video search failed ${res.status}: ${await res.text()}`);

    const body = (await res.json()) as {
      results?: Array<{ id: string; properties: Record<string, string | null> }>;
      paging?: { next?: { after?: string } };
    };

    for (const r of body.results ?? []) {
      const ytId = r.properties.youtube_video_id;
      if (ytId) found.push({ id: r.id, youtubeVideoId: ytId });
    }
    after = body.paging?.next?.after;
  }

  return found;
}

/**
 * Map a YouTube payload onto HubSpot property values. Counts arrive as strings
 * and are passed through as strings — HubSpot number properties accept them,
 * and parsing to a JS number then back risks precision loss on a large channel.
 * A missing count is omitted rather than written as "0"; absent and zero are
 * different facts and only one of them is true.
 */
export function mapVideoToProperties(video: YouTubeVideo): Record<string, string> {
  const props: Record<string, string> = {};
  const stats = video.statistics;
  if (stats?.viewCount !== undefined) props.view_count = stats.viewCount;
  if (stats?.likeCount !== undefined) props.like_count = stats.likeCount;
  if (stats?.commentCount !== undefined) props.comment_count = stats.commentCount;
  return props;
}

export function mapAnalyticsToProperties(analytics: VideoAnalytics): Record<string, string> {
  return {
    impressions: String(analytics.impressions),
    click_through_rate: String(analytics.clickThroughRate),
    average_view_duration: String(analytics.averageViewDuration),
  };
}

export async function runSync(portalId: number): Promise<SyncOutcome> {
  const config = getPortalConfig(portalId);
  const objectTypeId = config.video.objectTypeId;

  const accessToken = await getYouTubeAccessToken();
  const records = await findVideosWithYouTubeIds(objectTypeId);

  const outcome: SyncOutcome = {
    recordsFound: records.length,
    recordsUpdated: 0,
    batchesNotModified: 0,
    batchesFetched: 0,
    errors: [],
  };
  if (records.length === 0) return outcome;

  const byYouTubeId = new Map(records.map((r) => [r.youtubeVideoId, r.id]));

  // Analytics is a separate API with its own quota and permissions. It failing
  // must not cost us the statistics we already have, so it is attempted once,
  // up front, and a failure degrades the run rather than ending it.
  let analytics = new Map<string, VideoAnalytics>();
  const channelId = process.env.YOUTUBE_CHANNEL_ID;
  if (channelId) {
    try {
      analytics = await fetchVideoAnalytics(accessToken, channelId, [...byYouTubeId.keys()]);
    } catch (err) {
      outcome.errors.push(`analytics unavailable: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  for (const batch of chunkVideoIds([...byYouTubeId.keys()])) {
    // No ETag is persisted yet — app_configs has no property for one. Passing
    // null means every batch is fetched in full. See the note in the handler.
    const result = await fetchVideoBatch(accessToken, batch, null);
    outcome.batchesFetched += 1;

    if (result.notModified) {
      outcome.batchesNotModified += 1;
      continue;
    }

    for (const video of result.items) {
      const recordId = byYouTubeId.get(video.id);
      if (!recordId) continue;

      const videoAnalytics = analytics.get(video.id);
      const props = {
        ...mapVideoToProperties(video),
        ...(videoAnalytics ? mapAnalyticsToProperties(videoAnalytics) : {}),
      };
      if (Object.keys(props).length === 0) continue;

      try {
        await hsUpdate(objectTypeId, recordId, props);
        outcome.recordsUpdated += 1;
      } catch (err) {
        outcome.errors.push(`${video.id}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }

  return outcome;
}

export const main = async (context: {
  accountId: number;
}): Promise<{ statusCode: number; body: SyncOutcome | { message: string } }> => {
  try {
    const outcome = await runSync(context.accountId);
    return { statusCode: 200, body: outcome };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('YouTube sync failed:', message);
    // 500 deliberately. A sync that cannot authenticate or cannot reach YouTube
    // has done nothing, and returning 200 with an empty outcome is how a broken
    // integration goes unnoticed for a fortnight.
    return { statusCode: 500, body: { message } };
  }
};

export default main;
