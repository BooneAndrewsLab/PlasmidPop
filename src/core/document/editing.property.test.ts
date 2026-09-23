import fc from 'fast-check';

import {
  type DocShape,
  RefModel,
  checkEdit,
  docShapeArb,
  layFeatures,
  opShapeArb,
  resolveOp,
} from '@/test/editArbitraries';

import { type Feature } from '../features';
import { History } from '../history';
import { SeqDocument } from './seqDocument';

/**
 * Random editing sessions checked base by base against a naive reference
 * (`RefModel`, `checkEdit`): after every edit the document's sequence must
 * equal the model's exactly, and every feature must cover exactly the bases
 * it covered before, less the deleted ones, plus — only for an insertion
 * inside it — the new bases as one run at the right spot. Any silent
 * corruption of a plasmid shows up here as a counterexample fast-check
 * shrinks for you. `editing.exhaustive.test.ts` runs the same check over
 * every edit of every tiny sequence, and over real records.
 */

const RUNS = 300;

function start(shape: DocShape) {
  const doc = SeqDocument.create({
    sequence: shape.sequence,
    topology: shape.topology,
    features: layFeatures(shape),
  });
  return { doc, model: new RefModel(shape.sequence, shape.topology) };
}

describe('random editing sessions', () => {
  it('match a naive reference base by base, and keep every feature on its bases', () => {
    fc.assert(
      fc.property(docShapeArb, fc.array(opShapeArb, { maxLength: 30 }), (shape, ops) => {
        const session = start(shape);
        const model = session.model;
        let doc = session.doc;
        for (const opShape of ops) {
          const op = resolveOp(doc, opShape);
          if (op === null) continue;
          const before = doc;
          const coveredBefore = new Map(
            before.features.all().map((f) => [f.id, model.coveredBySegment(f)]),
          );
          doc = doc.apply(op);
          const step = model.apply(op);
          checkEdit(before, doc, op, model, step, coveredBefore);
        }
      }),
      { numRuns: RUNS },
    );
  });

  it('never change a version once made, so undo and redo return exactly what was there', () => {
    fc.assert(
      fc.property(docShapeArb, fc.array(opShapeArb, { maxLength: 30 }), (shape, ops) => {
        let { doc } = start(shape);
        const snapshot = (d: SeqDocument) => ({
          text: d.sequence.toString(),
          topology: d.topology,
          features: structuredClone(d.features.all()) as Feature[],
        });
        const versions = [{ doc, seen: snapshot(doc) }];
        let history = History.create(doc);
        for (const opShape of ops) {
          const op = resolveOp(doc, opShape);
          if (op === null) continue;
          doc = doc.apply(op);
          history = history.push(doc, op.type);
          versions.push({ doc, seen: snapshot(doc) });
        }
        // Later edits left every earlier version as it was.
        for (const v of versions) expect(snapshot(v.doc)).toEqual(v.seen);

        // Walking the history back and forth lands on each of them in turn.
        const reached = versions.filter((v, i) => i === 0 || v.doc !== versions[i - 1]?.doc);
        for (let i = reached.length - 1; i >= 0; i--) {
          expect(snapshot(history.present)).toEqual(reached[i]?.seen);
          history = history.undo();
        }
        expect(history.present).toBe(versions[0]?.doc);
        for (const v of reached) {
          expect(snapshot(history.present)).toEqual(v.seen);
          history = history.redo();
        }
      }),
      { numRuns: RUNS },
    );
  });
});
