import { CircularLayout, tickInterval } from './circularLayout';

/**
 * Properties of the circular map's geometry over many lengths, including the
 * ones that are awkward for a circle (1, 2 and 3 bases, primes, a few
 * million): every position maps to an angle and back to itself, a point on
 * the backbone hit-tests to the position it was made at, and the ruler's
 * tick spacing keeps the ticks at most 16 and as close as the steps allow.
 */

const options = { width: 600, height: 600, laneCount: 1, ringWidth: 14, outerMargin: 60 };

let seed = 20261006;
/** A seeded uniform number in [0, 1). */
function rnd(): number {
  seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
  return seed / 4294967296;
}

describe('CircularLayout angle mapping', () => {
  it.each([1, 2, 3, 10, 997, 4361, 100_000, 5_000_000, 10_000_019])(
    'positionOf(angleOf(p)) is p, and the backbone hits p, for length %i',
    (n) => {
      const layout = new CircularLayout(n, 'circular', options);
      const positions =
        n < 20_000
          ? Array.from({ length: n }, (_, i) => i)
          : [
              0,
              1,
              2,
              n - 3,
              n - 2,
              n - 1,
              ...Array.from({ length: 5000 }, () => Math.floor(rnd() * n)),
            ];
      const problems: string[] = [];
      for (const p of positions) {
        const back = layout.positionOf(layout.angleOf(p));
        if (back !== p) problems.push(`positionOf(angleOf(${String(p)})) = ${String(back)}`);
        const at = layout.pointAt(p, layout.radius);
        const hit = layout.hitTest(at.x, at.y);
        if (hit.kind !== 'backbone' || hit.position !== p) {
          problems.push(`backbone hit at ${String(p)}: ${JSON.stringify(hit)}`);
        }
        if (problems.length > 5) break;
      }
      expect(problems).toEqual([]);
      // The end of the sequence is the start of the circle.
      expect(layout.positionOf(layout.angleOf(n))).toBe(0);
    },
  );

  it('puts position 0 at the top and runs clockwise', () => {
    const layout = new CircularLayout(1000, 'circular', options);
    expect(layout.angleOf(0)).toBeCloseTo(-Math.PI / 2, 12);
    for (let p = 0; p < 999; p++) expect(layout.angleOf(p + 1)).toBeGreaterThan(layout.angleOf(p));
  });
});

describe('tickInterval', () => {
  it('keeps at most 16 ticks, with the smallest step that does', () => {
    const steps = [
      10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000, 2500, 5000, 10_000, 20_000, 25_000, 50_000,
      100_000,
    ];
    const problems: string[] = [];
    const lengths = [
      ...Array.from({ length: 400 }, (_, i) => i + 1),
      999,
      1000,
      1001,
      4361,
      50_000,
      50_001,
      160_000,
      1_000_000,
      16_000_001,
    ];
    for (const n of lengths) {
      const step = tickInterval(n);
      if (n / step > 16)
        problems.push(`${String(n)}: step ${String(step)} gives ${String(n / step)} ticks`);
      const smaller = steps.filter((s) => s < step).pop();
      if (smaller !== undefined && n / smaller <= 16) {
        problems.push(`${String(n)}: step ${String(smaller)} would do, got ${String(step)}`);
      }
    }
    expect(problems).toEqual([]);
  });

  it('admits proportionally more ticks when zoomed in', () => {
    expect(tickInterval(10_000, 32)).toBeLessThanOrEqual(tickInterval(10_000, 16));
  });
});
