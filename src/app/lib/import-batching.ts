/**
 * Splitting a historical import into requests a serverless function can finish.
 *
 * WHY THIS EXISTS
 * ---------------
 * The import used to send every selected id in one call. `AppSettingsApi`'s
 * backfill action carried a comment saying "the caller decides what and how
 * many, so each request is bounded by construction" — but the caller was a page
 * with a **Select All** button, so the unbounded case was one click away.
 *
 * Selecting all 83 assigned issues produced 33 records and a success message.
 * Each issue costs a HubSpot search plus a create or update, measured at ~0.57s
 * apiece against production; 83 of them is roughly 47 seconds of sequential
 * work inside a function that does not get 47 seconds.
 *
 * A bound that lives only in the caller is not a bound. This module is the
 * caller's half; `MAX_IMPORT_IDS` in the backfill action is the other half, so
 * neither side can be the only thing standing between a click and a truncated
 * import.
 */

/**
 * Issues per request.
 *
 * Matches `BACKFILL_PAGE_SIZE` in the backfill action deliberately: that
 * constant was already sized for "a page per call" and the import is the one
 * path that ignored it. At ~0.57s per issue this is under ten seconds of work.
 */
export const IMPORT_BATCH_SIZE = 15;

/** Splits into runs of at most `size`, preserving order. */
export function chunk<T>(items: readonly T[], size: number = IMPORT_BATCH_SIZE): T[][] {
  if (size < 1) throw new Error(`chunk size must be at least 1, got ${size}`);
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** What one backfill request reports back. */
export interface ImportResult {
  requested: number;
  imported: number;
  created: number;
  updated: number;
  errors: string[];
}

/**
 * Adds up the per-batch results into one.
 *
 * Errors accumulate rather than overwrite: a batch that fails entirely must
 * still be visible once the later batches have succeeded, which is the
 * difference between "47 of 83 imported, here is what went wrong" and a green
 * tick over a half-finished import.
 */
export function mergeImportResults(results: readonly ImportResult[]): ImportResult {
  return results.reduce<ImportResult>(
    (acc, r) => ({
      requested: acc.requested + r.requested,
      imported: acc.imported + r.imported,
      created: acc.created + r.created,
      updated: acc.updated + r.updated,
      errors: [...acc.errors, ...r.errors],
    }),
    { requested: 0, imported: 0, created: 0, updated: 0, errors: [] },
  );
}

/**
 * Whether what came back accounts for everything that was asked for.
 *
 * The page used to show "Import complete" in green whenever `errors` was empty,
 * without ever comparing against how many issues the person had selected. That
 * is how 33 of 83 read as success.
 */
export function isComplete(result: ImportResult, selectedCount: number): boolean {
  return result.errors.length === 0 && result.imported >= selectedCount;
}
