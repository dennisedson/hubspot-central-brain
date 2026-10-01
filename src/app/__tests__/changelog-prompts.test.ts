import { describe, it, expect } from 'vitest';
import {
  STANDALONE_PROMPT,
  ROLLUP_PROMPT,
  promptFor,
  resolvePrompt,
  isOverridden,
} from '../lib/changelog-prompts';

/**
 * The digest entry and the standalone post differ in what they must NOT
 * contain. The digest supplies the title, teaser, meta description and call to
 * action once; an entry that carries its own copy of those fights its
 * siblings — and that is the mistake most likely to creep back in when someone
 * edits one prompt by copying from the other.
 */

describe('promptFor', () => {
  it('returns the digest prompt for rollup and the post prompt for standalone', () => {
    expect(promptFor('rollup')).toBe(ROLLUP_PROMPT);
    expect(promptFor('standalone')).toBe(STANDALONE_PROMPT);
  });
});

describe('the standalone prompt', () => {
  it('keeps the parts a subscriber email depends on', () => {
    expect(STANDALONE_PROMPT).toContain('Teaser Text');
    expect(STANDALONE_PROMPT).toContain('Meta Description');
    expect(STANDALONE_PROMPT).toContain("What's Changing");
    expect(STANDALONE_PROMPT).toContain('When is it happening?');
  });
});

describe('the rollup prompt', () => {
  it('forbids the structure the digest already provides', () => {
    const forbids = ROLLUP_PROMPT.match(/\*\*Do not include\*\*[\s\S]*?digest owns all of those\./);
    expect(forbids, 'the "Do not include" sentence is missing').not.toBeNull();

    for (const owned of [
      'H1',
      'teaser paragraph',
      "What's Changing",
      'When is it happening?',
      'meta description',
      'forum call to action',
      'editor checklist',
    ]) {
      expect(forbids![0]).toContain(owned);
    }
  });

  it('escalates a breaking change out of the digest instead of drafting one', () => {
    // Burying a breaking change in a digest is how people miss it.
    expect(ROLLUP_PROMPT).toMatch(/breaking change/i);
    expect(ROLLUP_PROMPT).toMatch(/Escalate to a standalone post/i);
  });

  it('bounds the length, which is the whole reason it exists', () => {
    expect(ROLLUP_PROMPT).toMatch(/two to four sentences/i);
  });

  it('tells the model to ask rather than pad when the source is thin', () => {
    // ~29% of records lack Type, Audiences, Use Cases and Impact.
    expect(ROLLUP_PROMPT).toMatch(/rather than padding|do not guess/i);
  });
});

describe('both prompts', () => {
  it('carry the CLI rule verbatim', () => {
    for (const p of [STANDALONE_PROMPT, ROLLUP_PROMPT]) {
      expect(p).toContain('npm install -g @hubspot/cli');
    }
  });

  it('speak developer-to-developer and ban marketing language', () => {
    for (const p of [STANDALONE_PROMPT, ROLLUP_PROMPT]) {
      expect(p).toMatch(/No Marketing Fluff/);
      expect(p).toMatch(/thrilled to announce/);
    }
  });
});

/**
 * Resolution between a portal's override and the shipped default.
 *
 * The rule that matters: an empty override means "use the default", and the
 * settings page never writes the default into the property. A portal that has
 * not deliberately customised its wording keeps receiving improvements to the
 * shipped prompt; one that has, keeps its own text.
 */
describe('resolvePrompt', () => {
  it('uses the shipped default when nothing is stored', () => {
    expect(resolvePrompt('standalone', null)).toBe(STANDALONE_PROMPT);
    expect(resolvePrompt('rollup', undefined)).toBe(ROLLUP_PROMPT);
    expect(resolvePrompt('rollup', '')).toBe(ROLLUP_PROMPT);
  });

  it('treats a whitespace-only override as cleared, not as a blank prompt', () => {
    // Clearing a textarea usually leaves a newline. "I deleted it" must mean
    // back to default, never "send the model an empty system prompt".
    expect(resolvePrompt('standalone', '   ')).toBe(STANDALONE_PROMPT);
    expect(resolvePrompt('standalone', '\n\n')).toBe(STANDALONE_PROMPT);
  });

  it('uses a real override when one is stored', () => {
    const mine = '# My own prompt\n\nWrite it differently.';
    expect(resolvePrompt('standalone', mine)).toBe(mine);
    expect(resolvePrompt('rollup', mine)).toBe(mine);
  });

  it('does not trim a real override — the wording is the operator\'s', () => {
    const padded = '\n# Leading newline matters to someone\n';
    expect(resolvePrompt('rollup', padded)).toBe(padded);
  });
});

describe('isOverridden', () => {
  it('distinguishes a deliberate override from an empty field', () => {
    expect(isOverridden('custom')).toBe(true);
    expect(isOverridden('')).toBe(false);
    expect(isOverridden('  \n ')).toBe(false);
    expect(isOverridden(null)).toBe(false);
    expect(isOverridden(undefined)).toBe(false);
  });
});
