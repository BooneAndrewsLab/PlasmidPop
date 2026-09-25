import {
  type Feature,
  type SequencingRead,
  History,
  SeqDocument,
  createFeature,
  rangeSegment,
  reverseComplement,
  siteSegment,
} from '@/core';
import { seededRandom, randomDna } from '@/test/random';
import { historyView, stateView } from '@/test/historyViews';

import {
  type HistoryToStore,
  type RestoredHistory,
  decodeHistory,
  deltaSize,
  encodeHistory,
  storedSize,
} from './historyCodec';
import { type StoredHistory } from './historyFormat';

/*
 * Pins found by mutation testing (item 50): exact sizes where the budget
 * decides what is kept, the exact shape of the deltas the encoder picks, and
 * the boundaries of the searches for a turn or a rotation. Every fixture is
 * built inside its test: the codec keeps caches keyed by the objects it has
 * seen, and a fixture shared between tests would be answered from them.
 */

function input(history: History<SeqDocument>, extra: Partial<HistoryToStore> = {}): HistoryToStore {
  return {
    history,
    opened: history.stateAt(0) ?? history.present,
    saved: null,
    origin: null,
    ...extra,
  };
}

/** Through what IndexedDB does to a row: a structured clone. */
function roundTrip(row: StoredHistory | null): RestoredHistory {
  expect(row).not.toBeNull();
  const back = decodeHistory(structuredClone(row), null);
  expect(back).not.toBeNull();
  if (back === null) throw new Error('unreachable');
  return back;
}

function encoded(history: History<SeqDocument>, budget?: number): StoredHistory {
  const row = encodeHistory('d', input(history), budget);
  if (row === null) throw new Error('no row');
  return row;
}

/** A history of one step from `before` to `after`, and the delta stored for it. */
function oneStep(before: SeqDocument, after: SeqDocument) {
  const history = History.create(before, { at: 0 }).push(after, 'Edit', 1);
  const row = encoded(history);
  const delta = row.steps[0]?.delta;
  expect(historyView(roundTrip(row).history)).toEqual(historyView(history));
  return delta;
}

/** `steps` steps that each rewrite the first 100 bases of 600: states all the same size. */
function rewrites(steps: number, seed: number): History<SeqDocument> {
  const doc = SeqDocument.create({ name: 'p', sequence: randomDna(seededRandom(seed), 600) });
  let h = History.create(doc, { at: 0 });
  for (let i = 1; i <= steps; i++) {
    const text = randomDna(seededRandom(seed + i), 100);
    h = h.push(h.present.replace({ start: 0, end: 100 }, text), `step ${i}`, i * 10);
  }
  return h;
}

describe('stored history sizes', () => {
  it('sizes a feature by its id, type, name, segments and qualifiers', () => {
    const f = createFeature({
      id: 'abc',
      type: 'gene',
      name: 'na',
      segments: [rangeSegment(0, 2), siteSegment(3)],
      qualifiers: [
        { name: 'note', value: 'hello' },
        { name: 'pseudo', value: null },
      ],
    });
    // 48 per step, 16 for a list, and 64 + 3 + 4 + 2 for the feature,
    // 48 a segment, 16 + name + value a qualifier.
    expect(deltaSize({ features: { kind: 'list', features: [f] } })).toBe(
      48 + 16 + (64 + 3 + 4 + 2) + 2 * 48 + (16 + 4 + 5) + (16 + 6),
    );
  });

  it('sizes a patch by what it upserts and the ids it removes', () => {
    const delta = { kind: 'patch', replay: false, removed: ['ab', 'c'], upserted: [] } as const;
    expect(deltaSize({ features: delta })).toBe(48 + 24 + (4 + 2) + (4 + 1));
  });

  it('sizes a read by its qualities, peaks and four trace channels', () => {
    const qualities = new Uint8Array(5);
    const trace: SequencingRead['trace'] = {
      channels: {
        A: new Int16Array(10),
        C: new Int16Array(10),
        G: new Int16Array(10),
        T: new Int16Array(10),
      },
      peaks: new Int32Array(5),
    };
    expect(deltaSize({ read: null })).toBe(48);
    expect(deltaSize({ read: { qualities, trace: null } })).toBe(48 + 5);
    expect(deltaSize({ read: { qualities, trace } })).toBe(48 + 5 + 20 + 4 * 20);
  });

  it('sizes a row by its base, the baselines and named states stored whole, and names', () => {
    expect(storedSize(null)).toBe(0);
    const doc = SeqDocument.create({ name: 'p', sequence: 'ACGTACGT' });
    const row = encoded(History.create(doc, { at: 0 }));
    const state = 48 + 8 + 1 + JSON.stringify(row.base.metadata).length;
    expect(storedSize(row)).toBe(state);
    const whole = { kind: 'state', state: row.base } as const;
    const full: StoredHistory = {
      ...row,
      opened: whole,
      saved: whole,
      named: [{ name: 'nm', label: 'label', at: 0, state: whole }],
    };
    expect(storedSize(full)).toBe(4 * state + 'nm'.length + 'label'.length);
  });
});

describe('stored copies', () => {
  it('keeps extra header lines, in the oldest state and in a step', () => {
    const doc = SeqDocument.create({
      sequence: 'ACGTACGT',
      metadata: { extraHeaders: [{ keyword: 'PROJECT', value: 'one' }] },
    });
    const next = doc.setMetadata({
      extraHeaders: [
        { keyword: 'PROJECT', value: 'two' },
        { keyword: 'DBSOURCE', value: 'x' },
      ],
    });
    const h = History.create(doc, { at: 0 }).push(next, 'Edit', 1);
    const back = roundTrip(encoded(h)).history;
    expect(back.stateAt(0)?.metadata.extraHeaders).toEqual([{ keyword: 'PROJECT', value: 'one' }]);
    expect(back.present.metadata.extraHeaders).toEqual(next.metadata.extraHeaders);
  });

  it('writes nothing for a state that is another object with the same content', () => {
    const make = (name: string) =>
      SeqDocument.create({
        name,
        sequence: 'ACGTACGTAAAC',
        metadata: { description: 'same' },
        features: [
          createFeature({
            id: 'q',
            type: 'gene',
            segments: [rangeSegment(1, 5)],
            qualifiers: [{ name: 'gene', value: 'q' }],
          }),
        ],
      });
    expect(oneStep(make('a'), make('b'))).toEqual({ name: 'b' });
  });
});

describe('feature deltas', () => {
  const x = (over: Partial<Feature> = {}): Feature => ({
    id: 'x',
    type: 'gene',
    name: 'x',
    strand: 'forward',
    segments: [rangeSegment(10, 20)],
    qualifiers: [{ name: 'gene', value: 'x' }],
    ...over,
  });

  it.each<[string, Feature, Feature]>([
    ['its id', x(), x({ id: 'y' })],
    ['its type', x(), x({ type: 'CDS' })],
    ['the end of a segment', x(), x({ segments: [rangeSegment(10, 25)] })],
    ['a partial start', x(), x({ segments: [rangeSegment(10, 20, { partialStart: true })] })],
    ['a partial end', x(), x({ segments: [rangeSegment(10, 20, { partialEnd: true })] })],
    ['a segment more', x(), x({ segments: [rangeSegment(10, 20), rangeSegment(30, 40)] })],
    ['a site moved', x({ segments: [siteSegment(50)] }), x({ segments: [siteSegment(55)] })],
    [
      'a qualifier more',
      x(),
      x({
        qualifiers: [
          { name: 'gene', value: 'x' },
          { name: 'note', value: 'n' },
        ],
      }),
    ],
    ['the value of a qualifier', x(), x({ qualifiers: [{ name: 'gene', value: 'y' }] })],
    ['the name of a qualifier', x(), x({ qualifiers: [{ name: 'locus_tag', value: 'x' }] })],
  ])('notices a change of %s, and stores only the feature it changed', (_what, before, after) => {
    const q = (): Feature =>
      createFeature({
        id: 'q',
        type: 'gene',
        segments: [rangeSegment(60, 70)],
        qualifiers: [
          { name: 'gene', value: 'q' },
          { name: 'pseudo', value: null },
        ],
      });
    const sequence = randomDna(seededRandom(3), 100);
    const prev = SeqDocument.create({ sequence, features: [q(), before] });
    const next = SeqDocument.create({ sequence, features: [q(), after] });
    expect(oneStep(prev, next)).toEqual({
      features: {
        kind: 'patch',
        replay: false,
        removed: after.id === before.id ? [] : [before.id],
        upserted: [after],
      },
    });
  });

  it('writes features that only changed order as a list, in their new order', () => {
    const a = createFeature({ id: 'a', type: 'gene', segments: [rangeSegment(1, 5)] });
    const b = createFeature({ id: 'b', type: 'gene', segments: [rangeSegment(6, 9)] });
    const prev = SeqDocument.create({ sequence: 'ACGTACGTACGT', features: [a, b] });
    const next = SeqDocument.create({ sequence: 'ACGTACGTACGT', features: [b, a] });
    expect(oneStep(prev, next)).toEqual({ features: { kind: 'list', features: [b, a] } });
  });

  it('does not replay an edit when the features stayed where they were', () => {
    // A base put in front of three features that did not move with it, and
    // one of them renamed: replaying the insertion would move all three.
    const sequence = 'C' + randomDna(seededRandom(4), 99);
    const f = (id: string, start: number, name = id) =>
      createFeature({ id, type: 'gene', name, segments: [rangeSegment(start, start + 10)] });
    const prev = SeqDocument.create({ sequence, features: [f('a', 10), f('b', 30), f('c', 50)] });
    const renamed = f('c', 50, 'renamed');
    const next = SeqDocument.create({
      sequence: 'A' + sequence,
      features: [f('a', 10), f('b', 30), renamed],
    });
    expect(oneStep(prev, next)).toEqual({
      sequence: { kind: 'splice', start: 0, deleted: 0, text: 'A' },
      features: { kind: 'patch', replay: false, removed: [], upserted: [renamed] },
    });
  });

  it('replays a deletion, a replacement and a change of topology instead of storing what they moved', () => {
    const doc = SeqDocument.create({
      sequence: randomDna(seededRandom(5), 200),
      topology: 'circular',
      features: [
        createFeature({ id: 'mid', type: 'gene', segments: [rangeSegment(50, 80)] }),
        createFeature({ id: 'ori', type: 'rep_origin', segments: [rangeSegment(190, 210)] }),
      ],
    });
    const deleted = doc.delete({ start: 5, end: 10 });
    const replaced = deleted.replace({ start: 5, end: 10 }, 'GGGGGGGGGG');
    const linear = replaced.setTopology('linear');
    expect(linear.features.get('ori')?.segments).not.toEqual(
      replaced.features.get('ori')?.segments,
    );
    const h = History.create(doc, { at: 0 })
      .push(deleted, 'Delete', 1)
      .push(replaced, 'Replace', 2)
      .push(linear, 'Make linear', 3);
    const row = encoded(h);
    const replay = { kind: 'patch', replay: true, removed: [], upserted: [] };
    expect(row.steps.map((s) => s.delta.features)).toEqual([replay, replay, replay]);
    expect(row.steps.map((s) => s.delta.sequence)).toEqual([
      { kind: 'splice', start: 5, deleted: 5, text: '' },
      expect.objectContaining({ kind: 'splice' }),
      undefined,
    ]);
    expect(historyView(roundTrip(row).history)).toEqual(historyView(h));
  });
});

describe('sequence deltas', () => {
  it('stores a turn of 64 changed bases as a splice, and of 65 as a reverse complement', () => {
    // Turned over, each keeps its first and last base and changes the rest.
    for (const [middle, kind] of [
      [62, 'splice'],
      [63, 'reverseComplement'],
    ] as const) {
      const doc = SeqDocument.create({
        sequence: 'AC' + randomDna(seededRandom(middle), middle) + 'CT',
      });
      const delta = oneStep(doc, doc.reverseComplement());
      expect(delta?.sequence?.kind).toBe(kind);
    }
  });

  it('does not take a sequence that only starts as the turned one for a reverse complement', () => {
    const x = randomDna(seededRandom(6), 200);
    const turned = reverseComplement(x);
    const y = turned.slice(0, 100) + (turned[100] === 'A' ? 'C' : 'A') + turned.slice(101);
    const delta = oneStep(SeqDocument.create({ sequence: x }), SeqDocument.create({ sequence: y }));
    expect(delta?.sequence?.kind).toBe('splice');
  });

  it('finds a set origin of one', () => {
    const doc = SeqDocument.create({
      sequence: randomDna(seededRandom(7), 300),
      topology: 'circular',
    });
    expect(oneStep(doc, doc.setOrigin(1))?.sequence).toEqual({ kind: 'rotate', origin: 1 });
  });

  it('looks for a set origin past seven false starts, and gives up after eight', () => {
    // The new start is 32 As, which the run of As at the old start matches
    // at every place but its last 31.
    for (const [run, found] of [
      [39, true],
      [40, false],
    ] as const) {
      const r = seededRandom(run);
      const sequence =
        'A'.repeat(run) + 'G' + randomDna(r, 100) + 'T' + 'A'.repeat(32) + 'C' + randomDna(r, 100);
      const origin = run + 102;
      const doc = SeqDocument.create({ sequence, topology: 'circular' });
      const delta = oneStep(doc, doc.setOrigin(origin));
      expect(delta?.sequence).toEqual(
        found ? { kind: 'rotate', origin } : expect.objectContaining({ kind: 'splice' }),
      );
    }
  });

  it('does not take a sequence that is a set origin but for one base for one', () => {
    const x = randomDna(seededRandom(8), 300);
    const rotated = x.slice(100) + x.slice(0, 100);
    const other = (c: string | undefined) => (c === 'A' ? 'C' : 'A');
    // One base changed in what came from after the new origin, and one before it.
    for (const at of [50, 250]) {
      const y = rotated.slice(0, at) + other(rotated[at]) + rotated.slice(at + 1);
      const delta = oneStep(
        SeqDocument.create({ sequence: x, topology: 'circular' }),
        SeqDocument.create({ sequence: y, topology: 'circular' }),
      );
      expect(delta?.sequence?.kind).toBe('splice');
    }
  });

  it('finds both ends of a change a block of 4096 bases away from them', () => {
    const x = randomDna(seededRandom(9), 10_000);
    const other = (c: string | undefined) => (c === 'A' ? 'C' : 'A');
    const y = x.slice(0, 10) + other(x[10]) + x.slice(11, 9990) + other(x[9990]) + x.slice(9991);
    const delta = oneStep(SeqDocument.create({ sequence: x }), SeqDocument.create({ sequence: y }));
    expect(delta?.sequence).toEqual({
      kind: 'splice',
      start: 10,
      deleted: 9981,
      text: y.slice(10, 9991),
    });
  });

  it('finds a long common start, and keeps the end of it out of the common end', () => {
    // A base added to the end of a run of 5000 As: the common start is the
    // whole of the shorter one, and nothing is left over for a common end.
    const x = randomDna(seededRandom(10), 4999) + 'C' + 'A'.repeat(5000);
    const delta = oneStep(
      SeqDocument.create({ sequence: x }),
      SeqDocument.create({ sequence: x + 'A' }),
    );
    expect(delta?.sequence).toEqual({ kind: 'splice', start: 10_000, deleted: 0, text: 'A' });
  });
});

describe('reading a row back', () => {
  it('drops a set origin at or past the end rather than throwing', () => {
    const doc = SeqDocument.create({ sequence: 'ACGTACGTAC', topology: 'circular' });
    const row = encoded(History.create(doc, { at: 0 }).push(doc.setOrigin(3), 'Set origin', 1));
    expect(decodeHistory(structuredClone(row), null)).not.toBeNull();
    for (const origin of [10, 11]) {
      const steps = [{ label: 'x', at: 1, delta: { sequence: { kind: 'rotate', origin } } }];
      expect(decodeHistory({ ...structuredClone(row), steps }, null)).toBeNull();
    }
  });
});

describe('the size budget', () => {
  it('keeps as many redo steps as fit in exactly their estimate', () => {
    const h = rewrites(5, 20).jumpTo(2);
    const oneState = storedSize(encoded(History.create(h.present)));
    const sizes = encoded(h).steps.map((s) => deltaSize(s.delta) + 'step n'.length);
    const least = Math.min(...sizes);
    // Room for the present and two of its redo steps, then for exactly that.
    const row = encoded(h, oneState + (sizes[2] ?? 0) + (sizes[3] ?? 0) + least / 2);
    expect(row.steps.map((s) => s.label)).toEqual(['step 3', 'step 4']);
    expect(encoded(h, storedSize(row)).steps.map((s) => s.label)).toEqual(['step 3', 'step 4']);
  });

  it('keeps the present alone when no redo step fits beside it', () => {
    const h = rewrites(5, 30).jumpTo(2);
    const oneState = storedSize(encoded(History.create(h.present)));
    const row = encoded(h, oneState);
    expect(row.steps).toEqual([]);
    expect(row.position).toBe(0);
    expect(stateView(roundTrip(row).history.present)).toEqual(stateView(h.present));
  });

  it('fits a history with a named step in exactly its own estimate', () => {
    const h = rewrites(5, 40).named(3, 'three');
    const full = encoded(h);
    expect(encoded(h, storedSize(full)).steps).toHaveLength(5);
  });

  it('counts a named state outside the steps to the byte', () => {
    let h = History.create(SeqDocument.create({ name: 'p', sequence: 'ACGTACGT' }), {
      limit: 3,
      at: 0,
    });
    for (let i = 1; i <= 3; i++) h = h.push(h.present.insert(0, 'A'), `A ${i}`, i);
    h = h.named(1, 'one');
    for (let i = 4; i <= 5; i++) h = h.push(h.present.insert(0, 'C'), `C ${i}`, i);
    const full = encodeHistory('d', input(h), undefined, 0);
    expect(full?.named?.map((n) => n.state.kind)).toEqual(['state']);
    expect(encodeHistory('d', input(h), storedSize(full), 0)).toEqual(full);
    const less = encodeHistory('d', input(h), storedSize(full) - 1);
    expect(storedSize(less)).toBeLessThanOrEqual(storedSize(full) - 1);
  });

  it('keeps a named redo step the window leaves out as a named state', () => {
    const named = rewrites(8, 50).named(8, 'last');
    const h = named.jumpTo(0);
    const oneState = storedSize(encoded(History.create(h.present)));
    const sizes = encoded(h).steps.map((s) => deltaSize(s.delta) + 'step n'.length);
    // Room for the present and the named state whole, and no step.
    const budget = 2 * oneState + 'last'.length + 'step 8'.length + Math.min(...sizes) / 2;
    const row = encoded(h, budget);
    expect(row.steps).toEqual([]);
    expect(row.named?.map((n) => [n.name, n.label, n.state.kind])).toEqual([
      ['last', 'step 8', 'state'],
    ]);
    const back = roundTrip(row).history;
    expect(stateView(back.kept[0]?.state ?? h.present)).toEqual(
      stateView(named.stateAt(8) ?? h.present),
    );
  });
});
