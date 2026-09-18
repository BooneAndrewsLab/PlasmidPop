import { findCutSites, findOrfs } from '@/core';
import { parseGenBank } from '@/io';
import { readFixture } from '@/test/fixtures';

import { CircularLayout, renderCircularMap } from './circular';
import { LinearLayout, assignLanes, lanesPerRow, renderLinearView } from './linear';
import { drawableFeatures } from './visibleFeatures';

/** A canvas context that records nothing and measures every string as 6px per char. */
function stubContext(): CanvasRenderingContext2D {
  const target = {
    measureText: (s: string) => ({ width: s.length * 6 }),
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
    backbone: '#444',
    tick: '#ccc',
    leader: '#ddd',
  };

  it('analysis finishes quickly', () => {
    expect(shown.length).toBeGreaterThan(5);
    expect(findOrfs(text, doc.topology).length).toBeGreaterThan(0);
  }, 5000);

  it('linear view renders every row with cut sites', () => {
    const features = drawableFeatures(doc.features.all());
    const lanes = assignLanes(features, doc.length);
    const metrics = {
      basesPerRow: 100,
      charWidth: 8,
      lineHeight: 18,
      showComplement: true,
      rulerHeight: 30,
      laneHeight: 20,
      rowGap: 14,
      leftGutter: 72,
      topPadding: 12,
    };
    const layout = new LinearLayout(
      doc.length,
      metrics,
      lanesPerRow(features, lanes, doc.length, 100),
    );
    renderLinearView(stubContext(), {
      doc,
      layout,
      lanes,
      selection: { start: 10, end: 500 },
      cutSites: shown,
      scrollTop: 0,
      width: 1000,
      height: layout.totalHeight,
      devicePixelRatio: 1,
      theme,
      monoFont: '13px monospace',
      sansFont: '11px sans-serif',
    });
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
      hoveredFeatureId: null,
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
      hoveredFeatureId: null,
      width: 800,
      height: 600,
      devicePixelRatio: 1,
      theme,
      sansFont: '12px sans-serif',
      titleFont: '15px sans-serif',
    });
  }, 5000);
});
