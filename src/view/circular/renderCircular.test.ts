import { SeqDocument } from '@/core';

import { NO_LANES } from '../linear/lanes';
import { type OverlaySpan, overlayLanes } from '../overlay';
import { PRINT_THEME } from '../svg/exportMap';
import { SvgContext } from '../svg/svgContext';
import { CircularLayout } from './circularLayout';
import { renderCircularMap, selectionSweep } from './renderCircular';

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

describe('renderCircularMap preview', () => {
  const doc = SeqDocument.create({ sequence: 'ACGT'.repeat(1000), topology: 'circular' });
  const preview: OverlaySpan[] = [
    {
      id: 'product',
      label: 'Product 800 bp',
      // Unrolled past the end: this product is the piece over the origin.
      range: { start: 3800, end: 4600 },
      strand: 'none',
      shape: 'span',
    },
    {
      id: 'forward',
      label: 'Fwd 1',
      range: { start: 100, end: 122 },
      strand: 'forward',
      shape: 'arrow',
    },
  ];

  const draw = (overlay: readonly OverlaySpan[]): string => {
    const layout = new CircularLayout(doc.length, doc.topology, opts);
    const ctx = new SvgContext(600, 600);
    renderCircularMap(ctx, {
      doc,
      layout,
      lanes: NO_LANES,
      selection: null,
      cutSites: [],
      overlay,
      overlayLanes: overlayLanes(overlay, doc.length),
      hoveredFeatureId: null,
      hoveredCut: null,
      width: 600,
      height: 600,
      devicePixelRatio: 1,
      theme: { ...PRINT_THEME, preview: '#6b4fd8' },
      sansFont: '12px sans-serif',
      titleFont: '15px sans-serif',
    });
    return ctx.toSvg();
  };

  it('draws the bracket dashed and the primer solid, in the preview colour', () => {
    const svg = draw(preview);
    const previewPaths = [...svg.matchAll(/<path[^>]*stroke="#6b4fd8"[^>]*\/>/g)].map((m) => m[0]);
    // The bracket, its two end ticks, the primer arc: all in the preview colour.
    expect(previewPaths.length).toBeGreaterThanOrEqual(4);
    // The bracket is dashed, in two arcs because it runs over the origin;
    // the primer's own arc is solid.
    const dashed = previewPaths.filter((path) => path.includes('stroke-dasharray'));
    expect(dashed).toHaveLength(2);
    expect(previewPaths.length - dashed.length).toBeGreaterThanOrEqual(2);
    // The primer's arrowhead is a filled triangle rather than a stroke.
    expect(svg).toContain('fill="#6b4fd8"');
  });

  it('widens a primer that would be a fraction of a degree', () => {
    // 4 bases of 4,000 is a tenth of a degree, under 2px of arc; it is drawn
    // at least 7px long anyway, as a short selection is.
    const layout = new CircularLayout(doc.length, doc.topology, opts);
    const sweep = selectionSweep(layout.angleOf(100), layout.angleOf(104), layout.radius - 6, 7);
    expect(sweep.widened).toBe(true);
  });

  it('draws nothing of its own when there is no preview', () => {
    expect(draw([])).not.toContain('#6b4fd8');
  });
});
