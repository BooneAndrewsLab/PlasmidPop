import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  type DigestFragment,
  type SeqDocument,
  BUNDLED_ENZYME_SET,
  METHYLATED_HOST,
  UNMETHYLATED_HOST,
  cuttableSites,
  defaultFragmentName,
  digest,
  documentFromFragment,
  findCutSites,
  getEnzyme,
  recordOverlapDesign,
  setActiveEnzymeSet,
  translate,
} from '@/core';
import { parseGenBank } from '@/io/genbank/parseGenBank';
import { writeGenBank } from '@/io/genbank/writeGenBank';

import { type OverlapKit, designOverlapPrimers } from './index';

/**
 * Verifies docs/tutorials/in-fusion.md: both paths, through the functions the
 * Cloning tab's digest and the Gibson panel's "Design insert primers" use.
 * The NCBI path needs the gitignored fixtures/local/ncbi/NM_000207.gb and
 * skips when it is absent.
 */

const DIR = join(__dirname, '../../../docs/tutorials/files');
const NCBI_FILE = join(__dirname, '../../../fixtures/local/ncbi/NM_000207.gb');

function load(path: string): SeqDocument {
  const doc = parseGenBank(readFileSync(path, 'utf8')).documents[0];
  if (doc === undefined) throw new Error(path);
  return doc;
}
const tut = (name: string): SeqDocument => load(join(DIR, `${name}.gb`));
const names = (doc: SeqDocument): string[] => [...doc.features].map((f) => f.name);

function sites(doc: SeqDocument, name: string): number {
  const enzyme = getEnzyme(name);
  if (enzyme === undefined) throw new Error(name);
  const text = doc.sequence.toString();
  const n = (host: typeof METHYLATED_HOST): number =>
    cuttableSites(
      text,
      doc.topology,
      host,
      findCutSites(text, doc.topology, [enzyme]),
      (x) => getEnzyme(x)?.site.length ?? 0,
    ).length;
  expect(n(UNMETHYLATED_HOST)).toBe(n(METHYLATED_HOST));
  return n(METHYLATED_HOST);
}

/** The Cloning tab's digest of the vector with EcoRV ticked, and its Open. */
function linearised(vector: SeqDocument): { fragments: DigestFragment[]; opened: SeqDocument } {
  const enzyme = getEnzyme('EcoRV');
  if (enzyme === undefined) throw new Error('no EcoRV');
  const text = vector.sequence.toString();
  const fragments = digest(
    vector,
    cuttableSites(
      text,
      vector.topology,
      vector.methylation,
      findCutSites(text, vector.topology, [enzyme]),
      (x) => getEnzyme(x)?.site.length ?? 0,
    ),
  );
  const only = fragments[0];
  if (only === undefined) throw new Error('no fragment');
  return { fragments, opened: documentFromFragment(only) };
}

function cdsRange(doc: SeqDocument): { start: number; end: number } {
  const seg = [...doc.features].find((f) => f.type === 'CDS')?.segments[0];
  if (seg?.kind !== 'range') throw new Error('no CDS');
  return { start: seg.start, end: seg.end };
}

beforeAll(() => {
  setActiveEnzymeSet(BUNDLED_ENZYME_SET);
});

describe('in-fusion.md: the files', () => {
  it.each(['pIF-Vector', 'IF-gene'])('%s parses, round-trips and says it is synthetic', (f) => {
    const doc = tut(f);
    expect(doc.metadata.description).toMatch(/synthetic/i);
    const again = parseGenBank(writeGenBank(doc)).documents[0];
    expect(again?.sequence.toString()).toBe(doc.sequence.toString());
    expect(again?.topology).toBe(doc.topology);
    expect(names(again ?? doc)).toEqual(names(doc));
  });

  it('pIF-Vector: 1,446 bp circular, one EcoRV site, between promoter and terminator', () => {
    const v = tut('pIF-Vector');
    expect(v.length).toBe(1446);
    expect(v.topology).toBe('circular');
    expect(names(v)).toEqual(['KanR', 'ori', 'synthetic promoter', 'synthetic terminator']);
    expect(sites(v, 'EcoRV')).toBe(1);
    const text = v.sequence.toString().toUpperCase();
    const at = text.indexOf('GATATC');
    const promoter = [...v.features].find((f) => f.name === 'synthetic promoter')?.segments[0];
    const terminator = [...v.features].find((f) => f.name === 'synthetic terminator')?.segments[0];
    if (promoter?.kind !== 'range' || terminator?.kind !== 'range') throw new Error('features');
    expect(promoter.end).toBeLessThan(at);
    expect(terminator.start).toBeGreaterThan(at + 6);
  });

  it('IF-gene: 603 bp, ATG to stop, 200 residues, no EcoRV site', () => {
    const g = tut('IF-gene');
    expect(g.length).toBe(603);
    expect(g.topology).toBe('linear');
    expect(cdsRange(g)).toEqual({ start: 0, end: 603 });
    expect(translate(g.sequence.toString()).indexOf('*')).toBe(200);
    expect(sites(g, 'EcoRV')).toBe(0);
  });
});

describe('in-fusion.md: linearising the vector', () => {
  const { fragments, opened } = linearised(tut('pIF-Vector'));

  it('EcoRV gives one 1,446 bp fragment, blunt at both ends', () => {
    expect(fragments).toHaveLength(1);
    expect(fragments[0]?.sequence.length).toBe(1446);
    expect(fragments[0]?.left).toMatchObject({ kind: 'blunt', enzyme: 'EcoRV' });
    expect(fragments[0]?.right).toMatchObject({ kind: 'blunt', enzyme: 'EcoRV' });
    const [first] = fragments;
    if (first === undefined) throw new Error('no fragment');
    expect(defaultFragmentName(first)).toBe('pIF-Vector EcoRV fragment');
  });

  it('opens as a linear document with the vector features whole', () => {
    expect(opened.name).toBe('pIF-Vector EcoRV fragment');
    expect(opened.topology).toBe('linear');
    expect(names(opened)).toEqual(names(tut('pIF-Vector')));
  });
});

/** Both kits, the settings the page names; `Open product` is recordOverlapDesign. */
function run(gene: SeqDocument, kit: OverlapKit) {
  const vector = linearised(tut('pIF-Vector')).opened;
  const design = designOverlapPrimers(vector, gene, cdsRange(gene), kit);
  const product = recordOverlapDesign(design, vector, gene, kit);
  if (product === null) throw new Error('no product');
  return { design, product };
}

describe('in-fusion.md, path A: the synthetic ORF', () => {
  const gene = tut('IF-gene');
  const inf = run(gene, 'in-fusion');
  const neb = run(gene, 'nebuilder');

  it('In-Fusion: 37 nt and 40 nt primers at 60 °C, amplicon 633 bp, product 2,049 bp', () => {
    const d = inf.design;
    expect(d.problem).toBeNull();
    expect(d.forward.sequence).toBe('ATGACAGCGGCTGATatgtgtagcgagcgtatgcgtt');
    expect(d.forward.sequence).toHaveLength(37);
    expect(d.forward.tail).toHaveLength(15);
    expect(d.forward.annealLength).toBe(22);
    expect(d.reverse.sequence).toBe('GGGCCCCTTGCGGATttatggctgccaactgtatacgcac');
    expect(d.reverse.sequence).toHaveLength(40);
    expect(d.reverse.annealLength).toBe(25);
    expect([d.forward.tm, d.reverse.tm].map((t) => t.toFixed(0))).toEqual(['60', '60']);
    expect(d.amplicon?.length).toBe(633);
    expect(d.product?.length).toBe(2049);
    expect(d.warnings).toEqual([
      "pIF-Vector EcoRV fragment has sticky ends; the tails match its top strand, and the kit's exonuclease chews them back either way, but check the ends are where you meant to cut.",
      'In-Fusion asks for 15 bases of homology, which both tails carry.',
    ]);
  });

  it('the tails are the vector fragment ends: its last 15 bases, and the reverse complement of its first 15', () => {
    const v = linearised(tut('pIF-Vector')).opened.sequence.toString().toUpperCase();
    expect(inf.design.forward.tail).toBe(v.slice(-15));
    expect(inf.design.forward.tail.endsWith('GAT')).toBe(true);
    expect(v.startsWith('ATC')).toBe(true);
    expect(inf.design.reverse.tail.startsWith('GGGCCCC')).toBe(true);
    expect(inf.design.reverse.tail.endsWith('GAT')).toBe(true);
  });

  it('NEBuilder HiFi: the same annealing parts with 20 base tails, amplicon 643 bp, same product', () => {
    const d = neb.design;
    expect(d.forward.sequence).toHaveLength(42);
    expect(d.reverse.sequence).toHaveLength(45);
    expect(d.forward.tail).toHaveLength(20);
    expect(d.forward.annealLength).toBe(22);
    expect(d.reverse.annealLength).toBe(25);
    expect(d.amplicon?.length).toBe(643);
    expect(d.product?.length).toBe(2049);
    expect(d.warnings[1]).toBe(
      'NEBuilder HiFi asks for 20 bases of homology, which both tails carry.',
    );
  });

  it('Open product: 2,049 bp circle, vector features and synthProt, EcoRV site gone, one frame', () => {
    const p = inf.product;
    expect(p.name).toBe('pIF-Vector EcoRV fragment+IF-gene PCR product assembly');
    expect(p.length).toBe(2049);
    expect(p.length).toBe(1446 + 603);
    expect(p.topology).toBe('circular');
    expect(names(p)).toEqual([
      'KanR',
      'ori',
      'synthetic promoter',
      'synthetic terminator',
      'synthProt',
      'Forward',
      'Reverse',
    ]);
    expect(sites(p, 'EcoRV')).toBe(0);
    const text = p.sequence.toString().toUpperCase().repeat(2);
    const g = tut('IF-gene').sequence.toString().toUpperCase();
    const at = text.indexOf(g);
    expect(at).toBe(1446);
    expect(text.slice(at - 3, at + 3)).toBe('GATATG');
    expect(text.slice(at + g.length, at + g.length + 3)).toBe('ATC');
  });
});

describe.skipIf(!existsSync(NCBI_FILE))('in-fusion.md, path B: NM_000207 (insulin)', () => {
  // The gitignored record is read in beforeAll, which a skip does not run.
  let rec: SeqDocument;
  let inf: ReturnType<typeof run>;
  let neb: ReturnType<typeof run>;
  beforeAll(() => {
    rec = load(NCBI_FILE);
    inf = run(rec, 'in-fusion');
    neb = run(rec, 'nebuilder');
  });

  it('is the record the page describes: a 333 bp CDS and no EcoRV site', () => {
    expect(rec.length).toBe(465);
    const c = cdsRange(rec);
    expect(c.end - c.start).toBe(333);
    expect(sites(rec, 'EcoRV')).toBe(0);
  });

  it('In-Fusion: 33 nt and 41 nt primers, amplicon 363 bp, product 1,779 bp', () => {
    const d = inf.design;
    expect(d.problem).toBeNull();
    expect([d.forward.sequence.length, d.forward.annealLength]).toEqual([33, 18]);
    expect([d.reverse.sequence.length, d.reverse.annealLength]).toEqual([41, 26]);
    expect([d.forward.tm, d.reverse.tm].map((t) => t.toFixed(0))).toEqual(['61', '61']);
    expect(d.amplicon?.length).toBe(363);
    expect(d.product?.length).toBe(1779);
    expect(d.warnings).toHaveLength(2);
  });

  it('NEBuilder HiFi: amplicon 373 bp, same 1,779 bp product', () => {
    expect(neb.design.amplicon?.length).toBe(373);
    expect(neb.design.product?.length).toBe(1779);
  });

  it('Open product: 1,779 bp circle with the insulin features, one frame to the stop', () => {
    const p = inf.product;
    expect(p.name).toBe('pIF-Vector EcoRV fragment+NM_000207 PCR product assembly');
    expect(p.length).toBe(1779);
    expect(p.topology).toBe('circular');
    expect(names(p)).toEqual(
      expect.arrayContaining([
        'KanR',
        'ori',
        'synthetic promoter',
        'synthetic terminator',
        'INS',
        'insulin preproprotein',
        'insulin B chain',
      ]),
    );
    expect(sites(p, 'EcoRV')).toBe(0);
    const text = p.sequence.toString().toUpperCase().repeat(2);
    const start = text.indexOf('ATGGCCCTGTGG');
    expect(start).toBe(1446);
    expect(text.slice(start - 3, start + 3)).toBe('GATATG');
    expect(translate(text.slice(start, start + 333))).toBe(
      'MALWMRLLPLLALLALWGPDPAAAFVNQHLCGSHLVEALYLVCGERGFFYTPKTRREAEDLQVGQVELGGGPGAGSLQPLALEGSLQKRGIVEQCCTSICSLYQLENYCN*',
    );
  });
});
