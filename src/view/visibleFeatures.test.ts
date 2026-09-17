import { createFeature, rangeSegment } from '@/core';

import { drawableFeatures, featuresToLabel } from './visibleFeatures';

const f = (id: string, name: string, start: number, end: number, type = 'misc') =>
  createFeature({ id, type, name, segments: [rangeSegment(start, end)] });

describe('drawableFeatures', () => {
  it('hides source features', () => {
    const list = [f('s', '', 0, 100, 'source'), f('a', 'a', 5, 10)];
    expect(drawableFeatures(list).map((x) => x.id)).toEqual(['a']);
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
