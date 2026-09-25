import { type Coalesce, History, MAX_STATE_NAME, cleanStateName } from './history';

describe('History', () => {
  it('pushes, undoes and redoes with labels', () => {
    let h = History.create('a');
    expect(h.canUndo).toBe(false);
    expect(h.canRedo).toBe(false);
    h = h.push('b', 'to b').push('c', 'to c');
    expect(h.present).toBe('c');
    expect(h.undoLabel).toBe('to c');
    expect(h.undoDepth).toBe(2);

    h = h.undo();
    expect(h.present).toBe('b');
    expect(h.redoLabel).toBe('to c');
    expect(h.undoLabel).toBe('to b');

    h = h.undo();
    expect(h.present).toBe('a');
    expect(h.canUndo).toBe(false);
    expect(h.undo()).toBe(h);

    h = h.redo().redo();
    expect(h.present).toBe('c');
    expect(h.canRedo).toBe(false);
    expect(h.redo()).toBe(h);
  });

  it('a new push discards redo steps', () => {
    const h = History.create(1).push(2, 'two').undo().push(3, 'three');
    expect(h.present).toBe(3);
    expect(h.canRedo).toBe(false);
    expect(h.undo().present).toBe(1);
  });

  it('ignores pushes of the identical state', () => {
    const h = History.create('a');
    expect(h.push('a', 'noop')).toBe(h);
  });

  it('caps the undo depth', () => {
    let h = History.create(0, { limit: 3 });
    for (let i = 1; i <= 10; i++) h = h.push(i, `step ${i}`);
    expect(h.undoDepth).toBe(3);
    h = h.undo().undo().undo();
    expect(h.present).toBe(7);
    expect(h.canUndo).toBe(false);
  });

  it('lists all changes and jumps to any position', () => {
    let h = History.create('a').push('b', 'to b').push('c', 'to c').push('d', 'to d');
    expect(h.labels).toEqual(['to b', 'to c', 'to d']);
    expect(h.position).toBe(3);

    h = h.jumpTo(1);
    expect(h.present).toBe('b');
    expect(h.position).toBe(1);
    expect(h.labels).toEqual(['to b', 'to c', 'to d']);
    expect(h.redoLabel).toBe('to c');

    h = h.jumpTo(3);
    expect(h.present).toBe('d');
    expect(h.jumpTo(3)).toBe(h);
    expect(h.jumpTo(-5).present).toBe('a');
    expect(h.jumpTo(99).present).toBe('d');

    // A new change from the middle drops the undone tail from the list.
    h = h.jumpTo(1).push('e', 'to e');
    expect(h.labels).toEqual(['to b', 'to e']);
    expect(h.position).toBe(2);
  });

  it('pairs every change with the state it produces, applied or undone', () => {
    let h = History.create('a').push('b', 'to b').push('c', 'to c').push('d', 'to d');
    expect(h.steps.map((s) => [s.position, s.label, s.state])).toEqual([
      [1, 'to b', 'b'],
      [2, 'to c', 'c'],
      [3, 'to d', 'd'],
    ]);
    expect(h.size).toBe(3);

    // Undone changes keep their state and position, so redo is reversible.
    h = h.jumpTo(1);
    expect(h.steps.map((s) => [s.position, s.label, s.state])).toEqual([
      [1, 'to b', 'b'],
      [2, 'to c', 'c'],
      [3, 'to d', 'd'],
    ]);
    expect(h.stateAt(0)).toBe('a');
    expect(h.stateAt(1)).toBe('b');
    expect(h.stateAt(3)).toBe('d');
    expect(h.stateAt(4)).toBeUndefined();
    expect(h.stateAt(-1)).toBeUndefined();
    expect(History.create('a').steps).toEqual([]);
  });

  it('keeps the time of each change across undo and redo', () => {
    const h = History.create('a', { at: 1000 }).push('b', 'to b', 2000).push('c', 'to c', 3000);
    expect(h.startedAt).toBe(1000);
    expect(h.steps.map((s) => s.at)).toEqual([2000, 3000]);
    expect(
      h
        .undo()
        .redo()
        .steps.map((s) => s.at),
    ).toEqual([2000, 3000]);
  });

  it('reports that dropped steps left the starting state behind', () => {
    let h = History.create(0, { limit: 2, at: 10 });
    expect(h.truncated).toBe(false);
    h = h.push(1, 'one', 20).push(2, 'two', 30);
    expect(h.truncated).toBe(false);
    h = h.push(3, 'three', 40);
    // Step 0 is no longer the opened state; it is dated by the change that
    // produced the oldest state still kept.
    expect(h.truncated).toBe(true);
    expect(h.startedAt).toBe(20);
    expect(h.stateAt(0)).toBe(1);
    expect(h.steps.map((s) => s.state)).toEqual([2, 3]);
  });

  it('is immutable', () => {
    const a = History.create('x');
    const b = a.push('y', 'y');
    expect(a.present).toBe('x');
    expect(a.canUndo).toBe(false);
    expect(b.present).toBe('y');
  });
});

describe('History coalescing', () => {
  /** A run of typing: each change picks up where the last one left off. */
  const typed = (before: number, after: number): Coalesce => ({
    follows: `type@${before}`,
    key: `type@${after}`,
    relabel: (n) => `Insert ${n} bases`,
  });

  it('folds a run of changes into one step back to where it started', () => {
    const h = History.create('', { at: 0 })
      .push('A', 'Insert 1 base', 10, typed(0, 1))
      .push('AC', 'Insert 1 base', 20, typed(1, 2))
      .push('ACG', 'Insert 1 base', 30, typed(2, 3));
    expect(h.present).toBe('ACG');
    expect(h.size).toBe(1);
    expect(h.undoLabel).toBe('Insert 3 bases');
    // One undo takes the whole run back.
    expect(h.undo().present).toBe('');
    // The step is dated by the last change in it.
    expect(h.steps.map((step) => step.at)).toEqual([30]);
  });

  it('starts a new step when the run is broken', () => {
    const base = History.create('', { at: 0 }).push('A', 'Insert 1 base', 10, typed(0, 1));
    // A change that does not follow on: typing somewhere else.
    expect(base.push('AX', 'Insert 1 base', 20, typed(7, 8)).size).toBe(2);
    // A pause longer than the window.
    expect(base.push('AC', 'Insert 1 base', 9000, typed(1, 2)).size).toBe(2);
    // A change with no run at all.
    expect(base.push('AC', 'Insert 1 base', 20).size).toBe(2);
    // The run hit its limit.
    expect(base.push('AC', 'Insert 1 base', 20, { ...typed(1, 2), limit: 1 }).size).toBe(2);
    // The window can be set per run.
    expect(base.push('AC', 'Insert 1 base', 60, { ...typed(1, 2), withinMs: 20 }).size).toBe(2);
  });

  it('never merges across an undo', () => {
    const h = History.create('', { at: 0 })
      .push('A', 'Insert 1 base', 10, typed(0, 1))
      .push('AC', 'Insert 1 base', 20, typed(1, 2))
      .push('ACX', 'Add feature', 30)
      .undo();
    // The step the run left behind still offers `type@2`, but there is a redo
    // waiting: the user has stepped out of the run, so it is over.
    expect(h.present).toBe('AC');
    const next = h.push('ACG', 'Insert 1 base', 40, typed(2, 3));
    expect(next.size).toBe(2);
    expect(next.undo().present).toBe('AC');
  });

  it('seals a step so the state stays reachable', () => {
    const h = History.create('', { at: 0 })
      .push('A', 'Insert 1 base', 10, typed(0, 1))
      .seal()
      .push('AC', 'Insert 1 base', 20, typed(1, 2));
    expect(h.size).toBe(2);
    expect(h.stateAt(1)).toBe('A');
    // Sealing an empty history, or one already sealed, changes nothing.
    const plain = History.create('x');
    expect(plain.seal()).toBe(plain);
    const once = plain.push('y', 'y', 0, typed(0, 1)).seal();
    expect(once.seal()).toBe(once);
  });

  it('keeps counting a run that carries on after a merge', () => {
    const h = History.create('', { at: 0 })
      .push('A', 'Insert 1 base', 10, typed(0, 1))
      .push('AC', 'Insert 1 base', 20, typed(1, 2))
      .push('ACG', 'Insert 1 base', 30, typed(2, 3))
      .push('ACGT', 'Insert 1 base', 40, { ...typed(3, 4), limit: 4 });
    expect(h.undoLabel).toBe('Insert 4 bases');
    // A fifth would be over the limit of four.
    expect(h.push('ACGTA', 'Insert 1 base', 50, { ...typed(4, 5), limit: 4 }).size).toBe(2);
  });
});

describe('History records', () => {
  const typed = (before: number, after: number): Coalesce => ({
    follows: `type@${before}`,
    key: `type@${after}`,
    relabel: (n) => `Insert ${n} bases`,
  });

  /** Everything a history says about itself, for comparing two of them. */
  const observed = <T>(h: History<T>) => ({
    present: h.present,
    position: h.position,
    size: h.size,
    labels: h.labels,
    steps: h.steps,
    startedAt: h.startedAt,
    truncated: h.truncated,
    limit: h.limit,
    states: Array.from({ length: h.size + 1 }, (_, i) => h.stateAt(i)),
  });

  it('lays a history out flat, undone steps and merged counts included, and rebuilds it', () => {
    const h = History.create('', { at: 5 })
      .push('A', 'Insert 1 base', 10, typed(0, 1))
      .push('AC', 'Insert 1 base', 20, typed(1, 2))
      .push('ACX', 'Replace', 30)
      .push('ACXY', 'Insert 1 base', 40)
      .undo();
    const record = h.toRecord();
    expect(record).toEqual({
      states: ['', 'AC', 'ACX', 'ACXY'],
      steps: [
        { label: 'Insert 2 bases', at: 20, merged: 2 },
        { label: 'Replace', at: 30 },
        { label: 'Insert 1 base', at: 40 },
      ],
      position: 2,
      limit: 200,
      startedAt: 5,
      truncated: false,
    });
    const back = History.fromRecord(record);
    expect(observed(back)).toEqual(observed(h));
    // Redo and undo work on the rebuilt one as on the original.
    expect(back.redo().present).toBe('ACXY');
    expect(back.jumpTo(0).present).toBe('');
  });

  it('comes back sealed: an open run does not continue after a rebuild', () => {
    const h = History.create('', { at: 0 }).push('A', 'Insert 1 base', 10, typed(0, 1));
    expect(h.push('AC', 'Insert 1 base', 20, typed(1, 2)).size).toBe(1);
    const back = History.fromRecord(h.toRecord());
    expect(back.push('AC', 'Insert 1 base', 20, typed(1, 2)).size).toBe(2);
  });

  it('keeps truncation and the start time of a capped history', () => {
    let h = History.create(0, { limit: 3, at: 0 });
    for (let i = 1; i <= 6; i++) h = h.push(i, `step ${i}`, i * 10);
    const back = History.fromRecord(h.toRecord());
    expect(observed(back)).toEqual(observed(h));
    expect(back.truncated).toBe(true);
    expect(back.startedAt).toBe(30);
    expect(back.push(7, 'step 7', 70).stateAt(0)).toBe(4);
  });

  it('rebuilds the empty history', () => {
    const h = History.create('x', { at: 1 });
    expect(observed(History.fromRecord(h.toRecord()))).toEqual(observed(h));
  });

  it('refuses a record that does not describe a history', () => {
    const good = History.create('a', { at: 0 }).push('b', 'b', 1).toRecord();
    expect(() => History.fromRecord({ ...good, states: ['a'] })).toThrow(RangeError);
    expect(() => History.fromRecord({ ...good, position: 2 })).toThrow(RangeError);
    expect(() => History.fromRecord({ ...good, position: -1 })).toThrow(RangeError);
    expect(() => History.fromRecord({ ...good, position: 0.5 })).toThrow(RangeError);
    expect(() => History.fromRecord({ ...good, limit: 0 })).toThrow(RangeError);
    expect(() =>
      History.fromRecord({
        ...good,
        limit: 1,
        states: ['a', 'b', 'c'],
        steps: [...good.steps, { label: 'c', at: 2 }],
      }),
    ).toThrow(RangeError);
  });
});

describe('History names (#4)', () => {
  const typed = (before: number, after: number): Coalesce => ({
    follows: `type@${before}`,
    key: `type@${after}`,
    relabel: (n) => `Insert ${n} bases`,
  });
  const names = <T>(h: History<T>) => h.steps.map((s) => s.name);

  const abc = () =>
    History.create('a', { at: 0 }).push('b', 'to b', 1).push('c', 'to c', 2).push('d', 'to d', 3);

  it('names the state a step leads to, and nothing else changes', () => {
    const h = abc();
    const named = h.named(2, '  Before digest ');
    expect(names(named)).toEqual([undefined, 'Before digest', undefined]);
    expect(named.present).toBe(h.present);
    expect(named.position).toBe(h.position);
    expect(named.labels).toEqual(h.labels);
    expect(named.steps.map((s) => s.state)).toEqual(h.steps.map((s) => s.state));
    expect(named.steps.map((s) => s.at)).toEqual(h.steps.map((s) => s.at));
  });

  it('is immutable: naming gives a new history and leaves the old one as it was', () => {
    const h = abc();
    const named = h.named(1, 'one');
    expect(named).not.toBe(h);
    expect(names(h)).toEqual([undefined, undefined, undefined]);
    // A name already there, a blank name on an unnamed step, and positions
    // that are not a step's give the same history back.
    expect(named.named(1, 'one')).toBe(named);
    expect(named.named(1, ' one ')).toBe(named);
    expect(h.named(2, '   ')).toBe(h);
    expect(h.named(0, 'start')).toBe(h);
    expect(h.named(4, 'past the end')).toBe(h);
    expect(h.named(1.5, 'half')).toBe(h);
  });

  it('renames, and a blank name clears it', () => {
    const h = abc().named(3, 'first').named(3, 'second');
    expect(names(h)).toEqual([undefined, undefined, 'second']);
    expect(names(h.named(3, ''))).toEqual([undefined, undefined, undefined]);
    expect(h.named(3, '').toRecord().steps[2]).toEqual({ label: 'to d', at: 3 });
  });

  it('cuts a long name to the longest kept', () => {
    const h = abc().named(1, 'x'.repeat(MAX_STATE_NAME + 20));
    expect(h.steps[0]?.name).toBe('x'.repeat(MAX_STATE_NAME));
    expect(cleanStateName(`  ${'y'.repeat(MAX_STATE_NAME - 1)} z`)).toBe(
      'y'.repeat(MAX_STATE_NAME - 1),
    );
  });

  it('survives undo, redo and jumps, and names undone steps too', () => {
    let h = abc().named(1, 'one').named(3, 'three');
    h = h.undo().undo();
    expect(h.position).toBe(1);
    expect(names(h)).toEqual(['one', undefined, 'three']);
    h = h.named(2, 'two');
    expect(names(h)).toEqual(['one', 'two', 'three']);
    expect(names(h.redo())).toEqual(['one', 'two', 'three']);
    expect(names(h.jumpTo(0))).toEqual(['one', 'two', 'three']);
    expect(names(h.jumpTo(3))).toEqual(['one', 'two', 'three']);
    // A new change drops the undone steps, names and all.
    expect(names(h.push('x', 'to x', 9))).toEqual(['one', undefined]);
  });

  it('seals the step it names: typing on starts a step of its own', () => {
    const run = History.create('', { at: 0 })
      .push('A', 'Insert 1 base', 10, typed(0, 1))
      .push('AC', 'Insert 1 base', 20, typed(1, 2));
    expect(run.push('ACG', 'Insert 1 base', 30, typed(2, 3)).size).toBe(1);
    const named = run.named(1, 'AC');
    const on = named.push('ACG', 'Insert 1 base', 30, typed(2, 3));
    expect(on.size).toBe(2);
    expect(on.stateAt(1)).toBe('AC');
    expect(on.steps[0]?.name).toBe('AC');
    // Clearing the name leaves the step sealed.
    expect(named.named(1, '').push('ACG', 'Insert 1 base', 30, typed(2, 3)).size).toBe(2);
  });

  it('keeps a named state the limit drops, whole and outside the steps', () => {
    let h = History.create(0, { limit: 3, at: 0 });
    for (let i = 1; i <= 3; i++) h = h.push(i, `step ${i}`, i * 10);
    h = h.named(1, 'one').named(2, 'two');
    for (let i = 4; i <= 6; i++) h = h.push(i, `step ${i}`, i * 10);
    expect(h.stateAt(0)).toBe(3);
    expect(h.truncated).toBe(true);
    expect(h.kept).toEqual([
      { name: 'one', label: 'step 1', at: 10, state: 1 },
      { name: 'two', label: 'step 2', at: 20, state: 2 },
    ]);
    // Kept through everything the stack does.
    expect(h.undo().redo().seal().jumpTo(0).kept).toEqual(h.kept);
    // Renamed, or forgotten with a blank name.
    expect(h.renamedKept(0, 'uno').kept[0]?.name).toBe('uno');
    expect(h.renamedKept(1, ' ').kept.map((k) => k.name)).toEqual(['one']);
    expect(h.renamedKept(0, 'one')).toBe(h);
    expect(h.renamedKept(5, 'nothing')).toBe(h);
    // Unnamed dropped steps are gone, as before.
    expect(h.kept.map((k) => k.state)).not.toContain(3);
  });

  it('keeps names and kept states through a record', () => {
    let h = History.create(0, { limit: 2, at: 0 });
    h = h.push(1, 'step 1', 10).named(1, 'one');
    h = h.push(2, 'step 2', 20).push(3, 'step 3', 30).named(2, 'three').undo();
    const record = h.toRecord();
    expect(record.steps).toEqual([
      { label: 'step 2', at: 20 },
      { label: 'step 3', at: 30, name: 'three' },
    ]);
    expect(record.kept).toEqual([{ name: 'one', label: 'step 1', at: 10, state: 1 }]);
    const back = History.fromRecord(record);
    expect(back.toRecord()).toEqual(record);
    expect(back.redo().steps[1]?.name).toBe('three');
    // A record without names, as one written before them, has none.
    const { kept: _kept, ...unnamed } = record;
    expect(History.fromRecord(unnamed).kept).toEqual([]);
  });
});
