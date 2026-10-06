import { SeqDocument, createFeature, rangeSegment } from '@/core';

import { exportMapSvg } from './exportMap';

/**
 * The circular map as exported (SVG, so every point can be read back): a
 * feature's arc starts and ends where the feature does, however it crosses
 * the origin, with its arrow head at the end it points to, and the ruler's
 * ticks sit at the positions they are labelled with and no others.
 * Positions are read back from the angle of each point around the centre.
 */

const SIZE = 900;
const CENTRE = SIZE / 2;
const COLOR = '#123456';

/** The 0-based position (fractional) of a point on the map, of a sequence of `n`. */
function positionAt(n: number, x: number, y: number): number {
  const turns = (Math.atan2(y - CENTRE, x - CENTRE) + Math.PI / 2) / (2 * Math.PI);
  return (turns - Math.floor(turns)) * n;
}

/** Clockwise distance from `from` to `to` on a circle of `n`. */
const clockwise = (n: number, from: number, to: number): number => (((to - from) % n) + n) % n;

interface Arc {
  readonly start: number;
  readonly end: number;
  readonly large: number;
  readonly sweep: number;
}

function featureArcs(svg: string, n: number): Arc[] {
  const arcs: Arc[] = [];
  const re =
    /<path d="M(-?[\d.]+) (-?[\d.]+) A[-\d.]+ [-\d.]+ 0 (\d) (\d) (-?[\d.]+) (-?[\d.]+)[^"]*" fill="none" stroke="#123456"/g;
  for (const m of svg.matchAll(re)) {
    arcs.push({
      start: positionAt(n, Number(m[1]), Number(m[2])),
      end: positionAt(n, Number(m[5]), Number(m[6])),
      large: Number(m[3]),
      sweep: Number(m[4]),
    });
  }
  return arcs;
}

/** The corner of each arrow head (a filled triangle) furthest from the others: its tip. */
function arrowTips(svg: string, n: number): number[] {
  const tips: number[] = [];
  const re = /<path d="([^"]*)" fill="#123456" stroke="none"/g;
  for (const m of svg.matchAll(re)) {
    const points = [...(m[1] ?? '').matchAll(/[ML](-?[\d.]+) (-?[\d.]+)/g)].map((q) =>
      positionAt(n, Number(q[1]), Number(q[2])),
    );
    // Two corners share a position (the base of the head); the odd one out is the tip.
    const a = points[0] ?? 0;
    const b = points[1] ?? 0;
    const c = points[2] ?? 0;
    const near = (x: number, y: number): boolean =>
      Math.min(clockwise(n, x, y), clockwise(n, y, x)) < 0.05;
    tips.push(near(a, b) ? c : near(a, c) ? b : a);
  }
  return tips;
}

function render(
  n: number,
  features: readonly { start: number; end: number; strand: 'forward' | 'reverse' }[],
): string {
  const doc = SeqDocument.create({
    sequence: 'ACGT'.repeat(Math.ceil(n / 4)).slice(0, n),
    topology: 'circular',
    features: features.map((f, i) =>
      createFeature({
        id: `f${String(i)}`,
        type: 'misc_feature',
        name: `F${String(i)}`,
        strand: f.strand,
        segments: [rangeSegment(f.start, f.end)],
        qualifiers: [
          { name: 'ApEinfo_fwdcolor', value: COLOR },
          { name: 'ApEinfo_revcolor', value: COLOR },
        ],
      }),
    ),
  });
  return exportMapSvg(doc, { size: SIZE });
}

describe('circular map export: feature arcs', () => {
  const N = 1000;
  const cases = [
    { name: 'forward', start: 100, end: 300, strand: 'forward' },
    { name: 'reverse', start: 100, end: 300, strand: 'reverse' },
    { name: 'forward across the origin', start: 900, end: 1100, strand: 'forward' },
    { name: 'reverse across the origin', start: 900, end: 1100, strand: 'reverse' },
    { name: 'forward ending at the origin', start: 950, end: 1000, strand: 'forward' },
    { name: 'whole circle', start: 0, end: 1000, strand: 'forward' },
    { name: 'whole circle from the middle', start: 400, end: 1400, strand: 'reverse' },
    { name: 'from the origin', start: 0, end: 200, strand: 'forward' },
    { name: 'reverse to the origin', start: 800, end: 1000, strand: 'reverse' },
  ] as const;

  it.each(cases)('$name: one arc from start to end, arrow at the end it points to', (c) => {
    const svg = render(N, [c]);
    const arcs = featureArcs(svg, N);
    const tips = arrowTips(svg, N);
    expect(arcs).toHaveLength(1);
    expect(tips).toHaveLength(1);
    const arc = arcs[0];
    const tip = tips[0];
    if (arc === undefined || tip === undefined) return;
    const length = c.end - c.start;
    // Where the arrow points: the end of a forward feature, the start of a reverse one.
    const pointsTo = (c.strand === 'forward' ? c.end : c.start) % N;
    const tail = (c.strand === 'forward' ? c.start : c.end) % N;
    expect(Math.min(clockwise(N, pointsTo, tip), clockwise(N, tip, pointsTo))).toBeLessThan(0.6);
    // The arc runs clockwise and stops short of the tip by the arrow head only.
    expect(arc.sweep).toBe(1);
    const head = c.strand === 'forward' ? clockwise(N, arc.end, tip) : clockwise(N, tip, arc.start);
    expect(head).toBeGreaterThan(0);
    expect(head).toBeLessThan(15);
    const span = clockwise(N, arc.start, arc.end);
    expect(span).toBeCloseTo(length - head, 0);
    expect(arc.large).toBe(span > N / 2 ? 1 : 0);
    // The other end is exactly where the feature is.
    const tailAt = c.strand === 'forward' ? arc.start : arc.end;
    expect(Math.min(clockwise(N, tail, tailAt), clockwise(N, tailAt, tail))).toBeLessThan(0.6);
  });

  it('draws a one-base feature as a short arc over that base', () => {
    const arcs = featureArcs(render(N, [{ start: 500, end: 501, strand: 'forward' }]), N);
    expect(arcs).toHaveLength(1);
    const arc = arcs[0];
    expect(arc?.start).toBeLessThanOrEqual(500.5);
    expect(arc?.end).toBeGreaterThanOrEqual(500.5);
    expect(clockwise(N, arc?.start ?? 0, arc?.end ?? 0)).toBeLessThan(3);
  });
});

describe('circular map export: ruler ticks', () => {
  // The spacing that leaves at most 16 ticks of 10, 20, 25, 50, 100, 200, 250, 500, ...
  const spacing: readonly (readonly [number, number])[] = [
    [1, 10],
    [2, 10],
    [9, 10],
    [10, 10],
    [11, 10],
    [12, 10],
    [160, 10],
    [161, 20],
    [999, 100],
    [1000, 100],
    [1001, 100],
    [4361, 500],
    [50_000, 5000],
    [50_001, 5000],
  ];
  it.each(spacing)(
    'labels the ticks of a circle of %i bases every %i where they are',
    (n, step) => {
      const doc = SeqDocument.create({
        sequence: 'ACGT'.repeat(Math.ceil(n / 4)).slice(0, n),
        topology: 'circular',
      });
      const svg = exportMapSvg(doc);
      const ticks = [
        ...svg.matchAll(/<text x="(-?[\d.]+)" y="(-?[\d.]+)"[^>]*>([\d,]+)<\/text>/g),
      ].map((m) => ({
        label: Number((m[3] ?? '').replaceAll(',', '')),
        position: positionAt(n, Number(m[1]), Number(m[2])),
      }));
      // The first base is labelled 1 at the origin; then every step, short of the origin again.
      const expected = [1];
      for (let v = step; v < n; v += step) expected.push(v);
      expect(ticks.map((t) => t.label)).toEqual(expected);
      const tolerance = Math.max(0.5, n * 1e-4);
      for (const t of ticks) {
        const at = t.label === 1 ? 0 : t.label;
        expect(
          Math.min(clockwise(n, at, t.position), clockwise(n, t.position, at)),
          `tick ${String(t.label)}`,
        ).toBeLessThan(tolerance);
      }
    },
  );
});
