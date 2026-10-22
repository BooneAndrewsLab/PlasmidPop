import {
  codeMask,
  findResidueMatches,
  findSequenceMatches,
  looksLikeSequence,
  matchPatterns,
  matchPositions,
  patternMasks,
  sequenceMasks,
} from './search';

describe('sequenceMasks', () => {
  it('gives every character the mask codeMask gives it (item 99)', () => {
    // Every BMP character, lower case, IUPAC codes and the rest alike; 'ſ'
    // and 'ı' upper-case to ASCII letters and must still come out the same.
    const all = Array.from({ length: 0xd800 }, (_, c) => String.fromCharCode(c)).join('');
    const masks = sequenceMasks(all);
    const differ: number[] = [];
    for (let c = 0; c < all.length; c++) {
      if (masks[c] !== codeMask(String.fromCharCode(c))) differ.push(c);
    }
    expect(differ).toEqual([]);
    expect([...sequenceMasks('ACGTacgtNnRu-')]).toEqual([
      1,
      2,
      4,
      8,
      1,
      2,
      4,
      8,
      15,
      15,
      5,
      codeMask('U'),
      0,
    ]);
  });
});

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

describe('findResidueMatches (#66)', () => {
  it('finds residues on the one strand there is, in either case', () => {
    expect(findResidueMatches('MKVLEKVL', 'kvl')).toEqual([
      { start: 1, end: 4 },
      { start: 5, end: 8 },
    ]);
    // Overlapping matches are each found.
    expect(findResidueMatches('AAAA', 'AA')).toHaveLength(3);
  });

  it('reads X as any residue, and B, Z and J as the two each stands for', () => {
    expect(findResidueMatches('MKVLE', 'KXL')).toEqual([{ start: 1, end: 4 }]);
    expect(findResidueMatches('DNE', 'B')).toEqual([
      { start: 0, end: 1 },
      { start: 1, end: 2 },
    ]);
    expect(findResidueMatches('EQD', 'Z')).toHaveLength(2);
    expect(findResidueMatches('ILV', 'J')).toHaveLength(2);
    // A code in the sequence is only itself.
    expect(findResidueMatches('X', 'K')).toEqual([]);
  });

  it('finds nothing for a pattern that is no residues, or longer than the protein', () => {
    expect(findResidueMatches('MKV', '')).toEqual([]);
    expect(findResidueMatches('MKV', 'MKVL')).toEqual([]);
    expect(findResidueMatches('MKV', 'M K')).toEqual([]);
  });
});

describe('search edges (mutation tests)', () => {
  it('matches an empty pattern at every start up to maxStart and the end', () => {
    const masks = sequenceMasks('ACGTACGT');
    expect(matchPositions(masks, [], 3)).toEqual([0, 1, 2, 3]);
    expect(matchPositions(masks, [], 20)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
    expect(matchPositions(masks, [], -1)).toEqual([]);
  });

  it('matches a pattern longer than 31 bases up to maxStart and the end', () => {
    const seq = `A${'C'.repeat(40)}G`;
    const masks = sequenceMasks(seq);
    expect(matchPositions(masks, patternMasks('C'.repeat(40)), 1)).toEqual([1]);
    expect(matchPositions(masks, patternMasks('C'.repeat(40)), 0)).toEqual([]);
    expect(matchPositions(masks, patternMasks(`${'C'.repeat(40)}G`), 1)).toEqual([1]);
    expect(matchPositions(masks, patternMasks(`A${'C'.repeat(40)}G`), 0)).toEqual([0]);
    expect(matchPositions(masks, patternMasks(`${'C'.repeat(40)}GA`), 5)).toEqual([]);
  });

  it('gives an empty pattern every start, as matchPositions does, beside indexed ones', () => {
    const masks = sequenceMasks('ACGT');
    expect(matchPatterns(masks, [[], patternMasks('ACGT')], [3, 0])).toEqual([[0, 1, 2, 3], [0]]);
  });

  it('reads a character outside ASCII by codeMask, as the long s for S', () => {
    // U+017F upper-cases to S, which is C or G.
    expect(codeMask('\u017f')).toBe(codeMask('S'));
    expect([...sequenceMasks('A\u017fT')]).toEqual([codeMask('A'), codeMask('S'), codeMask('T')]);
  });

  it('matches ambiguous sequence in a window the index cannot spell', () => {
    const one = (seq: string, pattern: string, maxStart = 100) =>
      matchPatterns(sequenceMasks(seq), [patternMasks(pattern)], [maxStart])[0];
    // A window of nothing but ambiguity codes.
    expect(one('RRRRRR', 'RRRRRR')).toEqual([0]);
    expect(one('ARRRRRRT', 'NRRRRRRN')).toEqual([0]);
    // An ambiguity code at the window's first base and nowhere else.
    expect(one('RACGTA', 'RACGTA')).toEqual([0]);
    expect(one('TTRACGTA', 'RACGTA')).toEqual([2]);
    // The most specific window starts two bases in (GTRCGA), where the
    // pattern's first base would not admit the sequence's.
    expect(one('TAGTRCGAC', 'TNGTRCGAC')).toEqual([0]);
    expect(one('CCTAGTRCGAC', 'TNGTRCGAC')).toEqual([2]);
    expect(one('CCTAGTRCGAC', 'TNGTRCGAC', 1)).toEqual([]);
  });

  it('reads U as T and finds nothing for an empty or foreign pattern', () => {
    expect(findSequenceMatches('AAACGTTT', 'linear', 'acgu')).toEqual([
      { range: { start: 2, end: 6 }, strand: 'forward' },
    ]);
    expect(findSequenceMatches('ACGT', 'linear', '')).toEqual([]);
    expect(findSequenceMatches('aaugcatt', 'circular', 'UGCA')).toEqual([
      { range: { start: 2, end: 6 }, strand: 'forward' },
    ]);
    expect(findSequenceMatches('AAAACCCA', 'linear', 'gggu')).toEqual([
      { range: { start: 3, end: 7 }, strand: 'reverse' },
    ]);
    expect(findSequenceMatches('', 'circular', 'A')).toEqual([]);
    expect(findSequenceMatches('ACGT', 'linear', 'A-G')).toEqual([]);
    expect(findSequenceMatches('XACG', 'linear', 'XACG')).toEqual([]);
    expect(findSequenceMatches('ACGX', 'circular', 'ACGX')).toEqual([]);
  });

  it('finds a pattern as long as the sequence, but none longer, even round a circle', () => {
    expect(findSequenceMatches('ACCA', 'linear', 'ACCA', { bothStrands: false })).toEqual([
      { range: { start: 0, end: 4 }, strand: 'forward' },
    ]);
    expect(findSequenceMatches('AT', 'circular', 'ATA')).toEqual([]);
    expect(findSequenceMatches('AT', 'circular', 'ATAT')).toEqual([]);
  });

  it('wraps on a circle and not on a line', () => {
    expect(findSequenceMatches('CGTAAAAA', 'linear', 'ACG', { bothStrands: false })).toEqual([]);
    expect(findSequenceMatches('CGTAAAAA', 'circular', 'ACG', { bothStrands: false })).toEqual([
      { range: { start: 7, end: 10 }, strand: 'forward' },
    ]);
  });

  it('sorts hits on both strands by start', () => {
    expect(findSequenceMatches('GTCAAAGAC', 'linear', 'GAC')).toEqual([
      { range: { start: 0, end: 3 }, strand: 'reverse' },
      { range: { start: 6, end: 9 }, strand: 'forward' },
    ]);
    expect(findSequenceMatches('GACGTCAAGAC', 'linear', 'GAC').map((m) => m.range.start)).toEqual([
      0, 3, 8,
    ]);
  });

  it('finds no residue pattern with anything but letters and stops in it', () => {
    expect(findResidueMatches('MK-L', '-')).toEqual([]);
    expect(findResidueMatches('MK-L', 'K-')).toEqual([]);
    expect(findResidueMatches('M-KL', '-K')).toEqual([]);
    expect(findResidueMatches('MKL', '')).toEqual([]);
    expect(findResidueMatches('MKL', 'MKLV')).toEqual([]);
    expect(findResidueMatches('MKL', 'mkl')).toEqual([{ start: 0, end: 3 }]);
  });

  it('takes a nucleotide pattern only when every letter is one, spaces around it aside', () => {
    expect(looksLikeSequence('XACG')).toBe(false);
    expect(looksLikeSequence('ACGX')).toBe(false);
    expect(looksLikeSequence(' acgu ')).toBe(true);
  });
});
