import { describe, expect, it } from 'vitest';

import { type Range, range } from '../range';
import { randomInt, seededRandom } from '@/test/random';
import { OverlapIndex } from './overlapIndex';

interface Item {
  readonly range: Range;
}

const overlaps = (a: Range, b: Range, n: number): boolean => {
  // On a circle, a range past the origin is its two pieces.
  const pieces = (r: Range): Range[] =>
    r.end <= n ? [r] : [range(r.start, n), range(0, r.end - n)];
  return pieces(a).some((p) => pieces(b).some((q) => p.start < q.end && q.start < p.end));
};

describe('OverlapIndex (#288)', () => {
  it.each(['linear', 'circular'] as const)(
    'finds exactly what a scan of every item finds, %s',
    (topology) => {
      const n = 10_000;
      const r = seededRandom(288);
      const item = (): Item => {
        const start = randomInt(r, 0, n);
        const size = randomInt(r, 1, 1501);
        const end = topology === 'circular' ? start + size : Math.min(n, start + size);
        return { range: range(start, end) };
      };
      const index = new OverlapIndex<Item>(n, topology);
      const items: Item[] = [];
      for (let i = 0; i < 300; i++) {
        const probe = item();
        const scan = items.some((k) => overlaps(k.range, probe.range, n));
        const asked: Item[] = [];
        const found = index.some(probe.range, (k) => {
          asked.push(k);
          return overlaps(k.range, probe.range, n);
        });
        expect(found).toBe(scan);
        // Nothing is asked twice, though an item spans several buckets.
        expect(new Set(asked).size).toBe(asked.length);
        index.add(probe);
        items.push(probe);
      }
    },
  );

  it('asks only the items near the query', () => {
    const index = new OverlapIndex<Item>(1_000_000, 'linear');
    for (let i = 0; i < 1000; i++) index.add({ range: range(i * 1000, i * 1000 + 10) });
    let asked = 0;
    index.some(range(500_000, 500_010), () => {
      asked++;
      return false;
    });
    expect(asked).toBeLessThan(5);
  });
});
