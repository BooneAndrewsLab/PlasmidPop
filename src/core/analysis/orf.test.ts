import { reverseComplement } from '../sequence';
import { findOrfs } from './orf';

// ATG + 4 codons + TAA = 18 bp, 5 codons
const ORF = 'ATGGCCATTGTAATGTAA';

describe('findOrfs', () => {
  it('finds forward ORFs above the size threshold and reports the first start', () => {
    const seq = `CC${ORF}CC`;
    const orfs = findOrfs(seq, 'linear', { minCodons: 3 });
    expect(orfs).toEqual([
      { range: { start: 2, end: 20 }, strand: 'forward', frame: 2, codons: 5 },
    ]);
    expect(findOrfs(seq, 'linear', { minCodons: 6 })).toEqual([]);
  });

  it('ends an ORF where the chosen genetic code says it does', () => {
    // ATG + 3 codons + TGA + ATG + 2 codons + TAA. TGA stops the reading
    // under the standard code and is tryptophan under table 2, so the same
    // bases are two short ORFs or one long one depending on the code.
    const seq = 'ATGGCCATTGTATGAATGCCCGGGTAA';
    expect(findOrfs(seq, 'linear', { minCodons: 3 })).toEqual([
      { range: { start: 0, end: 15 }, strand: 'forward', frame: 0, codons: 4 },
      { range: { start: 15, end: 27 }, strand: 'forward', frame: 0, codons: 3 },
    ]);
    expect(findOrfs(seq, 'linear', { minCodons: 3, table: 2 })).toEqual([
      { range: { start: 0, end: 27 }, strand: 'forward', frame: 0, codons: 8 },
    ]);
  });

  it('finds reverse-strand ORFs in forward coordinates', () => {
    const seq = `GG${reverseComplement(ORF)}G`;
    const orfs = findOrfs(seq, 'linear', { minCodons: 3 });
    expect(orfs).toEqual([
      { range: { start: 2, end: 20 }, strand: 'reverse', frame: 1, codons: 5 },
    ]);
  });

  it('finds ORFs spanning the origin of a circular sequence, once', () => {
    const wrapped = `${ORF.slice(10)}CCCCCCC${ORF.slice(0, 10)}`; // L = 25
    const circ = findOrfs(wrapped, 'circular', { minCodons: 3 });
    expect(circ).toEqual([
      { range: { start: 15, end: 33 }, strand: 'forward', frame: 0, codons: 5 },
    ]);
    expect(findOrfs(wrapped, 'linear', { minCodons: 3 })).toEqual([]);
    const rc = findOrfs(reverseComplement(wrapped), 'circular', { minCodons: 3 });
    expect(rc).toHaveLength(1);
    expect(rc[0]?.strand).toBe('reverse');
    expect(rc[0]?.range.end).toBe((rc[0]?.range.start ?? 0) + 18);
  });

  it('never reports an ORF longer than the molecule', () => {
    // ATG followed by codons and no stop in a 9-mer circle would loop forever otherwise.
    expect(findOrfs('ATGAAAGGG', 'circular', { minCodons: 1 })).toEqual([]);
  });

  it('can use alternative starts', () => {
    const seq = `GTGGCCATTGTAATGTAA`;
    expect(findOrfs(seq, 'linear', { minCodons: 3 })).toEqual([]);
    expect(findOrfs(seq, 'linear', { minCodons: 3, atgOnly: false, table: 11 })[0]?.range).toEqual({
      start: 0,
      end: 18,
    });
  });
});
