import { alignEitherStrand, reverseComplement } from '@/core';

import {
  alignedReferenceRange,
  alignedRegionSpan,
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

describe('alignedRegionSpan (#108)', () => {
  it('unrolls a region through the origin so both ends are drawn', () => {
    const { result } = run(reference.slice(50) + reference.slice(0, 15), null, reference.length);
    const span = alignedRegionSpan(result, false, reference.length);
    expect(span?.range).toEqual({ start: 50, end: 75 });
    expect(span?.range.end).toBeGreaterThan(reference.length);
    expect(span?.shape).toBe('span');
  });

  it('brings a start past the end back inside, and never draws more than a turn', () => {
    const { result } = run(reference.slice(10, 40), null);
    const shifted = { ...result, offset: result.offset + reference.length };
    expect(alignedRegionSpan(shifted, false, reference.length)?.range).toEqual({
      start: 10,
      end: 40,
    });
    const long = {
      ...result,
      alignment: { ...result.alignment, startA: 0, endA: reference.length * 2 },
    };
    const range = alignedRegionSpan(long, false, reference.length)?.range;
    expect((range?.end ?? 0) - (range?.start ?? 0)).toBe(reference.length);
  });

  it('follows the read when the document is the read, reverse strand included', () => {
    const { result } = run(reverseComplement(reference.slice(10, 40)), null);
    expect(result.strand).toBe('reverse');
    const span = alignedRegionSpan(result, true, result.readLength);
    expect(span?.range).toEqual(readRange(result, result.offsetB, result.offsetB + 30));
    expect(span?.range.end).toBeLessThanOrEqual(result.readLength);
  });

  it('has nothing to draw for an empty document or alignment', () => {
    const { result } = run(reference.slice(10, 40), null);
    expect(alignedRegionSpan(result, false, 0)).toBeNull();
  });
});

describe('a read through the origin of a circle with an indel beside it (#165)', () => {
  // A deterministic pseudo-random circle.
  let s = 7;
  const next = (): number => (s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  const circle = Array.from({ length: 3000 }, () => 'ACGT'.charAt(Math.floor(next() * 4))).join('');
  const L = circle.length;

  // Reads: [name, read]. Each carries a deletion or an insertion just after
  // or just before the origin, some longer than the read's overhang.
  const reads: [string, string][] = [
    ['deletion after the origin', circle.slice(2900) + circle.slice(400, 600)],
    ['short deletion after', circle.slice(2900) + circle.slice(30, 230)],
    ['deletion 1.5 kb after', circle.slice(2800) + circle.slice(1500, 1700)],
    ['deletion just before', circle.slice(2600, 2700) + circle.slice(2900) + circle.slice(0, 150)],
    ['insertion after', circle.slice(2900) + 'ACGTTGCATGCAGGCATTTACG' + circle.slice(0, 200)],
    [
      'insertion before',
      circle.slice(2900, 2950) + 'TTGACCAGTGGCAATCCAG' + circle.slice(2950) + circle.slice(0, 150),
    ],
    ['reversed, deletion after', reverseComplement(circle.slice(2900) + circle.slice(400, 600))],
    ['not wrapping, deletion', circle.slice(500, 600) + circle.slice(1000, 1150)],
  ];

  it.each(reads)('%s maps as on the circle rotated so the read lies inside it', (_name, read) => {
    const prep = prepareReadAlignment(
      { sequence: circle, offset: 0, wrap: L },
      { sequence: read, read: null },
      null,
    );
    if (!prep.ok) throw new Error(prep.message);
    const got = finishReadAlignment(
      prep.job,
      alignEitherStrand(prep.job.a, prep.job.b, { mode: 'local' }),
    );
    const rot = 2500;
    const rotated = circle.slice(rot) + circle.slice(0, rot);
    const truth = alignEitherStrand(rotated, read, { mode: 'local' });
    expect(got.alignment.score).toBe(truth.alignment.score);
    expect(got.strand).toBe(truth.strand);
    expect((got.alignment.startA + L) % L).toBe((truth.alignment.startA + rot) % L);
    expect((got.alignment.endA + L) % L).toBe((truth.alignment.endA + rot) % L);
  });
});
