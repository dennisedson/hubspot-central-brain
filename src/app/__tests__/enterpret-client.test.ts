import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  isEnterpretConfigured,
  normaliseTheme,
  parseQuoteCount,
  normaliseSentiment,
  shapeQuotes,
  summariseSentiment,
  getEnterpretQuotes,
} from '../lib/enterpret-client';

const ORIGINAL_KEY = process.env.ENTERPRET_API_KEY;

function setKey(value: string | undefined) {
  if (value === undefined) delete process.env.ENTERPRET_API_KEY;
  else process.env.ENTERPRET_API_KEY = value;
}

afterEach(() => {
  setKey(ORIGINAL_KEY);
  vi.unstubAllGlobals();
});

function stubFetch(payload: unknown, ok = true, status = 200) {
  const fn = vi.fn().mockResolvedValue({
    ok,
    status,
    statusText: 'x',
    json: async () => payload,
    text: async () => JSON.stringify(payload),
  });
  vi.stubGlobal('fetch', fn);
  return fn;
}

describe('isEnterpretConfigured', () => {
  it('is true when the key is a non-empty string', () => {
    setKey('ent_live_abc123');
    expect(isEnterpretConfigured()).toBe(true);
  });

  it('is false when the key is absent', () => {
    setKey(undefined);
    expect(isEnterpretConfigured()).toBe(false);
  });

  it('is false when the key is an empty string', () => {
    setKey('');
    expect(isEnterpretConfigured()).toBe(false);
  });

  it('is false when the key is only whitespace', () => {
    setKey('   \t ');
    expect(isEnterpretConfigured()).toBe(false);
  });
});

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

describe('shapeQuotes', () => {
  const payload = {
    records: [
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
    ],
  };

  it('shapes a well-formed response into EnterpretQuote objects', () => {
    expect(shapeQuotes(payload)).toEqual([
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

  it('applies a limit', () => {
    expect(shapeQuotes(payload, 1)).toHaveLength(1);
  });

  it('accepts the alternative envelope keys an export API might use', () => {
    const one = [{ text: 'a', source: 's' }];
    expect(shapeQuotes({ results: one })).toHaveLength(1);
    expect(shapeQuotes({ data: one })).toHaveLength(1);
    expect(shapeQuotes({ feedbackRecords: one })).toHaveLength(1);
    expect(shapeQuotes({ items: one })).toHaveLength(1);
    expect(shapeQuotes(one)).toHaveLength(1);
  });

  it('accepts alternative field names for the verbatim text and its origin', () => {
    const shaped = shapeQuotes({
      records: [
        { verbatim: 'from verbatim', channel: 'Zendesk' },
        { quote: 'from quote', sourceName: 'X' },
        { body: 'from body', source: { name: 'Nested Source' } },
      ],
    });
    expect(shaped.map(q => q.text)).toEqual(['from verbatim', 'from quote', 'from body']);
    expect(shaped.map(q => q.source)).toEqual(['Zendesk', 'X', 'Nested Source']);
  });

  it('tolerates missing fields by filling safe defaults', () => {
    expect(shapeQuotes({ records: [{ text: 'bare quote' }] })).toEqual([
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

  it('drops entries that carry no usable text', () => {
    const shaped = shapeQuotes({
      records: [
        { text: '   ' },
        { source: 'no text at all' },
        null,
        'a bare string',
        42,
        { text: 'keeper' },
      ],
    });
    expect(shaped).toHaveLength(1);
    expect(shaped[0].text).toBe('keeper');
  });

  it('returns an empty array for a malformed payload rather than throwing', () => {
    expect(shapeQuotes(null)).toEqual([]);
    expect(shapeQuotes(undefined)).toEqual([]);
    expect(shapeQuotes('nope')).toEqual([]);
    expect(shapeQuotes({})).toEqual([]);
    expect(shapeQuotes({ records: 'not an array' })).toEqual([]);
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

describe('getEnterpretQuotes', () => {
  it('calls Enterpret with bearer auth and shapes the response', async () => {
    const fetchMock = stubFetch({
      records: [{ text: 'Docs are wrong', source: 'Slack', sentiment: 'NEGATIVE' }],
    });

    const quotes = await getEnterpretQuotes('ent_key', 'OAuth friction', 3);

    expect(quotes).toHaveLength(1);
    expect(quotes[0].sentiment).toBe('negative');

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('enterpret.com');
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer ent_key');
    expect(JSON.parse(init.body as string)).toMatchObject({ limit: 3 });
    expect(init.body as string).toContain('OAuth friction');
  });

  it('throws on a transport failure, like the other API clients', async () => {
    stubFetch({ message: 'nope' }, false, 500);
    await expect(getEnterpretQuotes('ent_key', 'theme')).rejects.toThrow(/Enterpret API HTTP error/);
  });

  it('short-circuits without a network call when the theme is blank', async () => {
    const fetchMock = stubFetch({});
    expect(await getEnterpretQuotes('ent_key', '   ')).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('throws a clear error when called without an API key', async () => {
    const fetchMock = stubFetch({});
    await expect(getEnterpretQuotes('', 'theme')).rejects.toThrow(/Enterpret API key/);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
