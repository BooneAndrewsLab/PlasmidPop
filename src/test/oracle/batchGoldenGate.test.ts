import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  type BatchTemplate,
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

import oracle from './batchGoldenGate.json';

/**
 * The Batch page's Golden Gate constructs, end to end, against pydna and
 * Biopython (scripts/oracle/batchgoldengate.py, item 143, issue #430). The
 * batch is run on the destinations, templates and rows recorded here with the
 * default settings; the Python oracle then took PlasmidPop's primers and
 * simulated each row without any of our code: the tailed PCR (pydna), the
 * digests of amplicon and destination (pydna `Dseqrecord.cut`), the ligation
 * (`+` and `looped()`, and `Assembly`), and a splice from Bio.Restriction's cut
 * coordinates alone. A row is recorded only when all three circles equal
 * PlasmidPop's construct up to rotation and strand, the product has no site of
 * the enzyme at the junctions, the overhangs read off the amplicon are the
 * destination's, and each primer's tail is padding, site, spacer and the
 * overhang. This test runs the batch again and requires the same primers,
 * amplicon and construct, so a change to the designer's output has to be
 * reviewed against the oracle (`scripts/oracle/run.sh batch-golden-gate`).
 */

const TUTORIALS = join(__dirname, '../../../docs/tutorials/files');
const inline = new AnalysisClient(null);

interface Tail {
  readonly sitesFound: number;
  readonly padding: number | null;
  readonly overhang: string | null;
}
interface RecordedRow {
  readonly name: string;
  readonly forward: string;
  readonly reverse: string;
  readonly paddings: readonly [number, number];
  readonly amplicon: { readonly length: number; readonly sha256: string };
  /** Null for a part the designer refuses to build because it carries a site of the enzyme. */
  readonly construct: {
    readonly length: number;
    readonly sha256: string;
    readonly head: string;
  } | null;
  readonly warnings: readonly string[];
  readonly oracle: {
    readonly confirmed: boolean;
    readonly built: boolean;
    readonly pcrProducts: number;
    readonly routes: readonly string[];
    readonly sitesOnAmplicon: number;
    readonly tails: readonly [Tail, Tail];
    readonly overhangs?: { readonly left: string; readonly right: string };
    readonly destinationOverhangs?: { readonly left: string; readonly right: string };
    readonly sitesInProduct?: number;
    readonly sitesAtJunctions?: number;
  };
}
interface RecordedBatch {
  readonly id: string;
  readonly kind: 'tutorial' | 'random';
  readonly enzyme: string;
  readonly destination: { readonly name: string; readonly sequence: string };
  readonly templates: readonly {
    readonly name: string;
    readonly sequence: string;
    readonly circular: boolean;
  }[];
  readonly table: string;
  readonly overhangs: { readonly left: string; readonly right: string };
  readonly rows: readonly RecordedRow[];
}

const batches = oracle.batches as unknown as readonly RecordedBatch[];

function sha256(text: string): string {
  return createHash('sha256').update(text.toUpperCase()).digest('hex');
}

/** What an input of the exporter is: everything the batch needs, nothing it produced. */
interface BatchInput {
  readonly id: string;
  readonly kind: 'tutorial' | 'random';
  readonly enzyme: string;
  readonly destination: { readonly name: string; readonly sequence: string };
  readonly templates: readonly {
    readonly name: string;
    readonly sequence: string;
    readonly circular: boolean;
  }[];
  readonly table: string;
}

async function runBatch(input: BatchInput) {
  const destination = SeqDocument.create({
    name: input.destination.name,
    sequence: input.destination.sequence,
    topology: 'circular',
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
    destination,
    { recipe: { recipe: 'golden-gate', enzyme: input.enzyme }, templates },
    { client: inline },
  );
  return { out, bad: validated.results.filter((r) => !r.ok) };
}

type Designed = Extract<CloningBatchRow, { status: 'designed'; recipe: 'golden-gate' }>;
const isDesigned = (r: CloningBatchRow): r is Designed =>
  r.status === 'designed' && r.recipe === 'golden-gate';

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

const SITES: Readonly<Record<string, string>> = { BsaI: 'GGTCTC', BsmBI: 'CGTCTC' };
const SEED = 20261108;

function generateInputs(): BatchInput[] {
  const rand = rng(SEED);
  const int = (lo: number, hi: number): number => lo + Math.floor(rand() * (hi - lo + 1));
  const pick = <T>(xs: readonly T[]): T => xs[int(0, xs.length - 1)] as T;
  const base = (): string => 'ACGT'.charAt(int(0, 3));
  const dna = (n: number): string => {
    // No site of either enzyme on either strand: a clean part, so the case tests the junctions.
    for (;;) {
      let s = '';
      for (let i = 0; i < n; i++) s += base();
      if (!Object.values(SITES).some((x) => s.includes(x) || s.includes(reverseComplement(x)))) {
        return s;
      }
    }
  };
  const overhangPair = (): [string, string] => {
    const one = (): string => {
      for (;;) {
        let s = '';
        for (let i = 0; i < 4; i++) s += base();
        if (s !== reverseComplement(s) && new Set(s).size >= 3) return s;
      }
    };
    for (;;) {
      const a = one();
      const b = one();
      const near = (x: string, y: string): number => {
        let n = 0;
        for (let i = 0; i < x.length; i++) if (x.charAt(i) !== y.charAt(i)) n++;
        return n;
      };
      if (near(a, b) >= 2 && near(a, reverseComplement(b)) >= 2) return [a, b];
    }
  };
  const csv = (rows: readonly (readonly string[])[]): string =>
    rows
      .map((r) => r.map((c) => (/[",]/.test(c) ? `"${c.replaceAll('"', '""')}"` : c)).join(','))
      .join('\n') + '\n';
  const HEADER = ['name', 'template', 'region', 'sequence', 'include_start', 'include_stop'];

  const out: BatchInput[] = [];

  // The tutorial's own files and rows (docs/tutorials/batch-primers.md, Exercise 4).
  const file = (name: string): string => {
    const doc = parseGenBank(readFileSync(join(TUTORIALS, `${name}.gb`), 'utf8')).documents[0];
    if (doc === undefined) throw new Error(`${name} has no record`);
    return doc.sequence.toString();
  };
  const MINI =
    'ATGTGTCGTAGAAACGGACGCCGCCCCCAGAGTGACGAAAACTCTCTTAGGAGCGCCTATGTACTTACTAACAGAGACAGCAGTCCGACTAGGGTGCAATGTGTCGCCGGTGGCATTTAA';
  out.push({
    id: 'tutorial-bsai',
    kind: 'tutorial',
    enzyme: 'BsaI',
    destination: { name: 'pGG-Destination', sequence: file('pGG-Destination') },
    templates: [{ name: 'GG-gene', sequence: file('GG-gene'), circular: false }],
    table: csv([
      HEADER,
      ['gene_full', 'GG-gene', '', '', '', ''],
      ['gene_head', 'GG-gene', '1-300', '', '', ''],
      ['mini', '', '', MINI, '', ''],
    ]),
  });

  // Random destinations: [overhang o1][A][site, reversed][dropout][site][A][overhang o0][backbone].
  const destination = (enzyme: string, overhangs: [string, string], turn = true): string => {
    const site = SITES[enzyme];
    if (site === undefined) throw new Error(`no site for ${enzyme}`);
    const [o0, o1] = overhangs;
    const full =
      o1 + 'A' + reverseComplement(site) + dna(int(60, 140)) + site + 'A' + o0 + dna(int(300, 480));
    const k = rand() < 0.5 ? 0 : int(1, full.length - 1);
    const turned = full.slice(k) + full.slice(0, k);
    // Read from the other strand, the destination's left and right overhangs swap places.
    return turn && rand() < 0.3 ? reverseComplement(turned) : turned;
  };

  /** A template and the rows on it; `kinds` picks what each row is. */
  type RowKind = 'forward' | 'reverse' | 'whole' | 'bare' | 'wrap-forward' | 'wrap-reverse';
  const rowFor = (
    kind: RowKind,
    name: string,
    template: { name: string; sequence: string; circular: boolean },
  ): string[] => {
    const n = template.sequence.length;
    const a = int(1, Math.floor(n / 3));
    const b = int(Math.floor((2 * n) / 3), n);
    switch (kind) {
      case 'forward':
        return [name, template.name, `${a}-${b}`, '', '', ''];
      case 'reverse':
        return [name, template.name, `complement(${a}..${b})`, '', '', ''];
      case 'whole':
        return [name, template.name, '', '', '', ''];
      case 'bare':
        return [name, '', '', dna(int(120, 360)), '', ''];
      case 'wrap-forward': {
        const s = int(Math.floor((2 * n) / 3), n - 40);
        const e = int(40, Math.floor(n / 3));
        return [name, template.name, `join(${s}..${n},1..${e})`, '', '', ''];
      }
      case 'wrap-reverse': {
        const s = int(Math.floor((2 * n) / 3), n - 40);
        const e = int(40, Math.floor(n / 3));
        return [name, template.name, `complement(join(${s}..${n},1..${e}))`, '', '', ''];
      }
    }
  };

  const plain: readonly RowKind[][] = [
    ['forward', 'reverse', 'whole'],
    ['forward', 'bare', 'reverse'],
    ['reverse', 'reverse', 'forward'],
    ['whole', 'bare'],
    ['forward', 'reverse', 'bare', 'whole'],
    ['reverse', 'forward', 'forward'],
  ];
  for (let i = 0; i < 6; i++) {
    const enzyme = i % 3 === 2 ? 'BsmBI' : 'BsaI';
    const tpl = { name: `T${(i + 1).toString()}`, sequence: dna(int(380, 800)), circular: false };
    out.push({
      id: `random-${enzyme.toLowerCase()}-linear-${(i + 1).toString()}`,
      kind: 'random',
      enzyme,
      destination: {
        name: `dest${(i + 1).toString()}`,
        sequence: destination(enzyme, overhangPair()),
      },
      templates: [tpl],
      table: csv([
        HEADER,
        ...(plain[i] as readonly RowKind[]).map((k, j) => rowFor(k, `r${(j + 1).toString()}`, tpl)),
      ]),
    });
  }
  // Circular templates: a region that runs across the origin, on each strand.
  for (let i = 0; i < 4; i++) {
    const enzyme = i % 2 === 1 ? 'BsmBI' : 'BsaI';
    const tpl = { name: `C${(i + 1).toString()}`, sequence: dna(int(420, 700)), circular: true };
    const kinds: RowKind[] = i < 2 ? ['wrap-forward', 'wrap-reverse'] : ['wrap-reverse', 'forward'];
    out.push({
      id: `random-${enzyme.toLowerCase()}-circular-${(i + 1).toString()}`,
      kind: 'random',
      enzyme,
      destination: {
        name: `cdest${(i + 1).toString()}`,
        sequence: destination(enzyme, overhangPair()),
      },
      templates: [tpl],
      table: csv([HEADER, ...kinds.map((k, j) => rowFor(k, `c${(j + 1).toString()}`, tpl))]),
    });
  }
  // A destination with the MoClo CDS overhangs, AATG and GCTT, so that the part's own start
  // codon and stop codon are spelt by an overhang: the designer leaves those bases to the
  // overhang rather than writing them twice.
  for (let i = 0; i < 3; i++) {
    const enzyme = i === 2 ? 'BsmBI' : 'BsaI';
    const cds = (): string => 'ATG' + dna(3 * int(60, 130)) + pick(['TAA', 'TAG', 'TGA']);
    const tpl = { name: `G${(i + 1).toString()}`, sequence: cds(), circular: false };
    const n = tpl.sequence.length;
    out.push({
      id: `random-${enzyme.toLowerCase()}-moclo-cds-${(i + 1).toString()}`,
      kind: 'random',
      enzyme,
      destination: {
        name: `mdest${(i + 1).toString()}`,
        sequence: destination(enzyme, ['GCTT', 'AATG'], false),
      },
      templates: [tpl],
      table: csv([
        HEADER,
        ['whole', tpl.name, `1-${n.toString()}`, '', '', ''],
        ['keep_stop', tpl.name, `1-${n.toString()}`, '', 'yes', 'yes'],
        ['no_start', tpl.name, `1-${n.toString()}`, '', 'no', 'no'],
        ['no_stop', tpl.name, `1-${n.toString()}`, '', 'yes', 'no'],
        ['reverse_cds', tpl.name, `complement(1..${n.toString()})`, '', '', ''],
      ]),
    });
  }
  // A part that already begins with the destination's left overhang and ends with its right one.
  {
    const o: [string, string] = ['TGAC', 'CCTA'];
    const body = dna(300);
    out.push({
      id: 'random-bsai-fusion-sites-in-part',
      kind: 'random',
      enzyme: 'BsaI',
      destination: { name: 'fdest', sequence: destination('BsaI', o, false) },
      templates: [
        { name: 'F1', sequence: dna(40) + 'CCTA' + body + 'TGAC' + dna(40), circular: false },
      ],
      table: csv([
        HEADER,
        ['fused', 'F1', '41-348', '', '', ''],
        ['plain', 'F1', '60-330', '', '', ''],
      ]),
    });
  }
  return out;
}

// ------------------------------------------------------------------ the tests

describe('Batch Golden Gate constructs against pydna and Biopython', () => {
  // Writes what batchgoldengate.py judges: `scripts/oracle/run.sh batch-golden-gate`.
  it.skipIf(process.env['ORACLE_EXPORT_BATCH_GG'] === undefined)(
    'exports our constructs',
    async () => {
      const path = process.env['ORACLE_EXPORT_BATCH_GG'] ?? '';
      setActiveEnzymeSet(BUNDLED_ENZYME_SET);
      const exported = [];
      for (const input of generateInputs()) {
        const { out, bad } = await runBatch(input);
        const rows = out.rows.map((row) => {
          if (!isDesigned(row)) {
            return {
              name: row.name,
              status: 'failed',
              message: 'message' in row ? row.message : '',
            };
          }
          const { design } = row;
          return {
            name: row.name,
            status: 'designed',
            forward: design.forward.sequence,
            reverse: design.reverse.sequence,
            segments: [design.forward.segments, design.reverse.segments],
            enzyme: design.forward.enzyme,
            left: design.left,
            right: design.right,
            amplicon: design.amplicon,
            construct: row.product?.sequence.toString() ?? null,
            constructCircular: row.product?.isCircular ?? null,
            warnings: design.warnings.map((w) => w.kind),
          };
        });
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
    expect(batches.length).toBeGreaterThanOrEqual(14);
    expect(batches.flatMap((b) => b.rows).length).toBeGreaterThanOrEqual(40);
    expect(new Set(batches.map((b) => b.enzyme))).toEqual(new Set(['BsaI', 'BsmBI']));
    expect(batches[0]?.id).toBe('tutorial-bsai');
    expect(batches[0]?.rows.map((r) => r.name)).toEqual(['gene_full', 'gene_head', 'mini']);
  });

  it('refused every deliberately wrong construct, and accepted the right one turned', () => {
    const controls = oracle.controls;
    expect(controls.length).toBeGreaterThanOrEqual(4);
    for (const c of controls) expect(c.accepted).toBe(c.expectedAccepted);
  });

  it('covers the overhangs a part spells itself: a start codon, a stop codon, a fusion site', async () => {
    setActiveEnzymeSet(BUNDLED_ENZYME_SET);
    const overlaps: Record<string, { left: number; right: number }> = {};
    for (const id of ['random-bsai-moclo-cds-1', 'random-bsai-fusion-sites-in-part']) {
      const batch = batches.find((b) => b.id === id);
      if (batch === undefined) throw new Error(`no batch ${id}`);
      const { out } = await runBatch(batch);
      for (const row of out.rows)
        if (isDesigned(row)) overlaps[`${id} ${row.name}`] = row.design.overlap;
    }
    expect(overlaps['random-bsai-moclo-cds-1 whole']).toEqual({ left: 3, right: 0 });
    expect(overlaps['random-bsai-moclo-cds-1 no_start']).toEqual({ left: 0, right: 0 });
    expect(overlaps['random-bsai-fusion-sites-in-part fused']).toEqual({ left: 4, right: 4 });
    expect(overlaps['random-bsai-fusion-sites-in-part plain']).toEqual({ left: 0, right: 0 });
  });

  it('has the tutorial files the first batch was recorded on', () => {
    const first = batches[0];
    if (first === undefined) throw new Error('no batches');
    expect(first.destination.sequence).toHaveLength(2647);
    expect(first.templates[0]?.sequence).toHaveLength(702);
  });

  describe.each(batches.map((b) => [b.id, b] as const))('%s', (_id, batch) => {
    it('designs the recorded primers and constructs, and the oracle confirmed each', async () => {
      setActiveEnzymeSet(BUNDLED_ENZYME_SET);
      const { out, bad } = await runBatch(batch);
      expect(bad).toEqual([]);
      expect(out.refused).toBeNull();
      expect({ left: out.vector.overhangs?.left, right: out.vector.overhangs?.right }).toEqual(
        batch.overhangs,
      );
      expect(out.rows.map((r) => r.name)).toEqual(batch.rows.map((r) => r.name));
      for (const [i, recorded] of batch.rows.entries()) {
        const row = out.rows[i];
        if (row === undefined || !isDesigned(row)) {
          throw new Error(`${batch.id} ${recorded.name}: not designed any more`);
        }
        const { design } = row;
        const where = `${batch.id} ${recorded.name}`;
        expect([where, design.forward.sequence]).toEqual([where, recorded.forward]);
        expect([where, design.reverse.sequence]).toEqual([where, recorded.reverse]);
        expect(design.warnings.map((w) => w.kind)).toEqual(recorded.warnings);
        expect([
          design.forward.segments.padding.length,
          design.reverse.segments.padding.length,
        ]).toEqual(recorded.paddings);
        expect(design.amplicon).toHaveLength(recorded.amplicon.length);
        expect(sha256(design.amplicon)).toBe(recorded.amplicon.sha256);
        const verdict = recorded.oracle;
        expect(verdict.confirmed).toBe(true);
        expect(verdict.pcrProducts).toBe(1);
        if (recorded.construct === null) {
          // A part with a site of the enzyme of its own: no circle, and Biopython finds more
          // than the two sites the tails write on the amplicon.
          expect(row.product).toBeNull();
          expect(verdict.built).toBe(false);
          expect(verdict.sitesOnAmplicon).toBeGreaterThan(2);
          expect(design.warnings.map((w) => w.kind)).toContain('internalSite');
          continue;
        }
        const construct = row.product?.sequence.toString() ?? '';
        expect(row.product?.isCircular).toBe(true);
        expect(construct).toHaveLength(recorded.construct.length);
        expect(construct.slice(0, recorded.construct.head.length).toUpperCase()).toBe(
          recorded.construct.head,
        );
        expect([where, sha256(construct)]).toEqual([where, recorded.construct.sha256]);

        // What the oracle established about the circle PlasmidPop made: three constructions
        // agree with it, no site of the enzyme is in it, the overhangs are the destination's.
        expect(verdict.built).toBe(true);
        expect(verdict.routes).toEqual(['pydna-cut-join', 'biopython-splice']);
        expect(verdict.sitesOnAmplicon).toBe(2);
        expect(verdict.sitesInProduct).toBe(0);
        expect(verdict.sitesAtJunctions).toBe(0);
        expect(verdict.overhangs).toEqual({ left: design.left, right: design.right });
        expect(verdict.tails.map((t) => t.sitesFound)).toEqual([1, 1]);
        expect(verdict.tails.map((t) => t.padding)).toEqual(recorded.paddings);
        expect(verdict.tails[0].overhang).toBe(design.left);
        expect(verdict.tails[1].overhang).toBe(reverseComplement(design.right));
        // The destination's own overhangs, as Bio.Restriction reads them, are the pair
        // the batch announces once, one way round or the other.
        const dest = verdict.destinationOverhangs;
        expect([
          `${dest?.left ?? ''}/${dest?.right ?? ''}`,
          `${reverseComplement(dest?.right ?? '')}/${reverseComplement(dest?.left ?? '')}`,
        ]).toContain(`${design.left}/${design.right}`);
      }
    });
  });
});
