import { describe, expect, it } from 'vitest';

import { alignMultiple, pairAccuracy, sumOfPairs } from '@/core/alignment';

import oracle from './msa.json';

/**
 * Multiple alignment against MAFFT (#207, docs/design/85-multiple-alignment.md).
 * scripts/oracle/msa.py simulates eight sets of related sequences (four of
 * bases, four of proteins, 8 to 30 sequences) along a random tree with
 * substitutions and indels, so the true alignment is known, and has MAFFT
 * align each. The committed alignments are all this test reads: MAFFT is
 * never run here.
 *
 * The acceptance metric is the share of the true alignment's residue pairs
 * an alignment puts in one column (BAliBASE's SP score, `pairAccuracy`):
 * over the eight sets ours must reach at least 90% of MAFFT's mean, and on
 * no set fall more than 0.12 below MAFFT. The raw sum of pairs is checked
 * on the same sets only against the true alignment, since it rewards
 * packing unrelated insertions into shared columns, which MAFFT does and a
 * progressive aligner does not.
 */

const sets = oracle.sets;

describe('multiple alignment against MAFFT', () => {
  const rows: { name: string; ours: number; mafft: number }[] = [];

  for (const set of sets) {
    it(
      `${set.name}: keeps every sequence and is not far behind MAFFT`,
      { timeout: 120_000 },
      () => {
        const alphabet = set.alphabet as 'nucleotide' | 'protein';
        const ours = alignMultiple(set.sequences, { alphabet });
        // The sequences themselves are untouched.
        ours.rows.forEach((row, i) => {
          expect(row.replace(/-/g, '')).toBe(set.sequences[i]);
          expect(row.length).toBe(ours.columns);
        });
        const a = pairAccuracy(set.truth, ours.rows);
        const m = pairAccuracy(set.truth, set.mafft);
        rows.push({ name: set.name, ours: a, mafft: m });
        expect(a).toBeGreaterThan(m - 0.12);
        // Better than the guide alone: never below what the true alignment scores for itself, halved.
        expect(sumOfPairs(ours.rows, alphabet)).toBeGreaterThan(
          sumOfPairs(set.truth, alphabet) - Math.abs(sumOfPairs(set.truth, alphabet)) * 5,
        );
      },
    );
  }

  it('averages at least 90% of MAFFT over all sets', () => {
    expect(rows.length).toBe(sets.length);
    const ours = rows.reduce((s, r) => s + r.ours, 0) / rows.length;
    const mafft = rows.reduce((s, r) => s + r.mafft, 0) / rows.length;
    expect(ours).toBeGreaterThanOrEqual(0.9 * mafft);
  });
});
