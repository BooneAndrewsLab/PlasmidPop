import {
  GENETIC_CODES,
  findGeneticCode,
  geneticCode,
  isStartCodon,
  isStopCodon,
  isTranslationTable,
  translate,
  translateCodon,
  translateReverse,
} from './codons';

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

  it('reads the alternative codes, not just the standard one', () => {
    // The vertebrate mitochondrial code is the one that bites: TGA is
    // tryptophan rather than a stop, and AGA/AGG are stops rather than
    // arginine, so a mitochondrial gene read with table 1 comes out chopped.
    expect(translateCodon('TGA', 2)).toBe('W');
    expect(isStopCodon('TGA', 2)).toBe(false);
    expect(translateCodon('AGA', 2)).toBe('*');
    expect(isStopCodon('AGA', 2)).toBe(true);
    expect(translateCodon('ATA', 2)).toBe('M');
    expect(isStartCodon('ATT', 2)).toBe(true);
    // Ciliate nuclear reads both amber and ochre as glutamine.
    expect(translate('TAATAGTGA', { table: 6 })).toBe('QQ*');
    // Yeast mitochondrial reads the whole CTN box as threonine, which an
    // ambiguity code can be resolved against.
    expect(translate('CTTCTACTG', { table: 3 })).toBe('TTT');
    expect(translateCodon('CTN', 3)).toBe('T');
    expect(translateCodon('CTN')).toBe('L');
    // 11 shares the standard amino acids and differs only in its starts.
    expect(translate('TTGGTGATT', { table: 11 })).toBe('LVI');
  });

  it('says which numbers name a code, and ships them whole', () => {
    expect(isTranslationTable(2)).toBe(true);
    expect(geneticCode(2).name).toBe('Vertebrate Mitochondrial');
    // NCBI withdrew 7 and 8 and never used 17-20; a file naming one of them
    // is asking for a code nobody has.
    expect(isTranslationTable(7)).toBe(false);
    expect(findGeneticCode(8)).toBeUndefined();
    expect(isTranslationTable(0)).toBe(false);
    expect(GENETIC_CODES.length).toBeGreaterThan(20);
    for (const code of GENETIC_CODES) {
      expect(code.aminoAcids).toHaveLength(64);
      expect(code.starts).toHaveLength(64);
      expect(code.name).not.toBe('');
    }
  });

  it('translates the reverse strand', () => {
    expect(translateReverse('TTACAT')).toBe('M*');
  });
});
