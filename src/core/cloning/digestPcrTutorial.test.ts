import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  type DigestFragment,
  type SeqDocument,
  BUNDLED_ENZYME_SET,
  DEFAULT_GEL,
  bandProblems,
  describeBands,
  describeEnd,
  describeEnds,
  digest,
  digestFragments,
  findCutSites,
  fragmentWithLineage,
  gelProfile,
  meltingTemperature,
  getEnzyme,
  pcr,
  recordPcr,
  reverseComplement,
  setActiveEnzymeSet,
} from '@/core';
import { parseGenBank } from '@/io/genbank/parseGenBank';
import { writeGenBank } from '@/io/genbank/writeGenBank';

import { documentFromFragment } from './index';

/**
 * Verifies docs/tutorials/digest-pcr.md: the two files it hands out
 * (pLig-Vector.gb and SDM-Template.gb, shared with other tutorials) and every
 * number it prints, through the functions the Cloning tab's Digest and PCR
 * panels call. The page has no NCBI path, so nothing here reads the
 * gitignored fixtures.
 */

const DIR = join(__dirname, '../../../docs/tutorials/files');
function load(name: string): SeqDocument {
  const doc = parseGenBank(readFileSync(join(DIR, `${name}.gb`), 'utf8')).documents[0];
  if (doc === undefined) throw new Error(`${name} has no record`);
  return doc;
}
const vector = load('pLig-Vector');
const template = load('SDM-Template');
/** An element that must be there, so a test reads without assertions. */
function must<T>(value: T | undefined): T {
  if (value === undefined) throw new Error('expected a value');
  return value;
}
const seq = (doc: SeqDocument): string => doc.sequence.toString().toUpperCase();
const T = seq(template);

function cutsOf(doc: SeqDocument, names: string[]) {
  const es = names.map((n) => {
    const e = getEnzyme(n);
    if (e === undefined) throw new Error(n);
    return e;
  });
  return findCutSites(seq(doc), doc.topology, es);
}
/** The Cloning tab's list: largest first. */
function fragments(doc: SeqDocument, names: string[]): DigestFragment[] {
  return digest(doc, cutsOf(doc, names)).sort((a, b) => b.sequence.length - a.sequence.length);
}
const lengths = (doc: SeqDocument, names: string[]): number[] =>
  fragments(doc, names).map((f) => f.sequence.length);
/** The Enzymes tab's reading of the ticked enzymes together. */
function gel(names: string[]) {
  const cuts = cutsOf(vector, names).map((c) => c.cut);
  const sizes = digestFragments(cuts, vector.length, vector.topology)
    .map((f) => f.length)
    .sort((a, b) => b - a);
  return gelProfile(sizes, DEFAULT_GEL);
}
/** One-based inclusive range text as the fragment row writes it. */
const range = (f: DigestFragment, length: number): string =>
  `${(f.range.start + 1).toLocaleString()}–${(((f.range.end - 1) % length) + 1).toLocaleString()}`;

// The primers the page gives.
const F = 'ATGGCAAGGGGGCGTCTGTG';
const R = 'TTATACTTCCACCAGAAGACGGTAACTG';
const F_TAILED = `GGGAATTCTT${F}`;
const R_TAILED = `GCGGATCCTT${R}`;
const FORWARD_STRAND_END = T.slice(413, 441);
const AWAY_FORWARD = FORWARD_STRAND_END;
const AWAY_REVERSE = reverseComplement(F);
const pair = (f: string, r: string) => [
  { name: 'Forward', sequence: f },
  { name: 'Reverse', sequence: r },
];

beforeAll(() => {
  setActiveEnzymeSet(BUNDLED_ENZYME_SET);
});

describe('digest-pcr.md: the files', () => {
  it('parse, round-trip and say they are synthetic', () => {
    for (const doc of [vector, template]) {
      expect(doc.metadata.description).toMatch(/synthetic/i);
      const again = parseGenBank(writeGenBank(doc)).documents[0];
      expect(again?.sequence.toString()).toBe(doc.sequence.toString());
      expect(again?.topology).toBe('circular');
    }
    expect(vector.length).toBe(2664);
    expect(template.length).toBe(1241);
  });
  it('have the sites the page names', () => {
    const count = (doc: SeqDocument, e: string): number => cutsOf(doc, [e]).length;
    for (const e of ['EcoRI', 'BamHI', 'PstI', 'EcoRV']) expect(count(vector, e), e).toBe(1);
    expect(count(vector, 'XhoI')).toBe(2);
    expect(count(template, 'EcoRI')).toBe(1);
    expect(count(template, 'BamHI')).toBe(1);
    // The ORF itself holds neither, so the tails add the only ones.
    const orf = T.slice(138, 441);
    expect(orf).not.toMatch(/GAATTC|GGATCC/);
  });
});

describe('digest-pcr.md part 1: the digest', () => {
  it('EcoRI alone: a circle cut once is one linear fragment', () => {
    const [only, ...rest] = fragments(vector, ['EcoRI']);
    expect(rest).toHaveLength(0);
    expect(only?.sequence.length).toBe(2664);
    expect(range(must(only), 2664)).toBe('234–233');
    expect(describeEnd(must(only?.left))).toBe('EcoRI 5′ AATT');
    expect(describeEnd(must(only?.right))).toBe('EcoRI 5′ AATT');
    expect(gel(['EcoRI']).bands).toHaveLength(1);
    expect(describeBands(gel(['EcoRI']), 6)).toBe('2,664 bp');
    expect(gel(['EcoRI']).misleading).toBe(false);
  });

  it('EcoRI and XhoI: three fragments and three bands', () => {
    const fs = fragments(vector, ['EcoRI', 'XhoI']);
    expect(fs.map((f) => [f.sequence.length, range(f, 2664)])).toEqual([
      [1275, '654–1,928'],
      [969, '1,929–233'],
      [420, '234–653'],
    ]);
    expect(fs.map((f) => `${describeEnd(f.left)} / ${describeEnd(f.right)}`)).toEqual([
      'XhoI 5′ TCGA / XhoI 5′ TCGA',
      'XhoI 5′ TCGA / EcoRI 5′ AATT',
      'EcoRI 5′ AATT / XhoI 5′ TCGA',
    ]);
    const g = gel(['EcoRI', 'XhoI']);
    expect(g.bands).toHaveLength(3);
    expect(g.misleading).toBe(false);
    expect(describeBands(g, 6)).toBe('1,275 + 969 + 420 bp');
  });

  it('XhoI alone: two fragments that read as one band', () => {
    expect(lengths(vector, ['XhoI'])).toEqual([1389, 1275]);
    const g = gel(['XhoI']);
    expect(g.bands).toHaveLength(1);
    expect(g.misleading).toBe(true);
    expect(describeBands(g, 6)).toBe('1,389 ×2 bp');
    expect(bandProblems(g, DEFAULT_GEL)).toEqual([
      'one band, so there is nothing to tell apart',
      '1,389 and 1,275 run together',
    ]);
  });

  it('EcoRI and EcoRV: a sticky end and a blunt one', () => {
    const fs = fragments(vector, ['EcoRI', 'EcoRV']);
    expect(fs.map((f) => [f.sequence.length, range(f, 2664)])).toEqual([
      [1830, '1,068–233'],
      [834, '234–1,067'],
    ]);
    expect(describeEnds({ left: must(fs[0]).left, right: must(fs[0]).right })).toBe(
      'EcoRV blunt / EcoRI 5′ AATT',
    );
    expect(describeEnds({ left: must(fs[1]).left, right: must(fs[1]).right })).toBe(
      'EcoRI 5′ AATT / EcoRV blunt',
    );
    const g = gel(['EcoRI', 'EcoRV']);
    expect(g.bands).toHaveLength(2);
    expect(describeBands(g, 6)).toBe('1,830 + 834 bp');
  });

  it('opens the 1,830 piece, and blunting fills its EcoRI end in', () => {
    const big = must(fragments(vector, ['EcoRI', 'EcoRV'])[0]);
    const opened = documentFromFragment(fragmentWithLineage(big, vector));
    expect(opened.name).toBe('pLig-Vector EcoRV-EcoRI fragment');
    expect(opened.length).toBe(1830);
    expect(opened.topology).toBe('linear');
    expect(describeEnds(opened.ends)).toBe('EcoRV blunt / EcoRI 5′ AATT');
    const filled = opened.apply({ type: 'bluntEnds', method: 'fill' });
    expect(filled.length).toBe(1834);
    expect(seq(filled).slice(-4)).toBe('AATT');
    expect(describeEnds(filled.ends)).toBe('EcoRV blunt / EcoRI blunt');
    // The four bases are the overhang's, copied: the other 1,830 are as they were.
    expect(seq(filled).slice(0, 1830)).toBe(seq(opened));
    // Trim takes the overhang off the other strand and leaves the sequence.
    const trimmed = opened.apply({ type: 'bluntEnds', method: 'trim' });
    expect(trimmed.length).toBe(1830);
    expect(describeEnds(trimmed.ends)).toBe('EcoRV blunt / EcoRI blunt');
    // The 834 piece has its overhang on the left: filling in leaves its length, trimming takes 4.
    const small = documentFromFragment(
      fragmentWithLineage(must(fragments(vector, ['EcoRI', 'EcoRV'])[1]), vector),
    );
    expect(small.apply({ type: 'bluntEnds', method: 'fill' }).length).toBe(834);
    expect(small.apply({ type: 'bluntEnds', method: 'trim' }).length).toBe(830);
  });

  it('the blunted piece, uncut, is one fragment with the ends it has', () => {
    const big = must(fragments(vector, ['EcoRI', 'EcoRV'])[0]);
    const filled = documentFromFragment(fragmentWithLineage(big, vector)).apply({
      type: 'bluntEnds',
      method: 'fill',
    });
    const whole = digest(filled, []);
    expect(whole).toHaveLength(1);
    expect(whole[0]?.sequence.length).toBe(1834);
    // Shelved with the 834 bp piece from step 7, the two make the shelf's 2,668 bp.
    expect(834 + 1834).toBe(2668);
    expect(describeEnds({ left: must(whole[0]).left, right: must(whole[0]).right })).toBe(
      'EcoRV blunt / EcoRI blunt',
    );
  });
});

describe('digest-pcr.md part 2: the PCR', () => {
  it('a plain pair: 303 bp, the whole of synthORF', () => {
    const res = pcr(template, pair(F, R), { polymerase: 'proofreading' });
    expect(res.problem).toBeNull();
    expect(res.products).toHaveLength(1);
    const p = must(res.products[0]);
    expect(p.length).toBe(303);
    expect([p.templateRange.start + 1, p.templateRange.end]).toEqual([139, 441]);
    expect(p.mismatches).toBe(0);
    const f = must(res.sites.find((s) => s.name === 'Forward'));
    const r = must(res.sites.find((s) => s.name === 'Reverse'));
    expect([f.primer.length, Math.round(f.tm), f.strand]).toEqual([20, 63, 'forward']);
    expect([r.primer.length, Math.round(r.tm), r.strand]).toEqual([28, 59, 'reverse']);
    expect([f.range.start + 1, f.range.end]).toEqual([139, 158]);
    expect([r.range.start + 1, r.range.end]).toEqual([414, 441]);
    // The product is the CDS exactly, start codon to stop codon.
    expect(seq(recordPcr(p, template, pair(F, R), 'proofreading'))).toBe(T.slice(138, 441));
    expect(T.slice(138, 141)).toBe('ATG');
    expect(T.slice(438, 441)).toBe('TAA');
  });

  it('a pair with tails: 323 bp, 20 bp of tail, the sites at the ends', () => {
    const res = pcr(template, pair(F_TAILED, R_TAILED), { polymerase: 'proofreading' });
    expect(res.problem).toBeNull();
    const p = must(res.products[0]);
    expect(p.length).toBe(323);
    expect(p.mismatches).toBe(0);
    expect(p.forward.tail.length + p.reverse.tail.length).toBe(20);
    const f = must(res.sites.find((s) => s.name === 'Forward'));
    const r = must(res.sites.find((s) => s.name === 'Reverse'));
    expect([f.primer.length, f.tail.length, Math.round(f.templateTm)]).toEqual([30, 10, 63]);
    expect([r.primer.length, r.tail.length, Math.round(r.templateTm)]).toEqual([38, 10, 59]);
    // Once the product carries the tails, the whole oligo is the template.
    expect([
      Math.round(meltingTemperature(f.primer)),
      Math.round(meltingTemperature(r.primer)),
    ]).toEqual([67, 66]);
    expect([f.range.start + 1, f.range.end]).toEqual([139, 158]);
    expect([r.range.start + 1, r.range.end]).toEqual([414, 441]);
    const made = recordPcr(p, template, pair(F_TAILED, R_TAILED), 'proofreading');
    expect(made.name).toBe('SDM-Template PCR product');
    expect(made.length).toBe(323);
    expect(made.topology).toBe('linear');
    // Capitals are what did not come from the template: the two tails.
    const raw = made.sequence.toString();
    expect(raw.slice(0, 10)).toBe('GGGAATTCTT');
    expect(raw.slice(-10)).toBe('AAGGATCCGC');
    expect(raw.slice(10, 313)).toBe(raw.slice(10, 313).toLowerCase());
    const s = seq(made);
    expect(s.startsWith(`GGGAATTCTT${T.slice(138, 158)}`)).toBe(true);
    expect(s.endsWith(`${T.slice(413, 441)}AAGGATCCGC`)).toBe(true);
    expect(s.slice(10, 313)).toBe(T.slice(138, 441));
    expect([...made.features].map((x) => x.name).sort()).toEqual([
      'Forward',
      'Reverse',
      'synthORF',
    ]);
    // Digest of the product: EcoRI and BamHI each cut once, near the ends.
    expect(cutsOf(made, ['EcoRI']).map((c) => c.cut)).toEqual([3]);
    expect(cutsOf(made, ['BamHI']).map((c) => c.cut)).toEqual([316]);
    const fs = fragments(made, ['EcoRI', 'BamHI']);
    expect(fs.map((x) => x.sequence.length)).toEqual([313, 7, 3]);
    expect(describeEnds({ left: must(fs[0]).left, right: must(fs[0]).right })).toBe(
      'EcoRI 5′ AATT / BamHI 5′ GATC',
    );
    expect(range(must(fs[0]), 323)).toBe('4\u2013316');
    // The same two sites are in pLig-Vector's MCS, in the same order, so the
    // 313 bp piece is what Ligation takes next.
    expect(must(cutsOf(vector, ['EcoRI'])[0]).cut).toBeLessThan(
      must(cutsOf(vector, ['BamHI'])[0]).cut,
    );
  });

  it('a Taq product has an A on each 3′ end', () => {
    const res = pcr(template, pair(F, R), { polymerase: 'taq' });
    expect(res.products[0]?.length).toBe(304);
  });

  it('both primers on the same strand: nothing is amplified, and the panel says why', () => {
    const res = pcr(template, pair(F, FORWARD_STRAND_END), { polymerase: 'proofreading' });
    expect(res.products).toHaveLength(0);
    expect(res.problem).toBe(
      'Both primers anneal to the same strand of SDM-Template, so they both copy the same way and nothing is amplified. One of them wants reverse-complementing.',
    );
    expect(FORWARD_STRAND_END).toBe(reverseComplement(R));
  });

  it('a primer that does not anneal: the other one has nothing to meet', () => {
    const res = pcr(template, pair('ACGTACGTACGTACGTACGTAC', R), { polymerase: 'proofreading' });
    expect(res.products).toHaveLength(0);
    expect(res.problem).toBe(
      'Forward does not anneal to SDM-Template, so there is nothing for the other primer to meet.',
    );
  });

  it('primers pointing away from each other: on a circle, the long way round', () => {
    const res = pcr(template, pair(AWAY_FORWARD, AWAY_REVERSE), { polymerase: 'proofreading' });
    expect(res.problem).toBeNull();
    expect(res.products).toHaveLength(1);
    const p = must(res.products[0]);
    expect(p.length).toBe(986);
    expect([p.templateRange.start + 1, p.templateRange.end]).toEqual([414, 1399]);
    // 1,399 runs past the 1,241 bases: over the origin, ending at 158.
    expect(((p.templateRange.end - 1) % 1241) + 1).toBe(158);
    expect(986 + 303 - 20 - 28).toBe(1241);
  });
});
