import { type Feature, CdsTranslations, SeqDocument, createFeature, rangeSegment } from '@/core';
import { randomDna, seededRandom } from '@/test/random';
import { expectWithin, itTimed } from '@/test/timing';

import { NO_OVERLAY } from '../overlay';
import { NO_LANES, assignLanes, lanesPerRow } from './lanes';
import { LinearLayout, linearMetrics } from './layout';
import { type ResidueNumbering } from './residueLabels';
import { renderLinearView } from './renderLinear';

/**
 * What numbering the residues costs the sequence view's draw (#97, item 60):
 * a 200 kb sequence with a CDS every 1.2 kb, a third of them joins, drawn
 * through a context that does nothing, so this is the renderer's own work.
 * The measurement is in `docs/perf-notes.md`.
 */

function stubContext(): CanvasRenderingContext2D {
  const target: Record<string, unknown> = {
    measureText: (s: string) => ({ width: s.length * 6 }),
  };
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

const THEME = {
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
  traceQuality: '#ddd',
  baseColors: { a: '#0a0', c: '#00f', g: '#a50', t: '#c00', other: '#666' },
};

function genome(): SeqDocument {
  const length = 200_000;
  const features: Feature[] = [];
  for (let at = 0, k = 0; at + 1100 < length; at += 1200, k++) {
    features.push(
      createFeature({
        type: 'CDS',
        name: `g${k}`,
        strand: k % 2 === 0 ? 'forward' : 'reverse',
        segments:
          k % 3 === 0
            ? [rangeSegment(at, at + 400), rangeSegment(at + 500, at + 1100)]
            : [rangeSegment(at, at + 999)],
      }),
    );
  }
  return SeqDocument.create({
    sequence: randomDna(seededRandom(97), length),
    topology: 'circular',
    features,
  });
}

/** Median time to draw one 900 px screen, at 50 places down the sequence. */
function screenTime(doc: SeqDocument, residueNumbering: ResidueNumbering): number {
  const features = doc.features.all();
  const lanes = assignLanes(features, doc.length);
  const metrics = linearMetrics({
    fontSize: 13,
    basesPerRow: 100,
    charWidth: 7.8,
    showComplement: true,
    cutSiteLabels: false,
    residueNumbering,
  });
  const perRow = lanesPerRow(features, lanes, doc.length, 100);
  const layout = new LinearLayout(doc.length, metrics, perRow, perRow);
  const translations = new CdsTranslations(doc);
  const draw = (scrollTop: number): void => {
    renderLinearView(stubContext(), {
      doc,
      layout,
      lanes,
      translations,
      translationLanes: lanes,
      residueNumbering,
      selection: null,
      cutSites: [],
      overlay: NO_OVERLAY,
      overlayLanes: NO_LANES,
      edits: null,
      colorBases: false,
      numberComplement: false,
      scrollTop,
      scrollLeft: 0,
      width: 1000,
      height: 900,
      devicePixelRatio: 1,
      theme: THEME,
      monoFont: '13px monospace',
      sansFont: '11px sans-serif',
    });
  };
  const tops = Array.from({ length: 50 }, (_, i) => (i * 7919 * 13) % (layout.totalHeight - 900));
  for (const top of tops) draw(top); // warm up, and translate every CDS once
  const times = tops.map((top) => {
    const t0 = performance.now();
    draw(top);
    return performance.now() - t0;
  });
  times.sort((a, b) => a - b);
  return times[25] ?? 0;
}

describe('residue numbers timing', () => {
  itTimed(
    'numbering the residues keeps a screen of a 200 kb sequence to a millisecond or two',
    () => {
      const doc = genome();
      const off = screenTime(doc, 'off');
      const tens = screenTime(doc, 'tens');
      const every = screenTime(doc, 'every');
      // eslint-disable-next-line no-console
      console.info(
        `[perf] one screen of 200 kb: off ${off.toFixed(2)} ms, every 10th ${tens.toFixed(2)} ms, every residue ${every.toFixed(2)} ms`,
      );
      expectWithin(tens, 20);
      expectWithin(every, 30);
    },
    60_000,
  );
});
