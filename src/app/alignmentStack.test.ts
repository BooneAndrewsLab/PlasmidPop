import { alignEitherStrand, reverseComplement, type SequencingRead } from '@/core';

import {
  Cell,
  columnPosition,
  differenceRegions,
  isDifference,
  nextDifference,
  stackAlignments,
  type Stack,
} from './alignmentStack';
import { finishReadAlignment, prepareReadAlignment } from './readAlignment';

const reference = 'GATTACAGCTTGACCGTAAGCTAGGCTTACGATCGATTGCAAGTCCGATGCATTGACCTA';
const ref = { sequence: reference, offset: 0, wrap: null };

function sample(name: string, sequence: string, mode: 'local' | 'global' = 'local') {
  const prepared = prepareReadAlignment(ref, { sequence, read: null }, null);
  if (!prepared.ok) throw new Error(prepared.message);
  const { job } = prepared;
  return { name, result: finishReadAlignment(job, alignEitherStrand(job.a, job.b, { mode })) };
}

function rowOf(stack: Stack, i: number) {
  const row = stack.rows[i];
  if (row === undefined) throw new Error(`no row ${i}`);
  return row;
}

describe('stacking alignments against one reference', () => {
  it('lays a matching read over the reference with no differences', () => {
    const stack = stackAlignments(ref, [sample('r', reference.slice(10, 40))]);
    expect(stack.columns).toBe(reference.length);
    expect(stack.reference).toBe(reference);
    expect(stack.differences).toEqual([]);
    const row = rowOf(stack, 0);
    expect(row.bases.slice(10, 40)).toBe(reference.slice(10, 40));
    expect(row.bases.slice(0, 10)).toBe(' '.repeat(10));
    expect(row.cells[10]).toBe(Cell.Match);
    expect(row.cells[5]).toBe(Cell.Blank);
    expect([row.firstColumn, row.endColumn]).toEqual([10, 40]);
  });

  it('marks a mismatch as a difference in the column of the reference base', () => {
    const changed = reference.slice(10, 40).split('');
    changed[12] = changed[12] === 'A' ? 'C' : 'A';
    const stack = stackAlignments(ref, [sample('r', changed.join(''))]);
    expect(stack.differences).toEqual([22]);
    expect(rowOf(stack, 0).cells[22]).toBe(Cell.Mismatch);
  });

  it('opens gap columns in the reference and pads the other samples for an insertion', () => {
    const inserted = reference.slice(10, 40);
    const withExtra = `${inserted.slice(0, 15)}TTT${inserted.slice(15)}`;
    const stack = stackAlignments(ref, [sample('plain', inserted), sample('extra', withExtra)]);
    expect(stack.columns).toBe(reference.length + 3);
    const plain = rowOf(stack, 0);
    const extra = rowOf(stack, 1);
    const at = stack.reference.indexOf('-');
    expect(stack.reference.slice(at, at + 3)).toBe('---');
    expect(extra.bases.slice(at, at + 3)).toBe('TTT');
    expect([...extra.cells.slice(at, at + 3)]).toEqual([
      Cell.Insertion,
      Cell.Insertion,
      Cell.Insertion,
    ]);
    expect(plain.bases.slice(at, at + 3)).toBe('---');
    expect([...plain.cells.slice(at, at + 3)]).toEqual([Cell.Padding, Cell.Padding, Cell.Padding]);
    // Every row and the reference stay the same width and read the same bases.
    expect(stack.reference.replace(/-/g, '')).toBe(reference);
    expect(plain.bases.replace(/[- ]/g, '')).toBe(inserted);
    expect(stack.differences).toEqual([at, at + 1, at + 2]);
  });

  it('shares columns between insertions at one place, taking the longer', () => {
    const inserted = reference.slice(10, 40);
    const stack = stackAlignments(ref, [
      sample('a', `${inserted.slice(0, 15)}AA${inserted.slice(15)}`),
      sample('b', `${inserted.slice(0, 15)}AAAA${inserted.slice(15)}`),
    ]);
    expect(stack.columns).toBe(reference.length + 4);
  });

  it('shows a deleted base as a gap in the read', () => {
    const inserted = reference.slice(10, 40);
    const stack = stackAlignments(ref, [
      sample('r', `${inserted.slice(0, 15)}${inserted.slice(16)}`),
    ]);
    expect(stack.columns).toBe(reference.length);
    expect(rowOf(stack, 0).cells[25]).toBe(Cell.Deletion);
    expect(rowOf(stack, 0).bases.charAt(25)).toBe('-');
  });

  it('numbers columns by the reference, and none in an inserted column', () => {
    const inserted = reference.slice(10, 40);
    const stack = stackAlignments({ ...ref, offset: 100 }, [
      sample('r', `${inserted.slice(0, 15)}TT${inserted.slice(15)}`),
    ]);
    expect(columnPosition(stack, 0)).toBe(101);
    const at = stack.reference.indexOf('-');
    expect(columnPosition(stack, at)).toBeNull();
    expect(columnPosition(stack, at + 2)).toBe(101 + 25);
  });

  it('keeps qualities under the read’s columns', () => {
    const inserted = reference.slice(10, 40);
    const prepared = prepareReadAlignment(
      ref,
      {
        sequence: inserted,
        read: { qualities: Uint8Array.from(new Array<number>(30).fill(30)), trace: null },
      },
      null,
    );
    if (!prepared.ok) throw new Error(prepared.message);
    const result = finishReadAlignment(
      prepared.job,
      alignEitherStrand(prepared.job.a, prepared.job.b, { mode: 'local' }),
    );
    const row = rowOf(stackAlignments(ref, [{ name: 'q', result }]), 0);
    expect(row.qualities?.[10]).toBe(30);
    expect(row.qualities?.[0]).toBeNaN();
  });
});

describe('the trace under a read', () => {
  /** A read of `sequence` with a flat trace, one peak per base. */
  function withTrace(sequence: string): SequencingRead {
    const n = sequence.length;
    const flat = () => new Int16Array(n * 4);
    return {
      qualities: new Uint8Array(n).fill(30),
      trace: {
        channels: { A: flat(), C: flat(), G: flat(), T: flat() },
        peaks: Int32Array.from({ length: n }, (_, i) => i * 4 + 2),
      },
    };
  }
  function traced(sequence: string) {
    const prepared = prepareReadAlignment(ref, { sequence, read: withTrace(sequence) }, null);
    if (!prepared.ok) throw new Error(prepared.message);
    const { job } = prepared;
    return {
      name: 't',
      result: finishReadAlignment(job, alignEitherStrand(job.a, job.b, { mode: 'local' })),
    };
  }

  it('has no read index for a read without a trace', () => {
    expect(
      rowOf(stackAlignments(ref, [sample('a', reference.slice(10, 40))]), 0).readIndex,
    ).toBeNull();
  });

  it('numbers each column by the read base in it', () => {
    const row = rowOf(stackAlignments(ref, [traced(reference.slice(10, 40))]), 0);
    expect(row.readIndex?.[9]).toBe(-1);
    expect(row.readIndex?.[10]).toBe(0);
    expect(row.readIndex?.[39]).toBe(29);
    expect(row.readIndex?.[40]).toBe(-1);
  });

  it('numbers along the reverse complement when the read aligned reversed', () => {
    const result = traced(reverseComplement(reference.slice(10, 40)));
    expect(result.result.strand).toBe('reverse');
    const row = rowOf(stackAlignments(ref, [result]), 0);
    expect(row.readIndex?.[10]).toBe(0);
    expect(row.readIndex?.[39]).toBe(29);
  });

  it('skips the columns where the read has a gap and counts on past an insertion', () => {
    const read = reference.slice(10, 25) + 'TTT' + reference.slice(25, 40);
    const stack = stackAlignments(ref, [traced(read)]);
    const row = rowOf(stack, 0);
    const indices = [...(row.readIndex ?? [])].filter((i) => i >= 0);
    expect(indices).toEqual(Array.from({ length: read.length }, (_, i) => i));
  });
});

describe('going through the differences', () => {
  it('gathers adjacent differing columns into one region', () => {
    expect(differenceRegions([3, 4, 5, 6, 7, 20, 22, 23])).toEqual([
      { start: 3, end: 8 },
      { start: 20, end: 21 },
      { start: 22, end: 24 },
    ]);
    expect(differenceRegions([])).toEqual([]);
  });

  it('finds the next and previous region, going round at the ends', () => {
    const r = differenceRegions([3, 4, 5, 8, 20]);
    expect(nextDifference(r, 3, false)).toEqual({ start: 8, end: 9 });
    expect(nextDifference(r, 4, false)).toEqual({ start: 8, end: 9 });
    expect(nextDifference(r, 20, false)).toEqual({ start: 3, end: 6 });
    expect(nextDifference(r, 8, true)).toEqual({ start: 3, end: 6 });
    expect(nextDifference(r, 3, true)).toEqual({ start: 20, end: 21 });
    expect(nextDifference([], 3, false)).toBeNull();
  });

  it('counts mismatches, gaps and insertions but not matches', () => {
    expect(isDifference(Cell.Match)).toBe(false);
    expect(isDifference(Cell.Ambiguous)).toBe(false);
    expect(isDifference(Cell.Blank)).toBe(false);
    expect(isDifference(Cell.Padding)).toBe(false);
    expect(isDifference(Cell.Mismatch)).toBe(true);
    expect(isDifference(Cell.Deletion)).toBe(true);
    expect(isDifference(Cell.Insertion)).toBe(true);
  });
});
