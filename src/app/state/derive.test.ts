import { copyNameFor, isCopyNameOf } from './derive';

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

describe('isCopyNameOf', () => {
  it('knows the names a working copy takes by itself', () => {
    expect(isCopyNameOf('pBR322 copy', 'pBR322')).toBe(true);
    expect(isCopyNameOf('pBR322 copy 3', 'pBR322')).toBe(true);
    expect(isCopyNameOf('PBR322 COPY', 'pBR322')).toBe(true);
    expect(isCopyNameOf('pBR322 copy 2', 'pBR322 copy')).toBe(true);
    expect(isCopyNameOf('Untitled copy', '')).toBe(true);
    expect(isCopyNameOf('p(1).x copy', 'p(1).x')).toBe(true);
  });

  it('does not take a name the user gave for one', () => {
    expect(isCopyNameOf('pMine', 'pBR322')).toBe(false);
    expect(isCopyNameOf('pBR322 copy x', 'pBR322')).toBe(false);
    expect(isCopyNameOf('pBR3220 copy', 'pBR322')).toBe(false);
    expect(isCopyNameOf('p(1)ax copy', 'p(1).x')).toBe(false);
  });
});
