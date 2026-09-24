import { createFeature, rangeSegment } from '@/core';

import { drawableFeatures, featuresToLabel } from './visibleFeatures';

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
