import fc from 'fast-check';

import {
  type CutSite,
  type EditOp,
  type Enzyme,
  type HostMethylation,
  type HostMethylationState,
  DAM_DCM_SENSITIVE,
  ENZYMES,
  History,
  METHYLATED_HOST,
  SeqDocument,
  UNMETHYLATED_HOST,
  blockedByHost,
  createFeature,
  cuttableSites,
  describeHost,
  digest,
  documentFromFragment,
  extractRange,
  findCutSites,
  fragmentFromRange,
  gateway,
  getEnzyme,
  hostMethylationAt,
  isHostMethylationSensitive,
  ligate,
  methylationEqual,
  partialDigest,
  pcr,
  rangeSegment,
  reverseComplement,
} from '@/core';
import { docShapeArb, layFeatures, opShapeArb, resolveOp } from '@/test/editArbitraries';
import { randomDna, seededRandom } from '@/test/random';

/**
 * Host methylation, exhaustively (#45, item 44).
 *
 * Two halves are kept apart by design: `hostMethylationAt` says what Dam
 * (GATC) or Dcm (CCWGG) methylation would sit inside a site — a property
 * of the sequence — and `cuttableSites` says which sites a digest of *this*
 * DNA cuts, given where it was grown. Both are checked against oracles
 * written here without the code under test: a naive scan of the whole
 * sequence for every motif and its methylated bases, and the rule "a site
 * is dropped iff it carries Dam and the host is dam+, or Dcm and dcm+".
 *
 * The enumeration takes every enzyme of the bundled table NEB lists as
 * sensitive, writes its site out (each ambiguity code resolved two ways),
 * and lays a GATC, CCAGG or CCTGG over and beside it at every offset, on a
 * line and across the origin of a circle — so motifs inside the site, made
 * with the flank, and just clear of it all come up — then runs all four
 * hosts. Insensitive enzymes are never dropped, whatever sits in them, and
 * an unmethylated host keeps everything. A property repeats the check on
 * random sequences with every enzyme at once.
 *
 * Then the document side: `SeqDocument.methylation`'s default, the
 * `setMethylation` edit (identity when nothing changes, undo and redo),
 * that no other edit touches it, and what derived documents carry.
 */

const HOSTS: readonly HostMethylationState[] = [
  { dam: true, dcm: true },
  { dam: true, dcm: false },
  { dam: false, dcm: true },
  { dam: false, dcm: false },
];

const EXPAND: Readonly<Record<string, string>> = {
  A: 'A',
  C: 'C',
  G: 'G',
  T: 'T',
  R: 'AG',
  Y: 'CT',
  S: 'CG',
  W: 'AT',
  K: 'GT',
  M: 'AC',
  B: 'CGT',
  D: 'AGT',
  H: 'ACT',
  V: 'ACG',
  N: 'ACGT',
};

/** A concrete instance of an IUPAC site: each code as its first (or last) meaning. */
function concrete(site: string, last: boolean): string {
  let out = '';
  for (let i = 0; i < site.length; i++) {
    const c = site.charAt(i).toUpperCase();
    const options = EXPAND[c] ?? c;
    out += last ? options.charAt(options.length - 1) : options.charAt(0);
  }
  return out;
}

const siteLength = (name: string): number => getEnzyme(name)?.site.length ?? 0;

/**
 * The oracle for `hostMethylationAt`: every GATC and CCWGG anywhere in the
 * molecule (read round the origin of a circle), and whether one of its
 * methylated bases — the As of GATC, the internal Cs of CCWGG on either
 * strand — is one of the site's own bases.
 */
function naiveMarks(
  sequence: string,
  topology: 'linear' | 'circular',
  enzyme: string,
  siteStart: number,
  length: number,
): HostMethylation[] {
  if (!DAM_DCM_SENSITIVE.has(enzyme.toLowerCase())) return [];
  const S = sequence.toUpperCase();
  const L = S.length;
  const circular = topology === 'circular';
  const mod = (i: number) => ((i % L) + L) % L;
  const site = new Set<number>();
  for (let i = 0; i < length; i++) site.add(circular ? mod(siteStart + i) : siteStart + i);
  const read = (i: number, n: number): string => {
    let out = '';
    for (let k = 0; k < n; k++) out += circular ? S.charAt(mod(i + k)) : S.charAt(i + k);
    return out;
  };
  const hit = (test: (text: string) => boolean, n: number, methylated: readonly number[]) => {
    const last = circular ? L - 1 : L - n;
    for (let i = 0; i <= last; i++) {
      if (!test(read(i, n))) continue;
      if (methylated.some((k) => site.has(circular ? mod(i + k) : i + k))) return true;
    }
    return false;
  };
  const out: HostMethylation[] = [];
  if (hit((t) => t === 'GATC', 4, [1, 2])) out.push('Dam');
  if (hit((t) => t === 'CCAGG' || t === 'CCTGG', 5, [1, 3])) out.push('Dcm');
  return out;
}

/** The rule itself: dropped iff a mark the host puts there is inside. */
const oracleKeeps = (state: HostMethylationState, marks: readonly HostMethylation[]): boolean =>
  !(marks.includes('Dam') && state.dam) && !(marks.includes('Dcm') && state.dcm);

// Split in each test that needs them, not while the file loads, so mutation
// testing can tell which test asked (#77).
const sensitive = (): Enzyme[] => ENZYMES.filter((e) => isHostMethylationSensitive(e.name));
const insensitive = (): Enzyme[] => ENZYMES.filter((e) => !isHostMethylationSensitive(e.name));
const MOTIFS = ['GATC', 'CCAGG', 'CCTGG'] as const;

interface Case {
  readonly enzyme: Enzyme;
  readonly sequence: string;
  readonly topology: 'linear' | 'circular';
}

/**
 * Every placement for one enzyme: its site in a seeded flank, with each
 * motif written over it at every offset from just before to just after,
 * plus the site alone; each on a line and rotated across a circle's origin.
 */
function casesFor(enzyme: Enzyme, seed: number): Case[] {
  const out: Case[] = [];
  const rand = seededRandom(seed);
  const flank = 20;
  for (const last of [false, true]) {
    const site = concrete(enzyme.site, last);
    const base = randomDna(rand, flank) + site + randomDna(rand, flank);
    const variants = [base];
    for (const motif of MOTIFS) {
      for (let o = -motif.length - 1; o <= site.length + 1; o++) {
        const at = flank + o;
        variants.push(base.slice(0, at) + motif + base.slice(at + motif.length));
      }
    }
    for (const sequence of variants) {
      out.push({ enzyme, sequence, topology: 'linear' });
      const k = flank + Math.floor(site.length / 2);
      out.push({
        enzyme,
        sequence: sequence.slice(k) + sequence.slice(0, k),
        topology: 'circular',
      });
    }
  }
  return out;
}

describe('which sites cut, for every sensitive enzyme and every host', () => {
  it('has the table’s sensitive enzymes to test', () => {
    // Most of NEB's list is in the bundled table; this is the enumeration's floor.
    expect(sensitive().length).toBeGreaterThanOrEqual(20);
  });

  it('marks as the naive scan does, and keeps a site iff its host leaves it open', () => {
    const tally = { dropped: 0, keptSensitive: 0, marked: new Set<string>() };
    sensitive().forEach((enzyme, n) => {
      for (const c of casesFor(enzyme, 1000 + n)) {
        const sites = findCutSites(c.sequence, c.topology, [enzyme]);
        for (const site of sites) {
          const marks = hostMethylationAt(c.sequence, c.topology, site, enzyme.site.length);
          expect(marks, `${enzyme.name} in ${c.sequence} (${c.topology})`).toEqual(
            naiveMarks(c.sequence, c.topology, enzyme.name, site.siteStart, enzyme.site.length),
          );
          for (const m of marks) tally.marked.add(m);
        }
        for (const state of HOSTS) {
          const kept = cuttableSites(c.sequence, c.topology, state, sites, siteLength);
          const want = sites.filter((s) =>
            oracleKeeps(state, hostMethylationAt(c.sequence, c.topology, s, enzyme.site.length)),
          );
          expect(kept, `${enzyme.name} ${describeHost(state)} in ${c.sequence}`).toEqual(want);
          if (state.dam || state.dcm) {
            tally.dropped += sites.length - kept.length;
            tally.keptSensitive += kept.length;
          }
        }
      }
    });
    // The enumeration really does reach both outcomes and both methylases.
    expect(tally.dropped).toBeGreaterThan(100);
    expect(tally.keptSensitive).toBeGreaterThan(100);
    expect([...tally.marked].sort()).toEqual(['Dam', 'Dcm']);
  });

  it('never drops an enzyme NEB does not list, whatever methylation sits in its site', () => {
    insensitive().forEach((enzyme, n) => {
      for (const c of casesFor(enzyme, 5000 + n).filter((_, i) => i % 3 === 0)) {
        const sites = findCutSites(c.sequence, c.topology, [enzyme]);
        for (const s of sites) {
          expect(hostMethylationAt(c.sequence, c.topology, s, enzyme.site.length)).toEqual([]);
        }
        expect(cuttableSites(c.sequence, c.topology, METHYLATED_HOST, sites, siteLength)).toEqual(
          sites,
        );
      }
    });
  });

  it('keeps every site, as a fresh list, for DNA with no methylation', () => {
    const sequence = `GATCTAGACCTGGCCAGGCCTAATCGATC${'ACGT'.repeat(10)}`;
    for (const topology of ['linear', 'circular'] as const) {
      const sites = findCutSites(sequence, topology, ENZYMES);
      const kept = cuttableSites(sequence, topology, UNMETHYLATED_HOST, sites, siteLength);
      expect(kept).toEqual(sites);
      expect(kept).not.toBe(sites);
      // And an ordinary strain does drop some of them: the test means something.
      expect(
        cuttableSites(sequence, topology, METHYLATED_HOST, sites, siteLength).length,
      ).toBeLessThan(sites.length);
    }
  });

  it('agrees with the oracles on random sequences, every enzyme at once', () => {
    const base = fc.constantFrom(...'ACGTACGTACGTacgtN'.split(''));
    fc.assert(
      fc.property(
        fc.string({ unit: base, minLength: 30, maxLength: 400 }),
        fc.constantFrom<'linear' | 'circular'>('linear', 'circular'),
        fc.constantFrom(...HOSTS),
        (sequence, topology, state) => {
          const sites = findCutSites(sequence, topology, ENZYMES);
          const kept = cuttableSites(sequence, topology, state, sites, siteLength);
          const want = sites.filter((s) =>
            oracleKeeps(
              state,
              naiveMarks(sequence, topology, s.enzyme, s.siteStart, siteLength(s.enzyme)),
            ),
          );
          expect(kept).toEqual(want);
        },
      ),
      { numRuns: 120 },
    );
  }, 15_000);
});

describe('blockedByHost and describeHost', () => {
  const MARKS: readonly (readonly HostMethylation[])[] = [
    [],
    ['Dam'],
    ['Dcm'],
    ['Dam', 'Dcm'],
    ['Dcm', 'Dam'],
    ['Dam', 'Dam'],
  ];

  it('blocks iff one of the marks is a methylase the host has, for every host and set of marks', () => {
    for (const state of HOSTS) {
      for (const marks of MARKS) {
        expect(blockedByHost(state, marks), `${describeHost(state)} ${marks.join('+')}`).toBe(
          (marks.includes('Dam') && state.dam) || (marks.includes('Dcm') && state.dcm),
        );
      }
    }
  });

  it('names each host once, the way the Enzymes tab offers it', () => {
    expect(HOSTS.map(describeHost)).toEqual([
      'dam+/dcm+',
      'dam+ only',
      'dcm+ only',
      'unmethylated',
    ]);
    expect(describeHost(METHYLATED_HOST)).toBe('dam+/dcm+');
    expect(describeHost(UNMETHYLATED_HOST)).toBe('unmethylated');
  });

  it('compares hosts by value', () => {
    for (const a of HOSTS) {
      for (const b of HOSTS) {
        expect(methylationEqual(a, { ...b })).toBe(a.dam === b.dam && a.dcm === b.dcm);
      }
    }
  });

  it('reads a site straddling the origin of a circle as the scan does', () => {
    // MboI's GATC split across the origin, one base per end at the extremes.
    for (let k = 0; k <= 4; k++) {
      const line = `GATC${'T'.repeat(30)}`;
      const circle = line.slice(k) + line.slice(0, k);
      const sites = findCutSites(circle, 'circular', [must(getEnzyme('MboI'), 'MboI')]);
      expect(sites).toHaveLength(1);
      const [site] = sites as [CutSite];
      expect(hostMethylationAt(circle, 'circular', site, 4)).toEqual(['Dam']);
      expect(cuttableSites(circle, 'circular', METHYLATED_HOST, sites, siteLength)).toEqual([]);
    }
  });
});

// --------------------------------------------------------------- documents

function must<T>(value: T | null | undefined, what: string): T {
  if (value === null || value === undefined) throw new Error(`expected ${what}`);
  return value;
}

const TEXT = `ATGGATCCAAGCTTCCTGGCCAGAATTC${'ACGT'.repeat(12)}`;

function plasmid(methylation?: HostMethylationState): SeqDocument {
  return SeqDocument.create({
    name: 'pMeth',
    sequence: TEXT,
    topology: 'circular',
    features: [createFeature({ id: 'f1', type: 'CDS', segments: [rangeSegment(0, 12)] })],
    ...(methylation === undefined ? {} : { methylation }),
  });
}

describe('SeqDocument.methylation', () => {
  it('is an ordinary laboratory strain unless said otherwise', () => {
    expect(plasmid().methylation).toEqual(METHYLATED_HOST);
    expect(SeqDocument.create({ sequence: '' }).methylation).toEqual(METHYLATED_HOST);
    for (const state of HOSTS) expect(plasmid(state).methylation).toEqual(state);
  });

  it('is left alone, as the same document, when set to what it already is', () => {
    for (const state of HOSTS) {
      const doc = plasmid(state);
      expect(doc.setMethylation({ ...state })).toBe(doc);
      expect(doc.apply({ type: 'setMethylation', methylation: { ...state } })).toBe(doc);
    }
  });

  it('changes nothing else when set to another host, by method or as an edit', () => {
    for (const from of HOSTS) {
      for (const to of HOSTS) {
        if (methylationEqual(from, to)) continue;
        const doc = plasmid(from);
        for (const next of [
          doc.setMethylation(to),
          doc.apply({ type: 'setMethylation', methylation: to }),
        ]) {
          expect(next).not.toBe(doc);
          expect(next.methylation).toEqual(to);
          expect(next.sequence).toBe(doc.sequence);
          expect(next.features).toBe(doc.features);
          expect(next.name).toBe(doc.name);
          expect(next.topology).toBe(doc.topology);
          expect(next.metadata).toBe(doc.metadata);
          expect(next.ends).toBe(doc.ends);
          // The original is untouched.
          expect(doc.methylation).toEqual(from);
        }
      }
    }
  });

  it('is undone and redone like any edit', () => {
    let doc = plasmid();
    let history = History.create(doc);
    const path = [HOSTS[3], HOSTS[1], HOSTS[2], HOSTS[0], HOSTS[3]].map((h) => must(h, 'a host'));
    for (const state of path) {
      doc = doc.apply({ type: 'setMethylation', methylation: state });
      history = history.push(doc, 'Set the host methylation');
    }
    const seen = [METHYLATED_HOST, ...path];
    for (let i = seen.length - 1; i > 0; i--) {
      expect(history.present.methylation).toEqual(seen[i]);
      history = history.undo();
    }
    expect(history.present.methylation).toEqual(METHYLATED_HOST);
    for (let i = 1; i < seen.length; i++) {
      history = history.redo();
      expect(history.present.methylation).toEqual(seen[i]);
    }
  });

  it('survives every other kind of edit', () => {
    const sticky = (state: HostMethylationState) =>
      SeqDocument.create({
        name: 'frag',
        sequence: TEXT,
        topology: 'linear',
        methylation: state,
        ends: {
          left: { kind: "5'", overhang: 'AATT', enzyme: 'EcoRI' },
          right: { kind: "3'", overhang: 'TGCA', enzyme: 'PstI' },
        },
      });
    for (const state of HOSTS) {
      const circle = plasmid(state);
      const line = sticky(state);
      const ops: [SeqDocument, EditOp][] = [
        [circle, { type: 'insert', position: 3, text: 'GATC' }],
        [circle, { type: 'delete', range: { start: 2, end: 10 } }],
        [circle, { type: 'delete', range: { start: 60, end: 70 } }],
        [circle, { type: 'replace', range: { start: 4, end: 8 }, text: 'CCAGG' }],
        [
          circle,
          {
            type: 'insertFragment',
            range: { start: 5, end: 5 },
            fragment: fragmentFromRange(circle, { start: 0, end: 12 }),
          },
        ],
        [circle, { type: 'reverseComplement' }],
        [line, { type: 'reverseComplement' }],
        [circle, { type: 'setOrigin', position: 17 }],
        [circle, { type: 'setTopology', topology: 'linear' }],
        [line, { type: 'setTopology', topology: 'circular' }],
        [line, { type: 'setEnds', ends: null }],
        [line, { type: 'bluntEnds', method: 'fill' }],
        [line, { type: 'bluntEnds', method: 'trim' }],
        [circle, { type: 'rename', name: 'pRenamed' }],
        [circle, { type: 'setMetadata', patch: { description: 'changed' } }],
        [
          circle,
          {
            type: 'addFeature',
            feature: createFeature({ type: 'gene', segments: [rangeSegment(20, 30)] }),
          },
        ],
        [circle, { type: 'updateFeature', id: 'f1', patch: { name: 'renamed' } }],
        [circle, { type: 'removeFeature', id: 'f1' }],
      ];
      for (const [doc, op] of ops) {
        expect(doc.apply(op).methylation, `${op.type} on ${describeHost(state)}`).toEqual(state);
      }
    }
  });

  it('survives random editing sessions, whatever the host', () => {
    fc.assert(
      fc.property(
        docShapeArb,
        fc.array(opShapeArb, { maxLength: 15 }),
        fc.constantFrom(...HOSTS),
        (shape, ops, state) => {
          let doc = SeqDocument.create({
            sequence: shape.sequence,
            topology: shape.topology,
            features: layFeatures(shape),
            methylation: state,
          });
          for (const opShape of ops) {
            const op = resolveOp(doc, opShape);
            if (op === null) continue;
            doc = doc.apply(op);
            expect(doc.methylation).toEqual(state);
          }
        },
      ),
      { numRuns: 100 },
    );
  }, 15_000);
});

/**
 * What a document made from another carries. The rule the code follows is
 * "a new molecule is a plasmid unless it was made in a tube": a PCR
 * product is unmethylated, and everything built with `SeqDocument.create`
 * — a ligation, a Gateway clone, an extracted region, an opened digest
 * fragment — starts from the dam+/dcm+ default rather than inheriting.
 * For ligation and recombination products that is right (they are
 * transformed and grown). For an extracted region or an opened fragment
 * of unmethylated DNA it is questionable (reported, not changed): the
 * bases are the same DNA, and a digest of the new document will leave out
 * sites the tube would cut.
 */
describe('methylation of derived documents', () => {
  const pcrTemplate = SeqDocument.create({
    name: 'template',
    sequence: randomDna(seededRandom(7), 600),
    topology: 'linear',
  });

  it('is none for a PCR product, whatever the template was grown in', () => {
    const text = pcrTemplate.sequence.toString();
    for (const state of HOSTS) {
      const result = pcr(pcrTemplate.setMethylation(state), [
        { name: 'F', sequence: text.slice(100, 122) },
        { name: 'R', sequence: reverseComplement(text.slice(400, 422)) },
      ]);
      expect(result.problem).toBeNull();
      const product = must(result.products[0], 'a product');
      expect(product.document.methylation).toEqual(UNMETHYLATED_HOST);
    }
  });

  it('is an ordinary strain for a ligation product, whatever the fragments came from', () => {
    for (const state of HOSTS) {
      const doc = plasmid(state);
      const ecoRI = must(getEnzyme('EcoRI'), 'EcoRI');
      const pieces = digest(doc, findCutSites(doc.sequence.toString(), 'circular', [ecoRI]));
      expect(pieces).toHaveLength(1);
      const circle = ligate(pieces, { name: 'religated', circular: true });
      expect(circle.methylation).toEqual(METHYLATED_HOST);
    }
  });

  it('is an ordinary strain for a Gateway clone and its byproduct', () => {
    const core = 'ACGTTGACCATGGCA';
    const site = (arms: string, n: number) =>
      arms.slice(0, 8) + core.slice(0, 8 + n) + arms.slice(8);
    const make = (kind: string, arms: string, state: HostMethylationState) => {
      const one = site(arms, 0);
      const two = site(arms, 2);
      const middle = randomDna(seededRandom(kind.charCodeAt(0)), 80);
      return SeqDocument.create({
        name: `p${kind}`,
        topology: 'circular',
        methylation: state,
        sequence: one + middle + two + randomDna(seededRandom(9), 100),
        features: [
          createFeature({
            type: 'x',
            name: `att${kind}1`,
            segments: [rangeSegment(0, one.length)],
          }),
          createFeature({
            type: 'x',
            name: `att${kind}2`,
            segments: [
              rangeSegment(one.length + middle.length, one.length + middle.length + two.length),
            ],
          }),
        ],
      });
    };
    // Cores 8 and 10 bases long, with arms that share nothing across partners.
    for (const state of HOSTS) {
      const run = gateway(
        make('B', 'CACACCAAACCACAAC', state),
        make('P', 'GTGTTGGTTGGTGTGT', state),
        'BP',
      );
      expect(run.problem).toBeNull();
      expect(must(run.product, 'a product').methylation).toEqual(METHYLATED_HOST);
      expect(must(run.byproduct, 'a byproduct').methylation).toEqual(METHYLATED_HOST);
    }
  });

  it('keeps the source’s methylation for an extracted region, a fragment, and a fragment opened', () => {
    const ecoRI = must(getEnzyme('EcoRI'), 'EcoRI');
    for (const host of HOSTS) {
      const source = SeqDocument.create({
        name: 'source',
        sequence: TEXT,
        topology: 'linear',
        methylation: host,
      });
      // A stretch of a molecule is that molecule's DNA, methylated as it was.
      expect(extractRange(source, { start: 2, end: 30 }).methylation).toEqual(host);
      for (const piece of digest(source, findCutSites(TEXT, 'linear', [ecoRI]))) {
        expect(piece.methylation).toEqual(host);
        expect(documentFromFragment(piece).methylation).toEqual(host);
      }
      for (const piece of partialDigest(source, findCutSites(TEXT, 'linear', [ecoRI]))) {
        expect(piece.methylation).toEqual(host);
      }
    }
  });

  it('gives a ligation of several pieces an ordinary strain: it is what gets grown', () => {
    const ecoRI = must(getEnzyme('EcoRI'), 'EcoRI');
    const product = SeqDocument.create({
      name: 'amplicon',
      sequence: TEXT,
      topology: 'linear',
      methylation: UNMETHYLATED_HOST,
    });
    const pieces = digest(product, findCutSites(TEXT, 'linear', [ecoRI]));
    if (pieces.length < 2) return;
    expect(ligate(pieces, { name: 'joined', circular: false }).methylation).toEqual(
      METHYLATED_HOST,
    );
  });
});
