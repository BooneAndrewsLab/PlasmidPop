import { SeqDocument, createFeature, findCutSites, rangeSegment } from '@/core';
import { ENZYMES, cutLabel } from '@/core/analysis/restriction';
import { parseGenBank } from '@/io';
import { readFixture } from '@/test/fixtures';

import {
  A4_PAGE,
  LETTER_PAGE,
  countLinearSvgPages,
  exportLinearSvg,
  exportLinearSvgPages,
  measureLinearSvg,
} from './exportLinear';
import { exportMapSvg } from './exportMap';
import { SvgContext } from './svgContext';

/** Deterministic random bases from an integer LCG (no double-precision drift). */
function randomBases(n: number, seed: number): string {
  let s = seed >>> 0;
  let out = '';
  for (let i = 0; i < n; i++) {
    s = (Math.imul(s, 1103515245) + 12345) >>> 0;
    out += 'ACGT'.charAt((s >>> 16) & 3);
  }
  return out;
}

/** The text and position of every `<text>` element of an SVG. */
function svgLabels(svg: string): { x: number; y: number; text: string }[] {
  const re = /<text x="([-\d.]+)" y="([-\d.]+)"[^>]*>([^<]*)<\/text>/g;
  return [...svg.matchAll(re)].map((m) => ({
    x: Number(m[1]),
    y: Number(m[2]),
    text: m[3] ?? '',
  }));
}

describe('SvgContext', () => {
  it('records rectangles, paths, arcs and text', () => {
    const ctx = new SvgContext(100, 50);
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, 100, 50);
    ctx.strokeStyle = '#123456';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(10, 10);
    ctx.lineTo(20, 20);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(50, 25, 10, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(50, 25, 10, -Math.PI / 2, 0);
    ctx.fill();
    ctx.font = '600 15px Helvetica, Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#000';
    ctx.fillText('a <b> & "c"', 50, 25, 20);
    const svg = ctx.toSvg({ title: 'T' });
    expect(svg).toMatch(/^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" width="100" height="50"/);
    expect(svg).toContain('<title>T</title>');
    expect(svg).toContain('<rect x="0" y="0" width="100" height="50" fill="#fff"/>');
    expect(svg).toContain(
      '<path d="M10 10 L20 20" fill="none" stroke="#123456" stroke-width="2"/>',
    );
    // full circle = two half arcs
    expect(svg).toMatch(/<path d="M60 25 A10 10 0 0 1 40 25 A10 10 0 0 1 60 25" fill="none"/);
    expect(svg).toContain('<path d="M50 15 A10 10 0 0 1 60 25" fill="#fff" stroke="none"/>');
    expect(svg).toContain(
      'font-size="15" font-weight="600" text-anchor="middle" dominant-baseline="central"',
    );
    expect(svg).toContain('textLength="20"');
    expect(svg).toContain('a &lt;b&gt; &amp; &quot;c&quot;');
  });

  it('honours translation and save/restore', () => {
    const ctx = new SvgContext(10, 10);
    ctx.save();
    ctx.translate(5, 5);
    ctx.fillRect(0, 0, 1, 1);
    ctx.restore();
    ctx.fillRect(0, 0, 1, 1);
    const svg = ctx.toSvg();
    expect(svg).toContain('<rect x="5" y="5"');
    expect(svg).toContain('<rect x="0" y="0"');
    expect(ctx.measureText('abcd').width).toBeGreaterThan(0);
  });
});

describe('exportMapSvg', () => {
  const feat = (id: string, name: string, segs: [number, number][]) =>
    createFeature({
      id,
      type: 'CDS',
      name,
      segments: segs.map(([a, b]) => rangeSegment(a, b)),
    });

  it('(#158) control characters are not written into the SVG', () => {
    const doc = SeqDocument.create({
      sequence: 'ACGT'.repeat(100),
      name: 'a\u0001x',
      topology: 'circular',
      features: [feat('a', 'A \u0001\u0008 b', [[10, 50]])],
    });
    // eslint-disable-next-line no-control-regex
    expect(exportMapSvg(doc)).not.toMatch(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/);
  });

  it('(#158) a crowded map still exports some labels', () => {
    const features = Array.from({ length: 10000 }, (_, i) =>
      feat(`f${i}`, `feat${i}`, [[(i * 2) % 20000, ((i * 2) % 20000) + 1 + (i % 300)]]),
    );
    const doc = SeqDocument.create({
      sequence: 'ACGT'.repeat(5000),
      topology: 'circular',
      features,
    });
    expect(exportMapSvg(doc).match(/<text/g)?.length ?? 0).toBeGreaterThan(1);
  }, 30_000);

  it('labels a cut site with the same number as the enzyme panel (#155)', () => {
    const seq = 'A'.repeat(10) + 'GAATTC' + 'A'.repeat(100) + 'GGATCC' + 'T'.repeat(84);
    const doc = SeqDocument.create({ sequence: seq, topology: 'circular' });
    const cuts = findCutSites(
      seq,
      'circular',
      ENZYMES.filter((e) => e.name === 'EcoRI'),
    );
    expect(cuts[0]?.cut).toBe(11); // "cut after base 11" in the panel
    expect(exportMapSvg(doc, { cutSites: cuts })).toContain('EcoRI (11)');
  });

  // Folded in from the 2026-10-06 audit's map sweep: sites at, across and
  // cutting exactly at the origin, Type IIS on either strand, and a linear map.
  it.each([
    {
      name: 'EcoRI at 0',
      seq: 'GAATTC' + randomBases(300, 1),
      topology: 'circular',
      enzymes: ['EcoRI'],
    },
    {
      name: 'EcoRI across the origin',
      seq: 'ATTC' + randomBases(300, 2) + 'GA',
      topology: 'circular',
      enzymes: ['EcoRI'],
    },
    {
      name: 'EcoRI cutting at the origin',
      seq: 'AATTC' + randomBases(300, 3) + 'G',
      topology: 'circular',
      enzymes: ['EcoRI'],
    },
    {
      name: 'BsaI forward',
      seq: randomBases(100, 4) + 'GGTCTC' + randomBases(200, 5),
      topology: 'circular',
      enzymes: ['BsaI'],
    },
    {
      name: 'BsaI reverse',
      seq: randomBases(100, 6) + 'GAGACC' + randomBases(200, 7),
      topology: 'circular',
      enzymes: ['BsaI'],
    },
    {
      name: 'BsaI cutting past the origin',
      seq: randomBases(303, 8) + 'GGTCTC',
      topology: 'circular',
      enzymes: ['BsaI'],
    },
    {
      name: 'BsaI reverse cutting before the origin',
      seq: 'GAGACC' + randomBases(300, 10),
      topology: 'circular',
      enzymes: ['BsaI'],
    },
    {
      name: 'linear BsaI both ways and EcoRI',
      seq: randomBases(100, 11) + 'GAGACC' + randomBases(50, 12) + 'GGTCTC' + randomBases(20, 13),
      topology: 'linear',
      enzymes: ['BsaI', 'EcoRI'],
    },
    {
      name: 'linear EcoRI at the end',
      seq: randomBases(200, 14) + 'GAATTC',
      topology: 'linear',
      enzymes: ['EcoRI'],
    },
  ] as const)('labels every cut as the panel does: $name', ({ seq, topology, enzymes }) => {
    const doc = SeqDocument.create({ sequence: seq, topology });
    const sites = findCutSites(
      seq,
      topology,
      ENZYMES.filter((e) => (enzymes as readonly string[]).includes(e.name)),
    );
    expect(sites.length).toBeGreaterThan(0);
    const texts = svgLabels(exportMapSvg(doc, { cutSites: sites })).map((l) => l.text);
    for (const s of sites) {
      const n = cutLabel(s.cut, seq.length, topology);
      expect(n).toBeGreaterThan(0);
      expect(texts.some((t) => t.includes(`${s.enzyme} (${n.toLocaleString()})`))).toBe(true);
    }
    expect(texts.some((t) => t.endsWith('(0)'))).toBe(false);
  });

  // A multi-segment or origin-wrapping feature's label sits at the middle
  // of what the feature covers, not at a segment end or across the circle.
  describe.each([
    {
      name: 'split at the origin',
      segs: [
        [980, 1000],
        [0, 10],
      ],
      mid: 990,
    },
    { name: 'unrolled across the origin', segs: [[980, 1030]], mid: 5 },
    {
      name: 'unrolled plus a segment',
      segs: [
        [990, 1040],
        [100, 110],
      ],
      mid: 15,
    },
    {
      name: 'two equal segments',
      segs: [
        [100, 120],
        [500, 520],
      ],
      mid: 110,
    },
    { name: 'single segment', segs: [[200, 400]], mid: 300 },
    { name: 'nearly the whole circle', segs: [[10, 1005]], mid: 507.5 },
  ] as const)('label angle of a feature $name', ({ segs, mid }) => {
    it.each(['forward', 'reverse'] as const)('%s', (strand) => {
      const L = 1000;
      const doc = SeqDocument.create({
        sequence: randomBases(L, 42),
        topology: 'circular',
        features: [
          createFeature({
            id: 'a',
            type: 'misc_feature',
            name: 'Lbl',
            strand,
            segments: segs.map(([a, b]) => rangeSegment(a, b)),
          }),
        ],
      });
      const svg = exportMapSvg(doc);
      const size = Number(/viewBox="0 0 ([\d.]+)/.exec(svg)?.[1]);
      const label = svgLabels(svg).find((l) => l.text === 'Lbl');
      expect(label).toBeDefined();
      const c = size / 2;
      const turn =
        (Math.atan2((label?.y ?? 0) - c, (label?.x ?? 0) - c) + Math.PI / 2) / (2 * Math.PI);
      const at = (turn - Math.floor(turn)) * L;
      const d = Math.abs(at - mid);
      // The label is pushed sideways by collision layout, so allow a margin.
      expect(Math.min(d, L - d)).toBeLessThan(60);
    });
  });

  it('produces a standalone SVG of a real plasmid with labels', () => {
    const doc = parseGenBank(readFixture('J01749.gb')).documents[0];
    if (doc === undefined) throw new Error('fixture');
    const svg = exportMapSvg(doc, { size: 600 });
    expect(svg.startsWith('<svg ')).toBe(true);
    expect(svg.endsWith('</svg>')).toBe(true);
    expect(svg).toContain('>tet<');
    expect(svg).toContain('>bla<');
    expect(svg).toContain('>SYNPBR322<');
    expect(svg).toContain('>4,361 bp circular<');
    expect(svg).toContain('fill="#ffffff"');
    expect((svg.match(/<path /g) ?? []).length).toBeGreaterThan(20);
    expect(exportMapSvg(doc, { size: 300, transparent: true })).not.toContain('fill="#ffffff"/>');
  });

  it('grows the canvas rather than leaving labels out', () => {
    const parsed = parseGenBank(readFixture('J01749.gb')).documents[0];
    if (parsed === undefined) throw new Error('fixture');
    // Every feature named and every single cutter labelled: far more than a
    // small export can hold on one ring. The map on screen drops what will
    // not fit and hovering brings it back, but a figure has no hover, so the
    // export buys room instead — the circle is unchanged, the canvas grows.
    const doc = SeqDocument.create({
      name: parsed.name,
      sequence: parsed.sequence,
      topology: parsed.topology,
      features: parsed.features
        .all()
        .map((f, i) => (f.name === '' ? { ...f, name: `${f.type} ${i + 1}` } : f)),
    });
    const cuts = findCutSites(doc.sequence.toString(), doc.topology, ENZYMES);
    const counts = new Map<string, number>();
    for (const s of cuts) counts.set(s.enzyme, (counts.get(s.enzyme) ?? 0) + 1);
    const single = cuts.filter((s) => counts.get(s.enzyme) === 1);
    const size = 400;
    const svg = exportMapSvg(doc, { size, cutSites: single });
    const width = Number(/width="(\d+(?:\.\d+)?)"/.exec(svg)?.[1] ?? '0');
    expect(width).toBeGreaterThan(size);
    // A map that fits keeps the size it was asked for.
    expect(exportMapSvg(parsed, { size })).toContain(`width="${size}"`);
  });
});

describe('exportLinearSvg', () => {
  // Built in each test that needs it, not once while the file loads: work
  // done at load cannot be told apart per test by mutation testing (#77).
  const plasmid = () => {
    const doc = (() => {
      const d = parseGenBank(readFixture('J01749.gb')).documents[0];
      if (d === undefined) throw new Error('fixture');
      return d;
    })();
    return { doc };
  };
  const height = (svg: string): number => Number(/height="([\d.]+)"/.exec(svg)?.[1] ?? 0);
  /** The position each row starts at, as its number in the gutter (the only right-aligned text). */
  const rowNumbers = (svg: string): number[] =>
    [...svg.matchAll(/text-anchor="end"[^>]*>([\d,]+)</g)].map((m) =>
      Number((m[1] ?? '').replace(/,/g, '')),
    );

  it('draws the whole sequence: bases, ruler, features, white paper', () => {
    const { doc } = plasmid();
    const svg = exportLinearSvg(doc);
    expect(svg.startsWith('<svg ')).toBe(true);
    expect(svg.endsWith('</svg>')).toBe(true);
    expect(svg).toContain('<title>SYNPBR322 sequence</title>');
    expect(svg).toContain('4,361 bp');
    expect(svg).toContain('fill="#ffffff"');
    // First row: position label, forward bases and their complement.
    expect(svg).toContain('>1<');
    expect(svg).toContain('>ttctcatgtt<');
    expect(svg).toContain('>aagagtacaa<');
    expect(svg).toContain('>tet<');
  });

  it('exports only the rows holding a range, numbered as in the document', () => {
    const { doc } = plasmid();
    const whole = exportLinearSvg(doc);
    const part = exportLinearSvg(doc, {
      range: { start: 1000, end: 1050 },
      selection: { start: 1000, end: 1050 },
    });
    expect(height(part)).toBeLessThan(height(whole));
    // 60 bases per row, so the range starts in the row beginning at base 961.
    expect(part).toContain('>961<');
    expect(part).not.toContain('>1,381<');
    // The selection is highlighted.
    expect(part).toContain('fill="rgba(27, 110, 140, 0.18)"');
  });

  it('exports a range through the origin of a circle as its two stretches (#30)', () => {
    const { doc } = plasmid();
    // Bases 4,301 to 20, 1-based: the last two rows, then the first.
    const wrapped = exportLinearSvg(doc, { range: { start: 4300, end: 4361 + 20 } });
    expect(rowNumbers(wrapped)).toEqual([4261, 4321, 1]);
    expect(wrapped).toContain('bases 4,261–4,361, 1–60 of 4,361 bp');
    expect(height(wrapped)).toBeLessThan(height(exportLinearSvg(doc)));
    // Each stretch is drawn on its own, one under the other.
    expect(wrapped.match(/<svg y="/g)).toHaveLength(2);
  });

  it('refuses a range through the origin of a linear sequence', () => {
    const { doc } = plasmid();
    const linear = doc.setTopology('linear');
    expect(() => exportLinearSvg(linear, { range: { start: 4300, end: 4381 } })).toThrow(
      /circular/,
    );
  });

  it('lays the rows out at the bases per row asked for (#30)', () => {
    const { doc } = plasmid();
    const range = { start: 999, end: 2000 };
    expect(rowNumbers(exportLinearSvg(doc, { range, basesPerRow: 100 }))).toEqual(
      Array.from({ length: 11 }, (_, i) => 901 + i * 100),
    );
    expect(rowNumbers(exportLinearSvg(doc, { basesPerRow: 200 }))).toHaveLength(22);
    expect(rowNumbers(exportLinearSvg(doc, { basesPerRow: 10, range }))).toHaveLength(101);
    expect(exportLinearSvg(doc, { range, basesPerRow: 100 })).toContain(
      'bases 901–2,000 of 4,361 bp',
    );
  });

  it('honours complement, translations, cut sites, row width and transparency', () => {
    const { doc } = plasmid();
    const plain = exportLinearSvg(doc, { showComplement: false });
    expect(height(plain)).toBeLessThan(height(exportLinearSvg(doc)));
    expect(plain).not.toContain('>aagagtacaa<');

    const sites = [
      { enzyme: 'EcoRI', cut: 100, cutBottom: 104, siteStart: 100, strand: 'forward' },
    ] as const;
    const cut = exportLinearSvg(doc, { cutSites: sites });
    expect(cut).toContain('>EcoRI<');

    const narrow = exportLinearSvg(doc, { basesPerRow: 30 });
    expect(Number(/width="([\d.]+)"/.exec(narrow)?.[1] ?? 0)).toBeLessThan(
      Number(/width="([\d.]+)"/.exec(exportLinearSvg(doc))?.[1] ?? 0),
    );

    expect(exportLinearSvg(doc, { transparent: true })).not.toContain('fill="#ffffff"/>');
  });

  it('translates coding features when asked', () => {
    const { doc } = plasmid();
    const svg = exportLinearSvg(doc, {
      range: { start: 86, end: 200 },
      showTranslations: true,
    });
    expect(svg).toContain('font-size="13"');
    expect(height(svg)).toBeGreaterThan(
      height(exportLinearSvg(doc, { range: { start: 86, end: 200 } })),
    );
  });

  it('numbers the residues as the view does (#97)', () => {
    const { doc } = plasmid();
    // The residue numbers are the only text at 0.85 of the 11 px label size.
    const numbers = (svg: string): number[] =>
      [...svg.matchAll(/font-size="9.35"[^>]*>([\d,]+)</g)].map((m) =>
        Number((m[1] ?? '').replace(/,/g, '')),
      );
    // Rows 61–240 hold the first 52 codons of the CDS at 86..1276.
    const range = { start: 86, end: 200 };
    const tens = exportLinearSvg(doc, { range, showTranslations: true });
    expect(numbers(tens)).toEqual([1, 10, 20, 30, 40, 50]);
    const every = exportLinearSvg(doc, {
      range,
      showTranslations: true,
      residueNumbering: 'every',
    });
    expect(numbers(every)).toEqual(Array.from({ length: 52 }, (_, i) => i + 1));
    const off = exportLinearSvg(doc, { range, showTranslations: true, residueNumbering: 'off' });
    expect(numbers(off)).toEqual([]);
    // Without numbers the amino-acid lines give back their band.
    expect(height(off)).toBeLessThan(height(tens));
    expect(height(every)).toBe(height(tens));
  });
});

describe('exportLinearSvgPages (#30)', () => {
  const doc = () => {
    const d = parseGenBank(readFixture('J01749.gb')).documents[0];
    if (d === undefined) throw new Error('fixture');
    return d;
  };
  const rowNumbers = (svg: string): number[] =>
    [...svg.matchAll(/text-anchor="end"[^>]*>([\d,]+)</g)].map((m) =>
      Number((m[1] ?? '').replace(/,/g, '')),
    );

  it('measures the figure without drawing it (#243)', () => {
    const d = doc();
    const whole = measureLinearSvg(d, { basesPerRow: 60 });
    const root = /<svg[^>]*width="([\d.]+)" height="([\d.]+)"/.exec(
      exportLinearSvg(d, { basesPerRow: 60 }),
    );
    expect(whole.width).toBe(Number(root?.[1]));
    expect(whole.height).toBe(Number(root?.[2]));
    expect(whole.rows).toBe(Math.ceil(d.length / 60));
    expect(whole.pages).toBe(countLinearSvgPages(d, { basesPerRow: 60 }));
    // A range through the origin is its two stretches stacked, so their heights add.
    const wrapped = measureLinearSvg(d, {
      basesPerRow: 60,
      range: { start: 4300, end: d.length + 70 },
    });
    expect(wrapped.rows).toBe(4);
    expect(wrapped.width).toBe(whole.width);
    expect(wrapped.height).toBeLessThan(whole.height);
  });

  it('splits the rows over A4 pages, every row once and in order', () => {
    const d = doc();
    const pages = exportLinearSvgPages(d);
    expect(pages.length).toBeGreaterThan(1);
    expect(pages).toHaveLength(countLinearSvgPages(d));
    for (const page of pages) {
      expect(page).toMatch(/^<svg [^>]*width="210mm" height="297mm" viewBox="0 0 793.7 1122.52"/);
    }
    const rows = pages.flatMap(rowNumbers);
    expect(rows).toEqual(Array.from({ length: 73 }, (_, i) => 1 + i * 60));
    // Each page says what it holds.
    expect(pages[0]).toContain('SYNPBR322 — bases 1–');
    expect(pages[0]).toContain(`page 1 of ${pages.length}`);
    expect(pages.at(-1)).toContain(`–4,361 of 4,361 bp — page ${pages.length} of ${pages.length}`);
  });

  it('fits the content inside the margins, scaled down to the width and never up', () => {
    const d = doc();
    const scaleOf = (svg: string): number => Number(/scale\(([\d.]+)\)/.exec(svg)?.[1] ?? 0);
    expect(scaleOf(exportLinearSvgPages(d)[0] ?? '')).toBe(1);
    const wide = exportLinearSvgPages(d, { basesPerRow: 200 });
    const width = Number(/width="([\d.]+)"/.exec(exportLinearSvg(d, { basesPerRow: 200 }))?.[1]);
    const fit = scaleOf(wide[0] ?? '');
    expect(fit).toBeLessThan(1);
    expect(width * fit).toBeLessThanOrEqual(A4_PAGE.width - 2 * A4_PAGE.margin + 0.01);
    // Scaled down, 200-base rows take fewer pages than 60-base ones.
    expect(wide.length).toBeLessThan(exportLinearSvgPages(d).length);
  });

  it('lays pages out on US Letter when asked (#245)', () => {
    const d = doc();
    const a4 = exportLinearSvgPages(d, { basesPerRow: 90 });
    const letter = exportLinearSvgPages(d, { basesPerRow: 90, paper: 'letter' });
    expect(exportLinearSvgPages(d, { basesPerRow: 90, paper: 'a4' })).toEqual(a4);
    for (const page of letter) {
      expect(page).toMatch(/^<svg [^>]*width="215.9mm" height="279.4mm" viewBox="0 0 816 1056"/);
    }
    // Letter is shorter than A4, so the same rows take more pages.
    expect(letter.length).toBeGreaterThan(a4.length);
    expect(letter).toHaveLength(countLinearSvgPages(d, { basesPerRow: 90, paper: 'letter' }));
    expect(measureLinearSvg(d, { basesPerRow: 90, paper: 'letter' }).pages).toBe(letter.length);
    expect(letter.flatMap(rowNumbers)).toEqual(Array.from({ length: 49 }, (_, i) => 1 + i * 90));
    // The footer sits in the bottom margin of the Letter page.
    expect(letter[0]).toContain(`y="${String(LETTER_PAGE.height - LETTER_PAGE.margin)}"`);
  });

  it('pages a range through the origin, and a short range on one page', () => {
    const d = doc();
    const pages = exportLinearSvgPages(d, { range: { start: 4300, end: 4361 + 20 } });
    expect(pages).toHaveLength(1);
    expect(rowNumbers(pages[0] ?? '')).toEqual([4261, 4321, 1]);
    expect(pages[0]).toContain('bases 4,261–4,361, 1–60 of 4,361 bp — page 1 of 1');
  });
});

describe('SvgContext alpha and clipping (#126)', () => {
  it('writes the alpha as opacity on fills, strokes and text, and not at 1', () => {
    const ctx = new SvgContext(50, 50);
    ctx.fillStyle = '#ff0000';
    ctx.globalAlpha = 0.25;
    ctx.fillRect(0, 0, 5, 5);
    ctx.fillText('A', 1, 1);
    ctx.strokeStyle = '#00f';
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(4, 4);
    ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.fillRect(6, 6, 2, 2);
    const svg = ctx.toSvg();
    expect(svg.match(/fill-opacity="0.25"/g)).toHaveLength(2);
    expect(svg).toContain('stroke-opacity="0.25"');
    expect(svg.match(/opacity/g)).toHaveLength(3);
  });

  it('clips what is drawn until the matching restore, and closes a group left open', () => {
    const ctx = new SvgContext(50, 50);
    ctx.save();
    ctx.beginPath();
    ctx.rect(10, 10, 20, 20);
    ctx.clip();
    ctx.fillRect(0, 0, 50, 50);
    ctx.restore();
    ctx.fillRect(1, 1, 2, 2);
    ctx.beginPath();
    ctx.rect(0, 0, 5, 5);
    ctx.clip();
    ctx.fillRect(2, 2, 2, 2);
    const svg = ctx.toSvg();
    expect(svg).toContain(
      '<clipPath id="clip1"><path d="M10 10H30V30H10Z"/></clipPath><g clip-path="url(#clip1)">',
    );
    // The first group ends before the unclipped rectangle; the second is closed at the end.
    expect(svg).toMatch(/<\/g><rect x="1" y="1"/);
    expect(svg.match(/<g /g)).toHaveLength(2);
    expect(svg.match(/<\/g>/g)).toHaveLength(2);
    expect(ctx.body().match(/<\/g>/g)).toHaveLength(2);
  });

  it('ignores a clip with no path and keeps the translation across it', () => {
    const ctx = new SvgContext(50, 50);
    ctx.beginPath();
    ctx.clip();
    ctx.translate(5, 5);
    ctx.fillRect(0, 0, 1, 1);
    expect(ctx.toSvg()).not.toContain('<g ');
    expect(ctx.toSvg()).toContain('<rect x="5" y="5"');
  });
});

describe('exportMapSvg figure options (#212)', () => {
  const doc = parseGenBank(readFixture('J01749.gb')).documents[0];
  if (doc === undefined) throw new Error('fixture');

  it('can leave out the centre text', () => {
    expect(exportMapSvg(doc)).toContain('>4,361 bp circular<');
    expect(exportMapSvg(doc, { showCentre: false })).not.toContain('>4,361 bp circular<');
  });

  it('draws only the chosen feature types', () => {
    const all = exportMapSvg(doc);
    const some = exportMapSvg(doc, { featureTypes: new Set(['rep_origin']) });
    expect(some.length).toBeLessThan(all.length);
    const paths = (x: string) => (x.match(/<path/g) ?? []).length;
    expect(paths(some)).toBeLessThan(paths(all));
    expect(exportMapSvg(doc, { featureTypes: new Set() })).not.toContain('stroke-width="11"');
  });

  it('scales the text', () => {
    expect(exportMapSvg(doc, { fontScale: 2 })).toContain('font-size');
    expect(exportMapSvg(doc, { fontScale: 2 })).not.toBe(exportMapSvg(doc));
  });
});

describe('exportLinear: what the figure is made of (mutation triage, 1.16)', () => {
  const plasmid = () => {
    const d = parseGenBank(readFixture('J01749.gb')).documents[0];
    if (d === undefined) throw new Error('fixture');
    return d;
  };
  const plain = (n: number, topology: 'linear' | 'circular' = 'linear'): SeqDocument =>
    SeqDocument.create({ sequence: randomBases(n, 7), topology, name: 'Plain' });
  const rootSize = (svg: string): { w: number; h: number } => ({
    w: Number(/^<svg[^>]*? width="([\d.]+)"/.exec(svg)?.[1]),
    h: Number(/^<svg[^>]*? height="([\d.]+)"/.exec(svg)?.[1]),
  });
  const rowNumbers = (svg: string): number[] =>
    [...svg.matchAll(/text-anchor="end"[^>]*>([\d,]+)</g)].map((m) =>
      Number((m[1] ?? '').replace(/,/g, '')),
    );

  it('says what it shows in its description: the length, or the bases of a range', () => {
    const d = plain(300);
    expect(exportLinearSvg(d)).toContain(
      '<desc>300 bp, linear. Exported from PlasmidPop.</desc><svg y="0" ',
    );
    expect(exportLinearSvg(d, { range: { start: 70, end: 130 } })).toContain(
      '<desc>bases 61–180 of 300 bp, linear. Exported from PlasmidPop.</desc>',
    );
  });

  it('refuses more than 100,000 bases, counting every stretch of a range', () => {
    expect(() => measureLinearSvg(plain(100_000))).not.toThrow();
    expect(() => measureLinearSvg(plain(100_001))).toThrow(
      'The sequence view export is limited to 100,000 bases; select a shorter range.',
    );
    // The bases counted are those of the rows the range holds, from the first of them.
    expect(() =>
      measureLinearSvg(plain(100_020), { range: { start: 120, end: 100_020 } }),
    ).not.toThrow();
    // Two stretches of a circle, each under the limit, together over it.
    const circle = plain(66_000, 'circular');
    expect(() => measureLinearSvg(circle, { range: { start: 600, end: 66_000 + 65_000 } })).toThrow(
      'limited to 100,000 bases',
    );
    // ...and together under it.
    expect(() =>
      measureLinearSvg(circle, { range: { start: 40_000, end: 66_000 + 30_000 } }),
    ).not.toThrow();
  });

  it('starts the first row below its top padding, which later rows do not carry', () => {
    const d = plain(240);
    const row = (i: number) => measureLinearSvg(d, { range: { start: 60 * i, end: 60 * i + 60 } });
    expect(row(0).height).toBeGreaterThan(row(1).height);
    expect(row(1).height).toBe(row(2).height);
  });

  it('leaves the translation numbers off, as the view does, unless translations are on', () => {
    const d = plasmid();
    const range = { start: 86, end: 200 };
    const base = exportLinearSvg(d, { range });
    expect(exportLinearSvg(d, { range, residueNumbering: 'every' })).toBe(base);
    expect(base).not.toContain('font-size="9.35"');
  });

  it('keeps the base colours, the numbering beside the complement and the cut-site labels as asked', () => {
    const d = plain(120);
    const base = exportLinearSvg(d);
    expect(exportLinearSvg(d, { colorBases: false })).toBe(base);
    const coloured = exportLinearSvg(d, { colorBases: true });
    expect(coloured).not.toBe(base);
    const custom = exportLinearSvg(d, {
      colorBases: true,
      baseColors: { a: '#123456', c: '#234567', g: '#345678', t: '#456789' },
    });
    for (const c of ['#123456', '#234567', '#345678', '#456789']) {
      expect(custom).toContain(c);
      expect(coloured).not.toContain(c);
    }
    expect(exportLinearSvg(d, { colorBases: true, baseColors: null })).toBe(coloured);
    // Without colours of its own the print palette tints each of the four bases.
    const baseFills = (svg: string): Set<string> =>
      new Set([...svg.matchAll(/fill="(#[0-9a-f]{6})">[ACGTacgt ]+</g)].map((m) => m[1] ?? ''));
    expect(baseFills(coloured).size).toBeGreaterThanOrEqual(4);
    expect(rowNumbers(exportLinearSvg(d, { numberComplement: true })).length).toBeGreaterThan(
      rowNumbers(base).length,
    );
    expect(exportLinearSvg(d, { numberComplement: false })).toBe(base);
    const sites = [
      { enzyme: 'EcoRI', cut: 10, cutBottom: 14, siteStart: 10, strand: 'forward' },
    ] as const;
    expect(rootSize(exportLinearSvg(d, { cutSites: sites })).h).toBeGreaterThan(rootSize(base).h);
  });

  it('draws a sticky end’s bottom strand in a gutter of its own width', () => {
    const seq = randomBases(60, 3);
    const sticky = (left: "5'" | "3'", right: "5'" | "3'") =>
      SeqDocument.create({
        sequence: seq,
        topology: 'linear',
        ends: {
          left: { kind: left, overhang: 'ACGT', enzyme: 'X' },
          right: { kind: right, overhang: 'TGCA', enzyme: 'Y' },
        },
      });
    const wide = rootSize(exportLinearSvg(sticky("3'", "5'"))).w;
    const none = rootSize(exportLinearSvg(plain(60))).w;
    // Four columns at each end, of 0.6 em at 13 px.
    expect(wide - none).toBeCloseTo(8 * 7.8, 1);
  });

  it('exports a read’s trace at the height asked for, and none for a document that has none', () => {
    const n = 60;
    const channel = () => Int16Array.from({ length: n * 8 }, (_, i) => (i * 37) % 900);
    const read = {
      qualities: Uint8Array.from({ length: n }, () => 30),
      trace: {
        channels: { A: channel(), C: channel(), G: channel(), T: channel() },
        peaks: Int32Array.from({ length: n }, (_, i) => i * 8 + 4),
      },
    };
    const d = plain(n);
    const withTrace = d.setRead(read);
    const h = (doc: SeqDocument, trace?: 'off' | 'short' | 'tall'): number =>
      rootSize(exportLinearSvg(doc, trace === undefined ? {} : { trace })).h;
    expect(h(withTrace, 'off')).toBe(h(d));
    expect(h(withTrace)).toBe(h(withTrace, 'short'));
    expect(h(withTrace, 'short')).toBeGreaterThan(h(d));
    expect(h(withTrace, 'tall')).toBeGreaterThan(h(withTrace, 'short'));
    const noTrace = d.setRead({ qualities: read.qualities, trace: null });
    expect(h(noTrace, 'tall')).toBe(h(d));
  });

  it('writes numbers with at most two decimals and no trailing zeros', () => {
    // Font sizes whose rows come to within a hundredth of a whole number of pixels.
    for (const fontSize of [13.0001, 13.0004, 13.001, 13.0029, 12.9993, 11.0002, 15.0003]) {
      const svg = exportLinearSvg(plain(60), { fontSize });
      for (const m of svg.matchAll(/(?:width|height|y|x)="([\d.]+)"/g)) {
        expect(m[1], `${String(fontSize)}: ${m[0]}`).not.toMatch(/\.\d*0$/);
      }
    }
  });
});

describe('exportLinearSvgPages: where the pages break (mutation triage, 1.16)', () => {
  const plain = (n: number): SeqDocument =>
    SeqDocument.create({ sequence: randomBases(n, 11), topology: 'circular', name: 'Pg' });
  const rowNumbers = (svg: string): number[] =>
    [...svg.matchAll(/text-anchor="end"[^>]*>([\d,]+)</g)].map((m) =>
      Number((m[1] ?? '').replace(/,/g, '')),
    );
  const room = (g: typeof A4_PAGE): number => g.height - 2 * g.margin - g.footer;
  /** What each row costs on a page: the figure of that row alone. */
  const costs = (d: SeqDocument, perRow: number, fontSize: number): number[] =>
    Array.from(
      { length: Math.ceil(d.length / perRow) },
      (_, i) =>
        measureLinearSvg(d, {
          basesPerRow: perRow,
          fontSize,
          range: { start: i * perRow, end: (i + 1) * perRow },
        }).height,
    );
  /** Each page holds as many rows as fit, and the next row would not have. */
  const expectFilled = (
    d: SeqDocument,
    perRow: number,
    fontSize: number,
    paper: 'a4' | 'letter',
  ): void => {
    const geometry = paper === 'a4' ? A4_PAGE : LETTER_PAGE;
    const cost = costs(d, perRow, fontSize);
    const pages = exportLinearSvgPages(d, { basesPerRow: perRow, fontSize, paper });
    const what = `${paper} at ${String(fontSize)} px`;
    let row = 0;
    pages.forEach((page, i) => {
      const rows = rowNumbers(page).length;
      const used = cost.slice(row, row + rows).reduce((a, b) => a + b, 0);
      expect(used, `${what}, page ${String(i + 1)} fits`).toBeLessThanOrEqual(room(geometry));
      const next = cost[row + rows];
      if (next !== undefined)
        expect(used + next, `${what}, page ${String(i + 1)} is full`).toBeGreaterThan(
          room(geometry),
        );
      row += rows;
    });
    expect(row).toBe(cost.length);
  };

  for (const paper of ['a4', 'letter'] as const) {
    it(`fills each ${paper} page with as many rows as fit, and starts the next with the one that does not`, () => {
      expectFilled(plain(60 * 40), 60, 13, paper);
    });
  }

  it('does so wherever the first row’s top padding tips a page over, at any text size', () => {
    const d = plain(50 * 40);
    for (let size = 9; size <= 14; size += 0.25) expectFilled(d, 50, size, 'a4');
  });

  it('gives a row taller than a page a page of its own, scaled to fit, with no empty page before it', () => {
    // Eighty features over the first ten bases pile into as many lanes.
    const features = Array.from({ length: 80 }, (_, i) =>
      createFeature({
        id: `f${String(i)}`,
        type: 'misc_feature',
        name: `F${String(i)}`,
        segments: [rangeSegment(0, 10)],
      }),
    );
    const d = SeqDocument.create({
      sequence: randomBases(30, 5),
      topology: 'linear',
      name: 'Tall',
      features,
    });
    const options = { basesPerRow: 10 } as const;
    const first = measureLinearSvg(d, { ...options, range: { start: 0, end: 10 } }).height;
    expect(first).toBeGreaterThan(room(A4_PAGE));
    const pages = exportLinearSvgPages(d, options);
    expect(pages.map((p) => rowNumbers(p))).toEqual([[1], [11, 21]]);
    const scale = Number(/scale\(([\d.]+)\)/.exec(pages[0] ?? '')?.[1]);
    expect(scale).toBeCloseTo(room(A4_PAGE) / first, 2);
    expect(scale).toBeLessThan(1);
    expect(countLinearSvgPages(d, options)).toBe(2);
  });

  it('writes a scale with its leading zero, and paper only unless transparent', () => {
    const d = plain(60 * 6);
    const [page] = exportLinearSvgPages(d, { basesPerRow: 200 });
    expect(page).toMatch(/scale\(0\.\d+\)/);
    const rect = `<rect x="0" y="0" width="793.7" height="1122.52" fill="#ffffff"/>`;
    expect(page).toContain(rect);
    const [clear] = exportLinearSvgPages(d, { basesPerRow: 200, transparent: true });
    expect(clear).not.toContain('<rect x="0" y="0" width="793.7"');
    // Nothing stands in for the paper: the figure follows the description directly.
    expect(clear).toMatch(/<\/desc><g transform=/);
  });

  it('titles and describes each page', () => {
    const d = plain(60 * 40);
    const pages = exportLinearSvgPages(d, { basesPerRow: 60 });
    expect(pages.length).toBeGreaterThan(1);
    expect(pages[0]).toContain(`<title>Pg sequence, page 1 of ${String(pages.length)}</title>`);
    expect(pages[1]).toContain(`<title>Pg sequence, page 2 of ${String(pages.length)}</title>`);
    expect(pages[0]).toMatch(
      /<desc>Bases 1–\d+ of 2,400 bp, circular\. Exported from PlasmidPop\.<\/desc>/,
    );
  });

  it('does not leave an empty stretch in a page when a range’s second stretch starts a new one', () => {
    const d = plain(60 * 40);
    const cost = costs(d, 60, 13);
    // As many of the last rows as one page holds, then the first row, which cannot join them.
    let k = 0;
    let used = 0;
    while (used + (cost[39 - k] ?? 0) <= room(A4_PAGE)) {
      used += cost[39 - k] ?? 0;
      k++;
    }
    const pages = exportLinearSvgPages(d, {
      basesPerRow: 60,
      range: { start: 60 * (40 - k), end: 2400 + 30 },
    });
    expect(pages).toHaveLength(2);
    expect(rowNumbers(pages[0] ?? '')).toHaveLength(k);
    expect(rowNumbers(pages[1] ?? '')).toEqual([1]);
    expect(pages[0]).not.toContain('height="0"');
  });
});
