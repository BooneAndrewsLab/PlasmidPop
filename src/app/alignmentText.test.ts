import { alignEitherStrand } from '@/core';

import { stackAlignments } from './alignmentStack';
import { alignedFasta, alignmentText, clampRange, columnAgrees, matchLine } from './alignmentText';
import { finishReadAlignment, prepareReadAlignment } from './readAlignment';

const reference = 'GATTACAGCTTGACCGTAAGCTAGGCTTACGATCGATTGCAAGTCCGATGCATTGACCTA';
const plain = { sequence: reference, offset: 0, wrap: null };

function sample(name: string, sequence: string) {
  const prepared = prepareReadAlignment(plain, { sequence, read: null }, null);
  if (!prepared.ok) throw new Error(prepared.message);
  const { job } = prepared;
  return {
    name,
    result: finishReadAlignment(job, alignEitherStrand(job.a, job.b, { mode: 'local' })),
  };
}

/** The reference's bases 10..40, one base changed, and a second sample over the same stretch with a deletion. */
function twoSamples() {
  const part = reference.slice(10, 40);
  const changed = `${part.slice(0, 10)}${part.charAt(10) === 'A' ? 'C' : 'A'}${part.slice(11)}`;
  const deleted = `${part.slice(0, 20)}${part.slice(22)}`;
  return stackAlignments(plain, [sample('changed', changed), sample('deleted', deleted)]);
}

describe('clampRange', () => {
  const stack = twoSamples();
  it('keeps a range inside the columns and in order', () => {
    expect(clampRange(stack, { start: -5, end: 10 })).toEqual({ start: 0, end: 10 });
    expect(clampRange(stack, { start: 10, end: 1e9 })).toEqual({ start: 10, end: stack.columns });
    expect(clampRange(stack, { start: 12, end: 4 })).toEqual({ start: 4, end: 12 });
  });
  it('is null for no columns or not a number', () => {
    expect(clampRange(stack, { start: 5, end: 5 })).toBeNull();
    expect(clampRange(stack, { start: stack.columns, end: stack.columns + 4 })).toBeNull();
    expect(clampRange(stack, { start: Number.NaN, end: 4 })).toBeNull();
  });
});

describe('the match line', () => {
  const stack = twoSamples();
  it('marks columns where every row that has a base agrees', () => {
    const line = matchLine(stack, { start: 0, end: stack.columns });
    expect(line).toHaveLength(stack.columns);
    // Outside the samples' stretch only the reference has a base: not marked.
    expect(line.slice(0, 10)).toBe(' '.repeat(10));
    // The changed base and the deletion are the columns the line leaves out.
    const inside = line.slice(10, 40);
    expect(inside.split(' ').length - 1).toBeGreaterThanOrEqual(3);
    expect(inside).toContain('|');
    expect(columnAgrees(stack, 15)).toBe(true);
    expect(columnAgrees(stack, 20)).toBe(false);
  });
  it('ignores case and counts a gap against a base', () => {
    const lower = { ...stack, reference: stack.reference.toLowerCase() };
    expect(columnAgrees(lower, 15)).toBe(true);
    expect(columnAgrees(stack, 30)).toBe(false);
  });
});

describe('the text form', () => {
  const stack = twoSamples();
  it('numbers the reference as the ruler does and a sample along its own bases', () => {
    const text = alignmentText(stack, 'ref', { start: 8, end: 20 }, 10);
    const blocks = text.trimEnd().split('\n\n');
    expect(blocks).toHaveLength(2);
    const [first, second] = blocks.map((b) => b.split('\n'));
    // The reference row, the match line, one line per sample.
    expect(first).toHaveLength(4);
    expect(first?.[0]).toMatch(/^ref\s+9 CTTGACCGTA 18$/);
    expect(first?.[0]?.endsWith(' 18')).toBe(true);
    // Bases 9 and 10 are before the samples start; the second block continues the numbers.
    expect(second?.[0]).toMatch(/^ref\s+19 /);
    expect(first?.[2]).toMatch(/^changed\s+1 /);
    // The sample's second block starts where its first ended.
    const endOfFirst = Number(first?.[2]?.trim().split(/\s+/).at(-1));
    const startOfSecond = Number(second?.[2]?.trim().split(/\s+/)[1]);
    expect(startOfSecond).toBe(endOfFirst + 1);
  });
  it('lines the match line up under the bases and ends with a newline', () => {
    const text = alignmentText(stack, 'ref', { start: 10, end: 40 }, 60);
    const lines = text.split('\n');
    const bases = lines[0]?.indexOf(reference.slice(10, 14)) ?? -1;
    expect(bases).toBeGreaterThan(0);
    expect(lines[1]?.indexOf('|')).toBeGreaterThanOrEqual(bases);
    expect(text.endsWith('\n')).toBe(true);
    expect(text.endsWith('\n\n')).toBe(false);
  });
  it('leaves numbers blank where a row has no base in the block, and cuts long names', () => {
    const long = stackAlignments(plain, [sample('x'.repeat(60), reference.slice(30, 50))]);
    const text = alignmentText(long, 'ref', { start: 0, end: 20 }, 20);
    const sampleLine = text.split('\n')[2] ?? '';
    expect(sampleLine).toMatch(/^x{23}…/);
    expect(sampleLine.trim()).toBe(sampleLine.trim().replace(/\s+\d+$/, ''));
    expect(sampleLine).not.toMatch(/\d/);
  });
  it('is empty for no columns and takes a block of one column at least', () => {
    expect(alignmentText(stack, 'ref', { start: 3, end: 3 })).toBe('');
    const text = alignmentText(stack, 'ref', { start: 0, end: 3 }, 0);
    expect(text.trimEnd().split('\n\n')).toHaveLength(3);
  });
});

describe('aligned FASTA', () => {
  const stack = twoSamples();
  it('writes every record at the full width, gaps as dashes and outside the stretch too', () => {
    const fasta = alignedFasta(stack, 'my ref', { start: 0, end: stack.columns });
    const records = fasta.split('>').filter((r) => r !== '');
    expect(records).toHaveLength(3);
    const seqs = records.map((r) => r.split('\n').slice(1).join(''));
    expect(records[0]?.startsWith('my ref\n')).toBe(true);
    for (const s of seqs) expect(s).toHaveLength(stack.columns);
    expect(seqs[1]).toMatch(/^-{10}/);
    expect(seqs[1]).not.toContain(' ');
    expect(seqs[2]).toContain('-');
    expect(seqs[0]).toBe(stack.reference);
    // Lines wrap at 60.
    expect(records[0]?.split('\n')[1]).toHaveLength(60);
  });
  it('takes a range and is empty for none', () => {
    const fasta = alignedFasta(stack, 'r', { start: 12, end: 18 });
    expect(fasta).toBe(
      `>r\n${stack.reference.slice(12, 18)}\n>changed\n${stack.rows[0]?.bases.slice(12, 18)}\n>deleted\n${stack.rows[1]?.bases.slice(12, 18)}\n`,
    );
    expect(alignedFasta(stack, 'r', { start: 2, end: 2 })).toBe('');
  });
  it('names a nameless record', () => {
    const fasta = alignedFasta(stack, '  ', { start: 0, end: 5 });
    expect(fasta.startsWith('>sequence\n')).toBe(true);
  });
});
