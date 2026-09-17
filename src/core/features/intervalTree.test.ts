import { randomInt, seededRandom } from '@/test/random';

import { type Interval, IntervalTree } from './intervalTree';

describe('IntervalTree', () => {
  it('matches brute force on random data', () => {
    const rand = seededRandom(123);
    for (let round = 0; round < 20; round++) {
      const n = randomInt(rand, 0, 200);
      const intervals: Interval<number>[] = [];
      for (let i = 0; i < n; i++) {
        const start = randomInt(rand, 0, 1000);
        intervals.push({ start, end: start + randomInt(rand, 1, 120), value: i });
      }
      const tree = new IntervalTree(intervals);
      for (let q = 0; q < 50; q++) {
        const qs = randomInt(rand, -50, 1100);
        const qe = qs + randomInt(rand, 1, 200);
        const expected = intervals
          .filter((iv) => iv.start < qe && qs < iv.end)
          .map((iv) => iv.value)
          .sort((a, b) => a - b);
        expect(tree.overlapping(qs, qe).sort((a, b) => a - b)).toEqual(expected);
      }
    }
  });

  it('handles many identical intervals', () => {
    const intervals = Array.from({ length: 500 }, (_, i) => ({ start: 10, end: 20, value: i }));
    const tree = new IntervalTree(intervals);
    expect(tree.overlapping(15, 16)).toHaveLength(500);
    expect(tree.overlapping(20, 30)).toHaveLength(0);
    expect(tree.overlapping(0, 10)).toHaveLength(0);
  });

  it('rejects empty intervals and empty queries', () => {
    expect(() => new IntervalTree([{ start: 5, end: 5, value: 1 }])).toThrow(RangeError);
    expect(new IntervalTree([{ start: 0, end: 10, value: 1 }]).overlapping(5, 5)).toEqual([]);
  });
});
