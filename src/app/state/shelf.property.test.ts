import fc from 'fast-check';

import { type AssemblyPart, type DigestFragment, SeqDocument } from '@/core';

import { type CloningReaction, isSidebarReaction } from './cloningReaction';
import { EditorStore } from './editorStore';

/**
 * The fragment shelf (`EditorStore` shelf methods) driven by random command
 * sequences and compared after every step with a plain array of parts: add,
 * remove, flip, move up and down, treat with phosphatase or take it back,
 * clear, restore a stored shelf, and open another document in between. Ops
 * on ids that are not on the shelf, and moves past either end, must change
 * nothing; ids handed out by `addToShelf` are never reused; and nothing the
 * shelf does moves the Cloning tab's or the Bench's reaction picker.
 *
 * Undo and Redo are among the commands (item 49): the model keeps the
 * shelves it has been, and every change that changed something is a step,
 * while a restored shelf is where the history starts again.
 *
 * Every short sequence of commands over two parts is also run exhaustively,
 * so the corners of the model (moving the only part, flipping twice,
 * restoring over a filled shelf) never depend on the generator.
 */

function must<T>(value: T | null | undefined, what: string): T {
  if (value === null || value === undefined) throw new Error(`expected ${what}`);
  return value;
}

function fragment(source: string, sequence = 'ACGT'): DigestFragment {
  return {
    sequence,
    features: [],
    range: { start: 0, end: sequence.length },
    left: { kind: "5'", overhang: 'AATT', enzyme: 'EcoRI' },
    right: { kind: 'blunt', overhang: '', enzyme: null },
    source,
  };
}

type Command =
  | { readonly kind: 'add'; readonly source: string }
  | { readonly kind: 'remove'; readonly pick: number }
  | { readonly kind: 'flip'; readonly pick: number; readonly sequence: string }
  | { readonly kind: 'move'; readonly pick: number; readonly delta: -1 | 1 }
  | { readonly kind: 'dephosphorylate'; readonly pick: number; readonly on: boolean }
  | { readonly kind: 'clear' }
  | { readonly kind: 'restore'; readonly sources: readonly string[] }
  | { readonly kind: 'open' }
  | { readonly kind: 'undo' }
  | { readonly kind: 'redo' };

/**
 * `pick` chooses a part by position; one past the end names an id that is
 * not on the shelf (a part removed earlier, or never there).
 */
function pickId(model: readonly AssemblyPart[], pick: number, gone: readonly string[]): string {
  const i = pick % (model.length + 1);
  return model[i]?.id ?? gone[pick % Math.max(1, gone.length)] ?? 'never-there';
}

interface Run {
  readonly store: EditorStore;
  model: AssemblyPart[];
  readonly handedOut: string[];
  readonly gone: string[];
  restored: number;
  /** The shelves before each step, oldest first, and the ones undone, newest last. */
  past: AssemblyPart[][];
  future: AssemblyPart[][];
}

function start(reaction: CloningReaction): Run {
  const store = new EditorStore();
  store.setCloningReaction(reaction);
  return { store, model: [], handedOut: [], gone: [], restored: 0, past: [], future: [] };
}

/** Applies a command to the store and the model, keeping the model's history as the shelf's is kept. */
function step(run: Run, c: Command): void {
  const before = run.model;
  const changed = apply(run, c);
  if (c.kind === 'undo' || c.kind === 'redo' || c.kind === 'open') return;
  if (c.kind === 'restore') {
    if (changed) {
      run.past = [];
      run.future = [];
    }
    return;
  }
  if (changed) {
    run.past.push(before);
    run.future = [];
  }
}

/** Applies a command to the store and the same change, done the obvious way, to the model; whether it changed the shelf. */
function apply(run: Run, c: Command): boolean {
  const { store } = run;
  switch (c.kind) {
    case 'add': {
      const frag = fragment(c.source);
      const id = store.addToShelf(frag);
      expect(run.handedOut).not.toContain(id);
      run.handedOut.push(id);
      run.model = [...run.model, { id, fragment: frag, flipped: false }];
      return true;
    }
    case 'remove': {
      const id = pickId(run.model, c.pick, run.gone);
      store.removeFromShelf(id);
      const there = run.model.some((p) => p.id === id);
      if (there) run.gone.push(id);
      run.model = run.model.filter((p) => p.id !== id);
      return there;
    }
    case 'flip': {
      const id = pickId(run.model, c.pick, run.gone);
      const turned = fragment('turned', c.sequence);
      store.flipShelfPart(id, turned);
      run.model = run.model.map((p) =>
        p.id === id ? { id, fragment: turned, flipped: !p.flipped } : p,
      );
      return run.model.some((p) => p.id === id);
    }
    case 'move': {
      const id = pickId(run.model, c.pick, run.gone);
      store.moveShelfPart(id, c.delta);
      const i = run.model.findIndex((p) => p.id === id);
      const j = i + c.delta;
      if (i >= 0 && j >= 0 && j < run.model.length) {
        const next = [...run.model];
        const a = must(next[i], 'part');
        next[i] = must(next[j], 'neighbour');
        next[j] = a;
        run.model = next;
        return true;
      }
      return false;
    }
    case 'dephosphorylate': {
      const id = pickId(run.model, c.pick, run.gone);
      store.setShelfPartDephosphorylated(id, c.on);
      // Asking for what the part already is (untreated counts as off) is no change.
      const part = run.model.find((p) => p.id === id);
      if (part === undefined || (part.fragment.dephosphorylated === true) === c.on) return false;
      run.model = run.model.map((p) =>
        p === part ? { ...p, fragment: { ...p.fragment, dephosphorylated: c.on } } : p,
      );
      return true;
    }
    case 'clear': {
      store.clearShelf();
      const had = run.model.length > 0;
      run.gone.push(...run.model.map((p) => p.id));
      run.model = [];
      return had;
    }
    case 'restore': {
      run.restored += 1;
      const parts = c.sources.map((s, i) => ({
        id: `stored-${run.restored}-${i}`,
        fragment: fragment(s),
        flipped: i % 2 === 1,
      }));
      store.restoreShelf(parts);
      // What is being collected wins over what was stored; nothing stored changes nothing.
      if (run.model.length === 0 && parts.length > 0) {
        run.model = parts;
        return true;
      }
      return false;
    }
    case 'open':
      store.openDocument(SeqDocument.create({ sequence: 'ACGTACGT', name: 'another' }));
      return false;
    case 'undo': {
      store.undoShelf();
      const back = run.past.pop();
      if (back === undefined) return false;
      run.future.push(run.model);
      run.model = back;
      return true;
    }
    case 'redo': {
      store.redoShelf();
      const again = run.future.pop();
      if (again === undefined) return false;
      run.past.push(run.model);
      run.model = again;
      return true;
    }
  }
}

/** The reaction picked, in whichever of the sidebar and the Bench it belongs to. */
function picked(store: EditorStore, reaction: CloningReaction): CloningReaction {
  const { sidebarReaction, bench } = store.getState();
  return isSidebarReaction(reaction) ? sidebarReaction : bench.reaction;
}

function check(run: Run, reaction: CloningReaction): void {
  const { shelf, shelfUndo, shelfRedo } = run.store.getState();
  expect(shelf).toEqual(run.model);
  expect(picked(run.store, reaction)).toBe(reaction);
  expect(new Set(shelf.map((p) => p.id)).size).toBe(shelf.length);
  expect(shelfUndo !== null).toBe(run.past.length > 0);
  expect(shelfRedo !== null).toBe(run.future.length > 0);
}

const sourceArb = fc.constantFrom('vector', 'insert', 'pUC19', 'frag');
const commandArb: fc.Arbitrary<Command> = fc.oneof(
  { arbitrary: fc.record({ kind: fc.constant('add' as const), source: sourceArb }), weight: 4 },
  { arbitrary: fc.record({ kind: fc.constant('remove' as const), pick: fc.nat(8) }), weight: 2 },
  {
    arbitrary: fc.record({
      kind: fc.constant('flip' as const),
      pick: fc.nat(8),
      sequence: fc.constantFrom('TTTT', 'GAATTC', 'A'),
    }),
    weight: 2,
  },
  {
    arbitrary: fc.record({
      kind: fc.constant('move' as const),
      pick: fc.nat(8),
      delta: fc.constantFrom<-1 | 1>(-1, 1),
    }),
    weight: 3,
  },
  {
    arbitrary: fc.record({
      kind: fc.constant('dephosphorylate' as const),
      pick: fc.nat(8),
      on: fc.boolean(),
    }),
    weight: 2,
  },
  { arbitrary: fc.constant({ kind: 'clear' as const }), weight: 1 },
  {
    arbitrary: fc.record({
      kind: fc.constant('restore' as const),
      sources: fc.array(sourceArb, { maxLength: 3 }),
    }),
    weight: 1,
  },
  { arbitrary: fc.constant({ kind: 'open' as const }), weight: 1 },
  { arbitrary: fc.constant({ kind: 'undo' as const }), weight: 3 },
  { arbitrary: fc.constant({ kind: 'redo' as const }), weight: 2 },
);

const REACTIONS: readonly CloningReaction[] = [
  'digest',
  'pcr',
  'mutagenesis',
  'ligation',
  'golden-gate',
  'gibson',
  'gateway',
];

describe('the fragment shelf', () => {
  it('matches a plain array under random command sequences', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...REACTIONS),
        fc.array(commandArb, { maxLength: 40 }),
        (reaction, commands) => {
          const run = start(reaction);
          check(run, reaction);
          for (const c of commands) {
            step(run, c);
            check(run, reaction);
          }
        },
      ),
      { numRuns: 200 },
    );
  });

  it('matches it for every sequence of three commands after two parts go on', () => {
    const small: Command[] = [
      { kind: 'add', source: 'c' },
      { kind: 'remove', pick: 0 },
      { kind: 'remove', pick: 2 },
      { kind: 'flip', pick: 1, sequence: 'TT' },
      { kind: 'flip', pick: 2, sequence: 'TT' },
      { kind: 'move', pick: 0, delta: -1 },
      { kind: 'move', pick: 0, delta: 1 },
      { kind: 'move', pick: 1, delta: 1 },
      { kind: 'move', pick: 2, delta: 1 },
      { kind: 'dephosphorylate', pick: 0, on: true },
      { kind: 'dephosphorylate', pick: 1, on: false },
      { kind: 'clear' },
      { kind: 'restore', sources: ['s'] },
      { kind: 'restore', sources: [] },
      { kind: 'undo' },
      { kind: 'redo' },
    ];
    let runs = 0;
    for (const a of small)
      for (const b of small)
        for (const c of small) {
          const run = start('ligation');
          step(run, { kind: 'add', source: 'a' });
          step(run, { kind: 'add', source: 'b' });
          for (const cmd of [a, b, c]) {
            step(run, cmd);
            check(run, 'ligation');
          }
          runs += 1;
        }
    expect(runs).toBe(small.length ** 3);
  });

  it('never moves the reaction picker when a fragment lands', () => {
    for (const reaction of REACTIONS) {
      const store = new EditorStore();
      store.setCloningReaction(reaction);
      const before = picked(store, reaction);
      store.addToShelf(fragment('x'));
      store.addToShelf(fragment('y'));
      expect(before).toBe(reaction);
      expect(picked(store, reaction)).toBe(reaction);
      expect(store.getState().shelf).toHaveLength(2);
    }
  });

  it('marks a part treated or untreated without touching anything else of it', () => {
    const store = new EditorStore();
    const id = store.addToShelf(fragment('v', 'GAATTCAA'));
    const other = store.addToShelf(fragment('w'));
    const [, untouched] = store.getState().shelf;
    for (const on of [true, true, false, true, false]) {
      store.setShelfPartDephosphorylated(id, on);
      const [part, second] = store.getState().shelf;
      expect(must(part, 'part').fragment).toEqual({
        ...fragment('v', 'GAATTCAA'),
        dephosphorylated: on,
      });
      expect(must(part, 'part').flipped).toBe(false);
      expect(second).toBe(untouched);
      expect(second?.id).toBe(other);
    }
  });
});
