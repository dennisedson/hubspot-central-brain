import { useEffect, useState } from 'react';
import {
  hubspot,
  Accordion,
  Alert,
  Button,
  ButtonRow,
  Divider,
  Flex,
  Heading,
  Link,
  LoadingSpinner,
  Statistics,
  StatisticsItem,
  Tag,
  Text,
} from '@hubspot/ui-extensions';

/**
 * The Video card.
 *
 * Until this existed, every video function was reachable only by curl: the
 * OAuth status, the metrics sync and the AI suggestions all worked and none of
 * them had a surface. This is that surface.
 *
 * Three backends, deliberately kept separate:
 *   video_card_api        read-only, renders the record
 *   youtube_sync          refreshes metrics from YouTube
 *   video_ai_suggestions  asks Claude for titles/description/tags
 *
 * Suggestions are shown, never applied. Nothing here writes to the record — a
 * person reads them and decides. The same rule social-draft established.
 */

interface VideoPayload {
  objectId: string;
  title: string | null;
  youtubeVideoId: string | null;
  youtubeUrl: string | null;
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

interface ConnectionPayload {
  status: 'connected' | 'pending_secret' | 'disconnected';
  connected: boolean;
  hasRefreshTokenSecret: boolean;
  channelTitle: string | null;
  lastSync: string | null;
}

interface SyncOutcome {
  recordsFound: number;
  recordsUpdated: number;
  batchesNotModified: number;
  errors: string[];
}

interface TitleSuggestion {
  title: string;
  reasoning?: string;
}

interface Suggestions {
  titles: TitleSuggestion[];
  description: string;
  tags: string[];
  descriptionTruncated: boolean;
}

interface ServerlessResult {
  statusCode: number;
  body: unknown;
}

type Serverless = (
  uid: string,
  opts: { parameters: Record<string, string> },
) => Promise<ServerlessResult>;

const callServerless = hubspot.serverless as unknown as Serverless;

/**
 * Function bodies are not consistently typed across this app: the card APIs
 * return a JSON string, while youtube_sync and video_ai_suggestions return an
 * object. Normalise here rather than making every caller guess.
 */
function parseBody<T>(result: ServerlessResult): T {
  if (typeof result?.body === 'string') return JSON.parse(result.body) as T;
  return result?.body as T;
}

function metric(value: string | null): string {
  if (value === null || value === '') return '—';
  const n = Number(value);
  return Number.isFinite(n) ? n.toLocaleString() : value;
}

function formatWhen(iso: string | null): string {
  if (!iso) return 'never';
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  if (mins < 1440) return `${Math.round(mins / 60)}h ago`;
  return `${Math.round(mins / 1440)}d ago`;
}

function ConnectionBanner({ conn }: { conn: ConnectionPayload | null }) {
  if (!conn || conn.status === 'connected') return null;

  // pending_secret is a genuine, reachable state, not an error: the channel is
  // known and the code was exchanged, but YOUTUBE_REFRESH_TOKEN is still a
  // placeholder, so no API call can succeed. Say that, rather than "failed".
  if (conn.status === 'pending_secret') {
    return (
      <Alert title="Authorised, but not finished" variant="warning">
        <Text>
          The channel is connected{conn.channelTitle ? ` (${conn.channelTitle})` : ''}, but the
          refresh token is still a placeholder. Set the YOUTUBE_REFRESH_TOKEN secret and redeploy —
          until then, syncing cannot reach YouTube.
        </Text>
      </Alert>
    );
  }

  return (
    <Alert title="YouTube is not connected" variant="warning">
      <Text>Authorise the channel before syncing metrics for this video.</Text>
    </Alert>
  );
}

const Card = ({ context }: { context: { crm: { objectId: string | number }; portal: { id: string | number } } }) => {
  const objectId = String(context.crm.objectId);
  const portalId = String(context.portal.id);

  const [video, setVideo] = useState<VideoPayload | null>(null);
  const [conn, setConn] = useState<ConnectionPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [syncing, setSyncing] = useState(false);
  const [syncNote, setSyncNote] = useState<string | null>(null);

  const [suggesting, setSuggesting] = useState(false);
  const [suggestions, setSuggestions] = useState<Suggestions | null>(null);
  const [suggestError, setSuggestError] = useState<string | null>(null);

  async function loadVideo(): Promise<VideoPayload> {
    const res = await callServerless('video_card_api', { parameters: { objectId, portalId } });
    const parsed = parseBody<VideoPayload & { error?: string }>(res);
    if (res.statusCode !== 200) throw new Error(parsed?.error ?? `HTTP ${res.statusCode}`);
    return parsed;
  }

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [v, c] = await Promise.all([
          loadVideo(),
          callServerless('youtube_auth', { parameters: { action: 'status', portalId } })
            .then((r) => parseBody<ConnectionPayload>(r))
            // A failed status read must not blank the whole card — the metrics
            // on the record are still worth showing.
            .catch(() => null),
        ]);
        if (!cancelled) {
          setVideo(v);
          setConn(c);
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Could not load this video');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [objectId, portalId]);

  async function onSync() {
    setSyncing(true);
    setSyncNote(null);
    try {
      const res = await callServerless('youtube_sync', { parameters: { portalId } });
      const outcome = parseBody<SyncOutcome>(res);
      if (res.statusCode !== 200) throw new Error(`HTTP ${res.statusCode}`);
      setVideo(await loadVideo());
      setSyncNote(
        outcome.errors?.length
          ? `Synced with ${outcome.errors.length} error(s): ${outcome.errors[0]}`
          : `Updated ${outcome.recordsUpdated} of ${outcome.recordsFound} video record(s).`,
      );
    } catch (err) {
      setSyncNote(err instanceof Error ? err.message : 'Sync failed');
    } finally {
      setSyncing(false);
    }
  }

  async function onSuggest() {
    setSuggesting(true);
    setSuggestError(null);
    setSuggestions(null);
    try {
      const res = await callServerless('video_ai_suggestions', {
        parameters: { recordId: objectId, portalId },
      });
      const parsed = parseBody<{ suggestions: Suggestions; message?: string }>(res);
      if (res.statusCode !== 200) throw new Error(parsed?.message ?? `HTTP ${res.statusCode}`);
      setSuggestions(parsed.suggestions);
    } catch (err) {
      setSuggestError(err instanceof Error ? err.message : 'Could not get suggestions');
    } finally {
      setSuggesting(false);
    }
  }

  if (loading) return <LoadingSpinner label="Loading video…" />;
  if (error) {
    return (
      <Alert title="Could not load this video" variant="error">
        <Text>{error}</Text>
      </Alert>
    );
  }
  if (!video) return <Text>No video data.</Text>;

  const noVideoId = !video.youtubeVideoId;

  return (
    <Flex direction="column" gap="medium">
      <ConnectionBanner conn={conn} />

      {noVideoId && (
        <Alert title="No YouTube video linked" variant="info">
          <Text>Set youtube_video_id on this record before syncing metrics.</Text>
        </Alert>
      )}

      <Flex direction="row" gap="small" align="center">
        {video.youtubeVideoId && <Tag>{video.youtubeVideoId}</Tag>}
        {video.youtubeUrl && (
          <Link href={video.youtubeUrl}>Watch on YouTube</Link>
        )}
      </Flex>

      <Statistics>
        <StatisticsItem label="Views" number={metric(video.viewCount)} />
        <StatisticsItem label="Likes" number={metric(video.likeCount)} />
        <StatisticsItem label="Comments" number={metric(video.commentCount)} />
      </Statistics>

      <Statistics>
        <StatisticsItem label="Impressions" number={metric(video.impressions)} />
        <StatisticsItem label="CTR" number={metric(video.clickThroughRate)} />
        <StatisticsItem label="Avg view (s)" number={metric(video.averageViewDuration)} />
      </Statistics>

      <Text variant="microcopy">
        Record updated {formatWhen(video.lastModified)}
        {conn?.lastSync ? ` · channel synced ${formatWhen(conn.lastSync)}` : ''}
      </Text>

      <Divider />

      <ButtonRow>
        <Button onClick={() => void onSync()} disabled={syncing || noVideoId || !conn?.connected}>
          {syncing ? 'Syncing…' : 'Sync metrics'}
        </Button>
        <Button onClick={() => void onSuggest()} disabled={suggesting}>
          {suggesting ? 'Asking Claude…' : 'Suggest metadata'}
        </Button>
      </ButtonRow>

      {syncing && <LoadingSpinner label="Fetching from YouTube…" />}
      {syncNote && <Text variant="microcopy">{syncNote}</Text>}

      {/* The suggestion call routinely takes ~13s, so an explicit wait state is
          not optional here — without it the card looks broken. */}
      {suggesting && <LoadingSpinner label="Claude is reviewing this video — this takes a few seconds…" />}

      {suggestError && (
        <Alert title="Suggestions unavailable" variant="error">
          <Text>{suggestError}</Text>
        </Alert>
      )}

      {suggestions && (
        <Flex direction="column" gap="small">
          <Heading>Suggestions</Heading>
          <Text variant="microcopy">
            Nothing below has been saved. Copy anything you want to keep.
          </Text>

          {suggestions.titles.map((t, i) => (
            <Accordion key={i} title={t.title}>
              <Text>{t.reasoning ?? 'No reasoning given.'}</Text>
            </Accordion>
          ))}

          <Accordion title="Suggested description">
            <Text>{suggestions.description}</Text>
            {suggestions.descriptionTruncated && (
              <Text variant="microcopy">Truncated to fit YouTube&apos;s limit.</Text>
            )}
          </Accordion>

          <Flex direction="row" gap="extra-small" wrap="wrap">
            {suggestions.tags.map((tag) => (
              <Tag key={tag}>{tag}</Tag>
            ))}
          </Flex>
        </Flex>
      )}
    </Flex>
  );
};

hubspot.extend<'crm.record.tab'>(({ context }) => <Card context={context as never} />);
