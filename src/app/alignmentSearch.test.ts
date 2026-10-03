import { alignEitherStrand, reverseComplement } from '@/core';

import { columnPosition, stackAlignments } from './alignmentStack';
import {
  cleanMotif,
  columnOfPosition,
  findMotif,
  firstMatchFrom,
  positionMessage,
  stepMatch,
  type MotifMatch,
} from './alignmentSearch';
import { finishReadAlignment, prepareReadAlignment } from './readAlignment';

const reference = 'GATTACAGCTTGACCGTAAGCTAGGCTTACGATCGATTGCAAGTCCGATGCATTGACCTA';

function sample(
  ref: { sequence: string; offset: number; wrap: number | null },
  name: string,
  sequence: string,
) {
  const prepared = prepareReadAlignment(ref, { sequence, read: null }, null);
  if (!prepared.ok) throw new Error(prepared.message);
  const { job } = prepared;
  return {
    name,
    result: finishReadAlignment(job, alignEitherStrand(job.a, job.b, { mode: 'local' })),
  };
}

const plain = { sequence: reference, offset: 0, wrap: null };

describe('go to a position', () => {
  it('finds the column of every base, through gap columns another sample opened', () => {
    // An insertion in one sample opens two columns in the reference row.
    const inserted =
      reference.slice(10, 40).slice(0, 15) + 'TT' + reference.slice(10, 40).slice(15);
    const stack = stackAlignments(plain, [sample(plain, 'ins', inserted)]);
    expect(stack.columns).toBeGreaterThan(reference.length);
    for (let p = 1; p <= reference.length; p++) {
      const r = columnOfPosition(stack, p);
      expect(r.kind).toBe('column');
      if (r.kind === 'column') expect(columnPosition(stack, r.column)).toBe(p);
    }
  });

  it('refuses what is not a position, one past the end, and what is outside a selection', () => {
    const stack = stackAlignments(plain, [sample(plain, 's', reference.slice(10, 40))]);
    expect(columnOfPosition(stack, 0).kind).toBe('invalid');
    expect(columnOfPosition(stack, 2.5).kind).toBe('invalid');
    expect(columnOfPosition(stack, Number.NaN).kind).toBe('invalid');
    expect(columnOfPosition(stack, reference.length + 1)).toEqual({
      kind: 'past-end',
      last: reference.length,
    });
    expect(positionMessage(columnOfPosition(stack, 999))).toBe(
      'Past the end: the last position is 60.',
    );
    const cut = { sequence: reference.slice(20, 50), offset: 20, wrap: null };
    const selection = stackAlignments(cut, [sample(cut, 's', reference.slice(25, 45))]);
    expect(columnOfPosition(selection, 5)).toEqual({ kind: 'outside', first: 21, last: 50 });
    expect(positionMessage(columnOfPosition(selection, 5))).toMatch(/positions 21 to 50/);
    const r = columnOfPosition(selection, 21);
    expect(r.kind).toBe('column');
    expect(positionMessage({ kind: 'column', column: 0 })).toBe('');
    expect(positionMessage({ kind: 'invalid' })).toMatch(/whole number/);
  });

  it('takes the numbers of a circle modulo its length and goes to the first copy', () => {
    const circle = { sequence: reference, offset: 0, wrap: reference.length };
    // A read that runs through the origin repeats the start of the reference.
    const read = reference.slice(50) + reference.slice(0, 15);
    const stack = stackAlignments(circle, [sample(circle, 'wrap', read)]);
    expect(stack.refIndex.length).toBeGreaterThan(reference.length);
    const start = columnOfPosition(stack, 3);
    expect(start.kind).toBe('column');
    if (start.kind === 'column') expect(columnPosition(stack, start.column)).toBe(3);
    const past = columnOfPosition(stack, reference.length + 1);
    expect(past).toEqual({ kind: 'past-end', last: reference.length });
  });
});

describe('finding a motif', () => {
  it('reads IUPAC codes and both strands in the reference', () => {
    const stack = stackAlignments(plain, [sample(plain, 's', reference.slice(10, 40))]);
    const found = findMotif(stack, null, 'gattrc');
    expect(found).toEqual({
      kind: 'matches',
      matches: [
        { start: 0, end: 6, strand: 'forward' },
        { start: 34, end: 40, strand: 'forward' },
      ],
    });
    const rc = findMotif(stack, null, reverseComplement('GCTAGG'));
    expect(rc).toEqual({
      kind: 'matches',
      matches: [{ start: 19, end: 25, strand: 'reverse' }],
    });
    expect(findMotif(stack, null, 'g a t t').kind).toBe('matches');
  });

  it('says why a query is not searched', () => {
    const stack = stackAlignments(plain, [sample(plain, 's', reference.slice(10, 40))]);
    expect(findMotif(stack, null, '  ')).toEqual({ kind: 'empty' });
    expect(findMotif(stack, null, 'GA')).toEqual({ kind: 'short' });
    expect(findMotif(stack, null, 'GATXX')).toEqual({ kind: 'invalid' });
    expect(findMotif(stack, null, 'CCCCCCCCC')).toEqual({ kind: 'matches', matches: [] });
    expect(cleanMotif(' ga tc\n')).toBe('GATC');
  });

  it('searches a sample on its own bases, across a deletion and not outside its stretch', () => {
    const slice = reference.slice(5, 45);
    // Drop two bases from the middle of CTTGACCGTAAG: the sample reads CTTGAGTAAG there.
    const deleted = slice.replace('CTTGACCGTAAG', 'CTTGAGTAAG');
    const stack = stackAlignments(plain, [sample(plain, 'del', deleted)]);
    const found = findMotif(stack, 0, 'TTGAGTAA');
    expect(found.kind).toBe('matches');
    if (found.kind !== 'matches') return;
    expect(found.matches).toHaveLength(1);
    const m = found.matches[0];
    // Its columns include the two reference bases it lacks.
    expect((m?.end ?? 0) - (m?.start ?? 0)).toBe(8 + 2);
    // The reference does not have it, and the blank flank of the sample is not searched.
    expect(findMotif(stack, null, 'TTGAGTAA')).toEqual({ kind: 'matches', matches: [] });
    expect(findMotif(stack, 0, reference.slice(0, 6))).toEqual({ kind: 'matches', matches: [] });
  });

  it('finds a reference motif across another sample insertion, with its gap columns', () => {
    const slice = reference.slice(10, 40);
    const inserted = slice.slice(0, 15) + 'TT' + slice.slice(15);
    const stack = stackAlignments(plain, [sample(plain, 'ins', inserted)]);
    const found = findMotif(stack, null, reference.slice(18, 28));
    expect(found.kind).toBe('matches');
    if (found.kind !== 'matches') return;
    const m = found.matches[0];
    expect((m?.end ?? 0) - (m?.start ?? 0)).toBe(12);
  });

  it('reports a read-through-the-origin repeat once', () => {
    const circle = { sequence: reference, offset: 0, wrap: reference.length };
    const read = reference.slice(50) + reference.slice(0, 15);
    const stack = stackAlignments(circle, [sample(circle, 'wrap', read)]);
    const found = findMotif(stack, null, reference.slice(2, 10));
    expect(found.kind === 'matches' && found.matches.length).toBe(1);
    // The motif across the origin is found because the reference runs on.
    const across = findMotif(stack, null, reference.slice(56) + reference.slice(0, 4));
    expect(across.kind === 'matches' && across.matches.length).toBe(1);
  });
});

describe('stepping through matches', () => {
  const matches: MotifMatch[] = [
    { start: 5, end: 9, strand: 'forward' },
    { start: 20, end: 24, strand: 'reverse' },
    { start: 40, end: 44, strand: 'forward' },
  ];
  it('goes on and back, wrapping round', () => {
    expect(stepMatch(matches, 5, false)).toBe(1);
    expect(stepMatch(matches, 40, false)).toBe(0);
    expect(stepMatch(matches, 20, true)).toBe(0);
    expect(stepMatch(matches, 5, true)).toBe(2);
    expect(stepMatch([], 0, false)).toBeNull();
    expect(stepMatch([], 0, true)).toBeNull();
  });
  it('lands a new query on the first match from the view', () => {
    expect(firstMatchFrom(matches, 0)).toBe(0);
    expect(firstMatchFrom(matches, 20)).toBe(1);
    expect(firstMatchFrom(matches, 41)).toBe(0);
    expect(firstMatchFrom([], 0)).toBeNull();
  });
});
