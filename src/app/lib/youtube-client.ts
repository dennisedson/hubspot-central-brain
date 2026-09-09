/**
 * YouTube Data API v3 + YouTube Analytics API v2 client.
 *
 * Ported from the legacy Firebase `creator-console` backend
 * (`backend_functions/src/utils/sync.ts`). Two things changed in the port:
 *
 *   1. `axios` + `googleapis` are gone. Plain `fetch` against a module-level
 *      base, matching `asana-client.ts` / `fellow-client.ts`.
 *   2. The ETag optimisation was promoted from a post-hoc comparison to a real
 *      conditional request. The legacy code fetched every video in full and
 *      then compared the returned ETag with the stored one to decide whether to
 *      write to HubSpot. That saved CRM writes but nothing else. Here the
 *      stored ETag also rides out on `If-None-Match`, so an unchanged batch
 *      comes back as a bodyless `304 Not Modified`.
 *
 * WHY 304 IS THE FRAGILE PART
 * ---------------------------
 * `fetch` reports `res.ok === false` for a 304, because `ok` is only true for
 * 2xx. Any client that checks `!res.ok` before checking the status turns every
 * cache hit into a thrown error — and since the fallback is "fetch everything",
 * the optimisation disappears with no visible symptom beyond a bigger bill.
 * The status check below is deliberately ahead of the error check, and
 * `youtube-sync.test.ts` asserts that ordering directly.
 */

/** YouTube Data API v3. Allowlisted in `app-hsmeta.json` as www.googleapis.com. */
const YOUTUBE_DATA_API = 'https://www.googleapis.com/youtube/v3';

/** YouTube Analytics API v2. A different host, separately allowlisted. */
const YOUTUBE_ANALYTICS_API = 'https://youtubeanalytics.googleapis.com/v2';

/**
 * Maximum video ids per `videos.list` call. This is the API's own cap; sending
 * more silently truncates the response, which would look like "some videos
 * stopped syncing".
 */
export const VIDEO_BATCH_SIZE = 50;

/** Analytics window. Matches the legacy backend: trailing year, whole days. */
const ANALYTICS_WINDOW_DAYS = 365;

export interface YouTubeVideo {
  id: string;
  /** Per-video ETag. Changes when ANY requested part changes. */
  etag?: string;
  snippet?: {
    title?: string;
    description?: string;
    channelId?: string;
    channelTitle?: string;
    publishedAt?: string;
    tags?: string[];
    thumbnails?: Record<string, { url?: string } | undefined>;
  };
  statistics?: {
    viewCount?: string;
    likeCount?: string;
    commentCount?: string;
  };
  status?: {
    privacyStatus?: string;
  };
}

export interface VideoBatchResult {
  /** True when YouTube answered 304 — the batch is byte-identical to last run. */
  notModified: boolean;
  /** The batch-level ETag to store for the next run. Null if YouTube sent none. */
  etag: string | null;
  /** Empty on a 304. YouTube sends no body with one. */
  items: YouTubeVideo[];
}

export interface VideoAnalytics {
  impressions: number;
  clickThroughRate: number;
  averageViewDuration: number;
}

/**
 * A stable cache key for one batch of video ids.
 *
 * The batch ETag belongs to the *response*, and the response is determined by
 * the exact id list that was requested — so the key has to be the exact list,
 * in the exact order, not a position or an index. Adding or removing a video
 * changes the key, which correctly forces a full fetch for that batch rather
 * than comparing against an ETag for a different set of videos.
 *
 * djb2, base36. This is a cache key, not a security boundary: collisions cost
 * one unnecessary refetch (the per-video ETag check still gates the write).
 */
export function videoBatchKey(videoIds: string[]): string {
  let hash = 5381;
  const joined = videoIds.join(',');
  for (let i = 0; i < joined.length; i++) {
    hash = ((hash << 5) + hash + joined.charCodeAt(i)) | 0;
  }
  return (hash >>> 0).toString(36);
}

/** Splits ids into API-sized batches. Callers sort first so keys stay stable. */
export function chunkVideoIds(videoIds: string[], size = VIDEO_BATCH_SIZE): string[][] {
  const batches: string[][] = [];
  for (let i = 0; i < videoIds.length; i += size) {
    batches.push(videoIds.slice(i, i + size));
  }
  return batches;
}

/**
 * Fetches one batch of videos, conditionally.
 *
 * `storedEtag` is the ETag this batch returned last run. When present it goes
 * out as `If-None-Match`; YouTube then answers `304` with no body if nothing
 * about any video in the batch has changed, and the caller can skip the batch
 * entirely — no parsing, no CRM writes.
 *
 * The requested parts are what the `video` object actually has columns for:
 * `snippet` (title, description, thumbnail, tags, published date, channel),
 * `statistics` (the three counts) and `status` (privacy). `contentDetails` is
 * NOT requested — the legacy code pulled it for duration properties that do not
 * exist on this object, and every extra part widens the ETag, meaning more
 * false "changed" verdicts and more writes.
 */
export async function fetchVideoBatch(
  accessToken: string,
  videoIds: string[],
  storedEtag: string | null = null,
): Promise<VideoBatchResult> {
  if (videoIds.length === 0) {
    return { notModified: false, etag: null, items: [] };
  }

  const params = new URLSearchParams({
    part: 'snippet,statistics,status',
    id: videoIds.join(','),
    maxResults: String(VIDEO_BATCH_SIZE),
  });

  const res = await fetch(`${YOUTUBE_DATA_API}/videos?${params}`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...(storedEtag ? { 'If-None-Match': storedEtag } : {}),
    },
  });

  // MUST come before the !res.ok check: a 304 is not "ok" as far as fetch is
  // concerned. See the module header.
  if (res.status === 304) {
    return { notModified: true, etag: storedEtag, items: [] };
  }

  if (!res.ok) {
    throw new Error(`YouTube videos.list failed ${res.status}: ${await res.text()}`);
  }

  const json = (await res.json()) as { etag?: string; items?: YouTubeVideo[] };
  return {
    notModified: false,
    // Prefer the body's ETag; fall back to the header for the same reason the
    // conditional request exists — either one is a valid validator to replay.
    etag: json.etag ?? res.headers.get('etag') ?? null,
    items: json.items ?? [],
  };
}

/**
 * Fetches impressions, impression CTR and average view duration for a set of
 * videos, keyed by video id.
 *
 * WHY TWO REQUESTS
 * Impressions live in a different Analytics report group from watch-time
 * metrics; the API rejects a request that mixes them. So: one call for
 * `averageViewDuration`, one for `impressions,impressionsClickThroughRate`,
 * merged on video id.
 *
 * WHY COLUMN HEADERS INSTEAD OF FIXED INDEXES
 * The Analytics API answers with bare rows — `[["abc123", 12, 0.05], …]` — and
 * the legacy port hardcoded the column offsets. It also got them wrong: it read
 * `clickThroughRate` and `subscribersGained` from the same index, so one of the
 * two was always garbage, and nothing could catch it because both are numbers.
 * Every value here is located through `columnHeaders`, which the API returns
 * alongside the rows.
 */
export async function fetchVideoAnalytics(
  accessToken: string,
  channelId: string,
  videoIds: string[],
): Promise<Map<string, VideoAnalytics>> {
  const analytics = new Map<string, VideoAnalytics>();
  if (videoIds.length === 0 || !channelId) return analytics;

  const endDate = isoDate(Date.now());
  const startDate = isoDate(Date.now() - ANALYTICS_WINDOW_DAYS * 24 * 60 * 60 * 1000);

  for (const batch of chunkVideoIds(videoIds)) {
    const [watchTime, impressions] = await Promise.all([
      runAnalyticsReport(accessToken, channelId, batch, startDate, endDate, 'views,averageViewDuration'),
      runAnalyticsReport(accessToken, channelId, batch, startDate, endDate, 'views,impressions,impressionsClickThroughRate'),
    ]);

    for (const videoId of batch) {
      const duration = watchTime.get(videoId);
      const reach = impressions.get(videoId);
      if (!duration && !reach) continue;
      analytics.set(videoId, {
        impressions: reach?.impressions ?? 0,
        clickThroughRate: reach?.impressionsClickThroughRate ?? 0,
        averageViewDuration: duration?.averageViewDuration ?? 0,
      });
    }
  }

  return analytics;
}

interface AnalyticsReportResponse {
  columnHeaders?: Array<{ name?: string }>;
  rows?: Array<Array<string | number>>;
}

/**
 * One Analytics report, returned as videoId -> { metricName: value }.
 * The `video` dimension is always the first column, and is the join key.
 */
async function runAnalyticsReport(
  accessToken: string,
  channelId: string,
  videoIds: string[],
  startDate: string,
  endDate: string,
  metrics: string,
): Promise<Map<string, Record<string, number>>> {
  const params = new URLSearchParams({
    ids: `channel==${channelId}`,
    startDate,
    endDate,
    dimensions: 'video',
    metrics,
    filters: `video==${videoIds.join(',')}`,
    maxResults: String(VIDEO_BATCH_SIZE),
  });

  const res = await fetch(`${YOUTUBE_ANALYTICS_API}/reports?${params}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    throw new Error(`YouTube Analytics report failed ${res.status}: ${await res.text()}`);
  }

  const json = (await res.json()) as AnalyticsReportResponse;
  const headers = (json.columnHeaders ?? []).map(h => h.name ?? '');
  const videoColumn = headers.indexOf('video');

  const byVideo = new Map<string, Record<string, number>>();
  for (const row of json.rows ?? []) {
    const videoId = String(row[videoColumn === -1 ? 0 : videoColumn]);
    const values: Record<string, number> = {};
    headers.forEach((name, index) => {
      if (index === videoColumn || !name) return;
      values[name] = Number(row[index]) || 0;
    });
    byVideo.set(videoId, values);
  }
  return byVideo;
}

/** YYYY-MM-DD in UTC — the only date format the Analytics API accepts. */
function isoDate(epochMs: number): string {
  return new Date(epochMs).toISOString().split('T')[0];
}
