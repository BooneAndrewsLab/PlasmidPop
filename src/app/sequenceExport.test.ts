import { SeqDocument } from '@/core';

import { downloadPages, rangeBoxes, readBasesPerRow, readExportRange } from './sequenceExport';

const circle = SeqDocument.create({ name: 'c', sequence: 'ACGT'.repeat(25), topology: 'circular' });
const line = SeqDocument.create({ name: 'l', sequence: 'ACGT'.repeat(25) });

describe('readExportRange (#30)', () => {
  it('reads 1-based inclusive boxes as a 0-based half-open range', () => {
    expect(readExportRange(line, 'custom', null, '11', '20')).toEqual({
      ok: true,
      range: { start: 10, end: 20 },
      suffix: '11-20',
    });
    expect(readExportRange(line, 'custom', null, '1', '100')).toMatchObject({
      range: { start: 0, end: 100 },
    });
    expect(readExportRange(line, 'custom', null, '7', '7')).toMatchObject({
      range: { start: 6, end: 7 },
    });
  });

  it('runs through the origin of a circle when to comes before from', () => {
    expect(readExportRange(circle, 'custom', null, '91', '10')).toEqual({
      ok: true,
      range: { start: 90, end: 110 },
      suffix: '91-10',
    });
    const refused = readExportRange(line, 'custom', null, '91', '10');
    expect(refused.ok).toBe(false);
    expect(!refused.ok && refused.message).toMatch(/circular/);
  });

  it('refuses positions off the sequence or not numbers', () => {
    for (const [f, t] of [
      ['0', '10'],
      ['1', '101'],
      ['', '5'],
      ['a', '5'],
      ['1.5', '5'],
    ] as const) {
      expect(readExportRange(line, 'custom', null, f, t)).toMatchObject({
        ok: false,
        message: 'From and to are bases 1 to 100.',
      });
    }
    expect(readExportRange(line, 'custom', null, '1,0', '2 0')).toMatchObject({ ok: true });
  });

  it('takes the whole sequence, or the selection as it is', () => {
    expect(readExportRange(line, 'whole', null, '', '')).toEqual({
      ok: true,
      range: null,
      suffix: 'sequence',
    });
    const wrap = { start: 95, end: 105 };
    expect(readExportRange(circle, 'selection', wrap, '', '')).toEqual({
      ok: true,
      range: wrap,
      suffix: 'selection',
    });
    expect(readExportRange(circle, 'selection', null, '', '')).toMatchObject({ ok: false });
  });

  it('shows a range in the boxes the way it is read back', () => {
    expect(rangeBoxes(circle, { start: 95, end: 105 })).toEqual({ from: '96', to: '5' });
    expect(rangeBoxes(line, { start: 10, end: 20 })).toEqual({ from: '11', to: '20' });
    const { from, to } = rangeBoxes(circle, { start: 95, end: 105 });
    expect(readExportRange(circle, 'custom', null, from, to)).toMatchObject({
      range: { start: 95, end: 105 },
    });
  });
});

describe('readBasesPerRow', () => {
  it('takes 10 to 200', () => {
    expect(readBasesPerRow('60')).toBe(60);
    expect(readBasesPerRow('10')).toBe(10);
    expect(readBasesPerRow('200')).toBe(200);
    expect(readBasesPerRow('9')).toBeNull();
    expect(readBasesPerRow('201')).toBeNull();
    expect(readBasesPerRow('sixty')).toBeNull();
  });
});

describe('downloadPages', () => {
  it('downloads each page as a numbered file, spaced out', () => {
    vi.useFakeTimers();
    try {
      const names: string[] = [];
      downloadPages('pX_sequence', ['<svg>1</svg>', '<svg>2</svg>', '<svg>3</svg>'], (n) =>
        names.push(n),
      );
      expect(names).toEqual(['pX_sequence_p01.svg']);
      vi.advanceTimersByTime(1000);
      expect(names).toEqual(['pX_sequence_p01.svg', 'pX_sequence_p02.svg', 'pX_sequence_p03.svg']);
    } finally {
      vi.useRealTimers();
    }
  });
});
