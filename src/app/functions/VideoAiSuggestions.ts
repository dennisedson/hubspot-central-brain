import { getPortalConfig } from '../lib/portal-config';
import { HS_BASE, objectPath } from '../lib/hs-api';
import {
  ClaudeError,
  requestVideoSuggestions,
  type SuggestionResult,
  type VideoFacts,
} from '../lib/claude-client';

/**
 * AI title / description / tag suggestions for a Video record. Ported from the
 * Firebase Creator Console's `analyzeVideo`, `analyzeVideoV2`, `checkTranscript`
 * and `applyAIOptimizations`, with Gemini replaced by Claude.
 *
 * WHY THIS RETURNS SUGGESTIONS INSTEAD OF WRITING THEM
 * ----------------------------------------------------
 * The original had an `applyAIOptimizations` endpoint that wrote the model's
 * title and description straight onto the record. Two reasons this one does
 * not, and the second is the blocking one:
 *
 *   1. This codebase does not overwrite human-authored content. `social-draft`
 *      established the rule — a draft is offered, a person accepts it. A title
 *      someone wrote and a title a model proposed are not interchangeable, and
 *      the person who wrote it is not present to object.
 *
 *   2. There is nowhere to put them. The `video` object has 23 custom
 *      properties and none of them is a suggestions field. Writing into
 *      `title` / `video_description` would BE the clobber in (1), and inventing
 *      a property here would provision schema from a request handler.
 *
 * So suggestions come back in the response body for a card or a person to act
 * on. Persisting them is a real follow-up and it starts with provisioning a
 * property, not with editing this file.
 *
 * ON TRANSCRIPTS
 * --------------
 * `checkTranscript` polled YouTube's caption API and gated the analysis on a
 * transcript existing. That gate is not reproduced: the caller may pass a
 * transcript and the prompt uses it when present, but a video without captions
 * still gets suggestions from its metadata. Refusing to help because captions
 * have not finished processing is a worse default than helping with less.
 */

/** Properties read off the video record to build the prompt. */
const FACT_PROPERTIES = [
  'title',
  'video_description',
  'tags',
  'youtube_url',
  'series_name',
  'campaign_name',
] as const;

export interface SuggestionRequest {
  /** HubSpot record id of the video. */
  recordId?: string;
  /** Optional transcript supplied by the caller; not fetched from YouTube. */
  transcript?: string;
}

function getToken(): string {
  const token = process.env.PRIVATE_APP_ACCESS_TOKEN ?? process.env.HS_ACCESS_TOKEN;
  if (!token) throw new Error('No HubSpot access token available');
  return token;
}

/** Read one video record and shape it into the facts the prompt expects. */
export async function readVideoFacts(objectTypeId: string, recordId: string): Promise<VideoFacts> {
  const token = getToken();
  const url = `${HS_BASE}${objectPath(objectTypeId, recordId)}?properties=${FACT_PROPERTIES.join(',')}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`HubSpot read failed ${res.status}: ${await res.text()}`);

  const body = (await res.json()) as { properties?: Record<string, string | null> };
  const p = body.properties ?? {};
  return {
    title: p.title,
    description: p.video_description,
    tags: p.tags,
    youtubeUrl: p.youtube_url,
    seriesName: p.series_name,
    campaignName: p.campaign_name,
  };
}

export interface SuggestionResponse extends SuggestionResult {
  recordId: string;
  /** Echoed so a caller can show what the suggestions were made against. */
  basedOn: VideoFacts;
}

export async function suggestForRecord(
  portalId: number,
  recordId: string,
  transcript?: string,
): Promise<SuggestionResponse> {
  const config = getPortalConfig(portalId);
  const facts = await readVideoFacts(config.video.objectTypeId, recordId);
  const result = await requestVideoSuggestions({ ...facts, transcript: transcript ?? null });
  return { ...result, recordId, basedOn: facts };
}

interface SuggestionsContext {
  accountId?: number;
  params?: Record<string, string | string[] | undefined>;
  parameters?: Record<string, string | undefined>;
  query?: Record<string, string | undefined>;
  body?: SuggestionRequest;
}

/**
 * The card calls this through `hubspot.serverless()`, which delivers values in
 * `parameters` — not in the body this handler used to read exclusively, and
 * not with the `accountId` a gateway request carries. Reading only the body
 * made every card request a 400, and only `accountId` would have made it a 500.
 * Query params on a public URL arrive in `params` as ARRAYS.
 */
function param(ctx: SuggestionsContext, key: string): string | undefined {
  const q = ctx.params?.[key];
  const fromQuery = Array.isArray(q) ? q[0] : q;
  const fromBody = (ctx.body as Record<string, unknown> | undefined)?.[key];
  return (
    fromQuery ??
    ctx.parameters?.[key] ??
    ctx.query?.[key] ??
    (typeof fromBody === 'string' ? fromBody : undefined)
  );
}

export const main = async (
  context: SuggestionsContext,
): Promise<{ statusCode: number; body: SuggestionResponse | { message: string } }> => {
  const recordId = param(context, 'recordId');
  if (!recordId) {
    return { statusCode: 400, body: { message: 'recordId is required' } };
  }

  const portalId = context.accountId ?? parseInt(param(context, 'portalId') ?? '0', 10);
  if (!portalId) {
    return { statusCode: 400, body: { message: 'Missing portalId' } };
  }

  try {
    return { statusCode: 200, body: await suggestForRecord(portalId, recordId, context.body?.transcript) };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // A ClaudeError carries a classified reason (rate limit, refusal, bad JSON)
    // that is worth surfacing distinctly — retrying a refusal is pointless and
    // retrying a rate limit is the whole fix.
    if (err instanceof ClaudeError) {
      console.error(`Claude suggestion failed (${err.reason}):`, message);
      return { statusCode: 502, body: { message: `${err.reason}: ${message}` } };
    }
    console.error('Video AI suggestions failed:', message);
    return { statusCode: 500, body: { message } };
  }
};

export default main;
