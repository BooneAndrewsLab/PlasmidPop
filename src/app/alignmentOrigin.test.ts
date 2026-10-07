import {
  alignEitherStrand,
  createFeature,
  rangeSegment,
  reverseComplement,
  SeqDocument,
  translateCds,
} from '@/core';
import { annotationsOf } from './alignmentTrack';
import { buildFrames } from './alignmentResidues';
import { differenceRows, effectText, samplesText } from './alignmentDifferences';
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
function slice(
  from: number,
  to: number,
  flip: number | null = null,
  base: string | null = null,
): string {
  let out = '';
  for (let i = from; i < to; i++) {
    const p = ((i % L) + L) % L;
    const b = ref.charAt(p);
    out += p === flip ? (base ?? (b === 'A' ? 'C' : 'A')) : b;
  }
  return out;
}

interface Read {
  from: number;
  to: number;
  reverse?: boolean;
  flip?: number;
  /** The base put at `flip`, by default the first of A, C that differs. */
  base?: string;
}
function stackOf(reads: readonly Read[], reference: ReferenceInput = circle) {
  return stackAlignments(
    reference,
    reads.map((r, i) => {
      const fwd = slice(r.from, r.to, r.flip ?? null, r.base ?? null);
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

describe('a wrapping and a non-wrapping read over the origin', { timeout: 30_000 }, () => {
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

describe('the protein effect of a difference across the origin', { timeout: 30_000 }, () => {
  const cdsStart = 1470;
  const cdsLen = 90;

  function cds(strand: 'forward' | 'reverse', start: number) {
    return createFeature({
      type: 'CDS',
      name: 'g',
      strand,
      segments: [rangeSegment(start, start + cdsLen)],
    });
  }

  /** What translating the document with and without the change independently says of it. */
  function expectedEffect(
    strand: 'forward' | 'reverse',
    start: number,
    at: number,
    changed: string,
  ): string {
    const feat = cds(strand, start);
    const before = SeqDocument.create({ sequence: ref, topology: 'circular' });
    const mutated = ref.slice(0, at) + changed + ref.slice(at + 1);
    const after = SeqDocument.create({ sequence: mutated, topology: 'circular' });
    const a = translateCds(before, feat).codons;
    const b = translateCds(after, feat).codons;
    for (let i = 0; i < a.length; i++) {
      const x = a[i];
      const y = b[i];
      if (x === undefined || y === undefined || x.aminoAcid === y.aminoAcid) continue;
      if (y.aminoAcid === '*') return `p.${x.aminoAcid}${x.index + 1}*`;
      if (x.aminoAcid === '*') return `p.*${x.index + 1}${y.aminoAcid}`;
      return `p.${x.aminoAcid}${x.index + 1}${y.aminoAcid}`;
    }
    return 'silent';
  }

  /** Whether the codon of the CDS holding base `at` has bases on both sides of the origin. */
  function codonStraddling(strand: 'forward' | 'reverse', start: number, at: number): boolean {
    const doc = SeqDocument.create({ sequence: ref, topology: 'circular' });
    const codon = translateCds(doc, cds(strand, start)).codons.find((c) =>
      c.positions.includes(at),
    );
    return codon !== undefined && Math.max(...codon.positions) - Math.min(...codon.positions) > 3;
  }

  function reported(
    strand: 'forward' | 'reverse',
    start: number,
    reads: readonly Read[],
    at: number,
  ): { text: string; carriers: string } {
    const stack = stackOf(reads);
    const doc = SeqDocument.create({ sequence: ref, topology: 'circular' });
    const feat = cds(strand, start);
    const frames = buildFrames(stack, doc, [feat], L);
    const rows = differenceRows(
      stack,
      differenceRegions(stack.differences),
      annotationsOf([feat], []),
      frames,
      doc,
      [],
    ).filter((r) => r.position === at + 1);
    if (rows.length !== 1) throw new Error(`${rows.length} rows at ${at + 1}`);
    const [row] = rows;
    if (row === undefined) throw new Error('no row');
    return { text: effectText(row), carriers: samplesText(row) };
  }

  const wrapping = { from: 1300, to: L + 200 };
  const flat = { from: 0, to: 300 };
  const tail = { from: 1300, to: L };

  for (const strand of ['forward', 'reverse'] as const) {
    for (const start of [cdsStart, cdsStart + 1, cdsStart + 2]) {
      // Codons straddle the origin when (start + 3k) % L is 1498 or 1499
      for (const at of [1490, 1498, 1499, 0, 1, 2, 30]) {
        // The base is changed in the read that wraps (high copy for at < 200), or only in the one that does not.
        const other = at < 60 ? flat : tail;
        const straddles = codonStraddling(strand, start, at);
        for (const [label, reads, wrapCarries] of [
          ['wrapping read only carries it', [{ ...wrapping, flip: at }, other], true],
          ['non-wrapping read only carries it', [wrapping, { ...other, flip: at }], false],
        ] as const) {
          // A read's first and last base never show a mismatch (a local alignment stops short of it).
          if (!wrapCarries && (at === 0 || at === 1499)) continue;
          it(`${strand} CDS from ${start}, base ${at}: ${label}`, () => {
            const got = reported(strand, start, reads, at);
            // A read that does not wrap holds only part of a codon across the origin: no residue to call.
            const expected =
              !wrapCarries && straddles
                ? ''
                : expectedEffect(strand, start, at, slice(at, at + 1, at));
            expect(got.text).toBe(expected);
          });
        }
      }
    }
  }
});

describe('differences and agreement across the origin', { timeout: 30_000 }, () => {
  const across = { ...feature, ranges: [{ start: 1480, end: L + 20 }] };
  /** The base at position `p` changed to something else than the reference has or `not`. */
  const other = (p: number, not = ''): string =>
    ['A', 'C', 'G', 'T'].find((b) => b !== ref.charAt(p) && b !== not) ?? 'A';
  const counted = (reads: readonly Read[]) => {
    const stack = stackOf(reads);
    const cov = coverageOf(stack, 20);
    const v = verdictsOf(stack, [across], cov, confidentDifferences(stack, 20), L)[0];
    return { stack, differences: v?.differences, agreed: agreementColumns(stack, 20) };
  };

  it('counts a base once however many of its copies differ, in a feature across the origin', () => {
    // 5 is in the feature's wrapped part: the wrapping read has it at 1505, the other at 5.
    const both = counted([
      { from: 1300, to: L + 200, flip: 5 },
      { from: 0, to: 300, flip: 5 },
    ]);
    expect(both.differences).toBe(1);
    // A difference only the wrapping read sees is still one, and so is one only the other sees.
    expect(
      counted([
        { from: 1300, to: L + 200, flip: 5 },
        { from: 0, to: 300 },
      ]).differences,
    ).toBe(1);
    expect(
      counted([
        { from: 1300, to: L + 200 },
        { from: 0, to: 300, flip: 5 },
      ]).differences,
    ).toBe(1);
    // And one in the part before the origin, seen by a read that wraps and one that stops at it.
    expect(
      counted([
        { from: 1300, to: L + 200, flip: 1490 },
        { from: 1300, to: L, flip: 1490 },
      ]).differences,
    ).toBe(1);
  });

  it('counts two bases that differ on either side of the origin as two', () => {
    const two = counted([
      { from: 1300, to: L + 200, flip: 1490 },
      { from: 0, to: 300, flip: 5 },
    ]);
    expect(two.differences).toBe(2);
  });

  it('is credible when a wrapping and a non-wrapping read carry the same change', () => {
    const same = counted([
      { from: 1300, to: L + 200, flip: 5, base: other(5) },
      { from: 0, to: 300, flip: 5, base: other(5) },
    ]);
    expect(same.agreed).toHaveLength(1);
  });

  it('is not credible from one read alone, wrapping or not, or when the others cover without it', () => {
    expect(counted([{ from: 1300, to: L + 200, flip: 5 }]).agreed).toEqual([]);
    expect(
      counted([
        { from: 1300, to: L + 200, flip: 5 },
        { from: 0, to: 300 },
      ]).agreed,
    ).toEqual([]);
    expect(
      counted([
        { from: 1300, to: L + 200 },
        { from: 0, to: 300, flip: 5 },
      ]).agreed,
    ).toEqual([]);
  });

  it('is not credible when the two copies carry different bases', () => {
    const x = other(5);
    const y = other(5, x);
    const mixed = counted([
      { from: 1300, to: L + 200, flip: 5, base: x },
      { from: 0, to: 300, flip: 5, base: y },
    ]);
    expect(mixed.agreed).toEqual([]);
    expect(disagreementColumns(mixed.stack, 20)).not.toEqual([]);
  });

  it('is credible with a third read that wraps and agrees, and a clean one does not break it', () => {
    const three = counted([
      { from: 1300, to: L + 200, flip: 5, base: other(5) },
      { from: 1200, to: L + 100, flip: 5, base: other(5) },
    ]);
    expect(three.agreed).toHaveLength(1);
  });
});
