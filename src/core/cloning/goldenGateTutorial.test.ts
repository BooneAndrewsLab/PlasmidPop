import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  type Enzyme,
  type SeqDocument,
  BUNDLED_ENZYME_SET,
  METHYLATED_HOST,
  UNMETHYLATED_HOST,
  cuttableSites,
  findCutSites,
  getEnzyme,
  setActiveEnzymeSet,
  translate,
} from '@/core';
import { parseGenBank } from '@/io/genbank/parseGenBank';
import { writeGenBank } from '@/io/genbank/writeGenBank';

import { designGoldenGatePart, destinationOverhangs, goldenGate, goldenGateSeed } from './index';

/**
 * Verifies docs/tutorials/cloning/golden-gate.md, Tutorial 1: one gene into
 * an expression vector. Every number the page prints is asserted here
 * through the functions the primer workspace and the Bench use. The NCBI
 * path needs the gitignored fixtures/local/ncbi/NM_000207.gb (third-party
 * data policy) and skips when it is absent.
 */

const DIR = join(__dirname, '../../../docs/tutorials/cloning');
const NCBI_FILE = join(__dirname, '../../../fixtures/local/ncbi/NM_000207.gb');

function load(path: string): SeqDocument {
  const doc = parseGenBank(readFileSync(path, 'utf8')).documents[0];
  if (doc === undefined) throw new Error(`${path} has no record`);
  return doc;
}
const tut = (name: string): SeqDocument => load(join(DIR, `${name}.gb`));

function enz(name: string): Enzyme {
  const e = getEnzyme(name);
  if (e === undefined) throw new Error(`no enzyme ${name}`);
  return e;
}
function sites(doc: SeqDocument, name: string): number {
  const text = doc.sequence.toString();
  const n = (host: typeof METHYLATED_HOST): number =>
    cuttableSites(
      text,
      doc.topology,
      host,
      findCutSites(text, doc.topology, [enz(name)]),
      (x) => getEnzyme(x)?.site.length ?? 0,
    ).length;
  // No site in these files hangs on dam/dcm: both hosts must agree.
  expect(n(UNMETHYLATED_HOST)).toBe(n(METHYLATED_HOST));
  return n(METHYLATED_HOST);
}
const names = (doc: SeqDocument): string[] => [...doc.features].map((f) => f.name);
function cdsOf(doc: SeqDocument): { start: number; end: number; name: string } {
  const cds = [...doc.features].find((f) => f.type === 'CDS');
  const seg = cds?.segments[0];
  if (cds === undefined || seg?.kind !== 'range') throw new Error('no CDS');
  return { start: seg.start, end: seg.end, name: cds.name };
}

beforeAll(() => {
  setActiveEnzymeSet(BUNDLED_ENZYME_SET);
});

describe('golden-gate.md: the two new files', () => {
  it.each(['pGG-Expression', 'GG-gene'])('%s parses, round-trips and says it is synthetic', (f) => {
    const doc = tut(f);
    expect(doc.metadata.description).toMatch(/synthetic/i);
    const again = parseGenBank(writeGenBank(doc)).documents[0];
    expect(again?.sequence.toString()).toBe(doc.sequence.toString());
    expect(again?.topology).toBe(doc.topology);
    expect(names(again ?? doc)).toEqual(names(doc));
  });

  it('pGG-Expression: 2,857 bp circular, two BsaI sites, no BsmBI, asks for AATG…GCTT', () => {
    const v = tut('pGG-Expression');
    expect(v.length).toBe(2857);
    expect(v.topology).toBe('circular');
    expect(names(v)).toEqual([
      'KanR',
      'ori',
      'synthetic promoter',
      'BsaI site',
      'lacZ-dropout',
      'BsaI site',
      'synthetic terminator',
    ]);
    expect(sites(v, 'BsaI')).toBe(2);
    expect(sites(v, 'BsmBI')).toBe(0);
    const asked = destinationOverhangs(v, enz('BsaI'));
    expect(asked).toEqual({ left: 'AATG', right: 'GCTT', backbone: 2536, several: false });
  });

  it('GG-gene: a 702 bp ORF, ATG to stop, no BsaI or BsmBI site and no Golden Gate ends', () => {
    const g = tut('GG-gene');
    expect(g.length).toBe(702);
    expect(g.topology).toBe('linear');
    const c = cdsOf(g);
    expect([c.start, c.end, c.name]).toEqual([0, 702, 'synthGene']);
    const text = g.sequence.toString().toUpperCase();
    expect(text.startsWith('ATGAGC')).toBe(true);
    expect(text.slice(-3)).toBe('TAA');
    expect(translate(text).indexOf('*')).toBe(233);
    expect(sites(g, 'BsaI')).toBe(0);
    expect(sites(g, 'BsmBI')).toBe(0);
  });
});

/** Both paths: the steps of Tutorial 1 on a gene, with the settings the page names. */
function run(gene: SeqDocument, name: string) {
  const dest = tut('pGG-Expression');
  const c = cdsOf(gene);
  const design = designGoldenGatePart(
    {
      insert: { document: gene, range: { start: c.start, end: c.end }, strand: 'forward', name },
      destination: dest,
      otherParts: [],
    },
    // Enzyme BsaI, the pair "From pGG-Expression: AATG…GCTT", start codon and
    // stop codon both included (the stop is off by default: the page says tick it).
    { enzyme: 'BsaI', left: 'AATG', right: 'GCTT', includeStart: true, includeStop: true },
  );
  return { dest, design, sim: design.simulate(), cds: c };
}

describe('golden-gate.md, path A: the synthetic ORF', () => {
  const gene = tut('GG-gene');
  const { dest, design, sim } = run(gene, 'synthGene');

  it('designs one 707 bp part, PCR 733 bp, no warnings', () => {
    expect(design.problem).toBeNull();
    expect(design.left).toBe('AATG');
    expect(design.right).toBe('GCTT');
    expect(design.overlap).toEqual({ left: 3, right: 0 });
    expect(design.trimmed).toEqual({ start: false, stop: false });
    expect(design.part).toHaveLength(707);
    expect(design.productLength).toBe(733);
    expect(design.warnings).toEqual([]);
    expect(design.forward.segments.site).toBe('GGTCTC');
    expect(design.forward.segments.spacer.slice(1)).toBe('AATG');
    expect(design.reverse.segments.spacer.slice(1)).toBe('AAGC');
  });

  it('Simulate opens a 3,239 bp circle with the vector features and the gene, BsaI ticked, no BsaI site', () => {
    expect(sim.problem).toBeNull();
    expect(sim.missing).toBeNull();
    const amplicon = sim.amplicon;
    expect(amplicon?.length).toBe(733);
    expect(amplicon === null ? 0 : sites(amplicon, 'BsaI')).toBe(2);
    const product = sim.product;
    if (product === null) throw new Error('no product');
    expect(product.name).toBe('pGG-Expression-synthGene');
    expect(product.length).toBe(3239);
    expect(product.topology).toBe('circular');
    expect(names(product)).toEqual(
      expect.arrayContaining([
        'KanR',
        'ori',
        'synthetic promoter',
        'synthGene',
        'synthetic terminator',
      ]),
    );
    expect(names(product)).not.toContain('lacZ-dropout');
    expect(sites(product, 'BsaI')).toBe(0);
    expect(sites(dest, 'BsaI')).toBe(2);
    expect(goldenGateSeed('BsaI')).toEqual(['BsaI']);
    // The gene reads straight from the promoter's junction to the terminator's:
    // one frame, 233 residues, one stop, then GCTT.
    const text = product.sequence.toString().toUpperCase().repeat(2);
    const g = gene.sequence.toString().toUpperCase();
    const at = text.indexOf(g);
    expect(at).toBeGreaterThanOrEqual(0);
    expect(text.slice(at + g.length, at + g.length + 4)).toBe('GCTT');
    expect(text.slice(at - 1, at + 3)).toBe('AATG');
  });

  it('the Bench gives the same circle from the amplicon and the vector', () => {
    const amplicon = sim.amplicon;
    if (amplicon === null) throw new Error('no amplicon');
    const r = goldenGate([dest, amplicon], { enzyme: enz('BsaI') });
    expect(r.problem).toBeNull();
    expect(r.assembly?.product.length).toBe(3239);
    expect(r.assembly?.warnings).toEqual([]);
  });
});

describe.skipIf(!existsSync(NCBI_FILE))('golden-gate.md, path B: NM_000207 (insulin)', () => {
  // describe bodies run even when the suite is skipped, so the gitignored
  // record is read in beforeAll, which a skip does not run.
  let rec: SeqDocument;
  let design: ReturnType<typeof run>['design'];
  let sim: ReturnType<typeof run>['sim'];
  let cds: ReturnType<typeof run>['cds'];
  beforeAll(() => {
    rec = load(NCBI_FILE);
    ({ design, sim, cds } = run(rec, 'insulin preproprotein'));
  });

  it('is the record the page describes: a 333 bp CDS with no BsaI or BsmBI site', () => {
    expect(rec.length).toBe(465);
    expect(cds.end - cds.start).toBe(333);
    expect(sites(rec, 'BsaI')).toBe(0);
    expect(sites(rec, 'BsmBI')).toBe(0);
  });

  it('designs one 338 bp part, PCR 364 bp, with the one GC-content caution', () => {
    expect(design.problem).toBeNull();
    expect(design.part).toHaveLength(338);
    expect(design.productLength).toBe(364);
    expect(design.overlap).toEqual({ left: 3, right: 0 });
    expect(design.warnings.map((w) => `${w.severity} ${w.kind}`)).toEqual(['caution annealing']);
    expect(design.warnings[0]?.text).toContain('GC content above 65%');
  });

  it('Simulate opens a 2,870 bp circle, BsaI ticked, no BsaI site, one frame to the stop', () => {
    expect(sim.problem).toBeNull();
    expect(sim.missing).toBeNull();
    expect(sim.amplicon?.length).toBe(364);
    const product = sim.product;
    if (product === null) throw new Error('no product');
    expect(product.name).toBe('pGG-Expression-insulin preproprotein');
    expect(product.length).toBe(2870);
    expect(product.topology).toBe('circular');
    expect(names(product)).toEqual(
      expect.arrayContaining([
        'KanR',
        'ori',
        'synthetic promoter',
        'INS',
        'insulin B chain',
        'synthetic terminator',
      ]),
    );
    expect(names(product)).not.toContain('lacZ-dropout');
    expect(sites(product, 'BsaI')).toBe(0);
    const text = product.sequence.toString().toUpperCase().repeat(2);
    const start = text.indexOf('ATGGCCCTGTGG');
    expect(translate(text.slice(start, start + 333))).toBe(
      'MALWMRLLPLLALLALWGPDPAAAFVNQHLCGSHLVEALYLVCGERGFFYTPKTRREAEDLQVGQVELGGGPGAGSLQPLALEGSLQKRGIVEQCCTSICSLYQLENYCN*',
    );
    expect(text.slice(start - 1, start + 3)).toBe('AATG');
    expect(text.slice(start + 333, start + 337)).toBe('GCTT');
  });
});
