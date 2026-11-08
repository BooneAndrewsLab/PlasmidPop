import { type BatchTemplate, type DesignRow, SeqDocument, checkPool, range } from '@/core';
import { randomDna, randomInt, seededRandom } from '@/test/random';
import { expectWithin, itTimed } from '@/test/timing';
import { AnalysisClient } from '@/workers/analysisClient';

import { runPrimerBatch } from './primerBatch';

/**
 * A plate of primer designs and the pool check over its oligos (#358, #359):
 * regions of 600 bases on a 4.4 kb circular template, designed one after
 * another as the batch runs them, then the checks across the oligos they
 * come to. vitest has no `Worker`, so the analysis client runs the worker's
 * own code on this thread: the numbers are the engine's, without the round
 * trip per row, which is a few kilobytes each way. `docs/perf-notes.md` has
 * the measurement and says what it means for a worker pool.
 *
 * The design time is never asserted: a CI runner takes about 4 times what the
 * workstation does for the 96-row plate (83 s against 20 s), so a budget that
 * holds in CI says nothing about a pool. The test runs 12 rows and asserts
 * what they make; `PLASMIDPOP_PERF=1 npx vitest run src/app/batch.timing.test.ts`
 * runs the whole plate and prints the time, which is what the note records.
 */
const ROWS = process.env['PLASMIDPOP_PERF'] === '1' ? 96 : 12;
const rand = seededRandom(358);
const bases = randomDna(rand, 4400);
const template: BatchTemplate = {
  name: 'pRandom',
  document: SeqDocument.create({ name: 'pRandom', sequence: bases, topology: 'circular' }),
};

function plate(count: number): DesignRow[] {
  return Array.from({ length: count }, (_, i) => {
    const start = randomInt(rand, 0, bases.length - 600);
    return {
      line: i + 2,
      name: `region${i + 1}`,
      template: 'pRandom',
      source: {
        kind: 'region',
        range: range(start, start + 600),
        strand: 'forward',
        text: `${start + 1}-${start + 600}`,
      },
      overrides: {},
      notes: '',
      warnings: [],
    } satisfies DesignRow;
  });
}

describe('a plate of primer designs', () => {
  itTimed(
    'designs a plate of regions and checks the oligos they make',
    async () => {
      const t0 = performance.now();
      const { rows } = await runPrimerBatch(
        plate(ROWS),
        [template],
        {},
        { client: new AnalysisClient(null) },
      );
      const designMs = performance.now() - t0;
      process.stderr.write(
        `[perf] ${ROWS} primer rows on 4.4 kb, engine path: ${designMs.toFixed(0)} ms\n`,
      );

      const oligos = rows.flatMap((row) =>
        row.status === 'designed' && row.kind === 'primers' && row.pairs[0] !== undefined
          ? [
              { name: `${row.name}_F`, sequence: row.pairs[0].forward.sequence },
              { name: `${row.name}_R`, sequence: row.pairs[0].reverse.sequence },
            ]
          : [],
      );
      expect(oligos.length).toBeGreaterThanOrEqual(ROWS * 2 - 2); // nearly every row found a pair

      const t1 = performance.now();
      const check = checkPool(oligos);
      const poolMs = performance.now() - t1;
      process.stderr.write(
        `[perf] pool check on ${oligos.length} oligos: ${poolMs.toFixed(0)} ms, ` +
          `${check.dimers.length} cross-dimers reported\n`,
      );
      expect(check.duplicateNames).toEqual([]);
      // The design time is logged, not asserted (see above); the pool check is tens of milliseconds.
      expectWithin(poolMs, 60_000);
    },
    240_000,
  );
});
