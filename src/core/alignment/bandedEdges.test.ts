import { afterEach, vi } from 'vitest';
import {
  alignBanded,
  anchorChain,
  bandAround,
  boundBand,
  chainAnchors,
  dropStrays,
  flankScoring,
  gapBound,
} from './banded';
import { type AlignmentMode, alignInBand, alignPairwise, bandCells } from './pairwise';

/**
 * The parts of banded.ts that `banded.test.ts` reaches only through whole
 * alignments, pinned on their own (item 50, 1.25): the words and anchors, the
 * chain and its strays, the turns folded back, the bounds on gap bases and the
 * bands built from them. That suite compares the banded score with the full
 * fill, which a fault that widens or narrows a band by a few cells can pass;
 * these name the cells and the anchors. Sequences are short: the file is also
 * run under Stryker, a hundred times slower.
 */

/** Mulberry32, so every run sees the same sequences. */
function rng(seed: number): () => number {
  let x = seed;
  return () => {
    x = (x + 0x6d2b79f5) | 0;
    let t = Math.imul(x ^ (x >>> 15), 1 | x);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randomSequence(length: number, next: () => number): string {
  let out = '';
  for (let i = 0; i < length; i++) out += 'ACGT'.charAt(Math.floor(next() * 4));
  return out;
}

const DNA = { gain: 5, gapOpen: 10, gapExtend: 0.5 };
/** Cheap gaps and a low gain, so that the drift past a chain's end is a few cells. */
const SMALL = { gain: 1, gapOpen: 4, gapExtend: 2 };

function rows(band: { lo: Int32Array; hi: Int32Array }): { lo: number[]; hi: number[] } {
  return { lo: [...band.lo], hi: [...band.hi] };
}

function filled(value: number, count: number): number[] {
  return Array.from({ length: count }, () => value);
}

/** The values from `from`, one more with each row, `count` of them. */
function ramp(from: number, count: number): number[] {
  return Array.from({ length: count }, (_, k) => from + k);
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('the words of a sequence, as anchors', () => {
  const next = rng(11);
  const sequence = randomSequence(200, next);
  const diagonal = (from: number, to: number): { i: number; j: number }[] =>
    Array.from({ length: to - from + 1 }, (_, k) => ({ i: from + k, j: from + k }));

  it('takes every 15-mer of a sequence against itself, at its own place', () => {
    expect(anchorChain(sequence, sequence)).toEqual(diagonal(0, 185));
  });

  it('takes the 15-mers by definite bases only: a word with an N in it is none', () => {
    const withN = sequence.slice(0, 80) + 'N' + sequence.slice(81, 140);
    // Words starting at 66 to 80 contain the N.
    expect(anchorChain(withN, withN)).toEqual([...diagonal(0, 65), ...diagonal(81, 125)]);
    // The same where only the read has it.
    expect(anchorChain(sequence.slice(0, 140), withN)).toEqual([
      ...diagonal(0, 65),
      ...diagonal(81, 125),
    ]);
  });

  it('keeps an N that no 15 definite bases lie between from making a word', () => {
    let fence = '';
    for (let k = 0; k < 20; k++) fence += sequence.slice(k * 10, k * 10 + 14) + 'N';
    expect(anchorChain(fence, fence)).toBeNull();
  });

  it('reads lower case and U as the bases they are', () => {
    const rna = sequence.slice(0, 100).replace(/T/g, 'U').toLowerCase();
    expect(anchorChain(sequence.slice(0, 100), rna)).toEqual(diagonal(0, 85));
  });

  it.each([
    ['A', 'C'],
    ['C', 'G'],
    ['G', 'T'],
  ])('tells %s from the next base: all %s in a read are not the same words', (from, to) => {
    const read = sequence.replaceAll(from, to);
    expect(anchorChain(sequence, read)).toBeNull();
  });

  it('indexes the first 15-mer at 0 and the last one at the end', () => {
    const read = sequence.slice(0, 40);
    expect(anchorChain(sequence, read)?.at(0)).toEqual({ i: 0, j: 0 });
    expect(anchorChain(sequence.slice(0, 40), read)?.at(-1)).toEqual({ i: 25, j: 25 });
  });

  it('finds a read in the middle of the reference at the reference position of each word', () => {
    expect(anchorChain(sequence, sequence.slice(70, 130))).toEqual(
      Array.from({ length: 46 }, (_, k) => ({ i: 70 + k, j: k })),
    );
  });

  describe('repeats', () => {
    const unit = sequence.slice(0, 60);
    const fillers = rng(12);
    const copies = (count: number): string => {
      let out = '';
      for (let k = 0; k < count; k++) out += unit + randomSequence(20, fillers);
      return out;
    };

    it.each([1, 2, 3, 4])('a word met %i times is an anchor, at its first place', (count) => {
      const links = anchorChain(copies(count), unit);
      expect(links).toEqual(Array.from({ length: 46 }, (_, k) => ({ i: k, j: k })));
    });

    it.each([5, 6, 9])('a word met %i times is a repeat, and is no anchor', (count) => {
      expect(anchorChain(copies(count), unit)).toBeNull();
    });

    it('takes the later copy where the earlier one has none of the read', () => {
      const first = randomSequence(60, fillers);
      const reference = first + randomSequence(20, fillers) + unit;
      expect(anchorChain(reference, unit)).toEqual(
        Array.from({ length: 46 }, (_, k) => ({ i: 80 + k, j: k })),
      );
    });
  });

  it('indexes a reference once for the reads that follow (#170)', () => {
    const reference = randomSequence(300, rng(13));
    const read = reference.slice(50, 120);
    const calls = vi.spyOn(String.prototype, 'charCodeAt');
    anchorChain(reference, read);
    const first = calls.mock.calls.length;
    anchorChain(reference, read);
    const second = calls.mock.calls.length - first;
    expect(first).toBe(reference.length + read.length);
    expect(second).toBe(read.length);
  });
});

describe('the turns of a repeated circle folded out of a chain (#225)', () => {
  const next = rng(41);
  const X = randomSequence(60, next);
  const Y = randomSequence(60, next);
  const Z = randomSequence(60, next);
  const W = 3000;
  /**
   * `length` random bases to put between `left` and `right`, ending in another base than `left`
   * ends in and starting with another than `right` starts with: no word of `left` and `right`
   * side by side is then found where they are apart.
   */
  const between = (length: number, left: string, right: string): string => {
    const chars = randomSequence(length, next).split('');
    const other = (c: string | undefined): string => 'ACGT'.replace(c ?? '', '')[0] ?? 'A';
    chars[0] = other(right[0]);
    chars[length - 1] = other(left.at(-1));
    return chars.join('');
  };
  /** The anchors of a 60-base part of the read, 46 words, at reference place `at` and read place `from`. */
  const part = (at: number, from: number): { i: number; j: number }[] =>
    Array.from({ length: 46 }, (_, k) => ({ i: at + k, j: from + k }));

  it('moves the anchors after a jump of a whole turn back onto the diagonal before it', () => {
    const reference = X + between(W, X, Y) + Y;
    const read = X + Y;
    expect(anchorChain(reference, read)).toEqual([...part(0, 0), ...part(60 + W, 60)]);
    expect(anchorChain(reference, read, W)).toEqual([...part(0, 0), ...part(60, 60)]);
  });

  it('folds each jump on, so that two turns are two shifts', () => {
    const reference = X + between(W, X, Y) + Y + between(W, Y, Z) + Z;
    const read = X + Y + Z;
    expect(anchorChain(reference, read, W)).toEqual([
      ...part(0, 0),
      ...part(60, 60),
      ...part(120, 120),
    ]);
  });

  it('folds a jump of several turns', () => {
    const reference = X + between(2 * W, X, Y) + Y;
    expect(anchorChain(reference, X + Y, W)).toEqual([...part(0, 0), ...part(60, 60)]);
  });

  it.each([
    ['1024 bases more than a turn', 1024, true],
    ['1025 bases more than a turn', 1025, false],
    ['1024 bases less than a turn', -1024, true],
    ['1025 bases less than a turn', -1025, false],
  ])('folds a jump of %s only within the slack of the band: %s', (_, extra, folds) => {
    // The second part lies W + extra further along the reference than the first, in the
    // read it follows at once, so the diagonal jumps by W + extra.
    const reference = X + between(W + extra, X, Y) + Y;
    const links = anchorChain(reference, X + Y, W);
    expect(links).toEqual([...part(0, 0), ...part(folds ? 60 + extra : 60 + W + extra, 60)]);
  });

  it('leaves a jump back, an insertion in the read, as it is', () => {
    // 40 read bases with no match in the reference: the diagonal falls by 40, which a circle
    // of 50 would be no turn of.
    const reference = X + Y;
    const read = X + between(40, X, Y) + Y;
    expect(anchorChain(reference, read, 50)).toEqual([...part(0, 0), ...part(60, 100)]);
    expect(anchorChain(reference, read)).toEqual([...part(0, 0), ...part(60, 100)]);
  });

  it('is not led by a circle that is none: zero or below', () => {
    // 60 read bases without a match: the jump of -60 would be a turn of a circle of -60.
    const reference = X + Y;
    const read = X + between(60, X, Y) + Y;
    const expected = [...part(0, 0), ...part(60, 120)];
    expect(anchorChain(reference, read, -60)).toEqual(expected);
    expect(anchorChain(reference, read, 0)).toEqual(expected);
    const jumped = X + between(W, X, Y) + Y;
    expect(anchorChain(jumped, X + Y, 0)).toEqual([...part(0, 0), ...part(60 + W, 60)]);
    expect(anchorChain(jumped, X + Y, -W)).toEqual([...part(0, 0), ...part(60 + W, 60)]);
  });

  it('keeps a chain of ten anchors and drops one of nine', () => {
    const reference = randomSequence(200, next);
    expect(anchorChain(reference, reference.slice(20, 44))).toHaveLength(10);
    expect(anchorChain(reference, reference.slice(20, 43))).toBeNull();
  });
});

describe('the longest chain of anchors', () => {
  it('rises in both sequences, one anchor to a read position, one to a reference position', () => {
    const found = [
      { i: 5, j: 3 },
      { i: 2, j: 3 },
      { i: 9, j: 7 },
      { i: 4, j: 5 },
      { i: 6, j: 6 },
      { i: 8, j: 8 },
    ];
    expect(chainAnchors(found)).toEqual([
      { i: 2, j: 3 },
      { i: 4, j: 5 },
      { i: 6, j: 6 },
      { i: 8, j: 8 },
    ]);
  });

  it('leaves the list it is given as it was', () => {
    const found = [
      { i: 9, j: 7 },
      { i: 2, j: 3 },
      { i: 4, j: 5 },
    ];
    const before = structuredClone(found);
    chainAnchors(found);
    expect(found).toEqual(before);
  });

  it('is empty for no anchors and the anchor itself for one', () => {
    expect(chainAnchors([])).toEqual([]);
    expect(chainAnchors([{ i: 4, j: 4 }])).toEqual([{ i: 4, j: 4 }]);
  });

  it('takes one of two anchors at one reference position', () => {
    expect(
      chainAnchors([
        { i: 5, j: 1 },
        { i: 5, j: 2 },
      ]),
    ).toEqual([{ i: 5, j: 2 }]);
  });

  it('takes one of two anchors at one read position, the one at the lower reference position', () => {
    expect(
      chainAnchors([
        { i: 3, j: 4 },
        { i: 8, j: 4 },
      ]),
    ).toEqual([{ i: 3, j: 4 }]);
    expect(
      chainAnchors([
        { i: 8, j: 4 },
        { i: 3, j: 4 },
      ]),
    ).toEqual([{ i: 3, j: 4 }]);
  });

  it('takes one of anchors that fall in the reference as the read rises', () => {
    expect(
      chainAnchors([
        { i: 9, j: 1 },
        { i: 8, j: 2 },
        { i: 7, j: 3 },
      ]),
    ).toEqual([{ i: 7, j: 3 }]);
  });

  it('starts at the first anchor when the longest chain does', () => {
    expect(
      chainAnchors([
        { i: 1, j: 1 },
        { i: 2, j: 2 },
        { i: 3, j: 3 },
        { i: 0, j: 4 },
      ]),
    ).toEqual([
      { i: 1, j: 1 },
      { i: 2, j: 2 },
      { i: 3, j: 3 },
    ]);
  });

  it('keeps the longest of two chains that cross', () => {
    const found = [
      { i: 10, j: 1 },
      { i: 11, j: 2 },
      { i: 1, j: 3 },
      { i: 2, j: 4 },
      { i: 3, j: 5 },
      { i: 12, j: 6 },
    ];
    expect(chainAnchors(found)).toEqual([
      { i: 1, j: 3 },
      { i: 2, j: 4 },
      { i: 3, j: 5 },
      { i: 12, j: 6 },
    ]);
  });
});

describe('the strays dropped from a chain', () => {
  /** An anchor on diagonal `d` = i - j, at read position `j`. */
  const at = (d: number, j: number): { i: number; j: number } => ({ i: j + d, j });

  it('leaves a chain of two as it is, however far apart', () => {
    const two = [at(0, 0), at(500, 40)];
    expect(dropStrays(two)).toBe(two);
  });

  it('drops a first anchor that is off the diagonal of the two after it', () => {
    expect(dropStrays([at(200, 0), at(0, 20), at(0, 40)])).toEqual([at(0, 20), at(0, 40)]);
  });

  it('drops a last anchor that is off the diagonal of the two before it', () => {
    expect(dropStrays([at(0, 0), at(0, 20), at(200, 40)])).toEqual([at(0, 0), at(0, 20)]);
  });

  it('drops one in the middle that is off both neighbours', () => {
    expect(dropStrays([at(0, 0), at(0, 20), at(200, 40), at(0, 60), at(0, 80)])).toEqual([
      at(0, 0),
      at(0, 20),
      at(0, 60),
      at(0, 80),
    ]);
  });

  it('keeps one that agrees with the anchor after it only, and one that agrees with the one before only', () => {
    // 1 agrees with 2 but not 0; 2 agrees with 1 but not 3; 0 and 3 are off.
    const chain = [at(300, 0), at(0, 20), at(0, 40), at(300, 60)];
    expect(dropStrays(chain)).toEqual([at(0, 20), at(0, 40)]);
    // The three in the middle: 1 agrees with 0 only (before), 2 with 3 only (after).
    const bent = [at(0, 0), at(10, 20), at(60, 40), at(70, 60)];
    expect(dropStrays(bent)).toEqual(bent);
  });

  it('agrees up to 30 bases of drift over a short stretch, and not 31', () => {
    expect(dropStrays([at(0, 0), at(30, 10), at(30, 20)])).toEqual([
      at(0, 0),
      at(30, 10),
      at(30, 20),
    ]);
    expect(dropStrays([at(0, 0), at(31, 10), at(62, 20)])).toEqual([]);
  });

  it('agrees up to 15% of the read between two anchors over a long one, and not more', () => {
    // 400 read bases apart: 60 bases of drift are the most.
    expect(dropStrays([at(0, 0), at(60, 400), at(60, 410)])).toEqual([
      at(0, 0),
      at(60, 400),
      at(60, 410),
    ]);
    expect(dropStrays([at(0, 0), at(61, 400), at(200, 500)])).toEqual([]);
  });

  it('allows the drift of the longer stretch, not the shorter one', () => {
    // 1000 bases apart: 150 of drift agree, where 30 would not.
    expect(dropStrays([at(0, 0), at(100, 1000), at(100, 1010)])).toEqual([
      at(0, 0),
      at(100, 1000),
      at(100, 1010),
    ]);
  });

  it('allows 15% of the read between the two anchors, not of the read to their right', () => {
    // 10 bases apart in a read 500 bases in: the drift of 100 is not agreed.
    expect(dropStrays([at(0, 500), at(100, 510), at(100, 520)])).toEqual([
      at(100, 510),
      at(100, 520),
    ]);
  });

  it('measures the drift between diagonals, whichever side the other lies on', () => {
    expect(dropStrays([at(0, 0), at(-20, 10), at(-20, 20)])).toEqual([
      at(0, 0),
      at(-20, 10),
      at(-20, 20),
    ]);
    expect(dropStrays([at(0, 0), at(-40, 10), at(-40, 20)])).toEqual([at(-40, 10), at(-40, 20)]);
  });
});

describe('the scoring a local flank is bounded by', () => {
  it('is the EMBOSS DNA defaults without options', () => {
    expect(flankScoring({})).toEqual({ gain: 5, gapOpen: 10, gapExtend: 0.5 });
  });

  it('is the BLOSUM62 ones for a protein, where 11 is the most a pair earns', () => {
    expect(flankScoring({ alphabet: 'protein' })).toEqual({ gain: 11, gapOpen: 11, gapExtend: 1 });
  });

  it('takes the match score when it is above the default, and not when below', () => {
    expect(flankScoring({ match: 7 }).gain).toBe(7);
    expect(flankScoring({ match: 3 }).gain).toBe(5);
    expect(flankScoring({ match: 20, alphabet: 'protein' }).gain).toBe(20);
    expect(flankScoring({ match: 8, alphabet: 'protein' }).gain).toBe(11);
  });

  it('gives the gap costs as the positive magnitudes of the penalties', () => {
    expect(flankScoring({ gapOpen: -3, gapExtend: -2 })).toEqual({
      gain: 5,
      gapOpen: 3,
      gapExtend: 2,
    });
    expect(flankScoring({ gapOpen: 3, gapExtend: 2 })).toEqual({
      gain: 5,
      gapOpen: 3,
      gapExtend: 2,
    });
    expect(flankScoring({ gapExtend: 0 }).gapExtend).toBe(0);
  });
});

describe('the most gap bases a path scoring at least so much can hold', () => {
  it.each([
    // Global, EMBOSS defaults: floor((5(n+m)/2 - 10 + 0.5 - score) / 3), at least |n - m|.
    [100, 90, 'global', 400, DNA, 21],
    [100, 90, 'global', 470, DNA, 10],
    [100, 90, 'global', 0, DNA, 155],
    // An extension dearer than the open costs the open (extend' = min).
    [100, 90, 'global', 300, { gain: 4, gapOpen: 3, gapExtend: 8 }, 16],
    [60, 80, 'global', 100, { gain: 4, gapOpen: 3, gapExtend: 8 }, 36],
    // Local: floor((gain * min(n, m) - open - score) / extend) + 1, at least 0.
    [100, 90, 'local', 200, DNA, 481],
    [100, 90, 'local', 200, { gain: 4, gapOpen: 3, gapExtend: 8 }, 53],
    [30, 100, 'local', 100, { gain: 5, gapOpen: 10, gapExtend: 2 }, 21],
    [100, 90, 'local', 600, { gain: 5, gapOpen: 10, gapExtend: 2 }, 0],
    // Nothing bounds a local path when gaps are free to extend, whatever it scored.
    [100, 90, 'local', 600, { gain: 5, gapOpen: 10, gapExtend: 0 }, Infinity],
    [100, 90, 'local', 0, { gain: 5, gapOpen: 10, gapExtend: 0 }, Infinity],
  ] as const)('%i x %i %s, score %i, %j: %f', (n, m, mode, score, scoring, expected) => {
    expect(gapBound(n, m, mode, score, scoring)).toBe(expected);
  });
});

describe('the region a better path can lie in', () => {
  const scoring = { gain: 2, gapOpen: 4, gapExtend: 1 };
  const links = [
    { i: 10, j: 14 },
    { i: 20, j: 22 },
    { i: 30, j: 35 },
  ];

  it('is, for a global alignment, the diagonals the gap bases allow between the corners', () => {
    // 6 gap bases from a score of 95: diagonals -10 (n - m) to 0, and all the rows between.
    const band = boundBand(links, 50, 60, 'global', 95, scoring);
    expect(gapBound(50, 60, 'global', 95, scoring)).toBe(10);
    expect(rows(band)).toEqual({ lo: ramp(0, 51), hi: ramp(10, 51) });
  });

  it('rounds the diagonals out: the lower down and the upper up', () => {
    const band = boundBand(links, 50, 60, 'global', 60, scoring);
    expect(gapBound(50, 60, 'global', 60, scoring)).toBe(23);
    // low = floor((-10 - 23) / 2) = -17, high = ceil((-10 + 23) / 2) = 7.
    expect(rows(band)).toEqual({
      lo: [...filled(0, 7), ...ramp(0, 44)],
      hi: [...ramp(7, 51).map((h) => Math.min(60, h + 10))],
    });
  });

  it('is, for a local alignment, the span of the chain widened by the gap bases', () => {
    // Gap bases at a score of 90: floor((2 * 50 - 4 - 90) / 1) + 1 = 7. The chain's
    // diagonals are -4, -2 and -5, so the region runs from -12 to 5.
    const band = boundBand(links, 50, 60, 'local', 90, scoring);
    expect(gapBound(50, 60, 'local', 90, scoring)).toBe(7);
    expect(rows(band)).toEqual({
      lo: [...filled(0, 5), ...ramp(0, 46)],
      hi: ramp(12, 49).concat([60, 60]),
    });
  });

  it('keeps to the matrix: no diagonal past a corner', () => {
    const band = boundBand([{ i: 2, j: 1 }], 12, 4, 'global', -100, DNA);
    expect(rows(band)).toEqual({ lo: filled(0, 13), hi: filled(4, 13) });
    const local = boundBand(
      [
        { i: 2, j: 1 },
        { i: 5, j: 3 },
      ],
      12,
      4,
      'local',
      0,
      DNA,
    );
    expect(rows(local)).toEqual({ lo: filled(0, 13), hi: filled(4, 13) });
  });

  it('keeps a row whose diagonals leave the matrix at the matrix edge', () => {
    // A local chain far down the matrix: the rows above hold their first columns.
    const band = boundBand(
      [
        { i: 20, j: 5 },
        { i: 28, j: 11 },
      ],
      50,
      30,
      'local',
      40,
      scoring,
    );
    expect(rows(band)).toEqual({
      lo: [...filled(0, 35), ...ramp(1, 16)],
      hi: [...ramp(2, 28), ...filled(30, 23)],
    });
  });
});

describe('the band around a chain', () => {
  it('is, for a global alignment, the rectangles between the corners and the anchors, margin either side', () => {
    const links = [
      { i: 10, j: 12 },
      { i: 30, j: 34 },
      { i: 50, j: 49 },
    ];
    const band = bandAround(links, 70, 75, 'global', 3);
    expect(rows(band)).toEqual({
      lo: [...filled(0, 11), 8, ...filled(9, 19), ...filled(31, 20), ...filled(46, 20)],
      hi: [...filled(15, 10), ...filled(37, 20), ...filled(52, 20), ...filled(75, 21)],
    });
  });

  it('holds both corners of a global alignment, with or without anchors', () => {
    const band = bandAround([], 8, 6, 'global', 1);
    expect(rows(band)).toEqual({ lo: filled(0, 9), hi: filled(6, 9) });
    const tiny = bandAround([{ i: 3, j: 4 }], 12, 10, 'global', 1);
    expect(rows(tiny)).toEqual({
      lo: [...filled(0, 4), ...filled(3, 9)],
      hi: [...filled(5, 3), ...filled(10, 10)],
    });
  });

  it('takes in the rows of each word, all 16, where the next anchor is nearer in the read than in the reference', () => {
    // From (10, 10) the word runs on to (25, 25), past the rectangle to (20, 14): up to column 17
    // at row 15 and 21 at row 19.
    const links = [
      { i: 10, j: 10 },
      { i: 20, j: 14 },
      { i: 40, j: 35 },
    ];
    const band = bandAround(links, 60, 60, 'global', 2);
    expect(rows(band)).toEqual({
      lo: [...filled(0, 11), ...filled(8, 10), ...filled(12, 20), ...filled(33, 20)],
      hi: [
        ...filled(12, 10),
        ...filled(16, 5),
        ...ramp(17, 5),
        ...filled(37, 20),
        ...filled(60, 21),
      ],
    });
  });

  it('lets the last row reach as far right as the row above it', () => {
    // The word of (24, 24) ends at row 39, at column 40; the last row, 40, is the other
    // anchor's, at 31: the band is never narrower than the row above.
    const band = bandAround(
      [
        { i: 24, j: 24 },
        { i: 40, j: 30 },
      ],
      40,
      60,
      'local',
      1,
      SMALL,
    );
    expect(rows(band)).toEqual({
      lo: [...filled(0, 13), ...ramp(1, 11), ...filled(23, 17)],
      hi: [...ramp(12, 13), ...filled(25, 11), ...filled(31, 7), ...ramp(32, 8), ...filled(40, 2)],
    });
  });

  it('does not run a local band corner to corner: the first row and the last may start and end inside', () => {
    const band = bandAround(
      [
        { i: 20, j: 40 },
        { i: 30, j: 50 },
      ],
      80,
      120,
      'local',
      4,
      SMALL,
    );
    expect(rows(band)).toEqual({
      lo: [...ramp(7, 20), ...filled(36, 11), ...filled(46, 24), ...ramp(47, 26)],
      hi: [
        ...ramp(33, 11),
        ...filled(44, 9),
        ...filled(54, 11),
        ...ramp(79, 41),
        ...filled(120, 9),
      ],
    });
  });

  it('takes the drift as what the pairs earn: the gain of a pair, not its share', () => {
    const band = bandAround(
      [
        { i: 20, j: 25 },
        { i: 30, j: 36 },
      ],
      70,
      80,
      'local',
      2,
      { gain: 3, gapOpen: 2, gapExtend: 1 },
    );
    expect(rows(band)).toEqual({
      lo: [...filled(0, 20), ...filled(23, 11), ...filled(34, 40)],
      hi: [...filled(27, 20), ...filled(38, 11), ...filled(80, 40)],
    });
  });

  it.each([
    // The flank cannot pay for the open of a gap, so a path may drift anywhere, and the same
    // where the sum it earns is exactly what the open costs.
    ['cannot pay the open', 30, 100],
    ['can just pay the open', 10, 10],
  ])(
    'lets a flank that %s drift without bound when gap extension is free',
    (_, anchor, gapOpen) => {
      const links = [
        { i: anchor, j: anchor },
        { i: anchor + 5, j: anchor + 5 },
      ];
      const band = bandAround(links, 60, 60, 'local', 2, { gain: 1, gapOpen, gapExtend: 0 });
      // Before the first anchor every row starts at column 0 and runs up to the anchor's word.
      for (let i = 0; i < anchor; i++) {
        expect([band.lo[i], band.hi[i]]).toEqual([0, anchor + 2]);
      }
      // After the last one, from its diagonal's margin to the end.
      for (let i = anchor + 6; i <= 60; i++) {
        expect([band.lo[i], band.hi[i]]).toEqual([anchor + 3, 60]);
      }
    },
  );

  it('needs an anchor for a local alignment: it has no corners to go by', () => {
    expect(() => bandAround([], 10, 10, 'local', 5)).toThrow('No anchors to band around');
  });

  it('is, for a local one, the chain with a parallelogram of drift past either end', () => {
    // Each pair earns at most 1 here and a gap costs 4 and 2 more: 17 columns of drift
    // past the 35 rows before the first anchor, 11 past the last.
    const links = [
      { i: 40, j: 30 },
      { i: 60, j: 50 },
    ];
    const band = bandAround(links, 100, 100, 'local', 5, SMALL);
    expect(rows(band)).toEqual({
      lo: [...filled(0, 33), ...ramp(1, 7), ...filled(25, 21), ...filled(45, 19), ...ramp(46, 21)],
      hi: [
        ...ramp(12, 23),
        ...filled(35, 17),
        ...filled(55, 21),
        ...ramp(75, 25),
        ...filled(100, 15),
      ],
    });
  });

  it('wanders no more than the scoring lets it: the same chain, free gap extension, drifts everywhere', () => {
    const links = [
      { i: 20, j: 40 },
      { i: 30, j: 50 },
    ];
    const free = bandAround(links, 60, 90, 'local', 4, { gain: 5, gapOpen: 10, gapExtend: 0 });
    expect(rows(free)).toEqual({
      lo: [...filled(0, 20), ...filled(36, 11), ...filled(46, 30)],
      hi: [...filled(44, 20), ...filled(54, 11), ...filled(90, 30)],
    });
  });

  it('is cut by the matrix: a flank whose window lies outside it adds nothing', () => {
    // The first anchor is far down, near the left edge: the drift window of the early rows
    // lies to the left of the matrix (`to` below 0).
    const lead = bandAround(
      [
        { i: 30, j: 2 },
        { i: 40, j: 12 },
      ],
      60,
      30,
      'local',
      1,
      SMALL,
    );
    expect(rows(lead)).toEqual({
      lo: [...filled(0, 30), ...filled(1, 11), ...filled(11, 9), ...ramp(12, 11)],
      hi: [...filled(0, 27), ...ramp(1, 3), ...filled(13, 11), ...ramp(23, 7), ...filled(30, 13)],
    });
    // The last anchor is far to the right, so the drift window of the last rows lies right of
    // the matrix (`from` above m).
    const tail = bandAround(
      [
        { i: 10, j: 20 },
        { i: 12, j: 24 },
      ],
      50,
      30,
      'local',
      1,
      SMALL,
    );
    expect(rows(tail)).toEqual({
      lo: [...ramp(5, 10), ...filled(19, 3), 22, 23, 23, ...ramp(24, 6), ...filled(30, 29)],
      hi: [...ramp(15, 6), ...filled(21, 4), ...filled(25, 3), 29, ...filled(30, 37)],
    });
  });

  it('keeps a lead row whose window ends at column 0, and drops those that end before it', () => {
    // Rows 0 to 21 end where the window does, at column 0; with no margin the first one past
    // them reaches column 1.
    const band = bandAround(
      [
        { i: 23, j: 2 },
        { i: 47, j: 10 },
      ],
      59,
      27,
      'local',
      0,
      SMALL,
    );
    expect(rows(band)).toEqual({
      lo: [...filled(0, 22), 1, ...filled(2, 25), ...filled(10, 5), ...ramp(11, 7)],
      hi: [
        ...filled(0, 22),
        1,
        ...filled(10, 9),
        ...ramp(11, 6),
        ...filled(17, 12),
        ...ramp(18, 10),
      ],
    });
  });

  it('keeps a row no window reaches at a cell of the next row, joined to the rows around it', () => {
    const band = bandAround([{ i: 5, j: 5 }], 30, 40, 'local', 1, {
      gain: 1,
      gapOpen: 100,
      gapExtend: 100,
    });
    expect(rows(band)).toEqual({
      lo: [0, 0, 0, 1, 2, 4, 4, ...ramp(5, 24)],
      hi: [2, 3, 4, 5, 6, 6, ...ramp(8, 25)],
    });
  });

  it('never leaves consecutive rows apart: a row starts at most one past the end of the one above', () => {
    const next = rng(21);
    for (let trial = 0; trial < 12; trial++) {
      const n = 60 + Math.floor(next() * 40);
      const m = 60 + Math.floor(next() * 40);
      const a = { i: Math.floor(next() * 20), j: Math.floor(next() * 20) };
      const b = { i: a.i + 5 + Math.floor(next() * 25), j: a.j + 5 + Math.floor(next() * 25) };
      for (const mode of ['global', 'local'] as const) {
        const band = bandAround([a, b], n, m, mode, 2, SMALL);
        for (let i = 0; i <= n; i++) {
          expect(band.lo[i]).toBeLessThanOrEqual(band.hi[i] ?? -1);
          expect(band.hi[i]).toBeLessThanOrEqual(m);
          expect(band.lo[i]).toBeGreaterThanOrEqual(0);
          if (i > 0) {
            expect(band.lo[i]).toBeGreaterThanOrEqual(band.lo[i - 1] ?? 0);
            expect(band.hi[i]).toBeGreaterThanOrEqual(band.hi[i - 1] ?? 0);
            expect(band.lo[i]).toBeLessThanOrEqual((band.hi[i - 1] ?? 0) + 1);
          }
        }
      }
    }
  });
});

/** An integer stream (Mulberry32): `next(k)` is 0 to k-1, the same on every run. */
function ints(seed: number): (k: number) => number {
  let x = seed | 0;
  return (k) => {
    x = (x + 0x6d2b79f5) | 0;
    let t = Math.imul(x ^ (x >>> 15), 1 | x);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) % k;
  };
}

function bases(length: number, next: (k: number) => number): string {
  let out = '';
  for (let i = 0; i < length; i++) out += 'ACGT'.charAt(next(4));
  return out;
}

/** About `perMille` substitutions, insertions and deletions each per thousand bases. */
function errors(seq: string, perMille: number, next: (k: number) => number): string {
  let out = '';
  for (const c of seq) {
    const r = next(1000);
    if (r < perMille) continue;
    if (r < 2 * perMille) out += bases(1 + next(3), next);
    out += r >= 2 * perMille && r < 3 * perMille ? 'ACGT'.replace(c, '').charAt(next(3)) : c;
  }
  return out;
}

/** The pairs of `banded.test.ts`' #167 reduced to a few hundred bases; see there for the kinds. */
function astray(
  kind: 'tandem in read' | 'insertion near start',
  seed: number,
  refLength: number,
): { reference: string; read: string } {
  const next = ints(seed);
  const unit = bases(20 + next(280), next);
  const at = 400 + next(400);
  const left = bases(at, next);
  const right = bases(refLength - at, next);
  const copy = errors(unit, 7, next);
  const before = left.slice(at - 200 - next(200));
  const after = right.slice(0, 200 + next(400));
  const reference = left + right;
  if (kind === 'tandem in read') {
    return {
      reference: left + unit + right,
      read: errors(before + unit + copy + after, 3 + next(25), next),
    };
  }
  const from = next(refLength - 1000);
  const body = reference.slice(from, from + 500 + next(500));
  const near = 5 + next(36);
  const read = body.slice(0, near) + bases(30 + next(300), next) + body.slice(near);
  return { reference, read: errors(read, 3 + next(25), next) };
}

/** What `alignBanded` works from, by the exported pieces. */
function pieces(reference: string, read: string, mode: AlignmentMode, wrap?: number) {
  const links = anchorChain(reference, read, wrap);
  if (links === null) throw new Error('no chain');
  const n = reference.length;
  const m = read.length;
  const scoring = flankScoring({ mode });
  const first = bandAround(links, n, m, mode, 64, scoring);
  const firstResult = alignInBand(reference, read, first, { mode });
  return {
    links,
    n,
    m,
    scoring,
    first,
    firstResult,
    region: boundBand(links, n, m, mode, firstResult.alignment.score, scoring),
  };
}

describe('alignBanded, the cells it fills', () => {
  it('is null for sequences that share too little', () => {
    expect(alignBanded('ACGT'.repeat(20), 'TTGCA'.repeat(16))).toBeNull();
  });

  it('fills the band and the region of the band answer, global, when nothing better is there', () => {
    const next = rng(31);
    const reference = randomSequence(400, next);
    const read = reference.slice(0, 400).replace(/ACGTA/g, 'ACTTA');
    const { first, region, firstResult } = pieces(reference, read, 'global');
    const banded = alignBanded(reference, read);
    expect(banded?.alignment).toEqual(firstResult.alignment);
    expect(banded?.exact).toBe(true);
    expect(banded?.filled).toBe(bandCells(first) + bandCells(region));
  });

  describe('a global band that missed the best path (a tandem repeat in the read)', () => {
    const { reference, read } = astray('tandem in read', 558, 400);
    const { first, region, firstResult } = pieces(reference, read, 'global');

    it('fills the region, and then the path in it once more', () => {
      const full = alignPairwise(reference, read);
      expect(full.score).toBeGreaterThan(firstResult.alignment.score);
      const banded = alignBanded(reference, read);
      expect(banded?.alignment.score).toBe(full.score);
      expect(banded?.exact).toBe(true);
      expect(banded?.filled).toBe(bandCells(first) + 2 * bandCells(region));
    });

    it('checks the region when it holds exactly the cells allowed, and not one cell fewer', () => {
      const cells = bandCells(region);
      const checked = alignBanded(reference, read, { maxCells: cells });
      expect(checked?.exact).toBe(true);
      expect(checked?.alignment.score).toBeGreaterThan(firstResult.alignment.score);
      // Unchecked, the band's own answer stands: it did not run along an edge of the band,
      // so it is not widened and nothing but the band was filled.
      const unchecked = alignBanded(reference, read, { maxCells: cells - 1 });
      expect(unchecked?.exact).toBe(false);
      expect(unchecked?.alignment).toEqual(firstResult.alignment);
      expect(unchecked?.touchedEdge).toBe(false);
      expect(unchecked?.filled).toBe(bandCells(first));
    });
  });

  describe('a band whose path ran along its edge, and a region too large to check', () => {
    const { reference, read } = astray('insertion near start', 1767, 300);
    const { links, n, m, scoring, first, firstResult, region } = pieces(reference, read, 'global');
    const wider = bandAround(links, n, m, 'global', 256, scoring);

    it('is aligned again in a band with a margin of 256, once it keeps off the edge', () => {
      expect(firstResult.touchedEdge).toBe(true);
      // Room for the 256 band and not for the region that would check it.
      const maxCells = bandCells(wider);
      expect(bandCells(region)).toBeGreaterThan(maxCells);
      const banded = alignBanded(reference, read, { maxCells });
      const again = alignInBand(reference, read, wider, {});
      expect(again.touchedEdge).toBe(false);
      expect(banded?.exact).toBe(false);
      expect(banded?.alignment).toEqual(again.alignment);
      expect(banded?.touchedEdge).toBe(false);
      expect(banded?.filled).toBe(bandCells(first) + bandCells(wider));
    });
  });

  describe('local, against a circle repeated, with a read across its origin', () => {
    const L = 300;
    const plasmid = randomSequence(L, rng(51));
    const unrolled = plasmid + plasmid.slice(0, L - 1);
    // 60 bases before the origin and 60 after: on diagonal 240 of a 599 x 120 matrix.
    const read = plasmid.slice(L - 60) + plasmid.slice(0, 60);
    const options = { mode: 'local' } as const;
    const firstCells = (wrap?: number, text = read): number => {
      const links = anchorChain(unrolled, text, wrap);
      if (links === null) throw new Error('no chain');
      return bandCells(
        bandAround(links, unrolled.length, text.length, 'local', 64, flankScoring(options)),
      );
    };
    /** The cells beyond the band: the region and the regions of the turns, trimmed to their rows. */
    const extra = (wrap?: number, text = read): number | undefined =>
      (alignBanded(unrolled, text, wrap === undefined ? options : { ...options, wrap })?.filled ??
        NaN) - firstCells(wrap, text);

    it('fills the diagonal of the chain, its 121 cells, to check it', () => {
      expect(extra()).toBe(121);
    });

    it('fills a turn on and a turn back too: 61 cells of diagonal -60 and 60 of diagonal 540', () => {
      expect(extra(L)).toBe(121 + 61 + 60);
    });

    it.each([
      // Diagonal -119 has 2 cells, 599 has 1; both turns are checked.
      [359, 121 + 2 + 1],
      // Diagonal -120 has 1 cell, the turn on lies past the matrix: 240 + 360 > 599.
      [360, 121 + 1],
      // Past the corner of both.
      [361, 121],
    ])(
      'keeps a turn that reaches the matrix by one diagonal and drops the next, wrap %i',
      (wrap, cells) => {
        expect(extra(wrap)).toBe(cells);
      },
    );

    it.each([0, -L, -1])('has no turn to check for a circle of %i', (wrap) => {
      expect(extra(wrap)).toBe(121);
    });

    it('takes the turns from the diagonal of every anchor, a read whose first base differs among them', () => {
      const flipped = (plasmid.charAt(L - 60) === 'A' ? 'C' : 'A') + read.slice(1);
      // The first word starts one base in: (241, 1), on diagonal 240 still.
      expect(anchorChain(unrolled, flipped)?.[0]).toEqual({ i: 241, j: 1 });
      expect(extra(359, flipped)).toBe(121 + 2 + 1);
      expect(extra(360, flipped)).toBe(121 + 1);
      expect(extra(361, flipped)).toBe(121);
    });

    it('does not check turns of a circle as long as the reference', () => {
      const near = plasmid.slice(0, 120);
      expect(extra(unrolled.length, near)).toBe(121);
      // One base shorter, and the turn on has the diagonal 598 of two cells.
      expect(extra(unrolled.length - 1, near)).toBe(121 + 2);
    });

    it('does not check turns of a global alignment, which has no use for them', () => {
      const alone = alignBanded(unrolled, read, { mode: 'global' });
      const wrapped = alignBanded(unrolled, read, { mode: 'global', wrap: L });
      expect(wrapped?.filled).toBe(alone?.filled);
    });
  });

  it('fills the region of a global alignment whole, though the reference is much the longer', () => {
    // 700 bases against the first 250 of them: every row of the region is filled, none of
    // them left out as the rows of a local region are.
    const reference = randomSequence(700, rng(5));
    const read = reference.slice(0, 250);
    const { first, region, firstResult } = pieces(reference, read, 'global');
    const banded = alignBanded(reference, read, { mode: 'global' });
    expect(banded?.alignment.score).toBe(firstResult.alignment.score);
    expect(banded?.filled).toBe(bandCells(first) + bandCells(region));
  });

  it('reports the way it goes over each region in turn', () => {
    // Gaps free to extend leave a local path nowhere to be bounded: each region is the whole
    // matrix, 2.1 M cells, and a fill reports once in 2 M. Three regions with the turns.
    const L = 1500;
    const next = ints(7);
    const plasmid = bases(L, next);
    const unrolled = plasmid + plasmid.slice(0, L - 1);
    const read = plasmid.slice(L - 200) + plasmid.slice(0, 500);
    const reports: number[] = [];
    const banded = alignBanded(
      unrolled,
      read,
      { mode: 'local', wrap: L, gapExtend: 0 },
      (fraction) => reports.push(fraction),
    );
    expect(banded?.exact).toBe(true);
    expect(reports).toHaveLength(3);
    reports.forEach((fraction, k) => {
      expect(fraction).toBeGreaterThan(k / 3);
      expect(fraction).toBeLessThan((k + 1) / 3);
    });
  });
});

describe('a band is connected whatever the anchors', () => {
  // `bandAround` no longer repairs rows that do not meet: the rectangles between anchors and
  // the monotone passes leave them meeting. Chains that fold a turn back (#225) can fall
  // behind in the reference by up to the fold's slack, so the chains here are not all rising.
  it(
    'has every row meeting the one before, in both modes, for rising and for folded chains',
    () => {
      const next = rng(2026);
      const upTo = (k: number): number => Math.floor(next() * k);
      const scorings = [
        { gain: 5, gapOpen: 10, gapExtend: 0.5 },
        { gain: 11, gapOpen: 11, gapExtend: 1 },
      ];
      for (let t = 0; t < 1500; t++) {
        const n = 20 + upTo(150);
        const m = 20 + upTo(150);
        let i = upTo(40);
        let j = upTo(40);
        const links: { i: number; j: number }[] = [];
        const count = upTo(5) + 1;
        const folded = t % 2 === 1;
        for (let k = 0; k < count; k++) {
          links.push({ i: Math.min(n, Math.max(0, i)), j: Math.min(m, j) });
          j += 1 + upTo(60);
          i += upTo(80) - (folded && upTo(3) === 0 ? upTo(1100) : 0);
        }
        const mode: AlignmentMode = t % 4 < 2 ? 'global' : 'local';
        const { lo, hi } = bandAround(links, n, m, mode, upTo(20), scorings[upTo(2)]);
        const at = (edge: Int32Array, row: number): number => edge[row] ?? Number.NaN;
        let broken = -1;
        for (let row = 0; row <= n && broken < 0; row++) {
          const meets =
            at(hi, row) >= at(lo, row) &&
            (row === 0 || (at(lo, row) >= at(lo, row - 1) && at(lo, row) <= at(hi, row - 1) + 1));
          if (!meets) broken = row;
        }
        expect(broken).toBe(-1);
      }
    },
    process.env['PLASMIDPOP_MUTATION'] === '1' ? 600_000 : 30_000,
  );
});
