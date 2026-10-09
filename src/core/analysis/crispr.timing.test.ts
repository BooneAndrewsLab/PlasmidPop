import { randomDna, seededRandom } from '@/test/random';
import { expectWithin, itTimed } from '@/test/timing';

import { type Nuclease, NUCLEASES, findCrisprGuides } from './crispr';

function spcas9(): Nuclease {
  const n = NUCLEASES.find((x) => x.id === 'spcas9');
  if (n === undefined) throw new Error('SpCas9 is not in the preset list');
  return n;
}

/**
 * Every SpCas9 guide of a plasmid and of a 200 kb BAC, both circular, with
 * off-targets counted to three mismatches across the whole record — the
 * worst case the panel can ask for, since narrowing to a selection only
 * removes guides. The worker runs the same code; `docs/perf-notes.md` has
 * the measurement and what the seed index did to it.
 */
describe('finding CRISPR guides', () => {
  itTimed('scans a 10 kb plasmid in well under a second', () => {
    const plasmid = randomDna(seededRandom(74), 10_000);
    const t0 = performance.now();
    const guides = findCrisprGuides(plasmid, 'circular', spcas9(), { maxMismatches: 3 });
    const ms = performance.now() - t0;
    process.stderr.write(`[perf] CRISPR guides in 10 kb: ${ms.toFixed(0)} ms, ${guides.length}\n`);
    // A random sequence has an NGG about every 16 bases on each strand.
    expect(guides.length).toBeGreaterThan(800);
    expectWithin(ms, 1000);
  });

  itTimed(
    'scans a 200 kb BAC in a few seconds',
    () => {
      const bac = randomDna(seededRandom(200), 200_000);
      const t0 = performance.now();
      const guides = findCrisprGuides(bac, 'circular', spcas9(), { maxMismatches: 3 });
      const ms = performance.now() - t0;
      process.stderr.write(
        `[perf] CRISPR guides in 200 kb: ${ms.toFixed(0)} ms, ${guides.length}\n`,
      );
      expect(guides.length).toBeGreaterThan(20_000);
      // Comparing every site with every other took 8.2 s here; the seed
      // index (item 74) is what keeps this within the budget.
      expectWithin(ms, 4000);
    },
    30_000,
  );
});
