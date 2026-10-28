import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { randomDna, seededRandom } from '@/test/random';

import { reverseComplement } from '../sequence';
import { DEFAULT_PRIMER_CRITERIA } from './criteria';
import { analyzePrimer, designAnchoredPrimers } from './primerDesign';

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
