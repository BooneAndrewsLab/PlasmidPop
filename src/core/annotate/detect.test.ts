import { describe, expect, it } from 'vitest';

import { reverseComplement } from '../sequence';
import { randomDna, randomInt, seededRandom } from '@/test/random';
import { expectWithin, itTimed } from '@/test/timing';
import {
  type FeatureHit,
  DEFAULT_MIN_IDENTITY,
  GAPPED_OVERHANG,
  MAX_INDEL,
  MIN_IDENTITY_CHOICES,
  SEED,
  detectFeatures,
  indelBudget,
  isMinIdentityChoice,
  mismatchBudget,
  overlapLength,
  seedsAtLeast,
} from './detect';
import { type FeatureLibrary, type LibraryPart, loadFeatureLibrary } from './library';
import { detectProteinFeatures } from './protein';

function part(name: string, sequence: string, type = 'misc_feature'): LibraryPart {
  return {
    name,
    type,
    category: 'other',
    sequence,
    accession: 'X00000.1',
    location: `1..${sequence.length}`,
    source: 'core',
  };
}

function library(...parts: LibraryPart[]): FeatureLibrary {
  return { parts };
}

/** `seq` with the base at each of `positions` changed to another definite base. */
function mutate(seq: string, positions: Iterable<number>): string {
  const out = seq.split('');
  for (const p of positions) {
    const b = out[p] ?? 'A';
    out[p] = b === 'A' ? 'C' : b === 'C' ? 'G' : b === 'G' ? 'T' : 'A';
  }
  return out.join('');
}

const rand = seededRandom(59);
const PART = randomDna(rand, 300);
const LIB = library(part('P', PART));

function only(hits: FeatureHit[]): FeatureHit {
  expect(hits).toHaveLength(1);
  const [hit] = hits;
  if (hit === undefined) throw new Error('no hit');
  return hit;
}

describe('detectFeatures', () => {
  it('finds a part on the forward strand, exactly', () => {
    const left = randomDna(rand, 500);
    const seq = left + PART + randomDna(rand, 400);
    const hit = only(detectFeatures(seq, 'linear', LIB));
    expect(hit).toEqual({
      part: 0,
      range: { start: 500, end: 800 },
      strand: 'forward',
      mismatches: 0,
      ambiguous: 0,
      identity: 1,
    });
  });

  it('finds a part on the reverse strand, in forward coordinates', () => {
    const seq = randomDna(rand, 123) + reverseComplement(PART) + randomDna(rand, 77);
    const hit = only(detectFeatures(seq, 'circular', LIB));
    expect(hit.strand).toBe('reverse');
    expect(hit.range).toEqual({ start: 123, end: 423 });
  });

  it('matches whatever the case of the sequence', () => {
    const seq = randomDna(rand, 50) + PART.toLowerCase() + randomDna(rand, 50);
    expect(only(detectFeatures(seq, 'linear', LIB)).range).toEqual({ start: 50, end: 350 });
  });

  it('finds nothing in a sequence without the part, or in an empty one', () => {
    expect(detectFeatures(randomDna(rand, 5000), 'circular', LIB)).toEqual([]);
    expect(detectFeatures('', 'circular', LIB)).toEqual([]);
    expect(detectFeatures(PART, 'linear', library())).toEqual([]);
  });

  it('finds a part at the very start and the very end of a linear sequence', () => {
    const tail = randomDna(rand, 40);
    expect(only(detectFeatures(PART + tail, 'linear', LIB)).range).toEqual({ start: 0, end: 300 });
    expect(only(detectFeatures(tail + PART, 'linear', LIB)).range).toEqual({
      start: 40,
      end: 340,
    });
    expect(only(detectFeatures(PART, 'linear', LIB)).range).toEqual({ start: 0, end: 300 });
  });

  it('finds a part the same length as a circle, and none longer', () => {
    expect(only(detectFeatures(PART, 'circular', LIB)).range).toEqual({ start: 0, end: 300 });
    expect(detectFeatures(PART.slice(0, 299), 'circular', LIB)).toEqual([]);
  });

  it('finds a part through the origin of a circle at every rotation, on both strands', () => {
    const backbone = randomDna(rand, 200);
    const plasmid = PART + backbone; // 500 bp, part at 0
    const n = plasmid.length;
    for (const strandSeq of [plasmid, reverseComplement(backbone) + reverseComplement(PART)]) {
      const reverse = strandSeq !== plasmid;
      // Where the part starts in `strandSeq` (forward coordinates).
      const at = reverse ? backbone.length : 0;
      for (let origin = 0; origin < n; origin++) {
        const rotated = strandSeq.slice(origin) + strandSeq.slice(0, origin);
        const start = (at - origin + n) % n;
        const hit = only(detectFeatures(rotated, 'circular', LIB));
        expect(hit.range).toEqual({ start, end: start + 300 });
        expect(hit.strand).toBe(reverse ? 'reverse' : 'forward');
        // Cut at the origin, a linear molecule has no whole part to find:
        // it has the two pieces of one, each offered when enough of it is
        // there to be sure of (#94), and none at all when they are not
        // wanted.
        const wraps = start + 300 > n;
        const linear = detectFeatures(rotated, 'linear', LIB);
        expect(detectFeatures(rotated, 'linear', LIB, { partialEnds: false })).toHaveLength(
          wraps ? 0 : 1,
        );
        if (!wraps) {
          expect(linear).toHaveLength(1);
          continue;
        }
        const head = n - start; // bases of the part before the sequence ends
        const worthIt = (bases: number): boolean => bases >= 30 && bases >= 60;
        const expected = [
          ...(worthIt(300 - head) ? ['start'] : []),
          ...(worthIt(head) ? ['end'] : []),
        ];
        expect(
          linear.map((h) => ((h.partialStart ?? false) ? 'start' : 'end')).sort(),
          `origin ${origin}`,
        ).toEqual(expected.sort());
        for (const hit of linear) {
          // Each piece is where it lies, and says which end was cut off.
          if (hit.partialStart === true) expect(hit.range.start).toBe(0);
          if (hit.partialEnd === true) expect(hit.range.end).toBe(n);
          expect(hit.identity).toBe(1);
        }
      }
    }
  });

  it('reports mismatches and identity for a near match', () => {
    const seq = randomDna(rand, 30) + mutate(PART, [0, 150, 299]) + randomDna(rand, 30);
    const hit = only(detectFeatures(seq, 'linear', LIB));
    expect(hit.mismatches).toBe(3);
    expect(hit.ambiguous).toBe(0);
    expect(hit.identity).toBeCloseTo(297 / 300);
  });

  it('drops a match with more mismatches than the identity allows', () => {
    const budget = mismatchBudget(300, DEFAULT_MIN_IDENTITY);
    expect(budget).toBe(15);
    const spread = (k: number): number[] => Array.from({ length: k }, (_, i) => i * 14 + 3);
    expect(only(detectFeatures(mutate(PART, spread(budget)), 'linear', LIB)).mismatches).toBe(15);
    expect(detectFeatures(mutate(PART, spread(budget + 1)), 'linear', LIB)).toEqual([]);
    // A lower identity lets more through.
    const loose = detectFeatures(mutate(PART, spread(20)), 'linear', LIB, { minIdentity: 0.9 });
    expect(only(loose).mismatches).toBe(20);
  });

  it('caps the budget where a seed is still certain, so short parts match exactly', () => {
    expect(mismatchBudget(17, 0.95)).toBe(0);
    expect(mismatchBudget(23, 0.5)).toBe(0);
    expect(mismatchBudget(24, 0.5)).toBe(1);
    expect(mismatchBudget(60, 0.95)).toBe(3);
    expect(mismatchBudget(1000, 0.95)).toBe(50);
    expect(mismatchBudget(1000, 1)).toBe(0);
    const primer = part('M13', randomDna(rand, 20), 'primer_bind');
    const lib = library(primer);
    const flank = randomDna(rand, 60);
    expect(detectFeatures(flank + primer.sequence + flank, 'linear', lib)).toHaveLength(1);
    expect(detectFeatures(flank + mutate(primer.sequence, [9]) + flank, 'linear', lib)).toEqual([]);
  });

  it('finds every placement of mismatches within the budget, even the worst', () => {
    // 60 bp: a budget of 3. The worst placement leaves no 12-mer longer
    // than needed between mismatches; the q-gram lemma says one is left.
    const short = randomDna(rand, 60);
    const lib = library(part('S', short));
    const flank = randomDna(rand, 100);
    const worst = [11, 23, 35];
    expect(detectFeatures(flank + mutate(short, worst) + flank, 'linear', lib)).toHaveLength(1);
    for (let trial = 0; trial < 400; trial++) {
      const k = randomInt(rand, 0, 4);
      const positions = new Set<number>();
      while (positions.size < k) positions.add(randomInt(rand, 0, 60));
      const seq = flank + mutate(short, positions) + flank;
      const hit = only(detectFeatures(seq, 'circular', lib));
      expect(hit.mismatches).toBe(k);
      expect(hit.range.start).toBe(100);
    }
  });

  describe('ambiguity codes in the sequence', () => {
    it('counts a code that allows the part’s base as ambiguous, not a mismatch', () => {
      const seq = PART.slice(0, 100) + 'N' + PART.slice(101);
      const hit = only(detectFeatures(seq, 'linear', LIB));
      expect(hit.mismatches).toBe(0);
      expect(hit.ambiguous).toBe(1);
      expect(hit.identity).toBeCloseTo(299 / 300);
    });

    it('counts a code that rules the part’s base out as a mismatch', () => {
      const base = PART.charAt(10);
      // R is A or G, Y is C or T: whichever excludes the base.
      const code = base === 'A' || base === 'G' ? 'Y' : 'R';
      const allowing = base === 'A' || base === 'G' ? 'R' : 'Y';
      const hit = only(detectFeatures(PART.slice(0, 10) + code + PART.slice(11), 'linear', LIB));
      expect(hit).toMatchObject({ mismatches: 1, ambiguous: 0 });
      const ok = only(detectFeatures(PART.slice(0, 10) + allowing + PART.slice(11), 'linear', LIB));
      expect(ok).toMatchObject({ mismatches: 0, ambiguous: 1 });
    });

    it('holds ambiguous bases to the same budget as mismatches', () => {
      const ns = (k: number): string => {
        const out = PART.split('');
        for (let i = 0; i < k; i++) out[i * 19 + 5] = 'N';
        return out.join('');
      };
      expect(only(detectFeatures(ns(15), 'linear', LIB)).ambiguous).toBe(15);
      expect(detectFeatures(ns(16), 'linear', LIB)).toEqual([]);
    });

    it('finds a part however its codes fall, while it is within the budget (#94)', () => {
      // A word holding a code seeds nothing, so a sequence peppered with
      // them looks as though it could hide a part. It cannot: a code costs
      // the budget exactly as a mismatch does, and the budget is capped
      // where a clean window of twelve is still certain (the q-gram lemma).
      // Codes every thirteenth base, which is as dense as the budget allows
      // at 90%, at every offset.
      const every = 13;
      for (let offset = 0; offset < every; offset++) {
        const out = PART.split('');
        let codes = 0;
        for (let i = offset; i < out.length; i += every) {
          out[i] = 'N';
          codes++;
        }
        const seq = randomDna(rand, 40) + out.join('') + randomDna(rand, 40);
        const hit = only(detectFeatures(seq, 'linear', LIB, { minIdentity: 0.9 }));
        expect(hit, `offset ${offset}`).toMatchObject({ mismatches: 0, ambiguous: codes });
        expect(hit.range).toEqual({ start: 40, end: 340 });
      }
    });

    it('matches on the reverse strand through an ambiguity code', () => {
      const withCode = PART.slice(0, 200) + 'M' + PART.slice(201); // M = A or C
      const hit = only(detectFeatures(reverseComplement(withCode), 'linear', LIB));
      expect(hit.strand).toBe('reverse');
      // M allows A or C; whether that is the part's base decides which count it is in.
      expect(hit.mismatches + hit.ambiguous).toBe(1);
      expect(hit.ambiguous).toBe('AC'.includes(PART.charAt(200)) ? 1 : 0);
    });
  });

  describe('overlapping hits', () => {
    it('keeps a palindromic part once, on the forward strand', () => {
      const half = randomDna(rand, 15);
      const pal = half + reverseComplement(half);
      const lib = library(part('pal', pal, 'protein_bind'));
      const flank = randomDna(rand, 40);
      const hit = only(detectFeatures(flank + pal + flank, 'linear', lib));
      expect(hit.strand).toBe('forward');
    });

    it('keeps a repetitive part once where its repeats overlap', () => {
      const his6 = 'CATCACCATCACCATCAC';
      const lib = library(part('6xHis', his6, 'CDS'));
      const flank = randomDna(rand, 50);
      // Five His codons: the 18-mer occurs at three offsets that overlap.
      const hits = detectFeatures(flank + his6 + 'CATCACCATCAC' + flank, 'linear', lib);
      expect(only(hits).range).toEqual({ start: 50, end: 68 });
    });

    it('keeps two separate copies of a part', () => {
      const seq = PART + randomDna(rand, 100) + reverseComplement(PART) + randomDna(rand, 100);
      const hits = detectFeatures(seq, 'circular', LIB);
      expect(hits.map((h) => [h.range.start, h.strand])).toEqual([
        [0, 'forward'],
        [400, 'reverse'],
      ]);
    });

    it('prefers the variant that matches better over the one that differs', () => {
      const variant = mutate(PART, [150]);
      const lib = library(
        part('variant', variant, 'rep_origin'),
        part('exact', PART, 'rep_origin'),
      );
      const hit = only(detectFeatures(randomDna(rand, 20) + PART, 'linear', lib));
      expect(lib.parts[hit.part]?.name).toBe('exact');
      expect(hit.mismatches).toBe(0);
    });

    it('drops a part inside a longer one of the same type that matches as well', () => {
      const inner = PART.slice(50, 150);
      const lib = library(part('outer', PART, 'CDS'), part('inner', inner, 'CDS'));
      const hit = only(detectFeatures(PART, 'linear', lib));
      expect(lib.parts[hit.part]?.name).toBe('outer');
    });

    it('keeps a part inside a longer one of another type', () => {
      const inner = PART.slice(50, 150);
      const lib = library(part('outer', PART, 'promoter'), part('primer', inner, 'primer_bind'));
      const hits = detectFeatures(PART, 'linear', lib);
      expect(hits.map((h) => lib.parts[h.part]?.name)).toEqual(['outer', 'primer']);
    });

    it('keeps a part inside a longer one that matches worse', () => {
      const inner = PART.slice(50, 150);
      const lib = library(part('outer', PART, 'CDS'), part('inner', inner, 'CDS'));
      const hits = detectFeatures(mutate(PART, [10, 200]), 'linear', lib);
      expect(hits.map((h) => lib.parts[h.part]?.name)).toEqual(['outer', 'inner']);
    });

    it('orders hits along the sequence, the longer first where two start together', () => {
      const a = randomDna(rand, 80);
      const b = randomDna(rand, 90);
      const lib = library(
        part('a', a),
        part('b', b),
        part('a start', a.slice(0, 30), 'primer_bind'),
      );
      const seq = randomDna(rand, 10) + a + randomDna(rand, 10) + b + randomDna(rand, 10);
      expect(detectFeatures(seq, 'linear', lib).map((h) => [h.part, h.range.start])).toEqual([
        [0, 10],
        [2, 10],
        [1, 100],
      ]);
    });

    it('keeps both of two parts of different types that start at the same base', () => {
      const lib = library(part('primer', PART.slice(0, 40), 'primer_bind'), part('P', PART));
      const hits = detectFeatures(randomDna(rand, 25) + PART, 'linear', lib);
      expect(hits.map((h) => [h.part, h.range.start])).toEqual([
        [1, 25],
        [0, 25],
      ]);
    });

    it('drops a part of the same type 90% inside another, but not 89%', () => {
      const tail = randomDna(rand, 11);
      const seq = PART + tail + randomDna(rand, 30);
      // 100 bases, 90 of them the end of PART.
      const at90 = library(
        part('P', PART, 'CDS'),
        part('end', PART.slice(210) + tail.slice(0, 10), 'CDS'),
      );
      expect(detectFeatures(seq, 'linear', at90).map((h) => h.part)).toEqual([0]);
      const at89 = library(part('P', PART, 'CDS'), part('end', PART.slice(211) + tail, 'CDS'));
      expect(detectFeatures(seq, 'linear', at89).map((h) => h.part)).toEqual([0, 1]);
    });

    it('weighs a mismatch and an ambiguous base alike, then keeps the first in the library', () => {
      // The parts differ at base 100, A in one and C in the other; Y there
      // rules the A out and allows the C.
      const withA = PART.slice(0, 100) + 'A' + PART.slice(101);
      const withC = PART.slice(0, 100) + 'C' + PART.slice(101);
      const seq = PART.slice(0, 100) + 'Y' + PART.slice(101);
      for (const [first, second] of [
        [withA, withC],
        [withC, withA],
      ] as const) {
        const lib = library(part('first', first), part('second', second));
        const hit = only(detectFeatures(seq, 'linear', lib));
        expect(hit.part).toBe(0);
        expect(hit.mismatches + hit.ambiguous).toBe(1);
      }
    });

    it('prefers the forward strand, then library order, among equals', () => {
      const lib = library(part('reverse', reverseComplement(PART)), part('forward', PART));
      expect(only(detectFeatures(PART, 'linear', lib))).toMatchObject({
        part: 1,
        strand: 'forward',
      });
      const twins = library(part('one', PART), part('two', PART), part('three', PART));
      expect(only(detectFeatures(PART, 'linear', twins)).part).toBe(0);
      // The second part is seeded first, at base 0, and the first only past its mismatch at 5.
      const late = library(part('late', mutate(PART, [5])), part('early', mutate(PART, [250])));
      expect(only(detectFeatures(PART, 'linear', late)).part).toBe(0);
    });
  });

  it('finds a part of one base repeated, whichever the base', () => {
    // Poly-T's 12-mers are the last in the index, poly-A's the first.
    for (const base of 'ACGT') {
      const flank = 'ACGT'.replace(base, '').slice(0, 2).repeat(15);
      const lib = library(part(base, base.repeat(20)));
      const hit = only(detectFeatures(flank + base.repeat(20) + flank, 'linear', lib));
      expect(hit.range, base).toEqual({ start: 30, end: 50 });
      expect(hit.strand, base).toBe('forward');
    }
  });

  it('finds a part of exactly one seed, and each of two whose seeds differ in the last base', () => {
    const a = 'ACGTTGCAGGTA';
    const c = 'ACGTTGCAGGTC';
    const lib = library(part('a', a), part('c', c));
    const seq = 'GGGG' + a + 'CCCC' + c + 'GGGG';
    expect(detectFeatures(seq, 'linear', lib).map((h) => [h.part, h.range.start])).toEqual([
      [0, 4],
      [1, 20],
    ]);
  });

  it('finds nothing in a circle with a library of no usable parts', () => {
    expect(detectFeatures(PART, 'circular', library())).toEqual([]);
    expect(detectFeatures(PART, 'circular', library(part('tiny', PART.slice(0, 11))))).toEqual([]);
  });

  it('reports progress every 65,536 bases of what it reads, a circle and its overhang', () => {
    const at = (total: number, ...ps: number[]): number[] => ps.map((p) => p / total);
    const progress = (seq: string, topology: 'linear' | 'circular'): number[] => {
      const fractions: number[] = [];
      detectFeatures(seq, topology, LIB, { onProgress: (f) => fractions.push(f) });
      return fractions;
    };
    const long = randomDna(rand, 200_000);
    expect(progress(long, 'linear')).toEqual(at(200_000, 0, 65536, 131072, 196608));
    // Never 1, however the length falls.
    const even = long.slice(0, 131072);
    expect(progress(even, 'linear')).toEqual(at(131072, 0, 65536));
    // A circle is read on for the longest part, less a base, and as far
    // again as a gapped match may need (#94).
    expect(progress(even, 'circular')).toEqual(
      at(131072 + 299 + GAPPED_OVERHANG, 0, 65536, 131072),
    );
  }, 60_000);

  it('reports progress as it reads a long sequence', () => {
    const fractions: number[] = [];
    detectFeatures(randomDna(rand, 200_000), 'linear', LIB, {
      onProgress: (f) => fractions.push(f),
    });
    expect(fractions.length).toBeGreaterThan(1);
    expect(
      fractions.every((f, i) => f >= 0 && f < 1 && (i === 0 || f > (fractions[i - 1] ?? 0))),
    ).toBe(true);
  });

  it('ignores parts shorter than a seed', () => {
    expect(detectFeatures('ACGTACGTAC', 'linear', library(part('tiny', 'ACGTACGTAC')))).toEqual([]);
    expect(SEED).toBe(12);
  });
});

describe('detectFeatures with indels (#94)', () => {
  const flankA = randomDna(rand, 150);
  const flankB = randomDna(rand, 150);
  /** PART with `del` bases deleted at `at` and `ins` inserted there. */
  const indel = (at: number, del: number, ins = ''): string =>
    PART.slice(0, at) + ins + PART.slice(at + del);

  it('finds a part with a base deleted, and says so', () => {
    const hit = only(detectFeatures(flankA + indel(150, 1) + flankB, 'linear', LIB));
    expect(hit.range).toEqual({ start: 150, end: 449 });
    expect(hit).toMatchObject({ strand: 'forward', mismatches: 0, insertions: 0, deletions: 1 });
    expect(hit.identity).toBeCloseTo(299 / 300, 9);
  });

  it('finds a part with bases inserted, on the reverse strand', () => {
    const copy = indel(100, 0, 'GAT');
    const seq = flankA + reverseComplement(copy) + flankB;
    const hit = only(detectFeatures(seq, 'linear', LIB));
    expect(hit.range).toEqual({ start: 150, end: 453 });
    expect(hit).toMatchObject({ strand: 'reverse', insertions: 3, deletions: 0 });
    // Identity is of the alignment's columns: 300 matched of 303.
    expect(hit.identity).toBeCloseTo(300 / 303, 9);
  });

  it('finds a gapped part through the origin of a circle, on both strands', () => {
    const copy = mutate(indel(200, 2), [40]);
    for (const reverse of [false, true]) {
      const plasmid = (reverse ? reverseComplement(copy) : copy) + flankA;
      const n = plasmid.length;
      for (const origin of [1, 60, 150, 250, 297]) {
        const rotated = plasmid.slice(origin) + plasmid.slice(0, origin);
        const hit = only(detectFeatures(rotated, 'circular', LIB));
        const start = n - origin;
        expect(hit.range).toEqual({ start, end: start + 298 });
        expect(hit).toMatchObject({
          strand: reverse ? 'reverse' : 'forward',
          mismatches: 1,
          deletions: 2,
        });
      }
    }
  });

  it('counts each inserted or deleted base against the budget, as a mismatch', () => {
    // 300 bases at 95%: 15 edits.
    const within = mutate(indel(150, 6), [20, 40, 60, 80, 100, 120, 200, 220, 240]);
    const over = mutate(indel(150, 6), [20, 40, 60, 80, 100, 120, 200, 220, 240, 260]);
    expect(only(detectFeatures(flankA + within + flankB, 'linear', LIB))).toMatchObject({
      mismatches: 9,
      deletions: 6,
    });
    expect(detectFeatures(flankA + over + flankB, 'linear', LIB)).toEqual([]);
    // Exact means exact.
    expect(
      detectFeatures(flankA + indel(150, 1) + flankB, 'linear', LIB, { minIdentity: 1 }),
    ).toEqual([]);
  });

  it(`allows up to ${MAX_INDEL} bases of indel, and no more`, () => {
    expect(
      only(detectFeatures(flankA + indel(150, MAX_INDEL) + flankB, 'linear', LIB)).deletions,
    ).toBe(MAX_INDEL);
    expect(detectFeatures(flankA + indel(150, MAX_INDEL + 1) + flankB, 'linear', LIB)).toEqual([]);
    // In two places, the bases add up: the band is of how far the
    // alignment strays from the diagonal, both indels together.
    const twice = (d: number): string =>
      PART.slice(0, 100) + PART.slice(100 + d, 200) + PART.slice(200 + d);
    expect(only(detectFeatures(flankA + twice(4) + flankB, 'linear', LIB)).deletions).toBe(8);
    expect(detectFeatures(flankA + twice(5) + flankB, 'linear', LIB)).toEqual([]);
  });

  it('finds nothing gapped when asked not to', () => {
    const seq = flankA + indel(150, 1) + flankB;
    expect(detectFeatures(seq, 'linear', LIB, { gapped: false })).toEqual([]);
  });

  it('reads an indel near an end of the part as the substitutions it costs', () => {
    // Two bases from the end, the diagonal check finds it with two
    // mismatches at most; that is offered, not a gapped reading.
    const hit = only(detectFeatures(flankA + indel(297, 1) + flankB, 'linear', LIB));
    expect(hit.insertions).toBeUndefined();
    expect(hit.range).toEqual({ start: 150, end: 450 });
  });

  it('never reads a part cut off by the end of a linear sequence as gapped', () => {
    for (let cut = 1; cut <= MAX_INDEL + 2; cut++) {
      const seq = flankA + PART.slice(0, 300 - cut);
      const hits = detectFeatures(seq, 'linear', LIB);
      expect(hits.every((h) => h.insertions === undefined)).toBe(true);
      expect(only(hits).partialEnd).toBe(true);
    }
  });

  it('finds no indel in a part too short to have the seeds to be sure of it', () => {
    // 35 bases: an edit would be allowed at 90%, but not with an indel.
    const short = randomDna(rand, 35);
    const lib = library(part('S', short));
    const seq = flankA + short.slice(0, 17) + short.slice(18) + flankB;
    expect(detectFeatures(seq, 'linear', lib, { minIdentity: 0.9 })).toEqual([]);
    expect(indelBudget(35, 0.9)).toBe(0);
    expect(indelBudget(36, 0.9)).toBe(1);
    expect(indelBudget(300, 0.95)).toBe(15);
    expect(indelBudget(300, 0.9)).toBe(23);
  });
});

describe('isMinIdentityChoice', () => {
  it('accepts the identities the Features tab offers, and nothing else', () => {
    for (const v of [1, 0.98, 0.95, 0.9]) expect(isMinIdentityChoice(v)).toBe(true);
    for (const v of [0.97, 0, 95, '0.95', null, undefined])
      expect(isMinIdentityChoice(v)).toBe(false);
  });
});

describe('overlapLength', () => {
  it('counts shared bases of ranges on a line', () => {
    expect(overlapLength({ start: 0, end: 10 }, { start: 5, end: 20 }, 100, 'linear')).toBe(5);
    expect(overlapLength({ start: 0, end: 10 }, { start: 10, end: 20 }, 100, 'linear')).toBe(0);
  });

  it('counts shared bases of ranges over the origin of a circle', () => {
    expect(overlapLength({ start: 90, end: 110 }, { start: 0, end: 5 }, 100, 'circular')).toBe(5);
    expect(overlapLength({ start: 90, end: 110 }, { start: 95, end: 105 }, 100, 'circular')).toBe(
      10,
    );
    expect(overlapLength({ start: 90, end: 110 }, { start: 20, end: 30 }, 100, 'circular')).toBe(0);
  });
});

describe('the bundled library', () => {
  it('loads, and each part is found in a copy of itself, exactly', async () => {
    const lib = await loadFeatureLibrary();
    expect(lib.parts.length).toBeGreaterThan(0);
    expect(lib.parts.some((p) => p.source === 'fpbase')).toBe(true);
    for (const [i, p] of lib.parts.entries()) {
      // A part kept only as a protein (#93) has no bases to look for it in;
      // the protein test below covers those.
      if (p.sequence === '') continue;
      const hits = detectFeatures(p.sequence, 'linear', lib);
      const self = hits.find((h) => h.part === i);
      // A part may be displaced by a longer one of its type that contains it.
      const covered =
        self !== undefined ||
        hits.some((h) => lib.parts[h.part]?.type === p.type && h.identity === 1);
      expect(covered, p.name).toBe(true);
      if (self !== undefined) expect(self.identity, p.name).toBe(1);
    }
  }, 30_000);

  it('finds every part that carries a protein in a sequence coding for it (#93)', async () => {
    const lib = await loadFeatureLibrary();
    const codon: Record<string, string> = {
      A: 'GCG',
      C: 'TGC',
      D: 'GAT',
      E: 'GAA',
      F: 'TTT',
      G: 'GGC',
      H: 'CAT',
      I: 'ATT',
      K: 'AAA',
      L: 'CTG',
      M: 'ATG',
      N: 'AAC',
      P: 'CCG',
      Q: 'CAG',
      R: 'CGT',
      S: 'AGC',
      T: 'ACC',
      V: 'GTG',
      W: 'TGG',
      Y: 'TAT',
    };
    let checked = 0;
    for (const [i, p] of lib.parts.entries()) {
      const protein = p.protein ?? '';
      if (protein === '' || /[^ACDEFGHIKLMNPQRSTVWY]/.test(protein)) continue;
      checked++;
      // Spelled in codons of our own, so only a protein match can find it.
      const dna = Array.from(protein, (aa) => codon[aa] ?? 'NNN').join('');
      const hits = detectProteinFeatures(dna, 'linear', lib);
      const self = hits.find((h) => h.part === i);
      expect(self?.identity, p.name).toBe(1);
      expect(self?.range, p.name).toEqual({ start: 0, end: protein.length * 3 });
    }
    expect(checked).toBeGreaterThan(80);
  });

  it('is loaded once', async () => {
    expect(await loadFeatureLibrary()).toBe(await loadFeatureLibrary());
  });

  itTimed('scans a 1 Mb sequence in well under a second', async () => {
    const lib = await loadFeatureLibrary();
    const r = seededRandom(1);
    let seq = randomDna(r, 1_000_000);
    // A few real parts planted, on both strands.
    const planted = lib.parts.slice(0, 8);
    planted.forEach((p, k) => {
      const at = 100_000 * (k + 1);
      const bases = k % 2 === 0 ? p.sequence : reverseComplement(p.sequence);
      seq = seq.slice(0, at) + bases + seq.slice(at + bases.length);
    });
    detectFeatures(seq.slice(0, 50_000), 'circular', lib); // warm the index
    const t0 = performance.now();
    const hits = detectFeatures(seq, 'circular', lib);
    const ms = performance.now() - t0;
    process.stderr.write(
      `[perf] detect features 1 Mb × ${lib.parts.length} parts: ${ms.toFixed(0)} ms, ${hits.length} hits\n`,
    );
    for (const p of planted) expect(hits.some((h) => lib.parts[h.part] === p)).toBe(true);
    expectWithin(ms, 2000);
  });
});

describe('exact parts (#94 follow-up)', () => {
  const EXACT = { ...part('E', PART.slice(0, 43)), exact: true };
  const EXACT_LIB = library(EXACT);
  const flank = randomDna(seededRandom(94), 200);

  it('are found on a perfect copy, on either strand and through the origin', () => {
    const seq = flank + EXACT.sequence + flank;
    expect(only(detectFeatures(seq, 'linear', EXACT_LIB)).identity).toBe(1);
    expect(only(detectFeatures(reverseComplement(seq), 'linear', EXACT_LIB)).strand).toBe(
      'reverse',
    );
    const round = EXACT.sequence.slice(20) + flank + EXACT.sequence.slice(0, 20);
    expect(only(detectFeatures(round, 'circular', EXACT_LIB)).identity).toBe(1);
  });

  it('are not reported with one mismatch, at any identity choice', () => {
    const seq = flank + mutate(EXACT.sequence, [20]) + flank;
    const loose = library({ ...EXACT, exact: false });
    for (const minIdentity of MIN_IDENTITY_CHOICES) {
      expect(
        detectFeatures(seq, 'linear', EXACT_LIB, { minIdentity }),
        String(minIdentity),
      ).toEqual([]);
      // The same part, not marked exact, is found at the looser choices.
      expect(
        detectFeatures(seq, 'linear', loose, { minIdentity }).length > 0,
        String(minIdentity),
      ).toBe(minIdentity <= 0.95);
    }
  });

  it('are not reported across an indel, an ambiguity code or a linear end', () => {
    const options = { minIdentity: 0.9 };
    const cut = EXACT.sequence.slice(0, 20) + EXACT.sequence.slice(21);
    expect(detectFeatures(flank + cut + flank, 'linear', EXACT_LIB, options)).toEqual([]);
    const withN = EXACT.sequence.slice(0, 20) + 'N' + EXACT.sequence.slice(21);
    expect(detectFeatures(flank + withN + flank, 'linear', EXACT_LIB, options)).toEqual([]);
    expect(detectFeatures(EXACT.sequence.slice(0, 30), 'linear', EXACT_LIB)).toEqual([]);
    expect(detectFeatures(EXACT.sequence.slice(10), 'linear', EXACT_LIB)).toEqual([]);
  });
});

describe('lacUV5 and the wild-type lac promoter (#94 follow-up)', () => {
  const UV5_10 = 'TATAAT';
  const WILD_10 = 'TATGTT';

  it('lacUV5 is found on itself, and not on the wild-type lac promoter, at every choice', async () => {
    const lib = await loadFeatureLibrary();
    const at = lib.parts.findIndex((p) => p.name === 'lacUV5 promoter');
    const uv5 = lib.parts[at];
    if (uv5 === undefined) throw new Error('no lacUV5 part');
    expect(uv5.exact).toBe(true);
    expect(uv5.sequence).toContain(UV5_10);
    const wild = uv5.sequence.replace(UV5_10, WILD_10);
    const flank = randomDna(seededRandom(95), 150);
    for (const minIdentity of MIN_IDENTITY_CHOICES) {
      const onUv5 = detectFeatures(flank + uv5.sequence + flank, 'linear', lib, { minIdentity });
      expect(
        onUv5.some((h) => h.part === at && h.identity === 1),
        `UV5 at ${minIdentity}`,
      ).toBe(true);
      for (const seq of [flank + wild + flank, reverseComplement(flank + wild + flank)]) {
        const names = detectFeatures(seq, 'linear', lib, { minIdentity }).map(
          (h) => lib.parts[h.part]?.name,
        );
        expect(names, `wild type at ${minIdentity}`).not.toContain('lacUV5 promoter');
      }
    }
  });
});

describe('detectFeatures: ranking and gapped readings (mutation survivors)', () => {
  const r = seededRandom(1010);
  const flank = (n: number): string => randomDna(r, n);

  it('prefers a part wholly in the sequence to an equal piece of a longer one running off the end', () => {
    // The sequence starts with the last 100 bases of P, which is also Q whole.
    const q = randomDna(r, 100);
    const p = randomDna(r, 200) + q;
    const lib = library(part('P', p), part('Q', q));
    const hits = detectFeatures(q + flank(300), 'linear', lib);
    expect(hits.map((h) => h.part)).toEqual([1]);
    expect(hits[0]?.partialStart).toBeUndefined();
  });

  it('lists hits by start, the longer first where two start together', () => {
    // A part and its own first 120 bases, of another type: neither displaces the other.
    const long = randomDna(r, 200);
    const lib = library(part('long', long, 'promoter'), part('short', long.slice(0, 120), 'CDS'));
    const hits = detectFeatures(flank(100) + long + flank(100), 'linear', lib);
    expect(hits.map((h) => h.part)).toEqual([0, 1]);
    expect(hits.map((h) => h.range.end - h.range.start)).toEqual([200, 120]);
  });

  it('prefers the better match of two overlapping readings of a part', () => {
    // Of a part found twice over the same bases, the one with fewer mismatches is kept.
    const lib = library(part('P', PART));
    const seq = flank(80) + mutate(PART, [10, 150]) + flank(80);
    const hit = only(detectFeatures(seq, 'linear', lib));
    expect(hit.mismatches).toBe(2);
    expect(hit.range).toEqual({ start: 80, end: 380 });
  });

  it('counts mismatches, an ambiguity code and the indel in a gapped hit’s identity', () => {
    const lib = library(part('P', PART));
    const withIndel = PART.slice(0, 120) + 'GAT' + PART.slice(120);
    const edited = mutate(withIndel, [30]).split('');
    edited[200] = 'N';
    const seq = flank(120) + edited.join('') + flank(120);
    const hit = only(detectFeatures(seq, 'linear', lib));
    expect(hit).toMatchObject({ mismatches: 1, ambiguous: 1, insertions: 3, deletions: 0 });
    // 300 part bases and 3 inserted: 5 edits in 303 columns.
    expect(hit.identity).toBeCloseTo(1 - 5 / 303, 9);
  });

  it('keeps the reading with fewest edits where one copy is read two ways', () => {
    // A run of one base seeds every diagonal; one copy must still be one hit.
    const run = 'A'.repeat(40);
    const p = randomDna(r, 80) + run + randomDna(r, 80);
    const lib = library(part('P', p));
    const seq = flank(100) + p.slice(0, 100) + p.slice(103) + flank(100);
    const hits = detectFeatures(seq, 'linear', lib);
    expect(hits).toHaveLength(1);
    expect(hits[0]?.deletions).toBe(3);
    expect(hits[0]?.range).toEqual({ start: 100, end: 100 + p.length - 3 });
  });

  it('reports a gapped hit that sits in the sequence’s first turn, not a turn on', () => {
    const lib = library(part('P', PART));
    const copy = PART.slice(0, 150) + PART.slice(152);
    const plasmid = copy + flank(200);
    const hit = only(detectFeatures(plasmid, 'circular', lib));
    expect(hit.range).toEqual({ start: 0, end: 298 });
    expect(hit.deletions).toBe(2);
  });
});

describe('substitutionsFirst, seedsAtLeast and the seed threshold (mutation survivors)', () => {
  const r = seededRandom(2020);
  const flank = (n: number): string => randomDna(r, n);
  const lib = library(part('P', PART));

  it('offers substitutions, not an indel, where an insertion near the end makes the gapped reading longer', () => {
    // 301 bases against the part's 300: keepBest, going by length, would take the gapped reading.
    const copy = PART.slice(0, 297) + 'T' + PART.slice(297);
    const hit = only(detectFeatures(flank(150) + copy + flank(150), 'linear', lib));
    expect(hit.insertions).toBeUndefined();
    expect(hit.range.end - hit.range.start).toBe(300);
  });

  it('keeps a gapped copy beside an exact one of the same part', () => {
    const gapped = PART.slice(0, 120) + PART.slice(122);
    const seq = flank(100) + PART + flank(200) + gapped + flank(100);
    const hits = detectFeatures(seq, 'linear', lib);
    expect(hits.map((h) => h.insertions)).toEqual([undefined, 0]);
    expect(hits.map((h) => h.mismatches)).toEqual([0, 0]);
  });

  it('keeps a gapped part where another part, exact, lies inside it', () => {
    const inner = PART.slice(100, 200);
    const both = library(part('P', PART), part('Q', inner));
    const gapped = PART.slice(0, 40) + PART.slice(42);
    const hits = detectFeatures(flank(100) + gapped + flank(100), 'linear', both);
    expect(hits.map((h) => h.part)).toEqual([0, 1]);
    expect(hits[0]?.deletions).toBe(2);
  });

  it('finds a copy with exactly as many seeds as the budget guarantees', () => {
    // An insertion and 14 mismatches 12 bases apart: 15 edits, each spoiling
    // 12 seeds, none shared, leaving exactly the 109 a match of 15 edits must.
    expect(seedsAtLeast(300, 15)).toBe(109);
    const edited = PART.split('');
    for (let j = 0; j < 7; j++) {
      for (const base of [13 + 12 * j, 215 + 12 * j]) {
        edited[base] = edited[base] === 'A' ? 'C' : 'A';
      }
    }
    const copy = edited.slice(0, 150).join('') + 'T' + edited.slice(150).join('');
    const hit = only(detectFeatures(flank(150) + copy + flank(150), 'linear', lib));
    expect(hit).toMatchObject({ mismatches: 14, insertions: 1, deletions: 0 });
  });
});

describe('seedsAtLeast', () => {
  it('is what a match of that many edits shares: L + 1 - SEED(edits + 1)', () => {
    expect(seedsAtLeast(100, 0)).toBe(89);
    expect(seedsAtLeast(100, 2)).toBe(65);
    expect(seedsAtLeast(300, 15)).toBe(109);
  });
});

describe('overlapLength', () => {
  it('counts the bases two ranges share, in a line and over the origin of a circle', () => {
    expect(overlapLength({ start: 10, end: 30 }, { start: 20, end: 50 }, 100, 'linear')).toBe(10);
    expect(overlapLength({ start: 10, end: 30 }, { start: 30, end: 50 }, 100, 'linear')).toBe(0);
    expect(overlapLength({ start: 10, end: 30 }, { start: 40, end: 50 }, 100, 'linear')).toBe(0);
    expect(overlapLength({ start: 90, end: 110 }, { start: 5, end: 20 }, 100, 'circular')).toBe(5);
    expect(overlapLength({ start: 90, end: 110 }, { start: 20, end: 40 }, 100, 'circular')).toBe(0);
    // The same ranges are not wrapped on a line.
    expect(overlapLength({ start: 90, end: 110 }, { start: 5, end: 20 }, 100, 'linear')).toBe(0);
  });
});

describe('keepBest ties (mutation survivors)', () => {
  it('prefers the match on the bases to the one on the translation, before library order', () => {
    // The same 66 bases, found by their bases as part 1 and by their protein
    // as part 0, of one type: every earlier rule ties, and part 0 would win
    // on library order alone.
    const codon: Record<string, string> = {
      M: 'ATG',
      K: 'AAA',
      T: 'ACC',
      A: 'GCG',
      Y: 'TAT',
      I: 'ATT',
    };
    const protein = 'MKTAYIAKTAYIMKTAYIAKTA';
    const dna = Array.from(protein, (aa) => codon[aa] ?? 'NNN').join('');
    const byProtein: LibraryPart = { ...part('byProtein', '', 'CDS'), protein };
    const byBases = part('byBases', dna, 'CDS');
    const seq = randomDna(seededRandom(77), 120) + dna + randomDna(seededRandom(78), 120);
    const hits = detectFeatures(seq, 'linear', library(byProtein, byBases));
    expect(hits.map((h) => h.part)).toEqual([1]);
    expect(hits[0]?.viaProtein).toBeUndefined();
  });
});
