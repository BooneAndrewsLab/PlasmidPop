import { SeqDocument } from '@/core';

import { cutOffset, digest } from './digest';

/**
 * Corners of `digest.ts` the rest of the suite leaves open (#77): the
 * offset between the two strands' cuts on an empty circle, and a cut given
 * at the very end of a circle, which is its origin.
 */

describe('cutOffset', () => {
  it('leaves the offset as it is on an empty circle, with no length to fold it into', () => {
    expect(cutOffset({ cut: 3, cutBottom: 7 }, 0, 'circular')).toBe(4);
    expect(cutOffset({ cut: 7, cutBottom: 3 }, 0, 'circular')).toBe(-4);
    // A circle of 10 folds 7 into the shorter arc, the other way round.
    expect(cutOffset({ cut: 0, cutBottom: 7 }, 10, 'circular')).toBe(-3);
  });
});

describe('digest of a circle', () => {
  it('reads a cut at the circle’s length as a cut at its origin', () => {
    const sequence = 'AATTCCCCCCCCCCCCCCCG';
    const doc = SeqDocument.create({ name: 'p', sequence, topology: 'circular' });
    const at = (cut: number) =>
      ({ enzyme: 'EcoRI', cut, cutBottom: cut + 4, siteStart: 19, strand: 'forward' }) as const;
    for (const sites of [[at(20)], [at(0), at(20)]]) {
      const fragments = digest(doc, sites);
      expect(fragments.map((f) => f.range)).toEqual([{ start: 0, end: 20 }]);
      expect(fragments[0]?.sequence).toBe(sequence);
      expect(fragments[0]?.left).toEqual({ kind: "5'", overhang: 'AATT', enzyme: 'EcoRI' });
      expect(fragments[0]?.right).toEqual({ kind: "5'", overhang: 'AATT', enzyme: 'EcoRI' });
    }
  });
});
