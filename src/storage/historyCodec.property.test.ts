import fc from 'fast-check';

import { type Coalesce, type HistoryRecord, History, SeqDocument } from '@/core';
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
 * merged count and name, the named states kept outside the steps (#4), the
 * position with the redo steps above it, `truncated`, `startedAt`, and the
 * two baselines. With a small budget it must be the newest part of that
 * history, cut where the budget says, and any named state it loses must be
 * older than every one it keeps outside the steps.
 */

const RUNS = 200;

type Action =
  | { readonly kind: 'edit'; readonly op: OpShape; readonly run: boolean; readonly pause: number }
  | { readonly kind: 'undo' }
  | { readonly kind: 'redo' }
  | { readonly kind: 'jump'; readonly to: number }
  | { readonly kind: 'seal' }
  | { readonly kind: 'download' }
  | { readonly kind: 'name'; readonly at: number; readonly clear: boolean }
  | { readonly kind: 'nameKept'; readonly at: number; readonly clear: boolean }
  | { readonly kind: 'nameAll' };

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
  {
    arbitrary: fc.record({
      kind: fc.constant('name' as const),
      at: fc.nat(),
      clear: fc.boolean(),
    }),
    weight: 4,
  },
  {
    arbitrary: fc.record({
      kind: fc.constant('nameKept' as const),
      at: fc.nat(),
      clear: fc.boolean(),
    }),
    weight: 1,
  },
  // Every step named at once, so that later edits push named states past the limit.
  { arbitrary: fc.constant({ kind: 'nameAll' as const }), weight: 1 },
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
  // Every name given is new, so a name tells which state it was given to.
  let names = 0;
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
      case 'name':
        if (h.size > 0) h = h.named(1 + (a.at % h.size), a.clear ? '' : `state ${++names}`);
        break;
      case 'nameAll':
        for (let p = 1; p <= h.size; p++) h = h.named(p, `all ${++names}`);
        break;
      case 'nameKept':
        if (h.kept.length > 0) {
          h = h.renamedKept(a.at % h.kept.length, a.clear ? ' ' : `kept ${++names}`);
        }
        break;
    }
  }
  return { input: { history: h, opened: fork ? file : first, saved, origin: fork ? file : null } };
}

/** Every named state of a record, oldest first as the encoder orders them: those kept outside the steps, then the named steps. */
function namedStates(record: HistoryRecord<SeqDocument>): { name: string; state: SeqDocument }[] {
  return [
    ...(record.kept ?? []).map((k) => ({ name: k.name, state: k.state })),
    ...record.steps.flatMap((step, i) => {
      const state = record.states[i + 1];
      return step.name === undefined || state === undefined ? [] : [{ name: step.name, state }];
    }),
  ];
}

/**
 * Sessions long enough, under a limit small enough, that steps fall off the
 * bottom of the history, named ones among them (#4).
 */
const truncatingArb = fc.record({
  shape: docShapeArb,
  actions: fc.array(actionArb, { minLength: 15, maxLength: 50 }),
  limit: fc.integer({ min: 1, max: 4 }),
  fork: fc.boolean(),
  start: fc.integer({ min: 0, max: 2e12 }),
});

describe('stored histories', () => {
  it('come back exactly as they went in', () => {
    fc.assert(
      fc.property(fc.oneof(sessionArb, truncatingArb), ({ shape, actions, limit, fork, start }) => {
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
        fc.oneof(sessionArb, truncatingArb),
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
          // Named states (#4): every one that comes back is the state it was
          // given to, and those that do not are the oldest of them.
          const all = namedStates(original);
          const cameBack = new Map(namedStates(kept).map((n) => [n.name, n]));
          for (const n of cameBack.values()) {
            const was = all.find((m) => m.name === n.name);
            expect(was).toBeDefined();
            if (was !== undefined) expect(stateView(n.state)).toEqual(stateView(was.state));
          }
          const lost = all.flatMap((n, i) => (cameBack.has(n.name) ? [] : [i]));
          const outside = all.flatMap((n, i) =>
            (kept.kept ?? []).some((k) => k.name === n.name) ? [i] : [],
          );
          if (lost.length > 0 && outside.length > 0) {
            expect(Math.max(...lost)).toBeLessThan(Math.min(...outside));
          }
        },
      ),
      { numRuns: RUNS },
    );
  });
});
