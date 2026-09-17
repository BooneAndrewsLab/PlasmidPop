import { isStartCodon, isStopCodon, translate, translateCodon, translateReverse } from './codons';

describe('codons', () => {
  it('translates the standard code', () => {
    expect(translate('ATGGCCATTGTAATGGGCCGCTGAAAGGGTGCCCGATAG')).toBe('MAIVMGR*KGAR*');
    expect(translate('atgtaa')).toBe('M*');
    expect(translateCodon('TGG')).toBe('W');
    expect(translateCodon('TAA')).toBe('*');
    expect(translateCodon('ATG')).toBe('M');
  });

  it('resolves ambiguity codes when all expansions agree', () => {
    expect(translateCodon('GCN')).toBe('A');
    expect(translateCodon('CTN')).toBe('L');
    expect(translateCodon('TTY')).toBe('F');
    expect(translateCodon('TTR')).toBe('L');
    expect(translateCodon('ATN')).toBe('X');
    expect(translateCodon('NNN')).toBe('X');
    expect(translateCodon('AT')).toBe('X');
    expect(translateCodon('A-G')).toBe('X');
    expect(translateCodon('TAR')).toBe('*');
  });

  it('honours toStop, firstCodonAsMet and the bacterial start set', () => {
    expect(translate('ATGAAATAAGGG', { toStop: true })).toBe('MK');
    expect(translate('GTGAAA', { firstCodonAsMet: true })).toBe('VK');
    expect(translate('GTGAAA', { firstCodonAsMet: true, table: 11 })).toBe('MK');
    expect(isStartCodon('GTG')).toBe(false);
    expect(isStartCodon('GTG', 11)).toBe(true);
    expect(isStartCodon('TTG', 11)).toBe(true);
    expect(isStopCodon('TGA')).toBe(true);
    expect(isStopCodon('TGG')).toBe(false);
    expect(translate('ATGCC')).toBe('M');
  });

  it('translates the reverse strand', () => {
    expect(translateReverse('TTACAT')).toBe('M*');
  });
});
