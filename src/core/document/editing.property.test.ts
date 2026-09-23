import fc from 'fast-check';

import {
  type DocShape,
  RefModel,
  docShapeArb,
  layFeatures,
  opShapeArb,
  resolveOp,
} from '@/test/editArbitraries';

import { type Feature, flipStrand, isValidSegment } from '../features';
import { History } from '../history';
import { SeqDocument } from './seqDocument';

/**
 * Random editing sessions checked base by base against a naive reference
 * (`RefModel`): after every edit the document's sequence must equal the
 * model's exactly, and every feature must cover exactly the bases it
 * covered before, less the deleted ones, plus — only for an insertion inside
 * it — the new bases as one run at the right spot. Any silent corruption of
 * a plasmid shows up here as a counterexample fast-check shrinks for you.
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

function expectSameArray(
  actual: readonly number[],
  expected: readonly number[],
  what: string,
): void {
  if (actual.length !== expected.length || actual.some((v, i) => v !== expected[i])) {
    throw new Error(`${what}: covers [${actual.join(',')}], expected [${expected.join(',')}]`);
  }
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
          const coveredBefore = new Map(before.features.all().map((f) => [f.id, model.covered(f)]));
          doc = doc.apply(op);
          const step = model.apply(op);

          // 1. The nucleotides.
          expect(doc.sequence.toString()).toBe(model.text);
          expect(doc.topology).toBe(model.topology);

          // 2. Every segment still lies on the sequence.
          for (const f of doc.features) {
            for (const seg of f.segments) {
              expect(isValidSegment(seg, doc.length, doc.topology)).toBe(true);
            }
          }

          // 3. Features that were there keep exactly their own bases.
          const insertedSet = new Set(step.inserted);
          for (const f of before.features) {
            const old = coveredBefore.get(f.id) ?? [];
            let core = old.filter((id) => !step.deleted.has(id));
            if (step.reversed) core = core.reverse();
            const after = doc.getFeature(f.id);
            const isSite = f.segments.every((s) => s.kind === 'site');
            if (core.length === 0 && !isSite) {
              expect(after, `${f.id} lost every base but survived`).toBeUndefined();
              continue;
            }
            if (after === undefined) throw new Error(`${f.id} was dropped though bases remain`);
            expect(after.type).toBe(f.type);
            expect(after.strand).toBe(step.reversed ? flipStrand(f.strand) : f.strand);
            const covered = model.covered(after);
            expectSameArray(
              covered.filter((id) => !insertedSet.has(id)),
              core,
              f.id,
            );
            const grown = covered.filter((id) => insertedSet.has(id));
            if (grown.length > 0) {
              // All the new bases, once, in order, as one run...
              expectSameArray(grown, step.inserted, `${f.id} growth`);
              const at = covered.indexOf(step.inserted[0] ?? -1);
              expectSameArray(covered.slice(at, at + grown.length), step.inserted, `${f.id} run`);
              // ...between the two bases they were inserted between.
              const firstIndex = model.cells.findIndex((c) => c.id === step.inserted[0]);
              if (at > 0) expect(covered[at - 1]).toBe(model.leftOf(firstIndex));
              const lastIndex = firstIndex + step.inserted.length;
              const right = model.cells[lastIndex % model.length]?.id;
              if (at + grown.length < covered.length)
                expect(covered[at + grown.length]).toBe(right);
            }
          }

          // 4. Pasted and added features read what they read in their fragment.
          if (op.type === 'insertFragment') {
            const frag = SeqDocument.create({
              sequence: op.fragment.sequence,
              features: op.fragment.features,
            });
            for (const f of op.fragment.features) {
              expect(doc.featureSequence(f.id)).toBe(frag.featureSequence(f));
              for (const id of model.covered(doc.requireFeature(f.id))) {
                expect(insertedSet.has(id)).toBe(true);
              }
            }
          }
          if (op.type === 'addFeature') {
            expect(doc.featureSequence(op.feature.id)).toBe(before.featureSequence(op.feature));
          }
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
