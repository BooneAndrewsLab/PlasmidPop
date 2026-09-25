import {
  type SequencingRead,
  History,
  SeqDocument,
  createFeature,
  rangeSegment,
  siteSegment,
  typingRun,
} from '@/core';
import { parseGenBank } from '@/io';
import pBR322 from '@/io/fixtures/J01749.gb?raw';
import { seededRandom, randomDna } from '@/test/random';

import {
  type HistoryToStore,
  type RestoredHistory,
  decodeHistory,
  deltaSize,
  encodeHistory,
  storedSize,
} from './historyCodec';
import { type StoredHistory, HISTORY_FORMAT, isStoredHistory } from './historyFormat';
import { historyView, stateView } from '@/test/historyViews';

const plasmid = SeqDocument.create({
  name: 'pTest',
  sequence: randomDna(seededRandom(7), 2000),
  topology: 'circular',
  features: [
    createFeature({ id: 'amp', type: 'CDS', name: 'bla', segments: [rangeSegment(100, 900)] }),
    // Across the origin, and a join of two pieces.
    createFeature({
      id: 'ori',
      type: 'rep_origin',
      name: 'ori',
      strand: 'reverse',
      segments: [rangeSegment(1900, 2100)],
    }),
    createFeature({
      id: 'split',
      type: 'gene',
      name: 'split',
      segments: [rangeSegment(1000, 1100), rangeSegment(1200, 1300, { partialEnd: true })],
    }),
    createFeature({
      id: 'site',
      type: 'misc_feature',
      name: 'nick',
      segments: [siteSegment(1500)],
    }),
  ],
  metadata: { description: 'A test plasmid', comments: ['one', 'two'] },
});

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
function roundTrip(row: StoredHistory | null, origin: SeqDocument | null = null): RestoredHistory {
  expect(row).not.toBeNull();
  const back = decodeHistory(structuredClone(row), origin);
  expect(back).not.toBeNull();
  if (back === null) throw new Error('unreachable');
  return back;
}

/** Types `text` at `at` one base at a time, as the sequence view does. */
function type(history: History<SeqDocument>, at: number, text: string, t0: number) {
  let h = history;
  for (let i = 0; i < text.length; i++) {
    h = h.push(h.present.insert(at + i, text.charAt(i)), 'Insert 1 base', t0 + i * 100, {
      ...typingRun(at + i, at + i + 1),
      relabel: (n) => `Insert ${n} bases`,
    });
  }
  return h;
}

describe('encodeHistory / decodeHistory', () => {
  it('stores typing as a few bases and a position, and features as replayed', () => {
    const h = type(History.create(plasmid, { at: 1 }), 500, 'GATTACA', 10);
    const row = encodeHistory('d', input(h));
    expect(row?.steps).toHaveLength(1);
    expect(row?.steps[0]).toMatchObject({
      label: 'Insert 7 bases',
      merged: 7,
      delta: {
        sequence: { kind: 'splice', deleted: 0, text: expect.stringMatching(/GATTACA/) as string },
        features: { kind: 'patch', replay: true, removed: [], upserted: [] },
      },
    });
    const back = roundTrip(row);
    expect(historyView(back.history)).toEqual(historyView(h));
  });

  it('places an insertion in a run of one base where the features say it went', () => {
    // A base typed at 2 in a run of As could have gone anywhere in the run,
    // as far as the bases go; the feature that starts at 2 moved, so it went
    // before it, and that is the placement that replays without a copy.
    const doc = SeqDocument.create({
      sequence: 'AAAAAAAACCCGGG',
      features: [createFeature({ id: 'f', type: 'gene', segments: [rangeSegment(2, 5)] })],
    });
    const h = History.create(doc, { at: 0 }).push(doc.insert(2, 'A'), 'Insert 1 base', 1);
    const row = encodeHistory('d', input(h));
    expect(row?.steps[0]?.delta).toEqual({
      sequence: { kind: 'splice', start: 0, deleted: 0, text: 'A' },
      features: { kind: 'patch', replay: true, removed: [], upserted: [] },
    });
    expect(historyView(roundTrip(row).history)).toEqual(historyView(h));
  });

  it('stores a reverse complement and a set origin as what they are, not as the whole sequence', () => {
    const h = History.create(plasmid, { at: 0 })
      .push(plasmid.reverseComplement(), 'Reverse complement', 1)
      .push(plasmid.reverseComplement().setOrigin(700), 'Set origin', 2);
    const row = encodeHistory('d', input(h));
    expect(row?.steps.map((s) => s.delta.sequence)).toEqual([
      { kind: 'reverseComplement' },
      { kind: 'rotate', origin: 700 },
    ]);
    // Both move every feature, and both replay: no feature list is written.
    expect(row?.steps.map((s) => s.delta.features)).toEqual([
      { kind: 'patch', replay: true, removed: [], upserted: [] },
      { kind: 'patch', replay: true, removed: [], upserted: [] },
    ]);
    expect(historyView(roundTrip(row).history)).toEqual(historyView(h));
  });

  it('stores a feature edit as that feature, and a removal as its id', () => {
    const edited = plasmid.updateFeature('amp', { name: 'ampR' });
    const removed = edited.removeFeature('site');
    const added = removed.addFeature(
      createFeature({ id: 'new', type: 'promoter', name: 'P', segments: [rangeSegment(5, 50)] }),
    );
    const h = History.create(plasmid, { at: 0 })
      .push(edited, 'Edit feature', 1)
      .push(removed, 'Remove feature', 2)
      .push(added, 'Add feature', 3);
    const row = encodeHistory('d', input(h));
    const features = row?.steps.map((s) => s.delta.features);
    expect(features?.[0]).toMatchObject({ kind: 'patch', removed: [], upserted: [{ id: 'amp' }] });
    expect(features?.[1]).toMatchObject({ kind: 'patch', removed: ['site'], upserted: [] });
    expect(features?.[2]).toMatchObject({ kind: 'patch', removed: [], upserted: [{ id: 'new' }] });
    expect(row?.steps.every((s) => s.delta.sequence === undefined)).toBe(true);
    expect(historyView(roundTrip(row).history)).toEqual(historyView(h));
  });

  it('keeps the name, topology, description, ends and host of every state', () => {
    const linear = plasmid.setTopology('linear');
    const ended = linear.setEnds({
      left: { kind: "5'", overhang: 'AATT', enzyme: 'EcoRI' },
      right: { kind: 'blunt', overhang: '', enzyme: null },
    });
    const h = History.create(plasmid, { at: 0 })
      .push(plasmid.rename('pRenamed'), 'Rename', 1)
      .push(plasmid.rename('pRenamed').setMetadata({ description: 'changed' }), 'Edit', 2)
      .push(linear, 'Make linear', 3)
      .push(ended, 'Set the ends', 4)
      .push(ended.setMethylation({ dam: false, dcm: true }), 'Host', 5)
      .undo()
      .undo();
    const row = encodeHistory('d', input(h));
    expect(row?.steps[0]?.delta).toEqual({ name: 'pRenamed' });
    const back = roundTrip(row);
    expect(historyView(back.history)).toEqual(historyView(h));
    // The two undone steps can be redone after the round trip.
    expect(stateView(back.history.redo().redo().present)).toEqual(
      stateView(ended.setMethylation({ dam: false, dcm: true })),
    );
  });

  it('rebuilds a real record through a session of edits', () => {
    const doc = parseGenBank(pBR322).documents[0];
    if (doc === undefined) throw new Error('no record');
    const first = doc.features.all()[0];
    if (first === undefined) throw new Error('no feature');
    let h = History.create(doc, { at: 0 });
    h = type(h, 10, 'ACGT', 1);
    h = h.seal().push(h.present.delete({ start: 3000, end: 3050 }), 'Delete', 2000);
    h = h.push(h.present.replace({ start: 100, end: 110 }, 'NNNN'), 'Replace', 3000);
    h = h.push(h.present.removeFeature(first.id), 'Remove feature', 4000);
    h = h.push(h.present.setOrigin(1234), 'Set origin', 5000).undo();
    const back = roundTrip(encodeHistory('d', input(h)));
    expect(historyView(back.history)).toEqual(historyView(h));
  });

  it('comes back sealed: a run being typed does not carry on after a reload', () => {
    const h = type(History.create(plasmid, { at: 0 }), 10, 'AC', 0);
    const back = roundTrip(encodeHistory('d', input(h))).history;
    const coalesce = { ...typingRun(12, 13), relabel: (n: number) => `Insert ${n} bases` };
    expect(h.push(h.present.insert(12, 'G'), 'Insert 1 base', 300, coalesce).size).toBe(1);
    expect(back.push(back.present.insert(12, 'G'), 'Insert 1 base', 300, coalesce).size).toBe(2);
  });

  it('keeps a read with the states that have it, so undo brings it back', () => {
    const read: SequencingRead = {
      qualities: Uint8Array.from({ length: 12 }, (_, i) => i * 3),
      trace: {
        channels: {
          A: Int16Array.from({ length: 30 }, (_, i) => i),
          C: new Int16Array(30),
          G: new Int16Array(30),
          T: new Int16Array(30).fill(4),
        },
        peaks: Int32Array.from({ length: 12 }, (_, i) => i * 2),
      },
    };
    const doc = SeqDocument.create({ name: 'read', sequence: 'ACGTACGTACGT', read });
    const h = History.create(doc, { at: 0 })
      .push(doc.rename('read 2'), 'Rename', 1)
      .push(doc.rename('read 2').reverseComplement(), 'Reverse complement', 2)
      .push(doc.rename('read 2').reverseComplement().insert(3, 'A'), 'Insert 1 base', 3);
    const back = roundTrip(encodeHistory('d', input(h))).history;
    expect(back.present.read).toBeNull();
    expect(back.stateAt(1)?.read?.qualities).toEqual(read.qualities);
    expect(back.stateAt(2)?.read).toEqual(h.stateAt(2)?.read);
    // A read that did not change between two states is written once.
    expect(back.stateAt(1)?.read).toBe(back.stateAt(0)?.read);
  });

  describe('baselines', () => {
    const h = History.create(plasmid, { at: 0 })
      .push(plasmid.insert(3, 'A'), 'Insert 1 base', 1)
      .push(plasmid.insert(3, 'A').insert(4, 'C'), 'Insert 1 base', 2);

    it('points at a kept state, and comes back as that very state', () => {
      const row = encodeHistory('d', input(h, { saved: h.stateAt(1) ?? null }));
      expect(row?.saved).toEqual({ kind: 'step', position: 1 });
      expect(row?.opened).toEqual({ kind: 'step', position: 0 });
      const back = roundTrip(row);
      expect(back.saved).toBe(back.history.stateAt(1));
      expect(back.opened).toBe(back.history.stateAt(0));
    });

    it('says "never downloaded" as none', () => {
      const back = roundTrip(encodeHistory('d', input(h, { saved: null })));
      expect(back.saved).toBeNull();
    });

    it('points at the original of a working copy, and falls back to the start without one', () => {
      const original = plasmid.rename('pOriginal');
      const row = encodeHistory('d', input(h, { opened: original, origin: original }));
      expect(row?.opened).toEqual({ kind: 'origin' });
      const reread = original.rename('pOriginal');
      expect(roundTrip(row, reread).opened).toBe(reread);
      const lost = roundTrip(row, null);
      expect(lost.opened).toBe(lost.history.stateAt(0));
    });

    it('stores a baseline outside the kept states whole', () => {
      const elsewhere = plasmid.insert(0, 'TTTT');
      const row = encodeHistory('d', input(h, { saved: elsewhere, opened: elsewhere }));
      expect(row?.saved.kind).toBe('state');
      const back = roundTrip(row);
      expect(stateView(back.saved ?? plasmid)).toEqual(stateView(elsewhere));
      expect(stateView(back.opened)).toEqual(stateView(elsewhere));
    });
  });

  describe('the size budget', () => {
    // Twenty steps that each rewrite 300 bases in place: every state is the
    // same size.
    let h = History.create(plasmid, { at: 5 });
    for (let i = 1; i <= 20; i++) {
      const text = randomDna(seededRandom(i), 300);
      h = h.push(h.present.replace({ start: 0, end: 300 }, text), `step ${i}`, i * 10);
    }
    const oneState = storedSize(encodeHistory('d', input(History.create(plasmid))));
    const full = encodeHistory('d', input(h));
    const stepSizes = (full?.steps ?? []).map((step) => deltaSize(step.delta) + step.label.length);
    const sum = (sizes: readonly number[]): number => sizes.reduce((a, b) => a + b, 0);
    const least = Math.min(...stepSizes);

    it('estimates a row at what the encoder counted', () => {
      expect(stepSizes).toHaveLength(20);
      expect(storedSize(full)).toBe(oneState + sum(stepSizes));
    });

    it('drops the oldest steps from the stored copy, and says the copy is truncated', () => {
      // Room for the present, the opened state (outside the kept steps now,
      // so stored whole) and the last five steps, but not a sixth.
      const budget = 2 * oneState + sum(stepSizes.slice(15)) + least / 2;
      const row = encodeHistory('d', input(h), budget);
      if (row === null) throw new Error('no row');
      expect(row.steps).toHaveLength(5);
      expect(storedSize(row)).toBeLessThanOrEqual(budget);
      expect(row.truncated).toBe(true);
      const back = roundTrip(row);
      // The newest steps are the ones kept, dated as History dates a start past its limit.
      expect(back.history.labels).toEqual(h.labels.slice(15));
      expect(back.history.startedAt).toBe(150);
      expect(back.history.truncated).toBe(true);
      expect(stateView(back.history.stateAt(0) ?? plasmid)).toEqual(
        stateView(h.stateAt(15) ?? plasmid),
      );
      expect(stateView(back.history.present)).toEqual(stateView(h.present));
      expect(row.opened.kind).toBe('state');
      expect(stateView(back.opened)).toEqual(stateView(plasmid));
    });

    it('lets a baseline give way to the present, then redo steps, then keeps nothing', () => {
      const undone = h.jumpTo(10);
      const row = encodeHistory(
        'd',
        input(undone),
        oneState + sum(stepSizes.slice(10, 13)) + least / 2,
      );
      if (row === null) throw new Error('no row');
      // The present is the oldest kept state, with three of its redo steps.
      expect(row.position).toBe(0);
      expect(row.steps.map((step) => step.label)).toEqual(['step 11', 'step 12', 'step 13']);
      // No room for the opened state as well: "Since opened" falls back to the start.
      expect(row.opened).toEqual({ kind: 'step', position: 0 });
      const back = roundTrip(row).history;
      expect(stateView(back.present)).toEqual(stateView(undone.present));
      expect(stateView(back.jumpTo(3).present)).toEqual(stateView(h.stateAt(13) ?? plasmid));
      expect(encodeHistory('d', input(undone), oneState - 1)).toBeNull();
    });
  });

  describe('reading a row back', () => {
    const h = History.create(plasmid, { at: 0 }).push(plasmid.insert(3, 'A'), 'Insert', 1);
    const good = (): StoredHistory => {
      const row = encodeHistory('d', input(h));
      if (row === null) throw new Error('no row');
      return structuredClone(row);
    };

    it('checks the shape of a good row', () => {
      expect(isStoredHistory(good())).toBe(true);
      expect(good().format).toBe(HISTORY_FORMAT);
    });

    it.each([
      ['nothing', () => undefined],
      ['a string', () => 'history'],
      ['another format', () => ({ ...good(), format: 99 })],
      ['a step without a label', () => ({ ...good(), steps: [{ at: 1, delta: {} }] })],
      ['a position past the steps', () => ({ ...good(), position: 5 })],
      [
        'a splice past the end',
        () => ({
          ...good(),
          steps: [
            {
              label: 'x',
              at: 1,
              delta: { sequence: { kind: 'splice', start: 1e6, deleted: 1, text: '' } },
            },
          ],
        }),
      ],
      [
        'a splice that is not DNA',
        () => ({
          ...good(),
          steps: [
            {
              label: 'x',
              at: 1,
              delta: { sequence: { kind: 'splice', start: 0, deleted: 0, text: '<script>' } },
            },
          ],
        }),
      ],
      [
        'a feature off the end',
        () => ({
          ...good(),
          steps: [
            {
              label: 'x',
              at: 1,
              delta: {
                features: {
                  kind: 'list',
                  features: [
                    {
                      id: 'x',
                      type: 'gene',
                      name: 'x',
                      strand: 'forward',
                      qualifiers: [],
                      segments: [
                        {
                          kind: 'range',
                          start: 0,
                          end: 1e6,
                          partialStart: false,
                          partialEnd: false,
                        },
                      ],
                    },
                  ],
                },
              },
            },
          ],
        }),
      ],
      [
        'a rotation of nothing',
        () => ({
          ...good(),
          steps: [{ label: 'x', at: 1, delta: { sequence: { kind: 'rotate', origin: 0 } } }],
        }),
      ],
      [
        'a base that is not a sequence',
        () => ({ ...good(), base: { ...good().base, sequence: 'hello' } }),
      ],
      [
        'a read that does not fit',
        () => ({
          ...good(),
          base: { ...good().base, read: { qualities: new Uint8Array(3), trace: null } },
        }),
      ],
      ['a limit below the steps', () => ({ ...good(), limit: 0 })],
    ])('drops %s rather than throwing', (_name, row) => {
      expect(() => decodeHistory(row(), null)).not.toThrow();
      expect(decodeHistory(row(), null)).toBeNull();
    });
  });
});
