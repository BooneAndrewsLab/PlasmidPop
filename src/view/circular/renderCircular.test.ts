import { type DocumentDiff, EMPTY_DIFF, SeqDocument, createFeature, rangeSegment } from '@/core';
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
      edits: null,
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
      edits: null,
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

  it('reports where each drawn label is and what it names, for the pointer to find', () => {
    const features = crowded.features.all();
    const lanes = assignLanes(features, crowded.length);
    const layout = new CircularLayout(crowded.length, crowded.topology, {
      ...opts,
      laneCount: lanes.laneCount,
    });
    const ctx = new SvgContext(600, 600);
    const { labels, droppedLabels } = renderCircularMap(ctx, {
      doc: crowded,
      layout,
      lanes,
      selection: null,
      cutSites: [{ enzyme: 'EcoRI', cut: 99, cutBottom: 103, siteStart: 98, strand: 'forward' }],
      overlay: NO_OVERLAY,
      overlayLanes: NO_LANES,
      edits: null,
      hoveredFeatureId: null,
      hoveredCut: null,
      width: 600,
      height: 600,
      devicePixelRatio: 1,
      theme: PRINT_THEME,
      sansFont: '12px Helvetica, Arial, sans-serif',
      titleFont: '600 15px Helvetica, Arial, sans-serif',
    });
    const named = labels.filter((l) => l.target.kind === 'feature');
    // Every feature is either drawn, with its box, or counted as left out.
    expect(named.length + droppedLabels).toBeGreaterThanOrEqual(features.length);
    const ids = new Set(features.map((f) => f.id));
    for (const { box, target } of labels) {
      expect(box.right).toBeGreaterThan(box.left);
      if (target.kind === 'feature') expect(ids.has(target.featureId)).toBe(true);
    }
    expect(labels.find((l) => l.target.kind === 'cut')?.target).toEqual({
      kind: 'cut',
      position: 99,
    });
  });

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
        edits: null,
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
    // It reaches the arc under the pointer, which is a lane in from the one
    // that owns the label: a leader that stopped at the labelled feature's
    // own lane pointed at the wrong arc.
    const layout = new CircularLayout(doc.length, doc.topology, {
      width: 700,
      height: 700,
      laneCount: lanes.laneCount,
      ringWidth: 14,
      outerMargin: 110,
    });
    // The leader is the ink polyline; the hovered arc's own outline is an
    // arc path, and is stroked in ink too.
    const leader = new RegExp(
      `<path d="M([\\d.]+) ([\\d.]+) L[^"]*" fill="none" stroke="${PRINT_THEME.ink}"`,
    ).exec(svg);
    expect(leader).not.toBeNull();
    const lane = lanes.laneOf.get(collapsed?.id ?? '') ?? 0;
    expect(
      Math.hypot(Number(leader?.[1]) - layout.cx, Number(leader?.[2]) - layout.cy),
    ).toBeCloseTo(layout.laneRadius(lane) + layout.ringWidth / 2, 1);
  });
});

describe('renderCircularMap tracked changes', () => {
  const feature = createFeature({
    id: 'f1',
    type: 'CDS',
    name: 'marker',
    segments: [{ kind: 'range', start: 1000, end: 1600, partialStart: false, partialEnd: false }],
  });
  const doc = SeqDocument.create({
    sequence: 'ACGT'.repeat(1000),
    topology: 'circular',
    features: [feature],
  });
  const lanes = assignLanes(doc.features.all(), doc.length);
  // Colours nothing else on the map uses, so what is drawn in each of them
  // can be told apart from the backbone, the cut sites and the preview.
  const theme = {
    ...PRINT_THEME,
    editInsert: '#00aa00',
    editChange: '#aa8800',
    editDelete: '#ff00ff',
  };
  const layout = new CircularLayout(doc.length, doc.topology, {
    ...opts,
    laneCount: lanes.laneCount,
  });

  const draw = (edits: DocumentDiff | null): string => {
    const ctx = new SvgContext(600, 600);
    renderCircularMap(ctx, {
      doc,
      layout,
      lanes,
      selection: null,
      cutSites: [],
      overlay: NO_OVERLAY,
      overlayLanes: NO_LANES,
      edits,
      hoveredFeatureId: null,
      hoveredCut: null,
      width: 600,
      height: 600,
      devicePixelRatio: 1,
      theme,
      sansFont: '12px sans-serif',
      titleFont: '15px sans-serif',
    });
    return ctx.toSvg();
  };

  /** Every stroked path in one colour, with its arc radius and chord length. */
  const arcs = (svg: string, color: string): { radius: number; chord: number }[] =>
    [...svg.matchAll(new RegExp(`<path d="([^"]*)"[^>]*stroke="${color}"[^>]*/>`, 'g'))]
      .map((m) => {
        const d = m[1] ?? '';
        const from = /^M([\d.-]+) ([\d.-]+)/.exec(d);
        const arc = /A([\d.]+) [\d.]+ 0 \d \d ([\d.-]+) ([\d.-]+)/.exec(d);
        if (from === null || arc === null) return null;
        return {
          radius: Number(arc[1]),
          chord: Math.hypot(Number(arc[2]) - Number(from[1]), Number(arc[3]) - Number(from[2])),
        };
      })
      .filter((a): a is { radius: number; chord: number } => a !== null);

  it('draws inserted and changed stretches as arcs on the backbone', () => {
    const svg = draw({
      ...EMPTY_DIFF,
      marks: [
        { kind: 'inserted', start: 400, end: 440 },
        { kind: 'changed', start: 2000, end: 2080 },
      ],
      basesInserted: 40,
      basesChanged: 80,
    });
    const inserted = arcs(svg, '#00aa00');
    const changed = arcs(svg, '#aa8800');
    expect(inserted).toHaveLength(1);
    expect(changed).toHaveLength(1);
    // On the backbone itself: a stretch of changed bases is a stretch of the
    // molecule, and it is the one radius the lanes, the preview ring and the
    // ruler have all left clear.
    expect(inserted[0]?.radius).toBeCloseTo(layout.radius, 0);
    expect(changed[0]?.radius).toBeCloseTo(layout.radius, 0);
    // 80 bases of 4,000 is twice the arc of 40.
    expect((changed[0]?.chord ?? 0) / (inserted[0]?.chord ?? 1)).toBeCloseTo(2, 1);
  });

  it('widens a one-base insertion so that it can be seen', () => {
    // One base of 4,000 is under half a pixel of arc at this radius.
    const bare = (2 * Math.PI * layout.radius) / doc.length;
    expect(bare).toBeLessThan(1);
    const svg = draw({ ...EMPTY_DIFF, marks: [{ kind: 'inserted', start: 400, end: 401 }] });
    const drawn = arcs(svg, '#00aa00')[0];
    expect(drawn?.chord ?? 0).toBeGreaterThan(6);
  });

  it('marks a deletion at the boundary the bases closed up at', () => {
    const svg = draw({
      ...EMPTY_DIFF,
      deletions: [{ position: 600, count: 12 }],
      basesDeleted: 12,
    });
    // A line across the ring at the join, and a filled wedge inside it: a
    // deletion has no width on the ring, so there is only a place to point at.
    expect(svg).toContain('stroke="#ff00ff"');
    expect(svg).toContain('fill="#ff00ff"');
    const at = layout.pointAt(600, layout.radius);
    const line = new RegExp(
      '<path d="M([\\d.-]+) ([\\d.-]+) L([\\d.-]+) ([\\d.-]+)"[^>]*stroke="#ff00ff"',
    ).exec(svg);
    expect(line).not.toBeNull();
    expect(Math.hypot(Number(line?.[1]) - at.x, Number(line?.[2]) - at.y)).toBeLessThan(8);
  });

  it('outlines a feature that was added or edited, in the colour of the change', () => {
    const added = draw({ ...EMPTY_DIFF, featuresAdded: new Set(['f1']) });
    expect(arcs(added, '#00aa00').length).toBeGreaterThan(0);
    // The outline is on the feature's own lane, not on the backbone.
    expect(arcs(added, '#00aa00')[0]?.radius).toBeLessThan(layout.radius - 10);
    // Moved by hand: the feature covers bases it did not, so a solid line.
    const movedFrom = createFeature({
      ...feature,
      segments: [rangeSegment(1000, 1400)],
    });
    const changed = draw({ ...EMPTY_DIFF, featuresChanged: new Map([['f1', movedFrom]]) });
    const outlines = [...changed.matchAll(/<path[^>]*stroke="#aa8800"[^>]*\/>/g)].map((m) => m[0]);
    expect(outlines.length).toBeGreaterThan(0);
    expect(outlines.every((path) => !path.includes('stroke-dasharray'))).toBe(true);

    // Retyped in place: the same bases under another label, so a broken one.
    const retyped = draw({
      ...EMPTY_DIFF,
      featuresChanged: new Map([['f1', createFeature({ ...feature, type: 'gene' })]]),
    });
    const broken = [...retyped.matchAll(/<path[^>]*stroke="#aa8800"[^>]*\/>/g)].map((m) => m[0]);
    expect(broken.length).toBeGreaterThan(0);
    expect(broken.every((path) => path.includes('stroke-dasharray="3 2"'))).toBe(true);
  });

  it('scales the marks with the type size, as the rest of the ring does', () => {
    // The export draws at twice the screen's type size and more; a mark
    // measured in fixed pixels would come out a hairline on a large figure,
    // which is the bug item 29 found latent in the label ring.
    const strokeWidth = (font: string): number => {
      const ctx = new SvgContext(600, 600);
      renderCircularMap(ctx, {
        doc,
        layout,
        lanes,
        selection: null,
        cutSites: [],
        overlay: NO_OVERLAY,
        overlayLanes: NO_LANES,
        edits: { ...EMPTY_DIFF, marks: [{ kind: 'inserted', start: 400, end: 440 }] },
        hoveredFeatureId: null,
        hoveredCut: null,
        width: 600,
        height: 600,
        devicePixelRatio: 1,
        theme,
        sansFont: font,
        titleFont: font,
      });
      const m = new RegExp(`stroke="#00aa00" stroke-width="([\\d.]+)"`).exec(ctx.toSvg());
      return Number(m?.[1] ?? 0);
    };
    expect(strokeWidth('24px sans-serif')).toBeCloseTo(2 * strokeWidth('12px sans-serif'), 5);
  });

  it('draws nothing of its own when there is nothing to mark', () => {
    const svg = draw(null);
    for (const color of ['#00aa00', '#aa8800', '#ff00ff']) expect(svg).not.toContain(color);
  });
});

describe('renderCircularMap centre title', () => {
  const lanes = { ringWidth: 14, outerMargin: 110, laneCount: 4 };
  const draw = (name: string, size: number): string => {
    const doc = SeqDocument.create({ name, sequence: 'ACGT'.repeat(1090), topology: 'circular' });
    const layout = new CircularLayout(doc.length, doc.topology, {
      ...lanes,
      width: size,
      height: size,
    });
    const ctx = new SvgContext(size, size);
    renderCircularMap(ctx, {
      doc,
      layout,
      lanes: NO_LANES,
      selection: null,
      cutSites: [],
      overlay: NO_OVERLAY,
      overlayLanes: NO_LANES,
      edits: null,
      hoveredFeatureId: null,
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
  /** The title is the one piece of bold text on the map; null when none is drawn. */
  const title = (svg: string): { readonly size: number; readonly text: string } | null => {
    const m = /<text[^>]*font-size="([\d.]+)" font-weight="600"[^>]*>([^<]*)<\/text>/.exec(svg);
    return m === null ? null : { size: Number(m[1]), text: m[2] ?? '' };
  };

  it('keeps a name that fits at full size', () => {
    expect(title(draw('pBR322', 600))).toEqual({ size: 15, text: 'pBR322' });
  });

  it('sets a longer name smaller rather than squeezing it', () => {
    const svg = draw('pLenti-CMV-EGFP1', 500);
    const t = title(svg);
    expect(t?.text).toBe('pLenti-CMV-EGFP1');
    expect(t?.size).toBeLessThan(15);
    expect(t?.size).toBeGreaterThanOrEqual(11);
    expect(svg).not.toContain('textLength');
  });

  it('leaves out a name the floor cannot hold, and never condenses or cuts it', () => {
    // A phone's map pane, or a narrow desktop one, with four lanes of features
    // inside the ring: the room left in the middle is a few characters.
    // "SYNPBR322 copy" was drawn there as a squeezed script; now it is not
    // drawn, since the toolbar has the name and "SYN…" says nothing.
    const svg = draw('SYNPBR322 copy', 390);
    expect(title(svg)).toBeNull();
    expect(svg).not.toContain('SYN');
    expect(svg).not.toContain('textLength');
    // The length is whole or absent too; here it does not fit either.
    expect(svg).not.toContain(' bp<');
  });

  it('gives the length the middle when the name has gone', () => {
    // Two lanes leave room for "4,360 bp" but not for the name.
    const doc = SeqDocument.create({
      name: 'a rather long plasmid name',
      sequence: 'ACGT'.repeat(1090),
      topology: 'circular',
    });
    const layout = new CircularLayout(doc.length, doc.topology, {
      ...lanes,
      laneCount: 2,
      width: 420,
      height: 420,
    });
    const ctx = new SvgContext(420, 420);
    renderCircularMap(ctx, {
      doc,
      layout,
      lanes: NO_LANES,
      selection: null,
      cutSites: [],
      overlay: NO_OVERLAY,
      overlayLanes: NO_LANES,
      edits: null,
      hoveredFeatureId: null,
      hoveredCut: null,
      width: 420,
      height: 420,
      devicePixelRatio: 1,
      theme: PRINT_THEME,
      sansFont: '12px Helvetica, Arial, sans-serif',
      titleFont: '600 15px Helvetica, Arial, sans-serif',
    });
    const svg = ctx.toSvg();
    expect(title(svg)).toBeNull();
    const bp = /<text x="([\d.]+)" y="([\d.]+)"[^>]*>4,360 bp<\/text>/.exec(svg);
    expect(bp).not.toBeNull();
    expect(Number(bp?.[2])).toBeCloseTo(layout.cy, 0);
  });
});

describe('renderCircularMap ends of a linear molecule', () => {
  const draw = (doc: SeqDocument): string => {
    const layout = new CircularLayout(doc.length, doc.topology, opts);
    const ctx = new SvgContext(600, 600);
    renderCircularMap(ctx, {
      doc,
      layout,
      lanes: NO_LANES,
      selection: null,
      cutSites: [],
      overlay: [],
      overlayLanes: NO_LANES,
      edits: null,
      hoveredFeatureId: null,
      hoveredCut: null,
      width: 600,
      height: 600,
      devicePixelRatio: 1,
      theme: PRINT_THEME,
      sansFont: '12px sans-serif',
      titleFont: '15px sans-serif',
    });
    return ctx.toSvg();
  };
  const sequence = `AATT${'GCTAGCTAGC'.repeat(40)}`;

  it('names sticky ends in the middle and marks both tips in the cut-site colour', () => {
    const doc = SeqDocument.create({
      name: 'frag',
      sequence,
      ends: {
        left: { kind: "5'", overhang: 'AATT', enzyme: 'EcoRI' },
        right: { kind: 'blunt', overhang: '', enzyme: 'SmaI' },
      },
    });
    const svg = draw(doc);
    expect(svg).toContain('EcoRI 5′ AATT / SmaI blunt');
    const tips = svg.match(new RegExp(`stroke="${PRINT_THEME.cutSite}"`, 'g')) ?? [];
    expect(tips.length).toBeGreaterThanOrEqual(2);
  });

  it('says nothing about plain ends, or about a circle', () => {
    const plain = draw(SeqDocument.create({ name: 'frag', sequence }));
    expect(plain).not.toContain('blunt');
    expect(plain).not.toContain(`stroke="${PRINT_THEME.cutSite}"`);
  });
});
