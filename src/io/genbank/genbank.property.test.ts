import fc from 'fast-check';

import { SeqDocument } from '@/core';
import { docShapeArb, layFeatures, opShapeArb, resolveOp } from '@/test/editArbitraries';

import { parseGenBank } from './parseGenBank';
import { writeGenBank } from './writeGenBank';

/**
 * Whatever a random editing session leaves behind must survive being saved
 * as GenBank and opened again: same bases, same topology, and every
 * feature reading the same sequence on the same strand. This is the path a
 * plasmid takes out of the app, so a loss here is one nobody would see.
 */
describe('GenBank round trip after random editing', () => {
  it('reads back the same molecule it wrote', () => {
    fc.assert(
      fc.property(docShapeArb, fc.array(opShapeArb, { maxLength: 20 }), (shape, ops) => {
        let doc = SeqDocument.create({
          sequence: shape.sequence,
          topology: shape.topology,
          features: layFeatures(shape),
        });
        for (const opShape of ops) {
          const op = resolveOp(doc, opShape);
          if (op !== null) doc = doc.apply(op);
        }
        const parsed = parseGenBank(writeGenBank(doc));
        expect(parsed.documents).toHaveLength(1);
        const back = parsed.documents[0];
        if (back === undefined) throw new Error('no record');

        expect(back.length).toBe(doc.length);
        expect(back.sequence.toString()).toBe(doc.sequence.toString());
        expect(back.topology).toBe(doc.topology);

        // An empty sequence has no gap between bases for a site to name in
        // GenBank, so a site left on one (by deleting everything) cannot be
        // written; that is the one loss allowed.
        const wrote = doc.features
          .all()
          .filter((f) => doc.length > 0 || f.segments.some((s) => s.kind === 'range'));
        const read = back.features.all();
        expect(read.map((f) => f.type)).toEqual(wrote.map((f) => f.type));
        read.forEach((f, i) => {
          const original = wrote[i];
          if (original === undefined) throw new Error('feature count differs');
          expect(f.strand).toBe(original.strand);
          expect(back.featureSequence(f)).toBe(doc.featureSequence(original));
        });
      }),
      { numRuns: 200 },
    );
  });
});
