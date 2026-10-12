import { strToU8, zipSync } from 'fflate';

import { DEFAULT_ZIP_LIMITS, isZip, readZip, writeZip } from './zip';

function zip(files: Record<string, string>): Uint8Array {
  return zipSync(Object.fromEntries(Object.entries(files).map(([k, v]) => [k, strToU8(v)])));
}

describe('readZip (#213)', () => {
  it('recognises a ZIP by its signature', () => {
    expect(isZip(zip({ 'a.txt': 'x' }))).toBe(true);
    expect(isZip(strToU8('LOCUS'))).toBe(false);
    expect(isZip(new Uint8Array([0x50, 0x4b]))).toBe(false);
  });

  it('reads files with their paths', () => {
    const { entries, skipped } = readZip(zip({ 'a.gb': 'one', 'dir/b.gb': 'two' }));
    expect(entries.map((e) => e.path).sort()).toEqual(['a.gb', 'dir/b.gb']);
    expect(new TextDecoder().decode(entries.find((e) => e.path === 'dir/b.gb')?.data)).toBe('two');
    expect(skipped).toEqual([]);
  });

  it('drops folders and archive noise silently', () => {
    const { entries, skipped } = readZip(
      zip({
        'dir/': '',
        '__MACOSX/dir/._a.gb': 'x',
        '.DS_Store': 'x',
        'dir/Thumbs.db': 'x',
        'dir/a.gb': 'ok',
      }),
    );
    expect(entries.map((e) => e.path)).toEqual(['dir/a.gb']);
    expect(skipped).toEqual([]);
  });

  it('reports names that point outside the archive', () => {
    const { entries, skipped } = readZip(zip({ '../evil.gb': 'x', '/abs.gb': 'x', 'ok.gb': 'x' }));
    expect(entries.map((e) => e.path)).toEqual(['ok.gb']);
    expect(skipped.map((s) => s.path).sort()).toEqual(['../evil.gb', '/abs.gb']);
  });

  it('reports a file over the per-file limit and refuses one over the total', () => {
    const data = zip({ 'big.gb': 'x'.repeat(100), 'small.gb': 'x' });
    const r = readZip(data, { ...DEFAULT_ZIP_LIMITS, maxEntryBytes: 10 });
    expect(r.entries.map((e) => e.path)).toEqual(['small.gb']);
    expect(r.skipped).toEqual([{ path: 'big.gb', reason: 'Too large to open' }]);
    expect(() => readZip(data, { ...DEFAULT_ZIP_LIMITS, maxTotalBytes: 50 })).toThrow(/too large/);
  });

  it('refuses an archive with too many files', () => {
    const data = zip({ 'a.gb': 'x', 'b.gb': 'x', 'c.gb': 'x' });
    expect(() => readZip(data, { ...DEFAULT_ZIP_LIMITS, maxEntries: 2 })).toThrow(/more than 2/);
  });

  it('refuses what is not an archive, and what is damaged', () => {
    expect(() => readZip(strToU8('LOCUS x'))).toThrow('not a ZIP');
    const data = zip({ 'a.gb': 'x'.repeat(500) });
    expect(() => readZip(data.slice(0, data.length - 30))).toThrow(/damaged/);
  });
});

describe('writeZip (#203)', () => {
  it('writes what readZip reads back', () => {
    const bytes = writeZip([
      { path: 'a.json', data: new TextEncoder().encode('{"a":1}') },
      { path: 'dir/b.bin', data: new Uint8Array([0, 1, 2, 255]) },
    ]);
    expect(isZip(bytes)).toBe(true);
    const { entries } = readZip(bytes);
    expect(entries.map((e) => e.path).sort()).toEqual(['a.json', 'dir/b.bin']);
    expect(Array.from(entries.find((e) => e.path === 'dir/b.bin')?.data ?? [])).toEqual([
      0, 1, 2, 255,
    ]);
  });

  it('refuses paths a reader would not accept, and duplicates', () => {
    const data = new Uint8Array(1);
    expect(() => writeZip([{ path: '../x', data }])).toThrow();
    expect(() => writeZip([{ path: '/x', data }])).toThrow();
    expect(() => writeZip([{ path: 'dir/', data }])).toThrow();
    expect(() => writeZip([{ path: '', data }])).toThrow();
    expect(() => writeZip([{ path: '.hidden', data }])).toThrow();
    expect(() =>
      writeZip([
        { path: 'a', data },
        { path: 'a', data },
      ]),
    ).toThrow();
  });
});
