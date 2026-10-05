import { meltingTemperature, q5MeltingTemperature } from '@/core/primers/thermo';

import oracle from './thermo.json';

/**
 * Melting temperatures against primer3-py and Biopython
 * (scripts/oracle/thermo.py). meltingTemperature is SantaLucia 1998 with
 * SantaLucia's salt correction (primer3's calc_tm with those methods) over
 * five salt and primer concentrations; q5MeltingTemperature is Biopython's
 * Tm_NN at 500 nM primer and 150 mM sodium with the Owczarzy 2004 correction,
 * self-complementary primers with its symmetry term (issue #140).
 */

interface Row {
  readonly seq: string;
  readonly tm: readonly number[];
  readonly q5?: number;
}

const rows = oracle.rows as readonly Row[];
const TOLERANCE = 0.01;

describe('melting temperature against primer3-py and Biopython', () => {
  it('meltingTemperature agrees with primer3 under every condition', () => {
    const problems: string[] = [];
    for (const row of rows) {
      oracle.conditions.forEach((conditions, i) => {
        const expected = row.tm[i] ?? NaN;
        const ours = meltingTemperature(row.seq, conditions);
        if (!(Math.abs(ours - expected) <= TOLERANCE)) {
          problems.push(
            `${row.seq} ${JSON.stringify(conditions)}: ${ours.toFixed(3)} vs ${expected}`,
          );
        }
      });
    }
    expect(problems).toEqual([]);
  });

  it('q5MeltingTemperature agrees with Biopython', () => {
    const problems: string[] = [];
    let compared = 0;
    for (const row of rows) {
      if (row.q5 === undefined) continue;
      compared++;
      const ours = q5MeltingTemperature(row.seq);
      if (!(Math.abs(ours - row.q5) <= TOLERANCE)) {
        problems.push(`${row.seq}: ${ours.toFixed(3)} vs ${row.q5}`);
      }
    }
    expect(compared).toBeGreaterThan(150);
    expect(problems).toEqual([]);
  });
});
