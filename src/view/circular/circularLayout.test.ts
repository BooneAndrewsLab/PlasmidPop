import {
  type LabelBox,
  type LabelInput,
  type PlacedLabel,
  CircularLayout,
  layoutLabels,
  tickInterval,
} from './circularLayout';

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

  it('scales the radius and shifts the centre with a viewport', () => {
    const zoomed = new CircularLayout(1000, 'circular', {
      ...opts,
      viewport: { zoom: 3, panX: -50, panY: 20 },
    });
    expect(zoomed.baseRadius).toBe(140);
    expect(zoomed.radius).toBe(420);
    expect(zoomed.cx).toBe(250);
    expect(zoomed.cy).toBe(220);
    expect(zoomed.zoom).toBe(3);
    expect(zoomed.bounds).toMatchObject({ width: 600, height: 400, baseRadius: 140 });
    expect(zoomed.bounds.maxZoom).toBeCloseTo(3000 / (2 * Math.PI * 140));
    const onBackbone = zoomed.pointAt(100, zoomed.radius - 2);
    expect(zoomed.hitTest(onBackbone.x, onBackbone.y)).toEqual({ kind: 'backbone', position: 100 });
    expect(zoomed.isOnCanvas(-10, 50)).toBe(false);
    expect(zoomed.isOnCanvas(-10, 50, 20)).toBe(true);
    expect(layout.viewport).toEqual({ zoom: 1, panX: 0, panY: 0 });
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
  const radius = layout.radius + 34;
  const base = { labelRadius: radius, lineHeight: 14, width: 600, height: 400 };
  const ring = (l: PlacedLabel): number => Math.hypot(l.anchorX - layout.cx, l.anchorY - layout.cy);
  const collisions = (boxes: readonly LabelBox[]): number => {
    let n = 0;
    for (let i = 0; i < boxes.length; i++)
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i];
        const b = boxes[j];
        if (a === undefined || b === undefined) continue;
        if (a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom) n++;
      }
    return n;
  };
  const inputs = (angles: readonly number[], textWidth: number): LabelInput[] =>
    angles.map((angle, i) => ({
      id: `l${i}`,
      text: `f${i}`,
      angle,
      textWidth,
      rank: 100 - i,
    }));

  it('never draws one label over another, or over an obstacle', () => {
    const { placed } = layoutLabels(inputs([0.1, 0.12, 0.14, 0.16], 60), layout, base);
    expect(placed).toHaveLength(4);
    expect(collisions(placed.map((l) => l.box))).toBe(0);
    for (const l of placed) {
      expect(l.align).toBe('left');
      expect(l.box.top).toBeGreaterThanOrEqual(0);
      expect(l.box.bottom).toBeLessThanOrEqual(400);
      expect(l.box.right).toBeLessThanOrEqual(600);
    }
  });

  it('gives way to the ruler numbers, which are placed first and never move', () => {
    const one = inputs([0.1], 60);
    const [free] = layoutLabels(one, layout, base).placed;
    expect(free).toBeDefined();
    const obstacle = {
      left: free?.box.left ?? 0,
      right: (free?.box.right ?? 0) + 20,
      top: free?.box.top ?? 0,
      bottom: free?.box.bottom ?? 0,
    };
    const { placed } = layoutLabels(one, layout, { ...base, obstacles: [obstacle] });
    expect(placed).toHaveLength(1);
    expect(collisions([...placed.map((l) => l.box), obstacle])).toBe(0);
  });

  it('slides a crowded label along the ring instead of across the map', () => {
    // Four wide labels bunched at 12 o'clock, where the ring runs flat: they
    // spread sideways rather than marching down over the features.
    const top = inputs(
      [-0.04, -0.02, 0, 0.02].map((d) => -Math.PI / 2 + d),
      70,
    );
    const { placed, dropped } = layoutLabels(top, layout, base);
    expect(dropped).toHaveLength(0);
    for (const l of placed) {
      // Every anchor is on the label ring: none was pushed inside the circle.
      expect(ring(l)).toBeCloseTo(radius);
      expect(l.y).toBeLessThan(layout.cy - layout.radius);
    }
    const xs = placed.map((l) => l.x).sort((a, b) => a - b);
    expect((xs[xs.length - 1] ?? 0) - (xs[0] ?? 0)).toBeGreaterThan(70);
  });

  it('lets labels that do not overlap horizontally share a line', () => {
    // Along the top of a zoomed-in ring: same y, spread out in x.
    const wide = new CircularLayout(1000, 'circular', {
      ...opts,
      viewport: { zoom: 10, panX: 0, panY: 1400 },
    });
    const labels = inputs(
      [-0.06, -0.04, -0.02].map((d) => -Math.PI / 2 + d),
      14,
    );
    const { placed } = layoutLabels(labels, wide, { ...base, labelRadius: wide.radius + 34 });
    const ys = placed.map((l) => l.y);
    // Untouched: they sit where the ring put them, within a few pixels.
    expect(Math.max(...ys) - Math.min(...ys)).toBeLessThan(5);
    const xs = placed.map((l) => l.x).sort((a, b) => a - b);
    for (let i = 1; i < xs.length; i++) expect((xs[i] ?? 0) - (xs[i - 1] ?? 0)).toBeGreaterThan(18);
  });

  it('aligns labels on the left half to the right', () => {
    const { placed } = layoutLabels(
      [{ id: 'a', text: 'a', angle: Math.PI, textWidth: 10, rank: 1 }],
      layout,
      base,
    );
    const [l] = placed;
    expect(l?.align).toBe('right');
    expect(l?.x).toBeLessThan(layout.cx);
  });

  it('drops the lowest-ranked labels rather than stacking them on each other', () => {
    // Twenty wide labels crowded into one short arc: the ring cannot hold
    // them, so the ones the document cares least about are left out.
    const crowded = Array.from({ length: 20 }, (_, i) => ({
      id: `l${i}`,
      text: `label ${i}`,
      angle: Math.PI / 2 - 0.004 * i,
      textWidth: 90,
      rank: 20 - i,
    }));
    const { placed, dropped } = layoutLabels(crowded, layout, base);
    expect(dropped.length).toBeGreaterThan(0);
    expect(placed.length + dropped.length).toBe(20);
    expect(collisions(placed.map((l) => l.box))).toBe(0);
    // Rank decides, not the order they arrived in or where the canvas ends.
    const worstKept = Math.min(...placed.map((l) => l.rank));
    const bestDropped = Math.max(...dropped.map((l) => l.rank));
    expect(worstKept).toBeGreaterThan(bestDropped);
  });

  it('drops a label that has nowhere on the canvas to go', () => {
    // A label wider than the canvas has no slot anywhere on the ring.
    const { placed, dropped } = layoutLabels(inputs([0.1], 900), layout, base);
    expect(placed).toHaveLength(0);
    expect(dropped).toHaveLength(1);
  });
});
