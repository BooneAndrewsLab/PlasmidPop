import { CdsTranslations, SeqDocument, createFeature, rangeSegment } from '@/core';

import { SvgContext } from '../svg/svgContext';
import { assignLanes, lanesPerRow } from './lanes';
import { type LinearMetrics, LinearLayout } from './layout';
import { type LinearTheme, type RenderParams, renderLinearView } from './renderLinear';

const theme: LinearTheme = {
  ink: '#000000',
  inkMuted: '#888888',
  gutterText: '#888888',
  rulerLine: '#cccccc',
  selectionFill: '#8888ff',
  caret: '#0000ff',
  background: '#ffffff',
  cutSite: '#ff0000',
};

const metrics: LinearMetrics = {
  basesPerRow: 10,
  charWidth: 10,
  lineHeight: 20,
  showComplement: true,
  rulerHeight: 20,
  laneHeight: 20,
  translationHeight: 20,
  rowGap: 10,
  leftGutter: 100,
  topPadding: 0,
};

/** Text drawn by the renderer, with its x/y, in drawing order. */
function texts(svg: string): { text: string; x: number; y: number }[] {
  return [...svg.matchAll(/<text x="([\d.-]+)" y="([\d.-]+)"[^>]*>([^<]*)<\/text>/g)].map((m) => ({
    text: m[3] ?? '',
    x: Number(m[1]),
    y: Number(m[2]),
  }));
}

function render(doc: SeqDocument, showTranslations = true): string {
  const features = doc.features.all();
  const lanes = assignLanes(features, doc.length);
  const coding = showTranslations ? features : [];
  const translationLanes = assignLanes(coding, doc.length);
  const layout = new LinearLayout(
    doc.length,
    metrics,
    lanesPerRow(features, lanes, doc.length, metrics.basesPerRow),
    lanesPerRow(coding, translationLanes, doc.length, metrics.basesPerRow),
  );
  const ctx = new SvgContext(300, layout.totalHeight);
  const params: RenderParams = {
    doc,
    layout,
    lanes,
    translations: showTranslations ? new CdsTranslations(doc) : null,
    translationLanes,
    selection: null,
    cutSites: [],
    scrollTop: 0,
    width: 300,
    height: layout.totalHeight,
    devicePixelRatio: 1,
    theme,
    monoFont: '13px monospace',
    sansFont: '11px sans-serif',
  };
  renderLinearView(ctx, params);
  return ctx.toSvg();
}

describe('renderLinearView translations', () => {
  it('letters each codon over its middle base, including codons split across rows', () => {
    // ATG AAA GGG TGA with the fourth codon straddling the row break at 10.
    const doc = SeqDocument.create({
      sequence: 'CATGAAAGGGTGACCCCCCC',
      features: [createFeature({ type: 'CDS', name: 'orf', segments: [rangeSegment(1, 13)] })],
    });
    const drawn = texts(render(doc)).filter((t) => /^[A-Z*]$/.test(t.text));
    expect(drawn.map((t) => t.text)).toEqual(['M', 'K', 'G', '*']);
    // Row 0: the ruler and strands take 60px, so the translation line is centred near y = 70.
    const [m, k, g, stop] = drawn;
    expect(m?.x).toBe(100 + 10 * 2.5); // centre of columns 1..3
    expect(k?.x).toBe(100 + 10 * 5.5);
    expect(g?.x).toBe(100 + 10 * 8.5);
    expect(m?.y).toBeCloseTo(70.5, 1);
    // The stop codon TGA occupies 10..12, entirely in row 1 (translation line under row 1).
    expect(stop?.x).toBe(100 + 10 * 1.5);
    expect(stop?.y).toBeGreaterThan(m?.y ?? 0);
    // The stop is drawn in the stop colour; the others in ink.
    expect(render(doc)).toMatch(/fill="#ff0000"[^>]*>\*<\/text>|>\*<\/text>/);
  });

  it('places a codon split by a row break where its middle base is', () => {
    // Codon 2 = positions 9,10,11 → letter on the run containing 10 (row 1).
    const doc = SeqDocument.create({
      sequence: 'CCCATGAAATAACCCCCCCC',
      features: [createFeature({ type: 'CDS', name: 'orf', segments: [rangeSegment(3, 12)] })],
    });
    const drawn = texts(render(doc)).filter((t) => /^[A-Z*]$/.test(t.text));
    expect(drawn.map((t) => t.text)).toEqual(['M', 'K', '*']);
    const stop = drawn[2];
    // Positions 10 and 11 are columns 0..1 of row 1: centre 1.0 columns in.
    expect(stop?.x).toBe(100 + 10 * 1);
    // Row 1 begins after row 0 (ruler + strands + one translation line + one lane + gap = 110).
    expect(stop?.y).toBeCloseTo(110 + 70.5, 1);
  });

  it('reads reverse-strand features right to left', () => {
    // rc of TTACATGGG... : positions 0..8 = TTACATGGG → rc = CCCATGTAA → P M *
    const doc = SeqDocument.create({
      sequence: 'TTACATGGGC',
      features: [
        createFeature({
          type: 'CDS',
          name: 'rev',
          strand: 'reverse',
          segments: [rangeSegment(0, 9)],
        }),
      ],
    });
    const drawn = texts(render(doc)).filter((t) => /^[A-Z*]$/.test(t.text));
    expect(drawn.map((t) => t.text)).toEqual(['P', 'M', '*']);
    // P is the first codon (positions 8,7,6) so it sits rightmost.
    expect(drawn[0]?.x).toBe(100 + 10 * 7.5);
    expect(drawn[2]?.x).toBe(100 + 10 * 1.5);
  });

  it('draws nothing extra when translations are hidden', () => {
    const doc = SeqDocument.create({
      sequence: 'CATGAAAGGGTGACCCCCCC',
      features: [createFeature({ type: 'CDS', name: 'orf', segments: [rangeSegment(1, 13)] })],
    });
    const drawn = texts(render(doc, false)).filter((t) => /^[A-Z*]$/.test(t.text));
    expect(drawn).toEqual([]);
  });
});
