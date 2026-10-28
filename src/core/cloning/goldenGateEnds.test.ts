import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { type Enzyme, getEnzyme } from '../analysis/restriction';
import { SeqDocument } from '../document';
import { reverseComplement } from '../sequence';
import { type CloningInsert } from './cloningEnds';
import { digest } from './digest';
import { findCutSites } from '../analysis/restriction';
import {
  type GoldenGatePartContext,
  designGoldenGatePart,
  destinationOverhangs,
  goldenGatePartEnzymes,
  overlapAtEnd,
  overlapAtStart,
  standardOverhangChoices,
  typeIISLayout,
  whyNotGoldenGate,
} from './goldenGateEnds';
import { parseGenBank } from '../../io/genbank/parseGenBank';

/**
 * Golden Gate ends (#310, item 113). The geometry is asserted against the
 * enzyme table's own rows, the part against the tutorial's files: the CDS
 * part `GG-cds.gb` is rebuilt from a plain gene by the designer, and the
 * assembly comes to the 3,118 bp the tutorial promises. The NCBI half of
 * the exercise is in `tutorialFiles.test.ts`, which skips without the
 * record.
 */

const DIR = join(__dirname, '../../../docs/tutorials/files');

function tut(name: string): SeqDocument {
  const result = parseGenBank(readFileSync(join(DIR, `${name}.gb`), 'utf8'));
  const doc = result.documents[0];
  if (doc === undefined) throw new Error(`${name} has no record`);
  return doc;
}

function enz(name: string): Enzyme {
  const e = getEnzyme(name);
  if (e === undefined) throw new Error(`no enzyme ${name}`);
  return e;
}

function def<T>(value: T | null | undefined): T {
  if (value === undefined || value === null) throw new Error('expected a value');
  return value;
}

function gene(bases: string, name = 'gene'): CloningInsert {
  const document = SeqDocument.create({ name, sequence: bases });
  return { document, range: { start: 0, end: bases.length }, strand: 'forward', name };
}

/** The part `GG-cds.gb` releases with BsaI: AATG + body, the right end TTCG. */
function cdsPart(): { readonly body: string; readonly left: string; readonly right: string } {
  const doc = tut('GG-cds');
  const text = doc.sequence.toString().toUpperCase();
  const pieces = digest(doc, findCutSites(text, doc.topology, [enz('BsaI')]));
  const part = def(pieces.find((p) => p.left.kind === "5'" && p.right.kind === "5'"));
  return {
    body: part.sequence.slice(4).toUpperCase(),
    left: part.left.overhang.toUpperCase(),
    right: part.right.overhang.toUpperCase(),
  };
}

describe('the geometry comes from the enzyme table', () => {
  it.each([
    ['BsaI', 'GGTCTC', 1, 4],
    ['BsmBI', 'CGTCTC', 1, 4],
    ['BbsI', 'GAAGAC', 2, 4],
    ['SapI', 'GCTCTTC', 1, 3],
  ])('%s writes %s, %i spacer base(s), a %i-base overhang', (name, site, spacer, overhang) => {
    const layout = def(typeIISLayout(enz(name)));
    expect(layout.site).toBe(site);
    expect(layout.spacer).toBe(spacer);
    expect(layout.overhang).toBe(overhang);
    expect(whyNotGoldenGate(enz(name))).toBeNull();
  });

  it('offers BsaI first and leaves out what the table cannot express', () => {
    const offered = goldenGatePartEnzymes();
    expect(offered[0]?.name).toBe('BsaI');
    expect(offered.map((e) => e.name).slice(0, 4)).toEqual(['BsaI', 'BsmBI', 'BbsI', 'SapI']);
    for (const e of offered) expect(typeIISLayout(e)).not.toBeNull();
  });

  it('says why an enzyme is not offered', () => {
    expect(whyNotGoldenGate(enz('EcoRI'))).toContain('not Type IIS');
    const blunt: Enzyme = {
      name: 'FakeI',
      site: 'GAGTC',
      cutTop: 10,
      cutBottom: 10,
      palindromic: false,
    };
    expect(whyNotGoldenGate(blunt)).toContain('blunt');
    const threePrime: Enzyme = {
      name: 'FakeII',
      site: 'GAGTC',
      cutTop: 9,
      cutBottom: 5,
      palindromic: false,
    };
    expect(whyNotGoldenGate(threePrime)).toContain('3′ overhang');
    const double: Enzyme = {
      name: 'FakeIII',
      site: 'CGANNNNNNTGC',
      cutTop: -10,
      cutBottom: -12,
      secondCut: { cutTop: 24, cutBottom: 22 },
      palindromic: false,
    };
    expect(whyNotGoldenGate(double)).toContain('both sides');
    for (const e of [blunt, threePrime, double]) expect(typeIISLayout(e)).toBeNull();
  });

  it('turns an enzyme the table lists cutting 5′ of its site around', () => {
    const leftward: Enzyme = {
      name: 'FakeIV',
      site: 'GAGTC',
      cutTop: -5,
      cutBottom: -1,
      palindromic: false,
    };
    const layout = def(typeIISLayout(leftward));
    expect(layout.site).toBe(reverseComplement('GAGTC'));
    expect(layout.spacer).toBe(1);
    expect(layout.overhang).toBe(4);
  });
});

describe('overhangs', () => {
  it('AATG supplies the start codon: the annealing part begins after it', () => {
    expect(overlapAtStart('AATG', 'ATGGCC')).toBe(3);
    expect(overlapAtStart('GGAG', 'ATGGCC')).toBe(0);
    // Not a coincidence: a part beginning with the overhang's last base
    // keeps it, and the start codon counts only while it is kept.
    expect(overlapAtStart('GGAG', 'GCCATG')).toBe(0);
    expect(overlapAtStart('AATG', 'ATGGCC', false)).toBe(0);
    expect(overlapAtStart('AATG', 'AATGGCC')).toBe(4);
    expect(overlapAtEnd('GGCGCTT', 'GCTT')).toBe(4);
    expect(overlapAtEnd('GGCAAA', 'GCTT')).toBe(0);
    expect(overlapAtEnd('GCCTTGCCAATT', 'TTCG')).toBe(0);
    expect(overlapAtEnd('GCCTAA', 'TAAG')).toBe(3);
  });

  it('offers the bundled standards, the chosen enzyme first', () => {
    const choices = standardOverhangChoices('BsaI');
    const cds = def(choices.find((c) => c.id === 'moclo-plant:CDS'));
    expect([cds.left, cds.right]).toEqual(['AATG', 'GCTT']);
    expect(choices.every((c) => c.enzyme === 'BsaI')).toBe(true);
  });

  it('reads the pair the destination asks for off its own cut ends', () => {
    const read = def(destinationOverhangs(tut('pGG-Destination'), enz('BsaI')));
    expect([read.left, read.right]).toEqual(['GGAG', 'CGCT']);
    expect(read.several).toBe(false);
    expect(read.backbone).toBe(2326);
  });

  it('has nothing to read from a vector the enzyme does not open', () => {
    expect(destinationOverhangs(tut('pLig-Vector'), enz('BsaI'))).toBeNull();
  });
});

describe('the two primers', () => {
  const part = cdsPart();
  /** The CDS as a plain gene: the part's own ATG back on it, and a stop. */
  const cds = `ATG${part.body}TAA`;
  const context = (over: Partial<GoldenGatePartContext> = {}): GoldenGatePartContext => ({
    insert: gene(cds, 'synthCDS'),
    destination: tut('pGG-Destination'),
    otherParts: ['GG-prom', 'GG-tag', 'GG-term'].map(tut),
    ...over,
  });

  it('writes padding, site, spacer, overhang and an annealing part', () => {
    const d = designGoldenGatePart(context(), { left: 'AATG', right: part.right });
    expect(d.problem).toBeNull();
    const f = d.forward.segments;
    expect(f.padding).toHaveLength(6);
    expect(f.site).toBe('GGTCTC');
    // One spacer base, then the overhang: BsaI's GGTCTC(1/5).
    expect(f.spacer).toHaveLength(5);
    expect(f.spacer.slice(1)).toBe('AATG');
    // AATG spells the start codon, so the annealing part begins after it.
    expect(cds.startsWith(`ATG${f.annealing}`.slice(0, 3 + f.annealing.length))).toBe(true);
    expect(f.annealing).toBe(part.body.slice(0, f.annealing.length));
    expect(d.forward.sequence).toBe(
      (f.padding + f.site + f.spacer).toLowerCase() + f.annealing.toUpperCase(),
    );
    const r = d.reverse.segments;
    expect(r.spacer.slice(1)).toBe(reverseComplement(part.right));
    expect(r.annealing).toBe(
      reverseComplement(part.body.slice(part.body.length - r.annealing.length)),
    );
    expect(d.forward.name).toBe('synthCDS-F-BsaI');
    expect(d.reverse.name).toBe('synthCDS-R-BsaI');
  });

  it('releases the same part the tutorial ships, and assembles to 3,118 bp', () => {
    const d = designGoldenGatePart(context(), { left: 'AATG', right: part.right });
    expect(d.part).toBe(`AATG${part.body}${part.right}`);
    expect(d.overlap).toEqual({ left: 3, right: 0 });
    expect(d.trimmed).toEqual({ start: false, stop: true });
    expect(d.frame.inFrame).toBe(true);
    // Nothing but what the GC-rich synthetic ends say about the annealing.
    expect(d.warnings.map((w) => w.kind)).toEqual(['annealing']);
    // Tails of padding 6 + site 6 + spacer 1 on either end, outside the
    // overhangs the part itself carries.
    expect(d.productLength).toBe(d.part.length + 2 * 13);
    expect(d.productLength).toBe(631);
    const sim = d.simulate();
    expect(sim.problem).toBeNull();
    expect(sim.missing).toBeNull();
    expect(sim.amplicon?.length).toBe(d.productLength);
    const product = def(sim.product);
    expect(product.length).toBe(3118);
    expect(product.isCircular).toBe(true);
    expect([...product.features].map((f) => f.name)).toEqual(
      expect.arrayContaining(['KanR', 'ori', 'synthetic promoter', 'synthTag']),
    );
    expect(product.name).toBe('pGG-Destination-synthCDS');
    expect(def(product.metadata.lineage).step?.op).toBe('golden-gate');
  });

  it('keeps the stop codon when asked, and says nothing is fused after it', () => {
    const d = designGoldenGatePart(context(), {
      left: 'AATG',
      right: part.right,
      includeStop: true,
    });
    expect(d.trimmed.stop).toBe(false);
    expect(d.part).toBe(`AATG${part.body}TAA${part.right}`);
    expect(d.frame.stopped).toBe(true);
  });

  it('drops the start codon for an N-terminal fusion part', () => {
    const d = designGoldenGatePart(context(), {
      left: 'GGAG',
      right: part.right,
      includeStart: false,
    });
    expect(d.trimmed.start).toBe(true);
    expect(d.overlap.left).toBe(0);
    expect(d.part.startsWith(`GGAG${part.body.slice(0, 6)}`)).toBe(true);
  });

  it('warns when the part would be read out of frame', () => {
    const insert = gene(`ATG${part.body}ATAA`);
    const d = designGoldenGatePart(context({ insert }), { left: 'AATG', right: part.right });
    expect(d.frame.inFrame).toBe(false);
    expect(d.warnings.map((w) => w.kind)).toContain('frame');
    expect(def(d.warnings.find((w) => w.kind === 'frame')).text).toContain('another frame');
  });

  it('refuses an overhang of the wrong length for the enzyme', () => {
    const d = designGoldenGatePart(context(), { left: 'AATG', right: 'AAT' });
    expect(d.problem).toContain('4 bases');
    expect(d.forward.sequence).toBe('');
    expect(d.simulate().product).toBeNull();
  });

  it('takes a 3-base overhang for SapI and two spacer bases for BbsI', () => {
    const sap = designGoldenGatePart(context({ destination: null }), {
      enzyme: 'SapI',
      left: 'ATG',
      right: 'CGA',
    });
    expect(sap.problem).toBeNull();
    expect(sap.forward.segments.site).toBe('GCTCTTC');
    expect(sap.forward.segments.spacer).toHaveLength(4);
    const bbs = designGoldenGatePart(context({ destination: null }), {
      enzyme: 'BbsI',
      left: 'AATG',
      right: part.right,
    });
    expect(bbs.forward.segments.site).toBe('GAAGAC');
    expect(bbs.forward.segments.spacer).toHaveLength(6);
    expect(bbs.forward.segments.spacer.slice(2)).toBe('AATG');
  });

  it('warns in red about a site of the enzyme inside the part', () => {
    const insert = gene(`ATG${part.body.slice(0, 60)}GGTCTCA${part.body.slice(60)}TAA`);
    const d = designGoldenGatePart(context({ insert }), { left: 'AATG', right: part.right });
    const w = def(d.warnings.find((x) => x.kind === 'internalSite'));
    expect(w.severity).toBe('danger');
    expect(w.text).toContain('BsaI');
    expect(w.text).toContain('cuts the part itself');
    // Nothing is offered silently: the assembly fails too.
    expect(d.simulate().product).toBeNull();
  });

  it('warns about a site of the second enzyme in the tube', () => {
    const insert = gene(`ATG${part.body.slice(0, 60)}CGTCTCA${part.body.slice(60)}TAA`);
    const d = designGoldenGatePart(context({ insert }), {
      left: 'AATG',
      right: part.right,
      secondEnzyme: 'BsmBI',
    });
    expect(def(d.warnings.find((x) => x.kind === 'internalSite')).text).toContain('BsmBI');
  });

  it('warns about a site the overhang and the part spell between them', () => {
    // AATG's last G plus a part beginning GTCTC is a BsaI site across the
    // junction: it lies in the part the reaction releases, so it is the
    // same red warning as a site the gene carries.
    const insert = gene(`ATGGTCTC${part.body.slice(5)}TAA`);
    const d = designGoldenGatePart(context({ insert }), { left: 'AATG', right: part.right });
    expect(d.part.slice(0, 9)).toBe('AATGGTCTC');
    const w = def(d.warnings.find((x) => x.kind === 'internalSite'));
    expect(w.severity).toBe('danger');
  });

  it('warns about a palindromic overhang and about one overhang twice', () => {
    const same = designGoldenGatePart(context({ destination: null, otherParts: [] }), {
      left: 'AATG',
      right: 'AATG',
    });
    expect(
      same.warnings
        .filter((w) => w.kind === 'overhang')
        .map((w) => w.text)
        .join(' '),
    ).toContain('two junctions');
    const palindrome = designGoldenGatePart(context({ destination: null, otherParts: [] }), {
      left: 'GATC',
      right: part.right,
    });
    expect(
      palindrome.warnings
        .filter((w) => w.kind === 'overhang')
        .map((w) => w.text)
        .join(' '),
    ).toContain('own reverse complement');
  });

  it('warns when an overhang is one base from one already in the tube', () => {
    // GGAC is one base from the destination's GGAG.
    const d = designGoldenGatePart(context(), { left: 'GGAC', right: part.right });
    const texts = d.warnings.filter((w) => w.kind === 'overhang').map((w) => w.text);
    expect(texts.join(' ')).toContain('differ at one base');
  });

  it('warns about ambiguity codes in the annealing part', () => {
    const insert = gene(`ATGNNN${part.body.slice(3)}TAA`);
    const d = designGoldenGatePart(context({ insert }), { left: 'AATG', right: part.right });
    expect(d.warnings.map((w) => w.kind)).toContain('ambiguous');
  });

  it('raises the padding the user asked for when the enzyme wants more', () => {
    // NEB's chart does not rate BsaI, so its advice of 6 bases stands and a
    // smaller setting is raised to it, as in item 108.
    const d = designGoldenGatePart(context(), { left: 'AATG', right: part.right, padding: 2 });
    expect(d.forward.segments.padding).toHaveLength(6);
    expect(d.forward.paddingRaised).toBe(6);
    expect(d.warnings.map((w) => w.kind)).toContain('paddingRaised');
    const wide = designGoldenGatePart(context(), { left: 'AATG', right: part.right, padding: 12 });
    expect(wide.forward.segments.padding).toHaveLength(12);
  });

  it('is too short a region to amplify', () => {
    const d = designGoldenGatePart(context({ insert: gene('ATGGCCTAA') }), {
      left: 'AATG',
      right: part.right,
    });
    expect(d.problem).toContain('too short to amplify');
  });
});

describe('the part on a template of its own', () => {
  const part = cdsPart();
  const cds = `ATG${part.body}TAA`;

  it('reads a region that wraps the origin of a circular template', () => {
    const plasmid = SeqDocument.create({
      name: 'circle',
      sequence: `${cds.slice(200)}${'ACGT'.repeat(50)}${cds.slice(0, 200)}`,
      topology: 'circular',
    });
    const start = plasmid.length - 200;
    const insert: CloningInsert = {
      document: plasmid,
      range: { start, end: start + cds.length },
      strand: 'forward',
      name: 'wrapped',
    };
    const d = designGoldenGatePart(
      { insert, destination: null },
      { left: 'AATG', right: part.right },
    );
    expect(d.problem).toBeNull();
    expect(d.part).toBe(`AATG${part.body}${part.right}`);
    const sim = d.simulate();
    expect(sim.amplicon?.length).toBe(d.productLength);
  });

  it('reads a feature on the reverse strand', () => {
    const doc = SeqDocument.create({
      name: 'reverse-template',
      sequence: `GGATCC${reverseComplement(cds)}GGATCC`,
    });
    const insert: CloningInsert = {
      document: doc,
      range: { start: 6, end: 6 + cds.length },
      strand: 'reverse',
      name: 'rev',
    };
    const d = designGoldenGatePart(
      { insert, destination: null },
      { left: 'AATG', right: part.right },
    );
    expect(d.part).toBe(`AATG${part.body}${part.right}`);
    const sim = d.simulate();
    expect(sim.amplicon?.sequence.toString().toUpperCase()).toBe(d.amplicon);
  });

  it('runs the PCR alone and says what the tube has not got', () => {
    const d = designGoldenGatePart(
      { insert: gene(cds, 'synthCDS'), destination: null },
      { left: 'AATG', right: part.right },
    );
    const sim = d.simulate();
    expect(sim.product).toBeNull();
    expect(sim.problem).toBeNull();
    expect(sim.missing).toContain('No destination vector is open');
    expect(sim.amplicon?.length).toBe(d.productLength);
  });

  it('says so when the enzyme opens nothing in the destination', () => {
    const sim = designGoldenGatePart(
      { insert: gene(cds, 'synthCDS'), destination: tut('pLig-Vector') },
      { left: 'AATG', right: part.right },
    ).simulate();
    expect(sim.product).toBeNull();
    expect(sim.missing).toContain('opens nothing in pLig-Vector');
  });

  it('says so when the other parts are not in the tube', () => {
    const sim = designGoldenGatePart(
      {
        insert: gene(cds, 'synthCDS'),
        destination: tut('pGG-Destination'),
      },
      { left: 'AATG', right: part.right },
    ).simulate();
    expect(sim.product).toBeNull();
    expect(def(sim.problem)).toContain('No part starts with the overhang');
    expect(def(sim.missing)).toContain('cannot close without them');
  });
});
