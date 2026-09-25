import { randomDna, randomInt, seededRandom } from '@/test/random';
import { expectWithin, itTimed } from '@/test/timing';

import { findCollectionPrimers } from './collection';

/**
 * "Find my primers" over a lab's whole collection (#64): 500 primers of
 * 18–30 nt, a tenth of them with a 5′ tail, against a 10 kb plasmid and a
 * 200 kb BAC, both circular. The worker runs the same code;
 * `docs/perf-notes.md` has the measurement.
 */
function collection(template: string, count: number) {
  const rand = seededRandom(56);
  return Array.from({ length: count }, (_, i) => {
    const length = randomInt(rand, 18, 31);
    // Half of them from the template, the rest from nowhere.
    const start = randomInt(rand, 0, template.length - length);
    const bases = i % 2 === 0 ? template.slice(start, start + length) : randomDna(rand, length);
    const tail = i % 10 === 0 ? 'GCGGCCGCTTAATTAA' : '';
    return { id: `p${i}`, name: `p${i}`, sequence: tail + bases };
  });
}

describe('finding a collection', () => {
  itTimed('searches 500 primers against a 10 kb plasmid in well under a second', () => {
    const plasmid = randomDna(seededRandom(10), 10_000);
    const primers = collection(plasmid, 500);
    const t0 = performance.now();
    const { hits } = findCollectionPrimers(plasmid, 'circular', primers);
    const ms = performance.now() - t0;
    process.stderr.write(`[perf] 500 primers against 10 kb: ${ms.toFixed(0)} ms\n`);
    expect(hits.length).toBeGreaterThanOrEqual(250);
    expectWithin(ms, 1000);
  });

  itTimed(
    'searches 500 primers against a 200 kb BAC in a few seconds',
    () => {
      const bac = randomDna(seededRandom(200), 200_000);
      const primers = collection(bac, 500);
      const t0 = performance.now();
      const { hits } = findCollectionPrimers(bac, 'circular', primers);
      const ms = performance.now() - t0;
      process.stderr.write(`[perf] 500 primers against 200 kb: ${ms.toFixed(0)} ms\n`);
      expect(hits.length).toBeGreaterThanOrEqual(250);
      expectWithin(ms, 5000);
    },
    60_000,
  );
});
