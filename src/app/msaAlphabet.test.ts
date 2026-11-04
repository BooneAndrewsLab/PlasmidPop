import { alphabetInUse, detectAlphabet, documentJoins, recordKind } from './msaAlphabet';

const DNA = 'ATGGCGTACGTTAGCCATTGACCGGATCCA';
const PROT = 'MKTAYIAKQRQISFVKSHFSRQLEERLGLIEVQ';

describe('recordKind (#369)', () => {
  it('reads bases, ambiguity codes and RNA as nucleotide', () => {
    expect(recordKind(DNA)).toBe('nucleotide');
    expect(recordKind(DNA.toLowerCase())).toBe('nucleotide');
    expect(recordKind('AUGGCUACGUUAGCCAUUGACC')).toBe('nucleotide');
    expect(recordKind('ATGNNNNNNNNNNACGTACGTAC')).toBe('nucleotide');
    expect(recordKind('ATGRYACGTACGTACGTACGTACGTACGTACGTAC')).toBe('nucleotide');
  });

  it('ignores gaps, stops, digits and spaces', () => {
    expect(recordKind('ATG--CGT ACG*TTA 12 GCC')).toBe('nucleotide');
    expect(recordKind('MKT-AYI AKQ*RQI SFV')).toBe('protein');
  });

  it('reads residues as protein', () => {
    expect(recordKind(PROT)).toBe('protein');
  });

  it('will not guess on a few letters or a borderline mixture', () => {
    expect(recordKind('ATG')).toBe('unclear');
    expect(recordKind('ACGTACGTACGTACGTACGTKLMPQR')).toBe('unclear');
  });

  it('says empty for no letters', () => {
    expect(recordKind('')).toBe('empty');
    expect(recordKind('--- ***')).toBe('empty');
  });
});

describe('detectAlphabet (#369)', () => {
  it('settles when every record agrees', () => {
    expect(detectAlphabet([DNA, DNA, DNA]).alphabet).toBe('nucleotide');
    expect(detectAlphabet([PROT, PROT]).alphabet).toBe('protein');
  });

  it('gives no alphabet and says why for a mixed set', () => {
    const d = detectAlphabet([DNA, PROT, DNA]);
    expect(d.alphabet).toBeNull();
    expect(d.verdict).toBe('mixed');
    expect(d.message).toMatch(/2 nucleotide records and 1 protein record/);
  });

  it('gives no alphabet for a doubtful record, and none for nothing', () => {
    const d = detectAlphabet([DNA, 'ATG', DNA]);
    expect(d.alphabet).toBeNull();
    expect(d.verdict).toBe('unclear');
    expect(d.message).toMatch(/1 record is too short/);
    expect(detectAlphabet([]).verdict).toBe('empty');
    expect(detectAlphabet(['', '--']).alphabet).toBeNull();
  });
});

describe('alphabetInUse (#369)', () => {
  it('takes the letters in auto and the choice when one is made', () => {
    expect(alphabetInUse([PROT, PROT], 'auto')).toMatchObject({
      alphabet: 'protein',
      chosen: false,
    });
    expect(alphabetInUse([PROT, PROT], 'nucleotide')).toMatchObject({
      alphabet: 'nucleotide',
      chosen: true,
    });
    expect(alphabetInUse([DNA, PROT], 'auto').alphabet).toBeNull();
  });
});

describe('documentJoins (#369)', () => {
  const dna = alphabetInUse([DNA], 'auto');
  it('joins a document of the same alphabet', () => {
    expect(documentJoins('nucleotide', 100, dna)).toEqual({ ok: true, why: null });
  });
  it('leaves out a document of the other alphabet, saying why', () => {
    const r = documentJoins('protein', 100, dna);
    expect(r.ok).toBe(false);
    expect(r.why).toMatch(/protein document and the records are nucleotide/);
  });
  it('leaves out an empty document, or one while the kind is unsettled', () => {
    expect(documentJoins('nucleotide', 0, dna).ok).toBe(false);
    expect(documentJoins('nucleotide', 9, alphabetInUse([DNA, PROT], 'auto')).ok).toBe(false);
  });
});
