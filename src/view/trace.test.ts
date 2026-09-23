import { type SequencingRead } from '@/core';

import { type DrawingContext } from './drawingContext';
import { drawTrace, traceScale } from './trace';

/** Records each stroked path as the points it went through, by colour. */
function recorder() {
  const strokes: { color: string; points: [number, number][] }[] = [];
  const rects: { x: number; y: number; w: number; h: number }[] = [];
  let points: [number, number][] = [];
  const ctx = {
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    lineCap: 'butt',
    font: '',
    textAlign: 'left',
    textBaseline: 'alphabetic',
    save: () => undefined,
    restore: () => undefined,
    setTransform: () => undefined,
    translate: () => undefined,
    beginPath() {
      points = [];
    },
    closePath: () => undefined,
    moveTo(x: number, y: number) {
      points.push([x, y]);
    },
    lineTo(x: number, y: number) {
      points.push([x, y]);
    },
    arc: () => undefined,
    fill: () => undefined,
    stroke() {
      strokes.push({ color: ctx.strokeStyle, points });
    },
    setLineDash: () => undefined,
    fillRect(x: number, y: number, w: number, h: number) {
      rects.push({ x, y, w, h });
    },
    fillText: () => undefined,
    measureText: () => ({ width: 0 }),
  };
  return { ctx: ctx as unknown as DrawingContext, strokes, rects };
}

/** Four bases A C G T with peaks at uneven places, each a spike in its own channel. */
function read(): SequencingRead {
  const length = 40;
  const peaks = [4, 12, 17, 31];
  const channels = {
    A: new Int16Array(length),
    C: new Int16Array(length),
    G: new Int16Array(length),
    T: new Int16Array(length),
  };
  (['A', 'C', 'G', 'T'] as const).forEach((b, k) => {
    channels[b][peaks[k] ?? 0] = 1000;
  });
  return {
    qualities: Uint8Array.from([60, 30, 15, 0]),
    trace: { channels, peaks: Int32Array.from(peaks) },
  };
}

const colors = { a: 'green', c: 'blue', g: 'black', t: 'red', quality: 'grey' };

describe('drawTrace (#52)', () => {
  const bases = [0, 1, 2, 3].map((index) => ({ index, x: 100 + index * 10 }));

  it('puts each base’s peak over its letter, however unevenly the peaks are spaced', () => {
    const { ctx, strokes } = recorder();
    drawTrace(ctx, { read: read(), bases, top: 0, height: 50, charWidth: 10, colors });
    expect(strokes.map((s) => s.color)).toEqual(['green', 'blue', 'black', 'red']);
    for (const [k, stroke] of strokes.entries()) {
      // The highest point (smallest y) of each channel is its base's centre.
      const top = stroke.points.reduce((best, p) => (p[1] < best[1] ? p : best));
      expect(top[0]).toBeCloseTo(100 + k * 10, 6);
    }
  });

  it('spans half a base beyond the first and the last', () => {
    const { ctx, strokes } = recorder();
    drawTrace(ctx, { read: read(), bases, top: 0, height: 50, charWidth: 10, colors });
    const xs = (strokes[0]?.points ?? []).map((p) => p[0]);
    expect(Math.min(...xs)).toBeCloseTo(95, 6);
    expect(Math.max(...xs)).toBeCloseTo(135, 6);
  });

  it('draws the qualities behind, Q60 at full height, none for Q0', () => {
    const { ctx, rects } = recorder();
    drawTrace(ctx, { read: read(), bases, top: 0, height: 60, charWidth: 10, colors });
    expect(rects.map((r) => Math.round(r.h))).toEqual([60, 30, 15]);
  });

  it('stretches the trace across a gap in the read', () => {
    // Base 2 is a column further on, as after a gap in an alignment.
    const gapped = [
      { index: 0, x: 100 },
      { index: 1, x: 110 },
      { index: 2, x: 130 },
      { index: 3, x: 140 },
    ];
    const { ctx, strokes } = recorder();
    drawTrace(ctx, { read: read(), bases: gapped, top: 0, height: 50, charWidth: 10, colors });
    const g = strokes[2]?.points ?? [];
    expect(g.reduce((best, p) => (p[1] < best[1] ? p : best))[0]).toBeCloseTo(130, 6);
  });

  it('draws nothing without a trace or without bases', () => {
    const { ctx, strokes, rects } = recorder();
    drawTrace(ctx, {
      read: { ...read(), trace: null },
      bases,
      top: 0,
      height: 50,
      charWidth: 10,
      colors,
    });
    drawTrace(ctx, { read: read(), bases: [], top: 0, height: 50, charWidth: 10, colors });
    expect(strokes).toEqual([]);
    expect(rects).toEqual([]);
  });

  it('scales to the tall peaks, not to one outlier', () => {
    const r = read();
    const trace = r.trace;
    if (trace === null) throw new Error('trace');
    const long = new Int16Array(10_000).fill(500);
    long[5000] = 30_000;
    const scale = traceScale({
      channels: { A: long, C: long, G: long, T: long },
      peaks: trace.peaks,
    });
    expect(scale).toBe(500);
  });
});
