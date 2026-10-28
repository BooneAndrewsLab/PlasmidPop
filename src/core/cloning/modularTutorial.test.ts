import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  type Enzyme,
  type SeqDocument,
  type PlanSlot,
  BUNDLED_ENZYME_SET,
  BUNDLED_STANDARDS,
  METHYLATED_HOST,
  UNMETHYLATED_HOST,
  activeEnzymes,
  cuttableSites,
  detectPlacement,
  findCutSites,
  getEnzyme,
  goldenGateEnzymes,
  goldenGateFragments,
  goldenGateSeed,
  placementEnds,
  planAssemblies,
  recordGoldenGate,
  setActiveEnzymeSet,
  translate,
} from '@/core';
import { parseGenBank } from '@/io/genbank/parseGenBank';
import { writeGenBank } from '@/io/genbank/writeGenBank';

import { resolveSeed } from './index';

/**
 * Verifies docs/tutorials/modular.md: the MoClo plant common syntax, four
 * level-0 parts into a level-1 destination, then two promoters by two coding
 * parts. Every number the page prints is asserted here through the functions
 * the Modular panel uses (detectPlacement, planAssemblies, recordGoldenGate).
 * Synthetic files only, so nothing here skips.
 */

const DIR = join(__dirname, '../../../docs/tutorials/files');

function tut(name: string): SeqDocument {
  const doc = parseGenBank(readFileSync(join(DIR, `${name}.gb`), 'utf8')).documents[0];
  if (doc === undefined) throw new Error(`${name} has no record`);
  return doc;
}
function def<T>(value: T | null | undefined): T {
  if (value === undefined || value === null) throw new Error('expected a value');
  return value;
}
function enz(name: string): Enzyme {
  return def(getEnzyme(name));
}
const BsaI = (): Enzyme => enz('BsaI');
const names = (doc: SeqDocument): string[] => [...doc.features].map((f) => f.name);

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
/** Both host states must agree: no site in these files hangs on dam/dcm. */
function sites(doc: SeqDocument, name: string): number {
  const a = count(doc, name, METHYLATED_HOST);
  expect(count(doc, name, UNMETHYLATED_HOST)).toBe(a);
  return a;
}
function seeded(wanted: readonly string[]): string[] {
  return [...(resolveSeed(wanted, activeEnzymes()) ?? [])].sort();
}

const FILES = [
  'MC-L1-Destination',
  'MC-L0-Promoter-A',
  'MC-L0-Promoter-B',
  'MC-L0-CDS-A',
  'MC-L0-CDS-B',
  'MC-L0-Terminator',
  'MC-wrong-position',
] as const;

const std = def(BUNDLED_STANDARDS.find((s) => s.id === 'moclo-plant'));
const PROMOTER = 'Promoter + 5′UTR';
const CDS = 'CDS';
const TERMINATOR = '3′UTR + terminator';

/** The panel's plan: the destination first, then one slot per position that has a part. */
function slots(
  dest: SeqDocument,
  byPosition: readonly (readonly [string, readonly SeqDocument[]])[],
): PlanSlot[] {
  const d = def(detectPlacement(dest, std, { enzyme: BsaI() }));
  if (d.kind !== 'destination') throw new Error('not a destination');
  const out: PlanSlot[] = [
    {
      label: 'Destination',
      left: d.left,
      right: d.right,
      parts: [{ id: dest.name, document: dest }],
    },
  ];
  for (const [position, docs] of byPosition) {
    const ends = def(placementEnds(std, { kind: 'position', position, flipped: false }));
    out.push({
      label: position,
      left: ends.left,
      right: ends.right,
      parts: docs.map((document) => ({ id: document.name, document })),
    });
  }
  return out;
}

beforeAll(() => {
  setActiveEnzymeSet(BUNDLED_ENZYME_SET);
});

describe('modular.md: the files', () => {
  it.each(FILES)('%s parses, round-trips and says it is synthetic', (f) => {
    const doc = tut(f);
    expect(doc.metadata.description).toMatch(/synthetic/i);
    const again = def(parseGenBank(writeGenBank(doc)).documents[0]);
    expect(again.sequence.toString()).toBe(doc.sequence.toString());
    expect(again.topology).toBe(doc.topology);
    expect(names(again)).toEqual(names(doc));
  });

  it('lengths, topologies and features', () => {
    const got = FILES.map((f) => {
      const d = tut(f);
      return [d.name, d.length, d.topology, names(d).join(', ')];
    });
    expect(got).toEqual([
      ['pMC-L1-Destination', 1572, 'circular', 'AmpR, ori, BsaI site, lacZ-dropout, BsaI site'],
      ['MC-L0-PromA', 96, 'linear', 'BsaI site, synthetic promoter A, BsaI site'],
      ['MC-L0-PromB', 116, 'linear', 'BsaI site, synthetic promoter B, BsaI site'],
      ['MC-L0-CdsA', 326, 'linear', 'BsaI site, synthCDS A, BsaI site'],
      ['MC-L0-CdsB', 386, 'linear', 'BsaI site, synthCDS B, BsaI site'],
      ['MC-L0-Term', 92, 'linear', 'BsaI site, synthetic terminator, BsaI site'],
      ['MC-L0-YTK-Type3', 106, 'linear', 'BsaI site, synthetic Type 3 part, BsaI site'],
    ]);
  });

  it('BsaI cuts the destination twice and each part twice; no other Type IIS enzyme cuts anything', () => {
    for (const f of FILES) {
      const d = tut(f);
      expect(sites(d, 'BsaI'), f).toBe(2);
      for (const e of goldenGateEnzymes()) {
        if (e.name !== 'BsaI') expect(sites(d, e.name), `${f} ${e.name}`).toBe(0);
      }
    }
  });

  it('the parts are cut with the overhangs of their MoClo positions', () => {
    const o = { enzyme: BsaI() };
    const ends = (f: string) =>
      goldenGateFragments(tut(f), o)
        .map(
          (x) =>
            `${x.left.overhang.toUpperCase()}-${x.right.overhang.toUpperCase()}:${x.sequence.length}`,
        )
        .sort();
    // A part and its two flanks; the part is the one that carries no site.
    expect(ends('MC-L0-Promoter-A')).toContain('GGAG-AATG:74');
    expect(ends('MC-L0-Promoter-B')).toContain('GGAG-AATG:94');
    expect(ends('MC-L0-CDS-A')).toContain('AATG-GCTT:304');
    expect(ends('MC-L0-CDS-B')).toContain('AATG-GCTT:364');
    expect(ends('MC-L0-Terminator')).toContain('GCTT-CGCT:70');
    expect(ends('MC-wrong-position')).toContain('TATG-ATCC:84');
    expect(ends('MC-L1-Destination')).toContain('CGCT-GGAG:1254');
  });

  it('the CDS parts are open reading frames from the overhang ATG to one stop', () => {
    for (const [f, aa] of [
      ['MC-L0-CDS-A', 100],
      ['MC-L0-CDS-B', 120],
    ] as const) {
      const d = tut(f);
      const cds = def([...d.features].find((x) => x.type === 'CDS'));
      const seg = cds.segments[0];
      if (seg?.kind !== 'range') throw new Error('no CDS');
      expect(seg.end - seg.start).toBe(aa * 3 + 3);
      const protein = translate(d.sequence.toString().toUpperCase().slice(seg.start, seg.end));
      expect(protein.startsWith('M')).toBe(true);
      expect(protein.indexOf('*')).toBe(aa);
      expect(protein).toHaveLength(aa + 1);
    }
  });
});

describe('modular.md: the panel places the parts', () => {
  it('MoClo plant positions and their overhangs', () => {
    expect(std.name).toBe('MoClo plant common syntax');
    expect(std.enzyme).toBe('BsaI');
    const pick = (n: string) => std.positions.find((p) => p.name === n);
    expect(
      [pick(PROMOTER), pick(CDS), pick(TERMINATOR)].map((p) => `${p?.left}-${p?.right}`),
    ).toEqual(['GGAG-AATG', 'AATG-GCTT', 'GCTT-CGCT']);
  });

  it('detects the destination and each position, and the wrong part is not placed', () => {
    const o = { enzyme: BsaI() };
    const got = FILES.map((f) => JSON.stringify(detectPlacement(tut(f), std, o)));
    expect(got).toEqual([
      '{"kind":"destination","left":"CGCT","right":"GGAG"}',
      `{"kind":"position","position":"${PROMOTER}","flipped":false}`,
      `{"kind":"position","position":"${PROMOTER}","flipped":false}`,
      `{"kind":"position","position":"${CDS}","flipped":false}`,
      `{"kind":"position","position":"${CDS}","flipped":false}`,
      `{"kind":"position","position":"${TERMINATOR}","flipped":false}`,
      'null',
    ]);
  });

  it('the wrong part is a Yeast Toolkit Type 3 part, which the YTK standard does place', () => {
    const ytk = def(BUNDLED_STANDARDS.find((s) => s.id === 'ytk'));
    const p = detectPlacement(tut('MC-wrong-position'), ytk, { enzyme: BsaI() });
    expect(p).toEqual({ kind: 'position', position: 'Type 3', flipped: false });
  });
});

describe('modular.md, first half: one transcription unit', () => {
  const [dest, promA, , cdsA, , term] = FILES.map(tut);

  it('plans one combination of four slots with no gap and no warning', () => {
    const plan = planAssemblies(
      slots(def(dest), [
        [PROMOTER, [def(promA)]],
        [CDS, [def(cdsA)]],
        [TERMINATOR, [def(term)]],
      ]),
      { enzyme: BsaI() },
    );
    expect(plan.gaps).toEqual([]);
    expect(plan.total).toBe(1);
    const p = def(plan.products[0]);
    expect(p.name).toBe('pMC-L1-Destination + MC-L0-PromA + MC-L0-CdsA + MC-L0-Term');
    expect(p.problem).toBeNull();
    const a = def(p.assembly);
    expect(a.product.length).toBe(1702);
    expect(a.warnings).toEqual([]);
    expect(
      a.order.map(
        (o) =>
          `${o.fragment.left.overhang.toUpperCase()}-${o.fragment.right.overhang.toUpperCase()}`,
      ),
    ).toEqual(['CGCT-GGAG', 'GGAG-AATG', 'AATG-GCTT', 'GCTT-CGCT']);
  });

  it('the product: 1,702 bp circle, features, BsaI ticked but no site, one frame', () => {
    const plan = planAssemblies(
      slots(def(dest), [
        [PROMOTER, [def(promA)]],
        [CDS, [def(cdsA)]],
        [TERMINATOR, [def(term)]],
      ]),
      { enzyme: BsaI() },
    );
    const product = recordGoldenGate(def(def(plan.products[0]).assembly), ['BsaI']);
    expect(product.name).toBe('pMC-L1-Destination+MC-L0-PromA+MC-L0-CdsA+MC-L0-Term assembly');
    expect(product.length).toBe(1702);
    expect(product.topology).toBe('circular');
    expect(names(product).sort()).toEqual(
      ['AmpR', 'ori', 'synthCDS A', 'synthetic promoter A', 'synthetic terminator'].sort(),
    );
    for (const e of goldenGateEnzymes()) expect(sites(product, e.name), e.name).toBe(0);
    // The pieces BsaI leaves: backbone 1,254 + 74 + 304 + 70 bp (each piece counts one overhang).
    expect(1254 + 74 + 304 + 70).toBe(1702);
    // The product opens with the Bench's enzyme ticked, though no site is left (#309).
    expect(seeded(goldenGateSeed('BsaI'))).toEqual(['BsaI']);
    expect(seeded(goldenGateSeed('BsaI', 'BsmBI'))).toEqual(['BsaI', 'BsmBI']);
    // Promoter, CDS, terminator in order on the strand.
    const order = [...product.features]
      .filter((f) =>
        ['synthetic promoter A', 'synthCDS A', 'synthetic terminator'].includes(f.name),
      )
      .sort((x, y) => {
        const sx = x.segments[0];
        const sy = y.segments[0];
        return (sx?.kind === 'range' ? sx.start : 0) - (sy?.kind === 'range' ? sy.start : 0);
      })
      .map((f) => f.name);
    expect(order).toEqual(['synthetic promoter A', 'synthCDS A', 'synthetic terminator']);
    const cds = def([...product.features].find((f) => f.name === 'synthCDS A'));
    const seg = cds.segments[0];
    if (seg?.kind !== 'range') throw new Error('no CDS');
    expect(cds.strand).toBe('forward');
    const protein = translate(product.sequence.toString().toUpperCase().slice(seg.start, seg.end));
    expect(protein).toHaveLength(101);
    expect(protein.indexOf('*')).toBe(100);
    // One base, the A of AATG, lies between the promoter feature and the CDS, which starts on the ATG.
    const prom = def([...product.features].find((f) => f.name === 'synthetic promoter A'));
    const pseg = prom.segments[0];
    if (pseg?.kind !== 'range') throw new Error('no promoter');
    expect(seg.start - pseg.end).toBe(1);
    expect(product.sequence.toString().toUpperCase().slice(pseg.end, seg.start)).toBe('A');
    const tfeat = def([...product.features].find((f) => f.name === 'synthetic terminator'));
    const tseg = tfeat.segments[0];
    if (tseg?.kind !== 'range') throw new Error('no terminator');
    // The stop codon is followed by the four GCTT bases, which start the terminator.
    expect(tseg.start - seg.end).toBe(0);
    expect(
      product.sequence
        .toString()
        .toUpperCase()
        .slice(seg.end, seg.end + 4),
    ).toBe('GCTT');
    // The ATG is the last three bases of the AATG overhang.
    expect(
      product.sequence
        .toString()
        .toUpperCase()
        .slice(seg.start - 1, seg.start + 3),
    ).toBe('AATG');
  });
});

describe('modular.md: the wrong part', () => {
  const [dest, promA, , cdsA, , term, wrong] = FILES.map(tut);

  it('left unplaced, the plan is still one combination; set to CDS by hand it cannot form', () => {
    const o = { enzyme: BsaI() };
    const plan = planAssemblies(
      slots(def(dest), [
        [PROMOTER, [def(promA)]],
        [CDS, [def(cdsA), def(wrong)]],
        [TERMINATOR, [def(term)]],
      ]),
      o,
    );
    expect(plan.total).toBe(2);
    expect(plan.products.filter((p) => p.assembly !== null)).toHaveLength(1);
    const bad = def(plan.products.find((p) => p.assembly === null));
    expect(bad.name).toBe('pMC-L1-Destination + MC-L0-PromA + MC-L0-YTK-Type3 + MC-L0-Term');
    expect(bad.problem).toBe(
      'No part starts with the overhang BsaI 5′ AATG left by MC-L0-PromA. 2 of 4 parts were never reached.',
    );
  });
});

describe('modular.md, second half: two promoters by two coding parts', () => {
  const [dest, promA, promB, cdsA, cdsB, term] = FILES.map(tut);
  const plan = planAssemblies(
    slots(def(dest), [
      [PROMOTER, [def(promA), def(promB)]],
      [CDS, [def(cdsA), def(cdsB)]],
      [TERMINATOR, [def(term)]],
    ]),
    { enzyme: BsaI() },
  );

  it('four combinations, all assemble, in this order, at these lengths', () => {
    expect(plan.total).toBe(4);
    expect(plan.gaps).toEqual([]);
    expect(plan.products.map((p) => [p.name, p.assembly?.product.length])).toEqual([
      ['pMC-L1-Destination + MC-L0-PromA + MC-L0-CdsA + MC-L0-Term', 1702],
      ['pMC-L1-Destination + MC-L0-PromA + MC-L0-CdsB + MC-L0-Term', 1762],
      ['pMC-L1-Destination + MC-L0-PromB + MC-L0-CdsA + MC-L0-Term', 1722],
      ['pMC-L1-Destination + MC-L0-PromB + MC-L0-CdsB + MC-L0-Term', 1782],
    ]);
    for (const p of plan.products) expect(p.assembly?.warnings).toEqual([]);
  });

  it('each product carries its own promoter and CDS, never both of a pair', () => {
    const got = plan.products.map((p) => {
      const doc = recordGoldenGate(def(p.assembly), ['BsaI']);
      expect(sites(doc, 'BsaI')).toBe(0);
      expect(doc.topology).toBe('circular');
      return names(doc).join(', ');
    });
    expect(got).toEqual([
      'AmpR, ori, synthetic promoter A, synthCDS A, synthetic terminator',
      'AmpR, ori, synthetic promoter A, synthCDS B, synthetic terminator',
      'AmpR, ori, synthetic promoter B, synthCDS A, synthetic terminator',
      'AmpR, ori, synthetic promoter B, synthCDS B, synthetic terminator',
    ]);
  });
});
