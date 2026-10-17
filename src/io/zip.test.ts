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

  it('accepts only the local-header and empty-archive signatures, byte by byte', () => {
    expect(isZip(new Uint8Array([0x50, 0x4b, 0x03, 0x04]))).toBe(true);
    expect(isZip(new Uint8Array([0x50, 0x4b, 0x05, 0x06]))).toBe(true);
    expect(isZip(new Uint8Array([0x51, 0x4b, 0x03, 0x04]))).toBe(false);
    expect(isZip(new Uint8Array([0x00, 0x4b, 0x03, 0x04]))).toBe(false);
    expect(isZip(new Uint8Array([0x50, 0x4c, 0x03, 0x04]))).toBe(false);
    expect(isZip(new Uint8Array([0x50, 0x00, 0x03, 0x04]))).toBe(false);
    expect(isZip(new Uint8Array([0x50, 0x4b, 0x03, 0x06]))).toBe(false);
    expect(isZip(new Uint8Array([0x50, 0x4b, 0x05, 0x04]))).toBe(false);
    expect(isZip(new Uint8Array([0x50, 0x4b, 0x03, 0x05]))).toBe(false);
    expect(isZip(new Uint8Array([0x50, 0x4b, 0x01, 0x02]))).toBe(false);
    expect(isZip(new Uint8Array([0x50, 0x4b, 0x00, 0x00]))).toBe(false);
    expect(isZip(new Uint8Array([0x00, 0x4b, 0x00, 0x00]))).toBe(false);
    expect(isZip(new Uint8Array([0x50, 0x00, 0x00, 0x00]))).toBe(false);
    expect(isZip(new Uint8Array([0x50, 0x4b, 0x03]))).toBe(false);
  });

  it('keeps names with a colon or a nested __MACOSX, drops a top-level __MACOSX file', () => {
    const { entries, skipped } = readZip(
      zip({
        '__MACOSX/x.gb': 'x',
        'THUMBS.DB': 'x',
        'a/__MACOSX/x.gb': 'ok',
        'dir/a:b.gb': 'ok',
        'C:/x.gb': 'x',
        'C:y.gb': 'x',
        '1:y.gb': 'ok',
      }),
    );
    expect(entries.map((e) => e.path).sort()).toEqual(['1:y.gb', 'a/__MACOSX/x.gb', 'dir/a:b.gb']);
    expect(skipped).toEqual([
      { path: 'C:/x.gb', reason: 'The name points outside the archive' },
      { path: 'C:y.gb', reason: 'The name points outside the archive' },
    ]);
  });

  it('reads backslash names as paths with slashes', () => {
    const { entries, skipped } = readZip(zip({ 'dir\\a.gb': 'x', '..\\evil.gb': 'x' }));
    expect(entries.map((e) => e.path)).toEqual(['dir/a.gb']);
    expect(skipped).toEqual([
      { path: '../evil.gb', reason: 'The name points outside the archive' },
    ]);
  });

  it('applies each limit inclusively: a value equal to the limit still passes', () => {
    const data = zip({ 'a.gb': 'x'.repeat(10), 'b.gb': 'x'.repeat(10), 'c.gb': 'x'.repeat(10) });
    const ok = readZip(data, { maxEntries: 3, maxEntryBytes: 10, maxTotalBytes: 30 });
    expect(ok.entries).toHaveLength(3);
    expect(ok.skipped).toEqual([]);
    expect(() => readZip(data, { maxEntries: 2, maxEntryBytes: 10, maxTotalBytes: 30 })).toThrow(
      'The archive holds more than 2 files',
    );
    expect(() => readZip(data, { maxEntries: 3, maxEntryBytes: 10, maxTotalBytes: 29 })).toThrow(
      'The archive is too large to open: it expands to too much data',
    );
    const small = readZip(data, { maxEntries: 3, maxEntryBytes: 9, maxTotalBytes: 30 });
    expect(small.entries).toEqual([]);
    expect(small.skipped).toHaveLength(3);
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
  it('deflates compressible data', () => {
    const data = new Uint8Array(5000).fill(65);
    const bytes = writeZip([{ path: 'a.txt', data }]);
    expect(bytes.length).toBeLessThan(200);
    expect(readZip(bytes).entries[0]?.data).toEqual(data);
  });

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
    const bad = (p: string): string => `Not a path a ZIP file can hold: "${p}"`;
    expect(() => writeZip([{ path: '../x', data }])).toThrow(bad('../x'));
    expect(() => writeZip([{ path: '/x', data }])).toThrow(bad('/x'));
    expect(() => writeZip([{ path: 'dir/', data }])).toThrow(bad('dir/'));
    expect(() => writeZip([{ path: '', data }])).toThrow(bad(''));
    expect(() => writeZip([{ path: '.hidden', data }])).toThrow(bad('.hidden'));
    expect(() => writeZip([{ path: '__MACOSX/a', data }])).toThrow(bad('__MACOSX/a'));
    expect(() => writeZip([{ path: 'C:x', data }])).toThrow(bad('C:x'));
    expect(() =>
      writeZip([
        { path: 'a', data },
        { path: 'a', data },
      ]),
    ).toThrow('Two entries are named "a"');
  });
});
