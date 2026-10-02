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
 * Newest of each family, confirmed against GET /v1/models on 2026-10-01 rather
 * than assumed:
 *
 *   claude-sonnet-5-5   Claude Sonnet 5.5
 *   claude-opus-5-5     Claude Opus 5.5
 *   claude-haiku-4-5-20251001   Claude Haiku 4.5
 *
 * Exact ids, never aliases. An alias moving under this feature is a change
 * nobody made and nobody can see in a diff.
 *
 * The same listing shows `claude-opus-5` is still served, so claude-client.ts
 * pinning it is out of date rather than broken — worth bumping deliberately,
 * not urgently.
 */
export const MODEL_IDS: Record<ModelChoice, string> = {
  opus: 'claude-opus-5-5',
  sonnet: 'claude-sonnet-5-5',
  haiku: 'claude-haiku-4-5-20251001',
};

/**
 * Sonnet 5.5 for both modes: fast enough to finish a standalone post inside 20
 * seconds, where Opus demonstrably is not, and half the price. Opus remains
 * selectable — it fits comfortably for the two-to-four-sentence rollup entries
 * if its output is ever preferred there.
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

export type ThinkingConfig = { type: 'adaptive' } | { type: 'disabled' } | { type: 'between_tools' };

/**
 * Adaptive thinking, or none. Thinking tokens are billed as output.
 *
 * "None" is spelled differently per model: the 5.5 models answer 400 to
 * `{type:'disabled'}` and ask for `between_tools` (no thinking before the
 * response; short updates between tool calls only). Haiku 4.5 still takes
 * `disabled`.
 */
export function thinkingConfigFor(choice: ThinkingChoice, model: ModelChoice): ThinkingConfig {
  if (choice === 'adaptive') return { type: 'adaptive' };
  return model === 'haiku' ? { type: 'disabled' } : { type: 'between_tools' };
}
