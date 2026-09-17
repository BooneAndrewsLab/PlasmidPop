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

  it('is immutable', () => {
    const a = History.create('x');
    const b = a.push('y', 'y');
    expect(a.present).toBe('x');
    expect(a.canUndo).toBe(false);
    expect(b.present).toBe('y');
  });
});
