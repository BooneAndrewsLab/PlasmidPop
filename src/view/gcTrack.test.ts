import { SeqDocument, gcProfile } from '@/core';

import { NO_LANES } from './linear/lanes';
import { type LinearTheme, type RenderParams, renderLinearView } from './linear/renderLinear';
import { LinearLayout, linearMetrics } from './linear/layout';
import { NO_OVERLAY } from './overlay';
import { CircularLayout } from './circular/circularLayout';
import { gcRingBounds, renderCircularMap } from './circular/renderCircular';
import { PRINT_THEME } from './svg/exportMap';
import { PRINT_LINEAR_THEME } from './svg/exportLinear';
import { SvgContext } from './svg/svgContext';

const GC = '#12ab34';
const DOC = SeqDocument.create({
  sequence: 'GGGGGGGGGGAAAAAAAAAA'.repeat(5),
  topology: 'circular',
});

describe('the linear GC band', () => {
  const metricsWith = (gc: boolean) =>
    linearMetrics({
      fontSize: 13,
      basesPerRow: 50,
      charWidth: 8,
      showComplement: true,
      cutSiteLabels: false,
      gc,
    });

  it('keeps room under the strands, and the hit test names it', () => {
    const off = new LinearLayout(100, metricsWith(false), [0, 0]);
    const on = new LinearLayout(100, metricsWith(true), [0, 0]);
    const m = metricsWith(true);
    expect(m.gcHeight).toBeGreaterThan(0);
    expect(on.totalHeight - off.totalHeight).toBe(2 * m.gcHeight);
    const row = on.rows[0];
    if (row === undefined) throw new Error('no row');
    const y = on.gcTop(row) + m.gcHeight / 2;
    expect(on.hitTest(on.xOf(row, 7) + 1, y)).toMatchObject({ kind: 'gc', position: 7 });
    expect(on.gcTop(row)).toBe(on.forwardTextTop(row) + on.strandsHeight(row));
    // With the band off the same point is not the GC band.
    expect(off.hitTest(off.xOf(row, 7) + 1, y).kind).not.toBe('gc');
  });

  it('draws the profile in its colour, and nothing without one', () => {
    const metrics = metricsWith(true);
    const layout = new LinearLayout(DOC.length, metrics, [0, 0]);
    const theme: LinearTheme = { ...PRINT_LINEAR_THEME, gc: GC };
    const draw = (gc: RenderParams['gc']): string => {
      const ctx = new SvgContext(600, layout.totalHeight);
      renderLinearView(ctx, {
        doc: DOC,
        layout,
        lanes: NO_LANES,
        translations: null,
        translationLanes: NO_LANES,
        selection: null,
        edits: null,
        cutSites: [],
        overlay: NO_OVERLAY,
        overlayLanes: NO_LANES,
        colorBases: false,
        gc,
        numberComplement: false,
        residueNumbering: 'off',
        scrollTop: 0,
        scrollLeft: 0,
        width: 600,
        height: layout.totalHeight,
        devicePixelRatio: 1,
        theme,
        monoFont: '13px monospace',
        sansFont: '11px sans-serif',
      });
      return ctx.toSvg();
    };
    expect(draw(null)).not.toContain(GC);
    const svg = draw({ profile: gcProfile(DOC.sequence.toString(), 10, true), window: 10 });
    expect(svg).toContain(`stroke="${GC}"`);
  });
});

describe('the GC ring on the map', () => {
  const layout = new CircularLayout(DOC.length, DOC.topology, {
    width: 600,
    height: 600,
    laneCount: 1,
    ringWidth: 14,
    outerMargin: 60,
  });
  const draw = (gc: { profile: Float32Array; window: number } | null): string => {
    const ctx = new SvgContext(600, 600);
    renderCircularMap(ctx, {
      doc: DOC,
      layout,
      lanes: NO_LANES,
      selection: null,
      cutSites: [],
      overlay: NO_OVERLAY,
      overlayLanes: NO_LANES,
      edits: null,
      gc,
      hoveredFeatureId: null,
      hoveredCut: null,
      width: 600,
      height: 600,
      devicePixelRatio: 1,
      theme: { ...PRINT_THEME, gc: GC },
      sansFont: '12px sans-serif',
      titleFont: '15px sans-serif',
    });
    return ctx.toSvg();
  };

  it('sits inside the lanes and is drawn only when asked for', () => {
    const band = gcRingBounds(layout);
    if (band === null) throw new Error('no room for the ring');
    expect(band.outer).toBeLessThan(layout.laneRadius(0) - layout.ringWidth / 2);
    expect(band.inner).toBeLessThan(band.outer);
    expect(draw(null)).not.toContain(GC);
    const svg = draw({ profile: gcProfile(DOC.sequence.toString(), 10, true), window: 10 });
    expect(svg).toContain(`stroke="${GC}"`);
  });

  it('is left out of a map too small to hold it', () => {
    const tiny = new CircularLayout(100, 'circular', {
      width: 120,
      height: 120,
      laneCount: 1,
      ringWidth: 14,
      outerMargin: 60,
    });
    expect(gcRingBounds(tiny)).toBeNull();
  });
});
