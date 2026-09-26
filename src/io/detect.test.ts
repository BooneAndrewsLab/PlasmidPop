import { detectFormat, parseSequenceFile } from './detect';
import { FormatError } from './types';

describe('detectFormat', () => {
  it('sniffs content', () => {
    expect(detectFormat('LOCUS       X 20 bp DNA linear\n//\n')).toBe('genbank');
    expect(detectFormat('\n\nLOCUS       X 20 bp DNA linear\n')).toBe('genbank');
    expect(detectFormat('>seq\nACGT\n')).toBe('fasta');
    expect(detectFormat('acgt acgt\n  11 nnry\n')).toBe('raw');
    expect(detectFormat('hello world')).toBeNull();
    expect(detectFormat('')).toBeNull();
  });

  it('falls back to the extension', () => {
    expect(detectFormat('???', 'thing.gb')).toBe('genbank');
    expect(detectFormat('???', 'thing.GBK')).toBe('genbank');
    expect(detectFormat('???', 'thing.fasta')).toBe('fasta');
    expect(detectFormat('???', 'thing.dna')).toBeNull();
  });
});

describe('parseSequenceFile', () => {
  it('dispatches to the right parser', () => {
    expect(parseSequenceFile('>a\nACGT\n').format).toBe('fasta');
    expect(
      parseSequenceFile('LOCUS       X 4 bp DNA linear\nORIGIN\n        1 acgt\n//\n').format,
    ).toBe('genbank');
    const raw = parseSequenceFile('acgt acgt', '/tmp/insert.txt');
    expect(raw.format).toBe('raw');
    expect(raw.documents[0]).toMatchObject({ name: 'insert', length: 8 });
    expect(() => parseSequenceFile('hello world', 'x.dna')).toThrow(FormatError);
  });
});

describe('bare residues without a FASTA header (#95)', () => {
  // The first residues of human serum albumin: protein-only letters (E, F,
  // I, L, P, Q), in one block as a sequence is copied.
  const peptide = 'MKWVTFISLLFLFSSAYSRGVFRRDAHKSEVAHRFKDLGEENFKALVLIAFAQYLQQCPF';

  it('opens as a protein document, in one block or wrapped', () => {
    for (const text of [peptide, `${peptide.slice(0, 30)}\n${peptide.slice(30)}\n`]) {
      expect(detectFormat(text)).toBe('raw');
      const [doc] = parseSequenceFile(text).documents;
      expect(doc?.alphabet).toBe('protein');
      expect(doc?.sequence.toString()).toBe(peptide);
    }
  });

  it('still opens bases as bases, whatever ambiguity codes they carry', () => {
    const [doc] = parseSequenceFile('acgt acgt\n 11 nnry\n').documents;
    expect(doc?.alphabet).toBe('nucleotide');
    // Every letter of MKRS is an IUPAC code, so it is bases, as it always was.
    expect(parseSequenceFile('MKRSMKRSMKRS').documents[0]?.alphabet).toBe('nucleotide');
  });

  it('does not take prose for a protein, however amino-acid its letters', () => {
    // Every letter but J is an amino acid, so the shape has to answer.
    for (const prose of [
      'hello world',
      'the quick brown fox jumps over the lazy dog',
      'REMEMBER to check this sequence',
    ]) {
      expect(detectFormat(prose), prose).toBeNull();
    }
    // And a peptide too short to tell from a word is not offered either.
    expect(detectFormat('MKWVTFIS')).toBeNull();
  });
});
