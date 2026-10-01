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

/** Unchanged behaviour until someone deliberately chooses otherwise. */
export const DEFAULT_MODEL: ModelChoice = 'opus';
export const DEFAULT_THINKING: ThinkingChoice = 'adaptive';

export function resolveModel(stored?: string | null): ModelChoice {
  const value = (stored ?? '').trim();
  return value in MODEL_IDS ? (value as ModelChoice) : DEFAULT_MODEL;
}

export function resolveThinking(stored?: string | null): ThinkingChoice {
  return (stored ?? '').trim() === 'off' ? 'off' : DEFAULT_THINKING;
}

export function modelIdFor(choice: ModelChoice): string {
  return MODEL_IDS[choice];
}

/** Adaptive thinking, or none. Thinking tokens are billed as output. */
export function thinkingConfigFor(choice: ThinkingChoice): { type: 'adaptive' } | { type: 'disabled' } {
  return choice === 'off' ? { type: 'disabled' } : { type: 'adaptive' };
}
