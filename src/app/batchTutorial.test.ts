import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  type BatchTemplate,
  type CloningBatchRecipe,
  type SeqDocument,
  BUNDLED_ENZYME_SET,
  buildOrderSheet,
  checkPool,
  formatDg,
  mergeOligos,
  parseBatchText,
  scanRows,
  setActiveEnzymeSet,
  validateBatch,
} from '@/core';
import { parseGenBank } from '@/io/genbank/parseGenBank';
import { AnalysisClient } from '@/workers/analysisClient';

import { batchOligos, batchOrderOligos, resultLines } from './batchResults';
import { type CloningBatchRow, runCloningBatch } from './cloningBatch';
import { batchProtocols, constructEntries } from './cloningResults';
import { runPrimerBatch } from './primerBatch';

/**
 * Verifies docs/tutorials/batch-primers.md (item 141, #424): the rows the page
 * has the reader paste, run through the path the Batch page runs (the table
 * reader, `validateBatch`, the runners, the pool check, the order sheet), and
 * every count and message the tutorial states. The sample files are the
 * tutorial's own, so a change to one fails here.
 */

const DIR = join(__dirname, '../../docs/tutorials/files');
function tut(name: string): SeqDocument {
  const doc = parseGenBank(readFileSync(join(DIR, `${name}.gb`), 'utf8')).documents[0];
  if (doc === undefined) throw new Error(`${name} has no record`);
  return doc;
}
const inline = new AnalysisClient(null);

beforeAll(() => {
  setActiveEnzymeSet(BUNDLED_ENZYME_SET);
});

/** The rows of Exercise 1, as the tutorial has them pasted. */
const PRIMER_ROWS = `name,region,tm,size,change
ORF,synthORF,,,
promoter,synthetic promoter,,,
terminator,synthetic terminator,,,
ORF,200-300,,,
tight,400-460,,40,
E4A,150-152,,,GCG
`;

describe('Batch tutorial: primer pairs', { timeout: 60_000 }, () => {
  const plasmid = tut('BP-Plasmid');
  const templates: BatchTemplate[] = [{ name: plasmid.name, document: plasmid }];

  it('is the plasmid the tutorial describes', () => {
    expect([plasmid.name, plasmid.length, plasmid.topology]).toEqual([
      'BP-Plasmid',
      923,
      'circular',
    ]);
    const cds = [...plasmid.features.all()].find((f) => f.name === 'synthORF');
    expect(cds?.segments[0]).toMatchObject({ start: 140, end: 383 });
  });

  it('checks the table: 5 rows ready, the repeated name a problem and not run', () => {
    const v = validateBatch(parseBatchText(PRIMER_ROWS), {
      templates,
      defaultTemplate: plasmid.name,
    });
    expect(v.rows.map((r) => r.name)).toEqual(['ORF', 'promoter', 'terminator', 'tight', 'E4A']);
    const bad = v.results.flatMap((r) => (r.ok ? [] : [r]));
    expect(bad).toEqual([
      { ok: false, line: 5, name: 'ORF', message: 'The name “ORF” is already used on line 2.' },
    ]);
  });

  it('runs: four designed, the 40 bp ceiling failed, then the pool and the order sheet', async () => {
    const v = validateBatch(parseBatchText(PRIMER_ROWS), {
      templates,
      defaultTemplate: plasmid.name,
    });
    const { rows, cancelled } = await runPrimerBatch(v.rows, templates, {}, { client: inline });
    expect(cancelled).toBe(false);
    const lines = resultLines(rows);
    expect(lines.map((l) => `${l.name} ${l.status} ${l.kind ?? '-'} ${l.product ?? '-'}`)).toEqual([
      'ORF designed primers 483',
      'promoter designed primers 500',
      'terminator designed primers 332',
      'tight failed - -',
      'E4A designed mutagenesis 923',
    ]);
    expect(lines[3]?.messages).toEqual(['No primer pair meets the criteria for this region.']);
    expect(lines.filter((l) => l.messages.length > 0 && l.status === 'designed')).toEqual([]);

    // The pool: no repeated name or bases, three dimers past -6, a Tm spread over 5 C.
    const pool = checkPool(batchOligos(lines));
    expect(pool.duplicateNames).toEqual([]);
    expect(pool.sameBases).toEqual([]);
    expect(pool.dimers.map((d) => `${d.a} × ${d.b} ${formatDg(d.dg)}`)).toEqual([
      'ORF fwd × E4A rev −6.8',
      'ORF rev × E4A fwd −6.5',
      'ORF fwd × terminator fwd −6.3',
    ]);
    expect(pool.tm?.min.toFixed(1)).toBe('59.4');
    expect(pool.tm?.max.toFixed(1)).toBe('66.6');
    expect(pool.tm?.spread.toFixed(1)).toBe('7.2');
    expect(pool.tm?.exceeds).toBe(true);

    // The order sheet: eight oligos, one plate, A1 to A8 along the row.
    const sheet = buildOrderSheet(batchOrderOligos(lines), {});
    expect(sheet.problems).toEqual([]);
    const csv = sheet.csv.trim().split(/\r?\n/);
    expect(csv[0]).toBe('plate,well,name,sequence,length,scale,purification,notes');
    expect(csv).toHaveLength(9);
    expect(csv[1]).toBe('1,A1,ORF fwd,ATCTGATTTGCTGGTTGGCGC,21,25 nmol,desalted,');
    expect(csv[8]).toBe('1,A8,E4A rev,GGCGCACATCCAGGGCG,17,25 nmol,desalted,');
  });

  it('a duplicate name reaches the order sheet as a problem when two oligos share one', () => {
    const sheet = buildOrderSheet(
      [
        { name: 'ORF fwd', sequence: 'ACGTACGTAC', note: '' },
        { name: 'orf FWD', sequence: 'TTGCATGCAA', note: '' },
      ],
      {},
    );
    expect(sheet.problems.length).toBeGreaterThan(0);
  });

  it('scan rows: residues 1 to 6 to Ala give 5 rows and leave out residue 3, already Ala, and they design', async () => {
    const cds = [...plasmid.features.all()].find((f) => f.name === 'synthORF');
    if (cds === undefined) throw new Error('no synthORF');
    const made = scanRows(plasmid, cds, { template: plasmid.name, from: 1, through: 6 });
    expect(
      made.rows.map((r) => `${r.cells.name} ${r.cells.region} ${r.cells.change ?? ''}`),
    ).toEqual([
      'synthORF_M1A 141..143 GCG',
      'synthORF_C2A 144..146 GCC',
      'synthORF_E4A 150..152 GCG',
      'synthORF_W5A 153..155 GCG',
      'synthORF_N6A 156..158 GCC',
    ]);
    expect(made.skipped).toEqual([{ residue: 3, aminoAcid: 'A', reason: 'already A' }]);
    const v = validateBatch(
      { ...parseBatchText('name,template,region,change\nx,,1-3,A'), rows: made.rows },
      { templates, defaultTemplate: plasmid.name },
    );
    expect(v.rows).toHaveLength(5);
    const { rows } = await runPrimerBatch(v.rows, templates, {}, { client: inline });
    expect(rows.map((r) => r.status)).toEqual(Array<string>(5).fill('designed'));
  });
});

describe('Batch tutorial: cloning many inserts', { timeout: 60_000 }, () => {
  const gene = tut('GG-gene');
  const destination = tut('pGG-Destination');
  const templates: BatchTemplate[] = [
    { name: gene.name, document: gene },
    { name: destination.name, document: destination },
  ];
  const MINI =
    'ATGTGTCGTAGAAACGGACGCCGCCCCCAGAGTGACGAAAACTCTCTTAGGAGCGCCTATGTACTTACTAACAGAGACAGCAGTCCGACTAGGGTGCAATGTGTCGCCGGTGGCATTTAA';
  const rowsFor = (extra: string, blank: string): string => `name,template,region,sequence,${extra}
gene_full,GG-gene,,,
gene_head,GG-gene,1-300,,
mini,,,${MINI},
badcell,GG-gene,,,${blank}
lost,nowhere,1-100,,
`;

  async function run(
    vector: SeqDocument,
    recipe: CloningBatchRecipe,
    text: string,
  ): Promise<{
    readonly rows: readonly CloningBatchRow[];
    readonly problems: number;
    readonly vector: Awaited<ReturnType<typeof runCloningBatch>>['vector'];
  }> {
    const v = validateBatch(parseBatchText(text), { templates, defaultTemplate: gene.name });
    const out = await runCloningBatch(v.rows, vector, { recipe, templates }, { client: inline });
    return {
      rows: out.rows,
      problems: v.results.filter((r) => !r.ok).length,
      vector: out.vector,
    };
  }
  const summary = (rows: readonly CloningBatchRow[]): string[] =>
    rows.map((r) =>
      r.status === 'failed'
        ? `${r.name} failed`
        : `${r.name} ${r.product?.length ?? '-'} ${r.warnings.length > 0 ? 'warnings' : 'clean'}`,
    );

  it('Golden Gate part: three constructs, the overhangs once, one bad enzyme failed, one row not run', async () => {
    const out = await run(
      destination,
      { recipe: 'golden-gate', enzyme: 'BsaI' },
      rowsFor('enzyme', 'NotAnEnzyme'),
    );
    expect(out.problems).toBe(1);
    expect(out.vector.overhangs).toEqual({ left: 'GGAG', right: 'CGCT' });
    expect(summary(out.rows)).toEqual([
      'gene_full 3029 clean',
      'gene_head 2630 clean',
      'mini 2447 warnings',
      'badcell failed',
    ]);
    const mini = out.rows[2];
    expect(mini?.status === 'designed' ? mini.warnings[0] : '').toMatch(
      /^No annealing part at the part's ends meets the settings/,
    );
    const bad = out.rows[3];
    expect(bad?.status === 'failed' ? bad.message : '').toBe(
      'NotAnEnzyme is not in the enzyme set.',
    );

    // The zip: one GenBank file for each construct, named for its row.
    expect(constructEntries(out.rows).map((e) => e.path)).toEqual([
      'gene_full.gb',
      'gene_head.gb',
      'mini.gb',
    ]);

    // The protocol: one per construct, one oligo table of 6 (each sequence once).
    const { protocols, without } = await batchProtocols(out.rows, {});
    expect(protocols).toHaveLength(3);
    expect(without).toEqual([]);
    expect(mergeOligos(protocols)).toHaveLength(6);
  });

  it('restriction sites into pLig-Vector with EcoRI and BamHI: three constructs', async () => {
    const out = await run(
      tut('pLig-Vector'),
      { recipe: 'restriction', forward: 'EcoRI', reverse: 'BamHI' },
      rowsFor('x', '').replace(/^badcell.*\n/m, ''),
    );
    expect(out.problems).toBe(1);
    expect(summary(out.rows)).toEqual([
      'gene_full 3348 clean',
      'gene_head 2946 clean',
      'mini 2766 warnings',
    ]);
  });

  it('homology ends into the linear GB-Vector with In-Fusion: three constructs, and a bad kit failed', async () => {
    const out = await run(
      tut('GB-Vector'),
      { recipe: 'homology', kit: 'in-fusion' },
      rowsFor('kit', 'nokit'),
    );
    expect(out.problems).toBe(1);
    expect(summary(out.rows)).toEqual([
      'gene_full 2208 warnings',
      'gene_head 1806 warnings',
      'mini 1626 warnings',
      'badcell failed',
    ]);
    const bad = out.rows[3];
    expect(bad?.status === 'failed' ? bad.message : '').toBe(
      'The kit “nokit” is not one of “In-Fusion”, “NEBuilder HiFi”, “Yeast assembly”.',
    );
  });

  it('refuses a circular vector for homology ends before any row is designed', async () => {
    const v = validateBatch(parseBatchText(rowsFor('kit', '')), {
      templates,
      defaultTemplate: gene.name,
    });
    const out = await runCloningBatch(
      v.rows,
      destination,
      { recipe: { recipe: 'homology', kit: 'in-fusion' }, templates },
      { client: inline },
    );
    expect(out.rows).toEqual([]);
    expect(out.refused).not.toBeNull();
  });
});
