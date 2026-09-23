import { reverseComplement } from '../sequence/alphabet';

import { alignPairwise } from './pairwise';
import { alignEitherStrand, likelyStrand } from './strands';

/** Mulberry32: unlike a plain LCG, different seeds give unrelated sequences. */
function randomSequence(length: number, seed: number): string {
  let x = seed;
  let out = '';
  for (let i = 0; i < length; i++) {
    x = (x + 0x6d2b79f5) | 0;
    let t = Math.imul(x ^ (x >>> 15), 1 | x);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    out += 'ACGT'.charAt(((t ^ (t >>> 14)) >>> 0) & 3);
  }
  return out;
}

/** `seq` with a substitution every 29 bases and a deletion every 41: about 6% error. */
function noisyRead(seq: string): string {
  let out = '';
  for (let i = 0; i < seq.length; i++) {
    if (i % 41 === 0) continue;
    const c = seq.charAt(i);
    out += i % 29 === 0 ? (c === 'A' ? 'C' : 'A') : c;
  }
  return out;
}

describe('likelyStrand', () => {
  const plasmid = randomSequence(6000, 7);
  const read = noisyRead(plasmid.slice(1000, 5000));

  it('picks the strand a noisy read came from', () => {
    expect(likelyStrand(plasmid, read)).toBe('forward');
    expect(likelyStrand(plasmid, reverseComplement(read))).toBe('reverse');
  });

  it('declines to choose for an unrelated sequence', () => {
    expect(likelyStrand(plasmid, randomSequence(4000, 99))).toBeNull();
  });

  it('declines to choose for a sequence too short to hold enough 11-mers', () => {
    expect(likelyStrand(plasmid, plasmid.slice(0, 25))).toBeNull();
  });

  it('skips k-mers that contain an ambiguity code', () => {
    expect(likelyStrand('ACGTACGTACGTN', 'ACGTACGTACGTN'.replace(/./g, 'N'))).toBeNull();
  });
});

describe('alignEitherStrand', () => {
  it('aligns small inputs on both strands and keeps the better', () => {
    const plasmid = randomSequence(600, 3);
    const read = reverseComplement(plasmid.slice(100, 400));
    const r = alignEitherStrand(plasmid, read, { mode: 'local' });
    expect(r.strand).toBe('reverse');
    expect(r.alignment.identity).toBe(1);
  });

  it('on large inputs aligns only the strand the k-mers pick, with the same answer', () => {
    const plasmid = randomSequence(3000, 11);
    const read = reverseComplement(noisyRead(plasmid.slice(200, 2800)));
    const r = alignEitherStrand(plasmid, read, { mode: 'local' });
    expect(r.strand).toBe('reverse');
    const full = alignPairwise(plasmid, reverseComplement(read), { mode: 'local' });
    expect(r.alignment.score).toBe(full.score);
    expect(r.alignment.identity).toBeGreaterThan(0.9);
  });
});
