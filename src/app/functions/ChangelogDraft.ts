import type Anthropic from '@anthropic-ai/sdk';
import { getPortalConfig } from '../lib/portal-config';
import { HS_BASE, objectPath, objectSearchPath } from '../lib/hs-api';
import { createClaudeClient, CLAUDE_EFFORT } from '../lib/claude-client';
import { resolvePrompt, type ChangelogDraftMode } from '../lib/changelog-prompts';
import {
  resolveModel, resolveThinking, modelIdFor, thinkingConfigFor, type ThinkingConfig,
  DRAFT_TIMEOUT_MS, DRAFT_MAX_TOKENS,
} from '../lib/changelog-model';
import { getAccessToken } from '../lib/youtube-auth';
import {
  createFolder, folderExists, createDocFromMarkdown, DEFAULT_FOLDER_NAME,
} from '../lib/google-drive';
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
  thinking: ThinkingConfig;
  output_config: { effort: string };
  system: Array<{ type: 'text'; text: string }>;
  messages: Array<
    | { role: 'user' | 'assistant'; content: string }
    | { role: 'user'; content: Array<{ type: 'text'; text: string; cache_control: { type: 'ephemeral' } }> }
  >;
}

/** Guard on replayed history. A long thread is a cost and a timeout, not a feature. */
const MAX_TURNS = 24;

/** Distinguishes our own deadline from anything the API threw. */
const TIMEOUT_MARKER = 'draft-budget-exceeded';

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
  const props = [
    'title', 'notes', 'changelog_draft', 'changelog_draft_mode', 'hs_pipeline',
    'changelog_doc_url',
  ];
  const res = await fetch(
    `${HS_BASE}${objectPath(objectTypeId, objectId)}?properties=${props.join(',')}`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (!res.ok) throw new Error(`Could not read record ${objectId}: ${res.status}`);
  const body = await res.json() as { properties: Record<string, string | null> };
  return body.properties;
}

interface DraftConfig {
  promptOverride: string | null;
  model: string;
  thinking: ThinkingConfig;
}

/** One search for everything the drafter is configured with. */
async function readDraftConfig(
  appConfigTypeId: string,
  mode: ChangelogDraftMode,
  token: string,
): Promise<DraftConfig> {
  const promptProperty = mode === 'rollup' ? 'changelog_prompt_rollup' : 'changelog_prompt_standalone';
  const fallback: DraftConfig = {
    promptOverride: null,
    model: modelIdFor(resolveModel(null)),
    thinking: thinkingConfigFor(resolveThinking(null), resolveModel(null)),
  };

  try {
    const res = await fetch(`${HS_BASE}${objectSearchPath(appConfigTypeId)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        filterGroups: [],
        properties: [promptProperty, 'changelog_model', 'changelog_thinking'],
        limit: 1,
      }),
    });
    if (!res.ok) return fallback;
    const body = await res.json() as { results: Array<{ properties: Record<string, string | null> }> };
    const props = body.results[0]?.properties ?? {};
    return {
      promptOverride: props[promptProperty] ?? null,
      model: modelIdFor(resolveModel(props.changelog_model)),
      thinking: thinkingConfigFor(resolveThinking(props.changelog_thinking), resolveModel(props.changelog_model)),
    };
  } catch {
    // A settings read failing must not stop a draft; defaults are valid.
    return fallback;
  }
}


/** Reads one property from the single App Config record. */
async function readAppConfig(
  appConfigTypeId: string,
  property: string,
  token: string,
): Promise<{ recordId?: string; value?: string }> {
  const res = await fetch(`${HS_BASE}${objectSearchPath(appConfigTypeId)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ filterGroups: [], properties: [property], limit: 1 }),
  });
  if (!res.ok) return {};
  const body = await res.json() as { results: Array<{ id: string; properties: Record<string, string | null> }> };
  const record = body.results[0];
  return { recordId: record?.id, value: record?.properties[property] ?? undefined };
}

async function writeAppConfig(
  appConfigTypeId: string,
  recordId: string,
  properties: Record<string, string>,
  token: string,
): Promise<void> {
  await fetch(`${HS_BASE}${objectPath(appConfigTypeId, recordId)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ properties }),
  });
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
          docUrl: props.changelog_doc_url ?? '',
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
      const [props, settings] = await Promise.all([
        readRecord(objectTypeId, objectId, token),
        readDraftConfig(config.appConfig.objectTypeId, mode, token),
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

      // The breakpoint sits at the END of the opening turn, not on the system
      // block. The system prompt alone is 1,010 tokens (standalone) and 901
      // (rollup), either side of Anthropic's 1,024-token minimum cacheable
      // prefix — and a prefix under the minimum silently does not cache at
      // all, so the breakpoint there was doing nothing. System plus the
      // record's facts averages ~1,830 tokens, which clears it, and the facts
      // are replayed on every turn of a session anyway.
      const messages = [
        { role: 'user' as const, content: [{ type: 'text' as const, text: opening, cache_control: { type: 'ephemeral' as const } }] },
        ...history,
        { role: 'user' as const, content: message },
      ];

      const body: DraftRequestBody = {
        model: settings.model,
        max_tokens: DRAFT_MAX_TOKENS,
        thinking: settings.thinking,
        output_config: { effort: CLAUDE_EFFORT },
        system: [{ type: 'text', text: resolvePrompt(mode, settings.promptOverride) }],
        messages,
      };

      const claude = createClaudeClient();

      // Our own clock, set below HubSpot's 20-second kill so the failure is
      // ours to describe. The client's CLAUDE_TIMEOUT_MS is 45s — longer than
      // the function is allowed to live — so left to itself it never fires and
      // the platform ends the request with a bare RequestId instead.
      let timer: ReturnType<typeof setTimeout> | undefined;
      const budget = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(TIMEOUT_MARKER)), DRAFT_TIMEOUT_MS);
      });

      let reply: Anthropic.Message;
      try {
        // The single documented cast — see DraftRequestBody.
        reply = await Promise.race([
          claude.messages.create(body as unknown as Anthropic.MessageCreateParamsNonStreaming),
          budget,
        ]);
      } finally {
        if (timer) clearTimeout(timer);
      }

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
      if (detail === TIMEOUT_MARKER) {
        return {
          statusCode: 504,
          body: JSON.stringify({
            error: 'The model did not answer in time',
            detail:
              'A draft has to finish inside HubSpot\'s 20-second function limit. ' +
              'Ask for something shorter, or switch the model to Sonnet or Haiku in Settings.',
          }),
        };
      }
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


  /**
   * Creates a Google Doc from the saved draft.
   *
   * Refuses when one already exists. Document creation is not idempotent by
   * nature — call it twice and Drive makes two documents, with nothing to say
   * which is the real one. `changelog_doc_url` being set is the record of that,
   * and the same rule the Asana task lookup had to learn.
   */
  if (action === 'createDoc') {
    try {
      const props = await readRecord(objectTypeId, objectId, token);

      if (props.changelog_doc_url) {
        return {
          statusCode: 409,
          body: JSON.stringify({
            error: 'This record already has a document',
            docUrl: props.changelog_doc_url,
          }),
        };
      }
      const draft = props.changelog_draft ?? '';
      if (!draft.trim()) {
        return { statusCode: 400, body: JSON.stringify({ error: 'There is no draft to put in a document' }) };
      }

      // The Drive authorisation, not the YouTube one. Google refuses to grant
      // both in a single consent, so they are separate tokens entirely.
      const accessToken = await getAccessToken('drive');

      // The folder is created once and remembered. `drive.file` cannot search
      // for it again — access is per-file by id — so a lost id means a new
      // folder, not a found one.
      const appConfigTypeId = config.appConfig.objectTypeId;
      const stored = await readAppConfig(appConfigTypeId, 'google_drive_folder_id', token);

      let folderId: string | null =
        stored.value && await folderExists(accessToken, stored.value) ? stored.value : null;

      if (!folderId) {
        folderId = await createFolder(accessToken, DEFAULT_FOLDER_NAME);
        if (stored.recordId) {
          await writeAppConfig(appConfigTypeId, stored.recordId, { google_drive_folder_id: folderId }, token);
        }
      }

      const { documentUrl } = await createDocFromMarkdown(
        accessToken,
        props.title ?? 'Untitled changelog',
        draft,
        folderId,
      );

      await fetch(`${HS_BASE}${objectPath(objectTypeId, objectId)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ properties: { changelog_doc_url: documentUrl } }),
      });

      return { statusCode: 200, body: JSON.stringify({ docUrl: documentUrl }) };
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      return { statusCode: 502, body: JSON.stringify({ error: 'Could not create the document', detail }) };
    }
  }

  return { statusCode: 400, body: JSON.stringify({ error: `Unknown action: ${action}` }) };
}
