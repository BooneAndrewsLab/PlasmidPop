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
