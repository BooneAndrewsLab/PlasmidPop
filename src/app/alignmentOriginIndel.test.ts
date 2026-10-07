import { alignEitherStrand, reverseComplement } from '@/core';
import { differenceRows } from './alignmentDifferences';
import { agreementColumns } from './alignmentDisagreement';
import { differenceRegions, stackAlignments } from './alignmentStack';
import { confidentDifferences, coverageOf, verdictsOf } from './alignmentVerdict';
import { finishReadAlignment, prepareReadAlignment, type ReferenceInput } from './readAlignment';

/** Insertions and deletions seen across a circle's origin by reads that do and do not wrap it (#177). */

function lcg(seed: number): () => number {
  let s = seed;
  return () => (s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
}
const rand = lcg(11);
const L = 1500;
const ref = Array.from({ length: L }, () => 'ACGT'[Math.floor(rand() * 4)]).join('');
const circle: ReferenceInput = { sequence: ref, offset: 0, wrap: L };

function align(read: string) {
  const prep = prepareReadAlignment(circle, { sequence: read, read: null }, null);
  if (!prep.ok) throw new Error(prep.message);
  return finishReadAlignment(
    prep.job,
    alignEitherStrand(prep.job.a, prep.job.b, { mode: 'local' }),
  );
}

interface Edit {
  at: number;
  kind: 'ins' | 'del';
  text?: string;
}
/** Circular slice [from, to); an insertion goes before base `at`, a deletion drops it. */
function slice(from: number, to: number, edit: Edit): string {
  let out = '';
  for (let i = from; i < to; i++) {
    const p = ((i % L) + L) % L;
    const b = ref.charAt(p);
    if (p !== edit.at) out += b;
    else if (edit.kind === 'ins') out += (edit.text ?? 'GG') + b;
  }
  return out;
}

interface Read {
  from: number;
  to: number;
  reverse?: boolean;
}
const feature = {
  name: 'f',
  type: 'misc_feature',
  strand: 'forward' as const,
  colour: '#000',
  ranges: [{ start: 1480, end: L + 20 }],
  orf: false,
};
function run(reads: readonly Read[], edit: Edit) {
  const stack = stackAlignments(
    circle,
    reads.map((r, i) => {
      const fwd = slice(r.from, r.to, edit);
      return { name: `r${i}`, result: align(r.reverse === true ? reverseComplement(fwd) : fwd) };
    }),
  );
  const cov = coverageOf(stack, 20);
  const v = verdictsOf(stack, [feature], cov, confidentDifferences(stack, 20), L)[0];
  if (v === undefined) throw new Error('no verdict');
  const rows = differenceRows(stack, differenceRegions(stack.differences), [], [], null, []);
  return { stack, v, rows, agreed: agreementColumns(stack, 20) };
}

const wrapping: Read = { from: 1300, to: L + 200 };
const startRead: Read = { from: 0, to: 300 };
const endRead: Read = { from: 1200, to: L };

describe('an insertion seen from both sides of the origin', { timeout: 30_000 }, () => {
  for (const at of [5, 1490]) {
    for (const reverse of [false, true]) {
      for (const [label, other] of [
        ['a start read', startRead],
        ['an end read', endRead],
      ] as const) {
        // An insertion before base 5 is not on the end read, nor before base 1490 on the start read.
        if ((at === 5) === (other === endRead)) continue;
        it(`is one difference with two carriers: before base ${at}, ${label}, ${reverse ? 'reverse' : 'forward'}`, () => {
          const edit: Edit = { at, kind: 'ins' };
          const { v, rows, agreed } = run([wrapping, { ...other, reverse }], edit);
          expect(rows).toHaveLength(1);
          expect(rows[0]?.carriers).toHaveLength(2);
          // One difference per inserted base, as for an insertion away from the origin.
          expect(v.differences).toBe(2);
          expect(agreed.length).toBeGreaterThan(0);
        });
      }
    }
  }

  it('pairs the inserted columns of the two copies, in order', () => {
    const { stack } = run([wrapping, startRead], { at: 5, kind: 'ins' });
    const inserted = [...stack.refIndex].flatMap((i, c) => (i < 0 ? [c] : []));
    expect(inserted).toHaveLength(4);
    for (const c of inserted) {
      const t = stack.twin[c] ?? -1;
      expect(t).toBeGreaterThanOrEqual(0);
      expect(stack.twin[t]).toBe(c);
    }
  });

  it('is one agreed difference when two wrapping reads and a start read carry it', () => {
    const { rows, agreed } = run(
      [wrapping, { from: 1250, to: L + 150, reverse: true }, startRead],
      { at: 5, kind: 'ins' },
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.carriers).toHaveLength(3);
    expect(agreed.length).toBeGreaterThan(0);
  });

  it('is unchanged for reads that all wrap, or that do not reach it', () => {
    const { rows } = run([wrapping, { from: 1250, to: L + 150 }], { at: 5, kind: 'ins' });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.carriers).toHaveLength(2);
    const clean = run([wrapping, { from: 1200, to: L }], { at: 5, kind: 'ins' });
    expect(clean.rows).toHaveLength(1);
    expect(clean.rows[0]?.carriers).toHaveLength(1);
  });
});

describe('a deletion seen from both sides of the origin', { timeout: 30_000 }, () => {
  for (const [at, other] of [
    [5, startRead],
    [1490, endRead],
  ] as const) {
    it(`is one difference with two carriers: base ${at}`, () => {
      const { rows, v } = run([wrapping, other], { at, kind: 'del' });
      expect(rows).toHaveLength(1);
      expect(rows[0]?.carriers).toHaveLength(2);
      expect(v.differences).toBe(1);
    });
  }
});
