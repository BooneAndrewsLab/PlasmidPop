import { describe, expect, it } from 'vitest';

import { reverseComplement } from '../sequence';
import { randomDna, randomInt, seededRandom } from '@/test/random';
import { expectWithin, itTimed } from '@/test/timing';
import {
  type FeatureHit,
  DEFAULT_MIN_IDENTITY,
  SEED,
  detectFeatures,
  isMinIdentityChoice,
  mismatchBudget,
  overlapLength,
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
    // A circle is read on for the longest part, less a base: 299 bases.
    expect(progress(even, 'circular')).toEqual(at(131072 + 299, 0, 65536, 131072));
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
  });

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
