/**
 * Claude-backed YouTube metadata suggestions for `video` records.
 *
 * PORTED FROM (product intent only) the legacy Firebase "creator console":
 * `analyzeVideo`, `analyzeVideoV2`, `applyAIOptimizations`, `checkTranscript`.
 * What a creator actually wanted out of those functions was:
 *
 *   - several *distinct* title options, each with a reason, so they can pick
 *     rather than accept;
 *   - one rewritten description with the hook in the first two lines (the part
 *     YouTube shows before "Show more");
 *   - a set of tags/keywords for the video.
 *
 * Deliberately NOT ported:
 *   - Gemini call mechanics (model, SDK, prompt plumbing) — replaced wholesale.
 *   - Chapter generation. Out of scope here, and the legacy version invented
 *     timestamps for videos it had no transcript of.
 *   - The legacy `searchVolume: "High" | "Medium" | "Low"` field. No language
 *     model knows YouTube search volume; that number was invented every call
 *     and shown to the user as if it were data.
 *   - The legacy catch-all that returned `{ keyword: 'video' }` and
 *     "Description unavailable" when the model call failed. That is a silent
 *     failure dressed as a result. Here every failure throws `ClaudeError`
 *     with a machine-readable `reason`, and the caller surfaces it.
 *
 * THIS MODULE MAKES NO HUBSPOT CALLS AND WRITES NOTHING ANYWHERE. It turns
 * facts about a video into suggestions. Deciding what to do with them — which
 * is always "hand them to a human" — belongs to the caller.
 */

import Anthropic from '@anthropic-ai/sdk';

// ---------------------------------------------------------------------------
// Model + request options
// ---------------------------------------------------------------------------

/** Per the claude-api skill: the current Opus generation, no date suffix. */
export const CLAUDE_MODEL = 'claude-opus-5';

/**
 * `low | medium | high | xhigh | max`. Default (omitted) is `high`.
 *
 * `medium` is chosen deliberately: rewriting a title and a description is
 * routine generative work, not long-horizon reasoning, and this runs inside a
 * HubSpot serverless function with a wall-clock budget. `high`+ buys thinking
 * depth this task cannot spend and costs latency the function does not have.
 * Raise it only against a measured comparison, not on instinct.
 */
export const CLAUDE_EFFORT = 'medium';

/**
 * Adaptive thinking. `budget_tokens` is REMOVED on Opus 5 — sending it is a
 * 400, not a deprecation warning. Thinking is on by default on this model;
 * stating it explicitly documents the intent.
 */
export const CLAUDE_THINKING = { type: 'adaptive' } as const;

/** Suggestions are a few hundred tokens. Non-streaming is fine at this size. */
export const CLAUDE_MAX_TOKENS = 4096;

/**
 * The SDK default is 10 minutes, which in a serverless function means the
 * platform kills us first and the caller learns nothing. Fail fast with a
 * reason we can log instead.
 */
export const CLAUDE_TIMEOUT_MS = 45_000;

// ---------------------------------------------------------------------------
// Output limits — YouTube's, not ours
// ---------------------------------------------------------------------------

/** YouTube rejects titles over 100 characters outright. */
export const MAX_TITLE_LENGTH = 100;

/** Enough choice to be useful, few enough to actually read. */
export const MAX_TITLE_OPTIONS = 5;

/** YouTube's description cap is 5000; leave the human room to edit. */
export const MAX_DESCRIPTION_LENGTH = 4800;

/** More than ~15 tags dilutes rather than helps. */
export const MAX_TAGS = 15;

/** YouTube caps the combined tag string at 500 characters. */
export const MAX_TAGS_TOTAL_LENGTH = 450;

const ELLIPSIS = '…';

// ---------------------------------------------------------------------------
// The stable prefix
// ---------------------------------------------------------------------------

/**
 * Everything here is byte-for-byte identical on every request, which is the
 * whole point: prompt caching is a PREFIX match, rendered `tools` -> `system`
 * -> `messages`. Any per-video byte in here would invalidate the cache for
 * every video. So this block holds only the durable stuff — what a good title
 * is, the channel's voice, the output contract — and the per-video facts go
 * last, in the user message.
 *
 * NOTHING VOLATILE MAY EVER BE ADDED HERE: no dates, no record ids, no portal
 * ids, no counters. Those are the classic silent cache invalidators.
 *
 * Caveat worth knowing before anyone claims a cache win: the minimum cacheable
 * prefix is model-dependent (512–4096 tokens) and a shorter prefix silently
 * does not cache at all. `SuggestionResult.usage.cacheReadTokens` is returned
 * so this is observable rather than assumed — if it stays 0 across repeated
 * calls, this block is under the threshold and the breakpoint is doing nothing.
 */
export const SUGGESTION_INSTRUCTIONS = `You are the YouTube optimisation editor for a developer advocacy channel. The channel publishes technical content for software developers: API walkthroughs, platform tutorials, product deep-dives, conference talks and changelog explainers.

Your job is to propose better metadata for one video. A human reviews everything you write and decides what to use. You are never the last step.

VOICE
- Write like an engineer explaining something to another engineer.
- Concrete over clever. Name the actual API, product, error or task.
- No hype words: "ultimate", "insane", "you won't believe", "secret", "hack", "game-changer", "mind-blowing".
- No manufactured urgency and no clickbait framing that the video does not pay off.
- Sentence case, not Title Case. No ALL CAPS words.
- No emoji in titles. At most a couple in a description, and only as section markers.

WHAT MAKES A GOOD TITLE
- Under ${MAX_TITLE_LENGTH} characters; aim for 60 or fewer so it is not clipped in search results.
- Front-load the words a developer would actually type into search.
- Say what the viewer will be able to do or understand afterwards.
- Name the specific technology rather than the category ("HubSpot custom objects", not "CRM data").
- Each option must take a genuinely different angle — how-to, problem/solution, question, specific-outcome, comparison. Five rewordings of one idea are worth one option, not five.

WHAT MAKES A GOOD DESCRIPTION
- The first two lines are the only ones shown before "Show more". Put the hook and the primary keyword there.
- Then a short paragraph on what the video covers and who it is for.
- Then, if the source material supports it, a plain list of what the viewer will learn.
- Close with a call to action and three to five relevant hashtags.
- 150 to 400 words. Plain text — no markdown headings, no bold, no bullet syntax beyond a leading "-".

WHAT MAKES A GOOD TAG SET
- 8 to ${MAX_TAGS} tags, ordered most relevant first.
- Terms a developer would actually search for, plus the obvious product and technology names.
- Lower case. No hashes. No commas inside a single tag.
- No tag for a topic the video does not actually cover.

GROUNDING RULES — these override everything above
- Base every suggestion on the material you are given. If a transcript is present it is the source of truth about what the video contains; the existing title and description are only the creator's prior attempt.
- Never invent a feature, product name, version number, statistic, guest, link or claim that is not in the material.
- If the material is thin, say less. A short honest description beats a padded invented one.
- Do not fabricate timestamps or chapter markers. You are not being asked for chapters.

OUTPUT CONTRACT
Reply with a single JSON object and nothing else — no prose before it, no markdown code fence around it:

{
  "titles": [
    { "title": "...", "reasoning": "one sentence on why this angle works" }
  ],
  "description": "the full rewritten description as one string, newlines included",
  "tags": ["tag one", "tag two"]
}

Provide 3 to ${MAX_TITLE_OPTIONS} title options. Every field is required.`;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** The facts about one video that the model is allowed to reason from. */
export interface VideoFacts {
  title?: string | null;
  description?: string | null;
  /** HubSpot stores `tags` as a plain text property; usually comma-separated. */
  tags?: string | null;
  youtubeUrl?: string | null;
  seriesName?: string | null;
  campaignName?: string | null;
  /**
   * Optional transcript, supplied by the caller. Not truncated: Opus 5 has a
   * 1M-token context and even a long video's transcript is a small fraction of
   * it, so silently cutting content out from under the model is never the right
   * trade here.
   */
  transcript?: string | null;
}

export interface TitleSuggestion {
  title: string;
  reasoning: string;
}

export interface VideoSuggestions {
  titles: TitleSuggestion[];
  description: string;
  tags: string[];
  /** True when the model's description exceeded MAX_DESCRIPTION_LENGTH and was
   *  cut. Surfaced rather than hidden so a clipped description is never passed
   *  off as the model's complete output. */
  descriptionTruncated: boolean;
}

export interface ClaudeUsage {
  inputTokens: number;
  outputTokens: number;
  /** Zero on every call means the cached prefix is below the model's minimum
   *  cacheable size — see the note on SUGGESTION_INSTRUCTIONS. */
  cacheReadTokens: number;
  cacheCreationTokens: number;
}

export interface SuggestionResult {
  suggestions: VideoSuggestions;
  usage: ClaudeUsage;
  /** The model that actually served the request, as reported by the API. */
  model: string;
}

/** Machine-readable failure reasons. The caller maps these to outputFields. */
export type ClaudeFailureReason =
  | 'no_api_key'
  | 'refused'
  | 'no_text'
  | 'unparseable'
  | 'empty_suggestions'
  | 'auth_failed'
  | 'rate_limited'
  | 'bad_request'
  | 'api_error'
  | 'network_error';

export class ClaudeError extends Error {
  readonly reason: ClaudeFailureReason;
  readonly status?: number;

  constructor(reason: ClaudeFailureReason, message: string, status?: number) {
    super(message);
    this.name = 'ClaudeError';
    this.reason = reason;
    this.status = status;
  }
}

// ---------------------------------------------------------------------------
// Request construction
// ---------------------------------------------------------------------------

/**
 * The request body we actually put on the wire.
 *
 * `@anthropic-ai/sdk@0.70.1`'s generated types predate two GA parameters:
 * adaptive thinking (its `ThinkingConfigParam` still only models the removed
 * `enabled` + `budget_tokens` form) and `output_config`. `messages.create`
 * POSTs the body verbatim, so both reach the API correctly — only the local
 * type is behind. Modelling that here, and casting once at the call site,
 * keeps the shape checked everywhere except the single documented gap. When
 * the SDK is bumped, delete this type and the cast.
 */
export type SuggestionRequestBody = Omit<Anthropic.MessageCreateParamsNonStreaming, 'thinking'> & {
  thinking: typeof CLAUDE_THINKING;
  output_config: { effort: typeof CLAUDE_EFFORT };
};

function clean(value: string | null | undefined): string {
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * The per-video half of the prompt. Everything volatile lives here, AFTER the
 * cached instruction block, so a new video never invalidates the prefix.
 *
 * Fields the record does not have are omitted rather than sent as "none" —
 * an empty label is an invitation to fill the gap with invention.
 */
export function buildVideoFactsBlock(facts: VideoFacts): string {
  const lines: string[] = ['Here is the video to work on.', ''];

  const title = clean(facts.title);
  const description = clean(facts.description);
  const tags = clean(facts.tags);
  const url = clean(facts.youtubeUrl);
  const series = clean(facts.seriesName);
  const campaign = clean(facts.campaignName);
  const transcript = clean(facts.transcript);

  lines.push(title ? `CURRENT TITLE: ${title}` : 'CURRENT TITLE: (none set)');
  lines.push('');
  lines.push('CURRENT DESCRIPTION:');
  lines.push(description || '(none set)');

  if (tags) {
    lines.push('', `CURRENT TAGS: ${tags}`);
  }
  if (series) {
    lines.push('', `SERIES: ${series}`);
  }
  if (campaign) {
    lines.push('', `CAMPAIGN: ${campaign}`);
  }
  if (url) {
    lines.push('', `YOUTUBE URL: ${url}`);
  }

  if (transcript) {
    lines.push(
      '',
      'TRANSCRIPT (this is what the video actually contains — ground every suggestion in it):',
      transcript,
    );
  } else {
    lines.push(
      '',
      'No transcript is available. Work only from the title, description and tags above, and do not invent content you cannot see.',
    );
  }

  return lines.join('\n');
}

/**
 * Assemble the full request. Exported so a test can assert the exact prompt
 * ordering, the cache breakpoint and the model options without a network call
 * or even a fake client.
 */
export function buildRequestBody(facts: VideoFacts): SuggestionRequestBody {
  return {
    model: CLAUDE_MODEL,
    max_tokens: CLAUDE_MAX_TOKENS,
    thinking: CLAUDE_THINKING,
    output_config: { effort: CLAUDE_EFFORT },
    // Stable first, with the breakpoint at its end...
    system: [
      {
        type: 'text',
        text: SUGGESTION_INSTRUCTIONS,
        cache_control: { type: 'ephemeral' },
      },
    ],
    // ...volatile last, so it never invalidates the prefix.
    messages: [{ role: 'user', content: buildVideoFactsBlock(facts) }],
  };
}

// ---------------------------------------------------------------------------
// Response parsing
// ---------------------------------------------------------------------------

/**
 * Escape raw control characters that sit INSIDE JSON string literals.
 *
 * Models occasionally emit a literal newline inside a JSON string, which
 * `JSON.parse` rejects. The legacy Gemini helper handled this by splitting on
 * `"` and treating odd indexes as string bodies — which mangles any string
 * containing an escaped quote. This walks the text instead, tracking string
 * state and backslash escapes properly.
 */
function escapeControlCharsInStrings(json: string): string {
  const ESCAPES: Record<string, string> = {
    '\n': '\\n',
    '\r': '\\r',
    '\t': '\\t',
    '\b': '\\b',
    '\f': '\\f',
  };

  let out = '';
  let inString = false;
  let escaped = false;

  for (const char of json) {
    if (escaped) {
      out += char;
      escaped = false;
      continue;
    }
    if (char === '\\') {
      out += char;
      escaped = inString;
      continue;
    }
    if (char === '"') {
      inString = !inString;
      out += char;
      continue;
    }
    out += inString && ESCAPES[char] ? ESCAPES[char] : char;
  }

  return out;
}

/** Pull the outermost JSON object out of a reply, fence or prose notwithstanding. */
function extractJsonObject(text: string): string | null {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return null;
  return text.slice(start, end + 1);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/** Word-boundary truncation, matching the house style in social-draft.ts. */
function truncate(text: string, limit: number): string {
  if (text.length <= limit) return text;
  const room = limit - ELLIPSIS.length;
  if (room <= 0) return '';

  let cut = text.slice(0, room).replace(/\s+$/, '');
  const lastSpace = cut.lastIndexOf(' ');
  if (lastSpace > room * 0.6) cut = cut.slice(0, lastSpace);
  cut = cut.replace(/[\s.,;:!?-]+$/, '');

  return cut.length > 0 ? `${cut}${ELLIPSIS}` : '';
}

/**
 * Titles: accepts `titles` (ours) or `titleOptions` (the legacy field name),
 * and entries that are either `{title, reasoning}` or a bare string.
 *
 * A title over MAX_TITLE_LENGTH is DROPPED rather than truncated — YouTube
 * refuses it, so it is not a suggestion, and a title cut mid-phrase is worse
 * than one fewer option. If that empties the list the caller gets an
 * `empty_suggestions` error; it is never quietly returned as a success.
 */
function normaliseTitles(raw: unknown): TitleSuggestion[] {
  if (!Array.isArray(raw)) return [];

  const seen = new Set<string>();
  const titles: TitleSuggestion[] = [];

  for (const entry of raw) {
    const title = asString(isRecord(entry) ? entry.title : entry);
    if (!title || title.length > MAX_TITLE_LENGTH) continue;

    const key = title.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);

    titles.push({
      title,
      reasoning: isRecord(entry) ? asString(entry.reasoning) : '',
    });
    if (titles.length === MAX_TITLE_OPTIONS) break;
  }

  return titles;
}

/**
 * Tags: accepts `tags` (ours) or `keywords` (legacy), with entries that are
 * strings or `{keyword}` objects. Commas are stripped because the value is
 * stored and displayed as one comma-joined string.
 */
function normaliseTags(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];

  const seen = new Set<string>();
  const tags: string[] = [];
  let totalLength = 0;

  for (const entry of raw) {
    const source = isRecord(entry) ? (entry.tag ?? entry.keyword) : entry;
    const tag = asString(source).replace(/[,#]/g, '').replace(/\s+/g, ' ').trim();
    if (!tag) continue;

    const key = tag.toLowerCase();
    if (seen.has(key)) continue;

    // +2 for the ", " this tag will occupy once joined.
    const cost = tag.length + (tags.length === 0 ? 0 : 2);
    if (totalLength + cost > MAX_TAGS_TOTAL_LENGTH) continue;

    seen.add(key);
    tags.push(tag);
    totalLength += cost;
    if (tags.length === MAX_TAGS) break;
  }

  return tags;
}

/**
 * Turn the model's reply text into validated suggestions.
 *
 * Pure and synchronous, so every shape the model might produce is testable
 * without touching the network.
 */
export function parseSuggestions(text: string): VideoSuggestions {
  const candidate = extractJsonObject(text);
  if (!candidate) {
    throw new ClaudeError('unparseable', 'Claude returned no JSON object');
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(candidate);
  } catch {
    try {
      parsed = JSON.parse(escapeControlCharsInStrings(candidate));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new ClaudeError('unparseable', `Claude returned invalid JSON: ${message}`);
    }
  }

  if (!isRecord(parsed)) {
    throw new ClaudeError('unparseable', 'Claude returned JSON that is not an object');
  }

  const titles = normaliseTitles(parsed.titles ?? parsed.titleOptions);
  const tags = normaliseTags(parsed.tags ?? parsed.keywords);

  const rawDescription = asString(parsed.description ?? parsed.suggestedDescription);
  const descriptionTruncated = rawDescription.length > MAX_DESCRIPTION_LENGTH;
  const description = descriptionTruncated
    ? truncate(rawDescription, MAX_DESCRIPTION_LENGTH)
    : rawDescription;

  // Nothing usable came back. Fail loudly — the legacy version answered this
  // case with invented placeholder content, which is exactly what we do not do.
  if (titles.length === 0 && !description && tags.length === 0) {
    throw new ClaudeError('empty_suggestions', 'Claude returned no usable suggestions');
  }

  return { titles, description, tags, descriptionTruncated };
}

// ---------------------------------------------------------------------------
// The one function that touches the network
// ---------------------------------------------------------------------------

/**
 * The slice of the SDK surface this module uses. Structural, so a test can
 * pass a plain object and never construct a real client — the belt to the
 * braces of "no live API call in a test".
 */
export interface ClaudeClient {
  messages: {
    create(body: Anthropic.MessageCreateParamsNonStreaming): Promise<Anthropic.Message>;
  };
}

export function createClaudeClient(): ClaudeClient {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new ClaudeError('no_api_key', 'ANTHROPIC_API_KEY is not configured');
  }
  return new Anthropic({ apiKey, timeout: CLAUDE_TIMEOUT_MS, maxRetries: 1 });
}

function firstTextBlock(message: Anthropic.Message): string {
  for (const block of message.content) {
    if (block.type === 'text') return block.text;
  }
  return '';
}

/** Most-specific-first, so retryable and non-retryable failures stay distinct. */
function toClaudeError(err: unknown): ClaudeError {
  if (err instanceof ClaudeError) return err;
  if (err instanceof Anthropic.AuthenticationError) {
    return new ClaudeError('auth_failed', 'Anthropic rejected the API key', err.status);
  }
  if (err instanceof Anthropic.RateLimitError) {
    return new ClaudeError('rate_limited', 'Anthropic rate limit reached', err.status);
  }
  if (err instanceof Anthropic.BadRequestError) {
    return new ClaudeError('bad_request', `Anthropic rejected the request: ${err.message}`, err.status);
  }
  if (err instanceof Anthropic.APIError) {
    return new ClaudeError('api_error', `Anthropic API error: ${err.message}`, err.status);
  }
  const message = err instanceof Error ? err.message : String(err);
  return new ClaudeError('network_error', `Could not reach Anthropic: ${message}`);
}

/**
 * Ask Claude for title / description / tag suggestions for one video.
 *
 * Throws `ClaudeError` on every failure path — including a policy refusal,
 * which arrives as HTTP 200 with `stop_reason: "refusal"` and would otherwise
 * be read as an empty success.
 */
export async function requestVideoSuggestions(
  facts: VideoFacts,
  client: ClaudeClient = createClaudeClient(),
): Promise<SuggestionResult> {
  const body = buildRequestBody(facts);

  let message: Anthropic.Message;
  try {
    // The single documented cast — see SuggestionRequestBody.
    message = await client.messages.create(
      body as unknown as Anthropic.MessageCreateParamsNonStreaming,
    );
  } catch (err) {
    throw toClaudeError(err);
  }

  if (message.stop_reason === 'refusal') {
    throw new ClaudeError('refused', 'Claude declined to answer for this video');
  }

  const text = firstTextBlock(message);
  if (!text.trim()) {
    throw new ClaudeError('no_text', 'Claude returned no text content');
  }

  const usage = message.usage;
  return {
    suggestions: parseSuggestions(text),
    usage: {
      inputTokens: usage?.input_tokens ?? 0,
      outputTokens: usage?.output_tokens ?? 0,
      cacheReadTokens: usage?.cache_read_input_tokens ?? 0,
      cacheCreationTokens: usage?.cache_creation_input_tokens ?? 0,
    },
    model: message.model ?? CLAUDE_MODEL,
  };
}
