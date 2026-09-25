import { alignEitherStrand, reverseComplement } from '@/core';
import { randomDna, randomInt, seededRandom } from '@/test/random';
import { expectWithin, itTimed } from '@/test/timing';

import { type BatchRead, runReadBatch } from './readBatch';

/**
 * A plate of Sanger reads against its plasmid (#59): 96 reads of 700–900
 * bases, poor for their first 30 bases and last 80, with a 1% error rate
 * in between, half of them reversed and some through the origin, against
 * a 5 kb circular plasmid, aligned locally as the Align tab does. The
 * worker runs the same code; `docs/perf-notes.md` has the measurement.
 */
function plate(): { plasmid: string; reads: BatchRead[] } {
  const rand = seededRandom(96);
  const plasmid = randomDna(rand, 5000);
  const circle = plasmid + plasmid;
  const reads: BatchRead[] = [];
  for (let r = 0; r < 96; r++) {
    const length = randomInt(rand, 700, 900);
    const start = randomInt(rand, 0, plasmid.length);
    let bases = '';
    const q: number[] = [];
    for (let i = 0; i < length; i++) {
      const poor = i < 30 || i >= length - 80;
      const error = rand() < (poor ? 0.2 : 0.01);
      const base = circle.charAt(start + i);
      bases += error ? 'ACGT'.charAt(randomInt(rand, 0, 4)) : base;
      q.push(
        poor ? randomInt(rand, 3, 15) : error ? randomInt(rand, 8, 20) : randomInt(rand, 35, 60),
      );
    }
    const reverse = r % 2 === 1;
    reads.push({
      name: `well${r}`,
      sequence: reverse ? reverseComplement(bases) : bases,
      read: { qualities: Uint8Array.from(reverse ? q.reverse() : q), trace: null },
    });
  }
  return { plasmid, reads };
}

describe('a plate of reads', () => {
  itTimed(
    'aligns 96 Sanger reads against a 5 kb plasmid in a few seconds',
    async () => {
      const { plasmid, reads } = plate();
      const t0 = performance.now();
      const { rows } = await runReadBatch(
        reads,
        { sequence: plasmid, offset: 0, wrap: plasmid.length },
        (a, b, options) => Promise.resolve(alignEitherStrand(a, b, options)),
        { options: { mode: 'local', fast: true }, trimCutoff: 0.05 },
      );
      const ms = performance.now() - t0;
      process.stderr.write(`[perf] 96 Sanger reads against 5 kb, banded: ${ms.toFixed(0)} ms\n`);
      expect(rows.every((r) => r.status === 'aligned' && r.result.alignment.identity > 0.95)).toBe(
        true,
      );
      expectWithin(ms, 10_000);
    },
    60_000,
  );
});
