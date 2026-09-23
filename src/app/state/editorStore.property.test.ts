import fc from 'fast-check';

import { SeqDocument } from '@/core';
import { docShapeArb, layFeatures, opShapeArb, resolveOp } from '@/test/editArbitraries';

import { EditorStore } from './editorStore';

/**
 * The same random editing sessions as `editing.property.test.ts`, driven
 * through the store the UI calls, with undo and redo mixed in at random.
 * After every command the store must hold exactly the molecule a plain
 * undo stack of snapshots says it should: no edit lost, doubled or
 * resurrected by undo, redo, working-copy forking or selection handling.
 */

const commandArb = fc.oneof(
  { arbitrary: opShapeArb.map((shape) => ({ kind: 'edit' as const, shape })), weight: 4 },
  // Bursts, so redo after several undos (and past the ends) is common.
  {
    arbitrary: fc.record({
      kind: fc.constant('undo' as const),
      times: fc.integer({ min: 1, max: 5 }),
    }),
    weight: 2,
  },
  {
    arbitrary: fc.record({
      kind: fc.constant('redo' as const),
      times: fc.integer({ min: 1, max: 5 }),
    }),
    weight: 2,
  },
);

function molecule(doc: SeqDocument | null) {
  if (doc === null) throw new Error('no document');
  return {
    text: doc.sequence.toString(),
    topology: doc.topology,
    features: structuredClone(doc.features.all()),
  };
}

describe('EditorStore under random editing with undo and redo', () => {
  it('always holds what a plain undo stack of snapshots says it should', () => {
    fc.assert(
      fc.property(docShapeArb, fc.array(commandArb, { maxLength: 30 }), (shape, commands) => {
        const opened = SeqDocument.create({
          sequence: shape.sequence,
          topology: shape.topology,
          features: layFeatures(shape),
        });
        const store = new EditorStore();
        store.openDocument(opened, 'random.gb');
        const stack = [molecule(opened)];
        let at = 0;
        for (const command of commands) {
          if (command.kind === 'undo') {
            for (let i = 0; i < command.times; i++) {
              store.undo();
              at = Math.max(0, at - 1);
              expect(molecule(store.document)).toEqual(stack[at]);
            }
          } else if (command.kind === 'redo') {
            for (let i = 0; i < command.times; i++) {
              store.redo();
              at = Math.min(stack.length - 1, at + 1);
              expect(molecule(store.document)).toEqual(stack[at]);
            }
          } else {
            const doc = store.document;
            if (doc === null) throw new Error('no document');
            const op = resolveOp(doc, command.shape);
            if (op === null) continue;
            const expected = doc.apply(op);
            store.apply(op);
            if (expected === doc) continue;
            stack.length = at + 1;
            stack.push(molecule(expected));
            at += 1;
          }
          expect(molecule(store.document)).toEqual(stack[at]);
        }
        // And all the way back is what was opened.
        for (const _ of stack) store.undo();
        expect(molecule(store.document)).toEqual(molecule(opened));
      }),
      { numRuns: 150 },
    );
  });
});
