// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { deflateSync, inflateSync } from 'node:zlib';

import { parseGenBank } from '@/io';
import { exportLinearSvg, exportLinearSvgPages, exportMapSvg } from '@/view/svg';

import { ExportCancelledError, type ExportProgress } from './exportJob';
import { exportPdf } from './pdfExport';
import { writeRasterPdf, writeVectorPdf } from './pdfWriter';

function pbr322() {
  const doc = parseGenBank(readFileSync('src/io/fixtures/J01749.gb', 'utf8')).documents[0];
  if (doc === undefined) throw new Error('fixture');
  return doc;
}

/** A 1 × 1 PNG, as a canvas would hand one back. */
const PNG_BYTES = new Uint8Array(
  Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
    'base64',
  ),
);
const PNG = new Blob([PNG_BYTES], { type: 'image/png' });

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

async function text(pdf: Blob | Uint8Array): Promise<string> {
  const bytes = pdf instanceof Blob ? new Uint8Array(await pdf.arrayBuffer()) : pdf;
  if (pdf instanceof Blob) expect(pdf.type).toBe('application/pdf');
  // Latin-1 keeps the bytes as they are: the structure is ASCII, the streams are not.
  return new TextDecoder('latin1').decode(bytes);
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

const A4 = '0.00 0.00 595.28 841.89';

describe('writeVectorPdf (#242)', () => {
  it('writes the A4 page SVGs as one A4 PDF of as many pages, as vectors', async () => {
    const pages = exportLinearSvgPages(pbr322(), { basesPerRow: 60 });
    expect(pages.length).toBeGreaterThan(1);
    const pdf = await text(await writeVectorPdf(pages, 'pBR322 sequence'));
    expect(pdf.startsWith('%PDF-1.')).toBe(true);
    expect(pageCount(pdf)).toBe(pages.length);
    // 210 × 297 mm in points.
    expect(new Set(mediaBoxes(pdf))).toEqual(new Set([A4]));
    // Text is text, in the standard fonts, not pictures.
    expect(pdf).toMatch(/\/BaseFont\s*\/Courier\b/);
    expect(pdf).toMatch(/\/BaseFont\s*\/Helvetica\b/);
    expect(pdf).not.toMatch(/\/Subtype\s*\/Image/);
    expect(pdf).toContain('/Title (pBR322 sequence)');
    expect(pdf).toContain('/Creator (PlasmidPop)');
  });

  it('reports each page drawn, before the first and after every one (#246, #248)', async () => {
    const pages = exportLinearSvgPages(pbr322(), { basesPerRow: 60 });
    const seen: ExportProgress[] = [];
    await writeVectorPdf(pages, 'x', { onProgress: (p) => seen.push(p) });
    expect(seen).toEqual(
      Array.from({ length: pages.length + 1 }, (_, i) => ({
        stage: 'drawing',
        done: i,
        total: pages.length,
      })),
    );
  });

  it('stops when its signal is aborted, drawing no page after that (#248)', async () => {
    const pages = exportLinearSvgPages(pbr322(), { basesPerRow: 60 });
    const controller = new AbortController();
    const seen: number[] = [];
    await expect(
      writeVectorPdf(pages, 'x', {
        signal: controller.signal,
        onProgress: ({ done }) => {
          seen.push(done);
          if (done === 2) controller.abort();
        },
      }),
    ).rejects.toBeInstanceOf(ExportCancelledError);
    expect(seen).toEqual([0, 1, 2]);
  });

  it('writes Letter page SVGs as 612 × 792 pt pages (#245)', async () => {
    const pages = exportLinearSvgPages(pbr322(), { basesPerRow: 60, paper: 'letter' });
    expect(pages.length).toBeGreaterThan(1);
    const pdf = await text(await writeVectorPdf(pages, 'pBR322 sequence'));
    expect(pageCount(pdf)).toBe(pages.length);
    expect(new Set(mediaBoxes(pdf))).toEqual(new Set(['0.00 0.00 612.00 792.00']));
  });

  it('gives a single figure a page of its own size', async () => {
    const svg = exportLinearSvg(pbr322(), { basesPerRow: 60, range: { start: 0, end: 120 } });
    const width = Number(/width="([\d.]+)"/.exec(svg)?.[1]);
    const height = Number(/height="([\d.]+)"/.exec(svg)?.[1]);
    const pdf = await text(await writeVectorPdf([svg], 'x'));
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
      const pdf = await text(await writeVectorPdf([svg], 'map'));
      expect(pdf).toMatch(/\/BaseFont\s*\/Helvetica-Bold\b/);
      expect(warnings.filter((w) => /font/i.test(w))).toEqual([]);
    } finally {
      warn.mockRestore();
    }
  });

  describe('font weights', () => {
    const weighted = (weight: string): string =>
      `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100"><text x="10" y="50" font-family="Helvetica" font-size="12" font-weight="${weight}">Hi</text></svg>`;
    /** Whether the text is set in a bold font: the fonts the page's content stream selects. */
    const bold = async (weight: string): Promise<boolean> => {
      const pdf = Buffer.from(await writeVectorPdf([weighted(weight)], 'w')).toString('latin1');
      const fonts = new Map<string, string>();
      for (const m of pdf.matchAll(/(\d+) 0 obj\n<<[^>]*?\/BaseFont \/(\S+)/g))
        fonts.set(m[1] ?? '', m[2] ?? '');
      const names = new Map<string, string>();
      for (const m of pdf.matchAll(/\/(F\d+) (\d+) 0 R/g))
        names.set(m[1] ?? '', fonts.get(m[2] ?? '') ?? '');
      const used: string[] = [];
      for (const m of pdf.matchAll(/stream\n([\s\S]*?)\nendstream/g)) {
        const content = inflateSync(Buffer.from(m[1] ?? '', 'latin1')).toString('latin1');
        for (const f of content.matchAll(/\/(F\d+) [\d.]+ Tf/g))
          used.push(names.get(f[1] ?? '') ?? '');
      }
      expect(used.length).toBeGreaterThan(0);
      return used.every((f) => f.endsWith('-Bold'));
    };

    it('rounds numeric weights to bold from 600 up and to normal below, and keeps names', async () => {
      expect(await bold('600')).toBe(true);
      expect(await bold('700')).toBe(true);
      expect(await bold('599')).toBe(false);
      expect(await bold('400')).toBe(false);
      expect(await bold('bold')).toBe(true);
      expect(await bold('normal')).toBe(false);
    });
  });

  it('gives each page its own size and orientation, wide pages included', async () => {
    const sized = (w: number, h: number): string =>
      `<svg xmlns="http://www.w3.org/2000/svg" width="${String(w)}" height="${String(h)}"><rect width="5" height="5"/></svg>`;
    const pdf = await text(
      await writeVectorPdf([sized(400, 200), sized(100, 300), sized(300, 100)], 'x'),
    );
    expect(mediaBoxes(pdf)).toEqual([
      '0.00 0.00 300.00 150.00',
      '0.00 0.00 75.00 225.00',
      '0.00 0.00 225.00 75.00',
    ]);
  });

  it('compresses what it writes', async () => {
    const svg = exportLinearSvg(pbr322(), { basesPerRow: 60, range: { start: 0, end: 120 } });
    expect(await text(await writeVectorPdf([svg], 'x'))).toContain('/FlateDecode');
  });

  it('refuses a page whose root is not an SVG element', async () => {
    await expect(
      writeVectorPdf(['<!-- <svg width="10" height="10"> --><div/>'], 'x'),
    ).rejects.toThrow('The figure is not an SVG picture.');
  });

  it('refuses no pages and a page without a size', async () => {
    await expect(writeVectorPdf([], 'x')).rejects.toThrow('There is no page to write.');
    await expect(writeVectorPdf(['<svg></svg>'], 'x')).rejects.toThrow(
      'The page has no size to draw.',
    );
  });
});

describe('writeRasterPdf (#248)', () => {
  const a4 = { width: 793.7007874015749, height: 1122.5196850393702 };

  it('places each PNG on a page of its own size, reporting each page written', async () => {
    const seen: ExportProgress[] = [];
    const pdf = await text(
      await writeRasterPdf(
        [
          { png: PNG_BYTES, ...a4 },
          { png: PNG_BYTES, ...a4 },
          { png: PNG_BYTES, width: 816, height: 1056 },
        ],
        'pictures',
        { onProgress: (p) => seen.push(p) },
      ),
    );
    expect(pageCount(pdf)).toBe(3);
    expect(mediaBoxes(pdf)).toEqual([A4, A4, '0.00 0.00 612.00 792.00']);
    // The same 1 × 1 picture three times is stored once and placed on each page.
    expect(pdf).toMatch(/\/Subtype\s*\/Image/);
    expect(pdf).toMatch(/\/Width 1\b/);
    expect(pdf).toContain('/Title (pictures)');
    expect(seen).toEqual([0, 1, 2, 3].map((done) => ({ stage: 'writing', done, total: 3 })));
  });

  it('stops between pages when its signal is aborted', async () => {
    const controller = new AbortController();
    const pages = Array.from({ length: 4 }, () => ({ png: PNG_BYTES, ...a4 }));
    await expect(
      writeRasterPdf(pages, 'x', {
        signal: controller.signal,
        onProgress: ({ done }) => {
          if (done === 1) controller.abort();
        },
      }),
    ).rejects.toBeInstanceOf(ExportCancelledError);
  });

  it('stores a picture compressed', async () => {
    // A 64 × 64 gradient, 12 KB as pixels: written uncompressed it is over 15 KB.
    const w = 64;
    const raw = Buffer.alloc((w * 3 + 1) * w);
    for (let y = 0; y < w; y++)
      for (let x = 0; x < w * 3; x++) raw[y * (w * 3 + 1) + 1 + x] = (x * y) & 255;
    const table = Array.from({ length: 256 }, (_, n) => {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      return c >>> 0;
    });
    const crc = (b: Buffer): number => {
      let c = 0xffffffff;
      for (const v of b) c = (table[(c ^ v) & 255] ?? 0) ^ (c >>> 8);
      return (c ^ 0xffffffff) >>> 0;
    };
    const chunk = (type: string, data: Buffer): Buffer => {
      const length = Buffer.alloc(4);
      length.writeUInt32BE(data.length);
      const body = Buffer.concat([Buffer.from(type), data]);
      const sum = Buffer.alloc(4);
      sum.writeUInt32BE(crc(body));
      return Buffer.concat([length, body, sum]);
    };
    const header = Buffer.alloc(13);
    header.writeUInt32BE(w, 0);
    header.writeUInt32BE(w, 4);
    header[8] = 8;
    header[9] = 2;
    const png = Buffer.concat([
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
      chunk('IHDR', header),
      chunk('IDAT', deflateSync(raw)),
      chunk('IEND', Buffer.alloc(0)),
    ]);
    const pdf = await writeRasterPdf([{ png: new Uint8Array(png), width: w, height: w }], 'x');
    expect(pdf.length).toBeLessThan(8000);
  });

  it('refuses no pages', async () => {
    await expect(writeRasterPdf([], 'x')).rejects.toThrow('There is no page to write.');
  });
});

describe('exportPdf', () => {
  it('loads the writer on demand and writes the same vector PDF', async () => {
    const svg = exportLinearSvg(pbr322(), { basesPerRow: 60, range: { start: 0, end: 60 } });
    const pdf = await text(await exportPdf([svg], { mode: 'vector', title: 'one' }));
    expect(pageCount(pdf)).toBe(1);
  });

  it('rasterises each page at the scale asked for, then writes them, saying which stage it is in', async () => {
    const pages = exportLinearSvgPages(pbr322(), { basesPerRow: 60 }).slice(0, 3);
    const calls: { svg: string; scale: number }[] = [];
    const seen: ExportProgress[] = [];
    const pdf = await text(
      await exportPdf(pages, {
        mode: 'raster',
        title: 'pictures',
        scale: 4,
        rasterize: (svg, scale) => {
          calls.push({ svg, scale });
          return Promise.resolve(PNG);
        },
        onProgress: (p) => seen.push(p),
      }),
    );
    expect(calls.map((c) => c.scale)).toEqual([4, 4, 4]);
    expect(calls.map((c) => c.svg)).toEqual(pages);
    expect(pageCount(pdf)).toBe(3);
    expect(new Set(mediaBoxes(pdf))).toEqual(new Set([A4]));
    expect(pdf).toMatch(/\/Subtype\s*\/Image/);
    expect(seen).toEqual([
      ...[0, 1, 2, 3].map((done) => ({ stage: 'drawing', done, total: 3 })),
      ...[0, 1, 2, 3].map((done) => ({ stage: 'writing', done, total: 3 })),
    ]);
  });

  it('a raster PDF stopped while drawing rasterises no further page and writes nothing', async () => {
    const pages = exportLinearSvgPages(pbr322(), { basesPerRow: 60 }).slice(0, 4);
    const controller = new AbortController();
    let drawn = 0;
    const seen: ExportProgress[] = [];
    await expect(
      exportPdf(pages, {
        mode: 'raster',
        title: 'x',
        scale: 1,
        rasterize: () => {
          drawn++;
          return Promise.resolve(PNG);
        },
        signal: controller.signal,
        onProgress: (p) => {
          seen.push(p);
          if (p.done === 2) controller.abort();
        },
      }),
    ).rejects.toBeInstanceOf(ExportCancelledError);
    expect(drawn).toBe(2);
    expect(seen.every((p) => p.stage === 'drawing')).toBe(true);
  });
});
