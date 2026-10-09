import { describe, expect, it } from 'vitest';

import { callColumn, columnPosterior, iupacOf } from './consensus';

const v = (base: string, quality: number) => ({ base, quality });

describe('callColumn', () => {
  it('calls the base the reads agree on, surer with more of them', () => {
    const one = callColumn([v('A', 20)]);
    const three = callColumn([v('A', 20), v('A', 20), v('A', 20)]);
    expect(one.symbol).toBe('A');
    expect(three.symbol).toBe('A');
    expect(three.quality).toBeGreaterThan(one.quality);
    expect(three.ambiguous).toBe(false);
  });

  it('lets a high-quality base outweigh a poor one', () => {
    const c = callColumn([v('A', 40), v('G', 8)]);
    expect(c).toMatchObject({ symbol: 'A', ambiguous: false });
    // ... and several poor ones do not outvote one good one.
    expect(callColumn([v('A', 40), v('G', 5), v('G', 5)]).symbol).toBe('A');
  });

  it('gives an ambiguity code where equally good reads disagree', () => {
    expect(callColumn([v('A', 35), v('G', 35)])).toMatchObject({ symbol: 'R', ambiguous: true });
    expect(callColumn([v('C', 35), v('T', 35)]).symbol).toBe('Y');
    expect(callColumn([v('A', 30), v('C', 30), v('T', 30)]).symbol).toBe('H');
  });

  it('drops a column the reads mostly have a gap in, and keeps one they mostly have a base in', () => {
    expect(callColumn([v('-', 30), v('-', 30), v('A', 30)]).symbol).toBe('');
    expect(callColumn([v('A', 30), v('A', 30), v('-', 30)]).symbol).toBe('A');
  });

  it('ignores reads that say N and says N when no read says anything', () => {
    expect(callColumn([v('N', 40), v('C', 30)]).symbol).toBe('C');
    expect(callColumn([v('N', 40)])).toEqual({ symbol: 'N', quality: 0, ambiguous: false });
    expect(callColumn([])).toEqual({ symbol: 'N', quality: 0, ambiguous: false });
  });

  it('keeps a quality of 0 from ruling a base out', () => {
    expect(callColumn([v('A', 0), v('A', 30)]).symbol).toBe('A');
    // ... though one such read alone is too unsure to call a base.
    expect(callColumn([v('A', 0)]).symbol).toBe('N');
  });
});

describe('callColumn ties and gaps', () => {
  it('breaks a tie between symbols in favour of the lower index: A, C, G, T, then the gap', () => {
    // Five equally good votes leave every symbol at 0.2: A comes first, so the
    // column is not called a gap, and the four bases together make an N.
    const all = callColumn(['A', 'C', 'G', 'T', '-'].map((b) => v(b, 30)));
    expect(all.symbol).toBe('N');
    expect(all.ambiguous).toBe(true);
  });

  it('gives a quality and no ambiguity to a column called as a gap', () => {
    const gap = callColumn([v('-', 30), v('-', 30), v('A', 30)]);
    expect(gap.symbol).toBe('');
    expect(gap.ambiguous).toBe(false);
    expect(gap.quality).toBeGreaterThan(0);
  });

  it('does not count a gap among the runners-up as a second base', () => {
    // A and a gap tie at about 0.48 each: the gap is left out of the call.
    const c = callColumn([v('A', 10), v('-', 10)]);
    expect(c.symbol).toBe('A');
    expect(c.ambiguous).toBe(false);
    expect(c.quality).toBe(3);
  });
});

describe('columnPosterior', () => {
  it('is null when no vote names a symbol', () => {
    expect(columnPosterior([])).toBeNull();
    expect(columnPosterior([v('N', 30)])).toBeNull();
  });

  it('gives one value for each of A, C, G, T and the gap, summing to 1', () => {
    const post = columnPosterior([v('A', 20)]);
    expect(post).toHaveLength(5);
    expect(post?.[0]).toBeCloseTo(0.99, 6);
    for (const k of [1, 2, 3, 4]) expect(post?.[k]).toBeCloseTo(0.0025, 6);
    expect(post?.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 12);
  });

  it('does not underflow where many reads split evenly', () => {
    const votes = [
      ...Array.from({ length: 100 }, () => v('A', 60)),
      ...Array.from({ length: 100 }, () => v('C', 60)),
    ];
    const post = columnPosterior(votes);
    expect(post?.[0]).toBeCloseTo(0.5, 9);
    expect(post?.[1]).toBeCloseTo(0.5, 9);
    expect(callColumn(votes)).toMatchObject({ symbol: 'M', ambiguous: true });
  });

  it('stays finite when very many confident reads pile up', () => {
    const post = columnPosterior(Array.from({ length: 200 }, () => v('G', 60)));
    expect(post?.[2]).toBeCloseTo(1, 12);
    expect(post?.every((x) => Number.isFinite(x))).toBe(true);
  });
});

describe('iupacOf', () => {
  it('says N for a set that has no code', () => {
    expect(iupacOf([])).toBe('N');
    expect(iupacOf(['A', '-'])).toBe('N');
  });

  it('names every set of bases, in any order', () => {
    expect(iupacOf(['T', 'G'])).toBe('K');
    expect(iupacOf(['G', 'C', 'A'])).toBe('V');
    expect(iupacOf(['A', 'C', 'G', 'T'])).toBe('N');
    expect(iupacOf(['A', 'A'])).toBe('A');
  });
});
