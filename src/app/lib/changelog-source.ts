/**
 * Reading the rollout template out of a changelog record's `notes`.
 *
 * `notes` holds the Linear issue description verbatim, written on every
 * webhook. For rollout issues that description is a structured template, which
 * means drafting a changelog is a transformation of known fields rather than
 * generation from nothing.
 *
 * Measured across the 70 changelog records on production:
 *
 *   Rollout ID, Name, State          99%
 *   Hub                              97%
 *   `### Description` prose          99%   (median 272 characters)
 *   Type, Owner, Audiences,
 *   Use Cases, Frequency of Use,
 *   User Impact, Delivery Method    ~71%
 *   Gate Name                        41%
 *
 * That second tier is why `missingForStandalone` exists. A standalone post
 * leans hardest on exactly the fields a third of records do not have, and one
 * record's description is three characters long. Telling someone up front that
 * a record cannot support a standalone post is better than handing them a thin
 * draft and letting them find out.
 *
 * Parsing is deliberately forgiving. The template is not a contract — it is
 * whatever a human pasted into Linear — so anything unrecognised is left in
 * `raw` for the model to read rather than dropped.
 */

/** One changelog record's source material, as far as it could be read. */
export interface RolloutSource {
  /** `**Label:** value` pairs, keyed by label exactly as written. */
  fields: Record<string, string>;
  /** The prose under a `### Description` heading, if there is any. */
  description: string | null;
  /** The whole of `notes`, always. Nothing is parsed away. */
  raw: string;
}

/**
 * Fields a standalone post needs to be worth reading.
 *
 * Not Rollout ID or Gate Name — those are internal and never reach the post.
 * These are the ones that answer "who does this affect and how much".
 */
export const STANDALONE_FIELDS = ['Type', 'Audiences', 'Use Cases', 'User Impact'] as const;

/** A description shorter than this cannot carry a post on its own. */
export const THIN_DESCRIPTION = 40;

export function parseRolloutNotes(notes: string | null | undefined): RolloutSource {
  const raw = notes ?? '';
  const fields: Record<string, string> = {};

  // `**Label:** value` on one line. Values run to end of line; a value that
  // wraps is not something this template does.
  for (const match of raw.matchAll(/^\s*\*\*([^*:]+?):\*\*\s*(.+?)\s*$/gm)) {
    const label = match[1].trim();
    const value = match[2].trim();
    // First occurrence wins: the template repeats some labels inside the
    // description, and the header block is the authoritative one.
    if (label && value && !(label in fields)) fields[label] = value;
  }

  // The description sits under a heading of three to five hashes, and runs
  // until the next heading or a new `**Label:**` block.
  const described = raw.match(
    /#{3,5}\s*Description\s*\n+([\s\S]*?)(?=\n#{1,5}\s|\n\*\*[A-Z]|$)/,
  );
  const body = described?.[1]?.trim() ?? '';

  return { fields, description: body ? body : null, raw };
}

/**
 * What a standalone post would be missing, in the order a writer would notice.
 *
 * An empty array means the record has everything the format leans on. It does
 * not mean the draft will be good.
 */
export function missingForStandalone(source: RolloutSource): string[] {
  const missing: string[] = STANDALONE_FIELDS.filter(f => !source.fields[f]);
  const description = source.description ?? '';
  if (description.length < THIN_DESCRIPTION) {
    missing.push(description ? 'a usable Description' : 'Description');
  }
  return missing;
}

/**
 * The record's source material, rendered for the model.
 *
 * Fields first so the model sees the structure, then the description, then the
 * whole of `notes` — because the template is not a contract and the part that
 * matters is sometimes outside it.
 */
export function formatSourceForModel(source: RolloutSource, title: string): string {
  const lines: string[] = [`Record title: ${title}`, ''];

  const entries = Object.entries(source.fields);
  if (entries.length) {
    lines.push('Structured fields from the rollout:');
    for (const [k, v] of entries) lines.push(`- ${k}: ${v}`);
    lines.push('');
  }

  if (source.description) {
    lines.push('Description as written:', source.description, '');
  }

  lines.push(
    'Full notes, verbatim — the template above is only what could be parsed, so',
    'treat this as the source of truth where the two disagree:',
    '---',
    source.raw,
    '---',
  );

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Rollout timeline
// ---------------------------------------------------------------------------

/**
 * When a rollout needs attention, taken from the `### Timeline` block.
 *
 * The point is prioritisation, not drafting: which changelog should be written
 * next. That is decided by the beta and live milestones — in-development dates
 * are too far out to action and tentative ones are not commitments.
 *
 * Measured on production before any of this was written:
 *
 *   `### Timeline` present ................. 23 of 70 records
 *   the only date field so far .............. **Marketing Release Date:**
 *   of those 23, value `1970-01-01` ......... 10
 *
 * That last number is why `EPOCH_ZERO` exists. An unset date serialised as a
 * timestamp of 0 renders as 1970-01-01, and sorting ascending would put the
 * ten records we know least about at the very top, presented as the most
 * urgent. It is not an old date; it is no date.
 *
 * Every real value observed is the first of a month — 2026-10-01, 2026-03-01,
 * 2026-09-01 — so these are month-granular. Sort on them freely; do not print
 * them as a specific day without checking.
 */

/** An unset date, serialised as a timestamp of zero. Never a real milestone. */
export const EPOCH_ZERO = '1970-01-01';

/** Milestones that mean "this needs writing". In precedence order. */
const MILESTONE_PATTERNS: Array<{ stage: string; pattern: RegExp }> = [
  { stage: 'Public Beta', pattern: /public\s*beta/i },
  { stage: 'Private Beta', pattern: /private\s*beta/i },
  { stage: 'Live', pattern: /\blive\b|general\s*availability|\bga\b/i },
  { stage: 'Marketing Release', pattern: /marketing\s*release/i },
];

export interface Milestone {
  /** Normalised stage name, e.g. "Public Beta". */
  stage: string;
  /** The label exactly as it appeared, for display and for debugging. */
  label: string;
  /** ISO yyyy-mm-dd. */
  date: string;
}

/**
 * Whether a value is marked as not-a-commitment.
 *
 * PROVISIONAL. The rollout UI shows a Tentative/Confirmed control beside each
 * date, but no record has yet carried that marker in its notes, so the exact
 * text is unknown. This matches the obvious spellings and must be rechecked
 * against a real note once the richer timeline lands — see issue in the PR.
 *
 * Erring toward treating something as tentative is the safe direction: it
 * drops a record down the list rather than promising a date that may move.
 */
export function isTentative(value: string): boolean {
  return /\btentative\b|\btbd\b|\bestimated\b|\(\s*est\.?\s*\)/i.test(value);
}

/** The first yyyy-mm-dd in a value, if there is one. */
function isoDate(value: string): string | null {
  const match = value.match(/\d{4}-\d{2}-\d{2}/);
  return match ? match[0] : null;
}

/** Every usable beta/live milestone, earliest first. */
export function milestones(source: RolloutSource): Milestone[] {
  const found: Milestone[] = [];

  for (const [label, value] of Object.entries(source.fields)) {
    const match = MILESTONE_PATTERNS.find(m => m.pattern.test(label));
    if (!match) continue;
    if (isTentative(value)) continue;

    const date = isoDate(value);
    if (!date || date === EPOCH_ZERO) continue;

    found.push({ stage: match.stage, label, date });
  }

  return found.sort((a, b) => a.date.localeCompare(b.date));
}

export interface RolloutPriority {
  /** ISO yyyy-mm-dd — what to sort a pipeline column on. */
  date: string;
  /** Which milestone it came from, so the card can say why. */
  stage: string;
  /** False once the date has passed: shipped work is not pending work. */
  upcoming: boolean;
}

/**
 * The one date a pipeline column should sort on.
 *
 * The earliest milestone still ahead, because that is the next thing that
 * forces action. With nothing ahead, the most recent past milestone — which
 * still orders sensibly among shipped records and is marked `upcoming: false`
 * so the board can show it differently.
 */
export function rolloutPriority(
  source: RolloutSource,
  today: Date = new Date(),
): RolloutPriority | null {
  const all = milestones(source);
  if (all.length === 0) return null;

  const todayIso = today.toISOString().slice(0, 10);
  const ahead = all.find(m => m.date >= todayIso);
  if (ahead) return { date: ahead.date, stage: ahead.stage, upcoming: true };

  const last = all[all.length - 1];
  return { date: last.date, stage: last.stage, upcoming: false };
}
