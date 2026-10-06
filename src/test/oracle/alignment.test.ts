import { finishReadAlignment, prepareReadAlignment } from '@/app/readAlignment';
import { alignBanded, alignEitherStrand, alignLong, alignPairwise } from '@/core/alignment';
import type { AlignmentMode, AlignmentOptions } from '@/core/alignment';

import oracle from './alignment.json';

/**
 * Pairwise alignment against Bio.Align.PairwiseAligner
 * (scripts/oracle/alignment.py): the optimal global and local score of about
 * ninety seeded pairs (DNA under EDNAFULL with gaps -10/-0.5, protein under
 * BLOSUM62 with -11/-1), and, where Biopython's best alignment is unique, the
 * span of each sequence it covers. Which of several equally good alignments
 * is reported is no one's rule, so ties are held to the score alone. Two
 * pairs of about 3 kb go through the banded path as well, and 24 pairs
 * built to lead the band astray (tandem repeats, an insertion near a read
 * end, #167).
 */

interface Answer {
  readonly score: number;
  readonly span?: readonly number[];
}
interface Case {
  readonly kind: string;
  readonly alphabet: string;
  readonly a: string;
  readonly b: string;
  readonly global: Answer;
  readonly local: Answer;
}

const cases = oracle.cases as readonly Case[];
const modes: readonly AlignmentMode[] = ['global', 'local'];

describe('pairwise alignment against Biopython', () => {
  it('has pairs of every kind to compare', () => {
    expect(cases.length).toBeGreaterThanOrEqual(75);
    const kinds = new Set(cases.map((c) => c.kind));
    for (const k of ['random', 'mutated', 'indel-heavy', 'iupac', 'flanked', 'tandem', 'short']) {
      expect(kinds.has(k), k).toBe(true);
    }
    expect(cases.filter((c) => c.alphabet === 'protein').length).toBeGreaterThanOrEqual(15);
  });

  it.each(modes)('%s: score, and span where the best alignment is unique', (mode) => {
    const problems: string[] = [];
    let spans = 0;
    for (const [i, c] of cases.entries()) {
      const options: AlignmentOptions = {
        mode,
        alphabet: c.alphabet === 'protein' ? 'protein' : 'nucleotide',
      };
      const r = alignPairwise(c.a, c.b, options);
      const expected = c[mode];
      const label = `#${String(i)} ${c.kind} ${c.a} / ${c.b}`;
      if (r.score !== expected.score) {
        problems.push(`${label}: score ${String(r.score)}, Biopython ${String(expected.score)}`);
      }
      // The alignment must be of the stretches it says it covers.
      if (
        r.alignedA.replaceAll('-', '').toUpperCase() !==
          c.a.slice(r.startA, r.endA).toUpperCase() ||
        r.alignedB.replaceAll('-', '').toUpperCase() !== c.b.slice(r.startB, r.endB).toUpperCase()
      ) {
        problems.push(`${label}: aligned text is not the covered span`);
      }
      if (
        mode === 'global' &&
        [r.startA, r.endA, r.startB, r.endB].join() !==
          `0,${String(c.a.length)},0,${String(c.b.length)}`
      ) {
        problems.push(`${label}: a global alignment must cover both sequences`);
      }
      if (expected.span !== undefined) {
        spans++;
        const got = [r.startA, r.endA, r.startB, r.endB];
        if (got.join() !== expected.span.join()) {
          problems.push(`${label}: span ${got.join()}, Biopython ${expected.span.join()}`);
        }
      }
    }
    expect(spans).toBeGreaterThan(mode === 'local' ? 25 : 15);
    expect(problems).toEqual([]);
  });

  it('agrees on 3 kb pairs through the full, banded and fast paths', () => {
    expect(oracle.long).toHaveLength(2);
    for (const c of oracle.long) {
      expect(alignPairwise(c.a, c.b, { mode: 'global' }).score).toBe(c.global);
      expect(alignLong(c.a, c.b, { mode: 'global', fast: true }).score).toBe(c.global);
      const banded = alignBanded(c.a, c.b, { mode: 'global' });
      expect(banded).not.toBeNull();
      expect(banded?.exact).toBe(true);
      expect(banded?.alignment.score).toBe(c.global);
    }
  }, 30_000);

  // Tandem duplications and long insertions near a read's end, where the
  // band around shared words misses the best path (#167): the check after
  // the band has to find Biopython's optimum, global and local.
  it('reaches the optimum where the band alone misses it (#167)', () => {
    const banded = oracle.banded;
    expect(banded).toHaveLength(24);
    const problems: string[] = [];
    for (const [i, c] of banded.entries()) {
      const label = `#${String(i)} ${c.kind}`;
      const global = alignBanded(c.a, c.b, { mode: 'global' });
      if (global !== null && global.alignment.score !== c.global) {
        problems.push(
          `${label} global: ${String(global.alignment.score)}, Biopython ${String(c.global)}`,
        );
      }
      const local = alignEitherStrand(c.a, c.b, { mode: 'local', fast: true }).alignment.score;
      if (local !== c.local) {
        problems.push(`${label} local: ${String(local)}, Biopython ${String(c.local)}`);
      }
    }
    expect(problems).toEqual([]);
  }, 60_000);
});

interface CircularCase {
  readonly kind: string;
  readonly ref: string;
  readonly read: string;
  readonly score: number;
  readonly strand: 'forward' | 'reverse';
  readonly start: number;
  readonly last: number;
  readonly regions: readonly (readonly [number, string, string])[];
}

/** Differences of an alignment: (1-based position on the circle, reference bases, read bases). */
function regions(a: string, b: string, start: number, length: number): string[] {
  const out: string[] = [];
  let cur: { first: number; last: number; ref: string; read: string } | null = null;
  let p = start;
  const flush = (): void => {
    if (cur === null) return;
    const pos = (cur.ref === '' ? cur.last : cur.first) % length;
    out.push(`${String(pos + 1)} ${cur.ref || '-'} ${cur.read || '-'}`);
    cur = null;
  };
  for (let i = 0; i < a.length; i++) {
    const x = a.charAt(i);
    const y = b.charAt(i);
    if (x !== y) {
      cur ??= { first: p, last: p - 1, ref: '', read: '' };
      if (x !== '-') cur.last = p;
      cur.ref += x === '-' ? '' : x;
      cur.read += y === '-' ? '' : y;
    } else flush();
    if (x !== '-') p++;
  }
  flush();
  return out;
}

/**
 * Reads mapped onto a circular reference as the Align tab does it, against a
 * Biopython local alignment to the reference rotated so the read lies inside
 * it: reads across the origin on both strands, a deletion before the origin,
 * an insertion at it, a deletion or insertion just after it (#165), reads
 * inside either end, and reads the length of the whole plasmid. Banded
 * tandem or end-insertion cases (#167) are left out.
 */
describe('circular read mapping against Biopython', () => {
  const circular = oracle.circular as unknown as readonly CircularCase[];

  it('has reads of every kind', () => {
    expect(circular.length).toBeGreaterThanOrEqual(40);
    const kinds = new Set(circular.map((c) => c.kind));
    for (const k of [
      'span',
      'span_rc',
      'bigdel_before',
      'bigins_origin',
      'del_after',
      'del_after_rc',
      'del_after_short',
      'ins_after',
      'whole',
      'whole_rc',
    ]) {
      expect(kinds.has(k), k).toBe(true);
    }
  });

  it('gives Biopython score, strand, span and differences', () => {
    const problems: string[] = [];
    for (const [i, c] of circular.entries()) {
      const reference = { sequence: c.ref, offset: 0, wrap: c.ref.length };
      const prep = prepareReadAlignment(reference, { sequence: c.read, read: null }, null);
      if (!prep.ok) {
        problems.push(`#${String(i)} ${c.kind}: ${prep.message}`);
        continue;
      }
      const res = finishReadAlignment(
        prep.job,
        alignEitherStrand(prep.job.a, prep.job.b, { mode: 'local' }),
      );
      const al = res.alignment;
      const L = c.ref.length;
      const got = {
        score: al.score,
        strand: res.strand,
        start: al.startA % L,
        last: (al.endA - 1) % L,
        regions: regions(al.alignedA, al.alignedB, al.startA, L),
      };
      const want = {
        score: c.score,
        strand: c.strand,
        start: c.start,
        last: c.last,
        regions: c.regions.map((r) => r.join(' ')),
      };
      if (JSON.stringify(got) !== JSON.stringify(want)) {
        problems.push(
          `#${String(i)} ${c.kind}: ${JSON.stringify(got).slice(0, 200)} vs ${JSON.stringify(want).slice(0, 200)}`,
        );
      }
    }
    expect(problems).toEqual([]);
  }, 120_000);
});
