import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  type DigestFragment,
  type SeqDocument,
  BUNDLED_ENZYME_SET,
  METHYLATED_HOST,
  UNMETHYLATED_HOST,
  cuttableSites,
  digest,
  documentFromFragment,
  findCutSites,
  gcPercent,
  getEnzyme,
  reverseComplement,
  setActiveEnzymeSet,
  translate,
} from '@/core';
import { detectFeatures } from '@/core/annotate/detect';
import { featureFromHit } from '@/core/annotate/hits';
import { loadFeatureLibrary } from '@/core/annotate/library';
import { parseGenBank } from '@/io/genbank/parseGenBank';
import { writeGenBank } from '@/io/genbank/writeGenBank';

import { designMultiOverlapPrimers, designOverlapPrimers, yeastAssembly } from './index';

/**
 * Verifies docs/tutorials/yeast-assembly.md: the files it hands out and every
 * number it prints, through the functions the Yeast assembly panel calls.
 */

const DIR = join(__dirname, '../../../docs/tutorials/files');
function tut(name: string): SeqDocument {
  const doc = parseGenBank(readFileSync(join(DIR, `${name}.gb`), 'utf8')).documents[0];
  if (doc === undefined) throw new Error(name);
  return doc;
}
const names = (doc: SeqDocument): string[] => [...doc.features].map((f) => f.name);
const seq = (doc: SeqDocument): string => doc.sequence.toString().toUpperCase();
const kinds = (r: ReturnType<typeof yeastAssembly>): string[] =>
  (r.assembly?.warnings ?? []).map((w) => w.kind);

/** The Cloning tab's EcoRV digest of the vector. */
function cut(vector: SeqDocument): { fragments: DigestFragment[]; opened: SeqDocument } {
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

beforeAll(() => {
  setActiveEnzymeSet(BUNDLED_ENZYME_SET);
});

const FILES = [
  'YA-Vector',
  'YA-Insert1',
  'YA-Insert2',
  'YA-repeat-Insert2',
  'YA-short-Insert2',
  'YA-gene',
];

describe('yeast-assembly.md: the files', () => {
  it.each(FILES)('%s parses, round-trips and says it is synthetic', (f) => {
    const doc = tut(f);
    expect(doc.metadata.description).toMatch(/synthetic/i);
    const again = parseGenBank(writeGenBank(doc)).documents[0];
    expect(again?.sequence.toString()).toBe(doc.sequence.toString());
    expect(again?.topology).toBe(doc.topology);
    expect(names(again ?? doc)).toEqual(names(doc));
  });

  it('are the sizes and topologies the page gives', () => {
    expect(FILES.map((f) => tut(f).length)).toEqual([2217, 240, 460, 460, 445, 450]);
    expect(FILES.map((f) => tut(f).topology)).toEqual([
      'circular',
      'linear',
      'linear',
      'linear',
      'linear',
      'linear',
    ]);
  });

  it('the vector carries a yeast marker, centromere and origin, and the E. coli parts', () => {
    const v = tut('YA-Vector');
    expect([...v.features].map((f) => [f.type, f.name, f.segments[0]?.kind === 'range'])).toEqual([
      ['CDS', 'URA3', true],
      ['centromere', 'CEN6', true],
      ['rep_origin', 'ARSH4', true],
      ['CDS', 'AmpR', true],
      ['rep_origin', 'ori', true],
    ]);
  });

  it('the inserts carry their features once', () => {
    expect(names(tut('YA-Insert1'))).toEqual(['synthetic promoter']);
    for (const f of ['YA-Insert2', 'YA-repeat-Insert2', 'YA-short-Insert2']) {
      expect(names(tut(f))).toEqual(['synthGene', 'synthetic terminator']);
    }
    expect(names(tut('YA-gene'))).toEqual(['synthProt']);
  });

  it('YA-gene is a plain 450 bp ORF, ATG to stop, with no EcoRV site', () => {
    const g = tut('YA-gene');
    expect(seq(g).startsWith('ATG')).toBe(true);
    expect(translate(g.sequence.toString()).indexOf('*')).toBe(149);
    expect(seq(g)).not.toContain('GATATC');
  });
});

describe('yeast-assembly.md: cutting the vector', () => {
  const v = tut('YA-Vector');
  const { fragments, opened } = cut(v);

  it('has one EcoRV site, the same with and without methylation', () => {
    const enzyme = getEnzyme('EcoRV');
    if (enzyme === undefined) throw new Error('no EcoRV');
    const text = v.sequence.toString();
    const n = (host: typeof METHYLATED_HOST): number =>
      cuttableSites(
        text,
        v.topology,
        host,
        findCutSites(text, v.topology, [enzyme]),
        (x) => getEnzyme(x)?.site.length ?? 0,
      ).length;
    expect(n(UNMETHYLATED_HOST)).toBe(1);
    expect(n(METHYLATED_HOST)).toBe(1);
  });

  it('gives one 2,217 bp fragment, blunt at both ends, opening as a linear document', () => {
    expect(fragments).toHaveLength(1);
    expect(fragments[0]?.sequence.length).toBe(2217);
    expect(fragments[0]?.left).toMatchObject({ kind: 'blunt', enzyme: 'EcoRV' });
    expect(fragments[0]?.right).toMatchObject({ kind: 'blunt', enzyme: 'EcoRV' });
    expect(opened.name).toBe('YA-Vector EcoRV fragment');
    expect(opened.topology).toBe('linear');
    expect(opened.length).toBe(2217);
    expect([...opened.features].map((f) => f.name).sort()).toEqual(names(v).slice().sort());
  });

  it('the inserts carry 40 bp of the cut ends and of each other', () => {
    const f = seq(opened);
    const [a, b] = [seq(tut('YA-Insert1')), seq(tut('YA-Insert2'))];
    expect(a.slice(0, 40)).toBe(f.slice(-40));
    expect(a.slice(-40)).toBe(b.slice(0, 40));
    expect(b.slice(-40)).toBe(f.slice(0, 40));
    // The cut: the fragment starts ATC and ends GAT.
    expect(f.slice(0, 3)).toBe('ATC');
    expect(f.slice(-3)).toBe('GAT');
  });

  it('the repeat file repeats that homology at 361 to 400, and the short file has its last 25 bp', () => {
    const h = seq(tut('YA-Insert2')).slice(0, 40);
    const rep = seq(tut('YA-repeat-Insert2'));
    expect(rep.slice(360, 400)).toBe(h);
    expect(rep.slice(0, 360) + rep.slice(400)).toBe(
      seq(tut('YA-Insert2')).slice(0, 360) + seq(tut('YA-Insert2')).slice(400),
    );
    expect(seq(tut('YA-short-Insert2'))).toBe(seq(tut('YA-Insert2')).slice(15));
  });
});

describe('yeast-assembly.md: exercise 1, the clean assembly', () => {
  const frag = cut(tut('YA-Vector')).opened;
  // The page opens insert 2 before insert 1: the tab order is not the circle's.
  const result = yeastAssembly([frag, tut('YA-Insert2'), tut('YA-Insert1')], { vector: frag });
  const assembly = result.assembly;
  if (assembly === null) throw new Error('no assembly');
  const product = assembly.product;

  it('finds the order from the homology, with the vector marked', () => {
    expect(result.problem).toBeNull();
    expect(result.dropped).toEqual([]);
    expect(assembly.order.map((p) => p.document.name)).toEqual([
      'YA-Vector EcoRV fragment',
      'YA-Insert1',
      'YA-Insert2',
    ]);
    expect(assembly.vectorIndex).toBe(0);
  });

  it('reports 40 bp junctions at 50, 55 and 53% GC, no warnings', () => {
    expect(assembly.joins.map((j) => j.length)).toEqual([40, 40, 40]);
    expect(assembly.joins.map((j) => gcPercent(j.overlap))).toEqual([50, 55, 52.5]);
    expect(assembly.joins.map((j) => gcPercent(j.overlap).toFixed(0))).toEqual(['50', '55', '53']);
    expect(assembly.warnings).toEqual([]);
  });

  it('makes a 2,797 bp circle: 2,217 + 240 + 460 less the 120 bp shared', () => {
    expect(product.name).toBe('YA-Vector EcoRV fragment+YA-Insert1+YA-Insert2 assembly');
    expect(product.length).toBe(2797);
    expect(product.length).toBe(2217 + 240 + 460 - 120);
    expect(product.topology).toBe('circular');
  });

  it('carries every feature once and marks the three junctions', () => {
    expect(names(product)).toEqual([
      'URA3',
      'CEN6',
      'ARSH4',
      'AmpR',
      'ori',
      'synthetic promoter',
      'synthGene',
      'synthetic terminator',
      'homology 1',
      'homology 2',
      'homology 3',
    ]);
    expect(assembly.junctions.map((j) => [j.name, j.start + 1, j.end])).toEqual([
      ['homology 1', 2178, 2217],
      ['homology 2', 2378, 2417],
      ['homology 3', 1, 40],
    ]);
    const text = seq(product) + seq(product).slice(0, 39);
    for (const j of assembly.junctions) {
      const shared = text.slice(j.start, j.end);
      expect(text.split(shared).length - 1).toBe(1);
    }
  });
});

describe('yeast-assembly.md: exercise 2, the homology that occurs twice', () => {
  const frag = cut(tut('YA-Vector')).opened;
  const r = yeastAssembly([frag, tut('YA-Insert1'), tut('YA-repeat-Insert2')], { vector: frag });

  it('still assembles the same 2,797 bp circle, with the one repeat warning', () => {
    expect(r.assembly?.product.length).toBe(2797);
    expect(r.assembly?.joins.map((j) => j.length)).toEqual([40, 40, 40]);
    expect(kinds(r)).toEqual(['repeat']);
    expect(r.assembly?.warnings[0]?.text).toBe(
      'The homology joining YA-Insert1 to YA-repeat-Insert2 also occurs in YA-repeat-Insert2 at 361, where the cell could recombine instead and give a different construct.',
    );
  });
});

describe('yeast-assembly.md: exercise 3, the homology that is too short', () => {
  const frag = cut(tut('YA-Vector')).opened;
  const tube = [frag, tut('YA-short-Insert2'), tut('YA-Insert1')];

  it('at 40 bp nothing follows insert 1', () => {
    const r = yeastAssembly(tube, { vector: frag });
    expect(r.assembly).toBeNull();
    expect(r.problem).toBe(
      'Nothing follows YA-Insert1: no other part starts with its last 40 bases or more. 1 of 3 parts were never reached.',
    );
  });

  it('at 25 bp it joins, with a 25 bp junction and the short-overlap warning', () => {
    const r = yeastAssembly(tube, { vector: frag, minOverlap: 25 });
    expect(r.assembly?.product.length).toBe(2797);
    expect(r.assembly?.joins.map((j) => j.length)).toEqual([40, 25, 40]);
    expect(Number(gcPercent(r.assembly?.joins[1]?.overlap ?? '').toFixed(0))).toBe(56);
    expect(kinds(r)).toEqual(['short-overlap']);
    expect(r.assembly?.warnings[0]?.text).toBe(
      'Recombination falls off sharply below 30 bp of homology: homology 2 (YA-Insert1 to YA-short-Insert2), 25 bp.',
    );
  });
});

describe('yeast-assembly.md: exercise 4, no vector, a linear product', () => {
  const inserts = [tut('YA-Insert2'), tut('YA-Insert1')];

  it('as a circle nothing closes it', () => {
    const r = yeastAssembly(inserts);
    expect(r.assembly).toBeNull();
    expect(r.problem).toBe(
      'Nothing follows YA-Insert2: no other part starts with its last 40 bases or more. 1 of 2 parts were never reached.',
    );
  });

  it('as a linear molecule it is 660 bp, with the three warnings', () => {
    const r = yeastAssembly(inserts, { circular: false });
    const a = r.assembly;
    expect(a?.product.length).toBe(660);
    expect(a?.product.topology).toBe('linear');
    expect(a?.vectorIndex).toBeNull();
    expect(names(a?.product ?? inserts[0] ?? tut('YA-Insert1'))).toEqual([
      'synthetic promoter',
      'synthGene',
      'synthetic terminator',
      'homology 1',
    ]);
    expect(kinds(r)).toEqual(['linear-product', 'no-marker', 'no-origin']);
    expect(a?.warnings.map((w) => w.text)).toEqual([
      'The product is linear. A linear molecule with no telomere is lost from yeast; assemble it as a circle.',
      'No yeast selectable marker (URA3, LEU2, HIS3, TRP1, MET15, LYS2, ADE2, KanMX) is annotated on the product, so nothing selects the assembly.',
      'No ARS, CEN or 2-micron feature is annotated on the product, so it will not replicate in yeast.',
    ]);
  });
});

describe('yeast-assembly.md: exercise 5, tails for a plain gene', () => {
  const frag = cut(tut('YA-Vector')).opened;
  const d = designOverlapPrimers(frag, tut('YA-gene'), { start: 0, end: 450 }, 'yeast');

  it('puts the vector end 40 bases on each primer', () => {
    expect(d.problem).toBeNull();
    const f = seq(frag);
    expect(d.forward.tail).toBe(f.slice(-40));
    expect(d.reverse.tail).toBe(reverseComplement(f.slice(0, 40)));
    expect(d.forward.tail.endsWith('GAT')).toBe(true);
    expect(d.reverse.tail.endsWith('GAT')).toBe(true);
  });

  it('the two primers are the ones the page prints', () => {
    expect(
      [d.forward, d.reverse].map((p) => [
        p.sequence.length,
        p.tail.length,
        p.annealLength,
        p.tm.toFixed(0),
      ]),
    ).toEqual([
      [69, 40, 29, '60'],
      [64, 40, 24, '60'],
    ]);
    expect(d.forward.sequence).toBe(
      'TGAAGCATTCGCCTGCCTCTCTAACTGTTGCTAGACCGATatgagcttcgatgtgtatacctacttcgg',
    );
    expect(d.reverse.sequence).toBe(
      'TGGACTTCCACAGGGCTCTCGACGGAATAAGAGAACCGATttagttcttcgcagcccttgttcc',
    );
  });

  it('makes a 2,667 bp circle with the one note', () => {
    expect(d.product?.length).toBe(2667);
    expect(d.product?.length).toBe(2217 + 450);
    expect(d.product?.topology).toBe('circular');
    expect(d.warnings).toEqual([
      'Yeast assembly asks for 40 bases of homology, which both tails carry.',
    ]);
  });
});

const NCBI_DIR = join(__dirname, '../../../fixtures/local/ncbi');
const ncbiFile = (accession: string): string => join(NCBI_DIR, `${accession}.gb`);
const NCBI_FILES = ['NM_000207', 'NM_001183340', 'U03450', 'U03451'].map(ncbiFile);
const ncbi = (accession: string): SeqDocument => {
  const doc = parseGenBank(readFileSync(ncbiFile(accession), 'utf8')).documents[0];
  if (doc === undefined) throw new Error(accession);
  return doc;
};
/** The Insert box's CDS, as the designer takes it. */
function cdsOf(doc: SeqDocument): { start: number; end: number } {
  const seg = [...doc.features].find((f) => f.type === 'CDS')?.segments[0];
  if (seg?.kind !== 'range') throw new Error('no CDS');
  return { start: seg.start, end: seg.end };
}
/** The Cloning tab's SmaI digest and Open (a blunt, single cut in both vectors). */
function smaI(vector: SeqDocument): SeqDocument {
  const enzyme = getEnzyme('SmaI');
  if (enzyme === undefined) throw new Error('no SmaI');
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
  expect(fragments).toHaveLength(1);
  const only = fragments[0];
  if (only === undefined) throw new Error('no fragment');
  return documentFromFragment(only);
}
/** The Features tab's Detect features with every hit ticked, then Add. */
async function detected(doc: SeqDocument): Promise<SeqDocument> {
  const library = await loadFeatureLibrary();
  return doc.addFeatures(
    detectFeatures(doc.sequence.toString(), doc.topology, library).map((hit) => {
      const part = library.parts[hit.part];
      if (part === undefined) throw new Error('no part');
      return featureFromHit(hit, part);
    }),
  );
}
const NOTE = 'Yeast assembly asks for 40 bases of homology, which both tails carry.';
const NO_MARKER =
  'No yeast selectable marker (URA3, LEU2, HIS3, TRP1, MET15, LYS2, ADE2, KanMX) is annotated on the product, so nothing selects the assembly.';
const NO_ORIGIN =
  'No ARS, CEN or 2-micron feature is annotated on the product, so it will not replicate in yeast.';
const SMA_END = 'CTCGAGGTCGACGGTATCGATAAGCTTGATATCGAATTCCTGCAGCCC';

/** Primers, the amplicon and the circle of one design, in the numbers the page prints. */
function summary(d: ReturnType<typeof designOverlapPrimers>, vector: SeqDocument) {
  const r = yeastAssembly([vector, d.amplicon ?? vector], { vector });
  return {
    primers: [d.forward, d.reverse].map((p) => [
      p.sequence.length,
      p.tail.length,
      p.annealLength,
      p.tm.toFixed(0),
    ]),
    amplicon: d.amplicon?.length,
    product: d.product?.length,
    topology: d.product?.topology,
    name: d.product?.name,
    junctions: r.assembly?.junctions.map((j) => [j.name, j.start + 1, j.end]),
    gc: r.assembly?.joins.map((j) => Number(gcPercent(j.overlap).toFixed(0))),
    warnings: d.warnings,
  };
}

describe.skipIf(!NCBI_FILES.every((f) => existsSync(f)))(
  'yeast-assembly.md: exercises 6 to 8, records fetched from NCBI',
  () => {
    // The gitignored records are read in beforeAll, which a skip does not run.
    let insulin: SeqDocument;
    let adh1: SeqDocument;
    let prs416: SeqDocument;
    let prs426: SeqDocument;
    beforeAll(() => {
      insulin = ncbi('NM_000207');
      adh1 = ncbi('NM_001183340');
      prs416 = ncbi('U03450');
      prs426 = ncbi('U03451');
    });

    it('are the records the page describes', () => {
      expect([insulin.length, insulin.topology]).toEqual([465, 'linear']);
      expect(cdsOf(insulin)).toEqual({ start: 59, end: 392 });
      expect([adh1.length, adh1.topology]).toEqual([1047, 'linear']);
      expect(cdsOf(adh1)).toEqual({ start: 0, end: 1047 });
      expect(translate(seq(adh1)).slice(0, 10)).toBe('MSIPETQKGV');
      expect([prs416.length, prs416.topology, prs416.name]).toEqual([4898, 'circular', 'PRS416']);
      expect([prs426.length, prs426.topology, prs426.name]).toEqual([5726, 'circular', 'PRS426']);
      // Neither vector is annotated beyond its source feature.
      expect([...prs416.features].map((f) => f.type)).toEqual(['source']);
      expect([...prs426.features].map((f) => f.type)).toEqual(['source']);
    });

    it('exercise 6: insulin into the tutorial vector, 2,550 bp, no warning but the note', () => {
      const vector = cut(tut('YA-Vector')).opened;
      const d = designOverlapPrimers(vector, insulin, cdsOf(insulin), 'yeast');
      expect(d.problem).toBeNull();
      expect(d.forward.tail).toBe(seq(vector).slice(-40));
      expect(d.reverse.tail).toBe(reverseComplement(seq(vector).slice(0, 40)));
      expect(summary(d, vector)).toEqual({
        primers: [
          [58, 40, 18, '61'],
          [66, 40, 26, '61'],
        ],
        amplicon: 413,
        product: 2550,
        topology: 'circular',
        name: 'YA-Vector EcoRV fragment+NM_000207 PCR product assembly',
        junctions: [
          ['homology 1', 2178, 2217],
          ['homology 2', 1, 40],
        ],
        gc: [50, 53],
        warnings: [NOTE],
      });
      expect(d.forward.sequence).toBe('TGAAGCATTCGCCTGCCTCTCTAACTGTTGCTAGACCGATatggccctgtggatgcgc');
      expect(d.reverse.sequence).toBe(
        'TGGACTTCCACAGGGCTCTCGACGGAATAAGAGAACCGATctagttgcagtagttctccagctggt',
      );
      expect(2217 + 333).toBe(2550);
      expect(names(d.product ?? vector)).toEqual(
        expect.arrayContaining([
          'URA3',
          'CEN6',
          'ARSH4',
          'INS',
          'insulin preproprotein',
          'proinsulin',
          'insulin B chain',
          'C-peptide',
          'insulin A chain',
        ]),
      );
    });

    it('SmaI cuts each pRS vector once, blunt, in the polylinker', () => {
      for (const v of [prs416, prs426]) {
        const frag = smaI(v);
        expect(frag.length).toBe(v.length);
        expect(frag.topology).toBe('linear');
        expect(seq(frag).slice(0, 3)).toBe('GGG');
        expect(seq(frag).slice(-3)).toBe('CCC');
        expect(seq(frag).slice(-SMA_END.length)).toBe(SMA_END);
      }
    });

    it('exercise 7: ADH1 into pRS416, bare: 5,945 bp, and the two warnings of an unannotated vector', () => {
      const vector = smaI(prs416);
      const d = designOverlapPrimers(vector, adh1, cdsOf(adh1), 'yeast');
      expect(d.problem).toBeNull();
      expect(summary(d, vector)).toEqual({
        primers: [
          [70, 40, 30, '59'],
          [70, 40, 30, '56'],
        ],
        amplicon: 1127,
        product: 5945,
        topology: 'circular',
        name: 'PRS416 SmaI fragment+NM_001183340 PCR product assembly',
        junctions: [
          ['homology 1', 4859, 4898],
          ['homology 2', 1, 40],
        ],
        gc: [50, 70],
        warnings: [NOTE, NO_MARKER, NO_ORIGIN],
      });
      expect(4898 + 1047).toBe(5945);
      expect(d.forward.sequence).toBe(
        'CGACGGTATCGATAAGCTTGATATCGAATTCCTGCAGCCCatgtctatcccagaaactcaaaaaggtgtt',
      );
      expect(d.reverse.sequence).toBe(
        'CCACCGCGGTGGCGGCCGCTCTAGAACTAGTGGATCCCCCttatttagaagtgtcaacaacgtatctacc',
      );
    });

    it('exercise 7: after Detect features the vector carries URA3, CEN6 and ARSH4, and only the note is left', async () => {
      const vector = smaI(await detected(prs416));
      const have = names(vector);
      expect(have).toEqual(expect.arrayContaining(['URA3', 'CEN6', 'ARSH4', 'AmpR', 'pBR322 ori']));
      const d = designOverlapPrimers(vector, adh1, cdsOf(adh1), 'yeast');
      expect(d.product?.length).toBe(5945);
      expect(d.warnings).toEqual([NOTE]);
      expect(names(d.product ?? vector)).toEqual(
        expect.arrayContaining(['URA3', 'CEN6', 'ARSH4', 'ADH1', 'alcohol dehydrogenase ADH1']),
      );
    });

    it('exercise 8: pRS426 has a real 81 bp direct repeat in its 2-micron piece', async () => {
      const bare = smaI(prs426);
      const d0 = designOverlapPrimers(bare, adh1, cdsOf(adh1), 'yeast');
      expect(d0.product?.length).toBe(6773);
      expect(d0.warnings).toEqual([
        NOTE,
        '81 bp at 2,278 in PRS426 SmaI fragment is repeated at 2,403 in PRS426 SmaI fragment. Direct repeats recombine in yeast and can delete what lies between them.',
        NO_MARKER,
        NO_ORIGIN,
      ]);
      const vector = smaI(await detected(prs426));
      expect(names(vector)).toEqual(
        expect.arrayContaining(['URA3', '2-micron inverted repeat', 'FRT']),
      );
      expect(names(vector)).not.toContain('CEN6');
      const d = designOverlapPrimers(vector, adh1, cdsOf(adh1), 'yeast');
      expect(summary(d, vector)).toEqual({
        primers: [
          [70, 40, 30, '59'],
          [70, 40, 30, '56'],
        ],
        amplicon: 1127,
        product: 6773,
        topology: 'circular',
        name: 'PRS426 SmaI fragment+NM_001183340 PCR product assembly',
        junctions: [
          ['homology 1', 5687, 5726],
          ['homology 2', 1, 40],
        ],
        gc: [50, 70],
        warnings: [d.warnings[0], d.warnings[1]],
      });
      expect(d.warnings[0]).toBe(NOTE);
      expect(d.warnings[1]).toMatch(/^81 bp at 2,278 in PRS426 SmaI fragment is repeated at 2,403/);
      expect(6773 - 1047).toBe(5726);
    });
  },
);

const PART_FILES = ['U03450', 'U50963']
  .map(ncbiFile)
  .concat(['ADH1-window', 'CYC1-window'].map((n) => join(NCBI_DIR, `${n}.gb`)));

describe.skipIf(!PART_FILES.every((f) => existsSync(f)))(
  'yeast-assembly.md: exercise 9, a promoter, a reporter and a terminator in pRS416',
  () => {
    let vector: SeqDocument;
    let parts: { template: SeqDocument; region: { start: number; end: number } }[];
    beforeAll(() => {
      const read = (path: string): SeqDocument => {
        const doc = parseGenBank(readFileSync(path, 'utf8')).documents[0];
        if (doc === undefined) throw new Error(path);
        return doc;
      };
      vector = smaI(read(ncbiFile('U03450')));
      parts = [
        { template: read(join(NCBI_DIR, 'ADH1-window.gb')), region: { start: 300, end: 1000 } },
        { template: read(ncbiFile('U50963')), region: { start: 0, end: 717 } },
        { template: read(join(NCBI_DIR, 'CYC1-window.gb')), region: { start: 1330, end: 1530 } },
      ];
    });

    it('closes in the order asked, 6,515 bp, with 40 bp of homology at each of four junctions', () => {
      const d = designMultiOverlapPrimers(vector, parts, 'yeast');
      expect(d.problem).toBeNull();
      expect(d.inserts.map((i) => i.amplicon?.length)).toEqual([760, 757, 260]);
      expect(d.inserts.map((i) => [i.forward, i.reverse].map((p) => p.sequence))).toEqual([
        [
          'CGACGGTATCGATAAGCTTGATATCGAATTCCTGCAGCCCgggtgtacaatatggacttcctcttttctg',
          'AGTTCCTCGCCCTTGCTCATtgtatatgagatagttgattgtatgcttgg',
        ],
        [
          'AATCAACTATCTCATATACAatgagcaagggcgaggaactgt',
          'ACAAAGGAAAAGGGGCCTGTtcacttgtacagctcgtccatgcc',
        ],
        [
          'TGGACGAGCTGTACAAGTGAacaggccccttttcctttgtcg',
          'CCACCGCGGTGGCGGCCGCTCTAGAACTAGTGGATCCCCCtttgtacagaaaaaaaagaaaaatttgaaa',
        ],
      ]);
      expect(d.inserts.map((i) => [i.forward.tail.length, i.reverse.tail.length])).toEqual([
        [40, 20],
        [20, 20],
        [20, 40],
      ]);
      expect(d.product?.length).toBe(4898 + 700 + 717 + 200);
      expect(d.product?.topology).toBe('circular');
      expect(d.product?.name).toBe(
        'PRS416 SmaI fragment+NC_001147 PCR product+XXU50963 PCR product+NC_001142 PCR product 1 assembly',
      );
      expect(d.warnings).toEqual([
        'Yeast assembly asks for 40 bases of homology at each of the 4 junctions. The two primers at an internal junction carry half each.',
        NO_MARKER,
        NO_ORIGIN,
      ]);
    });
  },
);
