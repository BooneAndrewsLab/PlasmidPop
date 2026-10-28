import { createFeature, isCodingFeature, rangeSegment, translatedFeatures } from '@/core';

import {
  drawableFeatures,
  drawableTypes,
  featuresToLabel,
  hiddenTypeCount,
  hiddenTypesNote,
} from './visibleFeatures';

const f = (id: string, name: string, start: number, end: number, type = 'misc') =>
  createFeature({ id, type, name, segments: [rangeSegment(start, end)] });

describe('drawableFeatures', () => {
  it('hides source features', () => {
    const list = [f('s', '', 0, 100, 'source'), f('a', 'a', 5, 10)];
    expect(drawableFeatures(list).map((x) => x.id)).toEqual(['a']);
  });

  it('draws a gene once, as its CDS, where the two are the same name on the same bases', () => {
    const list = [
      f('g', 'tet', 85, 1276, 'gene'),
      f('c', 'tet', 85, 1276, 'CDS'),
      // Same bases but its own name: two things, both drawn.
      f('g2', 'bla', 3292, 4153, 'gene'),
      f('c2', 'beta-lactamase', 3292, 4153, 'CDS'),
      // Same name, other bases: a gene longer than its CDS stays.
      f('g3', 'rop', 1900, 2110, 'gene'),
      f('c3', 'rop', 1914, 2106, 'CDS'),
    ];
    expect(drawableFeatures(list).map((x) => x.id)).toEqual(['c', 'g2', 'c2', 'g3', 'c3']);
    // A gene on the other strand from the CDS is not the same thing either.
    const flipped = [
      createFeature({
        id: 'g',
        type: 'gene',
        name: 'x',
        strand: 'reverse',
        segments: [rangeSegment(0, 90)],
      }),
      createFeature({
        id: 'c',
        type: 'CDS',
        name: 'x',
        strand: 'forward',
        segments: [rangeSegment(0, 90)],
      }),
    ];
    expect(drawableFeatures(flipped).map((x) => x.id)).toEqual(['g', 'c']);
  });
});

describe('featuresToLabel', () => {
  it('labels the longest of overlapping same-named features once, others separately', () => {
    const list = [
      f('gene', 'tet', 10, 100),
      f('cds', 'tet', 10, 100),
      f('site', 'tet', 40, 44),
      f('far', 'tet', 150, 160),
      f('anon', '', 0, 5),
      f('bla', 'bla', 120, 140),
    ];
    expect(
      featuresToLabel(list, 200)
        .map((x) => x.id)
        .sort(),
    ).toEqual(['bla', 'far', 'gene']);
  });

  it('treats wrapped features as overlapping across the origin', () => {
    const list = [f('w', 'ori', 180, 210), f('t', 'ori', 0, 5)];
    expect(featuresToLabel(list, 200).map((x) => x.id)).toEqual(['w']);
  });
});

describe('hidden feature types (#305)', () => {
  const list = [
    f('s', '', 0, 100, 'source'),
    f('m', 'tet', 10, 90, 'mRNA'),
    f('c', 'tet', 10, 90, 'CDS'),
    f('g', 'tet', 10, 90, 'gene'),
    f('e', 'x', 20, 30, 'exon'),
  ];
  const ids = (hidden: string[]) => drawableFeatures(list, new Set(hidden)).map((x) => x.id);

  it('draws everything when nothing is hidden', () => {
    expect(drawableFeatures(list, new Set())).toEqual(drawableFeatures(list));
    expect(ids([])).toEqual(['m', 'c', 'e']);
  });

  it('leaves out a hidden type, whatever its place in the list', () => {
    expect(ids(['mRNA', 'exon'])).toEqual(['c']);
    // A type the document does not have is ignored.
    expect(ids(['misc_feature'])).toEqual(['m', 'c', 'e']);
  });

  it('draws the gene once its twin CDS is hidden, since it is no longer a duplicate', () => {
    expect(ids(['CDS'])).toEqual(['m', 'g', 'e']);
  });

  it('offers the types the document has, but never source', () => {
    expect(drawableTypes(list)).toEqual(['CDS', 'exon', 'gene', 'mRNA']);
  });

  it('counts only hidden types the document has', () => {
    expect(hiddenTypeCount(list, new Set())).toBe(0);
    expect(hiddenTypeCount(list, new Set(['exon', 'mRNA', 'misc_feature', 'source']))).toBe(2);
    expect(hiddenTypesNote(1)).toBe('1 type hidden');
    expect(hiddenTypesNote(3)).toBe('3 types hidden');
  });

  it('stops the translations of a hidden CDS, in every translation scope', () => {
    const cds = [
      createFeature({
        id: 'a',
        type: 'CDS',
        name: 'tet',
        segments: [rangeSegment(0, 90)],
        qualifiers: [{ name: 'gene', value: 'tet' }],
      }),
      createFeature({
        id: 'b',
        type: 'CDS',
        name: 'tet',
        segments: [rangeSegment(0, 60)],
        qualifiers: [{ name: 'gene', value: 'tet' }],
      }),
    ];
    const translated = (
      hidden: string[],
      scope: 'all' | 'selected' | 'gene',
      selected: string | null,
    ) =>
      translatedFeatures(
        drawableFeatures(cds, new Set(hidden)).filter(isCodingFeature),
        scope,
        selected,
      ).map((x) => x.id);
    expect(translated([], 'all', null)).toEqual(['a', 'b']);
    expect(translated([], 'gene', null)).toEqual(['a']);
    for (const scope of ['all', 'selected', 'gene'] as const) {
      // Even the selected CDS is not translated while its type is hidden.
      expect(translated(['CDS'], scope, 'a')).toEqual([]);
    }
  });
});
