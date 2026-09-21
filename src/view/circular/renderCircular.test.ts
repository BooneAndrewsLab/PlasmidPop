import { SeqDocument, createFeature } from '@/core';
import { parseGenBank } from '@/io/genbank';
import { readFixture } from '@/test/fixtures';

import { NO_LANES, assignLanes } from '../linear/lanes';
import { type OverlaySpan, NO_OVERLAY, overlayLanes } from '../overlay';
import { PRINT_THEME } from '../svg/exportMap';
import { drawableFeatures } from '../visibleFeatures';
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

describe('renderCircularMap labels', () => {
  const crowded = SeqDocument.create({
    sequence: 'ACGT'.repeat(1000),
    topology: 'circular',
    features: Array.from({ length: 24 }, (_, i) =>
      createFeature({
        id: `f${i}`,
        type: 'misc_feature',
        name: `${i} a rather long feature name`,
        segments: [
          {
            kind: 'range',
            start: i * 160,
            end: i * 160 + 120,
            partialStart: false,
            partialEnd: false,
          },
        ],
      }),
    ),
  });

  const draw = (hoveredFeatureId: string | null, size = 600): string => {
    const features = crowded.features.all();
    const lanes = assignLanes(features, crowded.length);
    const layout = new CircularLayout(crowded.length, crowded.topology, {
      ...opts,
      width: size,
      height: size,
      laneCount: lanes.laneCount,
    });
    const ctx = new SvgContext(size, size);
    renderCircularMap(ctx, {
      doc: crowded,
      layout,
      lanes,
      selection: null,
      cutSites: [],
      overlay: NO_OVERLAY,
      overlayLanes: NO_LANES,
      hoveredFeatureId,
      hoveredCut: null,
      width: size,
      height: size,
      devicePixelRatio: 1,
      theme: PRINT_THEME,
      sansFont: '12px Helvetica, Arial, sans-serif',
      titleFont: '600 15px Helvetica, Arial, sans-serif',
    });
    return ctx.toSvg();
  };

  it('says how many labels it had no room for', () => {
    const svg = draw(null, 420);
    const count = /\+(\d+) labels? not shown/.exec(svg);
    expect(count).not.toBeNull();
    expect(Number(count?.[1] ?? 0)).toBeGreaterThan(0);
  });

  it('brings back the hovered label the ring had no room for', () => {
    const size = 420;
    const plain = draw(null, size);
    // A name may be shortened with an ellipsis, so it is the number each one
    // starts with that says whether the label is on the map at all.
    const shown = (svg: string, i: number): boolean => new RegExp(`>${i} a rather`).test(svg);
    const missing = crowded.features.all().findIndex((_, i) => !shown(plain, i));
    expect(missing).toBeGreaterThanOrEqual(0);
    expect(shown(draw(`f${missing}`, size), missing)).toBe(true);
  });

  it('draws the hovered label in an outlined bubble', () => {
    const plain = draw(null);
    const hovered = draw('f0');
    // The bubble is the one path stroked in the ink colour, with the 4 px
    // corners and the tail that a leader line does not have.
    const inkPaths = (svg: string): string[] =>
      [...svg.matchAll(/<path[^>]*stroke="#1c2430"[^>]*\/>/g)].map((m) => m[0]);
    expect(inkPaths(plain)).toHaveLength(0);
    const bubble = inkPaths(hovered).find((path) => path.includes('A4 4'));
    expect(bubble).toBeDefined();
    expect(bubble).toContain('fill="none"');
  });

  it('leaves every other label where it was when one is hovered', () => {
    // Ranking the hovered label first would let it take the slot nearest its
    // anchor and shuffle its neighbours, so labels swapped places as the
    // pointer moved between two features.
    const texts = (svg: string): string[] =>
      [...svg.matchAll(/<text x="([^"]*)" y="([^"]*)"[^>]*>([^<]*)<\/text>/g)]
        .map((m) => `${m[3] ?? ''}@${m[1] ?? ''},${m[2] ?? ''}`)
        .sort();
    const plain = texts(draw(null));
    const hovered = texts(draw('f0'));
    const moved = plain.filter((t) => !t.startsWith('0 a rather') && !hovered.includes(t));
    expect(moved).toEqual([]);
  });

  it('highlights the label a same-named feature already has, rather than a second copy', () => {
    // pBR322 carries gene bla, CDS beta-lactamase and mat_peptide
    // beta-lactamase; featuresToLabel collapses the last two into one label,
    // so the mat_peptide has no label of its own to highlight.
    const doc = parseGenBank(readFixture('J01749.gb')).documents[0];
    if (doc === undefined) throw new Error('fixture');
    const features = drawableFeatures(doc.features.all());
    const lanes = assignLanes(features, doc.length);
    const render = (hoveredFeatureId: string | null): string => {
      const layout = new CircularLayout(doc.length, doc.topology, {
        width: 700,
        height: 700,
        laneCount: lanes.laneCount,
        ringWidth: 14,
        outerMargin: 110,
      });
      const ctx = new SvgContext(700, 700);
      renderCircularMap(ctx, {
        doc,
        layout,
        lanes,
        selection: null,
        cutSites: [],
        overlay: NO_OVERLAY,
        overlayLanes: NO_LANES,
        hoveredFeatureId,
        hoveredCut: null,
        width: 700,
        height: 700,
        devicePixelRatio: 1,
        theme: PRINT_THEME,
        sansFont: '12px Helvetica, Arial, sans-serif',
        titleFont: '600 15px Helvetica, Arial, sans-serif',
      });
      return ctx.toSvg();
    };
    const collapsed = features.find((f) => f.type === 'mat_peptide' && f.name === 'beta-lactamase');
    expect(collapsed).toBeDefined();
    const svg = render(collapsed?.id ?? null);
    expect([...svg.matchAll(/>beta-lactamase</g)]).toHaveLength(1);
    // ... and its leader is the highlighted one, drawn in ink rather than
    // in the leader colour.
    expect(svg).toContain(`stroke="${PRINT_THEME.ink}"`);
    expect(render(null)).not.toContain(`stroke="${PRINT_THEME.ink}"`);
  });
});
