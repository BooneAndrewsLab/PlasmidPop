import {
  findSequenceMatches,
  looksLikeSequence,
  matchPositions,
  patternMasks,
  sequenceMasks,
} from './search';

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

describe('matchPositions', () => {
  /** The rule spelled out: every sequence base a non-empty subset of the pattern's. */
  function naive(masks: Uint8Array, pattern: readonly number[], maxStart: number): number[] {
    const out: number[] = [];
    for (let i = 0; i <= maxStart && i + pattern.length <= masks.length; i++) {
      if (pattern.every((p, j) => (masks[i + j] ?? 0) !== 0 && ((masks[i + j] ?? 0) & ~p) === 0)) {
        out.push(i);
      }
    }
    return out;
  }

  it('agrees with the rule spelled out, for short, IUPAC and over-long patterns', () => {
    let x = 7;
    const next = () => (x = (Math.imul(x, 1103515245) + 12345) >>> 0) >>> 16;
    // Mostly ACGT, with the odd N and R, and an unknown character now and then.
    const alphabet = 'ACGTACGTACGTACGTNRX';
    const seq = Array.from({ length: 3000 }, () => alphabet[next() % alphabet.length]).join('');
    const masks = sequenceMasks(seq);
    for (const pattern of [
      'A',
      'GATC',
      'GANTC',
      'GCCNNNNNGGC',
      'RGCY',
      'NNNN',
      'ACNNNNGTAYC',
      'N'.repeat(31),
      `GA${'N'.repeat(33)}`,
    ]) {
      const p = patternMasks(pattern);
      for (const maxStart of [seq.length - pattern.length, 1500, 0]) {
        expect(matchPositions(masks, p, maxStart), `${pattern} to ${maxStart}`).toEqual(
          naive(masks, p, maxStart),
        );
      }
    }
  });
});
