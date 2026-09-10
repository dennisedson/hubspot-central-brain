import { describe, it, expect } from 'vitest';
import {
  DEFAULT_UTM_MEDIUM,
  DEFAULT_UTM_SOURCE,
  MAX_UTM_CONTENT_LENGTH,
  UtmError,
  appendUtmParams,
  buildUtmLink,
  buildUtmParams,
  isUtmMedium,
  normalizeDestinationUrl,
  normalizeToken,
  slugify,
} from '@lib/utm';

/**
 * UTM link construction. The interesting behaviour here is not "does it build a
 * string" — it is the set of promises the module makes about OTHER people's
 * URLs, because a tracked link is pasted into a video description and then
 * lives forever. Getting a query parameter subtly wrong corrupts the
 * destination for every click.
 */

describe('slugify / normalizeToken', () => {
  it('slugs a human campaign name', () => {
    expect(slugify('Q1 Launch & Beyond')).toBe('q1-launch-beyond');
  });

  it('folds accents to ascii rather than dropping the letters', () => {
    // "Über" losing its first letter entirely would be worse than transliterating.
    expect(slugify('Über Naïve Café')).toBe('uber-naive-cafe');
  });

  it('collapses runs of separators instead of emitting empties', () => {
    expect(slugify('a  --  b')).toBe('a-b');
  });

  it('never leaves a dangling separator after truncation', () => {
    // Cutting "hubspot-crm" at 8 would land on "hubspot-", which reads as a
    // different value in analytics than "hubspot".
    const out = slugify('hubspot crm api', 8);
    expect(out.endsWith('-')).toBe(false);
    expect(out.length).toBeLessThanOrEqual(8);
  });

  it('keeps underscores for tokens but not for slugs', () => {
    expect(normalizeToken('Video_Description')).toBe('video_description');
    expect(slugify('Video_Description')).toBe('video-description');
  });

  it('returns empty string for values that cannot slug', () => {
    for (const v of [null, undefined, '', '   ', '///', 42 as unknown]) {
      expect(slugify(v)).toBe('');
    }
  });
});

describe('normalizeDestinationUrl', () => {
  it('upgrades a bare host, since a workflow field is typed by a human', () => {
    expect(normalizeDestinationUrl('developers.hubspot.com/pricing').href).toBe(
      'https://developers.hubspot.com/pricing',
    );
  });

  it('leaves an explicit scheme alone', () => {
    expect(normalizeDestinationUrl('http://example.com/x').protocol).toBe('http:');
  });

  it('refuses a non-http scheme rather than mangling it', () => {
    // Prepending https:// to "ftp://x.com/f" would produce a nonsense URL that
    // still parses — refusing is the safer failure.
    expect(() => normalizeDestinationUrl('ftp://x.com/f')).toThrow(UtmError);
  });

  it('refuses a missing destination', () => {
    expect(() => normalizeDestinationUrl('   ')).toThrow(UtmError);
    expect(() => normalizeDestinationUrl(undefined)).toThrow(UtmError);
  });

  it('names the failure in the error code', () => {
    try {
      normalizeDestinationUrl('');
      throw new Error('should have thrown');
    } catch (err) {
      expect((err as UtmError).code).toBe('missing_destination_url');
    }
  });
});

describe('buildUtmParams', () => {
  it('requires a campaign name', () => {
    expect(() => buildUtmParams({ campaignName: '  ' })).toThrow(UtmError);
  });

  it('defaults source and medium', () => {
    const p = buildUtmParams({ campaignName: 'launch' });
    expect(p.utm_source).toBe(DEFAULT_UTM_SOURCE);
    expect(p.utm_medium).toBe(DEFAULT_UTM_MEDIUM);
  });

  it('omits content entirely rather than emitting it empty', () => {
    // `utm_content=` is a real, distinct value in most analytics tools and
    // would show up as its own row.
    const p = buildUtmParams({ campaignName: 'launch', content: '///' });
    expect('utm_content' in p).toBe(false);
  });

  it('truncates content to the documented limit', () => {
    const p = buildUtmParams({ campaignName: 'launch', content: 'x'.repeat(200) });
    expect(p.utm_content!.length).toBeLessThanOrEqual(MAX_UTM_CONTENT_LENGTH);
  });

  it('produces a stable key order so the same inputs give a byte-identical link', () => {
    const a = buildUtmParams({ campaignName: 'launch', content: 'intro', term: 'crm' });
    const b = buildUtmParams({ campaignName: 'launch', content: 'intro', term: 'crm' });
    expect(Object.keys(a)).toEqual(Object.keys(b));
  });
});

describe('appendUtmParams — the destination is not ours to rewrite', () => {
  const params = { utm_source: 'youtube', utm_campaign: 'launch' };

  it('preserves an existing query parameter untouched', () => {
    const out = appendUtmParams(new URL('https://x.com/p?ref=abc'), params);
    expect(out).toContain('ref=abc');
  });

  it('does not rewrite a literal space as +', () => {
    // url.searchParams round-trips the whole query and turns %20 into +, which
    // changes the value the destination site receives.
    const out = appendUtmParams(new URL('https://x.com/p?q=a%20b'), params);
    expect(out).toContain('q=a%20b');
    expect(out).not.toContain('q=a+b');
  });

  it('replaces an existing utm parameter instead of duplicating it', () => {
    const out = appendUtmParams(new URL('https://x.com/p?utm_source=old'), params);
    expect(out).toContain('utm_source=youtube');
    expect(out).not.toContain('utm_source=old');
    expect(out.match(/utm_source=/g)).toHaveLength(1);
  });

  it('matches existing utm parameters case-insensitively', () => {
    const out = appendUtmParams(new URL('https://x.com/p?UTM_SOURCE=old'), params);
    expect(out).not.toContain('old');
  });

  it('re-attaches the fragment after the query', () => {
    // Appending before the hash would put the params inside the fragment,
    // where no analytics tool will ever see them.
    const out = appendUtmParams(new URL('https://x.com/p#section'), params);
    expect(out.endsWith('#section')).toBe(true);
    expect(out).toContain('utm_campaign=launch');
    expect(out.indexOf('utm_campaign')).toBeLessThan(out.indexOf('#'));
  });

  it('handles a URL with both a query and a fragment', () => {
    const out = appendUtmParams(new URL('https://x.com/p?a=1#frag'), params);
    expect(out).toBe('https://x.com/p?a=1&utm_source=youtube&utm_campaign=launch#frag');
  });

  it('encodes values that need it', () => {
    const out = appendUtmParams(new URL('https://x.com/p'), { utm_campaign: 'a b&c' });
    expect(out).toContain('utm_campaign=a%20b%26c');
  });
});

describe('buildUtmLink', () => {
  it('builds a complete tracked link', () => {
    const link = buildUtmLink({
      destinationUrl: 'developers.hubspot.com/pricing',
      campaignName: 'Q1 Launch',
      content: 'Intro Video',
    });
    expect(link.url).toContain('https://developers.hubspot.com/pricing?');
    expect(link.params.utm_campaign).toBe('q1-launch');
    expect(link.params.utm_content).toBe('intro-video');
    expect(link.destinationUrl).toBe('https://developers.hubspot.com/pricing');
  });

  it('is deterministic — the same inputs give the identical string', () => {
    const input = { destinationUrl: 'https://x.com/p?keep=1', campaignName: 'launch', term: 'crm' };
    expect(buildUtmLink(input).url).toBe(buildUtmLink(input).url);
  });

  it('throws before touching the URL when the campaign is unusable', () => {
    expect(() => buildUtmLink({ destinationUrl: 'https://x.com', campaignName: '' })).toThrow(UtmError);
  });
});

describe('isUtmMedium', () => {
  it('accepts a known medium and rejects anything else', () => {
    expect(isUtmMedium(DEFAULT_UTM_MEDIUM)).toBe(true);
    expect(isUtmMedium('not-a-medium')).toBe(false);
    expect(isUtmMedium(undefined)).toBe(false);
  });
});
