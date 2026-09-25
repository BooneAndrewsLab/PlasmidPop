import { type AssemblyPart, type DigestFragment, flipFragment } from '@/core';

import { copiesOnShelf } from './shelfPieces';

function piece(over: Partial<DigestFragment> = {}): DigestFragment {
  return {
    sequence: 'AATTCGGGGG',
    features: [],
    range: { start: 100, end: 110 },
    left: { kind: "5'", overhang: 'AATT', enzyme: 'EcoRI' },
    right: { kind: 'blunt', overhang: '', enzyme: 'SmaI' },
    source: 'pUC19',
    ...over,
  };
}

const part = (fragment: DigestFragment, id = 'p'): AssemblyPart => ({
  id,
  fragment,
  flipped: false,
});

describe('copiesOnShelf', () => {
  it('counts the parts that are this piece', () => {
    const f = piece();
    expect(copiesOnShelf([], f)).toBe(0);
    expect(copiesOnShelf([part(f, 'a'), part(f, 'b'), part(piece({ source: 'pBR322' }))], f)).toBe(
      2,
    );
  });

  it('still counts a part turned over or dephosphorylated since', () => {
    const f = piece();
    const turned = { ...part(flipFragment(f)), flipped: true };
    const treated = part({ ...f, dephosphorylated: true });
    expect(copiesOnShelf([turned, treated], f)).toBe(2);
  });

  it('tells apart pieces from another document, another place, or other enzymes', () => {
    const f = piece();
    expect(copiesOnShelf([part(piece({ source: 'pBR322' }))], f)).toBe(0);
    expect(copiesOnShelf([part(piece({ range: { start: 100, end: 111 } }))], f)).toBe(0);
    expect(
      copiesOnShelf([part(piece({ right: { kind: 'blunt', overhang: '', enzyme: 'EcoRV' } }))], f),
    ).toBe(0);
  });
});
