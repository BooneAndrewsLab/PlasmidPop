import { CircularLayout, layoutLabels, tickInterval } from './circularLayout';

const opts = { width: 600, height: 400, laneCount: 2, ringWidth: 14, outerMargin: 60 };

describe('CircularLayout', () => {
  const layout = new CircularLayout(1000, 'circular', opts);

  it('centres the circle and sizes it to the smaller dimension', () => {
    expect(layout.cx).toBe(300);
    expect(layout.cy).toBe(200);
    expect(layout.radius).toBe(140);
  });

  it('maps positions to angles clockwise from the top and back', () => {
    expect(layout.angleOf(0)).toBeCloseTo(-Math.PI / 2);
    expect(layout.angleOf(250)).toBeCloseTo(0);
    expect(layout.angleOf(500)).toBeCloseTo(Math.PI / 2);
    for (const p of [0, 1, 250, 499, 999]) expect(layout.positionOf(layout.angleOf(p))).toBe(p);
    expect(layout.positionOf(layout.angleOf(1000))).toBe(0);
    const top = layout.pointAt(0, 100);
    expect(top.x).toBeCloseTo(300);
    expect(top.y).toBeCloseTo(100);
  });

  it('hit-tests the backbone and lanes', () => {
    const onBackbone = layout.pointAt(250, layout.radius + 3);
    expect(layout.hitTest(onBackbone.x, onBackbone.y)).toEqual({ kind: 'backbone', position: 250 });
    const lane1 = layout.pointAt(750, layout.laneRadius(1));
    expect(layout.hitTest(lane1.x, lane1.y)).toEqual({ kind: 'lane', lane: 1, position: 750 });
    expect(layout.hitTest(300, 200)).toEqual({ kind: 'none' });
    expect(layout.hitTest(0, 0)).toEqual({ kind: 'none' });
  });

  it('grows the radius when many lanes need room', () => {
    const crowded = new CircularLayout(1000, 'circular', { ...opts, laneCount: 12 });
    expect(crowded.radius).toBeGreaterThan(140);
    expect(new CircularLayout(0, 'circular', opts).angleOf(5)).toBeCloseTo(-Math.PI / 2);
    expect(new CircularLayout(0, 'circular', opts).positionOf(1)).toBe(0);
  });
});

describe('tickInterval', () => {
  it('keeps the tick count reasonable', () => {
    expect(tickInterval(100)).toBe(10);
    expect(tickInterval(2686)).toBe(200);
    expect(tickInterval(4361)).toBe(500);
    expect(tickInterval(48502)).toBe(5000);
    expect(tickInterval(5_000_000)).toBe(1_000_000);
  });
});

describe('layoutLabels', () => {
  const layout = new CircularLayout(1000, 'circular', opts);

  it('separates overlapping labels on the same side and keeps them on canvas', () => {
    const labels = [0.1, 0.12, 0.14, 0.16].map((angle, i) => ({
      id: `l${i}`,
      text: `f${i}`,
      angle,
      textWidth: 20,
    }));
    const placed = layoutLabels(labels, layout, 170, 14, 400);
    const ys = placed.map((l) => l.y).sort((a, b) => a - b);
    for (let i = 1; i < ys.length; i++)
      expect((ys[i] ?? 0) - (ys[i - 1] ?? 0)).toBeGreaterThanOrEqual(14 - 1e-9);
    for (const l of placed) {
      expect(l.align).toBe('left');
      expect(l.y).toBeGreaterThanOrEqual(7);
      expect(l.y).toBeLessThanOrEqual(393);
    }
  });

  it('aligns labels on the left half to the right', () => {
    const [l] = layoutLabels(
      [{ id: 'a', text: 'a', angle: Math.PI, textWidth: 10 }],
      layout,
      170,
      14,
      400,
    );
    expect(l?.align).toBe('right');
    expect(l?.x).toBeLessThan(layout.cx);
  });

  it('pushes a stack that runs off the bottom back up', () => {
    const labels = Array.from({ length: 10 }, (_, i) => ({
      id: `${i}`,
      text: 't',
      angle: Math.PI / 2 - 0.01 * i,
      textWidth: 10,
    }));
    const placed = layoutLabels(labels, layout, 170, 20, 400);
    expect(Math.max(...placed.map((l) => l.y))).toBeLessThanOrEqual(390);
    expect(Math.min(...placed.map((l) => l.y))).toBeGreaterThanOrEqual(10);
  });
});
