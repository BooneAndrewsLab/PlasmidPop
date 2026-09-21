import { copyNameFor } from './derive';

describe('copyNameFor', () => {
  it('names the first copy', () => {
    expect(copyNameFor('pBR322')).toBe('pBR322 copy');
  });

  it('numbers a copy whose name is taken', () => {
    expect(copyNameFor('pBR322', ['pBR322 copy'])).toBe('pBR322 copy 2');
    expect(copyNameFor('pBR322', ['pBR322 copy', 'pBR322 copy 2'])).toBe('pBR322 copy 3');
  });

  it('does not stack "copy" on a copy', () => {
    expect(copyNameFor('pBR322 copy')).toBe('pBR322 copy');
    expect(copyNameFor('pBR322 copy', ['pBR322 copy'])).toBe('pBR322 copy 2');
    expect(copyNameFor('pBR322 copy 3')).toBe('pBR322 copy');
  });

  it('ignores case when deciding a name is taken', () => {
    expect(copyNameFor('pBR322', ['PBR322 COPY'])).toBe('pBR322 copy 2');
  });

  it('falls back to Untitled for a nameless document', () => {
    expect(copyNameFor('')).toBe('Untitled copy');
    expect(copyNameFor('   ')).toBe('Untitled copy');
    expect(copyNameFor('copy')).toBe('Untitled copy');
  });

  it('keeps the rest of the name', () => {
    expect(copyNameFor('my plasmid v2')).toBe('my plasmid v2 copy');
  });
});
