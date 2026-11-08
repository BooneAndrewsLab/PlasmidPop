import { describe, expect, it } from 'vitest';

import {
  type BatchTemplate,
  type CloningInsert,
  type DesignOverrides,
  type DesignRow,
  type SeqDocument,
  SeqDocument as Doc,
  designCloningResults,
  designGoldenGatePart,
  designOverlapPrimers,
  designMultiOverlapPrimers,
  destinationOverhangs,
  getEnzyme,
  range,
  recordOverlapDesign,
  resolveVectorRegion,
  scanForCloningNow,
} from '@/core';
import { writeGenBank } from '@/io';
import {
  MCS,
  U49845,
  ggDestination,
  ggGene,
  ifGene,
  linearVector,
  pUC19,
} from '@/test/cloningFixtures';
import { AnalysisCancelledError, AnalysisClient } from '@/workers/analysisClient';
import { type CloningRequest } from '@/workers/analysisProtocol';

import { type CloningBatchClient, type CloningBatchRow, runCloningBatch } from './cloningBatch';

/**
 * The cloning batch runner (#360, item 141, packet 5). The key test is the
 * first of each recipe: a batch row's primers and product are the single
 * insert design the Cloning workspace makes for the same inputs.
 */

const inline = new AnalysisClient(null);
/** A client that counts the requests it is sent, and answers them as the worker does, or not at all. */
function counting(answers = true): CloningBatchClient & { readonly requests: CloningRequest[] } {
  const requests: CloningRequest[] = [];
  return {
    requests,
    designCloning: (request, long) => {
      requests.push(request);
      return answers
        ? inline.designCloning(request, long)
        : Promise.reject(new Error('unexpected'));
    },
  };
}
/** The message of a row that failed; throws for one that did not. */
function failure(row: CloningBatchRow | undefined): string {
  if (row?.status !== 'failed') throw new Error(`not failed: ${JSON.stringify(row)}`);
  return row.message;
}
const gen = (doc: SeqDocument | null): string => (doc === null ? '' : writeGenBank(doc));

const templates: BatchTemplate[] = [
  { name: 'U49845', document: U49845 },
  { name: 'ggGene', document: ggGene },
  { name: 'ifGene', document: ifGene },
];

function region(
  name: string,
  template: string,
  start: number,
  end: number,
  overrides: DesignOverrides = {},
  strand: 'forward' | 'reverse' = 'forward',
  line = 2,
): DesignRow {
  return {
    line,
    name,
    template,
    source: { kind: 'region', range: range(start, end), strand, text: `${start}-${end}` },
    overrides,
    notes: '',
    warnings: [],
  };
}

function designed(
  row: CloningBatchRow | undefined,
): Extract<CloningBatchRow, { status: 'designed' }> {
  if (row?.status !== 'designed') throw new Error(`not designed: ${JSON.stringify(row)}`);
  return row;
}

describe('runCloningBatch: restriction', { timeout: 60_000 }, () => {
  const recipe = {
    recipe: 'restriction',
    forward: 'EcoRI',
    reverse: 'BamHI',
    region: MCS,
  } as const;
  const settings = { padding: 6, avoidJunctionSites: true, criteria: {} };

  /** What the Cloning workspace's Design makes: `designCloningResults`' picked pair, then its simulation. */
  function page(insert: CloningInsert, flipped = false) {
    const { picked } = designCloningResults(
      {
        vector: pUC19,
        region: resolveVectorRegion(pUC19, MCS),
        insert,
        flipped,
        scans: scanForCloningNow(pUC19, insert),
      },
      { forward: 'EcoRI', reverse: 'BamHI' },
      settings,
    );
    const { simulate, ...design } = picked;
    return { design, sim: simulate() };
  }

  it('a row is the single-insert design: the same primers and the same product, as GenBank', async () => {
    const insert: CloningInsert = {
      document: U49845,
      range: range(686, 836),
      strand: 'forward',
      name: 'AXL2',
    };
    const reverse: CloningInsert = {
      document: U49845,
      range: range(3299, 3450),
      strand: 'reverse',
      name: 'REV',
    };
    const { rows, cancelled, refused } = await runCloningBatch(
      [region('AXL2', 'U49845', 686, 836), region('REV', 'U49845', 3299, 3450, {}, 'reverse', 3)],
      pUC19,
      { recipe, settings, templates },
      { client: inline },
    );
    expect(cancelled).toBe(false);
    expect(refused).toBeNull();
    for (const [out, insertOf] of [
      [rows[0], insert],
      [rows[1], reverse],
    ] as const) {
      const row = designed(out);
      if (row.recipe !== 'restriction') throw new Error('wrong recipe');
      const direct = page(insertOf);
      expect(row.design).toEqual(direct.design);
      expect(row.design.forward.sequence).toBe(direct.design.forward.sequence);
      expect(row.design.reverse.sequence).toBe(direct.design.reverse.sequence);
      expect(row.product).not.toBeNull();
      expect(gen(row.product)).toBe(gen(direct.sim.product));
    }
  });

  it('a row of bases is an insert of its own, as a literal sequence is', async () => {
    const bases = U49845.subsequence(range(686, 836));
    const { rows } = await runCloningBatch(
      [{ ...region('lit', 'x', 0, 0), template: null, source: { kind: 'sequence', bases } }],
      pUC19,
      { recipe, settings, templates },
      { client: inline },
    );
    const direct = page({
      document: Doc.create({ name: 'lit', sequence: bases }),
      range: range(0, bases.length),
      strand: 'forward',
      name: 'lit',
    });
    const row = designed(rows[0]);
    expect(row.recipe === 'restriction' && row.design).toEqual(direct.design);
    expect(gen(row.product)).toBe(gen(direct.sim.product));
  });

  it('carries the warnings per row: its own, the design’s, and the unused columns', async () => {
    const { rows } = await runCloningBatch(
      [
        {
          ...region('AXL2', 'U49845', 686, 836, { kit: 'yeast', size: 900 }),
          warnings: ['read as a span'],
        },
      ],
      pUC19,
      { recipe, settings, templates },
      { client: inline },
    );
    const row = designed(rows[0]);
    expect(row.warnings[0]).toBe('read as a span');
    expect(row.warnings).toContain('The kit column is not used by this recipe and was ignored.');
    expect(row.warnings).toContain('The size column is not used by this recipe and was ignored.');
    expect(row.warnings.join(' ')).toMatch(/No annealing part at the insert's ends/);
  });

  it('a row’s columns change its design: its own pair, and the extra bases', async () => {
    const { rows } = await runCloningBatch(
      [region('AXL2', 'U49845', 686, 836, { enzyme: 'EcoRI/SalI', left: 'GCCACC', right: 'TAA' })],
      pUC19,
      { recipe, settings, templates },
      { client: inline },
    );
    const row = designed(rows[0]);
    if (row.recipe !== 'restriction') throw new Error('wrong recipe');
    expect(row.design.pair.reverse.enzyme).toBe('SalI');
    expect(row.design.forward.segments.extra).toBe('GCCACC');
  });

  it('fails a row and goes on: no template, a bad enzyme, a design that cannot be made', async () => {
    const tooShort = region('tiny', 'U49845', 686, 700);
    const { rows } = await runCloningBatch(
      [
        region('lost', 'nowhere', 0, 100, {}, 'forward', 2),
        region('badEnzyme', 'U49845', 686, 836, { enzyme: 'EcoRI/NopeI' }, 'forward', 3),
        { ...tooShort, line: 4 },
        region('ok', 'U49845', 686, 836, {}, 'forward', 5),
      ],
      pUC19,
      { recipe, settings, templates },
      { client: inline },
    );
    expect(rows.map((r) => [r.name, r.status])).toEqual([
      ['lost', 'failed'],
      ['badEnzyme', 'failed'],
      ['tiny', 'failed'],
      ['ok', 'designed'],
    ]);
    expect(rows[0]).toMatchObject({ message: 'No template named “nowhere”.' });
    expect(rows[1]).toMatchObject({ message: 'NopeI is not in the enzyme set.' });
    expect(failure(rows[2])).toMatch(/too short to amplify/);
  });
});

describe('runCloningBatch: Golden Gate', { timeout: 60_000 }, () => {
  const enzyme = getEnzyme('BsaI');
  if (enzyme === undefined) throw new Error('no BsaI');
  const overhangs = destinationOverhangs(ggDestination, enzyme);
  if (overhangs === null) throw new Error('no overhangs');
  const recipe = { recipe: 'golden-gate', enzyme: 'BsaI' } as const;

  it('a row is the single-insert part: the same primers and the same circle, as GenBank', async () => {
    const insert: CloningInsert = {
      document: ggGene,
      range: range(0, ggGene.length),
      strand: 'forward',
      name: 'ggGene',
    };
    const direct = designGoldenGatePart(
      { insert, destination: ggDestination, otherParts: [] },
      {
        enzyme: 'BsaI',
        secondEnzyme: '',
        left: overhangs.left,
        right: overhangs.right,
        includeStart: true,
        includeStop: false,
        padding: 6,
        avoidJunctionSites: true,
        criteria: {},
      },
    );
    const { simulate, ...design } = direct;
    const { rows, vector } = await runCloningBatch(
      [region('ggGene', 'ggGene', 0, ggGene.length)],
      ggDestination,
      { recipe, settings: { padding: 6, avoidJunctionSites: true, criteria: {} }, templates },
      { client: inline },
    );
    expect(vector.overhangs).toEqual({ left: overhangs.left, right: overhangs.right });
    const row = designed(rows[0]);
    if (row.recipe !== 'golden-gate') throw new Error('wrong recipe');
    expect(row.design).toEqual(design);
    expect(row.design.forward.sequence).toBe(direct.forward.sequence);
    expect(row.design.reverse.sequence).toBe(direct.reverse.sequence);
    const product = simulate().product;
    expect(product).not.toBeNull();
    expect(gen(row.product)).toBe(gen(product));
  });

  it('a row’s own overhangs and enzyme change its design, and its warnings are carried', async () => {
    const { rows } = await runCloningBatch(
      [region('own', 'ggGene', 0, ggGene.length, { left: 'AATG', right: 'GCTT', kit: 'yeast' })],
      ggDestination,
      { recipe, templates },
      { client: inline },
    );
    const row = designed(rows[0]);
    if (row.recipe !== 'golden-gate') throw new Error('wrong recipe');
    expect(row.design.left).toBe('AATG');
    expect(row.design.right).toBe('GCTT');
    expect(row.warnings).toContain('The kit column is not used by this recipe and was ignored.');
    // the circle cannot close on overhangs the destination does not have, and says so
    expect(row.product).toBeNull();
    expect(row.warnings.length).toBeGreaterThan(1);
  });

  it('refuses the batch once, not row by row, for a destination the enzyme opens nothing in', async () => {
    const client = counting(false);
    const out = await runCloningBatch(
      [region('a', 'ggGene', 0, 100), region('b', 'ggGene', 0, 100, {}, 'forward', 3)],
      ggDestination,
      { recipe: { recipe: 'golden-gate', enzyme: 'BbsI' }, templates },
      { client },
    );
    expect(out.refused).toMatch(/BbsI opens nothing in/);
    expect(out.rows).toEqual([]);
    expect(client.requests).toEqual([]);
  });

  it('fails only the row whose enzyme is wrong, when the batch’s is fine', async () => {
    const { rows } = await runCloningBatch(
      [
        region('a', 'ggGene', 0, ggGene.length, { enzyme: 'BbsI' }),
        region('b', 'ggGene', 0, ggGene.length, { enzyme: 'EcoRI' }, 'forward', 3),
      ],
      ggDestination,
      { recipe, templates },
      { client: inline },
    );
    expect(failure(rows[0])).toMatch(/opens nothing/);
    expect(failure(rows[1])).toMatch(/not Type IIS/);
  });
});

describe('runCloningBatch: homology', { timeout: 60_000 }, () => {
  const vector = linearVector();
  const whole = region('ifGene', 'ifGene', 0, ifGene.length);

  it.each([
    ['in-fusion', undefined],
    ['nebuilder', undefined],
    ['yeast', 30],
  ] as const)(
    'a row is the single-insert design, %s: the same primers and the same circle, as GenBank',
    async (kit, overlap) => {
      const direct = designMultiOverlapPrimers(
        vector,
        [{ template: ifGene, region: range(0, ifGene.length), reverse: false }],
        kit,
        overlap === undefined ? {} : { overlap },
      );
      const { rows, refused } = await runCloningBatch(
        [whole],
        vector,
        {
          recipe: { recipe: 'homology', kit, ...(overlap === undefined ? {} : { overlap }) },
          templates,
        },
        { client: inline },
      );
      expect(refused).toBeNull();
      const row = designed(rows[0]);
      if (row.recipe !== 'homology') throw new Error('wrong recipe');
      expect(row.design.primers).toEqual({
        forward: direct.inserts[0]?.forward,
        reverse: direct.inserts[0]?.reverse,
      });
      expect(row.product).not.toBeNull();
      // With its lineage, as `recordOverlapDesign` writes it wherever a design is opened.
      const first = direct.inserts[0];
      if (first === undefined) throw new Error('no insert');
      const recorded = recordOverlapDesign(
        { ...first, kit, product: direct.product, warnings: direct.warnings, problem: null },
        vector,
        ifGene,
        kit,
      );
      expect(gen(row.product)).toBe(gen(recorded));
      expect(gen(row.product)).toContain('PlasmidPop-made-from');
      expect(row.warnings).toEqual(direct.warnings);
    },
  );

  it('for one forward insert and a kit’s own overlap, is what the Bench’s designOverlapPrimers makes', async () => {
    const { rows } = await runCloningBatch(
      [whole],
      vector,
      { recipe: { recipe: 'homology', kit: 'in-fusion' }, templates },
      { client: inline },
    );
    const row = designed(rows[0]);
    const bench = designOverlapPrimers(vector, ifGene, range(0, ifGene.length), 'in-fusion');
    if (row.recipe !== 'homology') throw new Error('wrong recipe');
    expect(row.design.primers).toEqual({ forward: bench.forward, reverse: bench.reverse });
    expect(row.product?.sequence.toString()).toBe(bench.product?.sequence.toString());
  });

  it('a row’s kit changes its design, and the columns it has no use for are said', async () => {
    const { rows } = await runCloningBatch(
      [{ ...whole, overrides: { kit: 'NEBuilder HiFi', enzyme: 'BsaI' } }],
      vector,
      { recipe: { recipe: 'homology', kit: 'in-fusion' }, templates },
      { client: inline },
    );
    const row = designed(rows[0]);
    if (row.recipe !== 'homology') throw new Error('wrong recipe');
    expect(row.kit).toBe('nebuilder');
    expect(row.warnings).toContain('The enzyme column is not used by this recipe and was ignored.');
    expect(row.warnings.join(' ')).toMatch(/NEBuilder HiFi asks for 20 bases/);
  });

  it('refuses a circular vector once, with the designer’s own reason, asking the worker nothing', async () => {
    const client = counting(false);
    const out = await runCloningBatch(
      [whole],
      pUC19,
      { recipe: { recipe: 'homology', kit: 'in-fusion' }, templates },
      { client },
    );
    expect(out.refused).toMatch(/is circular, so it has no ends for the tails to match/);
    expect(out.rows).toEqual([]);
    expect(client.requests).toEqual([]);
  });

  it('a kit the row names that is not one fails that row, not the batch', async () => {
    const { rows } = await runCloningBatch(
      [
        { ...whole, overrides: { kit: 'Gateway' } },
        { ...whole, name: 'ok', line: 3 },
      ],
      vector,
      { recipe: { recipe: 'homology', kit: 'in-fusion' }, templates },
      { client: inline },
    );
    expect(rows.map((r) => r.status)).toEqual(['failed', 'designed']);
  });

  it('a row of bases too short for the homology is a failed row with the designer’s reason', async () => {
    const { rows } = await runCloningBatch(
      [
        {
          ...whole,
          name: 'short',
          template: null,
          source: { kind: 'sequence', bases: 'ACGTACGTAC' },
        },
      ],
      vector,
      { recipe: { recipe: 'homology', kit: 'in-fusion' }, templates },
      { client: inline },
    );
    expect(failure(rows[0])).toMatch(/too short to amplify/);
  });
});

describe('runCloningBatch: the batch', { timeout: 60_000 }, () => {
  const vector = linearVector();
  const recipe = { recipe: 'homology', kit: 'in-fusion' } as const;
  const whole = (name: string, line: number): DesignRow => ({
    ...region(name, 'ifGene', 0, ifGene.length),
    name,
    line,
  });

  it('fails the later of two rows of one name, and designs the first', async () => {
    const client = counting();
    const { rows } = await runCloningBatch(
      [whole('a', 2), whole('A', 3)],
      vector,
      { recipe, templates },
      { client },
    );
    expect(rows.map((r) => r.status)).toEqual(['designed', 'failed']);
    expect(rows[1]).toMatchObject({ message: 'The name “A” is already used on line 2.' });
    expect(client.requests).toHaveLength(1);
  });

  it('reports each row as it is done, with progress ending at 1', async () => {
    const seen: string[] = [];
    const fractions: number[] = [];
    await runCloningBatch(
      [whole('a', 2), whole('b', 3)],
      vector,
      { recipe, templates },
      { client: inline, onRow: (r) => seen.push(r.name), onProgress: (f) => fractions.push(f) },
    );
    expect(seen).toEqual(['a', 'b']);
    expect(fractions[fractions.length - 1]).toBe(1);
    expect(fractions.every((f, i) => i === 0 || f >= (fractions[i - 1] ?? 0))).toBe(true);
  });

  it('keeps the rows done when a cancel stops it', async () => {
    const controller = new AbortController();
    const client: CloningBatchClient = {
      designCloning: (request, long) => {
        if (request.insert.name === 'b') {
          controller.abort();
          return Promise.reject(new AnalysisCancelledError());
        }
        return inline.designCloning(request, long);
      },
    };
    const { rows, cancelled } = await runCloningBatch(
      [whole('a', 2), whole('b', 3), whole('c', 4)],
      vector,
      { recipe, templates },
      { client, signal: controller.signal },
    );
    expect(cancelled).toBe(true);
    expect(rows.map((r) => r.name)).toEqual(['a']);
  });

  it('turns a worker error into a failed row', async () => {
    const client: CloningBatchClient = { designCloning: () => Promise.reject(new Error('boom')) };
    const { rows } = await runCloningBatch(
      [whole('a', 2)],
      vector,
      { recipe, templates },
      { client },
    );
    expect(rows[0]).toMatchObject({ status: 'failed', message: 'boom' });
  });

  it('refuses more rows than the limit', async () => {
    const many = Array.from({ length: 97 }, (_, i) => whole(`r${i}`, i + 2));
    await expect(
      runCloningBatch(many, vector, { recipe, templates }, { client: inline }),
    ).rejects.toThrow(/96/);
  });
});
