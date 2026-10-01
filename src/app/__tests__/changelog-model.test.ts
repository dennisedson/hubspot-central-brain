import { describe, it, expect } from 'vitest';
import {
  resolveModel, resolveThinking, modelIdFor, thinkingConfigFor,
  MODEL_IDS, DEFAULT_MODEL, DEFAULT_THINKING, DRAFT_TIMEOUT_MS, DRAFT_MAX_TOKENS,
} from '../lib/changelog-model';

/**
 * A stored setting arrives as whatever is on a HubSpot property: possibly
 * empty, possibly stale, possibly a value an older build wrote. None of those
 * should stop a draft, so resolution always lands on something valid.
 */

describe('resolveModel', () => {
  it('falls back to the default for anything unrecognised', () => {
    for (const input of [null, undefined, '', '   ', 'gpt-4', 'opus-3']) {
      expect(resolveModel(input)).toBe(DEFAULT_MODEL);
    }
  });

  it('accepts each supported choice', () => {
    expect(resolveModel('opus')).toBe('opus');
    expect(resolveModel('sonnet')).toBe('sonnet');
    expect(resolveModel('haiku')).toBe('haiku');
  });

  it('never returns a choice without a model id behind it', () => {
    for (const input of ['opus', 'sonnet', 'haiku', 'nonsense', '']) {
      expect(modelIdFor(resolveModel(input))).toBeTruthy();
    }
  });
});

describe('resolveThinking', () => {
  it('honours an explicit choice either way', () => {
    expect(resolveThinking('off')).toBe('off');
    expect(resolveThinking(' off ')).toBe('off');
    expect(resolveThinking('adaptive')).toBe('adaptive');
  });

  it('falls back to the default for anything else', () => {
    for (const input of [null, undefined, '', 'yes', 'disabled']) {
      expect(resolveThinking(input)).toBe(DEFAULT_THINKING);
    }
  });

  it('maps to a config the API understands', () => {
    expect(thinkingConfigFor('off')).toEqual({ type: 'disabled' });
    expect(thinkingConfigFor('adaptive')).toEqual({ type: 'adaptive' });
  });
});

describe('model ids', () => {
  it('pins the newest of each family, by exact id', () => {
    // Confirmed against GET /v1/models on 2026-10-01. Exact ids, never
    // aliases: an alias moving under this feature is a change nobody made.
    expect(MODEL_IDS.opus).toBe('claude-opus-5-5');
    expect(MODEL_IDS.sonnet).toBe('claude-sonnet-5-5');
    expect(MODEL_IDS.haiku).toBe('claude-haiku-4-5-20251001');
  });

  it('defaults to what fits a 20-second function budget', () => {
    // HubSpot kills an app function at 20s and the limit is not configurable.
    // Opus with adaptive thinking did not reliably finish a standalone post:
    // the first turn succeeded, the follow-up was killed mid-generation.
    expect(DEFAULT_MODEL).toBe('sonnet');
    expect(DEFAULT_THINKING).toBe('off');
  });

  it('leaves headroom between our timeout and the platform kill', () => {
    // Ours must fire first, so the failure is ours to explain.
    expect(DRAFT_TIMEOUT_MS).toBeLessThan(20_000);
    expect(DRAFT_MAX_TOKENS).toBeLessThanOrEqual(2048);
  });
});
