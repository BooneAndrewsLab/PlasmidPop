import { describe, expect, it } from 'vitest';

import {
  AlignmentTooLargeError,
  MAX_MSA_SEQUENCES,
  alignMultiple,
  msaFasta,
  msaClustal,
  conservationMarks,
  kmerDistances,
  pairAccuracy,
  summariseColumns,
  sumOfPairs,
  treeWeights,
  uniqueNames,
  upgma,
} from '.';

const strip = (rows: readonly string[]): string[] => rows.map((r) => r.replace(/-/g, ''));

describe('alignMultiple', () => {
  it('lines identical sequences up with no gaps', () => {
    const s = 'ATGGCGTACGTTAGC';
    const out = alignMultiple([s, s, s]);
    expect(out.rows).toEqual([s, s, s]);
  });

  it('puts a deletion in one sequence opposite its bases in the others', () => {
    const full = 'ATGGCGTACGTTAGCCATTGACCGGATCAAGT';
    const cut = 'ATGGCGTACGTTAGCCGGATCAAGT'; // CATTGAC missing
    const out = alignMultiple([full, cut, full]);
    expect(strip(out.rows)).toEqual([full, cut, full]);
    // One run of seven gaps, wherever the repeat of C lets it sit.
    expect(out.rows[1]?.match(/-+/g)).toEqual(['-------']);
    expect(out.columns).toBe(full.length);
  });

  it('handles protein under BLOSUM62 and keeps the residues', () => {
    const a = 'MKTAYIAKQRQISFVKSHFSRQ';
    const b = 'MKTAYIAKQRQISFVKSHFSRQ';
    const c = 'MKSAYIAKQKQISFVKSHFSRQ'; // two conservative substitutions
    const d = 'MKTAYIAKQRQISFVKSHFSRQLEERLGLIEVQ'; // a tail
    const out = alignMultiple([a, b, c, d], { alphabet: 'protein' });
    expect(strip(out.rows)).toEqual([a, b, c, d]);
    // The three shorter ones end where the fourth carries on.
    expect(out.rows[3]?.slice(0, 22)).toBe(a);
    expect(out.rows[0]?.slice(22)).toBe('-'.repeat(11));
  });

  it('does not penalise a fragment for being one', () => {
    const whole = 'ATGGCGTACGTTAGCCATTGACCGGATCAAGTTTGACCA';
    const part = whole.slice(8, 30);
    const out = alignMultiple([whole, part, whole, whole]);
    expect(out.rows[1]).toBe('-'.repeat(8) + part + '-'.repeat(whole.length - 30));
  });

  it('gives the same answer however the input is ordered', () => {
    const seqs = [
      'ATGGCGTACGTTAGCCATTGACC',
      'ATGGCGTACGTAGCCATTGACC',
      'ATGGCGTACGTTAGCCTTGACC',
      'ATGGCGTTAGCCATTGACCGG',
    ];
    const a = alignMultiple(seqs);
    const b = alignMultiple([...seqs].reverse());
    expect(sumOfPairs(a.rows, 'nucleotide')).toBe(sumOfPairs([...b.rows].reverse(), 'nucleotide'));
  });

  it('reads ambiguity codes and U', () => {
    const out = alignMultiple(['ACGUACGUNN', 'ACGTACGTAA', 'ACGTACGTCC']);
    expect(out.columns).toBe(10);
  });

  it('reports progress up to one', () => {
    const seen: number[] = [];
    alignMultiple(['ACGTACGTAC', 'ACGTACGTAC', 'ACGAACGTAC', 'ACGTTCGTAC'], {
      onProgress: (f) => seen.push(f),
    });
    expect(seen.at(-1)).toBe(1);
    expect(seen.every((f, i) => i === 0 || f >= (seen[i - 1] ?? 0))).toBe(true);
  });

  it('refuses too few, too many, empty and too large', () => {
    expect(() => alignMultiple(['ACGT'])).toThrow(/at least two/);
    expect(() =>
      alignMultiple(Array.from({ length: MAX_MSA_SEQUENCES + 1 }, () => 'ACGT')),
    ).toThrow(/at most 50/);
    expect(() => alignMultiple(['ACGT', '', 'ACGT'])).toThrow(/empty/);
    expect(() => alignMultiple(['ACGTACGT', 'ACGTACGT', 'ACGTACGT'], { maxCells: 10 })).toThrow(
      AlignmentTooLargeError,
    );
  });

  it('aligns fifty sequences', () => {
    let seed = 7;
    const rnd = (): number => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x7fffffff;
    };
    const root = Array.from({ length: 120 }, () => 'ACGT'[Math.floor(rnd() * 4)]).join('');
    const seqs = Array.from({ length: 50 }, () =>
      root
        .split('')
        .map((c) => (rnd() < 0.05 ? 'ACGT'[Math.floor(rnd() * 4)] : c))
        .join(''),
    );
    const out = alignMultiple(seqs, { refine: false });
    expect(strip(out.rows)).toEqual(seqs);
  });
});

describe('guide tree', () => {
  it('joins the closest pair first and weighs a lone relative more than a clade', () => {
    const d = [
      [0, 0.1, 0.8, 0.8],
      [0.1, 0, 0.8, 0.8],
      [0.8, 0.8, 0, 0.1],
      [0.8, 0.8, 0.1, 0],
    ];
    const root = upgma(d);
    expect(root.members.length).toBe(4);
    const w = treeWeights(root, 4);
    expect(w.reduce((s, x) => s + x, 0)).toBeCloseTo(1);
    const star = upgma([
      [0, 0.1, 0.9],
      [0.1, 0, 0.9],
      [0.9, 0.9, 0],
    ]);
    const ws = treeWeights(star, 3);
    expect(ws[2]).toBeGreaterThan(ws[0] ?? 1);
  });

  it('weighs identical sequences equally', () => {
    const root = upgma([
      [0, 0, 0],
      [0, 0, 0],
      [0, 0, 0],
    ]);
    expect(treeWeights(root, 3)).toEqual([1 / 3, 1 / 3, 1 / 3]);
  });

  it('measures k-mer distance as zero for the same sequence and one for none shared', () => {
    const enc = (s: string): Uint8Array =>
      Uint8Array.from(s.split('').map((c) => 'ATGC'.indexOf(c)));
    const d = kmerDistances([enc('AAAAAAAA'), enc('AAAAAAAA'), enc('CCCCCCCC')], 4, 3);
    expect(d[0]?.[1]).toBe(0);
    expect(d[0]?.[2]).toBe(1);
  });
});

describe('what is read off an alignment', () => {
  const rows = ['ACGT-A', 'ACGTTA', 'ACCT-A'];

  it('names a consensus and its conservation', () => {
    const cols = summariseColumns(rows);
    expect(cols.map((c) => c.consensus).join('')).toBe('ACGT-A');
    expect(cols[0]?.conservation).toBe(1);
    expect(cols[2]?.conservation).toBeCloseTo(2 / 3);
    expect(cols[4]?.conservation).toBeCloseTo(1 / 3);
  });

  it('marks fully conserved columns and, for proteins, conservative ones', () => {
    expect(conservationMarks(rows, 'nucleotide')).toBe('** * *');
    expect(conservationMarks(['KLV', 'RLI', 'KLV'], 'protein')).toBe(':*:');
  });

  it('writes aligned FASTA of equal-length records', () => {
    expect(msaFasta(['a', 'b'], ['AC-GT', 'ACTGT'])).toBe('>a\nAC-GT\n>b\nACTGT\n');
    const long = 'A'.repeat(130);
    expect(
      msaFasta(['x'], [long])
        .split('\n')
        .map((l) => l.length),
    ).toEqual([2, 60, 60, 10, 0]);
  });

  it('writes Clustal blocks with running residue counts', () => {
    const text = msaClustal(['one', 'two'], ['AC-GT', 'ACTGT'], 'nucleotide');
    expect(text.startsWith('CLUSTAL W (1.83) multiple sequence alignment\n')).toBe(true);
    expect(text).toContain('one'.padEnd(18) + 'AC-GT 4');
    expect(text).toContain('two'.padEnd(18) + 'ACTGT 5');
    expect(text).toContain(' '.repeat(18) + '** **');
  });

  it('makes names unique and whitespace-free', () => {
    expect(uniqueNames(['a b', 'a b', ' ', 'c'])).toEqual(['a_b', 'a_b_2', 'sequence_3', 'c']);
  });

  it('scores the sum of pairs and the share of true pairs', () => {
    expect(sumOfPairs(['ACGT', 'ACGT'], 'nucleotide')).toBe(20);
    // A gap in the middle opens once, then extends.
    expect(sumOfPairs(['ACGTACGT', 'AC--ACGT'], 'nucleotide')).toBe(6 * 5 - 10 - 0.5);
    // End gaps only extend.
    expect(sumOfPairs(['ACGTA', '--GTA'], 'nucleotide')).toBe(15 - 1);
    expect(pairAccuracy(['AC-T', 'ACGT'], ['AC-T', 'ACGT'])).toBe(1);
    expect(pairAccuracy(['ACT-', 'ACGT'], ['AC-T', 'ACGT'])).toBeLessThan(1);
  });
});
