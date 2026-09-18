import { frameLabel, translateFrame, translateSixFrames } from './sixFrame';

describe('six-frame translation', () => {
  // ATG AAA TAA | forward frames: MK*, frame +2: "TGA AAT AA" → *N, frame +3: "GAA ATA A" → EI
  const dna = 'ATGAAATAA';

  it('reads the forward frames from the first, second and third base', () => {
    const [f1, f2, f3] = translateSixFrames(dna);
    expect(f1).toEqual({ frame: 1, strand: 'forward', offset: 0, protein: 'MK*', stops: 1 });
    expect(f2).toEqual({ frame: 2, strand: 'forward', offset: 1, protein: '*N', stops: 1 });
    expect(f3).toEqual({ frame: 3, strand: 'forward', offset: 2, protein: 'EI', stops: 0 });
  });

  it('reads the reverse frames from the 3′ end of the forward strand', () => {
    // revcomp(ATGAAATAA) = TTATTTCAT → LFH; TAT TTC AT → YF; ATT TCA T → IS
    const [, , , r1, r2, r3] = translateSixFrames(dna);
    expect(r1).toEqual({ frame: -1, strand: 'reverse', offset: 0, protein: 'LFH', stops: 0 });
    expect(r2).toEqual({ frame: -2, strand: 'reverse', offset: 1, protein: 'YF', stops: 0 });
    expect(r3).toEqual({ frame: -3, strand: 'reverse', offset: 2, protein: 'IS', stops: 0 });
  });

  it('gives empty proteins for inputs shorter than a codon and honours case and options', () => {
    expect(translateSixFrames('AT').every((f) => f.protein === '' && f.stops === 0)).toBe(true);
    expect(translateSixFrames('ATG').map((f) => f.protein)).toEqual(['M', '', '', 'H', '', '']);
    expect(translateFrame('atgtaaaaa', 1).protein).toBe('M*K');
    expect(translateFrame('atgtaaaaa', 1, { toStop: true }).protein).toBe('M');
    expect(translateFrame('NNNATG', 1).protein).toBe('XM');
  });

  it('labels frames with a sign', () => {
    expect([1, 2, 3, -1, -2, -3].map((f) => frameLabel(f as 1))).toEqual([
      '+1',
      '+2',
      '+3',
      '−1',
      '−2',
      '−3',
    ]);
  });
});
