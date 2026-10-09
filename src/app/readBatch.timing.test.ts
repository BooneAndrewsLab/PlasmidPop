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
function plate(size = 5000, count = 96): { plasmid: string; reads: BatchRead[] } {
  const rand = seededRandom(96);
  const plasmid = randomDna(rand, size);
  const circle = plasmid + plasmid;
  const reads: BatchRead[] = [];
  for (let r = 0; r < count; r++) {
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
        { options: { fast: true }, mode: 'local', trimCutoff: 0.05 },
      );
      const ms = performance.now() - t0;
      process.stderr.write(`[perf] 96 Sanger reads against 5 kb, banded: ${ms.toFixed(0)} ms\n`);
      expect(rows.every((r) => r.status === 'aligned' && r.result.alignment.identity > 0.95)).toBe(
        true,
      );
      // 0.9-1.2 s here, 4.8-9.9 s on CI runners since the band is checked
      // (#167); aligning both strands in full is 13 s here and far more there.
      expectWithin(ms, 20_000);
    },
    60_000,
  );

  it('aligns reads against a 300 kb circle without indexing it for each read (#170)', async () => {
    const { plasmid, reads } = plate(300_000, 12);
    // The reference's word index puts one entry in a Map for each distinct
    // word of the circle (about 300 000), so counting `Map.set`
    // calls counts index builds without a wall-clock budget, which a CI
    // runner 3-9x slower than this machine cannot meet. An index built per
    // read would make 12 times that; one for the batch, about once.
    const set = vi.spyOn(Map.prototype, 'set');
    let sets: number;
    let rows;
    try {
      ({ rows } = await runReadBatch(
        reads,
        { sequence: plasmid, offset: 0, wrap: plasmid.length },
        (a, b, options) => Promise.resolve(alignEitherStrand(a, b, options)),
        { options: { fast: true }, mode: 'local', trimCutoff: 0.05 },
      ));
    } finally {
      sets = set.mock.calls.length;
      set.mockRestore();
    }
    // A read of mostly poor bases may share too few words with 300 kb to
    // be banded, and fail as too large for a full fill: not what this measures.
    const aligned = rows.filter((r) => r.status === 'aligned');
    expect(aligned.length).toBeGreaterThanOrEqual(11);
    expect(aligned.every((r) => r.result.alignment.identity > 0.9)).toBe(true);
    expect(sets).toBeGreaterThan(200_000); // the spy sees the index at all
    expect(sets).toBeLessThan(2 * 300_000);
  }, 120_000);
});
