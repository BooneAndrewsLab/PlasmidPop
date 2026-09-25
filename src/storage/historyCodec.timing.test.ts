import { type Feature, History, SeqDocument, createFeature, rangeSegment } from '@/core';
import { randomDna, randomInt, seededRandom } from '@/test/random';
import { expectWithin, itTimed } from '@/test/timing';

import { decodeHistory, encodeHistory, storedSize } from './historyCodec';

/**
 * What keeping the history costs while typing (item 51): the autosave after
 * a keystroke works out one new delta, whatever the length of the history,
 * and a reload decodes them all once. The full measurement, with a thousand
 * features and runs of typing, is in `docs/perf-notes.md`.
 */

function session(length: number, featureCount: number): History<SeqDocument> {
  const rand = seededRandom(length);
  const features: Feature[] = [];
  for (let i = 0; i < featureCount; i++) {
    const start = Math.floor((i * length) / featureCount);
    features.push(
      createFeature({
        id: `f${i}`,
        type: 'CDS',
        name: `g${i}`,
        segments: [rangeSegment(start, start + 50)],
      }),
    );
  }
  const doc = SeqDocument.create({
    name: 'big',
    sequence: randomDna(rand, length),
    topology: 'circular',
    features,
  });
  let h = History.create(doc, { at: 0 });
  for (let s = 1; s <= 200; s++) {
    const d = h.present;
    const at = randomInt(rand, 0, d.length - 20);
    const next =
      s === 50
        ? d.reverseComplement()
        : s === 120
          ? d.setOrigin(1000)
          : s % 3 === 0
            ? d.delete({ start: at, end: at + 5 })
            : d.insert(at, randomDna(rand, 8));
    h = h.push(next, `step ${s}`, s * 1000);
  }
  return h;
}

function time(fn: () => void): number {
  const t0 = performance.now();
  fn();
  return performance.now() - t0;
}

describe('stored history timing', () => {
  itTimed(
    'writes the next keystroke of a 1 Mb document with 200 steps in a few milliseconds',
    () => {
      const h = session(1_000_000, 100);
      const input = { history: h, opened: h.stateAt(0) ?? h.present, saved: null, origin: null };
      encodeHistory('d', input); // every delta once, as the autosaves after each step would have
      const next = h.push(h.present.insert(5, 'C'), 'Insert 1 base', 1e9);
      const ms = time(() => encodeHistory('d', { ...input, history: next }));
      const row = encodeHistory('d', { ...input, history: next });
      // eslint-disable-next-line no-console
      console.info(
        `[perf] next keystroke, 1 Mb, 200 steps: ${ms.toFixed(1)} ms, ${storedSize(row)} bytes`,
      );
      expectWithin(ms, 50);
    },
    60_000,
  );

  itTimed(
    'reads back a 10 kb document’s 200 steps well within a page load',
    () => {
      const h = session(10_000, 12);
      const row = structuredClone(
        encodeHistory('d', { history: h, opened: h.present, saved: null, origin: null }),
      );
      let back = null as ReturnType<typeof decodeHistory>;
      const ms = time(() => {
        back = decodeHistory(row, null);
      });
      // eslint-disable-next-line no-console
      console.info(`[perf] decode 10 kb, 200 steps: ${ms.toFixed(1)} ms`);
      expect(back?.history.size).toBe(200);
      expectWithin(ms, 200);
    },
    60_000,
  );
});
