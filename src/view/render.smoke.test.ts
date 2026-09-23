import { CdsTranslations, findCutSites, findOrfs, isCodingFeature } from '@/core';
import { parseGenBank } from '@/io';
import { readFixture } from '@/test/fixtures';

import { CircularLayout, renderCircularMap } from './circular';
import { LinearLayout, NO_LANES, assignLanes, lanesPerRow, renderLinearView } from './linear';
import { NO_OVERLAY } from './overlay';
import { drawableFeatures } from './visibleFeatures';

/** A canvas context that records nothing and measures every string as 6px per char. */
function stubContext(counts?: { fillText: number }): CanvasRenderingContext2D {
  const target = {
    measureText: (s: string) => ({ width: s.length * 6 }),
    fillText: () => {
      if (counts !== undefined) counts.fillText += 1;
    },
  } as Record<string, unknown>;
  return new Proxy(target, {
    get(t, prop) {
      if (prop in t) return t[prop as string];
      return () => undefined;
    },
    set(t, prop, value) {
      t[prop as string] = value;
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
}

describe('renderers over a real plasmid', () => {
  const doc = parseGenBank(readFixture('J01749.gb')).documents[0];
  if (doc === undefined) throw new Error('fixture');
  const text = doc.sequence.toString();
  const sites = findCutSites(text, doc.topology);
  const counts = new Map<string, number>();
  for (const s of sites) counts.set(s.enzyme, (counts.get(s.enzyme) ?? 0) + 1);
  const shown = sites.filter((s) => counts.get(s.enzyme) === 1);
  const theme = {
    ink: '#000',
    inkMuted: '#888',
    gutterText: '#888',
    rulerLine: '#ccc',
    selectionFill: '#88f',
    caret: '#00f',
    background: '#fff',
    cutSite: '#f00',
    editInsert: '#0a0',
    editChange: '#a80',
    editDelete: '#f00',
    preview: '#63d',
    traceQuality: '#dddddd',
    backbone: '#444',
    tick: '#ccc',
    leader: '#ddd',
    baseColors: { a: '#0a0', c: '#00f', g: '#a50', t: '#c00', other: '#666' },
  };

  it('analysis finishes quickly', () => {
    expect(shown.length).toBeGreaterThan(5);
    expect(findOrfs(text, doc.topology).length).toBeGreaterThan(0);
  }, 5000);

  it('linear view renders every row with cut sites and translations', () => {
    const features = drawableFeatures(doc.features.all());
    const lanes = assignLanes(features, doc.length);
    const coding = features.filter(isCodingFeature);
    const translationLanes = assignLanes(coding, doc.length);
    const metrics = {
      basesPerRow: 100,
      charWidth: 8,
      lineHeight: 18,
      showComplement: true,
      rulerHeight: 30,
      traceHeight: 0,
      laneHeight: 20,
      translationHeight: 16,
      overlayHeight: 16,
      rowGap: 14,
      leftGutter: 72,
      rightGutter: 24,
      topPadding: 12,
    };
    const layout = new LinearLayout(
      doc.length,
      metrics,
      lanesPerRow(features, lanes, doc.length, 100),
      lanesPerRow(coding, translationLanes, doc.length, 100),
    );
    expect(coding.length).toBeGreaterThan(0);
    expect(layout.rows.some((r) => r.translations > 0)).toBe(true);
    renderLinearView(stubContext(), {
      doc,
      layout,
      lanes,
      translations: new CdsTranslations(doc),
      translationLanes,
      selection: { start: 10, end: 500 },
      cutSites: shown,
      overlay: NO_OVERLAY,
      overlayLanes: NO_LANES,
      edits: null,
      colorBases: true,
      numberComplement: true,
      scrollTop: 0,
      scrollLeft: 0,
      width: 1000,
      height: layout.totalHeight,
      devicePixelRatio: 1,
      theme,
      monoFont: '13px monospace',
      sansFont: '11px sans-serif',
    });
  }, 5000);

  it('colouring the bases costs a few passes over each row, not one per base', () => {
    const features = drawableFeatures(doc.features.all());
    const lanes = assignLanes(features, doc.length);
    const metrics = {
      basesPerRow: 100,
      charWidth: 8,
      lineHeight: 18,
      showComplement: true,
      rulerHeight: 16,
      traceHeight: 0,
      laneHeight: 20,
      translationHeight: 16,
      overlayHeight: 16,
      rowGap: 14,
      leftGutter: 72,
      rightGutter: 24,
      topPadding: 12,
    };
    const layout = new LinearLayout(
      doc.length,
      metrics,
      lanesPerRow(features, lanes, doc.length, 100),
    );
    const draw = (colorBases: boolean): number => {
      const counts = { fillText: 0 };
      renderLinearView(stubContext(counts), {
        doc,
        layout,
        lanes,
        translations: null,
        translationLanes: assignLanes([], doc.length),
        selection: null,
        cutSites: [],
        overlay: NO_OVERLAY,
        overlayLanes: NO_LANES,
        edits: null,
        colorBases,
        numberComplement: false,
        scrollTop: 0,
        scrollLeft: 0,
        width: 1000,
        height: layout.totalHeight,
        devicePixelRatio: 1,
        theme,
        monoFont: '13px monospace',
        sansFont: '11px sans-serif',
      });
      return counts.fillText;
    };
    const plain = draw(false);
    const colored = draw(true);
    // Ten bases to a fill either way; colouring repeats the line once per
    // colour present, so it stays a small multiple and never approaches one
    // fill per base, which over two strands would be 2 × doc.length.
    expect(colored).toBeGreaterThan(plain);
    expect(colored).toBeLessThan(plain * 6);
    expect(colored).toBeLessThan(doc.length);
  }, 5000);

  it('circular map renders with cut-site labels', () => {
    const features = drawableFeatures(doc.features.all());
    const lanes = assignLanes(features, doc.length);
    const layout = new CircularLayout(doc.length, doc.topology, {
      width: 800,
      height: 600,
      laneCount: lanes.laneCount,
      ringWidth: 14,
      outerMargin: 110,
    });
    renderCircularMap(stubContext(), {
      doc,
      layout,
      lanes,
      selection: { start: 10, end: 500 },
      cutSites: shown,
      overlay: NO_OVERLAY,
      overlayLanes: NO_LANES,
      edits: null,
      hoveredFeatureId: null,
      hoveredCut: null,
      width: 800,
      height: 600,
      devicePixelRatio: 1,
      theme,
      sansFont: '12px sans-serif',
      titleFont: '15px sans-serif',
    });
  }, 5000);

  it('circular map renders zoomed in and panned', () => {
    const features = drawableFeatures(doc.features.all());
    const lanes = assignLanes(features, doc.length);
    const layout = new CircularLayout(doc.length, doc.topology, {
      width: 800,
      height: 600,
      laneCount: lanes.laneCount,
      ringWidth: 14,
      outerMargin: 110,
      viewport: { zoom: 6, panX: 300, panY: 900 },
    });
    expect(layout.radius).toBe(layout.baseRadius * 6);
    renderCircularMap(stubContext(), {
      doc,
      layout,
      lanes,
      selection: { start: 10, end: 500 },
      cutSites: shown,
      overlay: NO_OVERLAY,
      overlayLanes: NO_LANES,
      edits: null,
      hoveredFeatureId: null,
      hoveredCut: null,
      width: 800,
      height: 600,
      devicePixelRatio: 1,
      theme,
      sansFont: '12px sans-serif',
      titleFont: '15px sans-serif',
    });
  }, 5000);
});
