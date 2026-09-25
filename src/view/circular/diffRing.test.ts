import {
  type DocumentDiff,
  type Feature,
  EMPTY_DIFF,
  SeqDocument,
  createFeature,
  rangeSegment,
} from '@/core';

import { assignLanes, NO_LANES } from '../linear/lanes';
import { NO_OVERLAY } from '../overlay';
import { PRINT_THEME } from '../svg/exportMap';
import { exportMapSvg } from '../svg/exportMap';
import { SvgContext } from '../svg/svgContext';
import { CircularLayout } from './circularLayout';
import { type ChangeTarget, ghostFeatures, ghostLaneKey, lanesWithGhosts } from './diffRing';
import {
  changeAt,
  cutSiteAt,
  describeChange,
  renderCircularMap,
  ringTargetAt,
} from './renderCircular';

const SANS = '12px sans-serif';
/** A colour nothing else on the map is drawn in, so a ghost can be picked out of the SVG. */
const DELETE = '#ff00ff';

function feature(id: string, name: string, start: number, end: number): Feature {
  return createFeature({ id, type: 'misc_feature', name, segments: [rangeSegment(start, end)] });
}

/**
 * A 4 kb circle with one live feature, and a diff that removed three: one
 * clear of it, one over it and one a deletion took whole.
 */
function fixture(diff: Partial<DocumentDiff> = {}) {
  const live = feature('live', 'marker', 1000, 1600);
  const doc = SeqDocument.create({
    sequence: 'ACGT'.repeat(1000),
    topology: 'circular',
    features: [live],
  });
  const edits: DocumentDiff = {
    ...EMPTY_DIFF,
    featuresRemoved: new Map([
      ['clear', feature('clear', 'lost-one', 2000, 2400)],
      ['over', feature('over', 'lost-two', 1200, 1500)],
      ['took', feature('took', 'swallowed', 3000, 3001)],
    ]),
    deletions: [{ position: 3000, count: 50 }],
    marks: [{ kind: 'inserted', start: 400, end: 440 }],
    basesDeleted: 50,
    basesInserted: 40,
    ...diff,
  };
  const features = doc.features.all();
  const liveLanes = assignLanes(features, doc.length);
  const lanes = lanesWithGhosts(features, liveLanes, ghostFeatures(edits), doc.length);
  const layout = new CircularLayout(doc.length, doc.topology, {
    width: 600,
    height: 600,
    laneCount: lanes.laneCount,
    ringWidth: 14,
    outerMargin: 110,
  });
  const draw = (
    withEdits: DocumentDiff | null,
    hoveredChange: ChangeTarget | null = null,
  ): string => {
    const ctx = new SvgContext(600, 600);
    renderCircularMap(ctx, {
      doc,
      layout,
      lanes,
      selection: null,
      cutSites: [],
      overlay: NO_OVERLAY,
      overlayLanes: NO_LANES,
      edits: withEdits,
      hoveredFeatureId: null,
      hoveredCut: null,
      hoveredChange,
      width: 600,
      height: 600,
      devicePixelRatio: 1,
      theme: { ...PRINT_THEME, editDelete: DELETE },
      sansFont: SANS,
      titleFont: '15px sans-serif',
    });
    return ctx.toSvg();
  };
  const hit = (position: number, r: number): ChangeTarget | null => {
    const pt = layout.pointAt(position, r);
    return changeAt({ layout, lanes, edits, sansFont: SANS }, pt.x, pt.y);
  };
  return { doc, edits, liveLanes, lanes, layout, draw, hit };
}

/** Every dashed path stroked in the ghost colour, with the radii of its arcs. */
function ghostPaths(svg: string): { radii: number[]; d: string; width: number }[] {
  return [
    ...svg.matchAll(
      /<path d="([^"]*)"[^>]*stroke="#ff00ff" stroke-width="([\d.]+)"[^>]*stroke-dasharray="4 3"\/>/g,
    ),
  ].map((m) => ({
    d: m[1] ?? '',
    width: Number(m[2]),
    radii: [...(m[1] ?? '').matchAll(/A([\d.]+) /g)].map((a) => Number(a[1])),
  }));
}

describe('ghosts of removed features', () => {
  it('leaves out a removed feature that a deletion took whole, for the wedge to stand for', () => {
    const { edits } = fixture();
    expect(
      ghostFeatures(edits)
        .map((f) => f.id)
        .sort(),
    ).toEqual(['clear', 'over']);
    expect(ghostFeatures(null)).toEqual([]);
  });

  it('stacks ghosts after the live features without moving any of them', () => {
    const { liveLanes, lanes } = fixture();
    expect(lanes.laneOf.get('live')).toBe(liveLanes.laneOf.get('live'));
    // Clear of the live feature, a ghost shares its lane; over it, one of its own.
    expect(lanes.laneOf.get(ghostLaneKey('clear'))).toBe(0);
    expect(lanes.laneOf.get(ghostLaneKey('over'))).toBe(1);
    expect(lanes.laneCount).toBe(2);
    expect(lanes.laneOf.has(ghostLaneKey('took'))).toBe(false);
  });

  it('hands back the same lanes when nothing was removed', () => {
    const { liveLanes, doc } = fixture();
    expect(lanesWithGhosts(doc.features.all(), liveLanes, [], doc.length)).toBe(liveLanes);
  });

  it('draws each ghost as a broken outline in its lane, over the bases it maps to', () => {
    const { draw, layout, edits } = fixture();
    const paths = ghostPaths(draw(edits));
    expect(paths).toHaveLength(2);
    const half = (14 - 4) / 2;
    const byRadius = (lane: number): boolean =>
      paths.some(
        (p) =>
          p.radii.some((r) => Math.abs(r - (layout.laneRadius(lane) + half)) < 0.5) &&
          p.radii.some((r) => Math.abs(r - (layout.laneRadius(lane) - half)) < 0.5),
      );
    expect(byRadius(0)).toBe(true);
    expect(byRadius(1)).toBe(true);
    // The outline starts where the removed feature now maps to: 2,000 on a 4 kb circle.
    const start = layout.pointAt(2000, layout.laneRadius(0) + half);
    const starts = paths.map((p) => /^M([\d.-]+) ([\d.-]+)/.exec(p.d));
    expect(
      starts.some(
        (m) => m !== null && Math.hypot(Number(m[1]) - start.x, Number(m[2]) - start.y) < 1,
      ),
    ).toBe(true);
  });

  it('draws no ghost when there is no diff', () => {
    const { draw } = fixture();
    const svg = draw(null);
    expect(ghostPaths(svg)).toHaveLength(0);
    expect(svg).not.toContain(DELETE);
  });

  it('gives a ghost no label in the ring, and its name only when hovered', () => {
    const { draw, edits } = fixture();
    const plain = draw(edits);
    expect(plain).toContain('>marker<');
    expect(plain).not.toContain('lost-one');
    const hovered = draw(edits, { kind: 'removed', featureId: 'clear' });
    expect(hovered).toContain('lost-one removed');
    // The hovered ghost is drawn in a heavier line.
    expect(Math.max(...ghostPaths(hovered).map((p) => p.width))).toBeGreaterThan(
      Math.max(...ghostPaths(plain).map((p) => p.width)),
    );
  });

  it('says what a hovered mark or deletion is', () => {
    const { edits } = fixture();
    expect(describeChange({ kind: 'mark', index: 0 }, edits)).toBe('40 bp inserted');
    expect(describeChange({ kind: 'deletion', index: 0 }, edits)).toBe(
      '50 bp deleted, with 1 feature',
    );
    expect(describeChange({ kind: 'removed', featureId: 'over' }, edits)).toBe('lost-two removed');
  });

  it('puts the ghosts in the exported map too', () => {
    const { doc, edits } = fixture();
    const svg = exportMapSvg(doc, { size: 600, edits });
    const dashed = [...svg.matchAll(/<path[^>]*stroke="#b3261e"[^>]*stroke-dasharray="4 3"\/>/g)];
    expect(dashed).toHaveLength(2);
    expect(exportMapSvg(doc, { size: 600 })).not.toContain('stroke-dasharray="4 3"');
  });
});

describe('changeAt', () => {
  it('finds a mark on the backbone where it is drawn', () => {
    const { hit, layout } = fixture();
    expect(hit(420, layout.radius)).toEqual({ kind: 'mark', index: 0 });
    expect(hit(420, layout.radius + 2)).toEqual({ kind: 'mark', index: 0 });
    expect(hit(900, layout.radius)).toBeNull();
  });

  it('finds a deletion by its wedge, and it wins over a mark at its boundary', () => {
    const { hit, layout } = fixture({
      marks: [{ kind: 'changed', start: 2900, end: 3000 }],
    });
    expect(hit(3000, layout.radius - 6)).toEqual({ kind: 'deletion', index: 0 });
    expect(hit(3000, layout.radius)).toEqual({ kind: 'deletion', index: 0 });
    expect(hit(2950, layout.radius)).toEqual({ kind: 'mark', index: 0 });
  });

  it('finds a ghost in its lane, and nothing in the lanes elsewhere', () => {
    const { hit, layout } = fixture();
    expect(hit(2200, layout.laneRadius(0))).toEqual({ kind: 'removed', featureId: 'clear' });
    expect(hit(1300, layout.laneRadius(1))).toEqual({ kind: 'removed', featureId: 'over' });
    // The live feature's own arc is not a change.
    expect(hit(1300, layout.laneRadius(0))).toBeNull();
    // Nor is the base a deletion took a feature at: the wedge answers there.
    expect(hit(3000, layout.laneRadius(0))).toBeNull();
  });

  it('finds nothing without a diff', () => {
    const { layout, lanes } = fixture();
    const pt = layout.pointAt(420, layout.radius);
    expect(changeAt({ layout, lanes, edits: null, sansFont: SANS }, pt.x, pt.y)).toBeNull();
  });
});

describe('ringTargetAt (#82)', () => {
  const on = (
    f: ReturnType<typeof fixture>,
    cuts: readonly number[],
    position: number,
    r: number,
  ) => {
    const pt = f.layout.pointAt(position, r);
    return ringTargetAt(
      { layout: f.layout, lanes: f.lanes, edits: f.edits, sansFont: SANS, cuts },
      pt.x,
      pt.y,
    );
  };

  it('gives a cut site over a mark the click, as it has the hover', () => {
    const f = fixture();
    expect(on(f, [420], 420, f.layout.radius)).toEqual({ kind: 'cut', position: 420 });
    // Within a few pixels of the tick, the cut still answers, at the cut itself.
    expect(on(f, [420], 422, f.layout.radius + 2)).toEqual({ kind: 'cut', position: 420 });
    // Along the mark away from the tick, the mark does.
    expect(on(f, [405], 435, f.layout.radius)).toEqual({
      kind: 'change',
      change: { kind: 'mark', index: 0 },
    });
  });

  it('gives a cut site a deletion wedge under it too', () => {
    const f = fixture();
    expect(on(f, [3000], 3000, f.layout.radius)).toEqual({ kind: 'cut', position: 3000 });
    expect(on(f, [], 3000, f.layout.radius)).toEqual({
      kind: 'change',
      change: { kind: 'deletion', index: 0 },
    });
  });

  it('leaves the lanes to the ghosts: a cut site has no say there', () => {
    const f = fixture();
    expect(on(f, [2200], 2200, f.layout.laneRadius(0))).toEqual({
      kind: 'change',
      change: { kind: 'removed', featureId: 'clear' },
    });
  });

  it('finds nothing off the ring, and nearest tick among several', () => {
    const f = fixture();
    expect(on(f, [900], 900, f.layout.radius + 40)).toBeNull();
    const pt = f.layout.pointAt(901, f.layout.radius);
    expect(cutSiteAt(f.layout, [880, 900, 905], pt.x, pt.y)).toBe(900);
    expect(cutSiteAt(f.layout, [], pt.x, pt.y)).toBeNull();
  });
});
