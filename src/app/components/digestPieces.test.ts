import { namedEnzymes } from './digestPieces';

describe('namedEnzymes', () => {
  it('names up to four enzymes', () => {
    expect(namedEnzymes([])).toBe('');
    expect(namedEnzymes(['EcoRI'])).toBe('EcoRI');
    expect(namedEnzymes(['EcoRI', 'XhoI', 'BamHI', 'NotI'])).toBe('EcoRI, XhoI, BamHI, NotI');
  });

  it('counts the rest past four, so the status line stays a line', () => {
    expect(namedEnzymes(['A', 'B', 'C', 'D', 'E'])).toBe('A, B, C, D and 1 more');
    const many = Array.from({ length: 1234 }, (_, i) => `E${String(i)}`);
    expect(namedEnzymes(many)).toBe('E0, E1, E2, E3 and 1,230 more');
  });
});
