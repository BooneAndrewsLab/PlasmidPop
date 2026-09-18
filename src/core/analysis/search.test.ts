import { findSequenceMatches, looksLikeSequence } from './search';

describe('findSequenceMatches', () => {
  it('finds IUPAC patterns on both strands and wraps on circular sequences', () => {
    const seq = 'GGATCCAAAAGAATTCAAAAGGATC'; // 25 bp; GGATCC at 0; GAATTC at 10; GGATC at 20 wraps to GGATCG
    expect(findSequenceMatches(seq, 'linear', 'GAATTC')).toEqual([
      { range: { start: 10, end: 16 }, strand: 'forward' },
    ]);
    expect(findSequenceMatches(seq, 'linear', 'GGATCC')).toEqual([
      { range: { start: 0, end: 6 }, strand: 'forward' },
    ]);
    // non-palindromic: TTCA forward at 13; reverse complement TGAA absent
    expect(findSequenceMatches(seq, 'linear', 'TTCA')).toEqual([
      { range: { start: 13, end: 17 }, strand: 'forward' },
    ]);
    expect(findSequenceMatches(seq, 'linear', 'TGAA')).toEqual([
      { range: { start: 13, end: 17 }, strand: 'reverse' },
    ]);
    expect(findSequenceMatches(seq, 'linear', 'TGAA', { bothStrands: false })).toEqual([]);
    // IUPAC in the pattern
    expect(findSequenceMatches(seq, 'linear', 'GRATTC')).toHaveLength(1);
    // wrap: GGATC + G(0)
    expect(findSequenceMatches(seq, 'circular', 'GGATCG')).toEqual([
      { range: { start: 20, end: 26 }, strand: 'forward' },
    ]);
    expect(findSequenceMatches(seq, 'linear', 'GGATCG')).toEqual([]);
    expect(findSequenceMatches(seq, 'linear', 'hello')).toEqual([]);
    expect(findSequenceMatches(seq, 'linear', '')).toEqual([]);
  });

  it('recognises nucleotide-looking queries', () => {
    expect(looksLikeSequence('acgtn')).toBe(true);
    expect(looksLikeSequence('lacZ')).toBe(false);
    expect(looksLikeSequence('')).toBe(false);
  });
});
