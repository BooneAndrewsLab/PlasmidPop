import { SeqDocument, findCutSites } from '@/core';
import { ENZYMES } from '@/core/analysis/restriction';
import { parseGenBank } from '@/io';
import { readFixture } from '@/test/fixtures';

import {
  A4_PAGE,
  countLinearSvgPages,
  exportLinearSvg,
  exportLinearSvgPages,
} from './exportLinear';
import { exportMapSvg } from './exportMap';
import { SvgContext } from './svgContext';

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
  it('produces a standalone SVG of a real plasmid with labels', () => {
    const doc = parseGenBank(readFixture('J01749.gb')).documents[0];
    if (doc === undefined) throw new Error('fixture');
    const svg = exportMapSvg(doc, { size: 600 });
    expect(svg.startsWith('<svg ')).toBe(true);
    expect(svg.endsWith('</svg>')).toBe(true);
    expect(svg).toContain('>tet<');
    expect(svg).toContain('>bla<');
    expect(svg).toContain('>SYNPBR322<');
    expect(svg).toContain('>4,361 bp<');
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

  it('pages a range through the origin, and a short range on one page', () => {
    const d = doc();
    const pages = exportLinearSvgPages(d, { range: { start: 4300, end: 4361 + 20 } });
    expect(pages).toHaveLength(1);
    expect(rowNumbers(pages[0] ?? '')).toEqual([4261, 4321, 1]);
    expect(pages[0]).toContain('bases 4,261–4,361, 1–60 of 4,361 bp — page 1 of 1');
  });
});
