import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { randomDna, seededRandom } from '@/test/random';

import { reverseComplement } from '../sequence';
import { DEFAULT_PRIMER_CRITERIA, type PrimerCriteria } from './criteria';
import { analyzePrimer, designAnchoredPrimers, type PrimerReport } from './primerDesign';
import { dimerEnergy } from './structure';
import { threePrimeComplementarity } from './thermo';

/**
 * Anchored primers (item 108): the forward one starts at the insert's
 * first base and the reverse one ends at its last, held to the designer's
 * criteria where any length meets them.
 */
describe('designAnchoredPrimers', () => {
  it('anchors both primers at the ends and stays within the criteria when it can', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 0x7fffffff }),
        fc.integer({ min: 60, max: 400 }),
        (seed, length) => {
          const insert = randomDna(seededRandom(seed), length);
          const pair = designAnchoredPrimers(insert);
          expect(pair).not.toBeNull();
          if (pair === null) return;
          const c = DEFAULT_PRIMER_CRITERIA;
          expect(insert.startsWith(pair.forward.sequence)).toBe(true);
          expect(insert.endsWith(reverseComplement(pair.reverse.sequence))).toBe(true);
          for (const p of [pair.forward, pair.reverse]) {
            expect(p.length).toBeGreaterThanOrEqual(c.minLength);
            expect(p.length).toBeLessThanOrEqual(Math.min(c.maxLength, Math.floor(length / 2)));
            expect(p).toEqual(analyzePrimer(p.sequence, c));
          }
          if (pair.withinCriteria) {
            // The clamp is preferred, not required, so it is the one warning a passing primer may carry.
            const broken = (w: readonly string[]): string[] =>
              w.filter((x) => !x.includes('GC clamp'));
            expect(broken(pair.forward.warnings)).toEqual([]);
            expect(broken(pair.reverse.warnings)).toEqual([]);
            expect(pair.tmDifference).toBeLessThanOrEqual(c.maxTmDifference);
            expect(pair.crossDimer).toBeLessThanOrEqual(c.maxThreePrime);
            expect(Number.isFinite(pair.penalty)).toBe(true);
          } else {
            expect(pair.penalty).toBe(Infinity);
          }
        },
      ),
      { numRuns: 60 },
    );
  });

  it('is null for an insert too short for two primers', () => {
    expect(designAnchoredPrimers(randomDna(seededRandom(1), 35))).toBeNull();
    expect(designAnchoredPrimers(randomDna(seededRandom(1), 36))).not.toBeNull();
    expect(designAnchoredPrimers('ACGTACGTACGTACGTACGTACGT', { minLength: 12 })).not.toBeNull();
  });

  it('falls back to the least bad ends and says what they break', () => {
    // All A and T: no length reaches the Tm range.
    const pair = designAnchoredPrimers('AT'.repeat(60));
    expect(pair?.withinCriteria).toBe(false);
    expect(pair?.forward.warnings.length).toBeGreaterThan(0);
  });
});

/**
 * An independent restatement of the designer's rules, to pick the pair the
 * slow way: every forward length against every reverse length.
 */
function penaltyOf(r: PrimerReport, c: PrimerCriteria): number | null {
  if (Number.isNaN(r.tm) || r.tm < c.minTm || r.tm > c.maxTm) return null;
  if (r.gc < c.minGc || r.gc > c.maxGc) return null;
  if (r.homopolymer > c.maxHomopolymer || r.hairpinDg <= c.hairpinDg || r.hairpinTm > c.hairpinTm) return null;
  if (r.selfDimerDg <= c.dimerDg) return null;
  if (r.threePrimeSelf > c.maxThreePrime) return null;
  if (c.requireGcClamp && !r.gcClamp) return null;
  const idealLength = Math.min(c.maxLength, Math.max(c.minLength, 21));
  return (
    Math.abs(r.tm - (c.minTm + c.maxTm) / 2) +
    Math.abs(r.gc - (c.minGc + c.maxGc) / 2) * 10 +
    (r.gcClamp ? 0 : 1.5) +
    -r.selfDimerDg * 0.25 +
    -r.hairpinDg * 0.5 +
    r.threePrimeSelf * 0.3 +
    Math.abs(r.length - idealLength) * 0.1
  );
}

function ends(insert: string, c: PrimerCriteria): { f: PrimerReport[]; r: PrimerReport[] } {
  const longest = Math.min(c.maxLength, Math.floor(insert.length / 2));
  const f: PrimerReport[] = [];
  const r: PrimerReport[] = [];
  for (let n = c.minLength; n <= longest; n++) {
    f.push(analyzePrimer(insert.slice(0, n), c));
    r.push(analyzePrimer(reverseComplement(insert.slice(insert.length - n)), c));
  }
  return { f, r };
}

const dimerOf = (a: PrimerReport, b: PrimerReport): number =>
  Math.max(
    threePrimeComplementarity(a.sequence, b.sequence),
    threePrimeComplementarity(b.sequence, a.sequence),
  );

describe('designAnchoredPrimers against the slow way', () => {
  const settings: Partial<PrimerCriteria>[] = [
    {},
    { maxTmDifference: 1 },
    { maxTmDifference: 3, maxThreePrime: 2 },
    { maxThreePrime: 1, requireGcClamp: false },
    { minLength: 15, maxLength: 24, minTm: 52, maxTm: 66 },
  ];

  it('picks the lowest-penalty pair that passes every pairing rule, and says how it scored', () => {
    for (const [i, options] of settings.entries()) {
      for (let seed = 1; seed <= 12; seed++) {
        const insert = randomDna(seededRandom(seed * 31 + i), 70 + seed * 20);
        const c = { ...DEFAULT_PRIMER_CRITERIA, ...options };
        const { f, r } = ends(insert, c);
        let want: { f: PrimerReport; r: PrimerReport; penalty: number } | null = null;
        for (const a of f) {
          for (const b of r) {
            const pa = penaltyOf(a, c);
            const pb = penaltyOf(b, c);
            if (pa === null || pb === null) continue;
            const diff = Math.abs(a.tm - b.tm);
            const dimer = dimerOf(a, b);
            if (diff > c.maxTmDifference || dimer > c.maxThreePrime) continue;
            if (dimerEnergy(a.sequence, b.sequence) <= c.dimerDg) continue;
            const penalty = pa + pb + diff + dimer * 0.3;
            if (want === null || penalty < want.penalty) want = { f: a, r: b, penalty };
          }
        }
        const got = designAnchoredPrimers(insert, options);
        expect(got?.withinCriteria).toBe(want !== null);
        if (want === null || got === null) continue;
        expect(got.forward.sequence).toBe(want.f.sequence);
        expect(got.reverse.sequence).toBe(want.r.sequence);
        expect(got.penalty).toBeCloseTo(want.penalty, 9);
        expect(got.tmDifference).toBeCloseTo(Math.abs(want.f.tm - want.r.tm), 9);
        expect(got.crossDimer).toBe(dimerOf(want.f, want.r));
      }
    }
  });

  it('takes a pair at exactly the Tm difference and cross-dimer limit', () => {
    for (let seed = 1; seed <= 12; seed++) {
      const insert = randomDna(seededRandom(seed + 500), 120);
      const first = designAnchoredPrimers(insert);
      if (!first?.withinCriteria) continue;
      const tight = designAnchoredPrimers(insert, {
        maxTmDifference: first.tmDifference,
        maxThreePrime: Math.max(
          first.crossDimer,
          first.forward.threePrimeSelf,
          first.reverse.threePrimeSelf,
        ),
      });
      expect(tight?.withinCriteria).toBe(true);
      expect(tight?.penalty).toBeCloseTo(first.penalty, 9);
    }
  });

  it('is case-blind, and reports uppercase primers', () => {
    const insert = randomDna(seededRandom(7), 100);
    const upper = designAnchoredPrimers(insert.toUpperCase());
    const lower = designAnchoredPrimers(insert.toLowerCase());
    expect(lower).toEqual(upper);
    expect(lower?.forward.sequence).toBe(lower?.forward.sequence.toUpperCase());
  });

  it('with nothing passing, gives per side the end that breaks fewest criteria, then nearest the Tm middle', () => {
    for (let seed = 1; seed <= 25; seed++) {
      const insert = randomDna(seededRandom(seed + 900), 60 + seed * 8);
      // A negative limit no pair can meet, so only the fallback runs.
      const c = { ...DEFAULT_PRIMER_CRITERIA, maxTmDifference: -1 };
      const ideal = (c.minTm + c.maxTm) / 2;
      const distance = (p: PrimerReport): number =>
        Number.isNaN(p.tm) ? Infinity : Math.abs(p.tm - ideal);
      const least = (list: PrimerReport[]): PrimerReport => {
        let best = list.reduce((a) => a);
        for (const p of list) {
          if (
            p.warnings.length < best.warnings.length ||
            (p.warnings.length === best.warnings.length && distance(p) < distance(best))
          )
            best = p;
        }
        return best;
      };
      const { f, r } = ends(insert, c);
      const got = designAnchoredPrimers(insert, { maxTmDifference: -1 });
      expect(got?.withinCriteria).toBe(false);
      expect(got?.forward.sequence).toBe(least(f).sequence);
      expect(got?.reverse.sequence).toBe(least(r).sequence);
      expect(got?.penalty).toBe(Infinity);
      expect(got?.tmDifference).toBeCloseTo(Math.abs(least(f).tm - least(r).tm), 9);
      expect(got?.crossDimer).toBe(dimerOf(least(f), least(r)));
    }
  });

  it('uses the Tm range the settings give for the fallback middle', () => {
    // Settings whose middle moves the choice: a low range prefers short primers.
    const insert = randomDna(seededRandom(3), 120);
    const low = designAnchoredPrimers(insert, { minTm: 20, maxTm: 30, maxTmDifference: -1 });
    const high = designAnchoredPrimers(insert, { minTm: 80, maxTm: 90, maxTmDifference: -1 });
    expect(low?.forward.length).toBeLessThan(high?.forward.length ?? 0);
  });
});
