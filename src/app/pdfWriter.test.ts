// @vitest-environment jsdom
import { readFileSync } from 'node:fs';

import { parseGenBank } from '@/io';
import { exportLinearSvg, exportLinearSvgPages, exportMapSvg } from '@/view/svg';

import { exportPdf } from './pdfExport';
import { writePdf } from './pdfWriter';

function pbr322() {
  const doc = parseGenBank(readFileSync('src/io/fixtures/J01749.gb', 'utf8')).documents[0];
  if (doc === undefined) throw new Error('fixture');
  return doc;
}

/** A 1 × 1 PNG, as a canvas would hand one back. */
const PNG = new Blob(
  [
    Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
      'base64',
    ),
  ],
  { type: 'image/png' },
);

// svg2pdf measures text (for text-anchor and textLength) with the browser's
// own metrics, through a canvas or an SVG text node's getBBox; jsdom has
// neither, so the test lends it Courier's 0.6 em advance for every glyph.
beforeAll(() => {
  Object.defineProperty(SVGElement.prototype, 'getBBox', {
    configurable: true,
    value(this: SVGElement) {
      const size = Number.parseFloat(this.getAttribute('font-size') ?? '16');
      return { x: 0, y: 0, width: this.textContent.length * size * 0.6, height: size };
    },
  });
});

async function text(pdf: Blob): Promise<string> {
  expect(pdf.type).toBe('application/pdf');
  // Latin-1 keeps the bytes as they are: the structure is ASCII, the streams are not.
  return new TextDecoder('latin1').decode(await pdf.arrayBuffer());
}

const pageCount = (pdf: string): number => (pdf.match(/\/Type\s*\/Page\b(?!s)/g) ?? []).length;
/** Each page's size in points, rounded to a hundredth. */
const mediaBoxes = (pdf: string): string[] =>
  [...pdf.matchAll(/\/MediaBox \[([^\]]+)\]/g)].map((m) =>
    (m[1] ?? '')
      .split(' ')
      .map((n) => Number(n).toFixed(2))
      .join(' '),
  );

describe('writePdf (#242)', () => {
  it('writes the A4 page SVGs as one A4 PDF of as many pages, as vectors', async () => {
    const pages = exportLinearSvgPages(pbr322(), { basesPerRow: 60 });
    expect(pages.length).toBeGreaterThan(1);
    const pdf = await text(await writePdf(pages, { mode: 'vector', title: 'pBR322 sequence' }));
    expect(pdf.startsWith('%PDF-1.')).toBe(true);
    expect(pageCount(pdf)).toBe(pages.length);
    // 210 × 297 mm in points.
    expect(new Set(mediaBoxes(pdf))).toEqual(new Set(['0.00 0.00 595.28 841.89']));
    // Text is text, in the standard fonts, not pictures.
    expect(pdf).toMatch(/\/BaseFont\s*\/Courier\b/);
    expect(pdf).toMatch(/\/BaseFont\s*\/Helvetica\b/);
    expect(pdf).not.toMatch(/\/Subtype\s*\/Image/);
    expect(pdf).toContain('/Title (pBR322 sequence)');
    expect(pdf).toContain('/Creator (PlasmidPop)');
  });

  it('writes Letter page SVGs as 612 × 792 pt pages (#245)', async () => {
    const pages = exportLinearSvgPages(pbr322(), { basesPerRow: 60, paper: 'letter' });
    expect(pages.length).toBeGreaterThan(1);
    const pdf = await text(await writePdf(pages, { mode: 'vector', title: 'pBR322 sequence' }));
    expect(pageCount(pdf)).toBe(pages.length);
    expect(new Set(mediaBoxes(pdf))).toEqual(new Set(['0.00 0.00 612.00 792.00']));
  });

  it('gives a single figure a page of its own size', async () => {
    const svg = exportLinearSvg(pbr322(), { basesPerRow: 60, range: { start: 0, end: 120 } });
    const width = Number(/width="([\d.]+)"/.exec(svg)?.[1]);
    const height = Number(/height="([\d.]+)"/.exec(svg)?.[1]);
    const pdf = await text(await writePdf([svg], { mode: 'vector', title: 'x' }));
    expect(pageCount(pdf)).toBe(1);
    // CSS pixels at 96 to the inch are 0.75 points each.
    expect(mediaBoxes(pdf)).toEqual([
      `0.00 0.00 ${(width * 0.75).toFixed(2)} ${(height * 0.75).toFixed(2)}`,
    ]);
  });

  it('rounds the map title’s weight 600 to bold rather than losing the font', async () => {
    const svg = exportMapSvg(pbr322(), { cutSites: [], edits: null });
    expect(svg).toContain('font-weight="600"');
    const warnings: string[] = [];
    const warn = vi.spyOn(console, 'warn').mockImplementation((m: unknown) => {
      warnings.push(String(m));
    });
    try {
      const pdf = await text(await writePdf([svg], { mode: 'vector', title: 'map' }));
      expect(pdf).toMatch(/\/BaseFont\s*\/Helvetica-Bold\b/);
      expect(warnings.filter((w) => /font/i.test(w))).toEqual([]);
    } finally {
      warn.mockRestore();
    }
  });

  it('rasterises each page at the scale asked for and places it as a picture', async () => {
    const pages = exportLinearSvgPages(pbr322(), { basesPerRow: 60 }).slice(0, 3);
    const calls: { svg: string; scale: number }[] = [];
    const pdf = await text(
      await writePdf(pages, {
        mode: 'raster',
        title: 'pictures',
        scale: 4,
        rasterize: (svg, scale) => {
          calls.push({ svg, scale });
          return Promise.resolve(PNG);
        },
      }),
    );
    expect(calls.map((c) => c.scale)).toEqual([4, 4, 4]);
    expect(calls.map((c) => c.svg)).toEqual(pages);
    expect(pageCount(pdf)).toBe(3);
    expect(new Set(mediaBoxes(pdf))).toEqual(new Set(['0.00 0.00 595.28 841.89']));
    // The same 1 × 1 picture three times is stored once and placed on each page.
    expect(pdf).toMatch(/\/Subtype\s*\/Image/);
    expect(pdf).toMatch(/\/Width 1\b/);
  });

  it('refuses no pages and a page without a size', async () => {
    await expect(writePdf([], { mode: 'vector', title: 'x' })).rejects.toThrow(
      'There is no page to write.',
    );
    await expect(writePdf(['<svg></svg>'], { mode: 'vector', title: 'x' })).rejects.toThrow(
      'The page has no size to draw.',
    );
  });
});

describe('exportPdf', () => {
  it('loads the writer on demand and writes the same PDF', async () => {
    const svg = exportLinearSvg(pbr322(), { basesPerRow: 60, range: { start: 0, end: 60 } });
    const pdf = await text(await exportPdf([svg], { mode: 'vector', title: 'one' }));
    expect(pageCount(pdf)).toBe(1);
  });
});
