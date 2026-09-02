import { describe, it, expect } from 'vitest';
import {
  parseHubSpotTimestamp,
  formatRelativeTime,
  formatOutcome,
  normaliseMeeting,
  sortAndCapMeetings,
  MEETING_CAP,
} from '../lib/meeting-format';
import type { RawMeeting } from '../lib/meeting-format';

// A fixed "now" so every relative-time assertion is deterministic.
const NOW = Date.parse('2026-09-02T12:00:00.000Z');
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** Build an ISO string offset from NOW by `ms` in the past. */
function ago(ms: number): string {
  return new Date(NOW - ms).toISOString();
}

function meeting(id: string, props: Record<string, string | null>): RawMeeting {
  return { id, properties: props };
}

describe('parseHubSpotTimestamp', () => {
  it('parses an ISO 8601 string', () => {
    expect(parseHubSpotTimestamp('2026-09-02T11:00:00.000Z')).toBe(
      Date.parse('2026-09-02T11:00:00.000Z'),
    );
  });

  it('parses an epoch-millis string, which is how HubSpot often returns hs_timestamp', () => {
    expect(parseHubSpotTimestamp('1756814400000')).toBe(1756814400000);
  });

  it('parses an epoch-millis number', () => {
    expect(parseHubSpotTimestamp(1756814400000)).toBe(1756814400000);
  });

  it('returns null for null, undefined and empty string', () => {
    expect(parseHubSpotTimestamp(null)).toBeNull();
    expect(parseHubSpotTimestamp(undefined)).toBeNull();
    expect(parseHubSpotTimestamp('')).toBeNull();
    expect(parseHubSpotTimestamp('   ')).toBeNull();
  });

  it('returns null for an unparseable string rather than NaN', () => {
    expect(parseHubSpotTimestamp('not-a-date')).toBeNull();
  });
});

describe('formatRelativeTime', () => {
  it('returns "Never" when the timestamp is missing', () => {
    expect(formatRelativeTime(null, NOW)).toBe('Never');
    expect(formatRelativeTime(undefined, NOW)).toBe('Never');
    expect(formatRelativeTime('', NOW)).toBe('Never');
  });

  it('returns "Never" when the timestamp cannot be parsed', () => {
    expect(formatRelativeTime('garbage', NOW)).toBe('Never');
  });

  it('returns "Just now" under a minute', () => {
    expect(formatRelativeTime(ago(0), NOW)).toBe('Just now');
    expect(formatRelativeTime(ago(59_000), NOW)).toBe('Just now');
  });

  it('switches to minutes at exactly one minute', () => {
    expect(formatRelativeTime(ago(MINUTE), NOW)).toBe('1m ago');
  });

  it('floors within the minutes band', () => {
    expect(formatRelativeTime(ago(5 * MINUTE + 59_000), NOW)).toBe('5m ago');
    expect(formatRelativeTime(ago(59 * MINUTE), NOW)).toBe('59m ago');
  });

  it('switches to hours at exactly one hour', () => {
    expect(formatRelativeTime(ago(HOUR), NOW)).toBe('1h ago');
    expect(formatRelativeTime(ago(HOUR - 1), NOW)).toBe('59m ago');
  });

  it('floors within the hours band', () => {
    expect(formatRelativeTime(ago(2 * HOUR), NOW)).toBe('2h ago');
    expect(formatRelativeTime(ago(23 * HOUR + 59 * MINUTE), NOW)).toBe('23h ago');
  });

  it('switches to days at exactly one day', () => {
    expect(formatRelativeTime(ago(DAY), NOW)).toBe('1d ago');
    expect(formatRelativeTime(ago(DAY - 1), NOW)).toBe('23h ago');
  });

  it('floors within the days band', () => {
    expect(formatRelativeTime(ago(3 * DAY), NOW)).toBe('3d ago');
    expect(formatRelativeTime(ago(400 * DAY), NOW)).toBe('400d ago');
  });

  it('renders future meetings as "in ..." rather than negative time', () => {
    expect(formatRelativeTime(ago(-30 * MINUTE), NOW)).toBe('in 30m');
    expect(formatRelativeTime(ago(-4 * HOUR), NOW)).toBe('in 4h');
    expect(formatRelativeTime(ago(-2 * DAY), NOW)).toBe('in 2d');
    expect(formatRelativeTime(ago(-30_000), NOW)).toBe('Just now');
  });
});

describe('formatOutcome', () => {
  it('title-cases HubSpot enum values', () => {
    expect(formatOutcome('COMPLETED')).toBe('Completed');
    expect(formatOutcome('NO_SHOW')).toBe('No show');
    expect(formatOutcome('RESCHEDULED')).toBe('Rescheduled');
  });

  it('returns null when there is no outcome', () => {
    expect(formatOutcome(null)).toBeNull();
    expect(formatOutcome(undefined)).toBeNull();
    expect(formatOutcome('')).toBeNull();
  });
});

describe('normaliseMeeting', () => {
  it('maps the HubSpot property names onto render-ready fields', () => {
    const result = normaliseMeeting(
      meeting('1', {
        hs_meeting_title: 'Roadmap sync',
        hs_meeting_start_time: ago(2 * HOUR),
        hs_meeting_outcome: 'COMPLETED',
      }),
      NOW,
    );
    expect(result).toEqual({
      id: '1',
      title: 'Roadmap sync',
      timestamp: new Date(NOW - 2 * HOUR).toISOString(),
      relative: '2h ago',
      outcome: 'Completed',
    });
  });

  it('falls back to hs_timestamp when there is no start time', () => {
    const result = normaliseMeeting(
      meeting('2', { hs_timestamp: ago(DAY), hs_meeting_title: 'Kickoff' }),
      NOW,
    );
    expect(result.timestamp).toBe(new Date(NOW - DAY).toISOString());
    expect(result.relative).toBe('1d ago');
  });

  it('supplies a title placeholder when the meeting is untitled', () => {
    expect(normaliseMeeting(meeting('3', {}), NOW).title).toBe('Untitled meeting');
  });

  it('tolerates a meeting with no timestamp at all', () => {
    const result = normaliseMeeting(meeting('4', { hs_meeting_title: 'Ghost' }), NOW);
    expect(result.timestamp).toBeNull();
    expect(result.relative).toBe('Never');
    expect(result.outcome).toBeNull();
  });
});

describe('sortAndCapMeetings', () => {
  it('sorts newest first', () => {
    const sorted = sortAndCapMeetings(
      [
        meeting('old', { hs_meeting_start_time: ago(5 * DAY) }),
        meeting('new', { hs_meeting_start_time: ago(1 * HOUR) }),
        meeting('mid', { hs_meeting_start_time: ago(2 * DAY) }),
      ],
      10,
      NOW,
    );
    expect(sorted.map(m => m.id)).toEqual(['new', 'mid', 'old']);
  });

  it('sorts future meetings above past ones', () => {
    const sorted = sortAndCapMeetings(
      [
        meeting('past', { hs_meeting_start_time: ago(1 * HOUR) }),
        meeting('future', { hs_meeting_start_time: ago(-1 * HOUR) }),
      ],
      10,
      NOW,
    );
    expect(sorted.map(m => m.id)).toEqual(['future', 'past']);
  });

  it('pushes meetings with no timestamp to the bottom instead of dropping them', () => {
    const sorted = sortAndCapMeetings(
      [
        meeting('undated', {}),
        meeting('dated', { hs_meeting_start_time: ago(9 * DAY) }),
      ],
      10,
      NOW,
    );
    expect(sorted.map(m => m.id)).toEqual(['dated', 'undated']);
  });

  it('caps the list at the requested length, keeping the newest', () => {
    const raws = Array.from({ length: 25 }, (_, i) =>
      meeting(`m${i}`, { hs_meeting_start_time: ago(i * DAY) }),
    );
    const sorted = sortAndCapMeetings(raws, 3, NOW);
    expect(sorted.map(m => m.id)).toEqual(['m0', 'm1', 'm2']);
  });

  it('defaults the cap to MEETING_CAP', () => {
    const raws = Array.from({ length: 40 }, (_, i) =>
      meeting(`m${i}`, { hs_meeting_start_time: ago(i * HOUR) }),
    );
    expect(sortAndCapMeetings(raws, undefined, NOW)).toHaveLength(MEETING_CAP);
    expect(MEETING_CAP).toBe(10);
  });

  it('does not mutate the input array', () => {
    const raws = [
      meeting('a', { hs_meeting_start_time: ago(1 * DAY) }),
      meeting('b', { hs_meeting_start_time: ago(3 * DAY) }),
      meeting('c', { hs_meeting_start_time: ago(2 * DAY) }),
    ];
    sortAndCapMeetings(raws, 10, NOW);
    expect(raws.map(m => m.id)).toEqual(['a', 'b', 'c']);
  });

  it('returns an empty array for an empty input', () => {
    expect(sortAndCapMeetings([], 10, NOW)).toEqual([]);
  });

  it('ignores a non-array input rather than throwing', () => {
    expect(sortAndCapMeetings(undefined as unknown as RawMeeting[], 10, NOW)).toEqual([]);
  });
});
