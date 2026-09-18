import { History } from './history';

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
