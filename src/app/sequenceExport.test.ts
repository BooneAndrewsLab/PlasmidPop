import { SeqDocument } from '@/core';

import { readZip } from '@/io';

import {
  pageFileName,
  pagesZip,
  rangeBoxes,
  readBasesPerRow,
  readExportRange,
} from './sequenceExport';

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
    // Each limit is checked on its own, from and to, low and high.
    const bad = { ok: false, message: 'From and to are bases 1 to 100.' };
    for (const [f, t] of [
      ['5', '0'],
      ['5', 'x'],
      ['x', '5'],
      ['101', '5'],
      ['5', '101'],
      ['0', '0'],
      ['101', '101'],
    ] as const) {
      expect(readExportRange(circle, 'custom', null, f, t)).toEqual(bad);
    }
    // The ends themselves are fine: 1 and L, to equal to 1, from equal to L.
    expect(readExportRange(circle, 'custom', null, '100', '100')).toMatchObject({ ok: true });
    expect(readExportRange(circle, 'custom', null, '100', '1')).toMatchObject({ ok: true });
    expect(readExportRange(circle, 'custom', null, '1', '1')).toMatchObject({ ok: true });
    expect(readExportRange(circle, 'custom', null, '1', '100')).toMatchObject({ ok: true });
    // Surrounding blanks and separators are ignored.
    expect(readExportRange(line, 'custom', null, ' 1 0 ', '2,0')).toMatchObject({
      range: { start: 9, end: 20 },
    });
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
    expect(readExportRange(circle, 'selection', null, '', '')).toEqual({
      ok: false,
      message: 'Nothing is selected.',
    });
    expect(readExportRange(circle, 'selection', { start: 5, end: 5 }, '', '')).toEqual({
      ok: false,
      message: 'Nothing is selected.',
    });
    // A whole or custom export never looks at the selection.
    expect(readExportRange(line, 'whole', { start: 5, end: 5 }, '', '')).toMatchObject({
      ok: true,
    });
    expect(readExportRange(line, 'custom', null, '1', '5')).toMatchObject({ ok: true });
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
    expect(readBasesPerRow('')).toBeNull();
    expect(readBasesPerRow('0')).toBeNull();
    expect(readBasesPerRow(' 1 2 ')).toBe(12);
  });
});

describe('pagesZip (#242)', () => {
  it('names the pages _p01 onwards, with as many digits as the count needs', () => {
    expect(pageFileName('pX_sequence', 'svg', 0, 3)).toBe('pX_sequence_p01.svg');
    expect(pageFileName('pX_sequence', 'png', 2, 3)).toBe('pX_sequence_p03.png');
    expect(pageFileName('pX', 'svg', 99, 100)).toBe('pX_p100.svg');
    expect(pageFileName('pX', 'svg', 0, 100)).toBe('pX_p001.svg');
  });

  it('holds every page as a file of its own, bytes intact, in order', async () => {
    const pages = ['<svg>1</svg>', '<svg>2</svg>', '<svg>3</svg>'].map((t) =>
      new TextEncoder().encode(t),
    );
    const zip = await pagesZip('pX_sequence', 'svg', pages);
    expect(zip.type).toBe('application/zip');
    const { entries, skipped } = readZip(new Uint8Array(await zip.arrayBuffer()));
    expect(skipped).toEqual([]);
    expect(entries.map((e) => e.path)).toEqual([
      'pX_sequence_p01.svg',
      'pX_sequence_p02.svg',
      'pX_sequence_p03.svg',
    ]);
    expect(entries.map((e) => new TextDecoder().decode(e.data))).toEqual([
      '<svg>1</svg>',
      '<svg>2</svg>',
      '<svg>3</svg>',
    ]);
  });

  it('keeps binary pages byte for byte', async () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 1, 2, 255]);
    const zip = await pagesZip('pX', 'png', [png, png.slice(0, 4)]);
    const { entries } = readZip(new Uint8Array(await zip.arrayBuffer()));
    expect(entries.map((e) => e.path)).toEqual(['pX_p01.png', 'pX_p02.png']);
    expect([...(entries[0]?.data ?? [])]).toEqual([...png]);
    expect([...(entries[1]?.data ?? [])]).toEqual([0x89, 0x50, 0x4e, 0x47]);
  });
});
