import { createFeature, rangeSegment } from '../features';

import { type SequencingRead, assertValidRead, reverseComplementRead } from './read';
import { SeqDocument } from './seqDocument';

function read(): SequencingRead {
  // Four bases on a trace of eight points, peaks at 1, 3, 4, 6.
  return {
    qualities: Uint8Array.from([10, 20, 30, 40]),
    trace: {
      channels: {
        A: Int16Array.from([0, 9, 0, 0, 0, 0, 0, 0]),
        C: Int16Array.from([0, 0, 0, 9, 0, 0, 0, 0]),
        G: Int16Array.from([0, 0, 0, 0, 9, 0, 0, 0]),
        T: Int16Array.from([0, 0, 0, 0, 0, 0, 9, 0]),
      },
      peaks: Int32Array.from([1, 3, 4, 6]),
    },
  };
}

const doc = (): SeqDocument => SeqDocument.create({ sequence: 'ACGT', read: read() });

describe('a document read from a sequencing file', () => {
  it('keeps its read through edits that leave the bases alone', () => {
    const d = doc()
      .rename('clone 3')
      .addFeature(createFeature({ type: 'misc_feature', segments: [rangeSegment(0, 2)] }))
      .setMetadata({ description: 'M13F' });
    expect(d.read).not.toBeNull();
  });

  it('drops it when the bases change', () => {
    expect(doc().insert(2, 'A').read).toBeNull();
    expect(doc().delete({ start: 0, end: 1 }).read).toBeNull();
    expect(doc().replace({ start: 1, end: 2 }, 'G').read).toBeNull();
  });

  it('keeps it across a change of topology, which moves no base', () => {
    expect(doc().setTopology('circular').read).not.toBeNull();
  });

  it('turns it over with a reverse complement, peaks still under their bases', () => {
    const flipped = doc().reverseComplement();
    expect(flipped.sequence.toString()).toBe('ACGT');
    const r = flipped.read;
    expect([...(r?.qualities ?? [])]).toEqual([40, 30, 20, 10]);
    expect([...(r?.trace?.peaks ?? [])]).toEqual([1, 3, 4, 6]);
    // The new first base, A, was the old last T: its signal is T's, mirrored.
    expect(r?.trace?.channels.A[1]).toBe(9);
    expect([...(r?.trace?.channels.T ?? [])]).toEqual([0, 0, 0, 0, 0, 0, 9, 0]);
    expect(reverseComplementRead(reverseComplementRead(read()))).toEqual(read());
  });

  it('refuses a read that does not fit the bases', () => {
    expect(() => SeqDocument.create({ sequence: 'ACG', read: read() })).toThrow(
      /4 qualities for 3/,
    );
    const bad = read();
    const peaks = {
      ...bad,
      trace: bad.trace && { ...bad.trace, peaks: Int32Array.from([1, 3, 4, 8]) },
    };
    expect(() => {
      assertValidRead(peaks, 4);
    }).toThrow(/outside/);
    expect(() => {
      assertValidRead({ qualities: new Uint8Array(4), trace: null }, 4);
    }).not.toThrow();
  });
});
