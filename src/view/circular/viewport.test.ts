import {
  type ViewportBounds,
  FIT_VIEWPORT,
  clampViewport,
  fitRange,
  maxZoomFor,
  panBy,
  zoomAround,
} from './viewport';

const bounds: ViewportBounds = { width: 600, height: 400, baseRadius: 140, maxZoom: 20 };

describe('maxZoomFor', () => {
  it('stops at a few pixels per base and never below 1', () => {
    expect(maxZoomFor(1000, 100)).toBeCloseTo(3000 / (2 * Math.PI * 100));
    expect(maxZoomFor(10, 100)).toBe(1);
    expect(maxZoomFor(0, 100)).toBe(1);
    expect(maxZoomFor(10_000_000, 100)).toBe(400);
  });
});

describe('clampViewport', () => {
  it('snaps to the fitted view at or below zoom 1', () => {
    expect(clampViewport({ zoom: 0.5, panX: 30, panY: 0 }, bounds)).toBe(FIT_VIEWPORT);
    expect(clampViewport({ zoom: 1, panX: 30, panY: 0 }, bounds)).toBe(FIT_VIEWPORT);
  });

  it('caps the zoom and keeps the ring on the canvas', () => {
    const v = clampViewport({ zoom: 50, panX: 1e6, panY: -1e6 }, bounds);
    expect(v.zoom).toBe(20);
    const radius = 140 * 20;
    expect(v.panX).toBe(300 + radius - 8);
    expect(v.panY).toBe(-(200 + radius - 8));
  });
});

describe('zoomAround', () => {
  /** Map coordinates (relative to the circle, in backbone radii) of a canvas point. */
  const mapPoint = (v: { zoom: number; panX: number; panY: number }, x: number, y: number) => {
    const r = bounds.baseRadius * v.zoom;
    return { u: (x - (300 + v.panX)) / r, w: (y - (200 + v.panY)) / r };
  };

  it('keeps the point under the cursor fixed', () => {
    const start = { zoom: 2, panX: 40, panY: -30 };
    const before = mapPoint(start, 450, 120);
    const after = zoomAround(start, bounds, 450, 120, 1.5);
    expect(after.zoom).toBeCloseTo(3);
    const now = mapPoint(after, 450, 120);
    expect(now.u).toBeCloseTo(before.u);
    expect(now.w).toBeCloseTo(before.w);
  });

  it('returns to the centred view when zooming all the way out', () => {
    expect(zoomAround({ zoom: 1.2, panX: 50, panY: 50 }, bounds, 10, 10, 0.5)).toBe(FIT_VIEWPORT);
  });

  it('does not pan when the zoom is already at its limit', () => {
    const v = { zoom: 20, panX: 100, panY: 100 };
    expect(zoomAround(v, bounds, 0, 0, 2)).toEqual(v);
  });
});

describe('panBy', () => {
  it('moves the centre and clamps it', () => {
    const v = panBy({ zoom: 2, panX: 0, panY: 0 }, bounds, 25, -10);
    expect(v).toEqual({ zoom: 2, panX: 25, panY: -10 });
    expect(panBy(v, bounds, 5000, 0).panX).toBe(300 + 280 - 8);
    expect(panBy(FIT_VIEWPORT, bounds, 50, 50)).toBe(FIT_VIEWPORT);
  });
});

describe('fitRange', () => {
  const canvasPoint = (
    v: { zoom: number; panX: number; panY: number },
    position: number,
    seqLength: number,
  ) => {
    const a = -Math.PI / 2 + (2 * Math.PI * position) / seqLength;
    const r = bounds.baseRadius * v.zoom;
    return { x: 300 + v.panX + r * Math.cos(a), y: 200 + v.panY + r * Math.sin(a) };
  };

  it('zooms in on a short arc and centres it', () => {
    const v = fitRange(bounds, 100, 200, 1000, 40);
    expect(v.zoom).toBeGreaterThan(1);
    expect(v.zoom).toBeLessThanOrEqual(20);
    for (const pos of [100, 150, 200]) {
      const { x, y } = canvasPoint(v, pos, 1000);
      expect(x).toBeGreaterThanOrEqual(40 - 1e-6);
      expect(x).toBeLessThanOrEqual(560 + 1e-6);
      expect(y).toBeGreaterThanOrEqual(40 - 1e-6);
      expect(y).toBeLessThanOrEqual(360 + 1e-6);
    }
    const a = canvasPoint(v, 100, 1000);
    const b = canvasPoint(v, 200, 1000);
    expect((a.x + b.x) / 2).toBeCloseTo(300, 0);
  });

  it('handles a range across the origin', () => {
    const v = fitRange(bounds, 950, 1050, 1000, 40);
    expect(v.zoom).toBeGreaterThan(1);
    const top = canvasPoint(v, 0, 1000);
    expect(top.x).toBeCloseTo(300, 0);
    expect(top.y).toBeGreaterThan(40);
  });

  it('shows the whole circle for the full sequence and empty ranges', () => {
    expect(fitRange(bounds, 0, 1000, 1000, 40)).toBe(FIT_VIEWPORT);
    expect(fitRange(bounds, 300, 1400, 1000, 40)).toBe(FIT_VIEWPORT);
    // With the pad equal to the fit margin, more than half the circle
    // spans the full canvas width and cannot be enlarged.
    expect(fitRange(bounds, 0, 600, 1000, 60)).toBe(FIT_VIEWPORT);
    expect(fitRange(bounds, 5, 5, 1000, 40)).toBe(FIT_VIEWPORT);
    expect(fitRange(bounds, 0, 10, 0, 40)).toBe(FIT_VIEWPORT);
  });

  it('caps at the maximum zoom for tiny ranges', () => {
    expect(fitRange(bounds, 10, 11, 1000, 40).zoom).toBe(20);
  });
});
