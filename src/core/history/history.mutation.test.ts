import { type Coalesce, DEFAULT_COALESCE_MS, History, type HistoryRecord } from './history';

// Survivors of the 1.6 mutation run (item 50): exact refusals of a record,
// the edge of the coalescing window, names that change nothing, and a
// limit that keeps no steps.

function thrown(run: () => unknown): Error {
  try {
    run();
  } catch (e) {
    if (e instanceof Error) return e;
  }
  throw new Error('expected it to throw');
}

describe('History.fromRecord refusals, exactly', () => {
  const good: HistoryRecord<string> = History.create('a', { at: 0 }).push('b', 'b', 1).toRecord();

  it('says what is wrong with each kind of bad record', () => {
    const cases: [HistoryRecord<string>, string][] = [
      [{ ...good, limit: 0 }, 'Bad history limit 0'],
      [{ ...good, states: ['a', 'b', 'c'] }, '3 states for 1 steps'],
      [
        {
          ...good,
          limit: 1,
          states: ['a', 'b', 'c'],
          steps: [...good.steps, { label: 'c', at: 2 }],
        },
        '2 steps over a limit of 1',
      ],
      [{ ...good, position: 2 }, 'Position 2 outside 0–1'],
      [{ ...good, position: -1 }, 'Position -1 outside 0–1'],
    ];
    for (const [record, message] of cases) {
      const e = thrown(() => History.fromRecord(record));
      expect(e).toBeInstanceOf(RangeError);
      expect(e.message).toBe(message);
    }
  });
});

describe('History steps, exactly', () => {
  it('leaves the name out of an unnamed step rather than setting it to nothing', () => {
    const h = History.create('a', { at: 0 })
      .push('b', 'to b', 1)
      .push('c', 'to c', 2)
      .named(2, 'C');
    expect(h.steps).toStrictEqual([
      { position: 1, label: 'to b', at: 1, state: 'b' },
      { position: 2, label: 'to c', at: 2, state: 'c', name: 'C' },
    ]);
    expect('name' in (h.steps[0] ?? {})).toBe(false);
  });
});

describe('History limit of 0', () => {
  it('keeps no steps, the present only, dated by the last change', () => {
    const h = History.create('a', { limit: 0, at: 0 }).push('b', 'to b', 5);
    expect(h.present).toBe('b');
    expect(h.canUndo).toBe(false);
    expect(h.size).toBe(0);
    expect(h.truncated).toBe(true);
    expect(h.startedAt).toBe(5);
    expect(h.kept).toEqual([]);
  });
});

describe('History coalescing window, exactly', () => {
  const run: Coalesce = { follows: 'type', key: 'type' };

  it('merges a change exactly the window after the last, and not one a millisecond later', () => {
    const base = History.create('', { at: 0 }).push('A', 'Insert', 100, run);
    expect(base.push('AC', 'Insert', 100 + DEFAULT_COALESCE_MS, run).size).toBe(1);
    expect(base.push('AC', 'Insert', 101 + DEFAULT_COALESCE_MS, run).size).toBe(2);
    const quick: Coalesce = { ...run, withinMs: 10 };
    expect(base.push('AC', 'Insert', 110, quick).size).toBe(1);
    expect(base.push('AC', 'Insert', 111, quick).size).toBe(2);
  });
});

describe('History names that change nothing', () => {
  const h = History.create('a', { at: 0 }).push('b', 'to b', 1).push('c', 'to c', 2);

  it('gives the same history back for an undone step named what it is already called', () => {
    const undone = h.named(2, 'two').undo();
    expect(undone.named(2, 'two')).toBe(undone);
    expect(undone.named(2, '  two  ')).toBe(undone);
    // A different name is a change.
    expect(undone.named(2, 'deux')).not.toBe(undone);
  });

  it('gives the same history back for a blank name on an unnamed step, applied or undone', () => {
    const undone = h.undo();
    expect(undone.named(2, '')).toBe(undone);
    expect(undone.named(2, '   ')).toBe(undone);
    expect(h.named(1, '')).toBe(h);
    expect(h.named(1, 'one').named(1, 'one').steps[0]?.name).toBe('one');
  });

  it('gives the same history back for a position outside the steps', () => {
    for (const position of [0, -1, 3, 1.5, Number.NaN]) {
      expect(h.named(position, 'x')).toBe(h);
    }
  });
});

describe('History kept states renamed', () => {
  it('renames only the kept state asked for', () => {
    const h = History.create('a', { limit: 1, at: 0 })
      .push('b', 'to b', 1)
      .named(1, 'B')
      .push('c', 'to c', 2)
      .named(1, 'C')
      .push('d', 'to d', 3);
    expect(h.kept).toEqual([
      { name: 'B', label: 'to b', at: 1, state: 'b' },
      { name: 'C', label: 'to c', at: 2, state: 'c' },
    ]);
    expect(h.renamedKept(0, 'first').kept.map((k) => k.name)).toEqual(['first', 'C']);
    expect(h.renamedKept(1, 'second').kept.map((k) => k.name)).toEqual(['B', 'second']);
  });
});
