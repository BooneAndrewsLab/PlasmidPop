import { expectWithin, itTimed } from '@/test/timing';
import { reverseComplement } from '../sequence/alphabet';
import { alignBanded, anchorChain, bandAround, boundBand, flankScoring } from './banded';
import { type Alignment, alignPairwise, bandCells } from './pairwise';
import { alignEitherStrand, alignLong } from './strands';

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

/** A nanopore-like copy: about `rate` substitutions, insertions and deletions each. */
function noisy(seq: string, rate: number, next: () => number): string {
  let out = '';
  for (const c of seq) {
    const r = next();
    if (r < rate) continue; // deletion
    if (r < 2 * rate) out += 'ACGT'.charAt(Math.floor(next() * 4)); // insertion before
    out += r < 3 * rate ? 'ACGT'.replace(c, '').charAt(Math.floor(next() * 3)) : c;
  }
  return out;
}

// Several tests check the band against a full alignment of 12–24 M cells:
// under a second here, 7–13 s on a shared CI runner.
const FULL_ALIGNMENT_MS = 60_000;

describe('banded alignment (#51)', { timeout: FULL_ALIGNMENT_MS }, () => {
  it.each([1, 2])('scores a noisy read as the full alignment does (seed %i)', (seed) => {
    const next = rng(seed);
    const reference = randomSequence(3000, next);
    const read = noisy(reference.slice(400, 2500), 0.04, next);
    const full = alignPairwise(reference, read, { mode: 'local' });
    const banded = alignBanded(reference, read, { mode: 'local' });
    expect(banded).not.toBeNull();
    expect(banded?.alignment.score).toBe(full.score);
    expect([banded?.alignment.startA, banded?.alignment.endA]).toEqual([full.startA, full.endA]);
  });

  it('does global alignment end to end too', () => {
    const next = rng(9);
    const reference = randomSequence(4000, next);
    const read = noisy(reference, 0.03, next);
    const full = alignPairwise(reference, read, { mode: 'global' });
    const banded = alignBanded(reference, read, { mode: 'global' });
    expect(banded?.alignment.score).toBe(full.score);
    expect(banded?.exact).toBe(true);
    expect(banded?.alignment.alignedA.replace(/-/g, '')).toBe(reference);
  });

  it('follows a long insertion no anchor covers', () => {
    const next = rng(4);
    const reference = randomSequence(4000, next);
    const read =
      reference.slice(500, 2000) + randomSequence(400, next) + reference.slice(2000, 3500);
    const full = alignPairwise(reference, read, { mode: 'local' });
    expect(alignBanded(reference, read, { mode: 'local' })?.alignment.score).toBe(full.score);
  });

  it('is not led astray by a repeat', () => {
    const next = rng(5);
    const unit = randomSequence(600, next);
    const reference =
      randomSequence(1500, next) +
      unit +
      randomSequence(800, next) +
      unit +
      randomSequence(1500, next);
    const read = noisy(reference.slice(1000, 4500), 0.03, next);
    const full = alignPairwise(reference, read, { mode: 'local' });
    expect(alignBanded(reference, read, { mode: 'local' })?.alignment.score).toBe(full.score);
  });

  it('finds no chain between unrelated sequences', () => {
    const next = rng(6);
    expect(anchorChain(randomSequence(5000, next), randomSequence(4000, next))).toBeNull();
  });

  itTimed('aligns a 10 kb read against a 12 kb plasmid in a fraction of the cells', () => {
    const next = rng(7);
    const plasmid = randomSequence(12_000, next);
    const read = reverseComplement(noisy(plasmid.slice(1000, 11_500), 0.03, next));
    const t0 = performance.now();
    const r = alignEitherStrand(plasmid, read, { mode: 'local' });
    const ms = performance.now() - t0;
    expect(r.strand).toBe('reverse');
    expect(r.alignment.endA - r.alignment.startA).toBeGreaterThan(10_000);
    process.stderr.write(`[perf] banded 12000x${read.length}: ${ms.toFixed(0)} ms\n`);
    expectWithin(ms, 8000);
  });

  it('keeps the band narrow: a small share of the matrix', () => {
    const next = rng(8);
    const reference = randomSequence(8000, next);
    const read = noisy(reference.slice(0, 7000), 0.04, next);
    const links = anchorChain(reference, read);
    if (links === null) throw new Error('no chain');
    const band = bandAround(links, reference.length, read.length, 'local', 64);
    const share = bandCells(band) / ((reference.length + 1) * (read.length + 1));
    process.stderr.write(`[band] ${(share * 100).toFixed(2)}% of the matrix\n`);
    expect(share).toBeLessThan(0.05);
    expect(alignBanded(reference, read, { mode: 'local' })?.touchedEdge).toBe(false);
  });
});

describe('a local alignment with flanks that do not match (#159)', () => {
  it('#159: banded local alignment with junk flanks scores as the full matrix', () => {
    const next = ints(987654321);
    const mut = (s: string, p: number): string => {
      // About p substitutions, p deletions and p short insertions per base.
      const permille = Math.round(p * 1000);
      let o = '';
      for (const c of s) {
        const r = next(1000);
        if (r < permille / 3) continue;
        if (r < (2 * permille) / 3) o += 'ACGT'.charAt(next(4));
        else {
          o += c;
          if (r >= 1000 - permille / 3) o += bases(1 + next(3), next);
        }
      }
      return o;
    };
    // Each trial is a full alignment of about 9 M cells beside the banded
    // one, and the junk flanks leave the check a wide region to fill: ~1 s
    // here. Without the flank band 8 of 12 trials fail,
    // trials 0 and 3 among them (found by reverting it).
    let below = 0;
    for (let t = 0; t < 3; t++) {
      const ref = bases(2500 + next(1500), next);
      const read =
        bases(300, next) +
        mut(ref.slice(next(300), ref.length - next(300)), 0.04) +
        bases(300, next);
      const full = alignPairwise(ref, read, { mode: 'local' });
      const bd = alignBanded(ref, read, { mode: 'local' });
      if (bd !== null && bd.alignment.score < full.score) below++;
    }
    expect(below).toBe(0);
  }, 120_000);
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

type Kind =
  'tandem in read' | 'tandem in reference' | 'insertion near start' | 'insertion near end';
const KINDS: readonly Kind[] = [
  'tandem in read',
  'tandem in reference',
  'insertion near start',
  'insertion near end',
];

/**
 * A Sanger-length read the band around shared words can lead astray (#167):
 * a duplicated unit (its copies a little different) on one side only, or
 * a long insertion a few bases from one end of the read.
 */
function astray(kind: Kind, seed: number, refLength = 3000): { reference: string; read: string } {
  const next = ints(seed);
  const unit = bases(20 + next(280), next);
  const at = 400 + next(400);
  const left = bases(at, next);
  const right = bases(refLength - at, next);
  const copy = errors(unit, 7, next);
  const before = left.slice(at - 200 - next(200));
  const after = right.slice(0, 200 + next(400));
  let reference = left + right;
  let read: string;
  if (kind === 'tandem in read') {
    reference = left + unit + right;
    read = before + unit + copy + after;
  } else if (kind === 'tandem in reference') {
    reference = left + unit + copy + right;
    read = before + unit + after;
  } else {
    const from = next(refLength - 1000);
    const body = reference.slice(from, from + 500 + next(500));
    const near = kind === 'insertion near start' ? 5 + next(36) : body.length - 5 - next(36);
    read = body.slice(0, near) + bases(30 + next(300), next) + body.slice(near);
  }
  return { reference, read: errors(read, 3 + next(25), next) };
}

/** The cells (i, j) an alignment's path runs through, start to end. */
function pathCells(r: Alignment): [number, number][] {
  let i = r.startA;
  let j = r.startB;
  const out: [number, number][] = [[i, j]];
  for (let k = 0; k < r.alignedA.length; k++) {
    if (r.alignedA.charAt(k) !== '-') i++;
    if (r.alignedB.charAt(k) !== '-') j++;
    out.push([i, j]);
  }
  return out;
}

// Each case is a full alignment of about 2 M cells beside the banded one.
// The Biopython oracle holds 24 more such pairs (src/test/oracle/alignment.test.ts),
// so each kind and mode runs one seed, picked as one the band gets wrong
// without the check (found by switching the check off): 3 for a tandem in
// the read and for an insertion near the end, 4 near the start. A tandem in
// the reference misses nowhere in this matrix, only in "fast Align all" below.
const MISSED_BY_SEED: Record<Kind, number> = {
  'tandem in read': 3,
  'tandem in reference': 1,
  'insertion near start': 4,
  'insertion near end': 3,
};
describe('a band led astray by repeats or an end insertion (#167)', { timeout: 180_000 }, () => {
  it.each(KINDS.flatMap((kind) => (['local', 'global'] as const).map((mode) => [kind, mode])))(
    '%s, %s: the banded score is the full one',
    (kind, mode) => {
      const below: string[] = [];
      for (const seed of [MISSED_BY_SEED[kind as Kind]]) {
        const { reference, read } = astray(kind as Kind, seed * 7919);
        const options = { mode: mode as 'local' | 'global' };
        const banded = alignBanded(reference, read, options);
        if (banded === null) continue;
        expect(banded.exact).toBe(true);
        const full = alignPairwise(reference, read, options);
        if (banded.alignment.score !== full.score) {
          below.push(
            `seed ${String(seed)}: ${String(banded.alignment.score)} < ${String(full.score)}`,
          );
        }
      }
      expect(below).toEqual([]);
    },
  );

  it('fast Align all reaches the score of aligning both strands in full', () => {
    const below: string[] = [];
    // Without the check these three miss; the others do not.
    const cases: [number, number][] = [
      [1, 1],
      [2, 2],
      [3, 1],
    ];
    for (const [k, seed] of cases) {
      const kind = KINDS[k] ?? 'tandem in read';
      const { reference, read } = astray(kind, seed * 104_729 + k);
      const turned = seed % 2 === 0 ? reverseComplement(read) : read;
      const fast = alignEitherStrand(reference, turned, { mode: 'local', fast: true });
      const full = Math.max(
        alignPairwise(reference, turned, { mode: 'local' }).score,
        alignPairwise(reference, reverseComplement(turned), { mode: 'local' }).score,
      );
      if (fast.alignment.score !== full) {
        below.push(
          `${kind} seed ${String(seed)}: ${String(fast.alignment.score)} < ${String(full)}`,
        );
      }
    }
    expect(below).toEqual([]);
  });

  // The bound itself: every cell of the best path lies in the region the
  // banded score implies, whatever the band found. Small pairs, so the full
  // alignment is cheap; the region is checked, not filled.
  it.each(['global', 'local'] as const)(
    '%s: the region holds every cell of the best path',
    (mode) => {
      const scoring = flankScoring({ mode });
      let checked = 0;
      for (let seed = 1; seed <= 8; seed++) {
        const { reference, read } = astray(KINDS[seed % 4] ?? 'tandem in read', seed, 1500);
        const links = anchorChain(reference, read);
        if (links === null) continue;
        const full = alignPairwise(reference, read, { mode });
        const cells = pathCells(full);
        // A local path is held only if it meets a diagonal of the chain.
        const diagonals = links.map((a) => a.i - a.j);
        const [low, high] = [Math.min(...diagonals), Math.max(...diagonals)];
        if (mode === 'local' && !cells.some(([i, j]) => i - j >= low && i - j <= high)) continue;
        // Any score up to the optimum must keep the path: the band's, and lower.
        for (const score of [full.score, full.score - 40]) {
          const region = boundBand(links, reference.length, read.length, mode, score, scoring);
          for (const [i, j] of cells) {
            expect(j, `seed ${String(seed)} cell ${String(i)},${String(j)}`).toBeGreaterThanOrEqual(
              region.lo[i] ?? 0,
            );
            expect(j).toBeLessThanOrEqual(region.hi[i] ?? 0);
          }
        }
        checked++;
      }
      expect(checked).toBeGreaterThan(5);
    },
  );
});

// What the check costs (#167), quoted in docs/perf-notes.md.
describe('the cost of checking a band (#167)', () => {
  itTimed('checks a Sanger read against a 300 kb circle, unrolled', () => {
    const next = ints(300);
    const circle = bases(300_000, next);
    const read = errors(circle.slice(150_000, 151_000), 10, next);
    const unrolled = circle + circle.slice(0, circle.length - 1);
    const t0 = performance.now();
    const banded = alignBanded(unrolled, read, { mode: 'local' });
    const ms = performance.now() - t0;
    expect(banded?.exact).toBe(true);
    process.stderr.write(`[perf] checked 1 kb against 600 kb: ${ms.toFixed(0)} ms\n`);
    expectWithin(ms, 5000);
  });

  itTimed('checks a 10 kb read aligned globally', () => {
    const next = ints(10);
    const plasmid = bases(10_500, next);
    const read = errors(plasmid, 10, next);
    const t0 = performance.now();
    const banded = alignBanded(plasmid, read, { mode: 'global' });
    const ms = performance.now() - t0;
    expect(banded?.exact).toBe(true);
    process.stderr.write(`[perf] checked 10 kb global: ${ms.toFixed(0)} ms\n`);
    // A full fill is 110 M cells, 3-4 s here: a shared CI runner has taken
    // 3.7 s for the 0.3 s the check needs, so the clock only guards the order
    // of magnitude; the region's size below is what is exact.
    expectWithin(ms, 15_000);
    // Every cell the band and its check filled, not a region recomputed here.
    expect(banded?.filled).toBeGreaterThan(0);
    expect(banded?.filled).toBeLessThan(0.2 * plasmid.length * read.length);
  });

  it('leaves a long noisy read in local mode unchecked rather than fill most of the matrix', () => {
    const next = ints(12);
    const plasmid = bases(12_000, next);
    const read = errors(plasmid.slice(1000, 11_500), 10, next);
    const banded = alignBanded(plasmid, read, { mode: 'local' });
    expect(banded?.exact).toBe(false);
    expect(banded?.alignment.endA).toBeGreaterThan(11_000);
  });

  it('marks the alignment the caller gets as unchecked only when it was (#171)', () => {
    const next = ints(12);
    const plasmid = bases(12_000, next);
    const noisyRead = errors(plasmid.slice(1000, 11_500), 10, next);
    expect(alignLong(plasmid, noisyRead, { mode: 'local' }).unchecked).toBe(true);
    // A clean read's region is small enough to check.
    const clean = plasmid.slice(1000, 11_500);
    expect(alignLong(plasmid, clean, { mode: 'local' }).unchecked).toBeUndefined();
    // Small pairs are aligned in full, never marked.
    expect(alignLong('ACGTACGTAC', 'ACGTACGTAC', { mode: 'local' }).unchecked).toBeUndefined();
  });
});

describe(
  'a read just before the origin of a circle, banded (#175)',
  { timeout: FULL_ALIGNMENT_MS },
  () => {
    // A circle as a whole-plasmid read alignment sends it: its start repeated
    // after its end, all but one base.
    const L = 3000;
    const plasmid = randomSequence(L, rng(175));
    const unrolled = plasmid + plasmid.slice(0, L - 1);
    const flip = (c: string): string => (c === 'A' ? 'C' : 'A');
    /** `before` bases of the end, the one at `at` changed, then `after` of the start. */
    function across(before: number, after: number, at: number): string {
      const read = plasmid.slice(L - before) + plasmid.slice(0, after);
      return read.slice(0, at) + flip(read.charAt(at)) + read.slice(at + 1);
    }

    it.each([2, 3, 4, 8, 10, 13, 14, 20])(
      'keeps the %i bases before the origin and the difference among them',
      (before) => {
        // The difference is the last base before the origin: no 15-mer of the
        // read crosses it, so the read's words are all in both copies. (One
        // base before it would be the difference alone, which a local
        // alignment rightly leaves out.)
        const read = across(before, 900, before - 1);
        const full = alignPairwise(unrolled, read, { mode: 'local' });
        const banded = alignBanded(unrolled, read, { mode: 'local', wrap: L });
        expect(banded?.exact).toBe(true);
        expect(banded?.alignment.score).toBe(full.score);
        expect(banded?.alignment.startA).toBe(L - before);
        expect(banded?.alignment.startB).toBe(0);
      },
    );

    it('missed it without being told the circle, as before', () => {
      const read = across(4, 900, 3);
      const banded = alignBanded(unrolled, read, { mode: 'local' });
      expect(banded?.alignment.startB).toBe(4);
    });

    it.each([0, 2, 6])('keeps a read whose first base differs, %i bases further in', (shift) => {
      const read = across(12 + shift, 600, 0);
      const full = alignPairwise(unrolled, read, { mode: 'local' });
      const banded = alignBanded(unrolled, read, { mode: 'local', wrap: L });
      expect(banded?.alignment.score).toBe(full.score);
      expect(banded?.alignment.startA).toBe(full.startA);
    });

    it.each([2, 4, 10])(
      'keeps the %i bases after the origin of a read that ends there',
      (after) => {
        const read = across(900, after, 900);
        const full = alignPairwise(unrolled, read, { mode: 'local' });
        const banded = alignBanded(unrolled, read, { mode: 'local', wrap: L });
        expect(banded?.alignment.score).toBe(full.score);
        expect(banded?.alignment.endB).toBe(read.length);
      },
    );

    it.each([2, 4, 10])(
      'does the same for a reverse read, %i bases before the origin',
      (before) => {
        const read = reverseComplement(across(before, 900, before - 1));
        const full = alignPairwise(unrolled, reverseComplement(read), { mode: 'local' });
        const best = alignEitherStrand(unrolled, read, { mode: 'local', fast: true, wrap: L });
        expect(best.strand).toBe('reverse');
        expect(best.alignment.score).toBe(full.score);
        expect(best.alignment.startA).toBe(L - before);
      },
    );

    it('keeps a read with an indel just before the origin', () => {
      const clean = plasmid.slice(L - 6) + plasmid.slice(0, 900);
      for (const read of [
        clean.slice(0, 4) + clean.slice(5),
        clean.slice(0, 4) + 'G' + clean.slice(4),
      ]) {
        const full = alignPairwise(unrolled, read, { mode: 'local' });
        const banded = alignBanded(unrolled, read, { mode: 'local', wrap: L });
        expect(banded?.alignment.score).toBe(full.score);
        expect(banded?.alignment.startA).toBe(full.startA);
      }
    });

    it('checks the turn on as well, at no more than twice the cells', () => {
      const read = plasmid.slice(100, 1000);
      const without = alignBanded(unrolled, read, { mode: 'local' });
      const withWrap = alignBanded(unrolled, read, { mode: 'local', wrap: L });
      expect(withWrap?.alignment).toEqual(without?.alignment);
      expect(withWrap?.filled).toBeLessThanOrEqual(2 * (without?.filled ?? 0));
    });
  },
);

describe('the reference kept between reads (#170)', () => {
  it('gives each read the answer it has alone, whichever reference came before', () => {
    const next = rng(170);
    const one = randomSequence(30_000, next);
    const two = randomSequence(30_000, next);
    const readOne = noisy(one.slice(5000, 6200), 0.02, next);
    const readTwo = noisy(two.slice(9000, 10200), 0.02, next);
    const options = { mode: 'local' as const };
    // Alternating references and one more with the same length, so a cache
    // keyed by anything but the sequence would return the wrong one.
    const alone = (ref: string, read: string): Alignment | undefined =>
      alignBanded(ref, read, options)?.alignment;
    const expectedOne = alone(one, readOne);
    const expectedTwo = alone(two, readTwo);
    for (let round = 0; round < 2; round++) {
      expect(alone(one, readOne)).toEqual(expectedOne);
      expect(alone(two, readTwo)).toEqual(expectedTwo);
      expect(alone(one, readTwo)).not.toEqual(expectedTwo);
    }
    expect(expectedOne?.startA).toBe(5000);
    expect(expectedTwo?.startA).toBe(9000);
  });
});
