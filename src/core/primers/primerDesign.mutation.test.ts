import fc from 'fast-check';

import { type Range, type Topology } from '../range';
import { reverseComplement } from '../sequence';
import { DEFAULT_PRIMER_CRITERIA, type PrimerCriteria } from './criteria';
import {
  type PrimerPair,
  type PrimerReport,
  analyzePrimer,
  designPrimers,
  findPrimerBindingSites,
} from './primerDesign';
import { threePrimeComplementarity } from './thermo';

/**
 * Exact outputs of the primer check and designer, pinned at the edges of
 * every criterion and region (#77): a bound is inclusive, a warning's wording
 * is what the Primers tab shows, and the designer returns every pair its
 * rules allow and no other.
 */

// The fixed 600-bp template of `primerDesign.test.ts`.
function template(): string {
  let x = 12345;
  let out = '';
  for (let i = 0; i < 600; i++) {
    x = (x * 1103515245 + 12345) & 0x7fffffff;
    out += 'ACGT'.charAt((x >> 16) & 3);
  }
  return out;
}

/** Criteria that let anything through, to test one bound at a time. */
function loose(): PrimerCriteria {
  return {
    ...DEFAULT_PRIMER_CRITERIA,
    minLength: 1,
    maxLength: 100,
    minTm: 0,
    maxTm: 100,
    minGc: 0,
    maxGc: 1,
    maxTmDifference: 100,
    maxHomopolymer: 100,
    maxHairpin: 100,
    maxSelfComplementarity: 100,
    maxThreePrime: 100,
    requireGcClamp: false,
    minProduct: 0,
    maxProduct: 100_000,
    requireSpecific: false,
  };
}

describe('analyzePrimer at the edges of its criteria', () => {
  it('passes a plain primer whose every measure sits exactly on a bound', () => {
    const primer = 'GAATTCGCAAGGTACCAGGG';
    const r = analyzePrimer(primer);
    expect(r).toMatchObject({
      length: 20,
      gc: 0.55,
      homopolymer: 3,
      selfComplementarity: 6,
      hairpin: 2,
      threePrimeSelf: 2,
      gcClamp: true,
      degenerate: 0,
      molecules: 1,
      tmRange: null,
      gcRange: { min: 0.55, max: 0.55 },
      warnings: [],
    });
    expect(r.tm).toBeCloseTo(56.0156, 4);
    const onEveryBound = analyzePrimer(primer, {
      ...DEFAULT_PRIMER_CRITERIA,
      minLength: 20,
      maxLength: 20,
      minTm: r.tm,
      maxTm: r.tm,
      minGc: r.gc,
      maxGc: r.gc,
      maxHomopolymer: 3,
      maxHairpin: 2,
      maxSelfComplementarity: 6,
      maxThreePrime: 2,
    });
    expect(onEveryBound.warnings).toEqual([]);
  });

  it('names every lower bound a plain primer falls short of, in order', () => {
    const r = analyzePrimer('GAATTCGCAAGGTACCAGGG', {
      ...DEFAULT_PRIMER_CRITERIA,
      minLength: 21,
      minTm: 57,
      minGc: 0.6,
      maxHomopolymer: 2,
      maxHairpin: 1,
      maxSelfComplementarity: 5,
      maxThreePrime: 1,
    });
    expect(r.warnings).toEqual([
      'Shorter than 21 bases',
      'Tm below 57 °C',
      'GC content below 60%',
      'Run of 3 identical bases',
      'Hairpin with a 2 bp stem',
      'Self-complementary stretch of 6 bases',
      '3′ end pairs with itself over 2 bases',
    ]);
  });

  it('names every upper bound a plain primer goes past', () => {
    const r = analyzePrimer('GAATTCGCAAGGTACCAGGG', {
      ...DEFAULT_PRIMER_CRITERIA,
      maxLength: 19,
      maxTm: 56,
      maxGc: 0.5,
    });
    expect(r.warnings).toEqual(['Longer than 19 bases', 'Tm above 56 °C', 'GC content above 50%']);
  });

  it('warns of a missing GC clamp', () => {
    expect(analyzePrimer('GAATTCGCAAGGTACCAGGA').warnings).toEqual([
      'Tm below 55 °C',
      'No GC clamp at the 3′ end',
    ]);
  });

  it('gives an empty primer no GC content rather than none at all', () => {
    const r = analyzePrimer('');
    expect(r.gcRange).toEqual({ min: 0, max: 0 });
    expect(r.warnings).toEqual([
      'Shorter than 18 bases',
      'GC content below 35%',
      'No GC clamp at the 3′ end',
    ]);
  });
});

describe('analyzePrimer at the edges of a degenerate mix', () => {
  // Four molecules, Tm 50.8 to 56.0 °C and GC 45% to 55%.
  const primer = 'GATCGATCRYGATCGATCAG';
  const criteria = (over: Partial<PrimerCriteria>): PrimerCriteria => ({
    ...loose(),
    ...over,
  });

  it('passes a mix whose ends sit exactly on the bounds', () => {
    const r = analyzePrimer(primer, loose());
    expect(r.molecules).toBe(4);
    expect(r.gcRange).toEqual({ min: 0.45, max: 0.55 });
    expect(r.tmRange?.min).toBeCloseTo(50.8119, 4);
    expect(r.tmRange?.max).toBeCloseTo(56.0493, 4);
    expect(r.warnings).toEqual([]);
    const min = r.tmRange?.min ?? NaN;
    const max = r.tmRange?.max ?? NaN;
    const onBounds = criteria({ minTm: min, maxTm: max, minGc: 0.45, maxGc: 0.55 });
    expect(analyzePrimer(primer, onBounds).warnings).toEqual([]);
    // A bound on the far end of the mix leaves only part of it out.
    const crossed = criteria({ minTm: max, maxTm: min });
    expect(analyzePrimer(primer, crossed).warnings).toEqual([
      `Part of the mix has a Tm below ${max} °C`,
      `Part of the mix has a Tm above ${min} °C`,
    ]);
  });

  it('says when part of the mix is out of bounds on every side', () => {
    const r = analyzePrimer(primer, criteria({ minTm: 55, maxTm: 56, minGc: 0.5, maxGc: 0.5 }));
    expect(r.warnings).toEqual([
      'Part of the mix has a Tm below 55 °C',
      'Part of the mix has a Tm above 56 °C',
      'Part of the mix has GC content below 50%',
      'Part of the mix has GC content above 50%',
    ]);
  });

  it('says plainly when all of the mix is out of bounds', () => {
    expect(analyzePrimer(primer, criteria({ minTm: 57, maxGc: 0.4 })).warnings).toEqual([
      'Tm below 57 °C',
      'GC content above 40%',
    ]);
    expect(analyzePrimer(primer, criteria({ maxTm: 50, minGc: 0.6 })).warnings).toEqual([
      'Tm above 50 °C',
      'GC content below 60%',
    ]);
  });

  it('gives up on the Tm when the last code is the one too many', () => {
    const r = analyzePrimer(`GATCGATCGATC${'N'.repeat(7)}`, loose());
    expect(r.molecules).toBe(16_384);
    expect(r.tmRange).toBeNull();
    expect(Number.isNaN(r.tm)).toBe(true);
    expect(r.warnings).toEqual([
      'Too degenerate to give a Tm: 16,384 molecules',
      'No GC clamp at the 3′ end',
    ]);
  });
});

/** The designer's penalty for one primer, as documented on `designPrimers`. */
function primerPenalty(r: PrimerReport, c: PrimerCriteria): number {
  const idealLength = Math.min(c.maxLength, Math.max(c.minLength, 21));
  return (
    Math.abs(r.tm - (c.minTm + c.maxTm) / 2) +
    Math.abs(r.gc - (c.minGc + c.maxGc) / 2) * 10 +
    (r.gcClamp ? 0 : 1.5) +
    Math.max(0, r.selfComplementarity - 3) * 0.5 +
    Math.max(0, r.hairpin - 2) * 0.5 +
    r.threePrimeSelf * 0.3 +
    Math.abs(r.length - idealLength) * 0.1
  );
}

function meets(r: PrimerReport, c: PrimerCriteria): boolean {
  return (
    Number.isFinite(r.tm) &&
    r.tm >= c.minTm &&
    r.tm <= c.maxTm &&
    r.gc >= c.minGc &&
    r.gc <= c.maxGc &&
    r.homopolymer <= c.maxHomopolymer &&
    r.hairpin <= c.maxHairpin &&
    r.selfComplementarity <= c.maxSelfComplementarity &&
    r.threePrimeSelf <= c.maxThreePrime &&
    (!c.requireGcClamp || r.gcClamp)
  );
}

interface Expected {
  readonly penalty: number;
  readonly productLength: number;
  readonly tmDifference: number;
  readonly crossDimer: number;
}

/**
 * The lowest-penalty pairs under one key. Two pairs can tie exactly: in a run
 * of A's a longer, warmer primer and a shorter one come out at the same
 * penalty with different Tm differences, and either is the designer's right
 * answer for that key.
 */
interface Tied {
  readonly penalty: number;
  readonly pairs: readonly Expected[];
}

/**
 * Every pair the designer's rules allow, listed the slow way: each site of
 * each allowed length in each region, kept if it meets the criteria, paired
 * with every other. Keyed as the designer dedupes, by forward start and
 * reverse end, keeping the lowest penalty. Only right while no region holds
 * more candidates than the designer shortlists (40).
 */
function allPairs(
  seq: string,
  topology: Topology,
  target: Range,
  c: PrimerCriteria,
): Map<string, Tied> {
  const L = seq.length;
  const circular = topology === 'circular';
  const text = seq.toUpperCase();
  const at = (s: number, len: number): string => {
    let out = '';
    for (let i = s; i < s + len; i++) out += text.charAt(((i % L) + L) % L);
    return out;
  };
  const sites = (lo: number, hi: number, reverse: boolean) => {
    const out: { site: Range; report: PrimerReport; penalty: number }[] = [];
    for (let len = c.minLength; len <= c.maxLength; len++) {
      for (let s = lo; s + len <= hi; s++) {
        if (!circular && (s < 0 || s + len > L)) continue;
        const bases = at(s, len);
        const report = analyzePrimer(reverse ? reverseComplement(bases) : bases, c);
        if (!meets(report, c)) continue;
        const start = circular ? ((s % L) + L) % L : s;
        out.push({ site: { start, end: start + len }, report, penalty: primerPenalty(report, c) });
      }
    }
    return out;
  };
  const width = (r: { near: number; far: number }): number => Math.min(r.far - r.near, L);
  const fHi = target.start - c.forwardRegion.near;
  const rLo = target.end + c.reverseRegion.near;
  const forwards = sites(fHi - width(c.forwardRegion), fHi, false);
  const reverses = sites(rLo, rLo + width(c.reverseRegion), true);
  expect(forwards.length).toBeLessThan(40);
  expect(reverses.length).toBeLessThan(40);
  const out = new Map<string, Tied>();
  for (const f of forwards) {
    for (const r of reverses) {
      const tmDifference = Math.abs(f.report.tm - r.report.tm);
      if (tmDifference > c.maxTmDifference) continue;
      let productLength = r.site.end - f.site.start;
      if (circular && productLength <= 0) productLength += L;
      if (productLength < Math.max(f.report.length, r.report.length)) continue;
      if (circular && productLength > L) continue;
      if (productLength < c.minProduct || productLength > c.maxProduct) continue;
      const crossDimer = Math.max(
        threePrimeComplementarity(f.report.sequence, r.report.sequence),
        threePrimeComplementarity(r.report.sequence, f.report.sequence),
      );
      if (crossDimer > c.maxThreePrime) continue;
      const penalty = f.penalty + r.penalty + tmDifference + crossDimer * 0.3;
      const key = `${f.site.start}-${r.site.end}`;
      const pair = { penalty, productLength, tmDifference, crossDimer };
      const kept = out.get(key);
      if (kept === undefined || penalty < kept.penalty) {
        out.set(key, { penalty, pairs: [pair] });
      } else if (penalty === kept.penalty) {
        out.set(key, { penalty, pairs: [...kept.pairs, pair] });
      }
    }
  }
  return out;
}

function expectAllPairs(
  seq: string,
  topology: Topology,
  target: Range,
  c: PrimerCriteria,
): PrimerPair[] {
  const expected = allPairs(seq, topology, target, c);
  const pairs = designPrimers(seq, topology, target, { ...c, maxPairs: 100_000 });
  const keys = pairs.map((p) => `${p.forwardSite.start}-${p.reverseSite.end}`);
  expect(new Set(keys).size).toBe(keys.length);
  expect([...keys].sort()).toEqual([...expected.keys()].sort());
  for (const [i, p] of pairs.entries()) {
    const tied = expected.get(keys[i] ?? '');
    expect(p.penalty).toBeCloseTo(tied?.penalty ?? NaN, 9);
    // Where pairs tie on penalty under this key, the designer's is one of them.
    const e =
      tied?.pairs.find((t) => Math.abs(t.tmDifference - p.tmDifference) < 1e-9) ?? tied?.pairs[0];
    expect(p.productLength).toBe(e?.productLength);
    expect(p.crossDimer).toBe(e?.crossDimer);
    expect(p.tmDifference).toBeCloseTo(e?.tmDifference ?? NaN, 9);
    expect(p.tmDifference).toBeCloseTo(Math.abs(p.forward.tm - p.reverse.tm), 9);
    if (i > 0) expect(p.penalty).toBeGreaterThanOrEqual(pairs[i - 1]?.penalty ?? Infinity);
  }
  return pairs;
}

describe('designPrimers against every pair its rules allow', () => {
  it('matches a slow listing on short random templates and criteria', () => {
    const scenario = fc
      .record({
        // Now and then an N, which no designed primer may cover.
        seq: fc
          .tuple(
            fc.array(fc.constantFrom('A', 'C', 'G', 'T'), { minLength: 80, maxLength: 140 }),
            fc.oneof(
              { arbitrary: fc.constant(null), weight: 3 },
              { arbitrary: fc.nat(), weight: 1 },
            ),
          )
          .map(([bases, n]) => {
            const text = bases.join('');
            if (n === null) return text;
            const at = n % text.length;
            return `${text.slice(0, at)}N${text.slice(at + 1)}`;
          }),
        circular: fc.boolean(),
        start: fc.double({ min: 0, max: 1, noNaN: true }),
        size: fc.integer({ min: 1, max: 20 }),
        minLength: fc.integer({ min: 10, max: 20 }),
        extraLength: fc.integer({ min: 0, max: 2 }),
        fNear: fc.integer({ min: -10, max: 20 }),
        fWidth: fc.integer({ min: -3, max: 12 }),
        rNear: fc.integer({ min: -10, max: 20 }),
        rWidth: fc.integer({ min: -3, max: 12 }),
        tmBelow: fc.integer({ min: 0, max: 10 }),
        tmWidth: fc.integer({ min: 20, max: 60 }),
        minGc: fc.constantFrom(0, 0.2, 0.3, 0.4),
        gcWidth: fc.constantFrom(0.2, 0.3, 0.4, 0.6, 1),
        maxHomopolymer: fc.oneof(fc.integer({ min: 3, max: 8 }), fc.constant(100)),
        maxHairpin: fc.oneof(fc.integer({ min: 2, max: 10 }), fc.constant(100)),
        maxSelfComplementarity: fc.oneof(fc.integer({ min: 4, max: 14 }), fc.constant(100)),
        maxThreePrime: fc.oneof(fc.integer({ min: 2, max: 25 }), fc.constant(100)),
        requireGcClamp: fc.boolean(),
        maxTmDifference: fc.oneof(fc.integer({ min: 2, max: 40 }), fc.constant(100)),
        minProduct: fc.integer({ min: 0, max: 30 }),
        productWidth: fc.integer({ min: 20, max: 200 }),
      })
      .map((s) => {
        const L = s.seq.length;
        // On a line, mostly with room on both sides; anywhere on a circle.
        const start = s.circular
          ? Math.floor(s.start * L)
          : Math.floor(35 + s.start * (L - 70 - s.size));
        const end = s.circular ? start + s.size : Math.min(L, start + s.size);
        const minLength = s.minLength;
        const c: PrimerCriteria = {
          ...DEFAULT_PRIMER_CRITERIA,
          minLength,
          maxLength: minLength + s.extraLength,
          // About the Tm of a random primer of that length, give or take.
          minTm: Math.round(2.7 * minLength) - 14 - s.tmBelow,
          maxTm: Math.round(2.7 * minLength) - 14 - s.tmBelow + s.tmWidth,
          minGc: s.minGc,
          maxGc: Math.min(1, s.minGc + s.gcWidth),
          // At most 13 sites of the shortest length, so under 40 in all.
          forwardRegion: { near: s.fNear, far: s.fNear + minLength + s.fWidth },
          reverseRegion: { near: s.rNear, far: s.rNear + minLength + s.rWidth },
          maxHomopolymer: s.maxHomopolymer,
          maxHairpin: s.maxHairpin,
          maxSelfComplementarity: s.maxSelfComplementarity,
          maxThreePrime: s.maxThreePrime,
          requireGcClamp: s.requireGcClamp,
          maxTmDifference: s.maxTmDifference,
          minProduct: s.minProduct,
          maxProduct: s.minProduct + s.productWidth,
          requireSpecific: false,
        };
        const topology: Topology = s.circular ? 'circular' : 'linear';
        return { seq: s.seq, topology, target: { start, end }, c };
      })
      .filter((s) => s.target.end > s.target.start);
    let designed = 0;
    fc.assert(
      fc.property(scenario, ({ seq, topology, target, c }) => {
        if (expectAllPairs(seq, topology, target, c).length > 0) designed++;
      }),
      { numRuns: 600 },
    );
    // Not a vacuous agreement on nothing.
    expect(designed).toBeGreaterThan(80);
  });

  it('pairs primers that lie on top of each other, but not past each other', () => {
    const seq = template();
    // Both primers within 300..320; one covering the other's span primes it.
    const c: PrimerCriteria = {
      ...loose(),
      minLength: 18,
      maxLength: 20,
      forwardRegion: { near: -20, far: 0 },
      reverseRegion: { near: -20, far: 0 },
    };
    const pairs = expectAllPairs(seq, 'linear', { start: 300, end: 320 }, c);
    expect(pairs.some((p) => p.productLength === 20)).toBe(true);
    for (const p of pairs) {
      expect(p.productLength).toBeGreaterThanOrEqual(Math.max(p.forward.length, p.reverse.length));
    }
  });

  it('reaches the ends of a linear template and wraps a circular one', () => {
    const seq = template().slice(0, 80);
    const c: PrimerCriteria = { ...loose(), minLength: 18, maxLength: 19 };
    // On a line, a primer at either end can only pair with one lying on it.
    const onTop = {
      ...c,
      forwardRegion: { near: -18, far: 0 },
      reverseRegion: { near: -18, far: 0 },
    };
    const atEnd = expectAllPairs(seq, 'linear', { start: 62, end: 80 }, onTop);
    expect(atEnd.some((p) => p.forwardSite.end === 80 && p.reverseSite.end === 80)).toBe(true);
    const atStart = expectAllPairs(seq, 'linear', { start: 0, end: 18 }, onTop);
    expect(atStart.some((p) => p.forwardSite.start === 0 && p.reverseSite.start === 0)).toBe(true);
    for (const p of [...atEnd, ...atStart]) {
      expect(p.forwardSite.start).toBeGreaterThanOrEqual(0);
      expect(p.reverseSite.end).toBeLessThanOrEqual(80);
    }
    // On a circle either primer may lie across the origin.
    const flanking = {
      ...c,
      forwardRegion: { near: 0, far: 20 },
      reverseRegion: { near: 0, far: 20 },
    };
    const reverseAcross = expectAllPairs(seq, 'circular', { start: 70, end: 76 }, flanking);
    expect(reverseAcross.some((p) => p.reverseSite.end > 80)).toBe(true);
    const forwardAcross = expectAllPairs(seq, 'circular', { start: 4, end: 10 }, flanking);
    expect(forwardAcross.some((p) => p.forwardSite.end > 80)).toBe(true);
    const reverseBefore = expectAllPairs(
      seq,
      'circular',
      { start: 2, end: 5 },
      {
        ...c,
        forwardRegion: { near: 0, far: 20 },
        reverseRegion: { near: -20, far: 0 },
      },
    );
    expect(reverseBefore.some((p) => p.reverseSite.start >= 60)).toBe(true);
    // A reverse primer past the end of a line is no primer at all.
    const pastEnd = expectAllPairs(
      seq,
      'linear',
      { start: 50, end: 60 },
      {
        ...c,
        forwardRegion: { near: 0, far: 20 },
        reverseRegion: { near: 0, far: 30 },
      },
    );
    expect(pastEnd.length).toBeGreaterThan(0);
    // From 0..20 to a reverse primer across the origin is round the circle
    // and further, 86 bp or more; only one wholly past the origin pairs.
    const around = expectAllPairs(
      seq,
      'circular',
      { start: 25, end: 70 },
      { ...c, forwardRegion: { near: 5, far: 25 }, reverseRegion: { near: 0, far: 30 } },
    );
    expect(around.length).toBeGreaterThan(0);
    for (const p of around) expect(p.productLength).toBeLessThanOrEqual(80);
  });
});

describe('designPrimers on the fixed template', () => {
  it('ranks the same best pairs, and returns no more than asked for', () => {
    const seq = template();
    const pairs = designPrimers(seq, 'linear', { start: 250, end: 350 }, { maxPairs: 3 });
    expect(pairs).toHaveLength(3);
    expect(pairs.map((p) => [p.forwardSite, p.reverseSite, p.productLength, p.crossDimer])).toEqual(
      [
        [{ start: 57, end: 79 }, { start: 351, end: 373 }, 316, 2],
        [{ start: 56, end: 79 }, { start: 351, end: 375 }, 319, 2],
        [{ start: 88, end: 114 }, { start: 351, end: 375 }, 287, 3],
      ],
    );
    expect(pairs.map((p) => p.penalty)).toEqual([
      expect.closeTo(3.819201847907706, 9),
      expect.closeTo(3.856521134770743, 9),
      expect.closeTo(3.9026343004093635, 9),
    ]);
    expect(pairs.map((p) => p.tmDifference)).toEqual([
      expect.closeTo(0.26272037452315544, 9),
      expect.closeTo(0.018247765006776717, 9),
      expect.closeTo(0.10376395755417889, 9),
    ]);
  });

  it('keeps a pair whose every measure sits exactly on a bound', () => {
    const seq = template();
    const target = { start: 250, end: 350 };
    const [best] = designPrimers(seq, 'linear', target, { maxPairs: 1 });
    if (best === undefined) throw new Error('no pair');
    const f = best.forward;
    const r = best.reverse;
    const pairs = designPrimers(seq, 'linear', target, {
      minLength: Math.min(f.length, r.length),
      maxLength: Math.max(f.length, r.length),
      minTm: Math.min(f.tm, r.tm),
      maxTm: Math.max(f.tm, r.tm),
      minGc: Math.min(f.gc, r.gc),
      maxGc: Math.max(f.gc, r.gc),
      maxHomopolymer: Math.max(f.homopolymer, r.homopolymer),
      maxHairpin: Math.max(f.hairpin, r.hairpin),
      maxSelfComplementarity: Math.max(f.selfComplementarity, r.selfComplementarity),
      maxThreePrime: Math.max(f.threePrimeSelf, r.threePrimeSelf, best.crossDimer),
      maxTmDifference: best.tmDifference,
      minProduct: best.productLength,
      maxProduct: best.productLength,
      forwardRegion: {
        near: target.start - best.forwardSite.end,
        far: target.start - best.forwardSite.start,
      },
      reverseRegion: {
        near: best.reverseSite.start - target.end,
        far: best.reverseSite.end - target.end,
      },
      maxPairs: 100,
    });
    expect(pairs.map((p) => [p.forwardSite, p.reverseSite])).toContainEqual([
      best.forwardSite,
      best.reverseSite,
    ]);
  });

  it('shortlists the 40 best of each primer, specific or not', () => {
    const seq = template();
    const c: PrimerCriteria = {
      ...DEFAULT_PRIMER_CRITERIA,
      minLength: 22,
      maxLength: 22,
      minTm: 50,
      maxTm: 70,
      maxTmDifference: 100,
      maxThreePrime: 22,
    };
    // The 40 lowest penalties among the sites of each region.
    const best = (from: number, to: number, reverse: boolean): number[] => {
      const scored: [number, number][] = [];
      for (let s = from; s + 22 <= to; s++) {
        const bases = seq.slice(s, s + 22);
        const r = analyzePrimer(reverse ? reverseComplement(bases) : bases, c);
        if (meets(r, c)) scored.push([primerPenalty(r, c), s]);
      }
      return scored
        .sort((a, b) => a[0] - b[0])
        .slice(0, 40)
        .map(([, s]) => s)
        .sort((a, b) => a - b);
    };
    const starts = (xs: number[]): number[] => [...new Set(xs)].sort((a, b) => a - b);
    for (const requireSpecific of [false, true]) {
      const pairs = designPrimers(
        seq,
        'linear',
        { start: 250, end: 350 },
        { ...c, requireSpecific, maxPairs: 100_000 },
      );
      expect(pairs).toHaveLength(1600);
      const forwards = starts(pairs.map((p) => p.forwardSite.start));
      const reverses = starts(pairs.map((p) => p.reverseSite.start));
      expect(forwards).toHaveLength(40);
      expect(reverses).toHaveLength(40);
      if (!requireSpecific) {
        expect(forwards).toEqual(best(50, 250, false));
        expect(reverses).toEqual(best(350, 550, true));
      }
    }
  });

  it('designs nothing for an empty or backwards target', () => {
    const seq = template();
    expect(designPrimers(seq, 'linear', { start: 300, end: 300 })).toEqual([]);
    expect(designPrimers(seq, 'linear', { start: 300, end: 250 })).toEqual([]);
    expect(designPrimers(seq, 'circular', { start: 300, end: 300 })).toEqual([]);
  });
});

describe('findPrimerBindingSites at its edges', () => {
  it('finds a primer as long as the molecule, and none longer', () => {
    const seq = template().slice(0, 40);
    const rotated = seq.slice(10) + seq.slice(0, 10);
    expect(findPrimerBindingSites(seq, 'circular', rotated)).toEqual([
      { range: { start: 10, end: 50 }, strand: 'forward', mismatches: 0 },
    ]);
    expect(findPrimerBindingSites(seq, 'linear', seq)).toEqual([
      { range: { start: 0, end: 40 }, strand: 'forward', mismatches: 0 },
    ]);
    expect(findPrimerBindingSites(seq, 'circular', rotated + seq.slice(10, 15))).toEqual([]);
  });

  it('lists a site at the origin of a circle once', () => {
    const seq = template();
    expect(findPrimerBindingSites(seq, 'circular', seq.slice(0, 20))).toEqual([
      { range: { start: 0, end: 20 }, strand: 'forward', mismatches: 0 },
    ]);
  });

  it('finds no site hanging off the end of a linear template', () => {
    const seq = template();
    // Its 5′ two bases would lie past the end, where a mismatch is allowed.
    expect(findPrimerBindingSites(seq, 'linear', reverseComplement(`${seq.slice(582)}AA`))).toEqual(
      [],
    );
  });

  it('compares each primer base with the template base under it', () => {
    const seq = `${'C'.repeat(30)}${'A'.repeat(30)}`;
    expect(findPrimerBindingSites(seq, 'linear', `${'A'.repeat(15)}CCCCC`)).toEqual([]);
  });

  it('anchors the last five bases at the 3′ end of either strand', () => {
    const seq = template();
    const swap = (s: string, i: number): string =>
      s.slice(0, i) + (s.charAt(i) === 'A' ? 'C' : 'A') + s.slice(i + 1);
    const fwd = seq.slice(100, 120);
    const at100 = (primer: string) =>
      findPrimerBindingSites(seq, 'linear', primer).filter((s) => s.range.start === 100);
    // Index 15 is the fifth base from the 3′ end, index 14 the sixth.
    expect(at100(swap(fwd, 15))).toEqual([]);
    expect(at100(swap(fwd, 14))).toEqual([
      { range: { start: 100, end: 120 }, strand: 'forward', mismatches: 1 },
    ]);
    expect(at100(swap(swap(fwd, 0), 1))).toEqual([
      { range: { start: 100, end: 120 }, strand: 'forward', mismatches: 2 },
    ]);
    expect(at100(swap(swap(swap(fwd, 0), 1), 2))).toEqual([]);
    // A reverse primer's 3′ end is the left end of its site.
    const rev = reverseComplement(seq.slice(300, 322));
    const at300 = (primer: string) =>
      findPrimerBindingSites(seq, 'linear', primer).filter((s) => s.range.start === 300);
    expect(at300(swap(rev, 0))).toEqual([
      { range: { start: 300, end: 322 }, strand: 'reverse', mismatches: 1 },
    ]);
    expect(at300(swap(rev, 21))).toEqual([]);
  });

  it('lists sites on both strands in template order', () => {
    const seq = template();
    const x = seq.slice(100, 120);
    const t =
      seq.slice(300, 350) +
      reverseComplement(x) +
      seq.slice(400, 430) +
      x +
      seq.slice(450, 530) +
      x +
      seq.slice(530, 580);
    expect(findPrimerBindingSites(t, 'linear', x)).toEqual([
      { range: { start: 50, end: 70 }, strand: 'reverse', mismatches: 0 },
      { range: { start: 100, end: 120 }, strand: 'forward', mismatches: 0 },
      { range: { start: 200, end: 220 }, strand: 'forward', mismatches: 0 },
    ]);
  });
});
