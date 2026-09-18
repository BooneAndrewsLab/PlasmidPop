import { parseGenBank } from '@/io';
import { readFixture } from '@/test/fixtures';

import { exportLinearSvg } from './exportLinear';
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
});

describe('exportLinearSvg', () => {
  const doc = (() => {
    const d = parseGenBank(readFixture('J01749.gb')).documents[0];
    if (d === undefined) throw new Error('fixture');
    return d;
  })();
  const height = (svg: string): number => Number(/height="([\d.]+)"/.exec(svg)?.[1] ?? 0);

  it('draws the whole sequence: bases, ruler, features, white paper', () => {
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

  it('falls back to the whole sequence for a range that wraps the origin', () => {
    const wrapped = exportLinearSvg(doc, { range: { start: 4300, end: 4381 } });
    expect(height(wrapped)).toBe(height(exportLinearSvg(doc)));
  });

  it('honours complement, translations, cut sites, row width and transparency', () => {
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
