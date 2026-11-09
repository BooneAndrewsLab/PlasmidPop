import { describe, expect, it } from 'vitest';

import {
  type MsaOptions,
  type TreeNode,
  alignMultiple,
  identityDistances,
  kmerDistances,
  kmerLength,
  treeWeights,
  upgma,
} from '.';

/**
 * The parts of msa.ts that `msa.test.ts` and `msaBand.test.ts` reach only
 * through whole alignments, pinned on their own (item 50, 1.25): the k-mer
 * length and distances, the guide tree and its weights, the identity distances,
 * the options and their defaults, and the exact rows, tree and progress of small
 * sets. Those suites compare an alignment with the full fill or check its
 * shape; a fault in a threshold, a sort order or a weight that moves one
 * column passes them. Sequences are short: the file is also run under Stryker,
 * a hundred times slower.
 */

const enc = (s: string): Uint8Array => Uint8Array.from(s.split('').map((c) => 'ACGT'.indexOf(c)));

const leaf = (i: number): TreeNode => ({
  leaf: i,
  left: null,
  right: null,
  height: 0,
  members: [i],
});

describe('kmerLength', () => {
  it('takes 1 for residues under 30 and 2 from 30', () => {
    expect([
      kmerLength('protein', 0),
      kmerLength('protein', 29),
      kmerLength('protein', 30),
    ]).toEqual([1, 1, 2]);
    expect(kmerLength('protein', 500)).toBe(2);
  });

  it('takes 3 for bases under 40, 5 from 40 to 199 and 6 from 200', () => {
    expect([39, 40, 199, 200].map((n) => kmerLength('nucleotide', n))).toEqual([3, 5, 5, 6]);
    expect([1, 5000].map((n) => kmerLength('nucleotide', n))).toEqual([3, 6]);
  });
});

describe('kmerDistances', () => {
  it('is the whole matrix: zero on the diagonal, the distance on both sides', () => {
    expect(kmerDistances([enc('ACGT'), enc('ACGT'), enc('TTTT')], 4, 2)).toEqual([
      [0, 0, 1],
      [0, 0, 1],
      [1, 1, 0],
    ]);
  });

  it('counts the last window of a sequence', () => {
    // ACG holds AC and CG, CGT holds CG and GT: one of two is shared. Without
    // the last window of each it would be AC against CG, none shared.
    expect(kmerDistances([enc('ACG'), enc('CGT')], 4, 2)[0]?.[1]).toBe(0.5);
  });

  it('reads a window forward from where it starts', () => {
    // Read backwards the windows would be CA and GC, which are not the shared CG.
    expect(kmerDistances([enc('ACGA'), enc('ACGC')], 4, 3)[0]?.[1]).toBe(0.5);
  });
});

describe('upgma', () => {
  it('joins the first pair of a tie', () => {
    const root = upgma([
      [0, 1, 1],
      [1, 0, 1],
      [1, 1, 0],
    ]);
    expect(root.left?.leaf).toBe(2);
    expect(root.right?.members).toEqual([0, 1]);
  });

  it('gives each join half the distance it closes, and the mean over the members below', () => {
    const root = upgma([
      [0, 2, 4, 10],
      [2, 0, 6, 12],
      [4, 6, 0, 14],
      [10, 12, 14, 0],
    ]);
    // 0 and 1 first, at 2; then 2 joins them at (4 + 6) / 2 = 5; then 3 at
    // (11 * 2 + 14) / 3 = 12, where 11 is the mean of 10 and 12.
    expect(root.height).toBe(6);
    expect(root.left?.leaf).toBe(3);
    const middle = root.right;
    expect(middle?.height).toBe(2.5);
    expect(middle?.left?.leaf).toBe(2);
    expect(middle?.right?.height).toBe(1);
    expect(middle?.right?.members).toEqual([0, 1]);
    expect(root.members).toEqual([3, 2, 0, 1]);
  });

  it('weighs two clusters of two by their members in the mean to a fifth', () => {
    const root = upgma([
      [0, 2, 8, 8, 16],
      [2, 0, 8, 8, 24],
      [8, 8, 0, 4, 28],
      [8, 8, 4, 0, 36],
      [16, 24, 28, 36, 0],
    ]);
    // 0 and 1 join at 2, 2 and 3 at 4, the pairs at 8, and 4 joins the four at the mean
    // of 20 (from the first pair) and 32 (from the second) over four members, 26.
    expect(root.height).toBe(13);
    expect(root.left?.leaf).toBe(4);
    expect(root.right?.height).toBe(4);
    expect(root.right?.left?.members).toEqual([0, 1]);
    expect(root.right?.right?.members).toEqual([2, 3]);
  });

  it('weighs a cluster by its size when it joins a lone leaf', () => {
    // After 0 and 1 join, the join is at 12 from 2, the mean of 6 and 18, which is
    // above the 9 between 2 and 3, so 2 and 3 go next.
    const root = upgma([
      [0, 2, 6, 20],
      [2, 0, 18, 20],
      [6, 18, 0, 9],
      [20, 20, 9, 0],
    ]);
    expect(root.left?.members).toEqual([0, 1]);
    expect(root.right?.members).toEqual([2, 3]);
  });
});

describe('treeWeights', () => {
  it('shares each branch among the leaves below it and totals one', () => {
    const root = upgma([
      [0, 2, 4, 10],
      [2, 0, 6, 12],
      [4, 6, 0, 14],
      [10, 12, 14, 0],
    ]);
    const w = treeWeights(root, 4);
    // Branch lengths: leaf 3 has 6; the clade of 0, 1 and 2 has 3.5 for its
    // three; leaf 2 has 2.5 and the pair 1.5 for its two; leaves 0 and 1 have 1.
    expect(w[0]).toBeCloseTo(35 / 186, 12);
    expect(w[1]).toBeCloseTo(35 / 186, 12);
    expect(w[2]).toBeCloseTo(22 / 93, 12);
    expect(w[3]).toBeCloseTo(12 / 31, 12);
  });

  it('weighs a single leaf one', () => {
    expect(treeWeights(upgma([[0]]), 1)).toEqual([1]);
  });

  it('weighs equally a tree whose branches total 1e-12 or less, and by branch above', () => {
    // Leaf 0 on a branch of 5e-13, leaves 1 and 2 under a node of height 0 on
    // one of 5e-13 shared between them: 5e-13 + 2.5e-13 + 2.5e-13 is 1e-12.
    const pair: TreeNode = {
      leaf: null,
      left: leaf(1),
      right: leaf(2),
      height: 0,
      members: [1, 2],
    };
    const root: TreeNode = {
      leaf: null,
      left: leaf(0),
      right: pair,
      height: 5e-13,
      members: [0, 1, 2],
    };
    expect(treeWeights(root, 3)).toEqual([1 / 3, 1 / 3, 1 / 3]);
    const longer = treeWeights({ ...root, height: 6e-13 }, 3);
    expect(longer[0]).toBeCloseTo(0.5, 12);
    expect(longer[1]).toBeCloseTo(0.25, 12);
  });
});

describe('identityDistances', () => {
  it('is 1 less the identity over the columns where both rows have a letter', () => {
    expect(identityDistances(['AC-TG', 'ACGAG', '-CGTA'])).toEqual([
      [0, 1 - 3 / 4, 1 - 2 / 3],
      [1 - 3 / 4, 0, 1 - 2 / 4],
      [1 - 2 / 3, 1 - 2 / 4, 0],
    ]);
  });

  it('is 1 for two rows that never have a letter in the same column', () => {
    expect(identityDistances(['A-', '-C'])).toEqual([
      [0, 1],
      [1, 0],
    ]);
  });

  it('counts every column and none beyond the last', () => {
    expect(identityDistances(['AC', 'AG'])[0]?.[1]).toBe(0.5);
  });
});

describe('alignMultiple options', () => {
  it('aligns two sequences', () => {
    const out = alignMultiple(['ACGTACGTAC', 'ACGTCGTAC']);
    expect(out.rows.map((r) => r.replace(/-/g, ''))).toEqual(['ACGTACGTAC', 'ACGTCGTAC']);
    expect(out.tree).toBe('(1,2)');
  });

  it('reads the alphabet as bases unless it says residues', () => {
    expect(alignMultiple(['ACGT', 'ACGT', 'ACGT']).alphabet).toBe('nucleotide');
    expect(alignMultiple(['MKV', 'MKV', 'MKV'], { alphabet: 'protein' }).alphabet).toBe('protein');
  });

  it('drops what is not a letter or a stop from each sequence', () => {
    const out = alignMultiple(['AC GT-1', 'ACGT', 'A\tC\nGT']);
    expect(out.rows).toEqual(['ACGT', 'ACGT', 'ACGT']);
  });
});

describe('alignMultiple defaults', () => {
  it('opens a gap at -11 and extends it at -1 for residues', () => {
    const pair = ['AVED', 'FGCHCRG'];
    const rows = ['---AVED', 'FGCHCRG'];
    expect(alignMultiple(pair, { alphabet: 'protein' }).rows).toEqual(rows);
    expect(alignMultiple(pair, { alphabet: 'protein', gapOpen: -11, gapExtend: -1 }).rows).toEqual(
      rows,
    );
    // Opened at -10 and extended at -0.5 the gaps are cheap enough to leave nothing paired.
    expect(
      alignMultiple(pair, { alphabet: 'protein', gapOpen: -10, gapExtend: -0.5 }).rows,
    ).toEqual(['------AVED', 'FGCHCRG---']);
    const four = [
      'GILVSEHWNSPHTCLFMLCQT',
      'SGFQTIHKSEHPHCWFNTCLFMLCQT',
      'GILVVHKSEHPTCLFMLCQT',
      'GILVHSFKSEHPHCWKNTCLFMLCQT',
    ];
    const long = alignMultiple(four, { alphabet: 'protein' }).rows;
    expect(long).toEqual([
      '-GILV----SEHWNSPH----TCLFMLCQT',
      'SGFQT-IHKSEH---PHCWFNTCLFMLCQT',
      '-GILV-VHKSEH---P-----TCLFMLCQT',
      '-GILVHSFKSEH---PHCWKNTCLFMLCQT',
    ]);
    expect(alignMultiple(four, { alphabet: 'protein', gapOpen: -11, gapExtend: -1 }).rows).toEqual(
      long,
    );
  });

  it('scores an ambiguity code against a base as EDNAFULL does', () => {
    const rows = alignMultiple(
      ['KGSTNTASKGMMMGMTCWYAGYMC', 'KGSTNTASKGMMMGMWMCCYAGYMC', 'KNTASKGMMMGMKTGKWMGCSNYAGYMC'],
      { refine: false },
    ).rows;
    expect(rows).toEqual([
      'KGSTNTASKGMMMGMT-------CWYAGYMC',
      'KGSTNTASKGMMMGMW------MCCYAGYMC',
      '---KNTASKGMMMGMKTGKWMGCSNYAGYMC',
    ]);
  });
});

describe('alignMultiple progress and passes', () => {
  const triple = ['ACGTTGCA', 'ACGTGCA', 'ACGTTGCC'];
  const progress = (seqs: readonly string[], options: MsaOptions = {}): number[] => {
    const seen: number[] = [];
    alignMultiple(seqs, { ...options, onProgress: (f) => seen.push(Math.round(f * 1e6) / 1e6) });
    return seen;
  };

  it('reports a join as its share of the joins of the pass', () => {
    expect(progress(triple, { refine: false })).toEqual([0.5, 1, 1]);
  });

  it('reports two passes of joins, the steps of the refinement, and one', () => {
    // Two joins to 0.35, two to 0.7, then four branches of one pass of three: 0.7 + 0.3 * step / 12.
    expect(progress(triple)).toEqual([0.175, 0.35, 0.525, 0.7, 0.725, 0.75, 0.775, 0.8, 1]);
  });

  it('does not refine two sequences', () => {
    const joins: [number, number][] = [];
    const seen: number[] = [];
    const out = alignMultiple(['MVNQ', 'MF'], {
      alphabet: 'protein',
      onJoin: (f, full) => joins.push([f, full]),
      onProgress: (f) => seen.push(f),
    });
    expect(out.rows).toEqual(['MVNQ', 'MF--']);
    expect(joins).toEqual([[15, 15]]);
    expect(seen).toEqual([1, 1]);
  });

  it('makes three passes over the tree at most, though a fourth would still gain', () => {
    const seen: number[] = [];
    const out = alignMultiple(['ACTTCCA', 'GCGTA', 'GATT', 'AGACAG', 'GGACG'], {
      onProgress: (f) => seen.push(f),
    });
    expect(out.rows).toEqual([
      '--A--CTTCCA-',
      '-G---CGTA---',
      '-GATT-------',
      'AGA------CAG',
      'GGA--CG-----',
    ]);
    // Four joins twice, eight branches in each of three passes, and the one.
    expect(seen.length).toBe(33);
    expect(Math.max(...seen)).toBe(1);
  });
});

describe('a join along a band or not', () => {
  it('fills the whole matrix when the first band is more than half of it', () => {
    // 225 bases against their first 224: the band of 25,370 cells, twice that is 50,740, a
    // little above the 50,625 of 225 rows of 225 columns, and below the 50,850 of the matrix.
    const next = ((): (() => number) => {
      let a = (225 * 31 + 1) >>> 0;
      return () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      };
    })();
    let a = '';
    for (let i = 0; i < 225; i++) a += 'ACGT'.charAt(Math.floor(next() * 4));
    const joins: [number, number][] = [];
    const out = alignMultiple([a, a.slice(0, 224)], {
      bandAbove: 0,
      onJoin: (f, full) => joins.push([f, full]),
    });
    expect(out.rows[1]).toBe(`${a.slice(0, 224)}-`);
    expect(joins).toEqual([[25370, 50850]]);
  });
});
