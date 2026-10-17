import { MAX_PNG_SIDE } from './mapPng';
import { defaultPaper, pngProblem } from './exportFigure';

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
