import { SeqDocument, createFeature, rangeSegment } from '@/core';

import { assignLanes } from '../linear/lanes';
import { NO_OVERLAY, overlayLanes } from '../overlay';
import { SvgContext } from '../svg/svgContext';
import { drawableFeatures } from '../visibleFeatures';
import { type RibbonTheme, renderRibbon, ribbonRows } from './renderRibbon';

const theme: RibbonTheme = {
  background: '#fff',
  rulerLine: '#ccc',
  gutterText: '#888',
  selectionFill: 'rgba(0,0,255,0.2)',
  preview: '#6b4fd8',
  editChange: '#a86200',
};

function draw(doc: SeqDocument, extra: Partial<Parameters<typeof renderRibbon>[1]> = {}): string {
  const ctx = new SvgContext(400, 60);
  const features = drawableFeatures(doc.features.all());
  const overlay = extra.overlay ?? NO_OVERLAY;
  renderRibbon(ctx, {
    doc,
    width: 400,
    height: 60,
    theme,
    selection: null,
    overlay,
    featureLanes: assignLanes(features, doc.length),
    overlayLanes: overlayLanes(overlay, doc.length),
    font: '10px sans-serif',
    ...extra,
  });
  return ctx.toSvg();
}

const plain = SeqDocument.create({ sequence: 'ACGT'.repeat(250), topology: 'circular' });

describe('the map strip (item 107, point 5)', () => {
  it('draws the backbone with its two ends numbered, and nothing else on a bare document', () => {
    const svg = draw(plain);
    expect(svg).toContain('>1<');
    expect(svg).toContain('>1,000<');
    // One line (the backbone) and no filled shape but the background.
    expect((svg.match(/<path/g) ?? []).length).toBe(1);
  });

  it('draws a feature as a block in its lane, and a reverse one with its head at the start', () => {
    const doc = plain
      .addFeature(
        createFeature({
          type: 'CDS',
          name: 'a',
          strand: 'forward',
          segments: [rangeSegment(100, 300)],
        }),
      )
      .addFeature(
        createFeature({
          type: 'gene',
          name: 'b',
          strand: 'reverse',
          segments: [rangeSegment(200, 400)],
        }),
      );
    const svg = draw(doc);
    // Two features overlap, so two lanes; both are filled paths beside the backbone's line.
    expect((svg.match(/<path/g) ?? []).length).toBe(3);
    const rows = ribbonRows(60, 2, 0);
    expect(rows.featureTop(0)).toBeGreaterThan(rows.featureTop(1));
    expect(rows.featureTop(1)).toBeGreaterThan(0);
  });

  it('leaves out the feature types hidden for the document (#305)', () => {
    const doc = plain
      .addFeature(createFeature({ type: 'CDS', name: 'a', segments: [rangeSegment(100, 300)] }))
      .addFeature(createFeature({ type: 'gene', name: 'b', segments: [rangeSegment(200, 400)] }));
    const paths = (svg: string): number => (svg.match(/<path/g) ?? []).length;
    expect(paths(draw(doc, { hiddenTypes: new Set(['gene']) }))).toBe(paths(draw(doc)) - 1);
  });

  it('draws the selection as a band and a stretch over the origin as two pieces', () => {
    const svg = draw(plain, { selection: { start: 950, end: 1050 } });
    const rects = svg.match(/<rect[^>]*>/g) ?? [];
    // The background and the two pieces of the band.
    expect(rects.length).toBe(3);
  });

  it('draws the preview: arrows for primers, a dashed bracket for the product, ticks for mismatches', () => {
    const svg = draw(plain, {
      overlay: [
        {
          id: 'product',
          label: 'Product',
          range: { start: 100, end: 500 },
          strand: 'none',
          shape: 'span',
        },
        {
          id: 'fwd',
          label: 'Fwd',
          range: { start: 100, end: 120 },
          strand: 'forward',
          shape: 'arrow',
        },
        {
          id: 'rev',
          label: 'Rev',
          range: { start: 480, end: 500 },
          strand: 'reverse',
          shape: 'arrow',
          marks: [490],
        },
      ],
    });
    expect(svg).toContain('stroke-dasharray');
    expect(svg).toContain(theme.preview);
    expect(svg).toContain(theme.editChange);
  });

  it('keeps every lane above the backbone on a short ribbon, sharing the top one past the room', () => {
    const rows = ribbonRows(40, 6, 2);
    expect(rows.featureLanesShown).toBeGreaterThanOrEqual(1);
    expect(rows.featureTop(5)).toBe(rows.featureTop(rows.featureLanesShown - 1));
    expect(rows.overlayTop(0)).toBeLessThan(rows.backbone);
    expect(rows.featureTop(0)).toBeLessThan(rows.overlayTop(1));
  });
});
