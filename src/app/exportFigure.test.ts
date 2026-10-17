import { MAX_PNG_SIDE } from './mapPng';
import { defaultPaper, pagesBudget, pagesProblem, pngProblem, workingText } from './exportFigure';
import {
  MAX_EXPORT_PAGES,
  MAX_PNG_ZIP_MEGAPIXELS,
  MAX_RASTER_PDF_MEGAPIXELS,
} from './sequenceExport';

describe('export figure size advice (#243)', () => {
  it('is null while the picture fits', () => {
    expect(
      pngProblem({ width: 900, height: 900 }, 4, 'map', { basesPerRow: 60, pages: false }),
    ).toBeNull();
    expect(
      pngProblem({ width: MAX_PNG_SIDE / 4, height: 10 }, 4, 'sequence', {
        basesPerRow: 60,
        pages: false,
      }),
    ).toBeNull();
  });

  it('names the largest scale that still fits, from the limit', () => {
    // 5,000 px a side: 2x is 10,000 (fits), 4x is 20,000 (does not).
    expect(
      pngProblem({ width: 5000, height: 5000 }, 4, 'map', { basesPerRow: 60, pages: false }),
    ).toBe(
      'At 4× the picture would be 20,000 × 20,000 pixels, more than a browser draws (16,384): choose 2× or less.',
    );
    // 9,000 px a side: only 1x fits.
    expect(
      pngProblem({ width: 9000, height: 9000 }, 2, 'map', { basesPerRow: 60, pages: false }),
    ).toContain('choose 1× or less.');
  });

  it('tells the sequence view what row width would fit, or to use pages', () => {
    // A tall figure of 600 x 12,000 at 4x is 48,000 px: at 60 a row it would
    // need about three times the row width to come under the limit.
    const message = pngProblem({ width: 600, height: 12_000 }, 4, 'sequence', {
      basesPerRow: 60,
      pages: false,
    });
    expect(message).toBe(
      'At 4× the picture would be 2,400 × 48,000 pixels, more than a browser draws (16,384): choose 1× or less, about 180 or more bases per row or split into pages.',
    );
    // Past the widest row offered, only pages or a shorter range help.
    expect(
      pngProblem({ width: 600, height: 60_000 }, 1, 'sequence', { basesPerRow: 60, pages: false }),
    ).toBe(
      'At 1× the picture would be 600 × 60,000 pixels, more than a browser draws (16,384): about 200 or more bases per row or split into pages.',
    );
  });

  it('says nothing about rows once the pages are what is drawn', () => {
    expect(
      pngProblem({ width: 20_000, height: 20_000 }, 1, 'sequence', {
        basesPerRow: 60,
        pages: true,
      }),
    ).toBe(
      'At 1× the picture would be 20,000 × 20,000 pixels, more than a browser draws (16,384).',
    );
  });
});

describe('the default paper (#245)', () => {
  it('is US Letter for the Letter countries, by the first locale with a region', () => {
    for (const l of ['en-US', 'en-CA', 'fr-CA', 'es-MX', 'en_US', 'en-us', 'fil-PH'])
      expect(defaultPaper([l]), l).toBe('letter');
    expect(defaultPaper(['zh-Hant-US'])).toBe('letter');
  });

  it('is A4 elsewhere, and when no locale names a region', () => {
    for (const l of ['en-GB', 'de-DE', 'fr-FR', 'en-AU', 'ja-JP', 'en', 'fr', 'es-419', ''])
      expect(defaultPaper([l]), l).toBe('a4');
    expect(defaultPaper([])).toBe('a4');
  });

  it('goes by the first locale only', () => {
    expect(defaultPaper(['en-GB', 'en-US'])).toBe('a4');
    expect(defaultPaper(['en-US', 'en-GB'])).toBe('letter');
    expect(defaultPaper(['', 'en-US'])).toBe('letter');
  });
});

describe('export page limits (#246)', () => {
  // A4 in CSS pixels: 3.5663 MP at 2x.
  const a4 = { width: 793.7, height: 1122.52 };
  const mp = (n: number, k: number): number => (n * a4.width * k * (a4.height * k)) / 1e6;

  it('has a page count limit that SVG and vector PDF share, at its boundary', () => {
    for (const output of ['svg', 'pdf-vector'] as const) {
      expect(pagesProblem(MAX_EXPORT_PAGES, a4, 4, output)).toBeNull();
      expect(pagesProblem(MAX_EXPORT_PAGES + 1, a4, 4, output)).toMatch(
        /^That is 1,001 pages, more than the 1,000 one export holds: choose a shorter range or more bases per row\.$/,
      );
    }
  });

  it('counts pixels for a ZIP of PNGs at its boundary', () => {
    const fits = Math.floor(MAX_PNG_ZIP_MEGAPIXELS / mp(1, 2));
    expect(mp(fits, 2)).toBeLessThanOrEqual(MAX_PNG_ZIP_MEGAPIXELS);
    expect(mp(fits + 1, 2)).toBeGreaterThan(MAX_PNG_ZIP_MEGAPIXELS);
    expect(pagesProblem(fits, a4, 2, 'png')).toBeNull();
    const message = pagesProblem(fits + 1, a4, 2, 'png') ?? '';
    expect(message).toContain('more than a ZIP of PNGs holds (3,000)');
    expect(message).toContain('choose 1× or less');
    expect(message).toContain(`at most ${String(fits)} pages`);
    // The most pages the dialog can lay out at 2x are within the budget.
    expect(pagesProblem(834, a4, 2, 'png')).toBeNull();
  });

  it('counts pixels for a raster PDF at its boundary, and offers Vector', () => {
    const fits = Math.floor(MAX_RASTER_PDF_MEGAPIXELS / mp(1, 2));
    expect(pagesProblem(fits, a4, 2, 'pdf-raster')).toBeNull();
    const message = pagesProblem(fits + 1, a4, 2, 'pdf-raster') ?? '';
    expect(message).toContain('more than a raster PDF holds (600)');
    expect(message).toContain('switch to Vector');
    expect(message).toContain(`at most ${String(fits)} pages`);
    // The 40 pages at 4x the old cap allowed still go.
    expect(pagesProblem(40, a4, 4, 'pdf-raster')).toBeNull();
  });

  it('suggests only scales that fit, and omits the scale advice when none does', () => {
    expect(pagesProblem(300, a4, 4, 'pdf-raster')).toContain('choose 1× or less');
    const none = pagesProblem(900, a4, 1, 'pdf-raster') ?? '';
    expect(none).not.toContain('or less');
    expect(none).toContain('switch to Vector');
    expect(none).toContain('at most 673 pages');
  });

  it('has a budget for rasterised output only', () => {
    expect(pagesBudget('svg')).toBeNull();
    expect(pagesBudget('pdf-vector')).toBeNull();
    expect(pagesBudget('png')).toBe(3000);
    expect(pagesBudget('pdf-raster')).toBe(600);
  });
});

describe('the status line while a file is made (#247, #248)', () => {
  it('names the stage and the page of how many, and the file or picture when there is no page', () => {
    expect(workingText(null)).toBe('Getting your file ready…');
    expect(workingText({ stage: 'drawing', done: 0, total: 139 })).toBe(
      'Getting your file ready: drawing page 1 of 139…',
    );
    expect(workingText({ stage: 'drawing', done: 11, total: 139 })).toBe(
      'Getting your file ready: drawing page 12 of 139…',
    );
    expect(workingText({ stage: 'writing', done: 3, total: 139 })).toBe(
      'Getting your file ready: writing page 4 of 139…',
    );
    // Every page drawn, the file not yet started: nothing to count.
    expect(workingText({ stage: 'drawing', done: 139, total: 139 })).toBe(
      'Getting your file ready: writing the file…',
    );
    expect(workingText({ stage: 'writing', done: 139, total: 139 })).toBe(
      'Getting your file ready: writing the file…',
    );
    // One picture: the ZIP's deflate, or a single page.
    expect(workingText({ stage: 'writing', done: 0, total: 1 })).toBe(
      'Getting your file ready: writing the file…',
    );
    expect(workingText({ stage: 'drawing', done: 0, total: 1 })).toBe(
      'Getting your file ready: drawing the picture…',
    );
  });
});
