import { alignEitherStrand, reverseComplement } from '@/core';
import { differenceRows } from './alignmentDifferences';
import { agreementColumns, disagreementColumns } from './alignmentDisagreement';
import { differenceRegions, stackAlignments } from './alignmentStack';
import { confidentDifferences, coverageOf, verdictsOf } from './alignmentVerdict';
import { finishReadAlignment, prepareReadAlignment, type ReferenceInput } from './readAlignment';

/** Reads over a circle's origin, some wrapping it and some not (#166). */

function lcg(seed: number): () => number {
  let s = seed;
  return () => (s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
}
const rand = lcg(11);
const L = 1500;
const ref = Array.from({ length: L }, () => 'ACGT'[Math.floor(rand() * 4)]).join('');
const circle: ReferenceInput = { sequence: ref, offset: 0, wrap: L };
const linear: ReferenceInput = { sequence: ref, offset: 0, wrap: null };

function align(reference: ReferenceInput, read: string) {
  const prep = prepareReadAlignment(reference, { sequence: read, read: null }, null);
  if (!prep.ok) throw new Error(prep.message);
  return finishReadAlignment(
    prep.job,
    alignEitherStrand(prep.job.a, prep.job.b, { mode: 'local' }),
  );
}

/** Reference bases over [from, to), wrapping, with the base at `flip` (if any) changed. */
function slice(from: number, to: number, flip: number | null = null): string {
  let out = '';
  for (let i = from; i < to; i++) {
    const p = ((i % L) + L) % L;
    const b = ref.charAt(p);
    out += p === flip ? (b === 'A' ? 'C' : 'A') : b;
  }
  return out;
}

interface Read {
  from: number;
  to: number;
  reverse?: boolean;
  flip?: number;
}
function stackOf(reads: readonly Read[], reference: ReferenceInput = circle) {
  return stackAlignments(
    reference,
    reads.map((r, i) => {
      const fwd = slice(r.from, r.to, r.flip ?? null);
      return {
        name: `r${i}`,
        result: align(reference, r.reverse === true ? reverseComplement(fwd) : fwd),
      };
    }),
  );
}
const feature = {
  name: 'f',
  type: 'misc_feature',
  strand: 'forward' as const,
  colour: '#000',
  ranges: [{ start: 10, end: 100 }],
  orf: false,
};
function verdict(reads: readonly Read[], reference: ReferenceInput = circle) {
  const stack = stackOf(reads, reference);
  const cov = coverageOf(stack, 20);
  const period = reference.wrap ?? 0;
  const v = verdictsOf(stack, [feature], cov, confidentDifferences(stack, 20), period)[0];
  if (v === undefined) throw new Error('no verdict');
  return { stack, v };
}

describe('a wrapping and a non-wrapping read over the origin', () => {
  it('counts both reads and both strands on the feature (the issue repro)', () => {
    const { v } = verdict([
      { from: 1300, to: L + 200 },
      { from: 0, to: 300, reverse: true, flip: 50 },
    ]);
    expect(v.reads).toBe(2);
    expect(v.strands).toBe('both');
    expect(v.differences).toBe(1);
  });

  it('flags a conflict between them, and lists the difference once', () => {
    const { stack } = verdict([
      { from: 1300, to: L + 200 },
      { from: 0, to: 300, reverse: true, flip: 50 },
    ]);
    const rows = differenceRows(
      stack,
      differenceRegions(stack.differences),
      [],
      [],
      null,
      disagreementColumns(stack, 20),
    );
    const at51 = rows.filter((r) => r.position === 51);
    expect(at51).toHaveLength(1);
    expect(at51[0]?.disagree).toBe(true);
    expect(at51[0]?.carriers.map((c) => c.name)).toEqual(['r1']);
  });

  it('works with the wrapping read as the one carrying the mismatch, and on the other strands', () => {
    const { stack, v } = verdict([
      { from: 1300, to: L + 200, reverse: true, flip: 51 },
      { from: 0, to: 300 },
    ]);
    expect(v.reads).toBe(2);
    expect(v.strands).toBe('both');
    expect(v.differences).toBe(1);
    const rows = differenceRows(
      stack,
      differenceRegions(stack.differences),
      [],
      [],
      null,
      disagreementColumns(stack, 20),
    );
    const at52 = rows.filter((r) => r.position === 52);
    expect(at52).toHaveLength(1);
    expect(at52[0]?.disagree).toBe(true);
    expect(at52[0]?.carriers.map((c) => c.name)).toEqual(['r0']);
    expect(at52[0]?.carriers[0]?.bases).not.toBe('-');
  });

  it('merges a mismatch both reads carry into one agreed difference', () => {
    const { stack, v } = verdict([
      { from: 1300, to: L + 200, flip: 50 },
      { from: 0, to: 300, reverse: true, flip: 50 },
    ]);
    expect(v.reads).toBe(2);
    expect(v.differences).toBe(1);
    const rows = differenceRows(
      stack,
      differenceRegions(stack.differences),
      [],
      [],
      null,
      disagreementColumns(stack, 20),
    );
    const at51 = rows.filter((r) => r.position === 51);
    expect(at51).toHaveLength(1);
    expect(at51[0]?.carriers).toHaveLength(2);
    expect(at51[0]?.disagree).toBe(false);
    expect(agreementColumns(stack, 20)).toHaveLength(1);
  });

  it('combines abutting and overlapping reads at the origin', () => {
    // Wrapping read ends at 100 and the other starts at 100: abutting over 11-100 only needs the first.
    const abut = verdict([
      { from: 1300, to: L + 100 },
      { from: 100, to: 400 },
    ]);
    expect(abut.v.reads).toBe(1);
    expect(abut.v.strands).toBe('forward');
    const overlap = verdict([
      { from: 1300, to: L + 60 },
      { from: 50, to: 400, reverse: true },
    ]);
    // Bases 10-49 only the wrapping read, 50-99 only the other: one read each, so no base has both.
    expect(overlap.v.reads).toBe(1);
    expect(overlap.v.strands).toBe('mixed');
    expect(overlap.v.covered).toBe(overlap.v.bases);
  });

  it('a read over the end with another over the start covers a feature across the origin', () => {
    const across = { ...feature, ranges: [{ start: 1480, end: L + 20 }] };
    const stack = stackOf([
      { from: 1400, to: L + 10 },
      { from: 0, to: 100, reverse: true },
      { from: 1450, to: L },
    ]);
    const cov = coverageOf(stack, 20);
    const v = verdictsOf(stack, [across], cov, [], L)[0];
    expect(v?.covered).toBe(v?.bases);
    expect(v?.reads).toBeGreaterThanOrEqual(1);
  });

  it('a single wrapping read alone is unchanged', () => {
    const { v } = verdict([{ from: 1300, to: L + 200 }]);
    expect(v.reads).toBe(1);
    expect(v.strands).toBe('forward');
    expect(v.differences).toBe(0);
  });

  it('a linear reference is unaffected', () => {
    const { stack, v } = verdict(
      [
        { from: 0, to: 300, reverse: true, flip: 50 },
        { from: 0, to: 200 },
      ],
      linear,
    );
    expect(stack.twin.every((t) => t === -1)).toBe(true);
    expect(v.reads).toBe(2);
    expect(v.strands).toBe('both');
    expect(v.differences).toBe(1);
  });
});
