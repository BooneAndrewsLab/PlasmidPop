import { reverseComplement } from '../sequence/alphabet';
import { alignBanded, anchorChain, bandAround } from './banded';
import { alignPairwise, bandCells } from './pairwise';
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

  it('aligns a 10 kb read against a 12 kb plasmid in a fraction of the cells', () => {
    const next = rng(7);
    const plasmid = randomSequence(12_000, next);
    const read = reverseComplement(noisy(plasmid.slice(1000, 11_500), 0.03, next));
    const t0 = performance.now();
    const r = alignEitherStrand(plasmid, read, { mode: 'local' });
    const ms = performance.now() - t0;
    expect(r.strand).toBe('reverse');
    expect(r.alignment.endA - r.alignment.startA).toBeGreaterThan(10_000);
    process.stderr.write(`[perf] banded 12000x${read.length}: ${ms.toFixed(0)} ms\n`);
    expect(ms).toBeLessThan(8000);
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
