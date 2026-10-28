import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  type CutSite,
  type DigestFragment,
  type DigestProfile,
  type Enzyme,
  type GelOptions,
  BUNDLED_ENZYME_SET,
  DEFAULT_GEL,
  METHYLATED_HOST,
  SeqDocument,
  UNMETHYLATED_HOST,
  activeEnzymes,
  compareCheck,
  compareDiagnostic,
  cuttableSites,
  describeBands,
  describeEnd,
  digest,
  emptyVector,
  enzymeProfile,
  findCutSites,
  gelProfile,
  getEnzyme,
  reverseComplement,
  setActiveEnzymeSet,
  translate,
} from '@/core';
import { parseGenBank } from '@/io/genbank/parseGenBank';
import { writeGenBank } from '@/io/genbank/writeGenBank';

import {
  assemblyJunctions,
  designCloningEnds,
  documentFromFragment,
  flipFragment,
  goldenGate,
  ligate,
  pcr,
  resolveVectorRegion,
  cloningSeed,
  goldenGateSeed,
  ligationSeed,
  resolveSeed,
  scanForCloningNow,
  suggestEnzymePairs,
} from './index';

/**
 * Verifies docs/tutorials/cloning/README.md: every file the tutorial hands
 * out and every number it promises, through the functions the Bench uses.
 * The NCBI half needs a copy of the record in fixtures/local/ncbi (gitignored,
 * third-party data policy) and skips when it is absent.
 */

const DIR = join(__dirname, '../../../docs/tutorials/cloning');
const NCBI_FILE = join(__dirname, '../../../fixtures/local/ncbi/NM_000207.gb');

function load(path: string): SeqDocument {
  const text = readFileSync(path, 'utf8');
  const result = parseGenBank(text);
  const doc = result.documents[0];
  if (doc === undefined) throw new Error(`${path} has no record`);
  return doc;
}
const tut = (name: string): SeqDocument => load(join(DIR, `${name}.gb`));

function def<T>(value: T | null | undefined): T {
  if (value === undefined || value === null) throw new Error('expected a value');
  return value;
}

function enz(name: string): Enzyme {
  const e = getEnzyme(name);
  if (e === undefined) throw new Error(`no enzyme ${name}`);
  return e;
}

/** The Cloning tab's digest: the ticked enzymes, less what the document's own host blocks. */
function sitesOf(doc: SeqDocument, enzymes: readonly Enzyme[]): CutSite[] {
  const text = doc.sequence.toString();
  return cuttableSites(
    text,
    doc.topology,
    doc.methylation,
    findCutSites(text, doc.topology, enzymes),
    (n) => getEnzyme(n)?.site.length ?? 0,
  );
}
function cut(doc: SeqDocument, names: string[]): DigestFragment[] {
  return digest(doc, sitesOf(doc, names.map(enz)));
}
function count(doc: SeqDocument, name: string, host = doc.methylation): number {
  const text = doc.sequence.toString();
  return cuttableSites(
    text,
    doc.topology,
    host,
    findCutSites(text, doc.topology, [enz(name)]),
    (n) => getEnzyme(n)?.site.length ?? 0,
  ).length;
}
/** Both host states must agree: no tutorial site hangs on dam/dcm. */
function sites(doc: SeqDocument, name: string): number {
  const a = count(doc, name, METHYLATED_HOST);
  expect(count(doc, name, UNMETHYLATED_HOST)).toBe(a);
  return a;
}
/** The ticks a product opens with, as the store resolves them against the enzyme table (#309). */
function seeded(wanted: readonly string[]): string[] {
  return [...(resolveSeed(wanted, activeEnzymes()) ?? [])].sort();
}
function longest(frags: DigestFragment[]): DigestFragment {
  const f = [...frags].sort((a, b) => b.sequence.length - a.sequence.length)[0];
  if (f === undefined) throw new Error('no fragments');
  return f;
}
const ends = (f: DigestFragment): string => `${describeEnd(f.left)} / ${describeEnd(f.right)}`;
const names = (doc: SeqDocument): string[] => [...doc.features].map((f) => f.name);

// The Bench's check digest (BenchProduct.tsx), first rows as it ranks them.
function sitesByEnzyme(doc: SeqDocument): Map<string, CutSite[]> {
  const m = new Map<string, CutSite[]>();
  for (const s of sitesOf(doc, activeEnzymes())) m.set(s.enzyme, [...(m.get(s.enzyme) ?? []), s]);
  return m;
}
function checkRows(product: SeqDocument, empty: SeqDocument | null, n = 3): string[] {
  const gel: GelOptions = DEFAULT_GEL;
  const theirs = empty === null ? null : sitesByEnzyme(empty);
  const rows: { name: string; p: DigestProfile; e: DigestProfile | null }[] = [];
  for (const [name, own] of sitesByEnzyme(product)) {
    if (own.length > 6) continue;
    const t = theirs?.get(name);
    rows.push({
      name,
      p: enzymeProfile(own, product.length, product.topology, gel),
      e:
        empty === null
          ? null
          : t === undefined
            ? gelProfile([], gel)
            : enzymeProfile(t, empty.length, empty.topology, gel),
    });
  }
  rows.sort(
    (a, b) =>
      (empty === null
        ? compareDiagnostic(a.p, b.p, gel)
        : compareCheck(
            { product: a.p, empty: a.e ?? a.p },
            { product: b.p, empty: b.e ?? b.p },
            gel,
          )) || a.name.localeCompare(b.name),
  );
  return rows
    .slice(0, n)
    .map(
      (r) =>
        `${r.name}: ${describeBands(r.p)}${r.e === null ? '' : ` | empty ${describeBands(r.e)}`}`,
    );
}

beforeAll(() => {
  setActiveEnzymeSet(BUNDLED_ENZYME_SET);
});

const FILES = [
  'pLig-Vector',
  'Insert-EcoRI-BamHI',
  'Insert-PstI-BamHI',
  'Insert-EcoRI-EcoRI',
  'pGG-Destination',
  'GG-prom',
  'GG-cds',
  'GG-tag',
  'GG-term',
  'GG-warn-tag',
  'GG-warn-terminator',
  'GG-broken-duplicate-overhang',
  'GG-broken-internal-BsaI',
];

describe('the tutorial files', () => {
  it.each(FILES)('%s parses, round-trips and says it is synthetic', (file) => {
    const doc = tut(file);
    expect(doc.metadata.description).toMatch(/synthetic/i);
    const again = parseGenBank(writeGenBank(doc)).documents[0];
    expect(again?.sequence.toString()).toBe(doc.sequence.toString());
    expect(again?.topology).toBe(doc.topology);
    expect(names(def(again))).toEqual(names(doc));
    // Every feature lies inside the sequence, on its own bases.
    for (const f of doc.features) {
      for (const s of f.segments) {
        if (s.kind === 'range') {
          expect(s.start).toBeGreaterThanOrEqual(0);
          expect(s.end).toBeLessThanOrEqual(doc.length);
        }
      }
    }
  });

  it('are the sizes the README gives', () => {
    expect(
      FILES.map((f) => [f, tut(f).length, tut(f).topology] as const).map(
        ([f, n, t]) => `${f} ${n} ${t}`,
      ),
    ).toEqual([
      'pLig-Vector 2664 circular',
      'Insert-EcoRI-BamHI 819 linear',
      'Insert-PstI-BamHI 819 linear',
      'Insert-EcoRI-EcoRI 819 linear',
      'pGG-Destination 2647 circular',
      'GG-prom 106 linear',
      'GG-cds 623 linear',
      'GG-tag 55 linear',
      'GG-term 96 linear',
      'GG-warn-tag 55 linear',
      'GG-warn-terminator 96 linear',
      'GG-broken-duplicate-overhang 55 linear',
      'GG-broken-internal-BsaI 54 linear',
    ]);
  });
});

describe('Ligation exercise A: EcoRI + BamHI, directional', () => {
  const vector = tut('pLig-Vector');
  const insert = tut('Insert-EcoRI-BamHI');

  it('has no stray sites, with or without dam/dcm', () => {
    for (const e of ['EcoRI', 'BamHI', 'PstI']) expect(sites(vector, e)).toBe(1);
    expect(sites(insert, 'EcoRI')).toBe(1);
    expect(sites(insert, 'BamHI')).toBe(1);
    expect(sites(insert, 'PstI')).toBe(0);
    expect(sites(vector, 'SacI')).toBe(1);
    expect(sites(insert, 'SacI')).toBe(1);
    // The vector's cloning site lies in the MCS feature.
    const mcs = [...vector.features].find((f) => f.name === 'MCS');
    const seg = mcs?.segments[0];
    if (seg?.kind !== 'range') throw new Error('no MCS');
    for (const s of sitesOf(vector, ['EcoRI', 'BamHI', 'PstI'].map(enz))) {
      expect(s.siteStart).toBeGreaterThanOrEqual(seg.start);
      expect(s.siteStart).toBeLessThan(seg.end);
    }
  });

  it('cuts the vector into a 24 bp stuffer and a 2,640 bp backbone', () => {
    const frags = cut(vector, ['EcoRI', 'BamHI']);
    expect(frags.map((f) => f.sequence.length).sort((a, b) => a - b)).toEqual([24, 2640]);
    expect(ends(longest(frags))).toBe('BamHI 5′ GATC / EcoRI 5′ AATT');
    expect(ends(def([...frags].sort((a, b) => a.sequence.length - b.sequence.length)[0]))).toBe(
      'EcoRI 5′ AATT / BamHI 5′ GATC',
    );
  });

  it('cuts the insert into 7 + 801 + 11 bp, the 801 bp piece EcoRI to BamHI', () => {
    const frags = cut(insert, ['EcoRI', 'BamHI']);
    expect(frags.map((f) => f.sequence.length).sort((a, b) => a - b)).toEqual([7, 11, 801]);
    const middle = longest(frags);
    expect(ends(middle)).toBe('EcoRI 5′ AATT / BamHI 5′ GATC');
    expect(names(documentFromFragment(middle))).toContain('synthORF1');
  });

  it('ligates backbone then insert: every junction compatible, 3,441 bp circular', () => {
    const backbone = longest(cut(vector, ['EcoRI', 'BamHI']));
    const middle = longest(cut(insert, ['EcoRI', 'BamHI']));
    const joins = assemblyJunctions([backbone, middle], true);
    expect(joins.map((j) => j.compatible)).toEqual([true, true]);
    const product = ligate([backbone, middle], { name: 'pLig-Vector-Insert', circular: true });
    expect(product.length).toBe(3441);
    expect(product.isCircular).toBe(true);
    const text = product.sequence.toString().toUpperCase();
    expect(text).toContain('GAATTC');
    expect(sites(product, 'EcoRI')).toBe(1);
    expect(sites(product, 'BamHI')).toBe(1);
    expect(sites(product, 'PstI')).toBe(0);
    expect(sites(product, 'SacI')).toBe(2);
    // The product opens with the two enzymes the reaction used ticked, one site each.
    expect(seeded(ligationSeed([backbone, middle]))).toEqual(['BamHI', 'EcoRI']);
    // The insert reads the same way as the promoter.
    const orf = [...product.features].find((f) => f.name === 'synthORF1');
    expect(orf?.strand).toBe('forward');
    for (const n of ['synthetic promoter', 'synthetic terminator', 'AmpR', 'ori', 'synthORF1']) {
      expect(names(product)).toContain(n);
    }
    // The 24 bp stuffer, and so the PstI site, is gone.
    expect(names(product).filter((n) => n === 'MCS')).toHaveLength(2);
    // The check digest: a cut vector cannot close, so the product's lane stands alone.
    expect(emptyVector(backbone)).toBeNull();
    expect(checkRows(product, null, 4)).toEqual([
      'MluI: 2,876 + 565 bp',
      'HpaI: 2,741 + 700 bp',
      'ScaI: 2,566 + 875 bp',
      'SacI: 2,541 + 900 bp',
    ]);
    // What a miniprep sees: SacI on the product against the uncut vector.
    const sac = (d: SeqDocument): number[] =>
      digest(d, sitesOf(d, [enz('SacI')])).map((f) => f.sequence.length);
    expect(sac(product).sort((a, b) => b - a)).toEqual([2541, 900]);
    expect(sac(vector)).toEqual([2664]);
  });
});

describe('Ligation exercise B: incompatible ends', () => {
  const vector = tut('pLig-Vector');
  const bad = tut('Insert-PstI-BamHI');

  it('the PstI end meets the EcoRI end: not compatible, in either direction', () => {
    expect(sites(bad, 'EcoRI')).toBe(0);
    expect(sites(bad, 'PstI')).toBe(1);
    expect(sites(bad, 'BamHI')).toBe(1);
    const backbone = longest(cut(vector, ['EcoRI', 'BamHI']));
    const piece = longest(cut(bad, ['PstI', 'BamHI']));
    expect(ends(piece)).toBe('PstI 3′ TGCA / BamHI 5′ GATC');
    expect(piece.sequence.length).toBe(797);
    // As shelved: the junction backbone to insert says not compatible, the closing one is fine.
    expect(assemblyJunctions([backbone, piece], true).map((j) => j.compatible)).toEqual([
      false,
      true,
    ]);
    // Flipped (⇄): both junctions fail.
    expect(assemblyJunctions([backbone, flip(piece)], true).map((j) => j.compatible)).toEqual([
      false,
      false,
    ]);
    expect(() => ligate([backbone, piece], { name: 'x', circular: true })).toThrow(/Incompatible/);
  });

  it('the fix: cut the vector with PstI + BamHI and the same insert goes in, 3,453 bp', () => {
    const frags = cut(vector, ['PstI', 'BamHI']);
    expect(frags.map((f) => f.sequence.length).sort((a, b) => b - a)).toEqual([2656, 8]);
    const backbone = longest(frags);
    const piece = longest(cut(bad, ['PstI', 'BamHI']));
    expect(assemblyJunctions([backbone, piece], true).map((j) => j.compatible)).toEqual([
      true,
      true,
    ]);
    const product = ligate([backbone, piece], { name: 'x', circular: true });
    expect(product.length).toBe(3453);
    expect(sites(product, 'PstI')).toBe(1);
  });
});

describe('Ligation exercise C: one enzyme and dephosphorylation', () => {
  const vector = tut('pLig-Vector');
  const insert = tut('Insert-EcoRI-EcoRI');
  const lin = longest(cut(vector, ['EcoRI']));
  const piece = longest(cut(insert, ['EcoRI']));

  it('EcoRI opens the vector once; the insert is an 801 bp EcoRI piece', () => {
    expect(cut(vector, ['EcoRI'])).toHaveLength(1);
    expect(lin.sequence.length).toBe(2664);
    expect(ends(lin)).toBe('EcoRI 5′ AATT / EcoRI 5′ AATT');
    expect(sites(insert, 'EcoRI')).toBe(2);
    expect(piece.sequence.length).toBe(801);
    expect(ends(piece)).toBe('EcoRI 5′ AATT / EcoRI 5′ AATT');
  });

  it('without -P the vector closes on itself; with -P its closing junction says so', () => {
    expect(assemblyJunctions([lin], true).map((j) => [j.compatible, j.dephosphorylated])).toEqual([
      [true, false],
    ]);
    expect(emptyVector(lin)?.length).toBe(2664);
    const bare = { ...lin, dephosphorylated: true };
    expect(assemblyJunctions([bare], true).map((j) => [j.compatible, j.dephosphorylated])).toEqual([
      [false, true],
    ]);
    expect(emptyVector(bare)).toBeNull();
    expect(() => ligate([bare], { name: 'x', circular: true })).toThrow(/dephosphorylated/);
  });

  it('vector -P plus insert: 3,465 bp, either orientation; the orientation is the ORF strand', () => {
    const bare = { ...lin, dephosphorylated: true };
    expect(assemblyJunctions([bare, piece], true).map((j) => j.compatible)).toEqual([true, true]);
    const fwd = ligate([bare, piece], { name: 'x', circular: true });
    const rev = ligate([bare, flip(piece)], { name: 'x', circular: true });
    expect(fwd.length).toBe(3465);
    expect(rev.length).toBe(3465);
    // One enzyme on all three ends: one tick, two sites in the product.
    expect(seeded(ligationSeed([bare, piece]))).toEqual(['EcoRI']);
    expect(sites(fwd, 'EcoRI')).toBe(2);
    const strand = (d: SeqDocument): string | undefined =>
      [...d.features].find((f) => f.name === 'synthORF1')?.strand;
    expect(strand(fwd)).toBe('forward');
    expect(strand(rev)).toBe('reverse');
  });

  it('the miniprep check against the vector closed on itself', () => {
    const product = ligate([lin, piece], { name: 'x', circular: true });
    expect(checkRows(product, emptyVector(lin), 2)).toEqual([
      'EcoRI: 2,664 + 801 bp | empty 2,664 bp',
      'SacI: 2,565 + 900 bp | empty 2,664 bp',
    ]);
  });
});

describe('Golden Gate exercise: BsaI, four parts, scrambled order', () => {
  const dest = tut('pGG-Destination');
  const parts = ['GG-prom', 'GG-cds', 'GG-tag', 'GG-term'].map(tut);
  const BsaI = enz('BsaI');

  it('has two BsaI sites in the vector and in every part, and no other BsaI/BsmBI', () => {
    for (const d of [dest, ...parts]) {
      expect(sites(d, 'BsaI')).toBe(2);
      expect(sites(d, 'BsmBI')).toBe(0);
    }
    // The vector's sites point outward from the backbone: the dropout leaves with them.
    const frags = cut(dest, ['BsaI']);
    expect(frags.map((f) => f.sequence.length).sort((a, b) => a - b)).toEqual([321, 2326]);
    const backbone = longest(frags);
    expect(ends(backbone)).toBe('BsaI 5′ CGCT / BsaI 5′ GGAG');
  });

  it('parts carry the overhangs the README gives', () => {
    const o = parts.map((p) => {
      const useful = cut(p, ['BsaI']).filter((f) => f.sequence.length > 30 || p.length < 60);
      const f = longest(useful);
      return `${p.name}: ${ends(f)} (${f.sequence.length})`;
    });
    expect(o).toEqual([
      'GG-Part1-Promoter: BsaI 5′ GGAG / BsaI 5′ AATG (84)',
      'GG-Part2-CDS: BsaI 5′ AATG / BsaI 5′ TTCG (601)',
      'GG-Part3-Tag: BsaI 5′ TTCG / BsaI 5′ GCTT (33)',
      'GG-Part4-Terminator: BsaI 5′ GCTT / BsaI 5′ CGCT (74)',
    ]);
  });

  it('assembles whatever the order the files are opened in', () => {
    const orders = [
      [3, 1, 0, 2],
      [2, 0, 3, 1],
      [0, 1, 2, 3],
      [1, 3, 2, 0],
    ];
    for (const order of orders) {
      const inTube = [dest, ...order.map((i) => def(parts[i]))];
      // The destination may come last or in the middle as well.
      for (const tube of [inTube, [...inTube.slice(1), dest]]) {
        const r = goldenGate(tube, { enzyme: BsaI });
        expect(r.problem).toBeNull();
        // The circle starts at whichever document came first in the tube.
        const got = r.assembly?.order.map((p) => p.document.name) ?? [];
        const at = got.indexOf('pGG-Destination');
        expect([...got.slice(at), ...got.slice(0, at)]).toEqual([
          'pGG-Destination',
          'GG-Part1-Promoter',
          'GG-Part2-CDS',
          'GG-Part3-Tag',
          'GG-Part4-Terminator',
        ]);
        expect(r.assembly?.order.some((p) => p.flipped)).toBe(false);
        expect(r.assembly?.product.length).toBe(3118);
        expect(r.assembly?.warnings).toEqual([]);
        expect(r.dropped).toHaveLength(9);
        const oh = r.assembly?.order.map((p) => p.fragment.left.overhang) ?? [];
        expect([...oh.slice(at), ...oh.slice(0, at)]).toEqual([
          'CGCT',
          'GGAG',
          'AATG',
          'TTCG',
          'GCTT',
        ]);
      }
    }
  });

  it('the product: 3,118 bp circular, features, one fused ORF, check digest against the vector', () => {
    const r = goldenGate([dest, ...parts], { enzyme: BsaI });
    const product = def(r.assembly?.product);
    expect(product.isCircular).toBe(true);
    expect(names(product).sort()).toEqual(
      ['KanR', 'ori', 'synthCDS', 'synthTag', 'synthetic promoter', 'synthetic terminator'].sort(),
    );
    expect(sites(product, 'BsaI')).toBe(0);
    // The product opens with BsaI ticked (the Bench's choice), though it has no site left.
    expect(seeded(goldenGateSeed(BsaI.name))).toEqual(['BsaI']);
    expect(seeded(goldenGateSeed(BsaI.name, 'BsmBI'))).toEqual(['BsaI', 'BsmBI']);
    // The CDS and the tag read as one frame to a single stop.
    const text = product.sequence.toString().toUpperCase();
    const cds = [...product.features].find((f) => f.name === 'synthCDS');
    const seg = cds?.segments[0];
    if (seg?.kind !== 'range') throw new Error('no CDS');
    const protein = translate(text.slice(seg.start, seg.start + 633));
    expect(protein.endsWith('FGGSGGHHHH*')).toBe(true);
    expect(protein.slice(0, -1)).not.toContain('*');
    expect(checkRows(product, dest, 2)).toEqual([
      'AseI: 2,583 + 535 bp | empty 2,647 bp',
      'DraI: 1,953 + 1,165 bp | empty 2,647 bp',
    ]);
  });

  it('a part with an extra BsaI site, and one whose overhang is taken, stop the reaction', () => {
    const base = [dest, ...[parts[0], parts[1], parts[3]].filter((p): p is SeqDocument => !!p)];
    const internal = goldenGate([...base, tut('GG-broken-internal-BsaI')], { enzyme: BsaI });
    expect(internal.assembly).toBeNull();
    expect(sites(tut('GG-broken-internal-BsaI'), 'BsaI')).toBe(3);
    expect(internal.problem).toBe(
      'No part starts with the overhang BsaI 5′ TTCG left by GG-Part2-CDS. 2 of 5 parts were never reached.',
    );
    const dup = goldenGate([...base, tut('GG-broken-duplicate-overhang')], { enzyme: BsaI });
    expect(dup.assembly).toBeNull();
    expect(dup.problem).toMatch(
      /No part starts with the overhang BsaI 5′ AATG left by GG-Broken-Tag-DuplicateOverhang/,
    );
  });

  it('overhangs one base apart assemble with a warning', () => {
    const tube = [dest, parts[0], parts[1], tut('GG-warn-tag'), tut('GG-warn-terminator')].filter(
      (p): p is SeqDocument => p !== undefined,
    );
    const r = goldenGate(tube, { enzyme: BsaI });
    expect(r.problem).toBeNull();
    expect(r.assembly?.product.length).toBe(3118);
    expect(r.assembly?.warnings.map((w) => w.text)).toEqual([
      'AATG and AATC differ at one base, so a ligase may join one in place of the other.',
    ]);
  });
});

describe('both sets, files as the README tells the user to write them', () => {
  it('flipping: a part given back to front is turned around for you', () => {
    const dest = tut('pGG-Destination');
    const parts = ['GG-prom', 'GG-cds', 'GG-tag', 'GG-term'].map(tut);
    const turned = parts.map((p) =>
      p.name === 'GG-Part2-CDS'
        ? SeqDocument.create({
            name: p.name,
            sequence: reverseComplement(p.sequence.toString()),
          })
        : p,
    );
    const r = goldenGate([dest, ...turned], { enzyme: enz('BsaI') });
    expect(r.assembly?.order.filter((p) => p.flipped).map((p) => p.document.name)).toEqual([
      'GG-Part2-CDS',
    ]);
  });
});

function flip(f: DigestFragment): DigestFragment {
  return flipFragment(f);
}

describe.skipIf(!existsSync(NCBI_FILE))('NCBI gene: INS, NM_000207', () => {
  const record = (): SeqDocument => load(NCBI_FILE);
  function cdsRange(rec: SeqDocument): { start: number; end: number } {
    const cds = [...rec.features].find((f) => f.type === 'CDS');
    const seg = cds?.segments[0];
    if (seg?.kind !== 'range') throw new Error('no CDS');
    return { start: seg.start, end: seg.end };
  }

  it('is 465 bp with a 333 bp CDS free of EcoRI, BamHI, BsaI and BsmBI', () => {
    const rec = record();
    expect(rec.length).toBe(465);
    const r = cdsRange(rec);
    expect(r.end - r.start).toBe(333);
    const cds = SeqDocument.create({
      name: 'cds',
      sequence: rec.sequence.toString().slice(r.start, r.end),
    });
    for (const e of ['EcoRI', 'BamHI', 'BsaI', 'BsmBI']) expect(sites(cds, e)).toBe(0);
    expect(cds.sequence.toString().toUpperCase().startsWith('ATGGCCCTGTGGATGCGC')).toBe(true);
  });

  it('ligation: the primer workspace designs EcoRI + BamHI primers; Simulate gives 2,979 bp', () => {
    const vector = tut('pLig-Vector');
    const rec = record();
    const insert = { document: rec, range: cdsRange(rec), strand: 'forward' as const, name: 'INS' };
    const region = resolveVectorRegion(vector, null);
    expect(region.source).toBe('mcs');
    const ctx = {
      vector,
      region,
      insert,
      flipped: false,
      scans: scanForCloningNow(vector, insert),
    };
    const pairs = suggestEnzymePairs(ctx).pairs.filter((p) => p.usable);
    expect(`${pairs[0]?.forward.enzyme}·${pairs[0]?.reverse.enzyme}`).toBe('EcoRI·BamHI');
    const d = designCloningEnds(ctx, { forward: 'EcoRI', reverse: 'BamHI' });
    expect(d.problem).toBeNull();
    expect(d.forward.sequence).toBe('gttctggaattcATGGCCCTGTGGATGCGC');
    expect(d.reverse.sequence).toBe('ctaataggatccCTAGTTGCAGTAGTTCTCCAGC');
    expect(d.warnings.map((w) => `${w.severity} ${w.kind}`)).toEqual(['caution annealing']);
    expect(d.productLength).toBe(357);
    const sim = d.simulate();
    expect(sim.problem).toBeNull();
    expect(sim.amplicon?.length).toBe(357);
    const product = def(sim.product);
    expect(product.length).toBe(2979);
    expect(product.isCircular).toBe(true);
    expect(names(product)).toEqual(
      expect.arrayContaining(['synthetic promoter', 'AmpR', 'ori', 'INS', 'insulin preproprotein']),
    );
    expect(sites(product, 'EcoRI')).toBe(1);
    expect(sites(product, 'BamHI')).toBe(1);
    expect(checkRows(product, null, 1)).toEqual([CHECK_LIG]);
    // Simulate opens it with EcoRI and BamHI ticked, one site each.
    expect(seeded(cloningSeed(d.forward.enzyme, d.reverse.enzyme))).toEqual(['BamHI', 'EcoRI']);
    // Step 7: MluI cuts it twice, so the Enzymes tab lists it under a Cuts
    // setting that includes twice-cutters, and ticking it gives these bands.
    expect(sites(product, 'MluI')).toBe(2);
    expect(
      digest(product, sitesOf(product, [enz('MluI')]))
        .map((f) => f.sequence.length)
        .sort((a, b) => b - a),
    ).toEqual([2414, 565]);
  });

  it('Golden Gate: two BsaI primers, PCR 353 bp, then 2,848 bp with the synthetic promoter, tag and terminator', () => {
    const rec = record();
    const r = cdsRange(rec);
    const body = rec.sequence
      .toString()
      .toUpperCase()
      .slice(r.start, r.end - 3);
    const F = `TTGGTCTCAA${body.slice(0, 22)}`;
    const R = `TTGGTCTCACGAA${reverseComplement(body.slice(-22))}`;
    expect(F).toBe('TTGGTCTCAAATGGCCCTGTGGATGCGCCTCC');
    expect(R).toBe('TTGGTCTCACGAAGTTGCAGTAGTTCTCCAGCTGG');
    const res = pcr(rec, [
      { name: 'INS-F-BsaI', sequence: F },
      { name: 'INS-R-BsaI', sequence: R },
    ]);
    expect(res.problem).toBeNull();
    expect(res.products).toHaveLength(1);
    const amplicon = def(res.products[0]?.document);
    expect(amplicon.length).toBe(353);
    expect(sites(amplicon, 'BsaI')).toBe(2);
    const dest = tut('pGG-Destination');
    const others = ['GG-term', 'GG-tag', 'GG-prom'].map(tut);
    const run = goldenGate([amplicon, ...others, dest], { enzyme: enz('BsaI') });
    expect(run.problem).toBeNull();
    expect(run.assembly?.warnings).toEqual([]);
    const got = run.assembly?.order.map((p) => p.document.name) ?? [];
    const at = got.indexOf('pGG-Destination');
    expect([...got.slice(at), ...got.slice(0, at)]).toEqual([
      'pGG-Destination',
      'GG-Part1-Promoter',
      amplicon.name,
      'GG-Part3-Tag',
      'GG-Part4-Terminator',
    ]);
    const product = def(run.assembly?.product);
    expect(product.length).toBe(2848);
    expect(names(product)).toEqual(
      expect.arrayContaining([
        'KanR',
        'ori',
        'synthetic promoter',
        'INS',
        'insulin B chain',
        'synthTag',
        'synthetic terminator',
      ]),
    );
    const text = product.sequence.toString().toUpperCase();
    const start = text.indexOf('ATGGCCCTGTGG');
    expect(translate(text.slice(start, start + 363))).toBe(
      'MALWMRLLPLLALLALWGPDPAAAFVNQHLCGSHLVEALYLVCGERGFFYTPKTRREAEDLQVGQVELGGGPGAGSLQPLALEGSLQKRGIVEQCCTSICSLYQLENYCNFGGSGGHHHH*',
    );
    expect(checkRows(product, dest, 2)).toEqual([
      'AseI: 2,313 + 535 bp | empty 2,647 bp',
      'EcoNI: 2,220 + 628 bp | empty 2,647 bp',
    ]);
  });
});

const CHECK_LIG = 'MluI: 2,414 + 565 bp';
