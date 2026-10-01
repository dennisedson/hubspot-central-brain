import type Anthropic from '@anthropic-ai/sdk';
import { getPortalConfig } from '../lib/portal-config';
import { HS_BASE, objectPath, objectSearchPath } from '../lib/hs-api';
import {
  createClaudeClient,
  CLAUDE_MODEL,
  CLAUDE_MAX_TOKENS,
  CLAUDE_THINKING,
  CLAUDE_EFFORT,
} from '../lib/claude-client';
import { resolvePrompt, type ChangelogDraftMode } from '../lib/changelog-prompts';
import {
  parseRolloutNotes,
  missingForStandalone,
  formatSourceForModel,
} from '../lib/changelog-source';

/**
 * Drafting a changelog, conversationally.
 *
 * The conversation is held by the card and replayed on every request. Nothing
 * is stored: a thread is a working session, and persisting it would mean
 * growing a JSON blob on the record that nobody reads twice. The DRAFT is what
 * persists, because that is the artefact.
 *
 * The source material is the record's `notes` — the Linear issue description,
 * rewritten on every webhook. That is also why the draft is saved to
 * `changelog_draft` and never back into `notes`: the next webhook would
 * destroy it.
 */

interface DraftContext {
  accountId?: number;
  params?: Record<string, string | string[] | undefined>;
  parameters?: Record<string, string | undefined>;
  query?: Record<string, string | undefined>;
  body?: Record<string, string | undefined>;
}

function param(ctx: DraftContext, key: string): string | undefined {
  // HubSpot delivers URL query params in `params`, and their values are ARRAYS.
  const q = ctx.params?.[key];
  const fromQuery = Array.isArray(q) ? q[0] : q;
  return fromQuery ?? ctx.parameters?.[key] ?? ctx.query?.[key] ?? ctx.body?.[key];
}

interface Turn {
  role: 'user' | 'assistant';
  content: string;
}

/**
 * The request we actually send.
 *
 * `thinking: { type: 'adaptive' }` and `output_config` are newer than the
 * SDK's published types, so the body is typed here and cast once on the way
 * out — the same single documented cast `requestVideoSuggestions` makes.
 */
interface DraftRequestBody {
  model: string;
  max_tokens: number;
  thinking: typeof CLAUDE_THINKING;
  output_config: { effort: string };
  system: Array<{ type: 'text'; text: string; cache_control: { type: 'ephemeral' } }>;
  messages: Turn[];
}

/** Guard on replayed history. A long thread is a cost and a timeout, not a feature. */
const MAX_TURNS = 24;

function parseConversation(raw: string | undefined): Turn[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((t): t is Turn =>
        typeof t === 'object' && t !== null &&
        ((t as Turn).role === 'user' || (t as Turn).role === 'assistant') &&
        typeof (t as Turn).content === 'string' && (t as Turn).content.length > 0)
      .slice(-MAX_TURNS);
  } catch {
    return [];
  }
}

async function readRecord(objectTypeId: string, objectId: string, token: string) {
  const props = ['title', 'notes', 'changelog_draft', 'changelog_draft_mode', 'hs_pipeline'];
  const res = await fetch(
    `${HS_BASE}${objectPath(objectTypeId, objectId)}?properties=${props.join(',')}`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (!res.ok) throw new Error(`Could not read record ${objectId}: ${res.status}`);
  const body = await res.json() as { properties: Record<string, string | null> };
  return body.properties;
}

async function readPromptOverride(
  appConfigTypeId: string,
  mode: ChangelogDraftMode,
  token: string,
): Promise<string | null> {
  const property = mode === 'rollup' ? 'changelog_prompt_rollup' : 'changelog_prompt_standalone';
  const res = await fetch(`${HS_BASE}${objectSearchPath(appConfigTypeId)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ filterGroups: [], properties: [property], limit: 1 }),
  });
  if (!res.ok) return null;
  const body = await res.json() as { results: Array<{ properties: Record<string, string | null> }> };
  return body.results[0]?.properties[property] ?? null;
}

export async function main(context: DraftContext): Promise<{ statusCode: number; body: string }> {
  const portalId = context.accountId ?? parseInt(param(context, 'portalId') ?? '0', 10);
  if (!portalId) return { statusCode: 400, body: JSON.stringify({ error: 'Missing portalId' }) };

  const token = process.env.PRIVATE_APP_ACCESS_TOKEN ?? process.env.HS_ACCESS_TOKEN;
  if (!token) return { statusCode: 500, body: JSON.stringify({ error: 'No HubSpot access token available' }) };

  const objectId = param(context, 'objectId');
  if (!objectId) return { statusCode: 400, body: JSON.stringify({ error: 'Missing objectId' }) };

  let config;
  try {
    config = getPortalConfig(portalId);
  } catch (err) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Portal not configured', detail: err instanceof Error ? err.message : String(err) }),
    };
  }

  const objectTypeId = config.content.objectTypeId;
  const action = param(context, 'action') ?? 'source';
  const mode: ChangelogDraftMode = param(context, 'mode') === 'rollup' ? 'rollup' : 'standalone';

  // What the record actually holds, and what a standalone post would lack.
  // Read-only, and deliberately available without calling the model — telling
  // someone up front that a record cannot support a standalone post beats
  // handing them a thin draft and letting them discover it.
  if (action === 'source') {
    try {
      const props = await readRecord(objectTypeId, objectId, token);
      const source = parseRolloutNotes(props.notes);
      return {
        statusCode: 200,
        body: JSON.stringify({
          title: props.title ?? '',
          fields: source.fields,
          description: source.description ?? '',
          missingForStandalone: missingForStandalone(source),
          draft: props.changelog_draft ?? '',
          draftMode: props.changelog_draft_mode ?? '',
          // The card renders on every content_piece because that is the only
          // object there is — changelogs are a pipeline, not a type. So it has
          // to be told which pipeline it landed on.
          isChangelog: props.hs_pipeline === config.content.pipelines.changelog.pipelineId,
        }),
      };
    } catch (err) {
      return {
        statusCode: 500,
        body: JSON.stringify({ error: 'Could not read the record', detail: err instanceof Error ? err.message : String(err) }),
      };
    }
  }

  // One conversational turn.
  if (action === 'turn') {
    const message = param(context, 'message');
    if (!message) return { statusCode: 400, body: JSON.stringify({ error: 'Missing message' }) };

    try {
      const [props, override] = await Promise.all([
        readRecord(objectTypeId, objectId, token),
        readPromptOverride(config.appConfig.objectTypeId, mode, token),
      ]);

      const source = parseRolloutNotes(props.notes);
      const history = parseConversation(param(context, 'conversation'));

      // The record's facts go in as the FIRST user turn rather than into the
      // system prompt, so the system prefix stays identical across every turn
      // and every record — which is what makes it cacheable.
      const opening = [
        formatSourceForModel(source, props.title ?? 'Untitled'),
        '',
        props.changelog_draft
          ? `There is already a draft on this record. Treat it as the current state and revise it rather than starting over:\n\n---\n${props.changelog_draft}\n---`
          : 'There is no draft yet.',
      ].join('\n');

      const messages: Turn[] = [
        { role: 'user', content: opening },
        ...history,
        { role: 'user', content: message },
      ];

      const body: DraftRequestBody = {
        model: CLAUDE_MODEL,
        max_tokens: CLAUDE_MAX_TOKENS,
        thinking: CLAUDE_THINKING,
        output_config: { effort: CLAUDE_EFFORT },
        // Stable first with the breakpoint at its end, volatile last — the
        // system prompt is identical across every turn and every record, so it
        // caches; the record's facts ride in the first user turn instead.
        system: [{
          type: 'text',
          text: resolvePrompt(mode, override),
          cache_control: { type: 'ephemeral' },
        }],
        messages,
      };

      const claude = createClaudeClient();
      // The single documented cast — see DraftRequestBody.
      const reply = await claude.messages.create(
        body as unknown as Anthropic.MessageCreateParamsNonStreaming,
      );

      // Every text block, not just the first: a conversational reply can be
      // split across blocks where a single-shot suggestion is not.
      const text = (reply.content ?? [])
        .map(block => (block.type === 'text' ? block.text : ''))
        .filter(Boolean)
        .join('\n')
        .trim();

      if (!text) {
        return { statusCode: 502, body: JSON.stringify({ error: 'The model returned nothing' }) };
      }
      return { statusCode: 200, body: JSON.stringify({ reply: text }) };
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      return { statusCode: 502, body: JSON.stringify({ error: 'Drafting failed', detail }) };
    }
  }

  // Persisting the draft. Written to changelog_draft, never to notes — notes is
  // the synced Linear description and the next webhook would overwrite it.
  if (action === 'save') {
    const draft = param(context, 'draft');
    if (draft === undefined) return { statusCode: 400, body: JSON.stringify({ error: 'Missing draft' }) };

    try {
      const res = await fetch(`${HS_BASE}${objectPath(objectTypeId, objectId)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ properties: { changelog_draft: draft, changelog_draft_mode: mode } }),
      });
      if (!res.ok) throw new Error(`${res.status}: ${(await res.text()).slice(0, 200)}`);
      return { statusCode: 200, body: JSON.stringify({ ok: true }) };
    } catch (err) {
      return {
        statusCode: 500,
        body: JSON.stringify({ error: 'Could not save the draft', detail: err instanceof Error ? err.message : String(err) }),
      };
    }
  }

  return { statusCode: 400, body: JSON.stringify({ error: `Unknown action: ${action}` }) };
}
