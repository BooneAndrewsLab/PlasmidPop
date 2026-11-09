import { describe, expect, it } from 'vitest';

import {
  AlignmentTooLargeError,
  MAX_MSA_SEQUENCES,
  type MsaOptions,
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

  it('counts the words on the radix of its alphabet: ambiguity codes join none, residues all', () => {
    // Bases: A and C differ in one base of ten, B shares only a run of Ns with A. An
    // ambiguity code spoils a word, so A and C are the closest pair.
    const a = 'ACGTAGCTAG' + 'N'.repeat(12);
    const b = 'CCCCCCCCCC' + 'N'.repeat(12);
    const c = 'ACGTAGCTAT' + 'G'.repeat(12);
    expect(alignMultiple([a, b, c], { refine: false }).tree).toBe('(2,(1,3))');
    // Residues: W, Y, F, H and E are all words, though none is among the first four codes.
    // The last two share all but one residue, so they join first, not the first two.
    const pc = 'AAAAARRRRRNNNNN';
    const pa = 'WWWWWYYYYYFFFFF';
    const pb = 'WWWWWYYYYYFFFFH';
    expect(alignMultiple([pc, pa, pb], { alphabet: 'protein', refine: false }).tree).toBe(
      '(1,(2,3))',
    );
  });

  it('refines the progressive alignment when the sum-of-pairs score rises, and only then', () => {
    const seqs = [
      'GCCCGTGAGCTAGGACTGCGGGGCATCAAATTCAAG',
      'GCTCCGTGAGTTAGGATCTTGCGGGCATCAAATTTACAAG',
      'GCTCGTGAGTCTAGGTCTCTGCGGGGCATCAAATTAAG',
      'CTCCGTGAGTCTAGGATCTGCGGGGATCAAATTAAG',
      'GCTCCGTGAGTCTTAGGATCTTGCGGGCACCAAATTCAAG',
    ];
    const rough = alignMultiple(seqs, { refine: false });
    const refined = alignMultiple(seqs);
    expect(sumOfPairs(rough.rows, 'nucleotide')).toBe(1082.5);
    expect(sumOfPairs(refined.rows, 'nucleotide')).toBe(1151.5);
    // Whatever moved, the rows are the sequences, in one width, with no column of gaps alone.
    expect(strip(refined.rows)).toEqual(seqs);
    expect(new Set(refined.rows.map((r) => r.length))).toEqual(new Set([refined.columns]));
    for (let c = 0; c < refined.columns; c++) {
      expect(refined.rows.some((r) => r.charAt(c) !== '-')).toBe(true);
    }
    // The score never falls: sequences the first pass already aligned are left alone.
    const s = 'ATGGCGTACGTTAGC';
    expect(alignMultiple([s, s, s, s]).rows).toEqual([s, s, s, s]);
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

// Instrumented, one of these takes minutes (3.9 s plain, 60 s was not enough for it
// in the dry run), and every surviving mutant of the fill would run them all:
// `msaBand.test.ts` pins the same joins in cells and rows, so a mutation run leaves
// these out, as it does the other heavy alignment suites (item 50).
describe.skipIf(process.env['PLASMIDPOP_MUTATION'] === '1')('joins along a band (#372)', () => {
  /** A seeded generator (mulberry32), so every set is the same on every run. */
  const random = (seed: number): (() => number) => {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  };
  const BASES = 'ACGT';
  const RESIDUES = 'ACDEFGHIKLMNPQRSTVWY';
  const letters = (rnd: () => number, alphabet: string, length: number): string =>
    Array.from({ length }, () => alphabet.charAt(Math.floor(rnd() * alphabet.length))).join('');
  /** `count` copies of `root`, each with `edits` deletions, insertions or substitutions of 1 to `longest` letters. */
  const copies = (
    rnd: () => number,
    alphabet: string,
    root: string,
    count: number,
    edits: number,
    longest = 20,
  ): string[] =>
    Array.from({ length: count }, () => {
      let s = root;
      for (let e = 0; e < edits; e++) {
        const p = Math.floor(rnd() * (s.length - longest));
        const len = 1 + Math.floor(rnd() * longest);
        const kind = Math.floor(rnd() * 3);
        if (kind === 0) s = s.slice(0, p) + s.slice(p + len);
        else if (kind === 1) s = s.slice(0, p) + letters(rnd, alphabet, len) + s.slice(p);
        else s = s.slice(0, p) + letters(rnd, alphabet, 1) + s.slice(p + 1);
      }
      return s;
    });
  /** The alignment with every join tried along a band, the one with none, and the cells each filled. */
  const both = (seqs: readonly string[], options: MsaOptions = {}) => {
    const banded = { filled: 0, full: 0, joins: 0, narrower: 0 };
    const count = (filled: number, full: number): void => {
      banded.filled += filled;
      banded.full += full;
      banded.joins++;
      if (filled < full) banded.narrower++;
    };
    const along = alignMultiple(seqs, { ...options, bandAbove: 0, onJoin: count });
    const whole = alignMultiple(seqs, { ...options, bandAbove: Infinity });
    return { along, whole, banded };
  };

  it(
    'gives the full fill’s alignment for similar bases with indels, filling a fraction of it',
    { timeout: 60_000 },
    () => {
      for (const seed of [1, 2, 3, 4, 5]) {
        const rnd = random(seed);
        const seqs = copies(rnd, BASES, letters(rnd, BASES, 900), 3 + (seed % 3), 4);
        const { along, whole, banded } = both(seqs);
        expect(along.rows).toEqual(whole.rows);
        expect(along.tree).toBe(whole.tree);
        expect(banded.narrower).toBe(banded.joins);
        expect(banded.filled).toBeLessThan(banded.full / 2);
      }
    },
  );

  it(
    'gives the full fill’s alignment for similar proteins with indels',
    { timeout: 60_000 },
    () => {
      for (const seed of [11, 12, 13]) {
        const rnd = random(seed);
        const seqs = copies(rnd, RESIDUES, letters(rnd, RESIDUES, 700), 4, 3, 8);
        const { along, whole, banded } = both(seqs, { alphabet: 'protein' });
        expect(along.rows).toEqual(whole.rows);
        expect(banded.narrower).toBe(banded.joins);
      }
    },
  );

  it(
    'fills a second, wider band when the path leaves the first, as for a long insertion',
    { timeout: 60_000 },
    () => {
      const rnd = random(21);
      const root = letters(rnd, BASES, 1200);
      // One copy carries 400 bases more: the path runs 400 diagonals off the corners' line.
      const seqs = [root, root, root.slice(0, 500) + letters(rnd, BASES, 400) + root.slice(500)];
      const { along, whole, banded } = both(seqs);
      expect(along.rows).toEqual(whole.rows);
      expect(along.rows[0]?.match(/-+/g)).toEqual(['-'.repeat(400)]);
      expect(banded.narrower).toBe(banded.joins);
    },
  );

  it(
    'falls back to the full fill when no band is worth trying, with nothing spent on one',
    { timeout: 60_000 },
    () => {
      const rnd = random(31);
      const x = letters(rnd, BASES, 600);
      const y = letters(rnd, BASES, 600);
      // Unrelated sequences share no words.
      const unrelated = both([x, y, letters(rnd, BASES, 600)]);
      expect(unrelated.along.rows).toEqual(unrelated.whole.rows);
      expect(unrelated.banded.filled).toBe(unrelated.banded.full);
      // One shared core far from both corners: the rectangles from the corners to it are most of the matrix.
      const core = letters(rnd, BASES, 100);
      const lopsided = both(
        [0, 1, 2].map(() => letters(rnd, BASES, 1000) + core + letters(rnd, BASES, 250)),
        { refine: false },
      );
      expect(lopsided.along.rows).toEqual(lopsided.whole.rows);
      expect(lopsided.banded.filled).toBe(lopsided.banded.full);
      // A gap that costs less to extend than to open has no bound the band can use.
      const odd = both([x, x, x + y], { gapOpen: -0.5, gapExtend: -2 });
      expect(odd.along.rows).toEqual(odd.whole.rows);
      expect(odd.banded.filled).toBe(odd.banded.full);
    },
  );

  it(
    'holds a best path that runs far from the corners’ diagonal in the region the bound leaves',
    { timeout: 60_000 },
    () => {
      const rnd = random(32);
      const x = letters(rnd, BASES, 600);
      const y = letters(rnd, BASES, 600);
      // The same halves in the other order: the best path pairs one half 600 diagonals off.
      const swapped = both([x + y, y + x, x + y]);
      expect(swapped.along.rows).toEqual(swapped.whole.rows);
      expect(swapped.banded.narrower).toBe(swapped.banded.joins);
    },
  );

  it(
    'bands identical sequences to their diagonal and keeps a very short one exact',
    { timeout: 60_000 },
    () => {
      const rnd = random(41);
      const root = letters(rnd, BASES, 1000);
      const same = both([root, root, root, root]);
      expect(same.along.rows).toEqual([root, root, root, root]);
      // The first band about the shared words holds every path as good: nothing more is filled.
      expect(same.banded.filled).toBeLessThan(same.banded.full / 4);
      const short = both([root, root.slice(0, 300) + root.slice(320), root.slice(400, 425)]);
      expect(short.along.rows).toEqual(short.whole.rows);
      expect(strip(short.along.rows)[2]).toBe(root.slice(400, 425));
    },
  );

  it(
    'refines along the band too, cutting out columns of mostly gaps and back',
    { timeout: 60_000 },
    () => {
      const rnd = random(51);
      const root = letters(rnd, BASES, 800);
      const seqs = [
        ...copies(rnd, BASES, root, 3, 3),
        root.slice(0, 200) + letters(rnd, BASES, 60) + root.slice(200),
      ];
      const { along, whole } = both(seqs);
      expect(along.rows).toEqual(whole.rows);
      for (let c = 0; c < along.columns; c++) {
        expect(along.rows.some((r) => r.charAt(c) !== '-')).toBe(true);
      }
    },
  );

  it(
    'aligns four 9.4 kb copies of one plasmid filling a few percent of the full matrices',
    { timeout: 60_000 },
    () => {
      // The set of #372 (four samples of one plasmid, a few indels each), made up: 43 s before.
      const rnd = random(372);
      const seqs = copies(rnd, BASES, letters(rnd, BASES, 9400), 4, 4);
      let filled = 0;
      let full = 0;
      const out = alignMultiple(seqs, {
        onJoin: (f, all) => {
          filled += f;
          full += all;
        },
      });
      expect(strip(out.rows)).toEqual(seqs);
      // Counted, not timed: a return to the full fill is 88 M cells a join.
      expect(full).toBeGreaterThan(500_000_000);
      expect(filled).toBeLessThan(full / 20);
    },
  );
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

  it("measures k-mer distance as the share of the shorter sequence's windows not found in the other", () => {
    const enc = (s: string): Uint8Array =>
      Uint8Array.from(s.split('').map((c) => (c === 'N' ? 4 : 'ACGT'.indexOf(c))));
    // ACGT holds AC, CG, GT; ACTT holds AC, CT, TT: one of three is shared.
    const one = kmerDistances([enc('ACGT'), enc('ACTT')], 4, 2);
    expect(one[0]?.[1]).toBeCloseTo(2 / 3, 12);
    // With multiplicity: AAAA holds AA three times, AACC once.
    const many = kmerDistances([enc('AAAA'), enc('AACC')], 4, 2);
    expect(many[0]?.[1]).toBeCloseTo(2 / 3, 12);
    // The shorter sequence sets the denominator, whichever comes first: ACGTAC has
    // five windows, ACTG three, and AC is the one shared.
    for (const order of [
      [enc('ACGTAC'), enc('ACTG')],
      [enc('ACTG'), enc('ACGTAC')],
    ]) {
      const d = kmerDistances(order, 4, 2);
      expect(d[0]?.[1]).toBeCloseTo(2 / 3, 12);
      expect(d[1]?.[0]).toBeCloseTo(2 / 3, 12);
    }
    // A window with an ambiguity code is not counted on either side: ACNGT has AC and GT only.
    const amb = kmerDistances([enc('ACNGT'), enc('ACTTT')], 4, 2);
    expect(amb[0]?.[1]).toBeCloseTo(1 / 2, 12);
  });

  it('measures zero between identical sequences that hold ambiguity codes', () => {
    // ACGT are 0-3 and anything else is 4, an ambiguity code.
    const enc = (s: string): Uint8Array =>
      Uint8Array.from(
        s.split('').map((c) => (c === 'N' || 'RY'.includes(c) ? 4 : 'ACGT'.indexOf(c))),
      );
    for (const s of ['ACGTACGTNN', 'NNNNACGTNNNN', 'ACNGTACGTRCAAAYGT']) {
      const d = kmerDistances([enc(s), enc(s)], 4, 3);
      expect(d[0]?.[1]).toBe(0);
      expect(d[1]?.[0]).toBe(0);
    }
  });

  it('measures zero between identical sequences with more than 65535 of one k-mer', () => {
    const homopolymer = new Uint8Array(100_000);
    const d = kmerDistances([homopolymer, homopolymer.slice()], 4, 6);
    expect(d[0]?.[1]).toBe(0);
    // A repeat-rich mix, with a short sequence of the same repeat, stays symmetric.
    const repeat = Uint8Array.from({ length: 150_000 }, (_, i) => (i % 3 === 0 ? 1 : 0));
    const e = kmerDistances([repeat, repeat.slice(), homopolymer.slice(0, 500)], 4, 6);
    expect(e[0]?.[1]).toBe(0);
    for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) expect(e[a]?.[b]).toBe(e[b]?.[a]);
  });

  it('measures zero between identical sequences with no valid k-mer, one otherwise', () => {
    // ACGT are 0-3, N is 4 and R is 5: both are ambiguity codes.
    const enc = (s: string): Uint8Array =>
      Uint8Array.from(s.split('').map((c) => (c === 'N' ? 4 : c === 'R' ? 5 : 'ACGT'.indexOf(c))));
    expect(kmerDistances([enc('NNNNNN'), enc('NNNNNN')], 4, 3)[0]?.[1]).toBe(0);
    expect(kmerDistances([enc('AC'), enc('AC')], 4, 3)[0]?.[1]).toBe(0);
    expect(kmerDistances([enc('NNNNNN'), enc('RRRRRR')], 4, 3)[0]?.[1]).toBe(1);
    expect(kmerDistances([enc('ACGTAC'), enc('NNNNNN')], 4, 3)[0]?.[1]).toBe(1);
  });

  it('tells sequences with no valid k-mer apart when their lengths differ, whatever the order', () => {
    // N is 4, an ambiguity code: NN and NNN hold no word of 3, and NN is a prefix of NNN.
    const enc = (s: string): Uint8Array =>
      Uint8Array.from(s.split('').map((c) => (c === 'N' ? 4 : 'ACGT'.indexOf(c))));
    expect(kmerDistances([enc('NN'), enc('NNN')], 4, 3)[0]?.[1]).toBe(1);
    expect(kmerDistances([enc('NNN'), enc('NN')], 4, 3)[0]?.[1]).toBe(1);
    expect(kmerDistances([enc('ACNN'), enc('ACNNN')], 4, 3)[1]?.[0]).toBe(1);
    // The same length and a different code is told apart at the last place too.
    expect(kmerDistances([enc('NNNA'), enc('NNNC')], 4, 5)[0]?.[1]).toBe(1);
  });

  it('keeps the k-mer distance symmetric with ambiguity codes', () => {
    const enc = (s: string): Uint8Array =>
      Uint8Array.from(s.split('').map((c) => (c === 'N' ? 4 : 'ACGT'.indexOf(c))));
    const d = kmerDistances([enc('ACGTNACGTTGCA'), enc('ACGTACNTGCAGG'), enc('NNNNNN')], 4, 3);
    for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) expect(d[a]?.[b]).toBe(d[b]?.[a]);
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
