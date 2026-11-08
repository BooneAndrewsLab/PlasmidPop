import { describe, expect, it } from 'vitest';

import {
  type BatchTemplate,
  type CloningBatchRecipe,
  type DesignOverrides,
  type DesignRow,
  mergeOligos,
  range,
} from '@/core';
import { parseGenBank } from '@/io';
import { U49845, ggDestination, ggGene, ifGene, linearVector, pUC19 } from '@/test/cloningFixtures';
import { AnalysisClient } from '@/workers/analysisClient';

import { type CloningBatchRow, runCloningBatch } from './cloningBatch';
import {
  batchProtocols,
  cloningDrafts,
  cloningLines,
  cloningOrderOligos,
  constructEntries,
  constructFileNames,
  ignoredColumns,
} from './cloningResults';

/** The pure side of the cloning Batch page (#360, item 141). */

const inline = new AnalysisClient(null);
const templates: BatchTemplate[] = [
  { name: 'U49845', document: U49845 },
  { name: 'ggGene', document: ggGene },
  { name: 'ifGene', document: ifGene },
];

function row(
  name: string,
  template: string,
  start: number,
  end: number,
  overrides: DesignOverrides = {},
  line = 2,
): DesignRow {
  return {
    line,
    name,
    template,
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

async function run(
  rows: readonly DesignRow[],
  vector: Parameters<typeof runCloningBatch>[1],
  recipe: CloningBatchRecipe,
): Promise<readonly CloningBatchRow[]> {
  return (await runCloningBatch(rows, vector, { recipe, templates }, { client: inline })).rows;
}

describe('cloning results', { timeout: 60_000 }, () => {
  it('lines a restriction row with its parts, its construct and a failed row’s reason', async () => {
    const rows = await run(
      [row('AXL2', 'U49845', 686, 836), row('nowhere', 'missing', 0, 10, {}, 3)],
      pUC19,
      { recipe: 'restriction', forward: 'EcoRI', reverse: 'BamHI' },
    );
    const [good, bad] = cloningLines(rows);
    expect(good?.status).toBe('designed');
    expect(good?.recipe).toBe('restriction');
    // Padding, site and annealing part, the tail in lower case; they join to the oligo.
    expect(good?.forward?.parts.map((p) => p.kind)).toEqual(['padding', 'site', 'annealing']);
    expect(good?.forward?.parts.map((p) => p.text).join('')).toBe(good?.forward?.sequence);
    expect(good?.product).toBeGreaterThan(pUC19.length);
    expect(good?.forwardTm).toBe(good?.forward?.tm);
    expect(bad).toMatchObject({ status: 'failed', forward: null, product: null });
    expect(bad?.messages[0]).toContain('missing');
  });

  it('lines a homology row as the vector’s tail and what anneals', async () => {
    const rows = await run([row('ifGene', 'ifGene', 0, ifGene.length)], linearVector(), {
      recipe: 'homology',
      kit: 'in-fusion',
    });
    const [line] = cloningLines(rows);
    expect(line?.kit).toBe('In-Fusion');
    expect(line?.forward?.parts.map((p) => p.kind)).toEqual(['tail', 'annealing']);
    expect(line?.forward?.parts.map((p) => p.text).join('')).toBe(line?.forward?.sequence);
  });

  it('names oligos name fwd and name rev, for My primers and the order sheet alike', async () => {
    const rows = await run(
      [row('AXL2', 'U49845', 686, 836), row('REV', 'U49845', 3299, 3450, {}, 3)],
      pUC19,
      { recipe: 'restriction', forward: 'EcoRI', reverse: 'BamHI' },
    );
    const lines = cloningLines(rows);
    const drafts = cloningDrafts(lines, 'pUC19');
    expect(drafts.map((d) => d.name)).toEqual(['AXL2 fwd', 'AXL2 rev', 'REV fwd', 'REV rev']);
    // As the Cloning page saves them: the case that tells the tail from the anneal is kept.
    expect(drafts[0]?.sequence).toBe(lines[0]?.forward?.sequence);
    expect(drafts[0]?.sequence).not.toBe(drafts[0]?.sequence.toUpperCase());
    expect(drafts[0]?.notes).toContain('restriction cloning of AXL2 into pUC19');
    const order = cloningOrderOligos(lines);
    expect(order.map((o) => o.name)).toEqual(drafts.map((d) => d.name));
    expect(order[0]?.note).toBe(lines[0]?.messages[0] ?? '');
  });

  it('names the files of a zip for the rows, safe for a path and never the same twice', () => {
    expect(constructFileNames(['a b', 'A B', 'x/y:z', '', 'a b'])).toEqual([
      'a_b.gb',
      'A_B_2.gb',
      'x_y_z.gb',
      'construct.gb',
      'a_b_3.gb',
    ]);
  });

  it('writes a GenBank file per construct, none for a row that made none', async () => {
    const rows = await run(
      [row('one', 'ggGene', 0, ggGene.length), row('lost', 'missing', 0, 5, {}, 3)],
      ggDestination,
      { recipe: 'golden-gate', enzyme: 'BsaI' },
    );
    const entries = constructEntries(rows);
    expect(entries.map((e) => e.path)).toEqual(['one.gb']);
    const text = new TextDecoder().decode(entries[0]?.data);
    const back = parseGenBank(text).documents[0];
    expect(back?.topology).toBe('circular');
    const made = rows[0];
    expect(made?.status === 'designed' ? back?.length === made.product?.length : false).toBe(true);
  });

  it.each([
    [
      'restriction',
      pUC19,
      { recipe: 'restriction', forward: 'EcoRI', reverse: 'BamHI' },
      'U49845',
      686,
      836,
    ],
    [
      'golden-gate',
      ggDestination,
      { recipe: 'golden-gate', enzyme: 'BsaI' },
      'ggGene',
      0,
      ggGene.length,
    ],
    [
      'homology',
      linearVector(),
      { recipe: 'homology', kit: 'in-fusion' },
      'ifGene',
      0,
      ifGene.length,
    ],
  ] as const)(
    'builds a protocol for each %s construct, its oligos named as the order sheet names them',
    async (_name, vector, recipe, template, start, end) => {
      const rows = await run(
        [row('first', template, start, end), row('second', template, start, end - 30, {}, 3)],
        vector,
        recipe,
      );
      const { protocols, without } = await batchProtocols(rows, {});
      expect(without).toEqual([]);
      expect(protocols).toHaveLength(2);
      // Whatever the two rows share is one oligo in the merged table, called by the first row's name.
      const distinct = new Set(
        cloningLines(rows).flatMap((l) => [l.forward?.sequence, l.reverse?.sequence]),
      );
      const merged = mergeOligos(protocols);
      expect(merged).toHaveLength(distinct.size);
      for (const o of merged) expect(o.name).toMatch(/^(first|second) (fwd|rev)$/);
      expect(merged[0]?.name).toBe('first fwd');
      expect(protocols[0]?.product.startsWith('first')).toBe(true);
    },
  );

  it('says which rows have no protocol: no construct, or none recorded', async () => {
    const rows = await run(
      [row('first', 'U49845', 686, 836), row('lost', 'missing', 0, 5, {}, 3)],
      pUC19,
      { recipe: 'restriction', forward: 'EcoRI', reverse: 'BamHI' },
    );
    const { protocols, without } = await batchProtocols(rows, {});
    expect(protocols).toHaveLength(1);
    // A failed row is not a construct that lacks a protocol: it is in the table already.
    expect(without).toEqual([]);
  });

  it('lists the columns a recipe does not read, once each', () => {
    const rows = [
      row('a', 'x', 0, 10, { tm: 60, size: 500, kit: 'yeast', left: 'AATG' }),
      row('b', 'x', 0, 10, { change: 'GCT', size: 300, includeStart: true }, 3),
    ];
    expect(ignoredColumns(rows, 'restriction')).toEqual(['size', 'kit', 'include_start', 'change']);
    expect(ignoredColumns(rows, 'golden-gate')).toEqual(['size', 'kit', 'change']);
    expect(ignoredColumns(rows, 'homology')).toEqual([
      'tm',
      'size',
      'left',
      'include_start',
      'change',
    ]);
    expect(ignoredColumns([], 'homology')).toEqual([]);
  });
});
