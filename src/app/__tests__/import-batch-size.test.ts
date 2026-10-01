import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { IMPORT_BATCH_SIZE } from '../lib/import-batching';

/**
 * The import batch size exists in two places and must agree.
 *
 * `src/app/lib/import-batching.ts` is what the backfill action enforces: a
 * request with more ids than this is refused outright. `SettingsApp.tsx` holds
 * its own copy, because no UI extension in this repo has ever imported from
 * `../lib` and the bundler's handling of that is unproven — the settings page
 * is not where that should be discovered.
 *
 * Duplication is the price of not finding out the hard way. This test is what
 * makes it safe: raise the page's number above the server's and every import
 * is refused; lower the server's below the page's and the same. Either way the
 * import stops working completely, which is the failure mode this whole change
 * was made to remove.
 */

const PAGE = join(__dirname, '..', 'pages', 'SettingsApp.tsx');

describe('import batch size', () => {
  it('is the same in the settings page as in the function that enforces it', () => {
    const source = readFileSync(PAGE, 'utf8');
    const match = source.match(/const IMPORT_BATCH_SIZE\s*=\s*(\d+)/);

    expect(match, 'SettingsApp.tsx no longer declares IMPORT_BATCH_SIZE').not.toBeNull();
    expect(Number(match![1])).toBe(IMPORT_BATCH_SIZE);
  });

  it('is small enough that a batch fits in one invocation', () => {
    // Measured against production: ~0.57s per issue, a search plus a write.
    // 15 is roughly eight seconds of work.
    expect(IMPORT_BATCH_SIZE).toBeGreaterThan(0);
    expect(IMPORT_BATCH_SIZE).toBeLessThanOrEqual(20);
  });

  it('gates the import on the routing map being filled in', () => {
    // Importing with no project mapped sends everything to the content
    // pipeline by default — which on this workspace would have filed 69
    // changelogs as content. The page hides Preview and Import until at least
    // one project is routed. Asserted statically because a UI extension cannot
    // be rendered in this suite.
    const source = readFileSync(PAGE, 'utf8');
    expect(source).toMatch(/Object\.keys\(projectMap\)\.length === 0/);
  });

  it('judges the result against what was requested, not just against errors', () => {
    // "Import complete" in green whenever errors was empty is how 33 of 83
    // read as success.
    const source = readFileSync(PAGE, 'utf8');
    expect(source).toMatch(/importResult\.imported >= importAsked/);
  });

  it('still sends the whole selection — the page batches rather than truncating', () => {
    const source = readFileSync(PAGE, 'utf8');
    // The bug: one call carrying every selected id.
    expect(source).not.toMatch(/ids:\s*Array\.from\(selectedIds\)\.join/);
    expect(source).toMatch(/chunk\(ids\)/);
  });
});
