import { describe, it, expect } from 'vitest';
import {
  chunk,
  mergeImportResults,
  isComplete,
  IMPORT_BATCH_SIZE,
  type ImportResult,
} from '../lib/import-batching';

/**
 * Selecting all 83 assigned issues produced 33 records on production and a
 * green "Import complete". Two separate failures: the request was never split,
 * and the result was never checked against what was asked for.
 */

const empty: ImportResult = { requested: 0, imported: 0, created: 0, updated: 0, errors: [] };

describe('chunk', () => {
  it('splits 83 selected issues into runs a function can finish', () => {
    const ids = Array.from({ length: 83 }, (_, i) => `id-${i}`);
    const batches = chunk(ids);

    expect(batches).toHaveLength(6);
    expect(batches[0]).toHaveLength(IMPORT_BATCH_SIZE);
    expect(batches[5]).toHaveLength(83 % IMPORT_BATCH_SIZE);
    expect(batches.flat()).toEqual(ids);
  });

  it('preserves order, so a partial import is a prefix and not a lottery', () => {
    expect(chunk(['a', 'b', 'c', 'd', 'e'], 2)).toEqual([['a', 'b'], ['c', 'd'], ['e']]);
  });

  it('returns nothing for an empty selection', () => {
    expect(chunk([])).toEqual([]);
  });

  it('does not emit a trailing empty batch when the split is exact', () => {
    expect(chunk(['a', 'b', 'c', 'd'], 2)).toEqual([['a', 'b'], ['c', 'd']]);
  });

  it('refuses a size that would loop forever', () => {
    expect(() => chunk(['a'], 0)).toThrow(/at least 1/);
  });
});

describe('mergeImportResults', () => {
  it('adds the batches up', () => {
    const merged = mergeImportResults([
      { requested: 15, imported: 15, created: 15, updated: 0, errors: [] },
      { requested: 15, imported: 15, created: 10, updated: 5, errors: [] },
    ]);

    expect(merged).toEqual({ requested: 30, imported: 30, created: 25, updated: 5, errors: [] });
  });

  it('keeps an early batch\'s errors after later batches succeed', () => {
    // The whole point. A failure in batch 1 must survive five green batches.
    const merged = mergeImportResults([
      { requested: 15, imported: 14, created: 14, updated: 0, errors: ['ENG-1: boom'] },
      { requested: 15, imported: 15, created: 15, updated: 0, errors: [] },
    ]);

    expect(merged.errors).toEqual(['ENG-1: boom']);
    expect(merged.imported).toBe(29);
  });

  it('is empty for no batches', () => {
    expect(mergeImportResults([])).toEqual(empty);
  });
});

describe('isComplete', () => {
  it('is false when fewer came back than were asked for, even with no errors', () => {
    // 33 of 83, no errors reported — the exact shape that read as success.
    const result: ImportResult = { requested: 33, imported: 33, created: 33, updated: 0, errors: [] };
    expect(isComplete(result, 83)).toBe(false);
  });

  it('is true when everything selected came back clean', () => {
    const result: ImportResult = { requested: 83, imported: 83, created: 80, updated: 3, errors: [] };
    expect(isComplete(result, 83)).toBe(true);
  });

  it('is false when the count is right but something errored', () => {
    const result: ImportResult = { requested: 83, imported: 83, created: 82, updated: 0, errors: ['x'] };
    expect(isComplete(result, 83)).toBe(false);
  });
});
