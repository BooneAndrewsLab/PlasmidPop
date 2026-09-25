import fc from 'fast-check';

import { type Coalesce, History, SeqDocument } from '@/core';
import {
  type DocShape,
  type OpShape,
  docShapeArb,
  layFeatures,
  opShapeArb,
  resolveOp,
} from '@/test/editArbitraries';
import { historyView, stateView } from '@/test/historyViews';

import { type HistoryToStore, decodeHistory, encodeHistory, storedSize } from './historyCodec';

/**
 * Random editing sessions — edits of every kind, runs of typing, undo, redo,
 * jumps, downloads, a history limit now and then small enough to be hit —
 * written as a history row, put through a structured clone as IndexedDB
 * does, and read back (item 51). With room for everything, what comes back
 * must be the same history in every respect a user or the app can observe:
 * each state's bases, features (multi-segment and across the origin
 * included), name, topology and description, each step's label, time and
 * merged count, the position with the redo steps above it, `truncated`,
 * `startedAt`, and the two baselines. With a small budget it must be the
 * newest part of that history, cut where the budget says.
 */

const RUNS = 200;

type Action =
  | { readonly kind: 'edit'; readonly op: OpShape; readonly run: boolean; readonly pause: number }
  | { readonly kind: 'undo' }
  | { readonly kind: 'redo' }
  | { readonly kind: 'jump'; readonly to: number }
  | { readonly kind: 'seal' }
  | { readonly kind: 'download' };

const actionArb: fc.Arbitrary<Action> = fc.oneof(
  {
    arbitrary: fc.record({
      kind: fc.constant('edit' as const),
      op: opShapeArb,
      run: fc.boolean(),
      pause: fc.nat({ max: 3000 }),
    }),
    weight: 8,
  },
  { arbitrary: fc.constant({ kind: 'undo' as const }), weight: 2 },
  { arbitrary: fc.constant({ kind: 'redo' as const }), weight: 1 },
  { arbitrary: fc.record({ kind: fc.constant('jump' as const), to: fc.nat() }), weight: 1 },
  { arbitrary: fc.constant({ kind: 'seal' as const }), weight: 1 },
  { arbitrary: fc.constant({ kind: 'download' as const }), weight: 1 },
);

const sessionArb = fc.record({
  shape: docShapeArb,
  actions: fc.array(actionArb, { maxLength: 40 }),
  limit: fc.oneof(fc.constant(200), fc.integer({ min: 1, max: 12 })),
  /** Whether the history is a working copy's, started from a file it keeps apart. */
  fork: fc.boolean(),
  start: fc.integer({ min: 0, max: 2e12 }),
});

/** A run of typing: an insertion merges into the one before it while the caret follows on. */
function runOf(position: number, length: number): Coalesce {
  return {
    follows: `type@${position}`,
    key: `type@${position + length}`,
    limit: 60,
    relabel: (n) => `Insert ${n} bases (run)`,
  };
}

interface Session {
  readonly input: HistoryToStore;
}

function play(
  shape: DocShape,
  actions: readonly Action[],
  limit: number,
  fork: boolean,
  start: number,
): Session {
  const file = SeqDocument.create({
    name: 'pFile',
    sequence: shape.sequence,
    topology: shape.topology,
    features: layFeatures(shape),
    metadata: { description: 'from a file', comments: ['kept'] },
  });
  const first = fork ? file.rename('pFile copy') : file;
  let t = start;
  let h = History.create(first, { limit, at: t });
  let saved: SeqDocument | null = fork ? null : first;
  for (const a of actions) {
    switch (a.kind) {
      case 'edit': {
        const op = resolveOp(h.present, a.op);
        if (op === null) break;
        t += a.pause;
        const next = h.present.apply(op);
        const coalesce =
          a.run && op.type === 'insert' ? runOf(op.position, op.text.length) : undefined;
        h = h.push(next, op.type, t, coalesce);
        break;
      }
      case 'undo':
        h = h.undo().seal();
        break;
      case 'redo':
        h = h.redo().seal();
        break;
      case 'jump':
        h = h.jumpTo(a.to % (h.size + 1)).seal();
        break;
      case 'seal':
        h = h.seal();
        break;
      case 'download':
        saved = h.present;
        h = h.seal();
        break;
    }
  }
  return { input: { history: h, opened: fork ? file : first, saved, origin: fork ? file : null } };
}

describe('stored histories', () => {
  it('come back exactly as they went in', () => {
    fc.assert(
      fc.property(sessionArb, ({ shape, actions, limit, fork, start }) => {
        const { input } = play(shape, actions, limit, fork, start);
        const row = encodeHistory('doc', input);
        expect(row).not.toBeNull();
        const back = decodeHistory(structuredClone(row), input.origin);
        expect(back).not.toBeNull();
        if (back === null) return;
        expect(historyView(back.history)).toEqual(historyView(input.history));
        expect(stateView(back.opened)).toEqual(stateView(input.opened));
        if (input.opened === input.origin) expect(back.opened).toBe(input.origin);
        if (input.saved === null) expect(back.saved).toBeNull();
        else {
          expect(back.saved).not.toBeNull();
          expect(stateView(back.saved ?? input.saved)).toEqual(stateView(input.saved));
        }
        // A baseline that is one of the states comes back as that state, so
        // "is this the downloaded version" stays a matter of identity.
        const states = input.history.toRecord().states;
        const i = input.saved === null ? -1 : states.indexOf(input.saved);
        if (i !== -1) expect(back.saved).toBe(back.history.stateAt(i));
        // And a second trip changes nothing: the row is stable.
        const again = encodeHistory('doc', {
          history: back.history,
          opened: back.opened,
          saved: back.saved,
          origin: input.origin,
        });
        expect(again).toEqual({ ...row, updatedAt: again?.updatedAt });
      }),
      { numRuns: RUNS },
    );
  });

  it('keep the newest part that fits a budget, the present always among it', () => {
    fc.assert(
      fc.property(
        sessionArb,
        fc.integer({ min: 0, max: 8000 }),
        ({ shape, actions, limit, fork, start }, budget) => {
          const { input } = play(shape, actions, limit, fork, start);
          const row = encodeHistory('doc', input, budget);
          const original = input.history.toRecord();
          if (row === null) {
            // Only when the present alone is over the budget.
            const alone = encodeHistory(
              'doc',
              { ...input, history: History.create(input.history.present), saved: null },
              Infinity,
            );
            expect(storedSize(alone)).toBeGreaterThan(budget);
            return;
          }
          expect(storedSize(row)).toBeLessThanOrEqual(budget);
          const back = decodeHistory(structuredClone(row), input.origin);
          expect(back).not.toBeNull();
          if (back === null) return;
          const kept = back.history.toRecord();
          const lo = original.position - kept.position;
          expect(lo).toBeGreaterThanOrEqual(0);
          expect(kept.states.map(stateView)).toEqual(
            original.states.slice(lo, lo + kept.states.length).map(stateView),
          );
          expect(kept.steps).toEqual(original.steps.slice(lo, lo + kept.steps.length));
          expect(stateView(back.history.present)).toEqual(stateView(input.history.present));
          expect(kept.truncated).toBe(original.truncated || lo > 0);
          expect(kept.startedAt).toBe(
            lo === 0 ? original.startedAt : (original.steps[lo - 1]?.at ?? NaN),
          );
          // Redo steps are only given up once no undo step is left.
          if (kept.steps.length < original.steps.length - lo) expect(kept.position).toBe(0);
        },
      ),
      { numRuns: RUNS },
    );
  });
});
