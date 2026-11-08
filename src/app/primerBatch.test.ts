import {
  type BatchTemplate,
  type DesignRow,
  SeqDocument,
  designMutagenesis,
  designPrimers,
  range,
} from '@/core';
import { randomDna, seededRandom } from '@/test/random';
import { AnalysisCancelledError, AnalysisClient } from '@/workers/analysisClient';

import { type PrimerBatchClient, runPrimerBatch } from './primerBatch';

const bases = randomDna(seededRandom(358), 3000);
const template: BatchTemplate = {
  name: 'pTest',
  document: SeqDocument.create({ name: 'pTest', sequence: bases, topology: 'circular' }),
};

function region(name: string, start: number, end: number, overrides = {}): DesignRow {
  return {
    line: 2,
    name,
    template: 'pTest',
    source: {
      kind: 'region',
      range: range(start, end),
      strand: 'forward',
      text: `${start}-${end}`,
    },
    overrides,
    notes: '',
    warnings: [],
  };
}

/** The inline client: no Worker here, so the worker's own code runs on this thread. */
const inline = new AnalysisClient(null);

describe('runPrimerBatch', () => {
  it('designs each row as the engine does, and reports each as it is done', async () => {
    const rows = [region('a', 1000, 1300), region('b', 2000, 2200)];
    const seen: string[] = [];
    const fractions: number[] = [];
    const { rows: out, cancelled } = await runPrimerBatch(
      rows,
      [template],
      {},
      { client: inline, onRow: (r) => seen.push(r.name), onProgress: (f) => fractions.push(f) },
    );
    expect(cancelled).toBe(false);
    expect(seen).toEqual(['a', 'b']);
    expect(fractions[fractions.length - 1]).toBe(1);
    const a = out[0];
    if (a?.status !== 'designed' || a.kind !== 'primers') throw new Error('not designed');
    expect(a.pairs).toEqual(designPrimers(bases, 'circular', range(1000, 1300), {}));
  });

  it('designs a row with a change as a mutagenesis, with the mutant a document again', async () => {
    const { rows } = await runPrimerBatch(
      [region('m', 1000, 1003, { change: 'GCT' })],
      [template],
      {},
      { client: inline },
    );
    const row = rows[0];
    if (row?.status !== 'designed' || row.kind !== 'mutagenesis') throw new Error('not designed');
    const direct = designMutagenesis(template.document, range(1000, 1003), 'GCT', 'back-to-back');
    expect(row.design.forward).toEqual(direct.forward);
    expect(row.design.reverse).toEqual(direct.reverse);
    expect(row.design.label).toBe(direct.label);
    expect(row.design.mutant.sequence.toString()).toBe(direct.mutant.sequence.toString());
  });

  it('fails a row that cannot be designed and goes on with the next', async () => {
    const noRegion: DesignRow = {
      ...region('x', 0, 0),
      source: { kind: 'whole', range: range(0, 3000) },
    };
    const bareBases: DesignRow = {
      ...region('y', 0, 0),
      template: null,
      source: { kind: 'sequence', bases: 'ACGT' },
    };
    const lost = { ...region('z', 10, 20), template: 'nowhere' };
    const { rows } = await runPrimerBatch(
      [noRegion, bareBases, lost, region('ok', 1000, 1300)],
      [template],
      {},
      { client: inline },
    );
    expect(rows.map((r) => r.status)).toEqual(['failed', 'failed', 'failed', 'designed']);
    expect(rows[2]?.status === 'failed' ? rows[2].message : '').toContain('nowhere');
  });

  it('applies a row’s Tm and size over the batch criteria, and notes options it ignores', async () => {
    const calls: unknown[] = [];
    const client: PrimerBatchClient = {
      designPrimers: (s, t, target, options) => {
        calls.push(options);
        return Promise.resolve(designPrimers(s, t, target, options));
      },
      designMutagenesis: () => Promise.reject(new Error('unused')),
    };
    const { rows } = await runPrimerBatch(
      [region('t', 1000, 1300, { tm: 60, size: 900, left: 'GG' })],
      [template],
      { criteria: { maxPairs: 3 } },
      { client },
    );
    expect(calls).toEqual([{ maxPairs: 3, minTm: 55, maxTm: 65, maxProduct: 900 }]);
    const row = rows[0];
    expect(row?.status === 'designed' ? row.warnings.join(' ') : '').toContain('left');
  });

  it('keeps the rows done when a cancel stops it', async () => {
    const controller = new AbortController();
    const client: PrimerBatchClient = {
      designPrimers: (s, t, target, options) => {
        if (target.start === 2000) {
          controller.abort();
          return Promise.reject(new AnalysisCancelledError());
        }
        return Promise.resolve(designPrimers(s, t, target, options));
      },
      designMutagenesis: () => Promise.reject(new Error('unused')),
    };
    const { rows, cancelled } = await runPrimerBatch(
      [region('a', 1000, 1300), region('b', 2000, 2200), region('c', 500, 700)],
      [template],
      {},
      { client, signal: controller.signal },
    );
    expect(cancelled).toBe(true);
    expect(rows.map((r) => r.name)).toEqual(['a']);
  });

  it('turns a worker error into a failed row', async () => {
    const client: PrimerBatchClient = {
      designPrimers: () => Promise.reject(new Error('boom')),
      designMutagenesis: () => Promise.reject(new Error('unused')),
    };
    const { rows } = await runPrimerBatch([region('a', 1000, 1300)], [template], {}, { client });
    expect(rows[0]).toMatchObject({ status: 'failed', message: 'boom' });
  });

  it('refuses more rows than the limit', async () => {
    const many = Array.from({ length: 97 }, (_, i) => region(`r${i}`, 1000, 1300));
    await expect(runPrimerBatch(many, [template], {}, { client: inline })).rejects.toThrow(/96/);
  });
});
