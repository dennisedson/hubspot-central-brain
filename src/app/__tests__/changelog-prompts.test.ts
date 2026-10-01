import { describe, it, expect } from 'vitest';
import {
  STANDALONE_PROMPT,
  ROLLUP_PROMPT,
  promptFor,
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
