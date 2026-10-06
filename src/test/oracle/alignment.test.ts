import { alignBanded, alignLong, alignPairwise } from '@/core/alignment';
import type { AlignmentMode, AlignmentOptions } from '@/core/alignment';

import oracle from './alignment.json';

/**
 * Pairwise alignment against Bio.Align.PairwiseAligner
 * (scripts/oracle/alignment.py): the optimal global and local score of about
 * ninety seeded pairs (DNA under EDNAFULL with gaps -10/-0.5, protein under
 * BLOSUM62 with -11/-1), and, where Biopython's best alignment is unique, the
 * span of each sequence it covers. Which of several equally good alignments
 * is reported is no one's rule, so ties are held to the score alone. Two
 * pairs of about 3 kb go through the banded path as well.
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
      if (banded !== null && !banded.touchedEdge) expect(banded.alignment.score).toBe(c.global);
    }
  });
});
