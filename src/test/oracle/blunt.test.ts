import {
  SeqDocument,
  digest,
  documentFromFragment,
  emptyVector,
  findCutSites,
  getEnzyme,
  reverseComplement,
} from '@/core';

import oracle from './blunt.json';

/**
 * Blunted cut ends against pydna (scripts/oracle/blunt.py). A circular vector
 * is cut, its largest fragment has its ends made blunt (T4 fill-in, or mung
 * bean trimming) and is closed on itself. pydna's T4('ACGT') / mung() / looped()
 * give the circle PlasmidPop's bluntEnds() + emptyVector() must give (#183):
 * 5' and 3' overhangs, blunt cutters, Type IIS cuts outside the site and two
 * different enzymes at the two ends.
 *
 * Only the sequence is compared. What a blunted, rejoined product does to
 * features depends on provenance across document versions and edited pieces
 * (#187, #188), so no feature is carried here.
 */
function sameCircle(a: string, b: string): boolean {
  const x = a.toUpperCase();
  const y = b.toUpperCase();
  return x.length === y.length && ((x + x).includes(y) || (x + x).includes(reverseComplement(y)));
}

describe('blunted ends against pydna', () => {
  for (const c of oracle.cases) {
    it(c.name, () => {
      const enzymes = c.enzymes.map((n) => {
        const e = getEnzyme(n);
        if (e === undefined) throw new Error(`no enzyme ${n}`);
        return e;
      });
      const doc = SeqDocument.create({ name: 'v', sequence: c.sequence, topology: 'circular' });
      const fragments = digest(doc, findCutSites(c.sequence, 'circular', enzymes));
      const biggest = [...fragments].sort((a, b) => b.sequence.length - a.sequence.length)[0];
      if (biggest === undefined) throw new Error('no fragment');
      const closed = emptyVector(
        documentFromFragment(biggest).bluntEnds(c.method as 'fill' | 'trim'),
      );
      expect(closed).not.toBeNull();
      expect(closed?.isCircular).toBe(true);
      expect(sameCircle(closed?.sequence.toString() ?? '', c.product)).toBe(true);
    });
  }
});
