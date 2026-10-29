import {
  CdsTranslations,
  SeqDocument,
  createFeature,
  diffDocuments,
  rangeSegment,
  reverseComplement,
} from '@/core';

import { SvgContext } from '../svg/svgContext';
import { type OverlaySpan, NO_OVERLAY, overlayLanes, overlaysPerRow } from '../overlay';
import { NO_LANES, assignLanes, lanesPerRow } from './lanes';
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
  editInsert: '#00aa00',
  editChange: '#aa8800',
  editDelete: '#ff0000',
  preview: '#6b4fd8',
  traceQuality: '#dddddd',
  gc: '#2a8f7a',
  baseColors: { a: '#00aa00', c: '#0000ff', g: '#aa5500', t: '#cc0000', other: '#666666' },
};

const metrics: LinearMetrics = {
  basesPerRow: 10,
  charWidth: 10,
  lineHeight: 20,
  showComplement: true,
  rulerHeight: 20,
  traceHeight: 0,
  laneHeight: 20,
  translationHeight: 20,
  residueNumberHeight: 0,
  overlayHeight: 16,
  gcHeight: 0,
  rowGap: 10,
  leftGutter: 100,
  rightGutter: 24,
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

/**
 * Letters drawn in a translucent colour, which is how the stub of a split
 * codon carries a faint copy of its residue (#318), with their position.
 */
function ghostLetters(svg: string): { text: string; x: number; y: number }[] {
  return [
    ...svg.matchAll(
      /<text x="([\d.-]+)" y="([\d.-]+)"[^>]*fill="rgba\([^"]*"[^>]*>([^<]*)<\/text>/g,
    ),
  ].map((m) => ({ text: m[3] ?? '', x: Number(m[1]), y: Number(m[2]) }));
}

function render(
  doc: SeqDocument,
  showTranslations = true,
  edits: RenderParams['edits'] = null,
  options: Partial<RenderParams> = {},
): string {
  const features = doc.features.all();
  const lanes = assignLanes(features, doc.length);
  const coding = showTranslations ? features : [];
  const translationLanes = assignLanes(coding, doc.length);
  const overlay = options.overlay ?? NO_OVERLAY;
  const previewLanes = overlayLanes(overlay, doc.length);
  const layout = new LinearLayout(
    doc.length,
    metrics,
    lanesPerRow(features, lanes, doc.length, metrics.basesPerRow),
    lanesPerRow(coding, translationLanes, doc.length, metrics.basesPerRow),
    overlaysPerRow(overlay, previewLanes, doc.length, metrics.basesPerRow),
  );
  const ctx = new SvgContext(300, layout.totalHeight);
  const params: RenderParams = {
    doc,
    layout,
    lanes,
    translations: showTranslations ? new CdsTranslations(doc) : null,
    translationLanes,
    selection: null,
    edits,
    cutSites: [],
    overlay,
    overlayLanes: previewLanes,
    colorBases: false,
    gc: null,
    numberComplement: false,
    residueNumbering: 'off',
    scrollTop: 0,
    scrollLeft: 0,
    width: 300,
    height: layout.totalHeight,
    devicePixelRatio: 1,
    theme,
    monoFont: '13px monospace',
    sansFont: '11px sans-serif',
    ...options,
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
    const svg = render(doc);
    const ghosts = ghostLetters(svg);
    const drawn = texts(svg).filter(
      (t) => /^[A-Z*]$/.test(t.text) && !ghosts.some((g) => g.x === t.x && g.y === t.y),
    );
    expect(drawn.map((t) => t.text)).toEqual(['M', 'K', '*']);
    // The base of the stop codon that stays in row 0 carries its faint copy.
    expect(ghosts.map((g) => g.text)).toEqual(['*']);
    expect(ghosts[0]?.x).toBe(100 + 10 * 9.5);
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

describe('renderLinearView edit marks', () => {
  const base = SeqDocument.create({ sequence: 'ACGTTGCAAGGCTTAACCGG' });
  /** Rectangles drawn by the renderer, with their geometry, in drawing order. */
  function rects(svg: string): { x: number; y: number; w: number; h: number; fill: string }[] {
    return [
      ...svg.matchAll(
        /<rect x="([\d.-]+)" y="([\d.-]+)" width="([\d.-]+)" height="([\d.-]+)" fill="([^"]*)"/g,
      ),
    ].map((m) => ({
      x: Number(m[1]),
      y: Number(m[2]),
      w: Number(m[3]),
      h: Number(m[4]),
      fill: m[5] ?? '',
    }));
  }

  it('draws nothing extra without a diff', () => {
    expect(rects(render(base, false)).filter((r) => r.fill.includes('0, 170, 0'))).toEqual([]);
  });

  it('tints and underlines inserted bases over both strands', () => {
    const edited = base.insert(2, 'TTT');
    const drawn = rects(render(edited, false, diffDocuments(base, edited)));
    // Columns 2..5 of row 0: x = 100 + 2 * 10, width 3 * 10.
    const tint = drawn.find((r) => r.fill.startsWith('rgba(0, 170, 0'));
    expect(tint).toMatchObject({ x: 120, w: 30, h: 40 }); // two 20px strand lines
    const underline = drawn.find((r) => r.fill === '#00aa00' && r.h === 2);
    expect(underline).toMatchObject({ x: 120, w: 30 });
  });

  it('uses the changed colour where bases replaced others', () => {
    const edited = base.replace({ start: 4, end: 8 }, 'NNNN');
    const drawn = rects(render(edited, false, diffDocuments(base, edited)));
    expect(drawn.some((r) => r.fill.startsWith('rgba(170, 136, 0'))).toBe(true);
    expect(drawn.some((r) => r.fill.startsWith('rgba(0, 170, 0'))).toBe(false);
  });

  it('marks a deletion with a wedge and a line at the boundary it left', () => {
    const edited = base.delete({ start: 1, end: 4 });
    const svg = render(edited, false, diffDocuments(base, edited));
    // Column 1 of row 0 is x = 110: a wedge in the ruler band above the
    // strands, and a line down through both of them (y 20 to 60).
    expect(svg).toContain('<path d="M106.5 14 L114.5 14 L110.5 19 Z" fill="#ff0000"');
    expect(svg).toContain('<path d="M110.5 20 L110.5 60" fill="none" stroke="#ff0000"');
  });

  it('outlines a feature that was added or edited', () => {
    const added = base.addFeature(
      createFeature({ id: 'new', type: 'CDS', name: 'x', segments: [rangeSegment(2, 9)] }),
    );
    const svg = render(added, false, diffDocuments(base, added));
    expect(svg).toMatch(/fill="none" stroke="#00aa00" stroke-width="1.5"/);
    // An untouched feature keeps its plain ribbon.
    expect(render(added, false, null)).not.toMatch(/stroke="#00aa00"/);
  });

  it('breaks the outline where only the label changed, not the bases', () => {
    const annotated = base.addFeature(
      createFeature({ id: 'f', type: 'gene', name: 'x', segments: [rangeSegment(2, 9)] }),
    );
    const outlineOf = (svg: string): string =>
      /<path[^>]*stroke="#aa8800"[^>]*>/.exec(svg)?.[0] ?? '';

    // Retyped in place: the same bases, described differently.
    const retyped = annotated.updateFeature('f', { type: 'CDS' });
    expect(outlineOf(render(retyped, false, diffDocuments(annotated, retyped)))).toContain(
      'stroke-dasharray="3 2"',
    );

    // Renamed in place (#31): the same, a changed feature with a broken line.
    const renamed = annotated.updateFeature('f', { name: 'y' });
    expect(outlineOf(render(renamed, false, diffDocuments(annotated, renamed)))).toContain(
      'stroke-dasharray="3 2"',
    );

    // Moved by hand: it covers bases it did not before, so the line is solid.
    const moved = annotated.updateFeature('f', { segments: [rangeSegment(2, 14)] });
    const movedSvg = render(moved, false, diffDocuments(annotated, moved));
    expect(outlineOf(movedSvg)).not.toBe('');
    expect(outlineOf(movedSvg)).not.toContain('stroke-dasharray');
  });
});

/** Drawn text with the colour it was filled in. */
function coloredTexts(svg: string): { text: string; x: number; y: number; fill: string }[] {
  return [
    ...svg.matchAll(/<text x="([\d.-]+)" y="([\d.-]+)"[^>]*fill="([^"]+)"[^>]*>([^<]*)<\/text>/g),
  ].map((m) => ({ text: m[4] ?? '', x: Number(m[1]), y: Number(m[2]), fill: m[3] ?? '' }));
}

/** The y of the forward strand's text in the fixture layout above. */
const FORWARD_Y = metrics.rulerHeight + metrics.lineHeight * 0.75;
const COMPLEMENT_Y = FORWARD_Y + metrics.lineHeight;

describe('renderLinearView format options', () => {
  const doc = SeqDocument.create({ sequence: 'ACGTNACGTA' });

  it('draws the strands in one ink by default', () => {
    const drawn = coloredTexts(render(doc, false)).filter((t) => t.text.length > 1);
    expect(drawn).toEqual([
      { text: 'ACGTNACGTA', x: 100, y: FORWARD_Y, fill: theme.ink },
      { text: 'TGCANTGCAT', x: 100, y: COMPLEMENT_Y, fill: theme.inkMuted },
    ]);
  });

  it('colours each base, keeping every letter in its own column', () => {
    const svg = render(doc, false, null, { colorBases: true });
    const baseColors = new Set(Object.values(theme.baseColors));
    const forward = coloredTexts(svg).filter((t) => t.y === FORWARD_Y && baseColors.has(t.fill));
    // One pass per colour, the other columns blanked out with spaces.
    const byFill = new Map(forward.map((t) => [t.fill, t.text]));
    expect(byFill.get(theme.baseColors.a)).toBe('A    A   A');
    expect(byFill.get(theme.baseColors.c)).toBe(' C    C   ');
    expect(byFill.get(theme.baseColors.g)).toBe('  G    G  ');
    expect(byFill.get(theme.baseColors.t)).toBe('   T    T ');
    expect(byFill.get(theme.baseColors.other)).toBe('    N     ');
    // Every pass starts at the first column, so the spaces do the aligning.
    expect(new Set(forward.map((t) => t.x))).toEqual(new Set([100]));
    // ...and the export says so, or the spaces would collapse.
    expect(svg).toContain('xml:space="preserve"');
    // The complement is coloured by the base it shows, not the one it pairs with.
    const complement = coloredTexts(svg).filter(
      (t) => t.y === COMPLEMENT_Y && baseColors.has(t.fill),
    );
    expect(new Map(complement.map((t) => [t.fill, t.text])).get(theme.baseColors.a)).toBe(
      '   A    A ',
    );
  });

  it('numbers the complement with the same position, muted', () => {
    const plain = texts(render(doc, false)).filter((t) => t.text === '1');
    expect(plain).toHaveLength(1);
    const numbered = coloredTexts(render(doc, false, null, { numberComplement: true })).filter(
      (t) => t.text === '1',
    );
    expect(numbered).toEqual([
      { text: '1', x: 90, y: FORWARD_Y, fill: theme.gutterText },
      // The repeat sits a line lower, beside the complement.
      { text: '1', x: 90, y: COMPLEMENT_Y, fill: theme.inkMuted },
    ]);
  });

  it('leaves the complement unnumbered when the complement is hidden', () => {
    const hidden = new LinearLayout(doc.length, { ...metrics, showComplement: false }, [0], [0]);
    const ctx = new SvgContext(300, hidden.totalHeight);
    renderLinearView(ctx, {
      doc,
      layout: hidden,
      lanes: assignLanes([], doc.length),
      translations: null,
      translationLanes: assignLanes([], doc.length),
      selection: null,
      cutSites: [],
      overlay: NO_OVERLAY,
      overlayLanes: NO_LANES,
      edits: null,
      colorBases: false,
      gc: null,
      numberComplement: true,
      residueNumbering: 'off',
      scrollTop: 0,
      scrollLeft: 0,
      width: 300,
      height: hidden.totalHeight,
      devicePixelRatio: 1,
      theme,
      monoFont: '13px monospace',
      sansFont: '11px sans-serif',
    });
    expect(texts(ctx.toSvg()).filter((t) => t.text === '1')).toHaveLength(1);
  });

  it('shifts the drawing left when the view is scrolled sideways', () => {
    const at = (scrollLeft: number): number =>
      texts(render(doc, false, null, { scrollLeft }))[0]?.x ?? NaN;
    expect(at(0) - at(40)).toBe(40);
  });
});

/** Just the strand text: the ruler numbers are drawn with the same call. */
function strandTexts(svg: string): string[] {
  return texts(svg)
    .map((t) => t.text)
    .filter((t) => /^[ACGT ]{2,}$/.test(t));
}

describe('renderLinearView sticky ends', () => {
  // Ten bases a row in the fixture metrics, so this is exactly two rows.
  const seq = 'AATTCGGGCCGGGCCCTGCA';
  const doc = SeqDocument.create({
    sequence: seq,
    topology: 'linear',
    ends: {
      // The first four bases are the overhang: the top strand is on its own there.
      left: { kind: "5'", overhang: 'AATT', enzyme: 'EcoRI' },
      // The bottom strand runs four bases past the end instead.
      right: { kind: "5'", overhang: 'TGCA', enzyme: 'PstI' },
    },
  });

  it('leaves a gap opposite bases that have no partner', () => {
    expect(strandTexts(render(doc, false))).toEqual([
      'AATTCGGGCC',
      // Four blanks opposite the 5' overhang on the top strand.
      '    GCCCGG',
      'GGGCCCTGCA',
      'CCCGGGACGT',
      // The bottom strand's own overhang, past the last column.
      'ACGT',
    ]);
  });

  it('washes over the single-stranded bases so they show without the complement', () => {
    const svg = render(doc, false);
    // Four columns wide, from the first column, over both strand lines.
    expect(svg).toContain(`<rect x="100" y="${metrics.rulerHeight}" width="40" height="40"`);
  });

  it('draws nothing extra for a molecule with plain ends', () => {
    const plain = SeqDocument.create({ sequence: seq, topology: 'linear' });
    expect(strandTexts(render(plain, false))).toEqual([
      'AATTCGGGCC',
      'TTAAGCCCGG',
      'GGGCCCTGCA',
      'CCCGGGACGT',
    ]);
  });
});

describe('renderLinearView preview overlay', () => {
  const doc = SeqDocument.create({ sequence: 'ACGTACGTACACGTACGTAC' });
  // What the Primers tab shows for a pair: the product, and a primer on it.
  const preview: OverlaySpan[] = [
    {
      id: 'product',
      label: 'Product 20 bp',
      range: { start: 0, end: 20 },
      strand: 'none',
      shape: 'span',
    },
    {
      id: 'forward',
      label: 'Fwd 1',
      range: { start: 0, end: 10 },
      strand: 'forward',
      shape: 'arrow',
    },
  ];

  it('draws the preview dashed, in a band outside the feature lanes', () => {
    const svg = render(doc, false, null, { overlay: preview });
    expect(svg).toContain('stroke-dasharray="4 3"');
    // Ruler and two strands take 60px; the product takes the first preview
    // lane (it is the longer) and the primer the second, 16px further down.
    const label = texts(svg).find((t) => t.text === 'Fwd 1');
    expect(label).toEqual({ text: 'Fwd 1', x: 104, y: 84 });
    // The bracket's label is centred over it.
    expect(texts(svg).find((t) => t.text === 'Product 20 bp')).toEqual({
      text: 'Product 20 bp',
      x: 150,
      y: 68,
    });
  });

  it('makes room for the band in every row the preview touches', () => {
    const plain = /height="(\d+)"/.exec(render(doc, false))?.[1];
    const withPreview = /height="(\d+)"/.exec(render(doc, false, null, { overlay: preview }))?.[1];
    // Rows of 10 bases: both carry the product, only the first the primer.
    expect(plain).toBe('140');
    expect(withPreview).toBe(String(140 + 2 * 16 + 1 * 16));
  });

  it('leaves the view alone when nothing is previewed', () => {
    expect(render(doc, false)).not.toContain('stroke-dasharray');
  });

  it('marks the bases a previewed primer does not pair with, one cell each', () => {
    const cells = (svg: string): string[] =>
      [...svg.matchAll(/<rect[^>]*fill="#aa8800"[^>]*>/g)].map((m) => m[0]);
    const plain = cells(render(doc, false, null, { overlay: preview }));
    const marked = cells(
      render(doc, false, null, {
        overlay: preview.map((p) => (p.id === 'forward' ? { ...p, marks: [3, 7] } : p)),
      }),
    );
    expect(marked.length - plain.length).toBe(2);
    // One base wide, in the columns of bases 3 and 7.
    const xs = marked.map((r) => Number(/x="([\d.]+)"/.exec(r)?.[1])).sort((a, b) => a - b);
    expect(xs[1] !== undefined && xs[0] !== undefined && xs[1] - xs[0]).toBe(40);
  });
});

describe('renderLinearView residue numbers', () => {
  // Rows of 30 bases, 10 px each; the amino-acid line keeps an 11 px band
  // above its letters for the numbers.
  const numbered: LinearMetrics = {
    ...metrics,
    basesPerRow: 30,
    translationHeight: 31,
    residueNumberHeight: 11,
  };
  /** The numbers drawn, told from other text by their size (0.85 of the 11 px label font). */
  function numbers(svg: string): { text: string; x: number; y: number }[] {
    return [
      ...svg.matchAll(/<text x="([\d.-]+)" y="([\d.-]+)"[^>]*font-size="9.35"[^>]*>([^<]*)</g),
    ].map((m) => ({ text: m[3] ?? '', x: Number(m[1]), y: Number(m[2]) }));
  }
  function draw(
    doc: SeqDocument,
    residueNumbering: RenderParams['residueNumbering'],
    m: LinearMetrics = numbered,
  ): string {
    const features = doc.features.all();
    const lanes = assignLanes(features, doc.length);
    const layout = new LinearLayout(
      doc.length,
      m,
      lanesPerRow(features, lanes, doc.length, m.basesPerRow),
      lanesPerRow(features, lanes, doc.length, m.basesPerRow),
    );
    return render(doc, true, null, {
      layout,
      lanes,
      translationLanes: lanes,
      residueNumbering,
      width: 500,
      height: layout.totalHeight,
    });
  }
  const orf = (init: Partial<Parameters<typeof createFeature>[0]> = {}) =>
    createFeature({ type: 'CDS', name: 'orf', segments: [rangeSegment(0, 90)], ...init });
  const bases = (n: number): string => 'ATGAAACCCGGGTTT'.repeat(Math.ceil(n / 15)).slice(0, n);
  // Row 0: ruler 20 + strands 40, then the band; a row is that, the 31 px
  // line, one 20 px lane and the 10 px gap.
  const BASELINE = 60 + 11 - 2;
  const ROW = 60 + 31 + 20 + 10;

  it('numbers the first residue and every tenth over its letter, in the band', () => {
    const doc = SeqDocument.create({ sequence: bases(90), features: [orf()] });
    const svg = draw(doc, 'tens');
    expect(numbers(svg)).toEqual([
      { text: '1', x: 115, y: BASELINE },
      { text: '10', x: 385, y: BASELINE },
      { text: '20', x: 385, y: ROW + BASELINE },
      { text: '30', x: 385, y: 2 * ROW + BASELINE },
    ]);
    // Each sits over its residue's letter, above it.
    const letters = texts(svg).filter((t) => /^[A-Z*]$/.test(t.text));
    for (const n of numbers(svg)) {
      const letter = letters.find((l) => l.x === n.x && l.y > n.y && l.y - n.y < 20);
      expect(letter).toBeDefined();
    }
  });

  it('numbers a reverse-strand CDS from its right-hand end', () => {
    const doc = SeqDocument.create({ sequence: bases(90), features: [orf({ strand: 'reverse' })] });
    expect(numbers(draw(doc, 'tens'))).toEqual([
      { text: '30', x: 115, y: BASELINE },
      { text: '20', x: 115, y: ROW + BASELINE },
      // Drawn in reading order: residue 1 first.
      { text: '1', x: 385, y: 2 * ROW + BASELINE },
      { text: '10', x: 115, y: 2 * ROW + BASELINE },
    ]);
  });

  it('puts the number of a codon split by a row break where its letter is', () => {
    // Residue 10 is bases 29 | 30, 31: its middle base, and its letter, in row 1.
    const doc = SeqDocument.create({
      sequence: bases(100),
      features: [orf({ segments: [rangeSegment(2, 92)] })],
    });
    const svg = draw(doc, 'tens');
    const ten = numbers(svg).find((n) => n.text === '10');
    expect(ten).toEqual({ text: '10', x: 110, y: ROW + BASELINE });
    const letters = texts(svg).filter((t) => /^[A-Z*]$/.test(t.text));
    expect(letters.some((l) => l.x === 110 && l.y > ROW + BASELINE)).toBe(true);
  });

  it('counts straight on through the origin of a circle', () => {
    // 45 bases from 45: residue 1 at 45..47 in row 1, residue 10 at 12..14 in row 0.
    const doc = SeqDocument.create({
      sequence: bases(60),
      topology: 'circular',
      features: [orf({ segments: [rangeSegment(45, 90)] })],
    });
    const drawn = numbers(draw(doc, 'tens'));
    expect(drawn).toContainEqual({ text: '10', x: 235, y: BASELINE });
    expect(drawn).toContainEqual({ text: '1', x: 265, y: ROW + BASELINE });
    expect(drawn.map((n) => n.text).sort()).toEqual(['1', '10']);
  });

  it('numbers every residue when asked and there is room', () => {
    const doc = SeqDocument.create({ sequence: bases(90), features: [orf()] });
    const drawn = numbers(draw(doc, 'every'));
    expect(drawn.map((n) => Number(n.text))).toEqual(Array.from({ length: 30 }, (_, i) => i + 1));
  });

  it('drops numbers that have no room rather than overlapping them, keeping the tens', () => {
    // 4 px bases: a codon is 12 px and a two-digit number 10.4 px, so with
    // the gap between them not every one fits.
    const narrow = { ...numbered, charWidth: 4 };
    const doc = SeqDocument.create({ sequence: bases(90), features: [orf()] });
    const drawn = numbers(draw(doc, 'every', narrow));
    const shown = drawn.map((n) => Number(n.text));
    expect(shown.length).toBeLessThan(30);
    expect(shown).toEqual(expect.arrayContaining([1, 10, 20, 30]));
    // No two in one row closer than their half-widths and the gap.
    const width = (s: string): number => s.length * 0.556 * 9.35;
    for (const a of drawn) {
      for (const b of drawn) {
        if (a === b || a.y !== b.y) continue;
        expect(Math.abs(a.x - b.x)).toBeGreaterThanOrEqual((width(a.text) + width(b.text)) / 2 + 4);
      }
    }
  });

  it('draws no numbers when they are off, or when the metrics keep no band', () => {
    const doc = SeqDocument.create({ sequence: bases(90), features: [orf()] });
    expect(numbers(draw(doc, 'off'))).toEqual([]);
    const noBand = { ...numbered, translationHeight: 20, residueNumberHeight: 0 };
    expect(numbers(draw(doc, 'tens', noBand))).toEqual([]);
  });
});

describe('renderLinearView split and unfinished codons (#318)', () => {
  /** x of every dotted vertical edge: the paths stroked in the caret colour with the open-edge dash. */
  function openEdges(svg: string): number[] {
    const xs: number[] = [];
    for (const m of svg.matchAll(
      /<path d="([^"]*)" fill="none" stroke="#0000ff"[^>]*stroke-dasharray="1\.5 2"\/>/g,
    )) {
      for (const move of (m[1] ?? '').matchAll(/M([\d.-]+) [\d.-]+/g)) xs.push(Number(move[1]));
    }
    return xs;
  }
  /** The outline paths of unfinished codons, whole: dashed in the muted ink. */
  function outlines(svg: string): string[] {
    return [
      ...svg.matchAll(
        /<path d="([^"]*)" fill="none" stroke="#888888"[^>]*stroke-dasharray="3 2"\/>/g,
      ),
    ].map((m) => m[1] ?? '');
  }
  /** Hatching paths: translucent strokes with no dash. */
  function hatches(svg: string): string[] {
    return [
      ...svg.matchAll(/<path d="([^"]*)" fill="none" stroke="rgba\([^"]*" stroke-width="1"\/>/g),
    ].map((m) => m[1] ?? '');
  }
  /** Solid tint boxes of the translation lines, by x and width. */
  function tints(svg: string): { x: number; w: number }[] {
    return [
      ...svg.matchAll(
        /<rect x="([\d.-]+)" y="[\d.-]+" width="([\d.-]+)" height="[\d.-]+" fill="rgba\(/g,
      ),
    ].map((m) => ({ x: Number(m[1]), w: Number(m[2]) }));
  }
  const cds = (init: Pick<Parameters<typeof createFeature>[0], 'segments' | 'strand'>) =>
    createFeature({ type: 'CDS', name: 'orf', ...init });

  // 10 bases a row, 10 px a base, the sequence starting at x = 100.
  //  row 0  ATGAAAGCCC   row 1  CCCTGAAACC
  // join(1..7,14..19): ATG AAA G|TG AAA: codon 3 is G (7) + TG (14-15) = GTG.
  const joined = SeqDocument.create({
    sequence: 'ATGAAAGCCCCCCTGAAACC',
    features: [cds({ segments: [rangeSegment(0, 7), rangeSegment(13, 19)] })],
  });

  it('draws the leading stub of a split codon with a faint letter and an open right edge, and its continuation open on the left', () => {
    const svg = render(joined);
    // The stub is the G at column 6: its faint V sits over it, its dotted edge on its right side.
    expect(ghostLetters(svg)).toEqual([expect.objectContaining({ text: 'V', x: 100 + 10 * 6.5 })]);
    // The continuation TG at columns 3 and 4 of row 1 holds the middle base: a solid V, open on the left.
    const solid = texts(svg).filter((t) => t.text === 'V' && t.x === 100 + 10 * 4);
    expect(solid).toHaveLength(1);
    expect(openEdges(svg)).toEqual([100 + 10 * 7 - 1, 100 + 10 * 3 + 1]);
    // Both pieces are tinted like any codon.
    expect(tints(svg).filter((t) => t.x === 100 + 10 * 6 && t.w === 10)).toHaveLength(1);
  });

  it('mirrors the edges for a reverse-strand feature', () => {
    // The same codon on the other strand: exon 1 (reading first) is at the higher coordinates.
    const sequence = reverseComplement('TGAAAC') + 'CCCCCC' + reverseComplement('ATGAAAG');
    const doc = SeqDocument.create({
      sequence,
      features: [cds({ strand: 'reverse', segments: [rangeSegment(0, 6), rangeSegment(12, 19)] })],
    });
    const svg = render(doc);
    // Exon 2 holds the continuation at bases 4-5 (columns 4 and 5): open on its right.
    // The stub is the base at 12 (row 1, column 2): open on its left.
    expect(openEdges(svg)).toEqual([100 + 10 * 6 - 1, 100 + 10 * 2 + 1]);
    expect(ghostLetters(svg)).toHaveLength(1);
    expect(ghostLetters(svg)[0]?.x).toBe(100 + 10 * 2.5);
  });

  it('opens a codon cut by a row break at the edges of the rows', () => {
    // ATG AAA TAA with the stop codon on 9, 10, 11 (as in the lettering test above).
    const doc = SeqDocument.create({
      sequence: 'CCCATGAAATAACCCCCCCC',
      features: [cds({ segments: [rangeSegment(3, 12)] })],
    });
    const svg = render(doc);
    expect(openEdges(svg)).toEqual([100 + 10 * 10 - 1, 100 + 1]);
    expect(ghostLetters(svg).map((g) => g.text)).toEqual(['*']);
  });

  it('opens a codon across the origin of a circular record at the edges of the first and last rows', () => {
    // Length 20, rows of 10: the CDS 19, 0, 1 | 2 3 4 starts at base 19 and wraps.
    const doc = SeqDocument.create({
      sequence: 'GGATGAAACCCCCCCCCCCT',
      topology: 'circular',
      features: [cds({ segments: [rangeSegment(19, 26)] })],
    });
    const svg = render(doc);
    // Row 0 holds the codon's last two bases (and the middle one): open on the left. Row 1 holds the
    // first base, with the faint letter: open on the right.
    expect(openEdges(svg)).toEqual([100 + 1, 100 + 10 * 10 - 1]);
    expect(ghostLetters(svg)).toHaveLength(1);
  });

  it('draws an ordinary codon with neither a faint letter nor an open edge', () => {
    const doc = SeqDocument.create({
      sequence: 'CATGAAAGGGTGACCCCCCC',
      features: [cds({ segments: [rangeSegment(1, 13)] })],
    });
    const svg = render(doc);
    expect(openEdges(svg)).toEqual([]);
    expect(outlines(svg)).toEqual([]);
    expect(ghostLetters(svg)).toEqual([]);
    const whole = SeqDocument.create({
      sequence: 'CATGAAAGGGTGACCCCCCC',
      features: [cds({ segments: [rangeSegment(1, 10)] })],
    });
    expect(ghostLetters(render(whole))).toEqual([]);
  });

  it('hatches the last base of a CDS that ends open under a dashed outline, with no letter and no tint', () => {
    // ATG AAA G, 1..>7: the G never finishes.
    const doc = SeqDocument.create({
      sequence: 'ATGAAAGCCCCCCC',
      features: [cds({ segments: [rangeSegment(0, 7, { partialEnd: true })] })],
    });
    const svg = render(doc);
    // The outline starts at the G's left edge, column 6, inset by half a pixel.
    expect(outlines(svg)).toHaveLength(1);
    expect(outlines(svg)[0]).toMatch(/^M160\.5 /);
    expect(hatches(svg)).toHaveLength(1);
    expect(openEdges(svg)).toEqual([]);
    expect(ghostLetters(svg)).toEqual([]);
    expect(
      texts(svg)
        .filter((t) => /^[A-Z*]$/.test(t.text))
        .map((t) => t.text),
    ).toEqual(['M', 'K']);
    // No solid tint over the G.
    expect(tints(svg).filter((t) => t.x === 100 + 10 * 6)).toEqual([]);
  });

  it('hatches two bases that fix no residue, and keeps the letter of two that do', () => {
    const open = { partialEnd: true };
    // TA: tyrosine or a stop, so unread.
    const ta = SeqDocument.create({
      sequence: 'ATGAAATACCCCCC',
      features: [cds({ segments: [rangeSegment(0, 8, open)] })],
    });
    const svgTa = render(ta);
    expect(outlines(svgTa)).toHaveLength(1);
    expect(
      texts(svgTa)
        .filter((t) => /^[A-Z*]$/.test(t.text))
        .map((t) => t.text),
    ).toEqual(['M', 'K']);
    // GT: valine whatever the third base, so read, and drawn unfinished with its letter.
    const gt = SeqDocument.create({
      sequence: 'ATGAAAGTCCCCCC',
      features: [cds({ segments: [rangeSegment(0, 8, open)] })],
    });
    const svgGt = render(gt);
    expect(outlines(svgGt)).toHaveLength(1);
    expect(hatches(svgGt)).toHaveLength(1);
    expect(
      texts(svgGt)
        .filter((t) => /^[A-Z*]$/.test(t.text))
        .map((t) => t.text),
    ).toEqual(['M', 'K', 'V']);
    expect(ghostLetters(svgGt)).toEqual([]);
  });

  it('hatches the unfinished base of a reverse-strand CDS at its left end', () => {
    // complement(<3..9): reading the bottom strand from 9 down: ATG AAA then G at position 2.
    const doc = SeqDocument.create({
      sequence: `CC${reverseComplement('ATGAAAG')}CCCCC`,
      features: [
        cds({ strand: 'reverse', segments: [rangeSegment(2, 9, { partialStart: true })] }),
      ],
    });
    const svg = render(doc);
    expect(hatches(svg)).toHaveLength(1);
    expect(outlines(svg)[0]).toMatch(/^M120\.5 /);
    expect(
      texts(svg)
        .filter((t) => /^[A-Z*]$/.test(t.text))
        .map((t) => t.text),
    ).toEqual(['M', 'K']);
  });

  it('draws nothing of an unfinished end that the CDS closes', () => {
    const doc = SeqDocument.create({
      sequence: 'ATGAAAGCCCCCCC',
      features: [cds({ segments: [rangeSegment(0, 7)] })],
    });
    expect(outlines(render(doc))).toEqual([]);
    expect(hatches(render(doc))).toEqual([]);
  });

  it('uses the theme colours, so a dark theme carries over', () => {
    const dark = { ...theme, ink: '#ffffff', caret: '#5bb5d5', inkMuted: '#9aa8b4' };
    const svg = render(joined, true, null, { theme: dark });
    expect(svg).toContain('stroke="#5bb5d5"');
    expect(ghostLetters(svg)[0]).toBeDefined();
    expect(svg).toMatch(/fill="rgba\(255, 255, 255, 0\.35\)"/);
  });
});

describe('renderLinearView join gaps (#319)', () => {
  /** The gap marks: vertical paths in the cut-site colour with the join dash, as `M x y1 L x y2`. */
  function marks(svg: string, color = '#ff0000'): string[] {
    return [
      ...svg.matchAll(
        new RegExp(
          `<path d="([^"]*)" fill="none" stroke="${color}" stroke-width="1" stroke-dasharray="3 3"/>`,
          'g',
        ),
      ),
    ].map((m) => m[1] ?? '');
  }
  /** The chips' texts with their x. */
  function chips(svg: string): { text: string; x: number; y: number }[] {
    return texts(svg).filter((t) => / · \d+ bp$/.test(t.text));
  }
  /** The chip's outline: the pill path stroked in the muted ink, with its left x. */
  function pills(svg: string, color = '#888888'): number[] {
    return [
      ...svg.matchAll(
        new RegExp(`<path d="M([\\d.]+) [\\d.]+ L[^"]*A[^"]*" fill="none" stroke="${color}"`, 'g'),
      ),
    ].map((m) => Number(m[1]));
  }
  /** What a chip needs: its text in the sans font plus the padding on each side. */
  function chipWidth(text: string, font: string): number {
    const ctx = new SvgContext(1, 1);
    ctx.font = font;
    return ctx.measureText(text).width + 12;
  }
  const cds = (init: Partial<Parameters<typeof createFeature>[0]>) =>
    createFeature({ type: 'CDS', name: 'orf', segments: [], ...init });

  // 10 bases a row, 10 px a base, the sequence starting at x = 100. Row 0 is
  // 100 px tall (ruler 20, strands 40, one translation line, one lane), the
  // next starts at 110.
  const joined = SeqDocument.create({
    sequence: 'ATGAAAGCCCCCCTGAAACC',
    features: [cds({ segments: [rangeSegment(0, 7), rangeSegment(13, 19)] })],
  });

  it('marks the end of the earlier piece and the start of the later one, from the strands down through the lane', () => {
    const svg = render(joined);
    expect(marks(svg)).toEqual(['M170.5 20 L170.5 100', 'M130.5 130 L130.5 210']);
    // A gap of six bases has no room for its chip in either row; the tooltip has it.
    expect(chips(svg)).toEqual([]);
  });

  it('marks the same boundaries for a reverse-strand feature', () => {
    const doc = SeqDocument.create({
      sequence: 'ATGAAAGCCCCCCTGAAACC',
      features: [cds({ strand: 'reverse', segments: [rangeSegment(0, 7), rangeSegment(13, 19)] })],
    });
    expect(marks(render(doc))).toEqual(marks(render(joined)));
  });

  it('draws nothing for an order(...) or a feature in one piece', () => {
    const order = SeqDocument.create({
      sequence: 'ATGAAAGCCCCCCTGAAACC',
      features: [cds({ joining: 'order', segments: [rangeSegment(0, 7), rangeSegment(13, 19)] })],
    });
    expect(marks(render(order))).toEqual([]);
    const one = SeqDocument.create({
      sequence: 'ATGAAAGCCCCCCTGAAACC',
      features: [cds({ segments: [rangeSegment(0, 19)] })],
    });
    expect(marks(render(one))).toEqual([]);
  });

  it('draws one mark and no chip where two pieces touch', () => {
    const doc = SeqDocument.create({
      sequence: 'ATGAAAGCCCCCCTGAAACC',
      features: [cds({ segments: [rangeSegment(0, 5), rangeSegment(5, 9)] })],
    });
    const svg = render(doc);
    expect(marks(svg)).toEqual(['M150.5 20 L150.5 100']);
    expect(chips(svg)).toEqual([]);
  });

  it('puts the chip in the gap after the mark when it fits, outlined in the muted ink on the background', () => {
    // join(1..2,49..60): the gap 3-48 starts at column 2 of row 0, with 74 px to the row's edge.
    const doc = SeqDocument.create({
      sequence: 'ATGAAAGCCCCCCTGAAACCATGAAAGCCCCCCTGAAACCATGAAAGCCCCCCTGAAACC',
      features: [cds({ segments: [rangeSegment(0, 2), rangeSegment(48, 60)] })],
    });
    const sansFont = '6px sans-serif';
    expect(chipWidth('intron 3-48 · 46 bp', sansFont)).toBeLessThanOrEqual(74);
    const svg = render(doc, true, null, { sansFont });
    expect(chips(svg)).toEqual([{ text: 'intron 3-48 · 46 bp', x: 129, y: 90.5 }]);
    expect(pills(svg)).toEqual([123.5 + 7.5]);
    expect(svg).toMatch(/A[^"]*" fill="#ffffff" stroke="none"/);
    // Rows 1 to 3 hold no bar and no translation, so they are 60 px tall; row 4 starts at 320.
    expect(marks(svg)).toEqual(['M120.5 20 L120.5 100', 'M180.5 340 L180.5 420']);
  });

  it('moves the chip along the gap to a row where its lane is free of other bars', () => {
    // As above, with a feature packed into the same lane under the gap's part of row 0.
    const doc = SeqDocument.create({
      sequence: 'ATGAAAGCCCCCCTGAAACCATGAAAGCCCCCCTGAAACCATGAAAGCCCCCCTGAAACC',
      features: [
        cds({ segments: [rangeSegment(0, 2), rangeSegment(48, 60)] }),
        createFeature({ type: 'misc_feature', name: 'x', segments: [rangeSegment(5, 9)] }),
      ],
    });
    const sansFont = '6px sans-serif';
    const svg = render(doc, true, null, { sansFont });
    // Rows 1 to 3 hold no bar, so they keep no lane; row 4 has the lane, and 74 px before the mark.
    expect(chips(svg).map((c) => c.x)).toEqual([103 + 6]);
    expect(chips(svg)[0]?.y).toBeGreaterThan(400);
  });

  it('calls the gap of a feature that is not spliced a gap', () => {
    const doc = SeqDocument.create({
      sequence: 'ATGAAAGCCCCCCTGAAACCATGAAAGCCCCCCTGAAACCATGAAAGCCCCCCTGAAACC',
      features: [
        createFeature({
          type: 'misc_feature',
          name: 'rep',
          segments: [rangeSegment(0, 2), rangeSegment(48, 60)],
        }),
      ],
    });
    expect(
      chips(render(doc, true, null, { sansFont: '6px sans-serif' })).map((c) => c.text),
    ).toEqual(['gap 3-48 · 46 bp']);
  });

  it('marks a gap across the origin of a circular record at both ends', () => {
    // Length 20: join(15..18,3..8) leaves 19-20 and 1-2 between the pieces.
    const doc = SeqDocument.create({
      sequence: 'ATGAAAGCCCCCCTGAAACC',
      topology: 'circular',
      features: [cds({ segments: [rangeSegment(14, 18), rangeSegment(2, 8)] })],
    });
    const svg = render(doc);
    expect(marks(svg)).toEqual(['M120.5 20 L120.5 100', 'M180.5 130 L180.5 210']);
  });

  it('uses the theme colours, so a dark theme carries over', () => {
    const dark = { ...theme, cutSite: '#ff7b63', inkMuted: '#9aa8b4', background: '#12181e' };
    const doc = SeqDocument.create({
      sequence: 'ATGAAAGCCCCCCTGAAACCATGAAAGCCCCCCTGAAACCATGAAAGCCCCCCTGAAACC',
      features: [cds({ segments: [rangeSegment(0, 2), rangeSegment(48, 60)] })],
    });
    const svg = render(doc, true, null, { sansFont: '6px sans-serif', theme: dark });
    expect(marks(svg, '#ff7b63')).toHaveLength(2);
    expect(pills(svg, '#9aa8b4')).toHaveLength(1);
    expect(svg).toMatch(/A[^"]*" fill="#12181e" stroke="none"/);
  });
});
