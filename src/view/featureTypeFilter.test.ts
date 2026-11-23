import { type Feature, createFeature } from '@/core';

import {
  TYPE_FILTER_MIN_FEATURES,
  countTypes,
  emptyFilterText,
  filterByType,
  foldChips,
  offersTypeFilter,
  toggleType,
  typeChips,
} from './featureTypeFilter';

const feature = (id: string, type: string): Feature =>
  createFeature({
    id,
    type,
    name: id,
    segments: [{ kind: 'range', start: 0, end: 10, partialStart: false, partialEnd: false }],
  });

/** source, then a gene, an mRNA and a CDS for each of `genes`. */
const record = (genes: number): Feature[] => [
  feature('src', 'source'),
  ...Array.from({ length: genes }, (_, i) => [
    feature(`g${String(i)}`, 'gene'),
    feature(`m${String(i)}`, 'mRNA'),
    feature(`c${String(i)}`, 'CDS'),
  ]).flat(),
];

describe('countTypes', () => {
  it('counts the features of each type', () => {
    expect([...countTypes(record(3))]).toEqual([
      ['source', 1],
      ['gene', 3],
      ['mRNA', 3],
      ['CDS', 3],
    ]);
    expect(countTypes([]).size).toBe(0);
  });
});

describe('typeChips', () => {
  it('offers each type the list has, sorted as Format ▸ Feature types sorts them', () => {
    expect(typeChips(countTypes(record(3)), [])).toEqual([
      { type: 'CDS', count: 3, on: false },
      { type: 'gene', count: 3, on: false },
      { type: 'mRNA', count: 3, on: false },
      { type: 'source', count: 1, on: false },
    ]);
  });

  it('marks the chosen types', () => {
    const chips = typeChips(countTypes(record(3)), ['CDS', 'mRNA']);
    expect(chips.filter((c) => c.on).map((c) => c.type)).toEqual(['CDS', 'mRNA']);
  });

  it('keeps a chosen type the list has lost, at zero', () => {
    const chips = typeChips(countTypes([feature('a', 'gene')]), ['exon']);
    expect(chips).toEqual([
      { type: 'exon', count: 0, on: true },
      { type: 'gene', count: 1, on: false },
    ]);
  });
});

describe('foldChips', () => {
  const chips = (counts: readonly number[], on: readonly number[] = []) =>
    counts.map((count, i) => ({
      type: `t${String(i).padStart(2, '0')}`,
      count,
      on: on.includes(i),
    }));
  const types = (shown: readonly { readonly type: string }[]): string[] => shown.map((c) => c.type);

  it('shows every chip up to one over the limit', () => {
    const eight = chips([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(foldChips(eight)).toEqual({ shown: eight, folded: 0 });
    const nine = chips([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(foldChips(nine)).toEqual({ shown: nine, folded: 0 });
    const four = chips([1, 2, 3, 4]);
    expect(foldChips(four, 3)).toEqual({ shown: four, folded: 0 });
  });

  it('keeps the types with the most features, in the order given, and counts the rest', () => {
    const { shown, folded } = foldChips(chips([5, 1, 9, 2, 7, 3]), 3);
    expect(types(shown)).toEqual(['t00', 't02', 't04']);
    expect(folded).toBe(3);
  });

  it('gives a tie to the earlier chip', () => {
    const { shown, folded } = foldChips(chips([4, 4, 4, 4, 4]), 2);
    expect(types(shown)).toEqual(['t00', 't01']);
    expect(folded).toBe(3);
  });

  it('never folds a chip that is on', () => {
    const { shown, folded } = foldChips(chips([5, 1, 9, 2, 7, 3], [1, 5]), 3);
    expect(types(shown)).toEqual(['t00', 't01', 't02', 't04', 't05']);
    expect(folded).toBe(1);
  });

  it('folds at eight unless told otherwise', () => {
    const { shown, folded } = foldChips(chips(Array.from({ length: 15 }, (_, i) => 15 - i)));
    expect(shown).toHaveLength(8);
    expect(folded).toBe(7);
  });
});

describe('offersTypeFilter', () => {
  it('needs two types and a list of the minimum length', () => {
    expect(TYPE_FILTER_MIN_FEATURES).toBe(8);
    // source, gene, mRNA, CDS: four rows, all in sight.
    expect(offersTypeFilter(countTypes(record(1)), [])).toBe(false);
    // Seven rows of three types and a source: one short.
    expect(offersTypeFilter(countTypes(record(2)), [])).toBe(false);
    expect(offersTypeFilter(countTypes(record(2).concat(feature('x', 'exon'))), [])).toBe(true);
    expect(offersTypeFilter(countTypes(record(3)), [])).toBe(true);
  });

  it('is not offered for a long list of one type', () => {
    const same = Array.from({ length: 40 }, (_, i) => feature(`f${String(i)}`, 'misc_feature'));
    expect(offersTypeFilter(countTypes(same), [])).toBe(false);
  });

  it('stays while a filter is set, however short the list has become', () => {
    expect(offersTypeFilter(countTypes([feature('a', 'gene')]), ['CDS'])).toBe(true);
    expect(offersTypeFilter(countTypes([]), ['CDS'])).toBe(true);
  });
});

describe('toggleType', () => {
  it('adds a type that is off and takes out one that is on', () => {
    expect(toggleType([], 'gene')).toEqual(['gene']);
    expect(toggleType(['gene'], 'CDS')).toEqual(['CDS', 'gene']);
    expect(toggleType(['CDS', 'gene'], 'gene')).toEqual(['CDS']);
    expect(toggleType(['CDS'], 'CDS')).toEqual([]);
  });

  it('leaves what it was given alone', () => {
    const chosen = ['gene'] as const;
    toggleType(chosen, 'CDS');
    expect(chosen).toEqual(['gene']);
  });
});

describe('filterByType', () => {
  const features = record(3);

  it('is every feature, the same array, when nothing is chosen', () => {
    expect(filterByType(features, [])).toBe(features);
  });

  it('is the features of the chosen types, in the order they were in', () => {
    expect(filterByType(features, ['CDS']).map((f) => f.id)).toEqual(['c0', 'c1', 'c2']);
    expect(filterByType(features, ['CDS', 'gene']).map((f) => f.id)).toEqual([
      'g0',
      'c0',
      'g1',
      'c1',
      'g2',
      'c2',
    ]);
  });

  it('is empty when no feature is of a chosen type', () => {
    expect(filterByType(features, ['exon'])).toEqual([]);
  });

  it('keeps a feature it was told to, whatever its type, where it was', () => {
    expect(filterByType(features, ['CDS'], new Set(['m1'])).map((f) => f.id)).toEqual([
      'c0',
      'm1',
      'c1',
      'c2',
    ]);
  });

  it('does not change the features it was given', () => {
    const before = [...features];
    filterByType(features, ['gene']);
    expect(features).toEqual(before);
  });
});

describe('emptyFilterText', () => {
  it('names the types the filter is set to', () => {
    expect(emptyFilterText(['CDS'])).toBe('No CDS features in this list.');
    expect(emptyFilterText(['gene', 'CDS'])).toBe('No CDS or gene features in this list.');
    expect(emptyFilterText(['mRNA', 'gene', 'CDS'])).toBe(
      'No CDS, gene or mRNA features in this list.',
    );
  });
});
