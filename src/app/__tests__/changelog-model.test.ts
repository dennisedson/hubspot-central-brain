import { describe, it, expect } from 'vitest';
import {
  resolveModel, resolveThinking, modelIdFor, thinkingConfigFor,
  MODEL_IDS, DEFAULT_MODEL, DEFAULT_THINKING,
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
  it('only "off" turns it off', () => {
    expect(resolveThinking('off')).toBe('off');
    expect(resolveThinking(' off ')).toBe('off');
    for (const input of [null, undefined, '', 'adaptive', 'yes', 'disabled']) {
      expect(resolveThinking(input)).toBe(DEFAULT_THINKING);
    }
  });

  it('maps to a config the API understands', () => {
    expect(thinkingConfigFor('off')).toEqual({ type: 'disabled' });
    expect(thinkingConfigFor('adaptive')).toEqual({ type: 'adaptive' });
  });
});

describe('model ids', () => {
  it('pins a concrete id per choice rather than an alias', () => {
    expect(MODEL_IDS.opus).toBe('claude-opus-5-5');
    expect(MODEL_IDS.sonnet).toBe('claude-sonnet-5');
    expect(MODEL_IDS.haiku).toBe('claude-haiku-4-5-20251001');
  });

  it('defaults to unchanged behaviour', () => {
    expect(DEFAULT_MODEL).toBe('opus');
    expect(DEFAULT_THINKING).toBe('adaptive');
  });
});
