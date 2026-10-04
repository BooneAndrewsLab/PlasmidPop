import { describe, expect, it } from 'vitest';

import { handStack } from '@/test/handStack';

import {
  counterText,
  DEFAULT_FILTER,
  type DifferenceFilter,
  filterRegions,
  narrows,
  NO_FILTER,
} from './alignmentFilter';
import { differenceRegions } from './alignmentStack';
import { ColumnClass } from './alignmentTrack';

//                     0         1
//                     0123456789012345
const reference = 'ACGTACGTACGTACGT';
// r0 differs at 2 (Q10) and 9 (Q40); r1 at 5 (no qualities) and a deletion at 12-13.
const q0 = new Array<number>(16).fill(40);
q0[2] = 10;
const stack = handStack(reference, [
  { bases: 'ACCTACGTAGGTACGT', qualities: q0 },
  { bases: 'ACGTAGGTACGT--GT' },
]);
const regions = differenceRegions(stack.differences);
// 0-3 none, 4-7 a feature, 8-11 a CDS, 12-15 none.
const classes = Uint8Array.from({ length: 16 }, (_, c) =>
  c >= 8 && c < 12 ? ColumnClass.Cds : c >= 4 && c < 8 ? ColumnClass.Feature : 0,
);

function starts(
  filter: Partial<DifferenceFilter>,
  pickedRow: number | null = null,
  reviewed: number[] = [],
) {
  return filterRegions(
    stack,
    regions,
    { ...NO_FILTER, ...filter },
    { classes, confidentFrom: 20, pickedRow, reviewed: new Set(reviewed) },
  ).map((i) => regions[i]?.start);
}

describe('filterRegions', () => {
  it('lets every region through with no filter', () => {
    expect(regions.map((r) => r.start)).toEqual([2, 5, 9, 12]);
    expect(starts({})).toEqual([2, 5, 9, 12]);
  });

  it('keeps those in any feature, or only those in a CDS', () => {
    expect(starts({ where: 'feature' })).toEqual([5, 9]);
    expect(starts({ where: 'cds' })).toEqual([9]);
  });

  it('passes nothing but "anywhere" without a document', () => {
    const none = filterRegions(
      stack,
      regions,
      { ...NO_FILTER, where: 'feature' },
      { classes: null, confidentFrom: 20, pickedRow: null, reviewed: new Set() },
    );
    expect(none).toEqual([]);
  });

  it('drops a poor base, trusting a read without qualities and a deletion', () => {
    expect(starts({ goodQuality: true })).toEqual([5, 9, 12]);
  });

  it('keeps only what the picked sample carries, and everything with none picked', () => {
    expect(starts({ pickedOnly: true }, 0)).toEqual([2, 9]);
    expect(starts({ pickedOnly: true }, 1)).toEqual([5, 12]);
    expect(starts({ pickedOnly: true }, null)).toEqual([2, 5, 9, 12]);
  });

  it('combines the picked sample with quality per base', () => {
    expect(starts({ pickedOnly: true, goodQuality: true }, 0)).toEqual([9]);
  });

  it('skips reviewed regions only when asked', () => {
    expect(starts({ skipReviewed: true }, null, [1, 3])).toEqual([2, 9]);
    expect(starts({}, null, [1, 3])).toEqual([2, 5, 9, 12]);
  });

  it('counts a region another sample carries at good quality while this one is poor', () => {
    const both = handStack('ACGTACGT', [
      { bases: 'ACCTACGT', qualities: [40, 40, 5, 40, 40, 40, 40, 40] },
      { bases: 'ACCTACGT', qualities: [40, 40, 35, 40, 40, 40, 40, 40] },
    ]);
    const r = differenceRegions(both.differences);
    const context = { classes: null, confidentFrom: 20, pickedRow: 0, reviewed: new Set<number>() };
    expect(filterRegions(both, r, { ...NO_FILTER, goodQuality: true }, context)).toEqual([0]);
    expect(
      filterRegions(both, r, { ...NO_FILTER, goodQuality: true, pickedOnly: true }, context),
    ).toEqual([]);
  });
});

describe('narrows', () => {
  it('says whether anything beyond reviewed is filtered', () => {
    expect(narrows(DEFAULT_FILTER, true)).toBe(false);
    expect(narrows({ ...NO_FILTER, goodQuality: true }, false)).toBe(true);
    expect(narrows({ ...NO_FILTER, where: 'cds' }, false)).toBe(true);
    expect(narrows({ ...NO_FILTER, pickedOnly: true }, false)).toBe(false);
    expect(narrows({ ...NO_FILTER, pickedOnly: true }, true)).toBe(true);
  });
});

describe('counterText', () => {
  it('counts every difference, the passing ones, or the stop among them', () => {
    expect(counterText(41, 41, null)).toBe('41 differences');
    expect(counterText(1, 1, null)).toBe('1 difference');
    expect(counterText(12, 41, null)).toBe('12 of 41 differences');
    expect(counterText(12, 41, 2)).toBe('3 of 12');
  });
});
