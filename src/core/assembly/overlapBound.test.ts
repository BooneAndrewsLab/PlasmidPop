import { alignEitherStrand } from '../alignment';
import { reverseComplement } from '../sequence/alphabet';

import { OverlapScreen } from './overlapBound';

/** Seeded xorshift32 in [0, 1). */
function rng(seed: number): () => number {
  let x = seed >>> 0 || 1;
  return () => {
    x ^= x << 13;
    x >>>= 0;
    x ^= x >>> 17;
    x ^= x << 5;
    x >>>= 0;
    return x / 4294967296;
  };
}

const bases = (n: number, r: () => number): string =>
  Array.from({ length: n }, () => 'ACGT'[Math.floor(r() * 4)]).join('');

/** `seq` with substitutions and indels at about `rate` a base. */
function mutate(seq: string, rate: number, r: () => number): string {
  let out = '';
  for (const c of seq) {
    const x = r();
    if (x >= rate) out += c;
    else if (x < rate / 3) out += 'ACGT'.charAt(Math.floor(r() * 4));
    else if (x < (2 * rate) / 3) out += c + 'ACGT'.charAt(Math.floor(r() * 4));
  }
  return out;
}

/** What the assembler asks of a pair it aligns: an overlap of `minOverlap` bases at `minIdentity`. */
function overlaps(a: string, b: string, minOverlap: number, minIdentity: number): boolean {
  const { alignment } = alignEitherStrand(a, b, { mode: 'local', fast: true, gapExtend: -4 });
  return alignment.endA - alignment.startA >= minOverlap && alignment.identity >= minIdentity;
}

describe('OverlapScreen (#353)', () => {
  it('never refuses a pair that has an overlap, on either strand, at any error rate', () => {
    const r = rng(353);
    let overlapping = 0;
    for (let t = 0; t < 100; t++) {
      const left = bases(300 + Math.floor(r() * 300), r);
      const shared = bases(20 + Math.floor(r() * 150), r);
      const right = bases(300 + Math.floor(r() * 300), r);
      const rate = r() * 0.14;
      const a = left + shared;
      let b = mutate(shared, rate, r) + right;
      if (r() < 0.5) b = reverseComplement(b);
      if (!overlaps(a, b, 25, 0.9)) continue;
      overlapping++;
      expect(new OverlapScreen(b).mayOverlap(a, 25, 0.9)).toBe(true);
    }
    // The generator has to produce overlaps for this to say anything.
    expect(overlapping).toBeGreaterThan(30);
    // 100 real alignments: about 1.4 s here, over 5 s under coverage on a shared CI runner.
  }, 60_000);

  it('keeps a pair with the shortest overlap allowed, two substitutions in 25 columns', () => {
    const r = rng(7);
    const shared = bases(25, r);
    // Two substitutions in 25 columns is 92 % identity.
    const edited = Array.from(shared);
    edited[5] = edited[5] === 'A' ? 'C' : 'A';
    edited[17] = edited[17] === 'G' ? 'T' : 'G';
    const a = bases(400, r) + shared;
    const b = edited.join('') + bases(400, r);
    expect(new OverlapScreen(b).mayOverlap(a, 25, 0.9)).toBe(true);
  });

  it('refuses nearly all unrelated reads', () => {
    const r = rng(11);
    let kept = 0;
    for (let t = 0; t < 40; t++) {
      if (new OverlapScreen(bases(700, r)).mayOverlap(bases(700, r), 25, 0.9)) kept++;
    }
    expect(kept).toBeLessThanOrEqual(2);
  });

  it('treats an ambiguity code as a difference, so it only ever makes a pair easier to keep', () => {
    const r = rng(13);
    const shared = bases(60, r);
    const a = bases(300, r) + shared;
    const b = shared.slice(0, 30) + 'N' + shared.slice(31) + bases(300, r);
    expect(overlaps(a, b, 25, 0.9)).toBe(true);
    expect(new OverlapScreen(b).mayOverlap(a, 25, 0.9)).toBe(true);
  });

  it('refuses nothing when the identity asked is too low for the bound to hold', () => {
    const r = rng(17);
    expect(new OverlapScreen(bases(100, r)).mayOverlap(bases(100, r), 25, 0.6)).toBe(true);
  });
});
