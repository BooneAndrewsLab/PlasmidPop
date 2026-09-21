import { type CutSite, type Feature, SeqDocument, createFeature, findCutSites } from '@/core';
import { ENZYMES } from '@/core/analysis/restriction';
import { parseGenBank } from '@/io/genbank';
import { readFixture } from '@/test/fixtures';

import { assignLanes } from '../linear/lanes';
import { NO_OVERLAY, overlayLanes } from '../overlay';
import { PRINT_THEME } from '../svg/exportMap';
import { SvgContext, textAdvance } from '../svg/svgContext';
import { drawableFeatures } from '../visibleFeatures';
import { CircularLayout } from './circularLayout';
import { renderCircularMap } from './renderCircular';

/**
 * What the map actually draws, measured rather than reasoned about: every
 * text box in a rendered map, compared with every other. A layout function
 * can be asserted on directly, but the question here is whether one label
 * lands on another after the ruler, the canvas edges and the ring have all
 * had their say, and only a render answers that (item 29 in CLAUDE.md, where
 * the pre-fix counts are recorded). Run with LABEL_REPORT=1 for the table.
 */

const SANS = '12px Helvetica, Arial, sans-serif';
const TITLE = '600 15px Helvetica, Arial, sans-serif';
const report = process.env['LABEL_REPORT'] === '1';

interface TextBox {
  readonly text: string;
  readonly left: number;
  readonly right: number;
  readonly top: number;
  readonly bottom: number;
}

const TEXT_RE =
  /<text x="(-?[\d.]+)" y="(-?[\d.]+)" font-family="([^"]*)" font-size="([\d.]+)"[^>]*text-anchor="([^"]*)"[^>]*>([^<]*)<\/text>/g;

/** The drawn text boxes of an SVG, in the same estimate `SvgContext` uses. */
function textBoxes(svg: string): TextBox[] {
  const out: TextBox[] = [];
  for (const m of svg.matchAll(TEXT_RE)) {
    const [, xs, ys, family, sizes, anchor, raw] = m;
    const x = Number(xs);
    const y = Number(ys);
    const size = Number(sizes);
    const text = (raw ?? '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
    const mono = /mono|menlo|consolas|courier/i.test(family ?? '');
    const width = mono ? text.length * size * 0.6 : textAdvance(text) * size;
    const left = anchor === 'end' ? x - width : anchor === 'middle' ? x - width / 2 : x;
    out.push({ text, left, right: left + width, top: y - size / 2, bottom: y + size / 2 });
  }
  return out;
}

function overlappingPairs(boxes: readonly TextBox[]): [TextBox, TextBox][] {
  const out: [TextBox, TextBox][] = [];
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i];
      const b = boxes[j];
      if (a === undefined || b === undefined) continue;
      if (a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom)
        out.push([a, b]);
    }
  }
  return out;
}

interface RenderCase {
  readonly width: number;
  readonly height: number;
  readonly zoom: number;
  readonly cuts: number;
}

function render(
  doc: SeqDocument,
  cutSites: readonly CutSite[],
  c: RenderCase,
): { svg: string; dropped: number } {
  const features = drawableFeatures(doc.features.all());
  const lanes = assignLanes(features, doc.length);
  const layout = new CircularLayout(doc.length, doc.topology, {
    width: c.width,
    height: c.height,
    laneCount: lanes.laneCount,
    ringWidth: 14,
    outerMargin: 110,
    viewport: { zoom: c.zoom, panX: 0, panY: 0 },
  });
  const ctx = new SvgContext(c.width, c.height);
  const { droppedLabels } = renderCircularMap(ctx, {
    doc,
    layout,
    lanes,
    selection: null,
    cutSites,
    overlay: NO_OVERLAY,
    overlayLanes: overlayLanes(NO_OVERLAY, doc.length),
    hoveredFeatureId: null,
    hoveredCut: null,
    width: c.width,
    height: c.height,
    devicePixelRatio: 1,
    theme: PRINT_THEME,
    sansFont: SANS,
    titleFont: TITLE,
  });
  return { svg: ctx.toSvg(), dropped: droppedLabels };
}

/** The map's own chrome, which is not part of the label ring. */
function isChrome(doc: SeqDocument, box: TextBox): boolean {
  return (
    box.text === doc.name ||
    /^[\d,]+ bp$/.test(box.text) ||
    /^\+[\d,]+ labels? not shown$/.test(box.text)
  );
}

/** Every feature named, as the earlier measurement did, to fill the ring. */
function named(doc: SeqDocument): SeqDocument {
  const features = doc.features.all().map((f, i) =>
    f.name === ''
      ? createFeature({
          id: f.id,
          type: f.type,
          name: `${f.type} ${i + 1}`,
          strand: f.strand,
          segments: f.segments,
          qualifiers: f.qualifiers,
        })
      : f,
  );
  return SeqDocument.create({
    name: doc.name,
    sequence: doc.sequence,
    topology: doc.topology,
    features,
  });
}

/**
 * A construct shaped like the one in the report that opened item 29: 13.8 kb
 * of lentiviral vector, about 40 named features, several of them long names
 * bunched together.
 */
function lentiviralLike(): SeqDocument {
  const parts: [string, number, number][] = [
    ['RSV promoter', 1, 229],
    ["5' LTR (truncated)", 230, 410],
    ['HIV-1 Psi', 480, 605],
    ['RRE', 1098, 1331],
    ['cPPT/CTS', 1825, 1943],
    ['T3 promoter', 1960, 1979],
    ['lac operator (fragment)', 1985, 2006],
    ['CAP binding site', 2015, 2036],
    ['EF-1α core promoter', 2050, 2262],
    ['gateway attR1', 2280, 2404],
    ['CmR', 2450, 3109],
    ['ccdB', 3150, 3455],
    ['gateway attR2', 3500, 3624],
    ['WPRE', 3700, 4299],
    ["3' LTR (ΔU3)", 4350, 4583],
    ['bGH poly(A) signal', 4620, 4844],
    ['SV40 ori', 4900, 5035],
    ['SV40 promoter', 5040, 5369],
    ['PuroR', 5400, 6001],
    ['f1 ori', 6100, 6555],
    ['lacZα (fragment)', 6600, 6740],
    ['M13 fwd', 6750, 6766],
    ['T7 promoter', 6800, 6819],
    ['MCS', 6830, 6900],
    ['M13 rev', 6910, 6926],
    ['AmpR promoter', 7000, 7104],
    ['AmpR', 7105, 7965],
    ['ori', 8100, 8688],
    ['rop', 8800, 8991],
    ['mRFP1', 9100, 9778],
    ['CMV enhancer', 9900, 10279],
    ['CMV promoter', 10280, 10483],
    ['β-globin intron', 10500, 11073],
    ['EGFP', 11100, 11816],
    ['SV40 poly(A) signal', 11850, 11971],
    ['U6 promoter', 12000, 12240],
    ['scaffold', 12250, 12326],
    ['HSV TK poly(A) signal', 12400, 12523],
    ['NeoR/KanR', 12600, 13394],
    ['tet operator', 13450, 13469],
    ['CAP binding site', 13500, 13521],
    ['lac promoter', 13600, 13699],
  ];
  const features: Feature[] = parts.map(([name, start, end], i) =>
    createFeature({
      id: `f${i}`,
      type: name.endsWith('promoter') ? 'promoter' : 'misc_feature',
      name,
      strand: i % 3 === 0 ? 'reverse' : 'forward',
      segments: [
        { kind: 'range' as const, start: start - 1, end, partialStart: false, partialEnd: false },
      ],
    }),
  );
  return SeqDocument.create({
    name: 'pLenti-report',
    sequence: 'ACGTTGCA'.repeat(1725).slice(0, 13799),
    topology: 'circular',
    features,
  });
}

const CASES: RenderCase[] = [];
for (const [width, height] of [
  [900, 700],
  [1200, 800],
  [420, 560],
  [600, 600],
] as const) {
  for (const zoom of [1, 1.5, 2, 3]) {
    for (const cuts of [0, 10, 20, 35]) CASES.push({ width, height, zoom, cuts });
  }
}

function fixtureDoc(name: string): SeqDocument {
  const doc = parseGenBank(readFixture(name)).documents[0];
  if (doc === undefined) throw new Error(`fixture ${name}`);
  return doc;
}

describe('circular map labels', () => {
  const pBR322 = named(fixtureDoc('J01749.gb'));
  const lenti = lentiviralLike();
  const singleCutters = (doc: SeqDocument): CutSite[] => {
    const all = findCutSites(doc.sequence.toString(), doc.topology, ENZYMES);
    const counts = new Map<string, number>();
    for (const s of all) counts.set(s.enzyme, (counts.get(s.enzyme) ?? 0) + 1);
    return all.filter((s) => counts.get(s.enzyme) === 1);
  };

  for (const [label, doc] of [
    ['pBR322, every feature named', pBR322],
    ['13.8 kb construct, 42 features', lenti],
  ] as const) {
    it(`draws no label over another: ${label}`, () => {
      const cuts = singleCutters(doc);
      const rows: string[] = [];
      let worst = 0;
      for (const c of CASES) {
        const started = performance.now();
        const { svg, dropped } = render(doc, cuts.slice(0, c.cuts), c);
        const took = performance.now() - started;
        const boxes = textBoxes(svg).filter((b) => !isChrome(doc, b));
        const pairs = overlappingPairs(boxes);
        worst = Math.max(worst, pairs.length);
        if (report)
          rows.push(
            `${String(c.width).padStart(4)}x${c.height} zoom ${c.zoom}  ${String(c.cuts).padStart(2)} cuts: ` +
              `${String(boxes.length).padStart(3)} labels, ${String(pairs.length).padStart(3)} collisions, ` +
              `${String(dropped).padStart(3)} dropped, ${took.toFixed(1)} ms` +
              (pairs.length > 0
                ? `  e.g. ${pairs[0]?.[0].text ?? ''} / ${pairs[0]?.[1].text ?? ''}`
                : ''),
          );
        expect(
          pairs.length,
          `${label} ${c.width}x${c.height} zoom ${c.zoom} ${c.cuts} cuts: ` +
            pairs
              .slice(0, 5)
              .map(([a, b]) => `"${a.text}" over "${b.text}"`)
              .join('; '),
        ).toBe(0);
      }
      if (report) process.stderr.write(`\n${label}\n${rows.join('\n')}\n`);
      expect(worst).toBe(0);
    });
  }

  it('keeps every drawn label inside the canvas', () => {
    const cuts = singleCutters(pBR322).slice(0, 20);
    for (const c of CASES) {
      const { svg } = render(pBR322, cuts, c);
      // The ruler's own numbers are not in this: they are drawn wherever the
      // ruler says, and one at the edge of a zoomed map is clipped by it.
      for (const box of textBoxes(svg).filter((b) => !/^[\d,]+$/.test(b.text))) {
        const where = `"${box.text}" at ${c.width}x${c.height} zoom ${c.zoom}`;
        expect(box.left, `${where} ran off the left edge`).toBeGreaterThanOrEqual(-0.5);
        expect(box.right, `${where} ran off the right edge`).toBeLessThanOrEqual(c.width + 0.5);
        expect(box.top, `${where} ran off the top`).toBeGreaterThanOrEqual(-0.5);
        expect(box.bottom, `${where} ran off the bottom`).toBeLessThanOrEqual(c.height + 0.5);
      }
    }
  });
});
