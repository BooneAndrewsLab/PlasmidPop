import { alignPairwise } from './pairwise';
import { columnQualities, readDifferences, trimByQuality } from './quality';

describe('trimByQuality', () => {
  it('cuts poor ends and keeps the good middle', () => {
    const q = [5, 8, 10, 30, 35, 40, 40, 38, 30, 12, 6, 4];
    expect(trimByQuality(q)).toEqual({ start: 3, end: 9 });
  });

  it('keeps all of a read of uniform good quality', () => {
    expect(trimByQuality(new Array<number>(50).fill(40))).toEqual({ start: 0, end: 50 });
  });

  it('keeps nothing of a read with no base better than the cutoff', () => {
    expect(trimByQuality([2, 5, 8, 10, 5])).toEqual({ start: 0, end: 0 });
    expect(trimByQuality([])).toEqual({ start: 0, end: 0 });
  });

  it('bridges a short dip rather than cutting the read in two', () => {
    // One Q8 base (error 0.16) costs less than the good bases either side earn.
    const q = [...new Array<number>(20).fill(40), 8, ...new Array<number>(20).fill(40)];
    expect(trimByQuality(q)).toEqual({ start: 0, end: 41 });
  });

  it('is the highest-scoring stretch, by brute force', () => {
    let x = 7;
    for (let run = 0; run < 30; run++) {
      const q = Array.from({ length: 25 }, () => {
        x = (x * 1103515245 + 12345) & 0x7fffffff;
        return (x >> 16) % 45;
      });
      const score = (s: number, e: number) =>
        q.slice(s, e).reduce((sum, v) => sum + 0.05 - 10 ** (-v / 10), 0);
      let best = 0;
      for (let s = 0; s < q.length; s++)
        for (let e = s + 1; e <= q.length; e++) best = Math.max(best, score(s, e));
      const { start, end } = trimByQuality(q);
      expect(end > start ? score(start, end) : 0).toBeCloseTo(best, 9);
    }
  });
});

describe('read differences', () => {
  it('names each difference and the read quality under it', () => {
    // The read has C for the reference's G at 6 (a poor base there) and an
    // extra T in the TT at 11–12, placed before 11: either place is as good.
    const alignment = alignPairwise('ACGTACGTACGTACGT', 'ACGTACCTACGTTACGT');
    const q = Array.from({ length: 17 }, (_, i) => (i === 6 ? 12 : 40));
    const cols = columnQualities(alignment, q);
    const diffs = readDifferences(alignment, cols);
    expect(diffs.map((d) => [d.kind, d.positionA, d.confident])).toEqual([
      ['mismatch', 6, false],
      ['insertion', 11, true],
    ]);
  });

  it('gives a base missing from the read the lower quality of its neighbours', () => {
    const alignment = alignPairwise('AAAACCCCGGGGTTTT', 'AAAACCCGGGGTTTT');
    const q = Array.from({ length: 15 }, (_, i) => (i === 7 ? 15 : 40));
    const diffs = readDifferences(alignment, columnQualities(alignment, q));
    expect(diffs).toHaveLength(1);
    expect(diffs[0]?.kind).toBe('deletion');
    expect(diffs[0]?.quality).toBeLessThanOrEqual(40);
  });

  it('counts from where a local alignment starts in the read', () => {
    const alignment = alignPairwise('GGGGACGTACGTGGGG', 'TTACGTACGTTT', { mode: 'local' });
    expect(alignment.startB).toBe(2);
    const q = [1, 1, 30, 31, 32, 33, 34, 35, 36, 37, 1, 1];
    expect(columnQualities(alignment, q)).toEqual([30, 31, 32, 33, 34, 35, 36, 37]);
  });
});
