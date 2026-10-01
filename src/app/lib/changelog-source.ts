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
