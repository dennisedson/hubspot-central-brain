/**
 * Which model drafts a changelog, and whether it thinks first.
 *
 * Configurable because the right answer is not knowable from here. Drafting a
 * changelog is a transformation of structured fields into prose, not open
 * generation — plausibly a job a smaller model does just as well. Plausibly is
 * not evidence, so this exists to let the question be settled by comparing
 * output on real records.
 *
 * Deliberately separate from CLAUDE_MODEL in claude-client.ts. That constant
 * belongs to the video suggestions feature, and changing a shared default to
 * tune a different feature is how one change becomes two outages.
 *
 * Cost, for context, at the rates published 2026-10-01 — it is not the reason
 * this is configurable:
 *
 *   Opus   $4 / $20 per MTok    ~$0.08 per standalone post, 3 turns
 *   Sonnet $2 / $10 per MTok    ~$0.04
 *   Haiku  $1 /  $5 per MTok    ~$0.02
 *
 * A realistic month is under a dollar on any of them. Speed and quality are
 * the variables worth caring about; thinking tokens bill as OUTPUT, which on
 * Opus is the most expensive thing in the request.
 */

/**
 * THE BUDGET IS 20 SECONDS.
 *
 * HubSpot kills an app function at 20s — observed, not documented:
 *
 *   [runServerlessFunction] The serverless function 'changelog_draft_api'
 *   timed out. Task timed out after 20.00 seconds.
 *
 * There is no timeout field in the function's hsmeta, so this cannot be raised.
 * `hubspot.fetch`'s configurable timeout is the extension's patience with the
 * request, not the function's permission to keep running.
 *
 * That makes generation speed a correctness concern rather than a nicety. A
 * standalone post runs to roughly 1,200 output tokens, and the request also
 * has to read the record, read settings, and wait for the model to start. Opus
 * with adaptive thinking does not reliably fit — which is how the first turn
 * succeeded and the follow-up did not.
 *
 * Hence the defaults below. They changed because of that failure, not because
 * of cost: cost is under a dollar a month on any of these.
 */
export type ModelChoice = 'opus' | 'sonnet' | 'haiku';
export type ThinkingChoice = 'adaptive' | 'off';

/**
 * Current model ids.
 *
 * Note `claude-client.ts` still pins `claude-opus-5`, which is not the current
 * Opus id — flagged rather than changed here, because that constant drives
 * video suggestions and is not this feature's to move.
 */
export const MODEL_IDS: Record<ModelChoice, string> = {
  opus: 'claude-opus-5-5',
  sonnet: 'claude-sonnet-5',
  haiku: 'claude-haiku-4-5-20251001',
};

/**
 * Sonnet, not Opus: it generates fast enough to finish a standalone post
 * inside 20 seconds, where Opus demonstrably does not. Opus remains selectable
 * and is a reasonable choice for the short rollup entries.
 */
export const DEFAULT_MODEL: ModelChoice = 'sonnet';

/**
 * Off, because thinking happens BEFORE any output appears and is therefore the
 * worst thing to spend a 20-second budget on. It also bills as output.
 */
export const DEFAULT_THINKING: ThinkingChoice = 'off';

/**
 * Below the platform's 20s kill, so the function returns a useful error of its
 * own instead of being executed mid-sentence with a generic RequestId.
 */
export const DRAFT_TIMEOUT_MS = 16_000;

/**
 * Enough for a standalone post with its meta description and checklist, and
 * low enough that a runaway answer cannot eat the whole budget. Truncation is
 * visible and recoverable; a timeout loses the turn entirely.
 */
export const DRAFT_MAX_TOKENS = 2048;

export function resolveModel(stored?: string | null): ModelChoice {
  const value = (stored ?? '').trim();
  return value in MODEL_IDS ? (value as ModelChoice) : DEFAULT_MODEL;
}

export function resolveThinking(stored?: string | null): ThinkingChoice {
  const value = (stored ?? '').trim();
  if (value === 'off') return 'off';
  if (value === 'adaptive') return 'adaptive';
  return DEFAULT_THINKING;
}

export function modelIdFor(choice: ModelChoice): string {
  return MODEL_IDS[choice];
}

/** Adaptive thinking, or none. Thinking tokens are billed as output. */
export function thinkingConfigFor(choice: ThinkingChoice): { type: 'adaptive' } | { type: 'disabled' } {
  return choice === 'off' ? { type: 'disabled' } : { type: 'adaptive' };
}
