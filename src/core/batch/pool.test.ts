import { reverseComplement } from '../sequence';
import { DEFAULT_DIMER_DG, dimerEnergy } from '../primers';

import { checkPool, crossDimers, duplicateNames, sameBases, tmSpread } from './pool';

const A = 'ACGTAGCTAGGATCCATTGCAAGT';
const B = 'TTGACCAGTCAGGTACCAGTGACT';

describe('duplicate names', () => {
  it('finds a name used twice, without regard to case', () => {
    const found = duplicateNames([
      { name: 'geneA_F', sequence: A },
      { name: 'geneA_R', sequence: B },
      { name: 'GENEA_f', sequence: 'CCCCGGGGAAAATTTTCCGG' },
    ]);
    expect(found).toEqual([{ name: 'geneA_F', indexes: [0, 2] }]);
  });

  it('finds none in a pool of distinct names', () => {
    expect(
      duplicateNames([
        { name: 'a', sequence: A },
        { name: 'b', sequence: B },
      ]),
    ).toEqual([]);
  });
});

describe('same bases', () => {
  it('reports identical bases ordered under different names', () => {
    const found = sameBases([
      { name: 'x_F', sequence: A },
      { name: 'y_F', sequence: A.toLowerCase() },
      { name: 'z_R', sequence: B },
    ]);
    expect(found).toEqual([{ sequence: A, names: ['x_F', 'y_F'] }]);
  });

  it('does not report one name used twice for the same bases', () => {
    expect(
      sameBases([
        { name: 'x', sequence: A },
        { name: 'x', sequence: A },
      ]),
    ).toEqual([]);
  });
});

describe('cross-dimers', () => {
  it('reports a strongly self-complementary partner at or below -6', () => {
    // b is the reverse complement of the whole of a: a full duplex.
    const rc = reverseComplement(A);
    const found = crossDimers([
      { name: 'a', sequence: A },
      { name: 'rc', sequence: rc },
    ]);
    expect(found).toHaveLength(1);
    expect(found[0]?.dg).toBeLessThanOrEqual(DEFAULT_DIMER_DG);
    expect(found[0]).toMatchObject({ a: 'a', b: 'rc' });
  });

  it('does not report a short 3′ match whose energy is above -6', () => {
    // Four complementary bases at the 3′ ends and nothing else in common.
    const p = 'ATTATTACTATCATAGCATTAGGC';
    const q = 'TTATGATATTACTAATTACCGCC' + 'T';
    const dg = dimerEnergy(p, q);
    expect(dg).toBeLessThan(0); // there is a match to be found
    expect(dg).toBeGreaterThan(DEFAULT_DIMER_DG); // and it is too short to report
    expect(
      crossDimers([
        { name: 'p', sequence: p },
        { name: 'q', sequence: q },
      ]),
    ).toEqual([]);
  });

  it('honours a looser cutoff and sorts the most stable first', () => {
    const p = 'ATTATTACTATCATAGCATTAGGC';
    const q = 'TTATGATATTACTAATTACCGCCT';
    const found = crossDimers(
      [
        { name: 'p', sequence: p },
        { name: 'q', sequence: q },
        { name: 'a', sequence: A },
      ],
      -1,
    );
    expect(found.length).toBeGreaterThanOrEqual(1);
    expect(found.map((d) => d.dg)).toEqual([...found.map((d) => d.dg)].sort((x, y) => x - y));
  });

  it('compares each pair of distinct bases once and leaves an oligo alone with itself', () => {
    expect(
      crossDimers(
        [
          { name: 'a', sequence: A },
          { name: 'a2', sequence: A },
        ],
        0,
      ),
    ).toEqual([]);
  });
});

describe('Tm spread', () => {
  it('names the lowest and highest, and flags a spread past the limit', () => {
    const low = 'ATATATATATATATATATAT';
    const high = 'GCGCGGCCGCGCCGGCGCGG';
    const spread = tmSpread([
      { name: 'low', sequence: low },
      { name: 'high', sequence: high },
      { name: 'mid', sequence: A },
    ]);
    expect(spread).toMatchObject({ lowest: 'low', highest: 'high', exceeds: true });
    expect(spread?.spread).toBeCloseTo((spread?.max ?? 0) - (spread?.min ?? 0));
  });

  it('does not flag oligos of one Tm, skips degenerate ones, and is null with none', () => {
    expect(
      tmSpread([
        { name: 'a', sequence: A },
        { name: 'a2', sequence: A },
      ])?.exceeds,
    ).toBe(false);
    expect(tmSpread([{ name: 'n', sequence: 'ACGTNNACGTACGT' }])).toBeNull();
    expect(tmSpread([])).toBeNull();
  });
});

describe('checkPool', () => {
  it('runs every check', () => {
    const result = checkPool([
      { name: 'a', sequence: A },
      { name: 'A', sequence: B },
    ]);
    expect(result.duplicateNames).toHaveLength(1);
    expect(result.sameBases).toEqual([]);
    expect(result.tm).not.toBeNull();
  });
});
