/**
 * Pure formatting helpers for the Meeting Intelligence card.
 *
 * Deliberately I/O-free: every function here is a plain data transform so the
 * rendering rules can be unit-tested without touching the HubSpot API.
 */

/** Default number of meetings the card shows. */
export const MEETING_CAP = 10;

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

/** A meeting as it comes back from `/crm/v3/objects/meetings` — id plus raw properties. */
export interface RawMeeting {
  id: string;
  properties?: Record<string, string | number | null | undefined>;
}

/** A meeting reduced to exactly the fields the card renders. */
export interface NormalisedMeeting {
  id: string;
  title: string;
  /** ISO 8601, or null when HubSpot gave us nothing usable. */
  timestamp: string | null;
  /** Human-readable offset from now, e.g. "2h ago". */
  relative: string;
  /** Title-cased meeting outcome, or null when unset. */
  outcome: string | null;
}

/**
 * HubSpot returns datetimes either as ISO 8601 strings or as epoch-millis
 * (sometimes stringified). Normalise both to epoch millis, or null.
 */
export function parseHubSpotTimestamp(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined) return null;

  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }

  const trimmed = value.trim();
  if (trimmed === '') return null;

  // All-digits means epoch millis; Date.parse would misread it.
  if (/^\d+$/.test(trimmed)) {
    const asNumber = Number(trimmed);
    return Number.isFinite(asNumber) ? asNumber : null;
  }

  const parsed = Date.parse(trimmed);
  return Number.isNaN(parsed) ? null : parsed;
}

/**
 * "2h ago" / "3d ago" / "in 30m" / "Never".
 *
 * `now` is injectable so tests do not depend on the wall clock.
 */
export function formatRelativeTime(
  value: string | number | null | undefined,
  now: number = Date.now(),
): string {
  const then = parseHubSpotTimestamp(value);
  if (then === null) return 'Never';

  const diff = now - then;
  const magnitude = Math.abs(diff);

  if (magnitude < MINUTE_MS) return 'Just now';

  let amount: string;
  if (magnitude < HOUR_MS) {
    amount = `${Math.floor(magnitude / MINUTE_MS)}m`;
  } else if (magnitude < DAY_MS) {
    amount = `${Math.floor(magnitude / HOUR_MS)}h`;
  } else {
    amount = `${Math.floor(magnitude / DAY_MS)}d`;
  }

  return diff >= 0 ? `${amount} ago` : `in ${amount}`;
}

/** "NO_SHOW" -> "No show". Returns null when the outcome is unset. */
export function formatOutcome(value: string | null | undefined): string | null {
  if (!value) return null;
  const words = value.trim().toLowerCase().replace(/_/g, ' ');
  if (words === '') return null;
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** Reduce one raw meeting to the fields the card renders. */
export function normaliseMeeting(raw: RawMeeting, now: number = Date.now()): NormalisedMeeting {
  const props = raw.properties ?? {};
  const when = parseHubSpotTimestamp(props.hs_meeting_start_time ?? props.hs_timestamp);
  const title = typeof props.hs_meeting_title === 'string' ? props.hs_meeting_title.trim() : '';

  return {
    id: String(raw.id),
    title: title || 'Untitled meeting',
    timestamp: when === null ? null : new Date(when).toISOString(),
    relative: formatRelativeTime(when, now),
    outcome: formatOutcome(
      typeof props.hs_meeting_outcome === 'string' ? props.hs_meeting_outcome : null,
    ),
  };
}

/**
 * Sort newest-first and cap the list, normalising each survivor.
 *
 * Meetings with no usable timestamp sort to the bottom rather than being
 * dropped — an undated meeting is still a meeting worth showing.
 */
export function sortAndCapMeetings(
  raws: RawMeeting[],
  cap: number = MEETING_CAP,
  now: number = Date.now(),
): NormalisedMeeting[] {
  if (!Array.isArray(raws)) return [];
  const limit = typeof cap === 'number' && cap >= 0 ? cap : MEETING_CAP;

  return raws
    .map(raw => ({
      raw,
      sortKey: parseHubSpotTimestamp(raw.properties?.hs_meeting_start_time ?? raw.properties?.hs_timestamp),
    }))
    .sort((a, b) => {
      if (a.sortKey === null && b.sortKey === null) return 0;
      if (a.sortKey === null) return 1;
      if (b.sortKey === null) return -1;
      return b.sortKey - a.sortKey;
    })
    .slice(0, limit)
    .map(entry => normaliseMeeting(entry.raw, now));
}
