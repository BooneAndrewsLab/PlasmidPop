import {
  InvalidSequenceError,
  complement,
  isValidSequence,
  normalizeSequenceInput,
  reverseComplement,
} from './alphabet';

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
