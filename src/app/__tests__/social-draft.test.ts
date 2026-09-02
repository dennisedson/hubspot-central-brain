import { describe, it, expect } from 'vitest';
import {
  generateSocialDraft,
  toHashtag,
  buildHashtags,
  CONTENT_TYPE_VARIANTS,
  DEFAULT_VARIANT,
  MAX_DRAFT_LENGTH,
  MAX_HASHTAGS,
} from '../lib/social-draft';

const URL = 'https://developers.hubspot.com/blog/bidirectional-sync';

describe('CONTENT_TYPE_VARIANTS', () => {
  it('exposes a variant for every provisioned content_type value', () => {
    for (const value of ['blog_post', 'video', 'tutorial', 'talk', 'changelog', 'documentation', 'social']) {
      expect(CONTENT_TYPE_VARIANTS[value]).toBeDefined();
      expect(CONTENT_TYPE_VARIANTS[value].opener.length).toBeGreaterThan(0);
      expect(CONTENT_TYPE_VARIANTS[value].cta.length).toBeGreaterThan(0);
    }
  });

  it('gives each content type a distinct opening line', () => {
    const openers = Object.values(CONTENT_TYPE_VARIANTS).map(v => v.opener);
    expect(new Set(openers).size).toBe(openers.length);
  });
});

describe('generateSocialDraft — content type variants', () => {
  const base = { title: 'Bulletproof Bidirectional Sync', publishedUrl: URL, topicTags: ['api'] };

  it('opens a blog post draft with the blog opener', () => {
    const draft = generateSocialDraft({ ...base, contentType: 'blog_post' });
    expect(draft.startsWith(CONTENT_TYPE_VARIANTS.blog_post.opener)).toBe(true);
    expect(draft).toContain(CONTENT_TYPE_VARIANTS.blog_post.cta);
  });

  it('opens a video draft with the video opener', () => {
    const draft = generateSocialDraft({ ...base, contentType: 'video' });
    expect(draft.startsWith(CONTENT_TYPE_VARIANTS.video.opener)).toBe(true);
    expect(draft).toContain(CONTENT_TYPE_VARIANTS.video.cta);
  });

  it('opens a changelog draft with the changelog opener', () => {
    const draft = generateSocialDraft({ ...base, contentType: 'changelog' });
    expect(draft.startsWith(CONTENT_TYPE_VARIANTS.changelog.opener)).toBe(true);
  });

  it('uses distinct openers for blog post, video and changelog', () => {
    const openerOf = (contentType: string) => generateSocialDraft({ ...base, contentType }).split('\n')[0];
    const openers = [openerOf('blog_post'), openerOf('video'), openerOf('changelog')];
    expect(new Set(openers).size).toBe(3);
  });

  it('falls back to the default variant for an unknown content type', () => {
    const draft = generateSocialDraft({ ...base, contentType: 'podcast_episode' });
    expect(draft.startsWith(DEFAULT_VARIANT.opener)).toBe(true);
  });

  it('falls back to the default variant when content type is missing', () => {
    const draft = generateSocialDraft({ ...base });
    expect(draft.startsWith(DEFAULT_VARIANT.opener)).toBe(true);
  });

  it('is case and whitespace insensitive about the content type', () => {
    const draft = generateSocialDraft({ ...base, contentType: '  Blog_Post ' });
    expect(draft.startsWith(CONTENT_TYPE_VARIANTS.blog_post.opener)).toBe(true);
  });
});

describe('toHashtag', () => {
  it('strips spaces and pascal cases each word', () => {
    expect(toHashtag('developer platform')).toBe('#DeveloperPlatform');
  });

  it('strips underscores from HubSpot enum values', () => {
    expect(toHashtag('ui_extensions')).toBe('#UIExtensions');
  });

  it('strips punctuation', () => {
    expect(toHashtag('ci/cd & deploys!')).toBe('#CiCdDeploys');
  });

  it('uppercases known acronyms', () => {
    expect(toHashtag('api')).toBe('#API');
    expect(toHashtag('crm')).toBe('#CRM');
  });

  it('preserves casing already supplied for acronyms', () => {
    expect(toHashtag('API')).toBe('#API');
  });

  it('lowercases the tail of an ordinary word', () => {
    expect(toHashtag('WORKFLOWS')).toBe('#Workflows');
  });

  it('trims surrounding whitespace', () => {
    expect(toHashtag('   workflows   ')).toBe('#Workflows');
  });

  it('returns an empty string for a tag with no alphanumerics', () => {
    expect(toHashtag('---')).toBe('');
    expect(toHashtag('')).toBe('');
  });

  it('does not start a hashtag with a digit-only word issue', () => {
    expect(toHashtag('2026 roadmap')).toBe('#2026Roadmap');
  });
});

describe('buildHashtags', () => {
  it('accepts an array of tags', () => {
    expect(buildHashtags(['api', 'crm'])).toEqual(['#API', '#CRM']);
  });

  it('accepts a semicolon separated HubSpot multi-checkbox string', () => {
    expect(buildHashtags('api;crm;workflows')).toEqual(['#API', '#CRM', '#Workflows']);
  });

  it('accepts a comma separated string', () => {
    expect(buildHashtags('api, crm')).toEqual(['#API', '#CRM']);
  });

  it('caps the number of hashtags at MAX_HASHTAGS', () => {
    const tags = ['api', 'crm', 'workflows', 'ui_extensions', 'integrations', 'developer_platform'];
    const hashtags = buildHashtags(tags);
    expect(MAX_HASHTAGS).toBe(4);
    expect(hashtags).toHaveLength(4);
    expect(hashtags).toEqual(['#API', '#CRM', '#Workflows', '#UIExtensions']);
  });

  it('drops empty and punctuation-only entries', () => {
    expect(buildHashtags(['api', '', '  ', '---', 'crm'])).toEqual(['#API', '#CRM']);
  });

  it('de-duplicates tags that collapse to the same hashtag', () => {
    expect(buildHashtags(['api', 'API', 'a.p.i'])).toEqual(['#API']);
  });

  it('returns an empty array for undefined, null and empty input', () => {
    expect(buildHashtags(undefined)).toEqual([]);
    expect(buildHashtags(null)).toEqual([]);
    expect(buildHashtags('')).toEqual([]);
    expect(buildHashtags([])).toEqual([]);
  });
});

describe('generateSocialDraft — hashtags', () => {
  it('renders hashtags on the final line', () => {
    const draft = generateSocialDraft({
      title: 'Sync',
      contentType: 'blog_post',
      publishedUrl: URL,
      topicTags: ['api', 'developer platform'],
    });
    const lines = draft.split('\n');
    expect(lines[lines.length - 1]).toBe('#API #DeveloperPlatform');
  });

  it('caps rendered hashtags at four', () => {
    const draft = generateSocialDraft({
      title: 'Sync',
      contentType: 'blog_post',
      publishedUrl: URL,
      topicTags: 'api;crm;workflows;ui_extensions;integrations;developer_platform',
    });
    expect(draft.match(/#/g)).toHaveLength(4);
    expect(draft).not.toContain('#Integrations');
  });

  it('omits the hashtag line entirely when there are no tags', () => {
    const draft = generateSocialDraft({
      title: 'Sync',
      contentType: 'blog_post',
      publishedUrl: URL,
      topicTags: [],
    });
    expect(draft).not.toContain('#');
    expect(draft.endsWith(URL)).toBe(true);
  });

  it('omits the hashtag line when tags are missing altogether', () => {
    const draft = generateSocialDraft({ title: 'Sync', contentType: 'blog_post', publishedUrl: URL });
    expect(draft).not.toContain('#');
  });
});

describe('generateSocialDraft — published URL', () => {
  it('includes the URL behind the content-type call to action', () => {
    const draft = generateSocialDraft({ title: 'Sync', contentType: 'blog_post', publishedUrl: URL });
    expect(draft).toContain(`${CONTENT_TYPE_VARIANTS.blog_post.cta} ${URL}`);
  });

  it('omits the call to action when the URL is missing', () => {
    const draft = generateSocialDraft({ title: 'Sync', contentType: 'blog_post', topicTags: ['api'] });
    expect(draft).not.toContain(CONTENT_TYPE_VARIANTS.blog_post.cta);
    expect(draft.toLowerCase()).not.toContain('read more');
    expect(draft).not.toContain('http');
  });

  it('omits the call to action when the URL is blank whitespace', () => {
    const draft = generateSocialDraft({ title: 'Sync', contentType: 'blog_post', publishedUrl: '   ', topicTags: ['api'] });
    expect(draft).not.toContain(CONTENT_TYPE_VARIANTS.blog_post.cta);
  });

  it('leaves no dangling separator or trailing whitespace when the URL is absent', () => {
    const draft = generateSocialDraft({ title: 'Sync', contentType: 'blog_post' });
    expect(draft).toBe(draft.trim());
    expect(draft).not.toContain('\n\n\n');
  });

  it('trims whitespace around a supplied URL', () => {
    const draft = generateSocialDraft({ title: 'Sync', contentType: 'blog_post', publishedUrl: `  ${URL}  ` });
    expect(draft).toContain(`${CONTENT_TYPE_VARIANTS.blog_post.cta} ${URL}`);
    expect(draft).toBe(draft.trim());
  });
});

describe('generateSocialDraft — theme and title edge cases', () => {
  it('includes the Enterpret theme when present', () => {
    const draft = generateSocialDraft({
      title: 'Sync',
      contentType: 'blog_post',
      enterpretTheme: 'webhook reliability',
    });
    expect(draft).toContain('webhook reliability');
  });

  it('omits the theme sentence when the theme is missing', () => {
    const withTheme = generateSocialDraft({ title: 'Sync', contentType: 'blog_post', enterpretTheme: 'rate limits' });
    const without = generateSocialDraft({ title: 'Sync', contentType: 'blog_post' });
    expect(without.split('\n\n').length).toBeLessThan(withTheme.split('\n\n').length);
  });

  it('omits the theme sentence when the theme is blank whitespace', () => {
    const draft = generateSocialDraft({ title: 'Sync', contentType: 'blog_post', enterpretTheme: '   ' });
    const without = generateSocialDraft({ title: 'Sync', contentType: 'blog_post' });
    expect(draft).toBe(without);
  });

  it('still produces a usable draft when the title is missing', () => {
    const draft = generateSocialDraft({ contentType: 'blog_post', publishedUrl: URL, topicTags: ['api'] });
    expect(draft.startsWith(CONTENT_TYPE_VARIANTS.blog_post.opener)).toBe(true);
    expect(draft).toContain(URL);
    expect(draft).toContain('#API');
    expect(draft).toBe(draft.trim());
  });

  it('treats a blank title the same as a missing one', () => {
    const blank = generateSocialDraft({ title: '   ', contentType: 'blog_post', publishedUrl: URL });
    const missing = generateSocialDraft({ contentType: 'blog_post', publishedUrl: URL });
    expect(blank).toBe(missing);
  });

  it('trims a padded title', () => {
    const draft = generateSocialDraft({ title: '  Sync  ', contentType: 'blog_post' });
    expect(draft).toContain('\nSync');
    expect(draft).not.toContain('  Sync');
  });

  it('produces something non-empty when every field is empty', () => {
    const draft = generateSocialDraft({});
    expect(draft.length).toBeGreaterThan(0);
    expect(draft).toBe(DEFAULT_VARIANT.opener);
  });
});

describe('generateSocialDraft — 2800 character cap', () => {
  const longTitle = 'Bidirectional Sync '.repeat(400); // ~7600 chars

  it('exports a cap of 2800', () => {
    expect(MAX_DRAFT_LENGTH).toBe(2800);
  });

  it('never exceeds the cap with a very long title', () => {
    const draft = generateSocialDraft({
      title: longTitle,
      contentType: 'blog_post',
      publishedUrl: URL,
      topicTags: ['api', 'crm', 'workflows', 'ui_extensions'],
    });
    expect(draft.length).toBeLessThanOrEqual(MAX_DRAFT_LENGTH);
  });

  it('preserves the full URL when truncating', () => {
    const draft = generateSocialDraft({
      title: longTitle,
      contentType: 'blog_post',
      publishedUrl: URL,
      topicTags: ['api', 'crm', 'workflows', 'ui_extensions'],
    });
    expect(draft).toContain(URL);
    expect(draft).toContain(`${CONTENT_TYPE_VARIANTS.blog_post.cta} ${URL}`);
  });

  it('preserves every hashtag when truncating', () => {
    const draft = generateSocialDraft({
      title: longTitle,
      contentType: 'blog_post',
      publishedUrl: URL,
      topicTags: ['api', 'crm', 'workflows', 'ui_extensions'],
    });
    expect(draft.endsWith('#API #CRM #Workflows #UIExtensions')).toBe(true);
  });

  it('keeps the opener intact and marks the body as truncated', () => {
    const draft = generateSocialDraft({
      title: longTitle,
      contentType: 'blog_post',
      publishedUrl: URL,
      topicTags: ['api'],
    });
    expect(draft.startsWith(CONTENT_TYPE_VARIANTS.blog_post.opener)).toBe(true);
    expect(draft).toContain('…');
  });

  it('truncates a long theme too', () => {
    const draft = generateSocialDraft({
      title: 'Sync',
      contentType: 'blog_post',
      publishedUrl: URL,
      enterpretTheme: 'rate limiting '.repeat(500),
      topicTags: ['api'],
    });
    expect(draft.length).toBeLessThanOrEqual(MAX_DRAFT_LENGTH);
    expect(draft).toContain(URL);
    expect(draft.endsWith('#API')).toBe(true);
  });

  it('does not truncate a draft that already fits', () => {
    const draft = generateSocialDraft({
      title: 'Bulletproof Bidirectional Sync',
      contentType: 'blog_post',
      publishedUrl: URL,
      topicTags: ['api'],
    });
    expect(draft).not.toContain('…');
    expect(draft.length).toBeLessThan(MAX_DRAFT_LENGTH);
  });

  it('never leaves trailing whitespace after truncation', () => {
    const draft = generateSocialDraft({ title: longTitle, contentType: 'video', publishedUrl: URL, topicTags: ['api'] });
    expect(draft).toBe(draft.trim());
  });
});
