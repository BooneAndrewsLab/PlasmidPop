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

// The screen is instrumented in a mutation run, whose dry run runs these tests several times slower.
const SLOW = process.env['PLASMIDPOP_MUTATION'] === '1' ? 600_000 : 60_000;

describe('OverlapScreen (#353)', () => {
  // 100 real alignments; a mutation run's instrumented code is about 150 times
  // slower and runs this for every mutant, so it takes 10 there.
  const TRIALS = process.env['PLASMIDPOP_MUTATION'] === '1' ? 10 : 100;

  it(
    'never refuses a pair that has an overlap, on either strand, at any error rate',
    () => {
      const r = rng(353);
      let overlapping = 0;
      for (let t = 0; t < TRIALS; t++) {
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
      expect(overlapping).toBeGreaterThan(TRIALS * 0.3);
      // 100 real alignments: about 1.4 s here, over 5 s under coverage on a shared CI runner.
    },
    SLOW,
  );

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

  it(
    'refuses nearly all unrelated reads',
    () => {
      const r = rng(11);
      let kept = 0;
      for (let t = 0; t < 40; t++) {
        if (new OverlapScreen(bases(700, r)).mayOverlap(bases(700, r), 25, 0.9)) kept++;
      }
      expect(kept).toBeLessThanOrEqual(2);
      // Forty pairs of 700 bases: well under a second here, past 5 s on a
      // shared CI runner under coverage.
    },
    SLOW,
  );

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

describe('OverlapScreen: the bar, exactly (#353)', () => {
  // 25 columns at 90 % need 23 identical columns, which score 23 - 2 * 2 = 19 at the
  // worst; the bar is 18 (ceil of 23 * (1 - 2 * 0.1 / 0.9)). Reads of 'x' flank a
  // run `n` bases long shared from the end of one read to the start of the other.
  const r = rng(353353);
  const run = bases(18, r);
  const flankA = bases(300, r);
  const flankB = bases(300, r);

  const keep = (screened: string, other: string, minOverlap = 25, minIdentity = 0.9): boolean =>
    new OverlapScreen(screened).mayOverlap(other, minOverlap, minIdentity);

  it('keeps a run scoring exactly the bar and refuses one point short, wherever it sits and on either strand', () => {
    const short = run.slice(0, 17);
    for (const flip of [false, true]) {
      const orient = (s: string): string => (flip ? reverseComplement(s) : s);
      // The run at the start of the screened read (the first column) and at its end (the last).
      expect(keep(orient(run + flankB), flankA + run)).toBe(true);
      expect(keep(orient(flankB + run), run + flankA)).toBe(true);
      expect(keep(orient(short + flankB), flankA + short)).toBe(false);
      expect(keep(orient(flankB + short), short + flankA)).toBe(false);
    }
  });

  it('counts a gap as one penalty in either direction, so ten bases, a gap and ten more reach the bar', () => {
    const one = bases(10, r);
    const two = bases(10, r);
    const gapped = one + 'A' + two;
    const plain = one + two;
    // An extra base in the screened read, and an extra base in the other.
    expect(keep(gapped + flankB, flankA + plain)).toBe(true);
    expect(keep(plain + flankB, flankA + gapped)).toBe(true);
    // One column fewer and it falls short.
    const one9 = one.slice(1);
    expect(keep(one9 + 'A' + two + flankB, flankA + one9 + two)).toBe(false);
    expect(keep(one9 + two + flankB, flankA + one9 + 'A' + two)).toBe(false);
  });

  it('starts afresh after a stretch of mismatches instead of carrying the debt', () => {
    const a = 'A'.repeat(30) + run;
    const b = 'C'.repeat(30) + run;
    expect(keep(b, a)).toBe(true);
  });

  it('keeps a pair whose overlap holds exactly the identity asked, with two substitutions in 20 columns', () => {
    const rr = rng(2020);
    const shared = bases(20, rr);
    const edited = Array.from(shared);
    edited[4] = edited[4] === 'A' ? 'C' : 'A';
    edited[13] = edited[13] === 'G' ? 'T' : 'G';
    const a = bases(300, rr) + shared;
    const b = edited.join('') + bases(300, rr);
    // 18 identical columns of 20 is 90 %: ceil(0.9 * 20) = 18, scoring 18 - 4 = 14, the bar.
    expect(keep(b, a, 20, 0.9)).toBe(true);
  });

  it('treats an ambiguity code as matching nothing, even another one', () => {
    const n = 'N'.repeat(40);
    expect(keep(n, n)).toBe(false);
    expect(keep(n.toLowerCase(), n)).toBe(false);
  });

  it('refuses nothing when the identity cannot be met by anything, or is not a fraction', () => {
    const rr = rng(88);
    const a = bases(200, rr);
    const b = bases(200, rr);
    expect(keep(a, b, 25, 0)).toBe(true);
    expect(keep(a, b, 25, 1.5)).toBe(true);
    // An identity of exactly 1 is a real bar: 25 identical columns.
    expect(keep(a, b, 25, 1)).toBe(false);
  });

  it('refuses nothing when no column is needed, even for reads with no base in common', () => {
    expect(keep('AAAA', 'CCCC', 0, 0.9)).toBe(true);
  });
});
