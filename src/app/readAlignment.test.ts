import { alignEitherStrand, reverseComplement } from '@/core';

import {
  alignedReferenceRange,
  finishReadAlignment,
  prepareReadAlignment,
  readRange,
  suggestAlignMode,
} from './readAlignment';

const reference = 'GATTACAGCTTGACCGTAAGCTAGGCTTACGATCGATTGCAAGTCCGATGCATTGACCTA';

function run(sequence: string, qualities: number[] | null, wrap: number | null = null) {
  const prepared = prepareReadAlignment(
    { sequence: reference, offset: 0, wrap },
    {
      sequence,
      read: qualities === null ? null : { qualities: Uint8Array.from(qualities), trace: null },
    },
    qualities === null ? null : 0.05,
  );
  if (!prepared.ok) throw new Error(prepared.message);
  const { job } = prepared;
  return {
    job,
    result: finishReadAlignment(job, alignEitherStrand(job.a, job.b, { mode: 'local' })),
  };
}

describe('one read against one reference', () => {
  it('trims the read before aligning and says how much', () => {
    const q = [2, 2, 2, ...new Array<number>(30).fill(40), 2, 2];
    const { job, result } = run(`CCC${reference.slice(10, 40)}AA`, q);
    expect(job.b).toBe(reference.slice(10, 40));
    expect(result.trimmed).toEqual({ start: 3, end: 2 });
    expect(result.offsetB).toBe(3);
    expect(result.qualities).toHaveLength(30);
  });

  it('refuses a read with nothing good enough, and an empty one', () => {
    const none = prepareReadAlignment(
      { sequence: reference, offset: 0, wrap: null },
      { sequence: 'ACGT', read: { qualities: Uint8Array.from([2, 2, 2, 2]), trace: null } },
      0.05,
    );
    expect(none.ok).toBe(false);
    const empty = prepareReadAlignment(
      { sequence: reference, offset: 0, wrap: null },
      { sequence: '', read: null },
      null,
    );
    expect(empty.ok).toBe(false);
  });

  it('numbers a reversed read along its reverse complement and maps back to the read', () => {
    const q = [2, 2, ...new Array<number>(30).fill(40), 2, 2, 2];
    const forward = `TT${reference.slice(10, 40)}GGG`;
    const { result } = run(reverseComplement(forward), q.slice().reverse());
    expect(result.strand).toBe('reverse');
    // Trimmed 3 from the reverse read's start is 3 from the forward read's end.
    expect(result.offsetB).toBe(2);
    expect(result.qualities?.[0]).toBe(40);
    // Its aligned stretch, as numbered on screen, is the reverse read's 3–33.
    const shown = readRange(result, 2, 32);
    expect(shown).toEqual({ start: 3, end: 33 });
    expect(readRange(result, 5, 5)).toEqual({ start: 30, end: 30 });
  });

  it('turns an alignment found in the repeated start back one turn', () => {
    // The reference's first 20 bases, which the wrap repeats after its end.
    const { job, result } = run(
      reference.slice(50) + reference.slice(0, 15),
      null,
      reference.length,
    );
    expect(job.a.length).toBeGreaterThan(reference.length);
    expect(result.alignment.startA).toBe(50);
    expect(alignedReferenceRange(result)).toEqual({ start: 50, end: 75 });
  });
});

describe('suggestAlignMode (#86)', () => {
  it('starts a read, or anything under half the reference, in Local', () => {
    expect(suggestAlignMode({ length: 750, isRead: true }, 4361)).toEqual({
      mode: 'local',
      reason: 'a read',
    });
    // A read is Local even as long as the reference.
    expect(suggestAlignMode({ length: 5000, isRead: true }, 4361).mode).toBe('local');
    expect(suggestAlignMode({ length: 2180, isRead: false }, 4361)).toEqual({
      mode: 'local',
      reason: 'under half the length of what it is aligned to',
    });
  });

  it('keeps Global for two sequences of about the same length, and for nothing yet', () => {
    expect(suggestAlignMode({ length: 2181, isRead: false }, 4361)).toEqual({
      mode: 'global',
      reason: null,
    });
    expect(suggestAlignMode({ length: 4361, isRead: false }, 4361).mode).toBe('global');
    expect(suggestAlignMode({ length: 9000, isRead: false }, 4361).mode).toBe('global');
    expect(suggestAlignMode({ length: 0, isRead: false }, 4361).mode).toBe('global');
  });
});
