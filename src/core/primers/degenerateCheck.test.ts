import fc from 'fast-check';

import { randomDna, seededRandom } from '@/test/random';

import { IUPAC_SETS } from '../analysis/codons';
import { reverseComplement } from '../sequence';
import { MAX_MOLECULES, analyzePrimer, findPrimerBindingSites } from './primerDesign';
import { meltingTemperature } from './thermo';

/**
 * The Primers tab's check of a pasted degenerate primer (#76), against
 * oracles that list the mix outright: every molecule a code stands for, its
 * Tm and GC content, and where each molecule binds. Before, the check dropped
 * the codes and measured an oligo nobody ordered.
 */

const CODES = ['A', 'C', 'G', 'T', 'R', 'Y', 'S', 'W', 'K', 'M', 'B', 'D', 'H', 'V', 'N'];

/** Every molecule of the mix, listed the naive way. */
function mix(primer: string): string[] {
  let out = [''];
  for (const code of primer) {
    const bases = IUPAC_SETS[code] ?? [];
    out = out.flatMap((p) => bases.map((b) => p + b));
  }
  return out;
}

const gcOf = (s: string): number =>
  Array.from(s).filter((b) => b === 'G' || b === 'C').length / s.length;

const primerArb = fc
  .array(fc.constantFrom(...CODES), { minLength: 12, maxLength: 24 })
  .filter((a) => a.filter((c) => !'ACGT'.includes(c)).length <= 4)
  .map((a) => a.join(''));

describe('analyzePrimer on a degenerate primer', () => {
  it('gives the Tm and GC ranges of the mix, and no single Tm', () => {
    fc.assert(
      fc.property(primerArb, (primer) => {
        const report = analyzePrimer(primer);
        const molecules = mix(primer);
        expect(report.sequence).toBe(primer);
        expect(report.molecules).toBe(molecules.length);
        expect(report.gcRange.min).toBeCloseTo(Math.min(...molecules.map(gcOf)), 9);
        expect(report.gcRange.max).toBeCloseTo(Math.max(...molecules.map(gcOf)), 9);
        const tms = molecules.map((m) => meltingTemperature(m));
        if (report.degenerate === 0) {
          expect(report.tmRange).toBeNull();
          expect(report.tm).toBeCloseTo(meltingTemperature(primer), 9);
        } else {
          expect(Number.isNaN(report.tm)).toBe(true);
          expect(report.tmRange?.min).toBeCloseTo(Math.min(...tms), 9);
          expect(report.tmRange?.max).toBeCloseTo(Math.max(...tms), 9);
        }
      }),
      { numRuns: 200 },
    );
  });

  it('keeps the codes in place rather than joining their neighbours', () => {
    const report = analyzePrimer('acgtNNKgatcgatcgatc');
    expect(report.sequence).toBe('ACGTNNKGATCGATCGATC');
    expect(report.length).toBe(19);
    expect(report.degenerate).toBe(3);
    expect(report.molecules).toBe(32);
  });

  it('lists up to 4,096 molecules and says when there are more', () => {
    const six = `ACGTACGT${'N'.repeat(6)}GATCGATC`;
    expect(analyzePrimer(six).molecules).toBe(MAX_MOLECULES);
    expect(analyzePrimer(six).tmRange).not.toBeNull();
    const seven = `ACGTACGT${'N'.repeat(7)}GATCGATC`;
    const report = analyzePrimer(seven);
    expect(report.tmRange).toBeNull();
    expect(report.warnings).toContain('Too degenerate to give a Tm: 16,384 molecules');
  });

  it('warns when all of the mix is out of bounds, and says so when only part is', () => {
    // Ten S: every molecule is 50% GC, inside the bounds.
    expect(
      analyzePrimer(`${'AT'.repeat(5)}${'S'.repeat(10)}`).warnings.filter((w) => w.includes('GC')),
    ).toEqual([]);
    // One S in twenty: every molecule is 5% GC, all of the mix below 35%.
    expect(analyzePrimer(`${'AT'.repeat(9)}AS`).warnings).toContain('GC content below 35%');
    // Four S and four N in twenty: 20% to 40%, part of the mix below 35%.
    const straddle = `${'AT'.repeat(6)}SSSSNNNN`;
    expect(analyzePrimer(straddle).gcRange).toEqual({ min: 0.2, max: 0.4 });
    expect(analyzePrimer(straddle).warnings).toContain('Part of the mix has GC content below 35%');
  });

  it('counts an S at the 3′ end as a GC clamp, and an N not', () => {
    expect(analyzePrimer('ACGTACGTACGTACGTAS').gcClamp).toBe(true);
    expect(analyzePrimer('ACGTACGTACGTACGTAN').gcClamp).toBe(false);
  });
});

describe('findPrimerBindingSites with a degenerate primer', () => {
  const template = randomDna(seededRandom(76), 600);

  /** Where some molecule of the mix binds, by the same rule as a plain primer. */
  function oracle(primer: string): string[] {
    const found = new Set<string>();
    for (const molecule of mix(primer)) {
      for (const s of findPrimerBindingSites(template, 'linear', molecule)) {
        if (s.mismatches === 0) found.add(`${s.strand}:${s.range.start}`);
      }
    }
    return [...found].sort();
  }

  it('binds exactly where some molecule of the mix binds exactly', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 600 - 20 }),
        fc.boolean(),
        fc.array(fc.integer({ min: 0, max: 19 }), { minLength: 1, maxLength: 2 }),
        (at, reverse, positions) => {
          const site = template.slice(at, at + 20);
          const plain = reverse ? reverseComplement(site) : site;
          // Replace some positions with a code that covers the base there.
          const primer = Array.from(plain)
            .map((b, i) =>
              positions.includes(i) ? ({ A: 'R', G: 'R', C: 'Y', T: 'Y' }[b] ?? b) : b,
            )
            .join('');
          const exact = findPrimerBindingSites(template, 'linear', primer)
            .filter((s) => s.mismatches === 0)
            .map((s) => `${s.strand}:${s.range.start}`)
            .sort();
          expect(exact).toEqual(oracle(primer));
          expect(exact).toContain(`${reverse ? 'reverse' : 'forward'}:${at}`);
        },
      ),
      { numRuns: 60 },
    );
  }, 30_000);

  it('does not bind a code where it does not stand for the template base', () => {
    const site = template.slice(300, 320);
    const b = site.charAt(8);
    const wrong = { A: 'Y', G: 'Y', C: 'R', T: 'R' }[b] ?? 'N';
    const primer = site.slice(0, 8) + wrong + site.slice(9);
    const [hit] = findPrimerBindingSites(template, 'linear', primer).filter(
      (s) => s.range.start === 300 && s.strand === 'forward',
    );
    expect(hit?.mismatches).toBe(1);
  });
});
