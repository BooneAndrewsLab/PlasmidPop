import { alignEitherStrand, alignPairwise, reverseComplement } from '@/core';
import { AnalysisCancelledError } from '@/workers/analysisClient';

import {
  type AlignRequest,
  type BatchRead,
  type BatchRow,
  BATCH_LIMIT,
  runReadBatch,
  sortRows,
  summarizeRow,
} from './readBatch';

const reference = 'GATTACAGCTTGACCGTAAGCTAGGCTTACGATCGATTGCAAGTCCGATGCATTGACCTA';
const ref = { sequence: reference, offset: 0, wrap: null };

/** The worker's alignment, run here. */
const inline: AlignRequest = (a, b, options) => Promise.resolve(alignEitherStrand(a, b, options));

function withMismatch(s: string, at: number): string {
  return s.slice(0, at) + (s[at] === 'A' ? 'C' : 'A') + s.slice(at + 1);
}

const reads: BatchRead[] = [
  { name: 'exact', sequence: reference.slice(5, 45), read: null },
  { name: 'one-off', sequence: withMismatch(reference.slice(10, 50), 20), read: null },
  { name: 'reversed', sequence: reverseComplement(reference.slice(0, 40)), read: null },
];

describe('runReadBatch (#59)', () => {
  it('aligns every read in order, telling each row and the progress as it goes', async () => {
    const told: string[] = [];
    const progress: number[] = [];
    const { rows, cancelled } = await runReadBatch(reads, ref, inline, {
      options: {},
      mode: 'local',
      trimCutoff: 0.05,
      onRow: (r) => told.push(r.name),
      onProgress: (f) => progress.push(f),
    });
    expect(cancelled).toBe(false);
    expect(rows.map((r) => [r.index, r.name, r.status])).toEqual([
      [0, 'exact', 'aligned'],
      [1, 'one-off', 'aligned'],
      [2, 'reversed', 'aligned'],
    ]);
    expect(told).toEqual(['exact', 'one-off', 'reversed']);
    expect(progress.at(-1)).toBe(1);
    expect([...progress].sort((x, y) => x - y)).toEqual(progress);
    const [exact, oneOff, reversed] = rows;
    if (exact?.status !== 'aligned' || oneOff?.status !== 'aligned') throw new Error('unaligned');
    expect(exact.result.alignment.identity).toBe(1);
    expect(summarizeRow(oneOff, 20)).toMatchObject({ differences: 1, confident: null });
    expect(summarizeRow(exact, 20).span).toEqual({ from: 6, to: 45 });
    expect(reversed?.status === 'aligned' && reversed.result.strand).toBe('reverse');
  });

  it('carries on past a read that fails, saying why', async () => {
    let calls = 0;
    const flaky: AlignRequest = (a, b, options, long) => {
      calls++;
      return calls === 2 ? Promise.reject(new Error('Too large')) : inline(a, b, options, long);
    };
    const poor: BatchRead = {
      name: 'poor',
      sequence: 'ACGTACGT',
      read: { qualities: new Uint8Array(8).fill(2), trace: null },
    };
    const { rows } = await runReadBatch(
      [reads[0], poor, reads[1], reads[2]] as BatchRead[],
      ref,
      flaky,
      {
        options: {},
        mode: 'local',
        trimCutoff: 0.05,
      },
    );
    expect(rows.map((r) => r.status)).toEqual(['aligned', 'failed', 'failed', 'aligned']);
    expect(rows[1]?.status === 'failed' && rows[1].message).toMatch(/good enough quality/);
    expect(rows[2]?.status === 'failed' && rows[2].message).toBe('Too large');
    // The poor read never reached the worker.
    expect(calls).toBe(3);
  });

  it('stops at a cancel and keeps the rows done before it', async () => {
    const controller = new AbortController();
    const stopping: AlignRequest = (a, b, options, long) => {
      if (b === reads[1]?.sequence) {
        controller.abort();
        return Promise.reject(new AnalysisCancelledError());
      }
      return inline(a, b, options, long);
    };
    const told: BatchRow[] = [];
    const outcome = await runReadBatch(reads, ref, stopping, {
      options: {},
      mode: 'local',
      trimCutoff: null,
      signal: controller.signal,
      onRow: (r) => told.push(r),
    });
    expect(outcome.cancelled).toBe(true);
    expect(outcome.rows.map((r) => r.name)).toEqual(['exact']);
    expect(told).toHaveLength(1);
  });

  it('does not start once cancelled, and passes the signal to each alignment', async () => {
    const controller = new AbortController();
    const seen: (AbortSignal | undefined)[] = [];
    const spy: AlignRequest = (a, b, options, long) => {
      seen.push(long.signal);
      return inline(a, b, options, long);
    };
    await runReadBatch(reads.slice(0, 1), ref, spy, {
      options: {},
      mode: null,
      trimCutoff: null,
      signal: controller.signal,
    });
    expect(seen).toEqual([controller.signal]);
    controller.abort();
    const outcome = await runReadBatch(reads, ref, spy, {
      options: {},
      mode: null,
      trimCutoff: null,
      signal: controller.signal,
    });
    expect(outcome).toEqual({ rows: [], cancelled: true });
  });

  it('aligns each read in its own mode when none was picked, as a single one starts (#86)', async () => {
    const modes: (string | undefined)[] = [];
    const wraps: string[] = [];
    const spy: AlignRequest = (a, b, options, long) => {
      modes.push(options.mode);
      wraps.push(a === circle ? 'plain' : 'wrapped');
      return inline(a, b, options, long);
    };
    const circle = reference;
    const onCircle = { sequence: circle, offset: 0, wrap: circle.length };
    const whole: BatchRead = { name: 'whole', sequence: circle, read: null };
    const short: BatchRead = { name: 'short', sequence: circle.slice(5, 25), read: null };
    const read: BatchRead = {
      name: 'read',
      sequence: circle.slice(0, 40),
      read: { qualities: new Uint8Array(40).fill(40), trace: null },
    };
    const { rows } = await runReadBatch([whole, short, read], onCircle, spy, {
      options: {},
      mode: null,
      trimCutoff: null,
    });
    expect(modes).toEqual(['global', 'local', 'local']);
    // A global alignment is not made through the origin; a local one may be.
    expect(wraps).toEqual(['plain', 'wrapped', 'wrapped']);
    expect(rows.map((r) => r.status === 'aligned' && r.result.alignment.mode)).toEqual([
      'global',
      'local',
      'local',
    ]);
    expect(rows[0]?.status === 'aligned' && rows[0].result.wrap).toBeNull();

    modes.length = 0;
    await runReadBatch([whole, short, read], onCircle, spy, {
      options: {},
      mode: 'global',
      trimCutoff: null,
    });
    expect(modes).toEqual(['global', 'global', 'global']);
  });

  it('refuses more reads than a plate', async () => {
    const many = Array.from({ length: BATCH_LIMIT + 1 }, (_, i) => ({
      name: `r${i}`,
      sequence: 'ACGT',
      read: null,
    }));
    await expect(
      runReadBatch(many, ref, inline, { options: {}, mode: null, trimCutoff: null }),
    ).rejects.toThrow(/At most 96/);
  });
});

describe('sortRows', () => {
  function row(index: number, identity: number): BatchRow {
    const alignment = { ...alignPairwise('ACGT', 'ACGT'), identity };
    return {
      index,
      name: `r${index}`,
      length: 1,
      status: 'aligned',
      result: {
        alignment,
        strand: 'forward',
        offset: 0,
        wrap: null,
        offsetB: 0,
        lengthB: 0,
        readLength: 0,
        trimmed: null,
        qualities: null,
        trace: null,
      },
    };
  }
  const failed: BatchRow = { index: 1, name: 'bad', length: 1, status: 'failed', message: 'x' };
  const rows = [row(0, 0.9), failed, row(2, 0.99), row(3, 0.9)];

  it('keeps the file order, or sorts by identity with ties in file order and failures last', () => {
    expect(sortRows(rows, 'file', 20).map((r) => r.index)).toEqual([0, 1, 2, 3]);
    expect(sortRows(rows, 'identity-low', 20).map((r) => r.index)).toEqual([0, 3, 2, 1]);
    expect(sortRows(rows, 'identity-high', 20).map((r) => r.index)).toEqual([2, 0, 3, 1]);
  });
});
