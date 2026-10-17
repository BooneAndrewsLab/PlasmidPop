import { strToU8, zipSync } from 'fflate';

import { readSequenceArchive } from './archive';

const GB = (name: string, seq: string): string =>
  `LOCUS       ${name}  ${seq.length} bp    DNA     circular SYN 01-JAN-2020\nORIGIN\n        1 ${seq}\n//\n`;

function zip(files: Record<string, string>): Uint8Array {
  return zipSync(Object.fromEntries(Object.entries(files).map(([k, v]) => [k, strToU8(v)])));
}

describe('readSequenceArchive (#213)', () => {
  it('reads every sequence file, keeping the folder, and lists what it could not read', async () => {
    const { records, skipped } = await readSequenceArchive(
      zip({
        'Projects/pA.gb': GB('pA', 'acgtacgtac'),
        'Projects/Sub/pB.gb': GB('pB', 'ggggcccc'),
        'top.fa': '>seq\nACGTACGT\n',
        'notes.csv': 'a,b,c\n1,2,3\n',
        'empty.gb': '',
        '__MACOSX/._pA.gb': 'junk',
      }),
    );
    expect(records.map((r) => [r.document.name, r.folder, r.fileName])).toEqual([
      ['pA', 'Projects', 'pA.gb'],
      ['pB', 'Projects/Sub', 'pB.gb'],
      ['seq', null, 'top.fa'],
    ]);
    expect(skipped.map((s) => s.path).sort()).toEqual(['empty.gb', 'notes.csv']);
    expect(skipped.every((s) => s.reason !== '')).toBe(true);
  });

  it('gives the reason each unreadable file was left out', async () => {
    const { skipped } = await readSequenceArchive(
      zip({ 'notes.csv': 'a,b,c\n1,2,3\n', 'empty.gb': '' }),
    );
    expect(skipped).toEqual([
      { path: 'empty.gb', reason: 'No LOCUS line found; not a GenBank file' },
      { path: 'notes.csv', reason: 'Unrecognised sequence format' },
    ]);
  });

  it('carries the ZIP reader skips through, and sorts by path', async () => {
    const { records, skipped } = await readSequenceArchive(
      zip({
        'b.gb': GB('pb', 'acgtacgt'),
        '../evil.gb': GB('pe', 'acgtacgt'),
        'a.gb': GB('pa', 'acgtacgt'),
        'B.gb': GB('pB2', 'acgtacgt'),
      }),
    );
    expect(records.map((r) => r.path)).toEqual(['a.gb', 'b.gb', 'B.gb']);
    expect(skipped).toEqual([
      { path: '../evil.gb', reason: 'The name points outside the archive' },
    ]);
  });

  it('keeps files with the same name apart', async () => {
    const { records } = await readSequenceArchive(
      zip({ 'a/p.gb': GB('p', 'acgtacgt'), 'b/p.gb': GB('p', 'ttttaaaa') }),
    );
    expect(records.map((r) => [r.folder, r.document.sequence.toString()])).toEqual([
      ['a', 'acgtacgt'],
      ['b', 'ttttaaaa'],
    ]);
  });

  it('imports every record of a multi-record FASTA', async () => {
    const { records } = await readSequenceArchive(zip({ 'm.fa': '>x\nACGT\n>y\nGGCC\n' }));
    expect(records.map((r) => r.document.name)).toEqual(['x', 'y']);
    expect(records.every((r) => r.warnings.length === 0)).toBe(true);
  });

  it('takes the first record of a FASTQ only, with a warning', async () => {
    const { records } = await readSequenceArchive(
      zip({ 'r.fastq': '@a\nACGT\n+\nIIII\n@b\nGGCC\n+\nIIII\n' }),
    );
    expect(records).toHaveLength(1);
    expect(records[0]?.warnings.map((w) => w.message)).toEqual([
      'Only the first of 2 records was imported.',
    ]);
  });

  it('gives a single-record FASTQ no warning', async () => {
    const { records } = await readSequenceArchive(zip({ 'r.fastq': '@a\nACGT\n+\nIIII\n' }));
    expect(records).toHaveLength(1);
    expect(records[0]?.warnings).toEqual([]);
  });
});
