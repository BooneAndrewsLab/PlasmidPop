import { type Feature, type Topology, createFeature, rangeSegment, siteSegment } from '@/core';

import {
  type JoinGap,
  gapAtLane,
  gapChipText,
  gapCovers,
  gapNote,
  gapPieces,
  gapWord,
  joinGaps,
} from './joinGaps';

/** The first gap of `f`, which the test knows it has. */
const firstGap = (f: Feature, seqLength: number, topology: Topology): JoinGap => {
  const gap = joinGaps(f, seqLength, topology)[0];
  if (gap === undefined) throw new Error('no gap');
  return gap;
};

const feature = (
  init: Partial<Pick<Feature, 'id' | 'type' | 'name' | 'strand' | 'joining'>> & {
    readonly segments: Feature['segments'];
  },
): Feature => createFeature({ type: 'CDS', name: 'INS', ...init });

describe('joinGaps', () => {
  // INS (NG_050578.1:4991-6441): join(249..435,1223..1368), 0-based [248, 435) and [1222, 1368).
  const ins = feature({ segments: [rangeSegment(248, 435), rangeSegment(1222, 1368)] });

  it('finds the stretch between two consecutive segments, as boundaries on the forward strand', () => {
    expect(joinGaps(ins, 1500, 'linear')).toEqual([
      { index: 0, end: 435, start: 1222, length: 787 },
    ]);
  });

  it('is the same on the reverse strand: the bases between the pieces do not move', () => {
    const reverse = feature({
      strand: 'reverse',
      segments: [rangeSegment(248, 435), rangeSegment(1222, 1368)],
    });
    expect(joinGaps(reverse, 1500, 'linear')).toEqual(joinGaps(ins, 1500, 'linear'));
  });

  it('finds one gap per pair of a join of many pieces', () => {
    const three = feature({
      segments: [rangeSegment(0, 10), rangeSegment(20, 30), rangeSegment(30, 40)],
    });
    expect(joinGaps(three, 100, 'linear')).toEqual([
      { index: 0, end: 10, start: 20, length: 10 },
      { index: 1, end: 30, start: 30, length: 0 },
    ]);
  });

  it('reports touching segments as a gap of no bases and overlapping ones as a negative gap', () => {
    const slip = feature({ segments: [rangeSegment(0, 10), rangeSegment(7, 20)] });
    expect(joinGaps(slip, 100, 'linear')).toEqual([{ index: 0, end: 10, start: 7, length: -3 }]);
    expect(gapPieces({ index: 0, end: 10, start: 7, length: -3 }, 100)).toEqual([]);
    expect(gapPieces({ index: 0, end: 10, start: 10, length: 0 }, 100)).toEqual([]);
  });

  it('has none for a single segment or an order(...)', () => {
    expect(joinGaps(feature({ segments: [rangeSegment(0, 10)] }), 100, 'linear')).toEqual([]);
    const order = feature({
      joining: 'order',
      segments: [rangeSegment(0, 10), rangeSegment(20, 30)],
    });
    expect(joinGaps(order, 100, 'linear')).toEqual([]);
  });

  it('skips site segments', () => {
    const withSite = feature({
      segments: [rangeSegment(0, 10), siteSegment(15), rangeSegment(20, 30)],
    });
    expect(joinGaps(withSite, 100, 'linear')).toEqual([
      { index: 0, end: 10, start: 20, length: 10 },
    ]);
  });

  describe('on a circular sequence', () => {
    it('wraps a gap across the origin when the later segment starts before the earlier one', () => {
      // join(901..990,11..100) on a 1000 bp circle: the gap is 991..1000 and 1..10.
      const f = feature({ segments: [rangeSegment(900, 990), rangeSegment(10, 100)] });
      const gaps = joinGaps(f, 1000, 'circular');
      expect(gaps).toEqual([{ index: 0, end: 990, start: 10, length: 20 }]);
      expect(gapPieces(firstGap(f, 1000, 'circular'), 1000)).toEqual([
        { start: 990, end: 1000 },
        { start: 0, end: 10 },
      ]);
    });

    it('lets the pieces touch across the origin', () => {
      const f = feature({ segments: [rangeSegment(900, 1000), rangeSegment(0, 100)] });
      expect(joinGaps(f, 1000, 'circular')).toEqual([{ index: 0, end: 1000, start: 0, length: 0 }]);
    });

    it('starts a gap at base 1 when the earlier segment ends at the sequence end', () => {
      const f = feature({ segments: [rangeSegment(900, 1000), rangeSegment(10, 100)] });
      const gaps = joinGaps(f, 1000, 'circular');
      expect(gaps).toEqual([{ index: 0, end: 1000, start: 10, length: 10 }]);
      expect(gapPieces(firstGap(f, 1000, 'circular'), 1000)).toEqual([{ start: 0, end: 10 }]);
    });

    it('folds the end of an earlier segment that itself wraps', () => {
      // join(901..50,61..100): the first piece is [900, 1050) unrolled.
      const f = feature({ segments: [rangeSegment(900, 1050), rangeSegment(60, 100)] });
      expect(joinGaps(f, 1000, 'circular')).toEqual([{ index: 0, end: 50, start: 60, length: 10 }]);
    });

    it('still tells an overlap from a wrap: a later segment starting inside the earlier one overlaps it', () => {
      const slip = feature({ segments: [rangeSegment(100, 500), rangeSegment(498, 900)] });
      expect(joinGaps(slip, 1000, 'circular')).toEqual([
        { index: 0, end: 500, start: 498, length: -2 },
      ]);
    });
  });
});

describe('gap labels', () => {
  const ins = feature({ segments: [rangeSegment(248, 435), rangeSegment(1222, 1368)] });
  const gap = firstGap(ins, 1500, 'linear');

  it('names the chip with 1-based inclusive bases and the length', () => {
    expect(gapChipText(gap, ins, 1500)).toBe('intron 436-1222 · 787 bp');
  });

  it('calls a one-base gap by its one position', () => {
    const f = feature({
      type: 'misc_feature',
      segments: [rangeSegment(0, 10), rangeSegment(11, 20)],
    });
    expect(gapChipText(firstGap(f, 100, 'linear'), f, 100)).toBe('gap 11 · 1 bp');
  });

  it('calls the stretch an intron only for spliced types', () => {
    const segments = [rangeSegment(0, 10)];
    expect(gapWord(feature({ segments }))).toBe('intron');
    expect(gapWord(feature({ type: 'mRNA', segments }))).toBe('intron');
    expect(gapWord(feature({ type: 'tRNA', segments }))).toBe('intron');
    expect(gapWord(feature({ type: 'misc_feature', segments }))).toBe('gap');
    expect(gapWord(feature({ type: 'primer_bind', segments }))).toBe('gap');
  });

  it('folds the bases of a gap across the origin the way the app writes a wrapped range', () => {
    const f = feature({ segments: [rangeSegment(900, 990), rangeSegment(10, 100)] });
    expect(gapChipText(firstGap(f, 1000, 'circular'), f, 1000)).toBe('intron 991-10 · 20 bp');
    const atEnd = feature({ segments: [rangeSegment(900, 1000), rangeSegment(10, 100)] });
    expect(gapChipText(firstGap(atEnd, 1000, 'circular'), atEnd, 1000)).toBe('intron 1-10 · 10 bp');
    const toEnd = feature({ segments: [rangeSegment(900, 990), rangeSegment(0, 100)] });
    expect(gapChipText(firstGap(toEnd, 1000, 'circular'), toEnd, 1000)).toBe(
      'intron 991-1000 · 10 bp',
    );
  });

  it('words the tooltip with where the feature goes on, by strand', () => {
    expect(gapNote(gap, ins, 1500)).toBe(
      'INS: intron 436-1222, 787 bp. The exons are joined; the feature continues at 1223.',
    );
    const reverse = feature({
      strand: 'reverse',
      segments: [rangeSegment(248, 435), rangeSegment(1222, 1368)],
    });
    expect(gapNote(firstGap(reverse, 1500, 'linear'), reverse, 1500)).toBe(
      'INS: intron 436-1222, 787 bp. The exons are joined; the feature continues at 435.',
    );
  });

  it('says so when the pieces touch or overlap, calling them pieces outside a spliced type', () => {
    const touch = feature({
      type: 'misc_feature',
      name: '',
      segments: [rangeSegment(0, 10), rangeSegment(10, 20)],
    });
    expect(gapNote(firstGap(touch, 100, 'linear'), touch, 100)).toBe(
      'misc_feature: the pieces ending at 10 and starting at 11 touch, with nothing between them.',
    );
    const slip = feature({ segments: [rangeSegment(0, 10), rangeSegment(7, 20)] });
    expect(gapNote(firstGap(slip, 100, 'linear'), slip, 100)).toBe(
      'INS: the exons ending at 10 and starting at 8 overlap by 3 bp.',
    );
  });
});

describe('gapAtLane', () => {
  const ins = feature({ id: 'ins', segments: [rangeSegment(248, 435), rangeSegment(1222, 1368)] });
  const other = feature({ id: 'o', type: 'misc_feature', segments: [rangeSegment(500, 600)] });
  const laneOf = new Map([
    ['ins', 0],
    ['o', 1],
  ]);

  it('finds the gap of the feature in that lane under the position', () => {
    const hit = gapAtLane([other, ins], laneOf, 0, 800, 1500, 'linear');
    expect(hit?.feature.id).toBe('ins');
    expect(hit?.gap.length).toBe(787);
  });

  it('finds nothing in another lane, over a piece, or outside the gap', () => {
    expect(gapAtLane([other, ins], laneOf, 1, 800, 1500, 'linear')).toBeUndefined();
    expect(gapAtLane([other, ins], laneOf, 0, 300, 1500, 'linear')).toBeUndefined();
    expect(gapAtLane([other, ins], laneOf, 0, 1400, 1500, 'linear')).toBeUndefined();
  });

  it('covers a gap that wraps the origin on both sides of it', () => {
    const f = feature({ id: 'w', segments: [rangeSegment(900, 990), rangeSegment(10, 100)] });
    const gap = firstGap(f, 1000, 'circular');
    expect(gapCovers(gap, 995, 1000)).toBe(true);
    expect(gapCovers(gap, 5, 1000)).toBe(true);
    expect(gapCovers(gap, 10, 1000)).toBe(false);
    expect(gapCovers(gap, 989, 1000)).toBe(false);
  });
});
