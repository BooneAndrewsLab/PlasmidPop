import { CircularLayout } from './circularLayout';
import { selectionSweep } from './renderCircular';

const opts = { width: 600, height: 600, laneCount: 2, ringWidth: 14, outerMargin: 60 };

describe('selectionSweep', () => {
  // pBR322-sized plasmid: one base is a thousandth of a turn.
  const layout = new CircularLayout(4361, 'circular', opts);
  const radius = layout.radius + 8;
  const sweepOf = (start: number, end: number) =>
    selectionSweep(layout.angleOf(start), layout.angleOf(end), radius);

  it('leaves a selection that is already wide enough alone', () => {
    const wide = sweepOf(100, 900);
    expect(wide.widened).toBe(false);
    expect(wide.start).toBeCloseTo(layout.angleOf(100));
    expect(wide.end).toBeCloseTo(layout.angleOf(900));
  });

  it('widens a 2 bp selection about its centre to a visible arc', () => {
    const tiny = sweepOf(140, 142);
    expect(tiny.widened).toBe(true);
    const span = tiny.end - tiny.start;
    expect(span * radius).toBeCloseTo(7);
    expect((tiny.start + tiny.end) / 2).toBeCloseTo(layout.angleOf(141));
  });

  it('widens a 1 bp selection too, however small the radius', () => {
    const one = selectionSweep(0, 2 * Math.PI * 1e-4, 20);
    expect(one.widened).toBe(true);
    expect((one.end - one.start) * 20).toBeCloseTo(7);
    // Never more than the whole circle, however tight the radius.
    const cramped = selectionSweep(0, 1e-6, 1);
    expect(cramped.end - cramped.start).toBeLessThanOrEqual(Math.PI * 2);
  });

  it('treats a selection that crosses the origin as the long way round', () => {
    const wrapped = sweepOf(4300, 60);
    expect(wrapped.widened).toBe(false);
    expect(wrapped.start).toBeCloseTo(layout.angleOf(4300));
    expect(wrapped.end).toBeCloseTo(layout.angleOf(60));
  });

  it('keeps the drawn arc inside the sequence when it is widened at the origin', () => {
    const atOrigin = sweepOf(0, 1);
    expect(atOrigin.widened).toBe(true);
    expect((atOrigin.start + atOrigin.end) / 2).toBeCloseTo(layout.angleOf(0.5));
  });
});
