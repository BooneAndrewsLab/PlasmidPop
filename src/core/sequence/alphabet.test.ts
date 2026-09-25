import {
  AlphabetMismatchError,
  InvalidResiduesError,
  InvalidSequenceError,
  complement,
  formatLength,
  guessAlphabet,
  isAlphabet,
  isValidProtein,
  isValidResidues,
  isValidSequence,
  normalizeSequenceInput,
  reverseComplement,
} from './alphabet';

describe('protein alphabet (#66)', () => {
  it('takes the twenty, U, O, the ambiguity codes and a stop, in either case', () => {
    expect(isValidProtein('ACDEFGHIKLMNPQRSTVWYUOBZJX*')).toBe(true);
    expect(isValidProtein('mkvle*')).toBe(true);
    expect(isValidProtein('MK V')).toBe(false);
    expect(isValidProtein('MK-V')).toBe(false);
    expect(isValidResidues('MEL', 'protein')).toBe(true);
    expect(isValidResidues('MEL', 'nucleotide')).toBe(false);
  });

  it('normalizes pasted residues, and names what is not one', () => {
    expect(normalizeSequenceInput('  1 MVHL TPEE\n 9 KS*', 'protein')).toBe('MVHLTPEEKS*');
    expect(() => normalizeSequenceInput('MVH#L', 'protein')).toThrow(InvalidResiduesError);
    expect(() => normalizeSequenceInput('MVH#L', 'protein')).toThrow(
      'Sequence contains characters outside the amino-acid alphabet: "#"',
    );
    // Residues are not bases.
    expect(() => normalizeSequenceInput('MVHL')).toThrow(InvalidSequenceError);
  });

  it('never takes a nucleotide sequence for a protein', () => {
    expect(guessAlphabet('')).toBe('nucleotide');
    expect(guessAlphabet('ACGTACGT')).toBe('nucleotide');
    expect(guessAlphabet('acgunnnn')).toBe('nucleotide');
    // Every IUPAC code, ambiguity codes and all, is still DNA.
    expect(guessAlphabet('RYSWKMBDHVNRYSWKMBDHVN')).toBe('nucleotide');
    // Even a peptide spelt wholly in letters DNA has as well.
    expect(guessAlphabet('MKRSWAT')).toBe('nucleotide');
    // Mostly bases with a stray letter is damaged DNA, for its reader to report.
    expect(guessAlphabet(`${'ACGT'.repeat(10)}X`)).toBe('nucleotide');
    expect(guessAlphabet(`${'ACGT'.repeat(10)}#`)).toBe('nucleotide');
  });

  it('knows a protein by the letters no base has', () => {
    expect(guessAlphabet('MVHLTPEEKSAVTALWGKVNVDEVGGEALGRLLVVYPWTQRFFESFGDLS')).toBe('protein');
    expect(guessAlphabet('mvhltpeeks*')).toBe('protein');
    expect(guessAlphabet('MKVLE')).toBe('protein');
    // Not letters at all is neither; the nucleotide reader says what is wrong.
    expect(guessAlphabet('MKV#LE')).toBe('nucleotide');
  });

  it('writes a length in the unit of its alphabet', () => {
    expect(formatLength(4361, 'nucleotide')).toBe('4,361 bp');
    expect(formatLength(147, 'protein')).toBe('147 aa');
    expect(isAlphabet('protein')).toBe(true);
    expect(isAlphabet('rna')).toBe(false);
  });
});

describe('alphabet errors and thresholds (mutation tests)', () => {
  function thrown(f: () => unknown): unknown {
    try {
      f();
    } catch (e) {
      return e;
    }
    throw new Error('did not throw');
  }

  it('names each error class', () => {
    expect(thrown(() => normalizeSequenceInput('AC#'))).toMatchObject({
      name: 'InvalidSequenceError',
    });
    expect(thrown(() => normalizeSequenceInput('MK#', 'protein'))).toMatchObject({
      name: 'InvalidResiduesError',
    });
    expect(new AlphabetMismatchError('protein').name).toBe('AlphabetMismatchError');
  });

  it('says which way a paste is mismatched, and names no character', () => {
    const intoProtein = new AlphabetMismatchError('protein');
    expect(intoProtein.message).toBe(
      'These are bases; a protein takes amino-acid residues. Translate them first.',
    );
    expect(intoProtein.invalidCharacters).toEqual([]);
    expect(intoProtein).toBeInstanceOf(InvalidSequenceError);
    expect(new AlphabetMismatchError('nucleotide').message).toBe(
      'These are amino-acid residues; a DNA sequence takes bases.',
    );
  });

  it('lists up to five characters, and counts the rest', () => {
    expect(() => normalizeSequenceInput('A#C-')).toThrow(
      'Sequence contains characters outside the IUPAC nucleotide alphabet: "#", "-"',
    );
    const five = thrown(() => normalizeSequenceInput('A#-!?%')) as Error;
    expect(five.message).toBe(
      'Sequence contains characters outside the IUPAC nucleotide alphabet: "#", "-", "!", "?", "%"',
    );
    const six = thrown(() => normalizeSequenceInput('A#-!?%&', 'protein')) as Error;
    expect(six.message).toBe(
      'Sequence contains characters outside the amino-acid alphabet: "#", "-", "!", "?", "%", … (6 distinct)',
    );
  });

  it('takes text exactly nine tenths plain bases for a nucleotide sequence', () => {
    expect(guessAlphabet('AAAAAAAAAE')).toBe('nucleotide');
    expect(guessAlphabet('AAAAAAAAEE')).toBe('protein');
  });
});

describe('alphabet', () => {
  it('complements IUPAC codes and preserves case', () => {
    expect(complement('ACGTU')).toBe('TGCAA');
    expect(complement('acgtu')).toBe('tgcaa');
    expect(complement('RYSWKMBDHVN')).toBe('YRSWMKVHDBN');
    expect(reverseComplement('ATGCcc')).toBe('ggGCAT');
    expect(reverseComplement(reverseComplement('GATTACAnnrY'))).toBe('GATTACAnnrY');
  });

  it('validates sequences', () => {
    expect(isValidSequence('')).toBe(true);
    expect(isValidSequence('ACGTNryk')).toBe(true);
    expect(isValidSequence('ACG T')).toBe(false);
    expect(isValidSequence('ACGX')).toBe(false);
  });

  it('normalizes pasted text by stripping whitespace and digits', () => {
    expect(normalizeSequenceInput('   1 acgt ttga\n  11 cc\r\n')).toBe('acgtttgacc');
  });

  it('reports the offending characters', () => {
    expect(() => normalizeSequenceInput('ACG-T*X')).toThrow(InvalidSequenceError);
    try {
      normalizeSequenceInput('ACG-T*X-');
    } catch (e) {
      expect(e).toBeInstanceOf(InvalidSequenceError);
      if (e instanceof InvalidSequenceError) expect(e.invalidCharacters).toEqual(['-', '*', 'X']);
    }
  });
});
