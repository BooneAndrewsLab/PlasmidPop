import { expectWithin, itTimed } from '@/test/timing';
import { reverseComplement } from '../sequence/alphabet';
import { alignBanded, anchorChain, bandAround, boundBand, flankScoring } from './banded';
import { type Alignment, alignPairwise, bandCells } from './pairwise';
import { alignEitherStrand } from './strands';

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
  it.each([1, 2, 3])('scores a noisy read as the full alignment does (seed %i)', (seed) => {
    const next = rng(seed);
    const reference = randomSequence(5000, next);
    const read = noisy(reference.slice(700, 4200), 0.04, next);
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
    let st = 987654321;
    const rnd = (): number => {
      st = (Math.imul(st, 1664525) + 1013904223) >>> 0;
      return st / 4294967296;
    };
    const seq = (n: number): string =>
      Array.from({ length: n }, () => 'ACGT'[Math.floor(rnd() * 4)]).join('');
    const mut = (s: string, p: number): string => {
      let o = '';
      for (const c of s) {
        const r = rnd();
        if (r < p / 3) continue;
        if (r < (2 * p) / 3) o += 'ACGT'.charAt(Math.floor(rnd() * 4));
        else {
          o += c;
          if (r > 1 - p / 3) o += seq(1 + Math.floor(rnd() * 3));
        }
      }
      return o;
    };
    let below = 0;
    for (let t = 0; t < 12; t++) {
      const ref = seq(2500 + Math.floor(rnd() * 1500));
      const read =
        seq(300) +
        mut(ref.slice(Math.floor(rnd() * 300), ref.length - Math.floor(rnd() * 300)), 0.04) +
        seq(300);
      const full = alignPairwise(ref, read, { mode: 'local' });
      const bd = alignBanded(ref, read, { mode: 'local' });
      if (bd !== null && bd.alignment.score < full.score) below++;
    }
    expect(below).toBe(0);
    // Checking each band fills the region its junk flanks leave open: 6 s
    // here, over a minute on a busy CI runner.
  }, 300_000);
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

// Each case is a full alignment of about 2 M cells beside the banded one:
// a second or two here, ten times that on a busy CI runner. The Biopython
// oracle holds 24 more such pairs (src/test/oracle/alignment.test.ts).
describe('a band led astray by repeats or an end insertion (#167)', { timeout: 180_000 }, () => {
  it.each(KINDS.flatMap((kind) => (['local', 'global'] as const).map((mode) => [kind, mode])))(
    '%s, %s: the banded score is the full one',
    (kind, mode) => {
      const below: string[] = [];
      for (let seed = 1; seed <= 4; seed++) {
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
    for (const [k, kind] of KINDS.entries()) {
      for (let seed = 1; seed <= 2; seed++) {
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
      for (let seed = 1; seed <= 20; seed++) {
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
      expect(checked).toBeGreaterThan(15);
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
    expectWithin(ms, 8000);
  });

  it('leaves a long noisy read in local mode unchecked rather than fill most of the matrix', () => {
    const next = ints(12);
    const plasmid = bases(12_000, next);
    const read = errors(plasmid.slice(1000, 11_500), 10, next);
    const banded = alignBanded(plasmid, read, { mode: 'local' });
    expect(banded?.exact).toBe(false);
    expect(banded?.alignment.endA).toBeGreaterThan(11_000);
  });
});
