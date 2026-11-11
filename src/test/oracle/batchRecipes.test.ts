import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  type BatchTemplate,
  type CloningBatchRecipe,
  type CloningBatchSettings,
  BUNDLED_ENZYME_SET,
  SeqDocument,
  parseBatchText,
  reverseComplement,
  setActiveEnzymeSet,
  validateBatch,
} from '@/core';
import { parseGenBank } from '@/io/genbank/parseGenBank';
import { type CloningBatchRow, runCloningBatch } from '@/app/cloningBatch';
import { AnalysisClient } from '@/workers/analysisClient';

import oracle from './batchRecipes.json';

/**
 * The Batch page's restriction-sites, homology-ends and Golden Gate extras
 * (a second enzyme in the tube, a per-row enzyme, `left`/`right`, extra5/extra3)
 * against pydna and Biopython (scripts/oracle/batchrecipes.py, item 145, issue
 * #431), the method of batchGoldenGate.test.ts (item 143). The batch is run on
 * the vectors, templates and rows recorded here; the Python oracle took
 * PlasmidPop's primers and simulated each row without any of our code: the
 * tailed PCR (pydna), then for restriction sites both digests and the ligation
 * (`Dseqrecord.cut`, `+`, `looped()`, and a splice from Bio.Restriction's cut
 * coordinates alone), for homology ends `pydna.assembly.Assembly` on the
 * linear vector and the amplicon, and for Golden Gate the judge of item 143.
 * This test runs the batch again and requires the same primers, amplicon and
 * construct, so a change to the designers' output has to be reviewed against
 * the oracle (`scripts/oracle/run.sh batch-recipes`).
 */

const TUTORIALS = join(__dirname, '../../../docs/tutorials/files');
const inline = new AnalysisClient(null);

type Recipe = 'restriction' | 'homology' | 'golden-gate';

interface BatchInput {
  readonly id: string;
  readonly kind: 'tutorial' | 'random';
  readonly recipe: CloningBatchRecipe;
  readonly settings: CloningBatchSettings;
  readonly vector: { readonly name: string; readonly sequence: string; readonly circular: boolean };
  readonly templates: readonly {
    readonly name: string;
    readonly sequence: string;
    readonly circular: boolean;
  }[];
  readonly table: string;
}

interface RecordedRow {
  readonly name: string;
  readonly status: 'designed' | 'failed';
  readonly forward: string;
  readonly reverse: string;
  readonly amplicon: { readonly length: number; readonly sha256: string };
  readonly construct: {
    readonly length: number;
    readonly sha256: string;
    readonly head: string;
  } | null;
  readonly warnings: readonly string[];
  readonly oracle: {
    readonly confirmed: boolean;
    readonly built: boolean;
    readonly routes: readonly string[];
    readonly pcrProducts: number;
    readonly orientation?: string;
    readonly sitesInProduct?: number;
    readonly sitesAtJunctions?: number;
    readonly overlap?: number;
    readonly reason?: string;
  };
}
interface RecordedBatch extends BatchInput {
  readonly rows: readonly RecordedRow[];
}

const batches = oracle.batches as unknown as readonly RecordedBatch[];

function sha256(text: string): string {
  return createHash('sha256').update(text.toUpperCase()).digest('hex');
}

async function runBatch(input: BatchInput) {
  const vector = SeqDocument.create({
    name: input.vector.name,
    sequence: input.vector.sequence,
    topology: input.vector.circular ? 'circular' : 'linear',
  });
  const templates: BatchTemplate[] = input.templates.map((t) => ({
    name: t.name,
    document: SeqDocument.create({
      name: t.name,
      sequence: t.sequence,
      topology: t.circular ? 'circular' : 'linear',
    }),
  }));
  const validated = validateBatch(parseBatchText(input.table), {
    templates,
    defaultTemplate: input.templates[0]?.name,
  });
  const out = await runCloningBatch(
    validated.rows,
    vector,
    { recipe: input.recipe, settings: input.settings, templates },
    { client: inline },
  );
  return { out, bad: validated.results.filter((r) => !r.ok) };
}

type Designed = Extract<CloningBatchRow, { status: 'designed' }>;
const isDesigned = (r: CloningBatchRow): r is Designed => r.status === 'designed';

/** What one designed row is, in the terms the oracle and the gate share. */
function describeRow(row: Designed) {
  const construct = row.product?.sequence.toString() ?? null;
  const common = {
    name: row.name,
    status: 'designed' as const,
    construct,
    constructCircular: row.product?.isCircular ?? null,
    messages: row.warnings,
  };
  switch (row.recipe) {
    case 'restriction': {
      const { design } = row;
      return {
        ...common,
        recipe: row.recipe,
        forward: design.forward.sequence,
        reverse: design.reverse.sequence,
        segments: [design.forward.segments, design.reverse.segments],
        enzymes: [design.forward.enzyme, design.reverse.enzyme],
        orientation: design.pair.orientation,
        amplicon: design.amplicon,
        warnings: design.warnings.map((w) => w.kind),
      };
    }
    case 'golden-gate': {
      const { design } = row;
      return {
        ...common,
        recipe: row.recipe,
        forward: design.forward.sequence,
        reverse: design.reverse.sequence,
        segments: [design.forward.segments, design.reverse.segments],
        enzyme: design.forward.enzyme,
        left: design.left,
        right: design.right,
        amplicon: design.amplicon,
        warnings: design.warnings.map((w) => w.kind),
      };
    }
    case 'homology': {
      const { design } = row;
      return {
        ...common,
        recipe: row.recipe,
        kit: design.kit,
        forward: design.primers?.forward.sequence ?? '',
        reverse: design.primers?.reverse.sequence ?? '',
        amplicon: design.amplicon?.sequence.toString() ?? '',
        warnings: design.warnings.map(() => 'kit'),
      };
    }
  }
}

// ---------------------------------------------------------------- the cases

/** mulberry32: a seeded generator, so the cases are the same on every run. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Palindromic, unambiguous sites whose overhangs differ from one another's (one family each). */
const SITES: Readonly<Record<string, string>> = {
  EcoRI: 'GAATTC',
  BamHI: 'GGATCC',
  HindIII: 'AAGCTT',
  NcoI: 'CCATGG',
  XhoI: 'CTCGAG',
  KpnI: 'GGTACC',
  PstI: 'CTGCAG',
  NdeI: 'CATATG',
  NotI: 'GCGGCCGC',
};
const GG_SITES: Readonly<Record<string, string>> = { BsaI: 'GGTCTC', BsmBI: 'CGTCTC' };
const SEED = 20261111;

function generateInputs(): BatchInput[] {
  const rand = rng(SEED);
  const int = (lo: number, hi: number): number => lo + Math.floor(rand() * (hi - lo + 1));
  const pick = <T>(xs: readonly T[]): T => xs[int(0, xs.length - 1)] as T;
  const base = (): string => 'ACGT'.charAt(int(0, 3));
  const raw = (n: number): string => {
    let s = '';
    for (let i = 0; i < n; i++) s += base();
    return s;
  };
  const hasSite = (s: string, sites: readonly string[]): boolean =>
    sites.some((x) => s.includes(x) || s.includes(reverseComplement(x)));
  /** Random bases with no site of the given enzymes on either strand. */
  const dna = (n: number, sites: readonly string[]): string => {
    for (;;) {
      const s = raw(n);
      if (!hasSite(s, sites)) return s;
    }
  };
  const RS = Object.values(SITES);
  const GG = Object.values(GG_SITES);
  const csv = (rows: readonly (readonly string[])[]): string =>
    rows
      .map((r) => r.map((c) => (/[",]/.test(c) ? `"${c.replaceAll('"', '""')}"` : c)).join(','))
      .join('\n') + '\n';
  const count = (s: string, x: string): number => {
    let n = 0;
    for (let i = s.indexOf(x); i >= 0; i = s.indexOf(x, i + 1)) n++;
    return n;
  };

  const file = (name: string): string => {
    const doc = parseGenBank(readFileSync(join(TUTORIALS, `${name}.gb`), 'utf8')).documents[0];
    if (doc === undefined) throw new Error(`${name} has no record`);
    return doc.sequence.toString();
  };
  const MINI =
    'ATGTGTCGTAGAAACGGACGCCGCCCCCAGAGTGACGAAAACTCTCTTAGGAGCGCCTATGTACTTACTAACAGAGACAGCAGTCCGACTAGGGTGCAATGTGTCGCCGGTGGCATTTAA';

  interface Tpl {
    name: string;
    sequence: string;
    circular: boolean;
  }
  type RowKind = 'forward' | 'reverse' | 'whole' | 'bare' | 'wrap-forward' | 'wrap-reverse';
  /** A row's first six cells: name, template, region, sequence. */
  const rowFor = (
    kind: RowKind,
    name: string,
    template: Tpl,
    avoid: readonly string[],
  ): string[] => {
    const n = template.sequence.length;
    const a = int(1, Math.floor(n / 3));
    const b = int(Math.floor((2 * n) / 3), n);
    switch (kind) {
      case 'forward':
        return [name, template.name, `${a}-${b}`, ''];
      case 'reverse':
        return [name, template.name, `complement(${a}..${b})`, ''];
      case 'whole':
        return [name, template.name, '', ''];
      case 'bare':
        return [name, '', '', dna(int(120, 360), avoid)];
      case 'wrap-forward': {
        const s = int(Math.floor((2 * n) / 3), n - 40);
        const e = int(40, Math.floor(n / 3));
        return [name, template.name, `join(${s}..${n},1..${e})`, ''];
      }
      case 'wrap-reverse': {
        const s = int(Math.floor((2 * n) / 3), n - 40);
        const e = int(40, Math.floor(n / 3));
        return [name, template.name, `complement(join(${s}..${n},1..${e}))`, ''];
      }
    }
  };
  const KINDS: readonly RowKind[][] = [
    ['forward', 'reverse', 'whole'],
    ['forward', 'bare', 'reverse'],
    ['reverse', 'reverse', 'forward'],
    ['whole', 'bare'],
    ['forward', 'reverse', 'bare', 'whole'],
    ['reverse', 'forward', 'forward'],
    ['forward', 'reverse', 'whole', 'bare'],
    ['reverse', 'whole', 'forward'],
  ];

  const out: BatchInput[] = [];

  // ------------------------------------------------------- restriction sites
  // The tutorial's own rows (Exercise 5 of batch-primers.md): EcoRI/BamHI into pLig-Vector's
  // cloning site (233..262), then the same table with a per-row PstI/BamHI and the extra
  // bases (a Kozak sequence in `left`, a stop codon in `right`).
  const ligVector = {
    name: 'pLig-Vector',
    sequence: file('pLig-Vector'),
    circular: true,
  };
  const ggGene = { name: 'GG-gene', sequence: file('GG-gene'), circular: false };
  const HEADER_RS = ['name', 'template', 'region', 'sequence', 'enzyme', 'left', 'right'];
  out.push({
    id: 'restriction-tutorial-ecori-bamhi',
    kind: 'tutorial',
    recipe: {
      recipe: 'restriction',
      forward: 'EcoRI',
      reverse: 'BamHI',
      region: { start: 232, end: 262 },
    },
    settings: {},
    vector: ligVector,
    templates: [ggGene],
    table: csv([
      HEADER_RS,
      ['gene_full', 'GG-gene', '', '', '', '', ''],
      ['gene_head', 'GG-gene', '1-300', '', '', '', ''],
      ['mini', '', '', MINI, '', '', ''],
      ['kozak', 'GG-gene', '1-300', '', '', 'GCCACC', 'TAA'],
      ['pst_bam', 'GG-gene', '1-300', '', 'PstI/BamHI', '', ''],
      ['bam_eco', 'GG-gene', '1-300', '', 'BamHI/EcoRI', '', ''],
      ['pst_eco_rev', 'GG-gene', 'complement(1..300)', '', 'PstI/EcoRI', 'ACC', ''],
    ]),
  });

  /** A vector: [flank][MCS: four sites, 8-12 bases apart][flank], turned, maybe read from the other strand. */
  const restrictionVector = (
    tag: string,
    mode: 'plain' | 'across-mcs' | 'other-strand',
  ): { vector: Tpl; region: { start: number; end: number }; enzymes: string[] } => {
    for (;;) {
      const enzymes: string[] = [];
      while (enzymes.length < 4) {
        const e = pick(Object.keys(SITES));
        if (!enzymes.includes(e)) enzymes.push(e);
      }
      let mcs = dna(int(8, 12), RS);
      for (const e of enzymes) mcs += (SITES[e] ?? '') + dna(int(8, 12), RS);
      const left = dna(int(300, 480), RS);
      const right = dna(int(300, 480), RS);
      const full = left + mcs + right;
      // Each of the four sites once, no other site of the panel, across the origin too.
      const ring = full + full.slice(0, 8);
      if (
        !Object.entries(SITES).every(([e, s]) => count(ring, s) === (enzymes.includes(e) ? 1 : 0))
      ) {
        continue;
      }
      const start0 = left.length;
      const n = full.length;
      let turn: number;
      if (mode === 'across-mcs')
        turn = start0 + int(Math.floor(mcs.length / 3), Math.floor(mcs.length / 2));
      else turn = int(0, 1) === 0 ? 0 : int(1, start0 - 1);
      let seq = full.slice(turn) + full.slice(0, turn);
      let start = (start0 - turn + n) % n;
      if (mode === 'other-strand') {
        seq = reverseComplement(seq);
        start = (n - ((start + mcs.length) % n)) % n;
      }
      return {
        vector: { name: `rvec-${tag}`, sequence: seq, circular: true },
        region: { start, end: start + mcs.length },
        enzymes,
      };
    }
  };

  const restrictionCases: readonly {
    mode: 'plain' | 'across-mcs' | 'other-strand';
    extra: boolean;
  }[] = [
    { mode: 'plain', extra: false },
    { mode: 'plain', extra: true },
    { mode: 'other-strand', extra: false },
    { mode: 'other-strand', extra: true },
    { mode: 'across-mcs', extra: false },
    { mode: 'across-mcs', extra: true },
    { mode: 'plain', extra: false },
    { mode: 'plain', extra: true },
  ];
  restrictionCases.forEach((c, i) => {
    const { vector, region, enzymes } = restrictionVector(String(i + 1), c.mode);
    const [e1, e2, e3, e4] = enzymes as [string, string, string, string];
    const circular = i % 3 === 2;
    const tpl: Tpl = {
      name: `${circular ? 'C' : 'T'}${(i + 1).toString()}`,
      sequence: dna(int(380, 800), RS),
      circular,
    };
    const kinds: readonly RowKind[] = circular
      ? ['wrap-forward', 'wrap-reverse', 'forward']
      : (KINDS[i] as readonly RowKind[]);
    const rows = kinds.map((k) => [...rowFor(k, '', tpl, RS), '', '', '']);
    // A pair of the MCS the other way round, and a pair that is not the batch's.
    rows.push([...rowFor('forward', '', tpl, RS), `${e4}/${e1}`, '', '']);
    rows.push([...rowFor('reverse', '', tpl, RS), `${e3}/${e2}`, '', '']);
    if (c.extra) {
      rows.push([...rowFor('forward', '', tpl, RS), '', 'GCCACC', 'TAATAG']);
      rows.push([...rowFor('forward', '', tpl, RS), `${e2}/${e4}`, 'ACC', '']);
    }
    rows.forEach((r, j) => {
      r[0] = `r${(j + 1).toString()}`;
    });
    out.push({
      id: `restriction-random-${(i + 1).toString()}`,
      kind: 'random',
      recipe: { recipe: 'restriction', forward: e1, reverse: e2, region },
      // The batch's own extra bases, on every row that has none of its own.
      settings: c.extra && i % 2 === 1 ? { extra5: 'GCC', extra3: 'TGA' } : {},
      vector,
      templates: [tpl],
      table: csv([HEADER_RS, ...rows]),
    });
  });

  // ---------------------------------------------------------- homology ends
  const HEADER_HE = ['name', 'template', 'region', 'sequence', 'kit'];
  const gbVector = { name: 'GB-Vector', sequence: file('GB-Vector'), circular: false };
  out.push({
    id: 'homology-tutorial-in-fusion',
    kind: 'tutorial',
    recipe: { recipe: 'homology', kit: 'in-fusion' },
    settings: {},
    vector: gbVector,
    templates: [ggGene],
    table: csv([
      HEADER_HE,
      ['gene_full', 'GG-gene', '', '', ''],
      ['gene_head', 'GG-gene', '1-300', '', ''],
      ['mini', '', '', MINI, ''],
      ['nebuilder_row', 'GG-gene', '1-300', '', 'NEBuilder HiFi'],
      ['yeast_row', 'GG-gene', '', '', 'Yeast assembly'],
    ]),
  });
  const homologyCases: readonly CloningBatchRecipe[] = [
    { recipe: 'homology', kit: 'in-fusion' },
    { recipe: 'homology', kit: 'nebuilder' },
    { recipe: 'homology', kit: 'yeast' },
    { recipe: 'homology', kit: 'yeast', overlap: 30 },
    { recipe: 'homology', kit: 'yeast', overlap: 60 },
    { recipe: 'homology', kit: 'in-fusion' },
    { recipe: 'homology', kit: 'nebuilder' },
    { recipe: 'homology', kit: 'in-fusion' },
  ];
  homologyCases.forEach((recipe, i) => {
    const circular = i % 3 === 2;
    const tpl: Tpl = {
      name: `${circular ? 'C' : 'T'}${(i + 1).toString()}`,
      sequence: dna(int(380, 800), []),
      circular,
    };
    const kinds: readonly RowKind[] = circular
      ? ['wrap-forward', 'wrap-reverse', 'forward']
      : (KINDS[i] as readonly RowKind[]);
    const kits = ['', '', 'In-Fusion', 'NEBuilder HiFi', 'nebuilder', 'Yeast'];
    const rows = kinds.map((k, j) => {
      const r = rowFor(k, `h${(j + 1).toString()}`, tpl, []);
      return [...r, i >= 5 ? (kits[int(0, kits.length - 1)] ?? '') : ''];
    });
    out.push({
      id: `homology-random-${(i + 1).toString()}`,
      kind: 'random',
      recipe,
      settings: {},
      vector: {
        name: `hvec-${(i + 1).toString()}`,
        sequence: dna(int(500, 900), []),
        circular: false,
      },
      templates: [tpl],
      table: csv([HEADER_HE, ...rows]),
    });
  });

  // ------------------------------------------------- Golden Gate: the extras
  const HEADER_GG = ['name', 'template', 'region', 'sequence', 'enzyme', 'left', 'right'];
  const overhangPair = (): [string, string] => {
    const one = (): string => {
      for (;;) {
        const s = raw(4);
        if (s !== reverseComplement(s) && new Set(s).size >= 3) return s;
      }
    };
    const near = (x: string, y: string): number => {
      let n = 0;
      for (let i = 0; i < x.length; i++) if (x.charAt(i) !== y.charAt(i)) n++;
      return n;
    };
    for (;;) {
      const a = one();
      const b = one();
      if (near(a, b) >= 2 && near(a, reverseComplement(b)) >= 2) return [a, b];
    }
  };
  /** [o1][A][site, reversed][dropout][site][A][o0][backbone], as batchGoldenGate.test.ts has it. */
  const cassette = (enzyme: string, [o0, o1]: [string, string]): string => {
    const site = GG_SITES[enzyme] ?? '';
    return o1 + 'A' + reverseComplement(site) + dna(int(60, 140), GG) + site + 'A' + o0;
  };
  const turned = (s: string): string => {
    const k = rand() < 0.5 ? 0 : int(1, s.length - 1);
    return s.slice(k) + s.slice(0, k);
  };

  // A second enzyme in the tube, which the part must not carry a site of either: BsaI with
  // BsmBI, and BsmBI with BsaI.
  for (let i = 0; i < 2; i++) {
    const enzyme = i === 0 ? 'BsaI' : 'BsmBI';
    const second = i === 0 ? 'BsmBI' : 'BsaI';
    const o = overhangPair();
    const tpl: Tpl = {
      name: `S${(i + 1).toString()}`,
      sequence: dna(int(420, 700), GG),
      circular: false,
    };
    const planted = i === 0 ? 'CGTCTC' : 'GGTCTC';
    const rows = [
      ...(KINDS[i] as readonly RowKind[]).map((k, j) => [
        ...rowFor(k, `s${(j + 1).toString()}`, tpl, GG),
        '',
        '',
        '',
      ]),
      ['own_site', '', '', dna(100, GG) + planted + dna(100, GG), '', '', ''],
    ];
    out.push({
      id: `golden-gate-second-enzyme-${enzyme.toLowerCase()}-${second.toLowerCase()}`,
      kind: 'random',
      recipe: { recipe: 'golden-gate', enzyme, secondEnzyme: second },
      settings: {},
      vector: {
        name: `sdest${(i + 1).toString()}`,
        sequence: turned(cassette(enzyme, o) + dna(int(300, 480), GG)),
        circular: true,
      },
      templates: [tpl],
      table: csv([HEADER_GG, ...rows]),
    });
  }
  // A destination that holds a BsaI cassette and a BsmBI one with their own overhangs; the batch
  // is BsaI and rows of a `enzyme` cell BsmBI (or BsaI/BsmBI, the two in one tube) use the other.
  for (let i = 0; i < 2; i++) {
    const oa = overhangPair();
    const ob = overhangPair();
    const tpl: Tpl = {
      name: `P${(i + 1).toString()}`,
      sequence: dna(int(420, 700), GG),
      circular: false,
    };
    const sequence = turned(
      cassette('BsaI', oa) + dna(int(60, 200), GG) + cassette('BsmBI', ob) + dna(int(300, 480), GG),
    );
    const rows = [
      [...rowFor('forward', 'p1', tpl, GG), '', '', ''],
      [...rowFor('reverse', 'p2', tpl, GG), 'BsmBI', '', ''],
      [...rowFor('whole', 'p3', tpl, GG), 'BsaI', '', ''],
      [...rowFor('bare', 'p4', tpl, GG), 'BsmBI', '', ''],
      [...rowFor('forward', 'p5', tpl, GG), 'BsaI/BsmBI', '', ''],
      [...rowFor('reverse', 'p6', tpl, GG), 'BsmBI/BsaI', '', ''],
    ];
    out.push({
      id: `golden-gate-per-row-enzyme-${(i + 1).toString()}`,
      kind: 'random',
      recipe: { recipe: 'golden-gate', enzyme: 'BsaI' },
      settings: {},
      vector: {
        name: `pdest${(i + 1).toString()}`,
        sequence: i === 0 ? sequence : reverseComplement(sequence),
        circular: true,
      },
      templates: [tpl],
      table: csv([HEADER_GG, ...rows]),
    });
  }
  // extra5/extra3 on the batch and `left`/`right` on the rows: the destination's own overhangs
  // given outright, a different pair (which no destination takes) and the pair swapped.
  for (let i = 0; i < 3; i++) {
    const enzyme = i === 1 ? 'BsmBI' : 'BsaI';
    const [o0, o1] = overhangPair();
    const other = overhangPair();
    const tpl: Tpl = {
      name: `X${(i + 1).toString()}`,
      sequence: dna(int(420, 700), GG),
      circular: false,
    };
    // The part starts on the destination's backbone-right overhang `o1` and ends on `o0`.
    const rows = [
      [...rowFor('forward', 'x1', tpl, GG), '', '', ''],
      [...rowFor('reverse', 'x2', tpl, GG), '', o1, o0],
      [...rowFor('whole', 'x3', tpl, GG), '', other[0], other[1]],
      [...rowFor('bare', 'x4', tpl, GG), '', o0, o1],
      [...rowFor('forward', 'x5', tpl, GG), '', o1, ''],
    ];
    out.push({
      id: `golden-gate-extra-bases-${enzyme.toLowerCase()}-${(i + 1).toString()}`,
      kind: 'random',
      recipe: { recipe: 'golden-gate', enzyme },
      settings: i === 2 ? { extra5: 'GCCACC' } : { extra5: 'GCC', extra3: 'TGAT' },
      vector: {
        name: `xdest${(i + 1).toString()}`,
        sequence: turned(cassette(enzyme, [o0, o1]) + dna(int(300, 480), GG)),
        circular: true,
      },
      templates: [tpl],
      table: csv([HEADER_GG, ...rows]),
    });
  }
  return out;
}

// ------------------------------------------------------------------ the tests

describe('Batch restriction, homology and Golden Gate extras against pydna and Biopython', () => {
  // Writes what batchrecipes.py judges: `scripts/oracle/run.sh batch-recipes`.
  it.skipIf(process.env['ORACLE_EXPORT_BATCH_RECIPES'] === undefined)(
    'exports our constructs',
    async () => {
      const path = process.env['ORACLE_EXPORT_BATCH_RECIPES'] ?? '';
      setActiveEnzymeSet(BUNDLED_ENZYME_SET);
      const exported = [];
      for (const input of generateInputs()) {
        const { out, bad } = await runBatch(input);
        const rows = out.rows.map((row) =>
          isDesigned(row)
            ? describeRow(row)
            : { name: row.name, status: 'failed', message: row.message },
        );
        exported.push({
          ...input,
          refused: out.refused,
          rowsNotRun: bad.length,
          overhangs: {
            left: out.vector.overhangs?.left ?? null,
            right: out.vector.overhangs?.right ?? null,
          },
          rows,
        });
      }
      writeFileSync(path, JSON.stringify({ seed: SEED, batches: exported }, null, 1) + '\n');
    },
    300_000,
  );

  it('has the dataset the oracle judged', () => {
    const rows = batches.flatMap((b) => b.rows);
    expect(batches.length).toBeGreaterThanOrEqual(25);
    expect(rows.length).toBeGreaterThanOrEqual(100);
    for (const recipe of [
      'restriction',
      'homology',
      'golden-gate',
    ] as const satisfies readonly Recipe[]) {
      expect(batches.some((b) => b.recipe.recipe === recipe)).toBe(true);
    }
    expect(batches[0]?.id).toBe('restriction-tutorial-ecori-bamhi');
    expect(batches.map((b) => b.id)).toContain('homology-tutorial-in-fusion');
  });

  it('refused every deliberately wrong construct, and accepted the right one turned', () => {
    const controls = oracle.controls;
    expect(controls.length).toBeGreaterThanOrEqual(10);
    expect(new Set(controls.map((c) => c.recipe))).toEqual(new Set(['restriction', 'homology']));
    for (const c of controls) expect(c.accepted).toBe(c.expectedAccepted);
  });

  it('covers both orientations, a cloning region across the origin, every kit and the refusals', () => {
    const rows = (recipe: Recipe) =>
      batches.filter((b) => b.recipe.recipe === recipe).flatMap((b) => b.rows);
    expect(new Set(rows('restriction').map((r) => r.oracle.orientation))).toEqual(
      new Set(['forward', 'reverse']),
    );
    const wraps = batches.filter(
      (b) =>
        b.recipe.recipe === 'restriction' &&
        b.recipe.region !== undefined &&
        b.recipe.region !== null &&
        b.recipe.region.end > b.vector.sequence.length,
    );
    expect(wraps.length).toBeGreaterThanOrEqual(2);
    expect(new Set(rows('homology').map((r) => r.oracle.overlap))).toEqual(
      new Set([15, 20, 30, 40, 60]),
    );
    const unbuilt = rows('golden-gate').filter((r) => !r.oracle.built);
    expect(unbuilt.length).toBeGreaterThanOrEqual(10);
    const tube = batches
      .filter((b) => b.recipe.recipe === 'golden-gate' && b.recipe.secondEnzyme !== undefined)
      .flatMap((b) => b.rows)
      .filter((r) => r.oracle.built);
    expect(tube.length).toBeGreaterThanOrEqual(6);
  });

  it('has the tutorial files the first batches were recorded on', () => {
    const first = batches[0];
    if (first === undefined) throw new Error('no batches');
    expect(first.vector.sequence).toHaveLength(2664);
    expect(first.templates[0]?.sequence).toHaveLength(702);
  });

  describe.each(batches.map((b) => [b.id, b] as const))('%s', (_id, batch) => {
    it('designs the recorded primers and constructs, and the oracle confirmed each', async () => {
      setActiveEnzymeSet(BUNDLED_ENZYME_SET);
      const { out, bad } = await runBatch(batch);
      expect(bad).toEqual([]);
      expect(out.refused).toBeNull();
      expect(out.rows.map((r) => r.name)).toEqual(batch.rows.map((r) => r.name));
      for (const [i, recorded] of batch.rows.entries()) {
        const row = out.rows[i];
        const where = `${batch.id} ${recorded.name}`;
        if (row === undefined || !isDesigned(row)) {
          throw new Error(`${where}: not designed any more`);
        }
        const now = describeRow(row);
        expect([where, now.forward]).toEqual([where, recorded.forward]);
        expect([where, now.reverse]).toEqual([where, recorded.reverse]);
        expect(now.warnings).toEqual(recorded.warnings);
        expect(now.amplicon).toHaveLength(recorded.amplicon.length);
        expect(sha256(now.amplicon)).toBe(recorded.amplicon.sha256);
        const verdict = recorded.oracle;
        expect(verdict.confirmed).toBe(true);
        expect(verdict.pcrProducts).toBe(1);
        if (recorded.construct === null) {
          // No circle: the oracle found a reason of its own (a site of the second enzyme on
          // the part, overhangs that are not the destination's).
          expect(row.product).toBeNull();
          expect(verdict.built).toBe(false);
          expect(verdict.reason).toBeTruthy();
          continue;
        }
        const construct = row.product?.sequence.toString() ?? '';
        expect(row.product?.isCircular).toBe(true);
        expect(construct).toHaveLength(recorded.construct.length);
        expect(construct.slice(0, recorded.construct.head.length).toUpperCase()).toBe(
          recorded.construct.head,
        );
        expect([where, sha256(construct)]).toEqual([where, recorded.construct.sha256]);
        expect(verdict.built).toBe(true);
        if (now.recipe === 'restriction') {
          expect(verdict.routes).toEqual(['pydna-cut-join', 'biopython-splice']);
          expect(verdict.orientation).toBe(now.orientation);
        } else if (now.recipe === 'homology') {
          expect(verdict.routes).toEqual(['pydna-assembly', 'sequence-join']);
        } else {
          expect(verdict.routes).toEqual(['pydna-cut-join', 'biopython-splice']);
        }
      }
    });
  });
});
