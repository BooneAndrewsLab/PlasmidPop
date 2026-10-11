import { writeFileSync } from 'node:fs';

import { beforeAll, describe, expect, it } from 'vitest';

import { loadFeatureLibrary } from '@/core/annotate/library';

import {
  type Comparison,
  PART_CLASSES,
  type PartClass,
  compare,
  report,
  vectors,
  versions,
} from './plannotateCompare';

/**
 * Detect features against pLannotate (#220, docs/design/59-detect-features.md).
 * scripts/plannotate/ fetches 83 vectors from NCBI, strips them to bare
 * sequence and has pLannotate annotate them; plannotate.json is what it
 * reported. This test runs Detect features on the same sequences and asserts
 * that recall, per part class, does not fall below what was measured when the
 * baseline was set. pLannotate is never run here, and CI reads only the JSON.
 *
 * A recall counts a pLannotate hit (a whole feature, not one of its
 * fragments) as found when a hit of ours on the same strand (any strand, for
 * an origin) shares half of the shorter. After a change that raises recall,
 * raise the baseline to the new numbers; to see the tables, run with
 * PLANNOTATE_REPORT=/some/file.md.
 */

/** Least recall per class, the measured recall rounded down. */
const BASELINE: Record<PartClass, number> = {
  origin: 0.941,
  marker: 0.938,
  promoter: 0.88,
  tag: 0.923,
  FP: 0.906,
  terminator: 0.782,
  RNA: 0.916,
  other: 0.676,
};
const BASELINE_ALL = 0.823;

describe('Detect features against pLannotate', () => {
  let result: Comparison;
  beforeAll(async () => {
    result = compare(await loadFeatureLibrary());
    const path = process.env['PLANNOTATE_REPORT'];
    if (path !== undefined) writeFileSync(path, report(result));
  }, 120_000);

  it('records which pLannotate and databases made the expectations', () => {
    expect(versions.plannotate).toMatch(/^pLannotate \d/);
    expect(Object.keys(versions.databases)).toEqual(
      expect.arrayContaining(['snapgene', 'fpbase', 'swissprot', 'Rfam']),
    );
  });

  it('covers a corpus of at least 50 vectors, with no annotation left in', () => {
    expect(vectors.length).toBeGreaterThanOrEqual(50);
    for (const v of vectors) {
      expect(v.sequence).toHaveLength(v.length);
      expect(v.sequence).toMatch(/^[ACGTN]+$/);
    }
  });

  it.each(PART_CLASSES)('recall of %s parts does not fall below the baseline', (cls) => {
    expect(result.total[cls]).toBeGreaterThan(0);
    expect(result.found[cls] / result.total[cls]).toBeGreaterThanOrEqual(BASELINE[cls]);
  });

  it('recall over all pLannotate hits does not fall below the baseline', () => {
    const all = PART_CLASSES.reduce((n, c) => n + result.total[c], 0);
    const found = PART_CLASSES.reduce((n, c) => n + result.found[c], 0);
    expect(found / all).toBeGreaterThanOrEqual(BASELINE_ALL);
  });

  it('gives every miss a cause', () => {
    const missed = PART_CLASSES.reduce((n, c) => n + result.total[c] - result.found[c], 0);
    expect(result.misses).toHaveLength(missed);
  });
});
