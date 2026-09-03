import { describe, it, expect } from 'vitest';
import {
  normaliseTheme,
  parseQuoteCount,
  normaliseSentiment,
  shapeQuotes,
  summariseSentiment,
} from '../lib/enterpret-client';

/**
 * enterpret-client is now entirely pure: there is no HTTP call and no API key.
 * Quotes are batch-synced into `content_piece.enterpret_quotes` out-of-band and
 * this module only parses what is stored there.
 *
 * `shapeQuotes` is therefore the load-bearing function, and its input is
 * untrusted: a textarea property written by a sync we do not control. The
 * malformed cases below are not edge cases, they are the contract — every one
 * of them must mean "no quotes", and none of them may throw.
 */

describe('normaliseTheme', () => {
  it('trims a usable theme', () => {
    expect(normaliseTheme('  Auth / OAuth friction ')).toBe('Auth / OAuth friction');
  });

  it('returns null for blank, null and undefined', () => {
    expect(normaliseTheme('')).toBeNull();
    expect(normaliseTheme('   ')).toBeNull();
    expect(normaliseTheme(null)).toBeNull();
    expect(normaliseTheme(undefined)).toBeNull();
  });
});

describe('parseQuoteCount', () => {
  it('parses a numeric CRM string property', () => {
    expect(parseQuoteCount('12')).toBe(12);
  });

  it('parses zero rather than treating it as absent', () => {
    expect(parseQuoteCount('0')).toBe(0);
  });

  it('rounds a decimal CRM value to a whole count', () => {
    expect(parseQuoteCount('12.0')).toBe(12);
  });

  it('returns null for blank, missing and non-numeric values', () => {
    expect(parseQuoteCount('')).toBeNull();
    expect(parseQuoteCount('   ')).toBeNull();
    expect(parseQuoteCount(null)).toBeNull();
    expect(parseQuoteCount(undefined)).toBeNull();
    expect(parseQuoteCount('not a number')).toBeNull();
  });
});

describe('normaliseSentiment', () => {
  it('normalises label casing and Enterpret-style upper case', () => {
    expect(normaliseSentiment('POSITIVE')).toBe('positive');
    expect(normaliseSentiment('Negative')).toBe('negative');
    expect(normaliseSentiment('neutral')).toBe('neutral');
  });

  it('maps a numeric sentiment score onto a label', () => {
    expect(normaliseSentiment(0.8)).toBe('positive');
    expect(normaliseSentiment(-0.8)).toBe('negative');
    expect(normaliseSentiment(0)).toBe('neutral');
  });

  it('falls back to neutral for anything it does not recognise', () => {
    expect(normaliseSentiment(undefined)).toBe('neutral');
    expect(normaliseSentiment(null)).toBe('neutral');
    expect(normaliseSentiment('mildly annoyed')).toBe('neutral');
    expect(normaliseSentiment({})).toBe('neutral');
  });
});

describe('shapeQuotes — the stored enterpret_quotes property', () => {
  /** Exactly the shape the MCP sync writes into the textarea property. */
  const STORED = JSON.stringify([
    {
      id: 'fr_1',
      text: 'The OAuth refresh token docs contradict the API reference.',
      source: 'GitHub Discussions',
      sentiment: 'NEGATIVE',
      createdAt: '2026-08-14T10:00:00.000Z',
      url: 'https://github.com/x/discussions/1',
    },
    {
      id: 'fr_2',
      text: 'Took me three hours to work out the scope names.',
      source: 'Developer Slack',
      sentiment: 'negative',
      createdAt: '2026-08-15T11:30:00.000Z',
      url: 'https://slack.com/archives/1',
    },
  ]);

  it('parses the stored JSON string into EnterpretQuote objects', () => {
    expect(shapeQuotes(STORED)).toEqual([
      {
        id: 'fr_1',
        text: 'The OAuth refresh token docs contradict the API reference.',
        source: 'GitHub Discussions',
        sentiment: 'negative',
        createdAt: '2026-08-14T10:00:00.000Z',
        url: 'https://github.com/x/discussions/1',
      },
      {
        id: 'fr_2',
        text: 'Took me three hours to work out the scope names.',
        source: 'Developer Slack',
        sentiment: 'negative',
        createdAt: '2026-08-15T11:30:00.000Z',
        url: 'https://slack.com/archives/1',
      },
    ]);
  });

  it('parses the minimal documented entry shape', () => {
    const stored =
      '[{"text":"Webhook retries drop the second delivery.",' +
      '"source":"Support ticket","sentiment":"negative",' +
      '"createdAt":"2026-08-14T00:00:00Z"}]';

    expect(shapeQuotes(stored)).toEqual([
      {
        id: null,
        text: 'Webhook retries drop the second delivery.',
        source: 'Support ticket',
        sentiment: 'negative',
        createdAt: '2026-08-14T00:00:00Z',
        url: null,
      },
    ]);
  });

  it('tolerates surrounding whitespace and newlines in the textarea', () => {
    expect(shapeQuotes(`\n\t  ${STORED}  \n`)).toHaveLength(2);
  });

  it('applies a limit', () => {
    expect(shapeQuotes(STORED, 1)).toHaveLength(1);
  });

  it('accepts an already-decoded array', () => {
    expect(shapeQuotes([{ text: 'already parsed', source: 'Slack' }])).toHaveLength(1);
  });

  it('accepts alternative field names for the verbatim text and its origin', () => {
    const stored = JSON.stringify([
      { verbatim: 'from verbatim', channel: 'Zendesk' },
      { quote: 'from quote', sourceName: 'X' },
      { body: 'from body', source: { name: 'Nested Source' } },
    ]);
    const shaped = shapeQuotes(stored);
    expect(shaped.map(q => q.text)).toEqual(['from verbatim', 'from quote', 'from body']);
    expect(shaped.map(q => q.source)).toEqual(['Zendesk', 'X', 'Nested Source']);
  });

  it('reads a numeric sentiment score stored instead of a label', () => {
    const stored = JSON.stringify([
      { text: 'hot', sentimentScore: -0.9 },
      { text: 'cool', sentimentScore: 0.9 },
      { text: 'flat', sentimentScore: 0 },
    ]);
    expect(shapeQuotes(stored).map(q => q.sentiment)).toEqual([
      'negative',
      'positive',
      'neutral',
    ]);
  });

  it('fills safe defaults for entries missing fields', () => {
    expect(shapeQuotes('[{"text":"bare quote"}]')).toEqual([
      {
        id: null,
        text: 'bare quote',
        source: 'Unknown source',
        sentiment: 'neutral',
        createdAt: null,
        url: null,
      },
    ]);
  });

  it('drops entries that carry no usable text, keeping the rest', () => {
    const stored = JSON.stringify([
      { text: '   ' },
      { source: 'no text at all' },
      null,
      'a bare string',
      42,
      [],
      { text: 'keeper' },
    ]);
    const shaped = shapeQuotes(stored);
    expect(shaped).toHaveLength(1);
    expect(shaped[0].text).toBe('keeper');
  });

  /* ---- the malformed cases: all mean "no quotes", none may throw ---- */

  it('treats an empty or whitespace-only property as no quotes', () => {
    expect(shapeQuotes('')).toEqual([]);
    expect(shapeQuotes('   ')).toEqual([]);
    expect(shapeQuotes('\n\t  \n')).toEqual([]);
  });

  it('treats an absent property as no quotes', () => {
    expect(shapeQuotes(null)).toEqual([]);
    expect(shapeQuotes(undefined)).toEqual([]);
  });

  it('treats invalid JSON as no quotes rather than throwing', () => {
    expect(shapeQuotes('not json at all')).toEqual([]);
    expect(shapeQuotes('[{"text": "truncated mid-sy')).toEqual([]);
    expect(shapeQuotes('[{text: "unquoted key"}]')).toEqual([]);
    expect(shapeQuotes("[{'text':'single quotes'}]")).toEqual([]);
    expect(shapeQuotes('[{"text":"trailing comma"},]')).toEqual([]);
    expect(shapeQuotes('<html>an error page</html>')).toEqual([]);
  });

  it('treats a JSON object where an array was expected as no quotes', () => {
    expect(shapeQuotes('{"text":"a single quote, not wrapped in an array"}')).toEqual([]);
    expect(shapeQuotes('{"quotes":[{"text":"wrapped in an envelope"}]}')).toEqual([]);
    expect(shapeQuotes('{}')).toEqual([]);
  });

  it('treats a JSON primitive as no quotes', () => {
    expect(shapeQuotes('"just a string"')).toEqual([]);
    expect(shapeQuotes('42')).toEqual([]);
    expect(shapeQuotes('true')).toEqual([]);
    expect(shapeQuotes('null')).toEqual([]);
  });

  it('never throws, whatever the property holds', () => {
    const junk: unknown[] = [
      '',
      '   ',
      null,
      undefined,
      0,
      false,
      {},
      { records: [] },
      'undefined',
      '[',
      ']',
      '[[[]]]',
      '[null,null]',
      Symbol('nope'),
      () => 'nope',
    ];
    for (const value of junk) {
      expect(() => shapeQuotes(value)).not.toThrow();
      expect(Array.isArray(shapeQuotes(value))).toBe(true);
    }
  });
});

describe('summariseSentiment', () => {
  function q(sentiment: 'positive' | 'negative' | 'neutral') {
    return {
      id: null,
      text: 't',
      source: 's',
      sentiment,
      createdAt: null,
      url: null,
    };
  }

  it('counts each sentiment and reports the dominant one', () => {
    expect(summariseSentiment([q('negative'), q('negative'), q('positive')])).toEqual({
      total: 3,
      positive: 1,
      negative: 2,
      neutral: 0,
      dominant: 'negative',
    });
  });

  it('returns a zeroed summary with no dominant sentiment for an empty list', () => {
    expect(summariseSentiment([])).toEqual({
      total: 0,
      positive: 0,
      negative: 0,
      neutral: 0,
      dominant: null,
    });
  });

  it('breaks a tie deterministically in favour of negative feedback', () => {
    expect(summariseSentiment([q('positive'), q('negative')]).dominant).toBe('negative');
    expect(summariseSentiment([q('positive'), q('neutral')]).dominant).toBe('positive');
  });
});
