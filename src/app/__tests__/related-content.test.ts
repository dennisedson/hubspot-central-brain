import { describe, it, expect } from 'vitest';
import {
  parseTopicTags,
  scoreRelated,
  TAG_WEIGHT,
  THEME_WEIGHT,
} from '../lib/related-content';
import type { RelatedCandidate } from '../lib/related-content';

function rec(
  id: string,
  topicTags: string[] = [],
  enterpretTheme: string | null = null,
): RelatedCandidate {
  return { id, topicTags, enterpretTheme };
}

describe('parseTopicTags', () => {
  it('returns an empty array for null', () => {
    expect(parseTopicTags(null)).toEqual([]);
  });

  it('returns an empty array for undefined', () => {
    expect(parseTopicTags(undefined)).toEqual([]);
  });

  it('returns an empty array for an empty string', () => {
    expect(parseTopicTags('')).toEqual([]);
  });

  it('returns an empty array for a whitespace-only string', () => {
    expect(parseTopicTags('   ')).toEqual([]);
  });

  it('parses a single tag', () => {
    expect(parseTopicTags('api')).toEqual(['api']);
  });

  it('splits on semicolons — the HubSpot multi-select convention', () => {
    expect(parseTopicTags('api;crm;workflows')).toEqual(['api', 'crm', 'workflows']);
  });

  it('also splits on commas for free-text tag properties', () => {
    expect(parseTopicTags('api, crm')).toEqual(['api', 'crm']);
  });

  it('trims surrounding whitespace on each tag', () => {
    expect(parseTopicTags('  api ;  crm  ')).toEqual(['api', 'crm']);
  });

  it('drops empty segments from stray separators', () => {
    expect(parseTopicTags(';api;;crm;')).toEqual(['api', 'crm']);
  });

  it('de-duplicates case-insensitively, keeping the first spelling', () => {
    expect(parseTopicTags('API;api;Api')).toEqual(['API']);
  });
});

describe('scoreRelated — shared topic tags', () => {
  it('scores one shared tag at TAG_WEIGHT', () => {
    const ranked = scoreRelated(rec('1', ['api']), [rec('2', ['api'])]);
    expect(ranked).toHaveLength(1);
    expect(ranked[0].score).toBe(TAG_WEIGHT);
    expect(ranked[0].matchedTags).toEqual(['api']);
  });

  it('scores two shared tags at 2 x TAG_WEIGHT', () => {
    const ranked = scoreRelated(rec('1', ['api', 'crm']), [rec('2', ['api', 'crm', 'talks'])]);
    expect(ranked[0].score).toBe(TAG_WEIGHT * 2);
    expect(ranked[0].matchedTags).toEqual(['api', 'crm']);
  });

  it('ignores tags the candidate does not share', () => {
    const ranked = scoreRelated(rec('1', ['api', 'crm']), [rec('2', ['crm'])]);
    expect(ranked[0].score).toBe(TAG_WEIGHT);
    expect(ranked[0].matchedTags).toEqual(['crm']);
  });

  it('matches tags case-insensitively but reports the source spelling', () => {
    const ranked = scoreRelated(rec('1', ['API']), [rec('2', ['api'])]);
    expect(ranked[0].score).toBe(TAG_WEIGHT);
    expect(ranked[0].matchedTags).toEqual(['API']);
  });

  it('does not double-count a tag the candidate repeats', () => {
    const ranked = scoreRelated(rec('1', ['api']), [rec('2', ['api', 'API'])]);
    expect(ranked[0].score).toBe(TAG_WEIGHT);
  });
});

describe('scoreRelated — enterpret theme', () => {
  it('scores a matching theme at THEME_WEIGHT', () => {
    const ranked = scoreRelated(rec('1', [], 'Auth Pain'), [rec('2', [], 'Auth Pain')]);
    expect(ranked[0].score).toBe(THEME_WEIGHT);
    expect(ranked[0].matchedTheme).toBe('Auth Pain');
  });

  it('matches themes case-insensitively and ignoring surrounding whitespace', () => {
    const ranked = scoreRelated(rec('1', [], 'Auth Pain'), [rec('2', [], '  auth pain ')]);
    expect(ranked[0].score).toBe(THEME_WEIGHT);
  });

  it('does not match different themes', () => {
    const ranked = scoreRelated(rec('1', [], 'Auth Pain'), [rec('2', [], 'Rate Limits')]);
    expect(ranked).toEqual([]);
  });

  it('does not match when both themes are null', () => {
    const ranked = scoreRelated(rec('1', [], null), [rec('2', [], null)]);
    expect(ranked).toEqual([]);
  });

  it('does not match when both themes are empty strings', () => {
    const ranked = scoreRelated(rec('1', [], ''), [rec('2', [], '')]);
    expect(ranked).toEqual([]);
  });

  it('reports a null matchedTheme when only tags matched', () => {
    const ranked = scoreRelated(rec('1', ['api'], 'Auth Pain'), [rec('2', ['api'], 'Rate Limits')]);
    expect(ranked[0].matchedTheme).toBeNull();
  });
});

describe('scoreRelated — combined scoring', () => {
  it('adds tag and theme weights together', () => {
    const ranked = scoreRelated(
      rec('1', ['api', 'crm'], 'Auth Pain'),
      [rec('2', ['api', 'crm'], 'Auth Pain')],
    );
    expect(ranked[0].score).toBe(TAG_WEIGHT * 2 + THEME_WEIGHT);
    expect(ranked[0].matchedTags).toEqual(['api', 'crm']);
    expect(ranked[0].matchedTheme).toBe('Auth Pain');
  });
});

describe('scoreRelated — exclusions', () => {
  it('excludes the source record itself even when it would score highly', () => {
    const source = rec('1', ['api'], 'Auth Pain');
    const ranked = scoreRelated(source, [source, rec('2', ['api'])]);
    expect(ranked.map(r => r.candidate.id)).toEqual(['2']);
  });

  it('excludes a different object carrying the same id as the source', () => {
    const ranked = scoreRelated(rec('7', ['api']), [rec('7', ['api', 'crm'])]);
    expect(ranked).toEqual([]);
  });

  it('drops candidates that score zero', () => {
    const ranked = scoreRelated(rec('1', ['api']), [rec('2', ['workflows']), rec('3', ['api'])]);
    expect(ranked.map(r => r.candidate.id)).toEqual(['3']);
  });

  it('returns an empty array when there are no candidates', () => {
    expect(scoreRelated(rec('1', ['api']), [])).toEqual([]);
  });

  it('returns an empty array when the source has no tags and no theme', () => {
    expect(scoreRelated(rec('1', [], null), [rec('2', ['api'], 'Auth Pain')])).toEqual([]);
  });
});

describe('scoreRelated — ordering', () => {
  it('sorts by score descending', () => {
    const ranked = scoreRelated(rec('1', ['api', 'crm'], 'Auth Pain'), [
      rec('2', ['api']),
      rec('3', ['api', 'crm'], 'Auth Pain'),
      rec('4', ['crm'], 'Auth Pain'),
    ]);
    expect(ranked.map(r => r.candidate.id)).toEqual(['3', '4', '2']);
    expect(ranked.map(r => r.score)).toEqual([
      TAG_WEIGHT * 2 + THEME_WEIGHT,
      TAG_WEIGHT + THEME_WEIGHT,
      TAG_WEIGHT,
    ]);
  });

  it('preserves input order for candidates with equal scores', () => {
    const ranked = scoreRelated(rec('1', ['api']), [rec('2', ['api']), rec('3', ['api'])]);
    expect(ranked.map(r => r.candidate.id)).toEqual(['2', '3']);
  });

  it('does not mutate the candidates array it was given', () => {
    const candidates = [rec('2', ['api']), rec('3', ['api', 'crm'])];
    const snapshot = candidates.map(c => c.id);
    scoreRelated(rec('1', ['api', 'crm']), candidates);
    expect(candidates.map(c => c.id)).toEqual(snapshot);
  });
});

describe('scoreRelated — pass-through of extra candidate fields', () => {
  it('returns the original candidate object so callers can carry title and url', () => {
    const candidate = { id: '2', topicTags: ['api'], enterpretTheme: null, title: 'Auth 101', url: 'https://x' };
    const ranked = scoreRelated(rec('1', ['api']), [candidate]);
    expect(ranked[0].candidate).toBe(candidate);
    expect(ranked[0].candidate.title).toBe('Auth 101');
  });
});
