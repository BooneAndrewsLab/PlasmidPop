import { type BatchTemplate, type DesignRow, SeqDocument, designPrimers, range } from '@/core';
import { randomDna, seededRandom } from '@/test/random';
import { AnalysisCancelledError } from '@/workers/analysisClient';
import { AnalysisPool, MAX_POOL_WORKERS, poolSize } from '@/workers/analysisPool';

import { runInLanes } from './batchLanes';
import { type PrimerBatchClient, runPrimerBatch } from './primerBatch';

const bases = randomDna(seededRandom(423), 3000);
const template: BatchTemplate = {
  name: 'pTest',
  document: SeqDocument.create({ name: 'pTest', sequence: bases, topology: 'circular' }),
};

function region(name: string, start: number, end: number): DesignRow {
  return {
    line: 2,
    name,
    template: 'pTest',
    source: { kind: 'region', range: range(start, end), strand: 'forward', text: `${start}` },
    overrides: {},
    notes: '',
    warnings: [],
  };
}

/** A promise settled from outside, so a test decides which row finishes first. */
function gate(): { promise: Promise<void>; open: () => void } {
  let open = (): void => undefined;
  const promise = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { promise, open };
}

describe('poolSize', () => {
  it('follows the cores, up to four, and is one when unknown', () => {
    expect(poolSize(undefined)).toBe(1);
    expect(poolSize(Number.NaN)).toBe(1);
    expect(poolSize(0)).toBe(1);
    expect(poolSize(2)).toBe(2);
    expect(poolSize(16)).toBe(MAX_POOL_WORKERS);
  });
});

describe('AnalysisPool', () => {
  it('makes one client per lane and starts no worker until asked', () => {
    let made = 0;
    const pool = new AnalysisPool(3, () => {
      made++;
      throw new Error('no workers here');
    });
    expect(pool.clients).toHaveLength(3);
    expect(made).toBe(0);
    pool.release();
  });
});

describe('runInLanes', () => {
  it('runs as many rows at once as there are lanes, each lane taking the next row', async () => {
    const gates = [gate(), gate(), gate(), gate()];
    const started: [number, number][] = [];
    const run = runInLanes(4, 2, async (index, lane) => {
      started.push([index, lane]);
      await gates[index]?.promise;
      return index;
    });
    await Promise.resolve();
    expect(started).toEqual([
      [0, 0],
      [1, 1],
    ]);
    gates[1]?.open();
    await new Promise((r) => setTimeout(r, 0));
    expect(started[2]).toEqual([2, 1]); // the lane that finished takes the next row
    for (const g of gates) g.open();
    expect((await run).rows).toEqual([0, 1, 2, 3]);
  });

  it('hands rows over in order when a later one finishes first, with progress rising to 1', async () => {
    const gates = [gate(), gate(), gate()];
    const seen: number[] = [];
    const fractions: number[] = [];
    const run = runInLanes(
      3,
      3,
      async (index, _lane, progress) => {
        progress(0.5);
        await gates[index]?.promise;
        return index;
      },
      { onRow: (r) => seen.push(r), onProgress: (f) => fractions.push(f) },
    );
    await Promise.resolve();
    gates[2]?.open();
    gates[1]?.open();
    await new Promise((r) => setTimeout(r, 0));
    expect(seen).toEqual([]); // row 0 is not done, so nothing is handed over
    gates[0]?.open();
    const { rows, cancelled } = await run;
    expect(seen).toEqual([0, 1, 2]);
    expect(rows).toEqual([0, 1, 2]);
    expect(cancelled).toBe(false);
    expect(fractions[fractions.length - 1]).toBe(1);
    expect([...fractions].sort((a, b) => a - b)).toEqual(fractions);
  });

  it('keeps the rows done before the first one a cancel cut short', async () => {
    const controller = new AbortController();
    const slow = gate();
    const { rows, cancelled } = await runInLanes(
      5,
      2,
      async (index) => {
        if (index === 0) await slow.promise; // row 0 is still running when row 1 cancels
        if (index === 1) {
          controller.abort();
          slow.open();
          throw new AnalysisCancelledError();
        }
        return index;
      },
      { signal: controller.signal },
    );
    expect(cancelled).toBe(true);
    expect(rows).toEqual([0]);
  });

  it('starts nothing once the signal is aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    const task = vi.fn(() => Promise.resolve(1));
    const out = await runInLanes(3, 2, task, { signal: controller.signal });
    expect(task).not.toHaveBeenCalled();
    expect(out).toEqual({ rows: [], cancelled: true });
  });
});

// These run the real primer engine: a CI runner takes several seconds for four rows, so the
// per-test limit is raised; nothing asserts a duration.
describe('runPrimerBatch over a pool', { timeout: 30_000 }, () => {
  /** A client that counts what it was asked, and fails one region. */
  function client(asked: number[], failAt = -1): PrimerBatchClient {
    return {
      designPrimers: (s, t, target, options) => {
        asked.push(target.start);
        if (target.start === failAt) return Promise.reject(new Error('boom'));
        return Promise.resolve(designPrimers(s, t, target, options));
      },
      designMutagenesis: () => Promise.reject(new Error('unused')),
    };
  }
  const rows = [
    region('a', 1000, 1300),
    region('b', 2000, 2200),
    region('c', 500, 700),
    region('d', 1500, 1700),
  ];

  it('spreads the rows over the clients and returns them in the rows order', async () => {
    const left: number[] = [];
    const right: number[] = [];
    const seen: string[] = [];
    const fractions: number[] = [];
    const out = await runPrimerBatch(
      rows,
      [template],
      {},
      {
        clients: [client(left), client(right)],
        onRow: (r) => seen.push(r.name),
        onProgress: (f) => fractions.push(f),
      },
    );
    expect(out.cancelled).toBe(false);
    expect(out.rows.map((r) => r.name)).toEqual(['a', 'b', 'c', 'd']);
    expect(out.rows.map((r) => r.index)).toEqual([0, 1, 2, 3]);
    expect(seen).toEqual(['a', 'b', 'c', 'd']);
    expect(left.length).toBeGreaterThan(0);
    expect(right.length).toBeGreaterThan(0);
    expect(left.length + right.length).toBe(4);
    expect(fractions[fractions.length - 1]).toBe(1);
  });

  it('makes a failed row of a failing one and goes on with the rest', async () => {
    const out = await runPrimerBatch(
      rows,
      [template],
      {},
      { clients: [client([], 2000), client([], 2000)] },
    );
    expect(out.rows.map((r) => r.status)).toEqual(['designed', 'failed', 'designed', 'designed']);
    expect(out.rows[1]).toMatchObject({ message: 'boom', index: 1 });
  });

  it('stops on a cancel and keeps the rows before the cut one', async () => {
    const controller = new AbortController();
    const cancelling: PrimerBatchClient = {
      designPrimers: (s, t, target, options) => {
        if (target.start === 2000) {
          controller.abort();
          return Promise.reject(new AnalysisCancelledError());
        }
        return Promise.resolve(designPrimers(s, t, target, options));
      },
      designMutagenesis: () => Promise.reject(new Error('unused')),
    };
    const out = await runPrimerBatch(
      rows,
      [template],
      {},
      { clients: [cancelling, cancelling], signal: controller.signal },
    );
    expect(out.cancelled).toBe(true);
    expect(out.rows.map((r) => r.name)).toEqual(['a']);
  });
});
