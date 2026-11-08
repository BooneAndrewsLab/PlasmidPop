import { type BatchTemplate, type DesignRow, SeqDocument, checkPool, range } from '@/core';
import { randomDna, randomInt, seededRandom } from '@/test/random';
import { expectWithin, itTimed } from '@/test/timing';
import { AnalysisClient } from '@/workers/analysisClient';

import { runPrimerBatch } from './primerBatch';

/**
 * A plate of primer designs and the pool check over its oligos (#358, #359):
 * 96 regions of 600 bases on a 4.4 kb circular template, designed one after
 * another as the batch runs them, then the checks across the 192 oligos they
 * come to. vitest has no `Worker`, so the analysis client runs the worker's
 * own code on this thread: the numbers are the engine's, without the round
 * trip per row, which is a few kilobytes each way. `docs/perf-notes.md` has
 * the measurement and says what it means for a worker pool.
 */
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
    'designs 96 regions and checks the 192 oligos they make',
    async () => {
      const t0 = performance.now();
      const { rows } = await runPrimerBatch(
        plate(96),
        [template],
        {},
        { client: new AnalysisClient(null) },
      );
      const designMs = performance.now() - t0;
      process.stderr.write(
        `[perf] 96 primer rows on 4.4 kb, engine path: ${designMs.toFixed(0)} ms\n`,
      );

      const oligos = rows.flatMap((row) =>
        row.status === 'designed' && row.kind === 'primers' && row.pairs[0] !== undefined
          ? [
              { name: `${row.name}_F`, sequence: row.pairs[0].forward.sequence },
              { name: `${row.name}_R`, sequence: row.pairs[0].reverse.sequence },
            ]
          : [],
      );
      expect(oligos.length).toBeGreaterThanOrEqual(180); // nearly all 96 rows found a pair

      const t1 = performance.now();
      const check = checkPool(oligos);
      const poolMs = performance.now() - t1;
      process.stderr.write(
        `[perf] pool check on ${oligos.length} oligos: ${poolMs.toFixed(0)} ms, ` +
          `${check.dimers.length} cross-dimers reported\n`,
      );
      expect(check.duplicateNames).toEqual([]);
      // #359's trigger is 15 s per 96 rows; these budgets are looser than that for slow CI runners.
      expectWithin(designMs, 60_000);
      expectWithin(poolMs, 60_000);
    },
    240_000,
  );
});
