import { SeqDocument, reverseComplement } from '@/core';
import { ENZYMES } from '@/core/analysis/restriction';
import { designOverlapPrimers, type OverlapKit } from '@/core/cloning/overlapPrimers';
import { gibson } from '@/core/cloning/gibson';
import { goldenGate } from '@/core/cloning/goldenGate';
import { pcr } from '@/core/cloning/pcr';

import oracle from './assembly.json';

/**
 * Assemblies against pydna (scripts/oracle/assembly.py). Each case is built
 * backwards from a known construct and pydna must rebuild it from the same
 * parts before it is recorded; PlasmidPop must too: Gibson (circular and
 * linear, reversed and shuffled parts, an overlap across the origin), Golden
 * Gate (BsaI, BsmBI, BbsI, SapI, reversed inserts, the origin inside the
 * recognition site) and the In-Fusion / NEBuilder overlap primers.
 */

/** The same molecule up to where the circle starts and which strand is read. */
function sameCircle(a: string, b: string): boolean {
  const x = a.toUpperCase();
  const y = b.toUpperCase();
  return x.length === y.length && ((x + x).includes(y) || (x + x).includes(reverseComplement(y)));
}

function sameLine(a: string, b: string): boolean {
  const x = a.toUpperCase();
  const y = b.toUpperCase();
  return x === y || x === reverseComplement(y);
}

describe('Gibson assembly against pydna', () => {
  for (const c of oracle.gibson) {
    it(c.name, () => {
      const docs = c.parts.map((p, i) => SeqDocument.create({ name: `part${i + 1}`, sequence: p }));
      const result = gibson(docs, { minOverlap: c.minOverlap, circular: c.circular });
      expect(result.problem).toBeNull();
      const product = result.assembly?.product;
      expect(product?.isCircular).toBe(c.circular);
      const same = c.circular ? sameCircle : sameLine;
      expect(same(product?.sequence.toString() ?? '', c.target)).toBe(true);
    });
  }
});

describe('Golden Gate assembly against pydna', () => {
  for (const c of oracle.goldenGate) {
    it(c.name, () => {
      const enzyme = ENZYMES.find((e) => e.name === c.enzyme);
      if (enzyme === undefined) throw new Error(`no enzyme ${c.enzyme}`);
      const docs = c.parts.map((p) =>
        SeqDocument.create({
          name: p.name,
          sequence: p.sequence,
          topology: p.circular ? 'circular' : 'linear',
        }),
      );
      const result = goldenGate(docs, { enzyme });
      expect(result.problem).toBeNull();
      const product = result.assembly?.product;
      expect(product?.isCircular).toBe(true);
      expect(sameCircle(product?.sequence.toString() ?? '', c.expected)).toBe(true);
    });
  }
});

describe('overlap primers (In-Fusion, NEBuilder) against pydna', () => {
  for (const c of oracle.overlapPrimers) {
    it(c.name, () => {
      const vector = SeqDocument.create({ name: 'vector', sequence: c.vector });
      const template = SeqDocument.create({
        name: 'template',
        sequence: c.template,
        topology: c.templateCircular ? 'circular' : 'linear',
      });
      const design = designOverlapPrimers(vector, template, c.region, c.kit as OverlapKit);
      expect(design.problem).toBeNull();
      const forward = design.forward;
      const reverse = design.reverse;
      if (forward === undefined || reverse === undefined) throw new Error('no primers');

      // The kit's tail is the vector's end, and what follows it is the insert.
      const tail = c.kit === 'in-fusion' ? 15 : 20;
      const fseq = forward.sequence.toUpperCase();
      const rseq = reverse.sequence.toUpperCase();
      const V = c.vector.toUpperCase();
      expect(fseq.startsWith(V.slice(V.length - tail))).toBe(true);
      expect(rseq.startsWith(reverseComplement(V.slice(0, tail)))).toBe(true);

      // PCR with the primers we designed gives pydna's amplicon, and joining it
      // to the vector gives pydna's product.
      const amplicon = pcr(template, [
        { name: 'F', sequence: fseq },
        { name: 'R', sequence: rseq },
      ]).products.map((p) => p.document.sequence.toString().toUpperCase());
      expect(amplicon).toEqual([c.amplicon]);
      expect(design.amplicon?.sequence.toString().toUpperCase()).toBe(c.amplicon);
      expect(design.product?.isCircular).toBe(true);
      expect(sameCircle(design.product?.sequence.toString() ?? '', c.product)).toBe(true);
    });
  }
});
