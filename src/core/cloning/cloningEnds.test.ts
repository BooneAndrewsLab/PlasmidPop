import { describe, expect, it } from 'vitest';

import { SeqDocument, createFeature, featureLength, rangeSegment } from '@/core';
import { parseGenBank, writeGenBank } from '@/io';
import { readFixture } from '@/test/fixtures';
import { randomDna, seededRandom } from '@/test/random';

import { METHYLATED_HOST, UNMETHYLATED_HOST } from '../analysis/methylation';
import { findCutSites, getEnzyme } from '../analysis/restriction';
import { meltingTemperature } from '../primers/thermo';
import { reverseComplement } from '../sequence';
import {
  type CloningContext,
  type CloningInsert,
  type EnzymePairReport,
  cloningPrimerNames,
  describePairIssue,
  designCloningEnds,
  designCloningResults,
  evaluateEnzymePair,
  insertSequence,
  resolveVectorRegion,
  scanForCloning,
  scanForCloningNow,
  suggestEnzymePairs,
} from './cloningEnds';
import { endFlank } from './endFlanks';

/**
 * Restriction-cloning ends (#303, item 108) on pUC19 and real inserts from
 * U49845: the AXL2 CDS (687..3158) on the forward strand, and the CDS at
 * complement(3300..4037) read as its own strand. pUC19's polylinker runs
 * EcoRI SacI KpnI SmaI BamHI XbaI SalI PstI SphI HindIII, 0-based 395..452.
 */

function fixture(name: string): SeqDocument {
  const doc = parseGenBank(readFixture(name)).documents[0];
  if (doc === undefined) throw new Error(`${name}: no record`);
  return doc;
}

const pUC19 = fixture('L09137.gb');
const U49845 = fixture('U49845.gb');
const MCS = { start: 395, end: 452 };

const AXL2: CloningInsert = {
  document: U49845,
  range: { start: 686, end: 3158 },
  strand: 'forward',
  name: 'AXL2',
};
const REV: CloningInsert = {
  document: U49845,
  range: { start: 3299, end: 4037 },
  strand: 'reverse',
  name: 'REV',
};

function context(
  vector: SeqDocument,
  insert: CloningInsert,
  options: {
    readonly region?: { start: number; end: number } | null;
    readonly flipped?: boolean;
  } = {},
): CloningContext {
  return {
    vector,
    region: resolveVectorRegion(vector, options.region === undefined ? MCS : options.region),
    insert,
    flipped: options.flipped ?? false,
    scans: scanForCloningNow(vector, insert),
  };
}

function sameCircle(a: string, b: string): boolean {
  return a.length === b.length && (a + a).toUpperCase().includes(b.toUpperCase());
}

function wrapped(text: string, from: number, to: number): string {
  const L = text.length;
  let out = '';
  for (let i = from; i < to; i++) out += text.charAt(((i % L) + L) % L);
  return out;
}

/** The site of `enzyme` on `doc` as `findCutSites` finds it; the only one, or the caller is wrong. */
function siteOf(doc: SeqDocument, enzyme: string) {
  const e = getEnzyme(enzyme);
  if (e === undefined) throw new Error(enzyme);
  const sites = findCutSites(doc.sequence.toString(), doc.topology, [e]);
  const site = sites[0];
  if (site === undefined || sites.length !== 1) throw new Error(`${enzyme}: ${sites.length} sites`);
  return { ...site, length: e.site.length };
}

/**
 * What cloning between two Type IIP sites makes, by construction: the
 * vector up to the end of the lower site, the insert, the vector from the
 * start of the higher site (both sites come back whole at the junctions).
 */
function expectedProduct(
  vector: SeqDocument,
  lower: string,
  higher: string,
  insert: string,
): string {
  const text = vector.sequence.toString();
  const a = siteOf(vector, lower);
  const b = siteOf(vector, higher);
  const L = text.length;
  const aEnd = a.siteStart + a.length;
  const bStart = b.siteStart;
  // Origin first when the vector's base 0 is not in the replaced stretch;
  // otherwise the backbone round from the higher site, to compare as a circle.
  return bStart > aEnd
    ? text.slice(0, aEnd) + insert + text.slice(bStart)
    : wrapped(text, bStart, aEnd + L) + insert;
}

function kinds(p: EnzymePairReport): string[] {
  return p.issues.map((i) => i.kind);
}

function pair(
  s: { readonly pairs: readonly EnzymePairReport[] },
  f: string,
  r: string,
): EnzymePairReport {
  const found = s.pairs.find((p) => p.forward.enzyme === f && p.reverse.enzyme === r);
  if (found === undefined) throw new Error(`no pair ${f} · ${r}`);
  return found;
}

describe('resolveVectorRegion', () => {
  it('takes a selection as given', () => {
    const r = resolveVectorRegion(pUC19, MCS);
    expect(r).toEqual({ range: MCS, source: 'given', feature: null });
  });

  it('falls back to the whole molecule when nothing names the cloning site', () => {
    const r = resolveVectorRegion(pUC19, null);
    expect(r.source).toBe('whole');
    expect(r.range).toEqual({ start: 0, end: pUC19.length });
  });

  it('uses the one feature named as the MCS, but not two', () => {
    const mcs = createFeature({
      type: 'misc_feature',
      name: 'MCS',
      segments: [rangeSegment(MCS.start, MCS.end)],
    });
    const one = pUC19.addFeature(mcs);
    expect(resolveVectorRegion(one, null)).toMatchObject({ range: MCS, source: 'mcs' });
    const polylinker = createFeature({
      type: 'misc_feature',
      name: 'polylinker',
      segments: [rangeSegment(390, 460)],
    });
    expect(resolveVectorRegion(one.addFeature(polylinker), null).source).toBe('whole');
    expect(resolveVectorRegion(pUC19.addFeature(polylinker), null).source).toBe('mcs');
    expect(resolveVectorRegion(one, { start: 10, end: 10 }).source).toBe('mcs');
  });
});

describe('insertSequence', () => {
  it('reads a reverse-strand insert as its own strand', () => {
    expect(insertSequence(AXL2)).toBe(U49845.subsequence(AXL2.range));
    expect(insertSequence(REV)).toBe(reverseComplement(U49845.subsequence(REV.range)));
  });
});

describe('suggestEnzymePairs on pUC19', () => {
  const ctx = context(pUC19, AXL2);
  const s = suggestEnzymePairs(ctx);

  it('lists the polylinker enzymes as candidates and ranks usable pairs first', () => {
    for (const name of [
      'EcoRI',
      'SacI',
      'KpnI',
      'BamHI',
      'XbaI',
      'SalI',
      'PstI',
      'SphI',
      'HindIII',
    ]) {
      expect(s.candidates).toContain(name);
    }
    expect(s.usable).toBeGreaterThan(0);
    expect(s.pairs.slice(0, s.usable).every((p) => p.usable)).toBe(true);
    expect(s.pairs.slice(s.usable).every((p) => !p.usable)).toBe(true);
    // Wider stretch between the cuts first.
    const spacing = s.pairs
      .slice(0, s.usable)
      .map((p) => (p.replaced === null ? -1 : p.replaced.end - p.replaced.start));
    expect([...spacing].sort((a, b) => b - a)).toEqual(spacing);
  });

  it('a usable pair cuts the vector once each inside the region, sticky, directional, clear of the insert', () => {
    for (const p of s.pairs.filter((x) => x.usable)) {
      for (const end of [p.forward, p.reverse]) {
        expect(end.vectorCuts).toBe(1);
        expect(end.site).not.toBeNull();
        expect(end.end?.kind).not.toBe('blunt');
        expect(end.insertCuts).toEqual([]);
        expect(end.blocked).toEqual([]);
        expect(end.typeIIS).toBe(false);
      }
      expect(p.forward.enzyme).not.toBe(p.reverse.enzyme);
      expect(p.orientation).toBe('forward');
      expect(p.replaced).not.toBeNull();
    }
    expect(pair(s, 'KpnI', 'BamHI')).toMatchObject({
      usable: true,
      replaced: { start: 412, end: 417 },
    });
    expect(pair(s, 'SacI', 'PstI').usable).toBe(true);
  });

  it('excludes pairs with the reasons the page shows', () => {
    // EcoRI cuts AXL2 once (the oracle agrees: scripts/oracle/cloningends.py).
    expect(pair(s, 'EcoRI', 'BamHI').issues).toEqual([
      { kind: 'cutsInsert', enzyme: 'EcoRI', positions: [715] },
    ]);
    expect(kinds(pair(s, 'BamHI', 'BamHI'))).toEqual(['sameEnzyme']);
    expect(kinds(pair(s, 'KpnI', 'SmaI'))).toContain('blunt');
    expect(kinds(pair(s, 'KpnI', 'BfuAI'))).toEqual(['typeIIS']);
    // SacI and KpnI are back to back: neither has the flank it wants once the other has cut.
    const close = pair(s, 'SacI', 'KpnI');
    expect(kinds(close)).toEqual(['tooClose', 'tooClose']);
    expect(close.issues[1]).toEqual({
      kind: 'tooClose',
      enzyme: 'KpnI',
      flank: 1,
      needed: endFlank('KpnI'),
    });
    // Sau3AI cuts all over the vector and is blocked by Dam at some sites; MboI's GATC inside BamHI is.
    expect(kinds(pair(s, 'KpnI', 'MboI'))).toContain('vectorCuts');
    expect(kinds(pair(s, 'KpnI', 'MboI'))).toContain('methylation');
    for (const p of s.pairs) {
      for (const issue of p.issues) expect(describePairIssue(issue)).toMatch(/\w/);
    }
  });

  it('flipped, the forward primer takes the higher cut', () => {
    const flipped = suggestEnzymePairs(context(pUC19, AXL2, { flipped: true }));
    const p = pair(flipped, 'BamHI', 'KpnI');
    expect(p).toMatchObject({
      usable: true,
      orientation: 'reverse',
      replaced: { start: 412, end: 417 },
    });
    const names = (list: readonly EnzymePairReport[], swap: boolean): string[] =>
      list
        .filter((x) => x.usable)
        .map((x) =>
          swap
            ? `${x.reverse.enzyme}-${x.forward.enzyme}`
            : `${x.forward.enzyme}-${x.reverse.enzyme}`,
        )
        .sort();
    expect(names(flipped.pairs, false)).toEqual(names(s.pairs, true));
  });

  it('with the whole plasmid as the region, only single cutters are candidates', () => {
    const whole = suggestEnzymePairs(context(pUC19, AXL2, { region: null }));
    expect(whole.candidates).toContain('EcoRI');
    expect(whole.candidates).not.toContain('MboI');
    expect(whole.candidates).not.toContain('AluI');
    expect(whole.candidates.every((name) => getEnzyme(name) !== undefined)).toBe(true);
    expect(whole.pairs.every((p) => p.forward.vectorCuts === 1 && p.reverse.vectorCuts === 1)).toBe(
      true,
    );
  });

  it('re-judges a picked pair after the insert changed (decision 8)', () => {
    const short: CloningInsert = { ...REV, range: { start: 3299, end: 3600 } };
    const picked = { forward: 'EcoRI', reverse: 'PstI' };
    expect(suggestEnzymePairs(context(pUC19, short), picked).picked?.usable).toBe(true);
    const again = suggestEnzymePairs(context(pUC19, REV), picked);
    expect(again.picked?.usable).toBe(false);
    expect(again.picked?.issues).toEqual([
      { kind: 'cutsInsert', enzyme: 'EcoRI', positions: [346] },
    ]);
  });

  it('judges any two enzymes, known or not', () => {
    expect(kinds(evaluateEnzymePair(ctx, 'Nope', 'BamHI'))).toEqual(['unknownEnzyme']);
    // BsaI cuts pUC19 once, in bla, outside the region.
    expect(kinds(evaluateEnzymePair(ctx, 'BsaI', 'BamHI'))).toEqual(['outsideRegion', 'typeIIS']);
    expect(kinds(evaluateEnzymePair(ctx, 'NotI', 'BamHI'))).toEqual(['vectorCuts']);
  });
});

describe('designCloningEnds on pUC19', () => {
  const ctx = context(pUC19, AXL2);
  const design = designCloningEnds(ctx, { forward: 'KpnI', reverse: 'BamHI' });

  it('makes padding + site + annealing on each primer, named for Save both', () => {
    expect(design.problem).toBeNull();
    expect(cloningPrimerNames('AXL2', 'KpnI', 'BamHI')).toEqual({
      forward: 'AXL2-F-KpnI',
      reverse: 'AXL2-R-BamHI',
    });
    const { forward, reverse } = design;
    expect(forward.name).toBe('AXL2-F-KpnI');
    expect(reverse.name).toBe('AXL2-R-BamHI');
    expect(forward.segments.site).toBe('GGTACC');
    expect(reverse.segments.site).toBe('GGATCC');
    for (const p of [forward, reverse]) {
      expect(p.segments.padding).toHaveLength(6);
      expect(p.segments.spacer).toBe('');
      expect(p.paddingRaised).toBeNull();
      expect(p.sequence).toBe(
        (p.segments.padding + p.segments.site).toLowerCase() + p.segments.annealing.toUpperCase(),
      );
      expect(p.tm).toBeCloseTo(meltingTemperature(p.segments.annealing), 6);
      expect(p.annealing.length).toBe(p.segments.annealing.length);
    }
    const insert = insertSequence(AXL2).toUpperCase();
    expect(insert.startsWith(forward.segments.annealing)).toBe(true);
    expect(insert.endsWith(reverseComplement(reverse.segments.annealing))).toBe(true);
    expect(design.productLength).toBe(insert.length + 24);
    expect(design.amplicon).toHaveLength(design.productLength);
    expect(design.warnings.filter((w) => w.severity === 'danger')).toEqual([]);
  });

  it('simulates the product: PCR, both digests, the ligation, with the vector numbering kept', () => {
    const sim = design.simulate();
    expect(sim.problem).toBeNull();
    const product = sim.product;
    if (product === null) throw new Error('no product');
    expect(product.isCircular).toBe(true);
    const expected = expectedProduct(pUC19, 'KpnI', 'BamHI', insertSequence(AXL2));
    expect(product.length).toBe(expected.length);
    expect(product.sequence.toString().toUpperCase()).toBe(expected.toUpperCase());
    expect(product.name).toBe(`${pUC19.name}-AXL2`);
    expect(sim.amplicon?.length).toBe(design.productLength);
    // The insert's own feature came along.
    expect(product.features.all().some((f) => f.type === 'CDS' && featureLength(f) === 2472)).toBe(
      true,
    );
  });

  it('round-trips the product through GenBank', () => {
    const product = design.simulate().product;
    if (product === null) throw new Error('no product');
    const back = parseGenBank(writeGenBank(product)).documents[0];
    expect(back?.sequence.toString().toUpperCase()).toBe(product.sequence.toString().toUpperCase());
    expect(back?.topology).toBe('circular');
  });

  it('flipped, the insert goes in reverse-complemented', () => {
    const flipped = designCloningEnds(context(pUC19, AXL2, { flipped: true }), {
      forward: 'BamHI',
      reverse: 'KpnI',
    });
    expect(flipped.pair.orientation).toBe('reverse');
    expect(flipped.forward.segments.site).toBe('GGATCC');
    const product = flipped.simulate().product;
    if (product === null) throw new Error('no product');
    const expected = expectedProduct(
      pUC19,
      'KpnI',
      'BamHI',
      reverseComplement(insertSequence(AXL2)),
    );
    expect(product.sequence.toString().toUpperCase()).toBe(expected.toUpperCase());
  });

  it('a reverse-strand insert reads as its own strand in the product', () => {
    const d = designCloningEnds(context(pUC19, REV), { forward: 'BamHI', reverse: 'PstI' });
    expect(d.problem).toBeNull();
    const insert = insertSequence(REV);
    expect(d.forward.segments.annealing).toBe(
      insert.slice(0, d.forward.annealing.length).toUpperCase(),
    );
    const product = d.simulate().product;
    if (product === null) throw new Error('no product');
    expect(product.sequence.toString().toUpperCase()).toBe(
      expectedProduct(pUC19, 'BamHI', 'PstI', insert).toUpperCase(),
    );
  });

  it('with the region across the origin, the same product comes out', () => {
    const turned = pUC19.setOrigin(420);
    const region = { start: MCS.start - 420 + pUC19.length, end: MCS.end - 420 + pUC19.length };
    const ctxTurned = context(turned, AXL2, { region });
    const s = suggestEnzymePairs(ctxTurned);
    expect(pair(s, 'KpnI', 'BamHI').usable).toBe(true);
    expect(s.pairs.filter((p) => p.usable).length).toBe(
      suggestEnzymePairs(ctx).pairs.filter((p) => p.usable).length,
    );
    const product = designCloningEnds(ctxTurned, { forward: 'KpnI', reverse: 'BamHI' }).simulate()
      .product;
    if (product === null) throw new Error('no product');
    expect(
      sameCircle(
        product.sequence.toString(),
        expectedProduct(pUC19, 'KpnI', 'BamHI', insertSequence(AXL2)),
      ),
    ).toBe(true);
    // The cut lies across the vector's origin: its first base survives, so it stays base 0.
    expect(product.sequence.toString().slice(0, 40).toUpperCase()).toBe(
      turned.sequence.toString().slice(0, 40).toUpperCase(),
    );
  });

  it('an override that cuts the insert warns in red and the simulation says what happened', () => {
    const d = designCloningEnds(ctx, { forward: 'EcoRI', reverse: 'BamHI' });
    expect(d.problem).toBeNull();
    expect(d.warnings).toContainEqual(
      expect.objectContaining({ kind: 'cutsInsert', severity: 'danger', enzyme: 'EcoRI' }),
    );
    const sim = d.simulate();
    expect(sim.product).toBeNull();
    expect(sim.problem).toMatch(/EcoRI cuts inside the insert/);
    expect(sim.amplicon).not.toBeNull();
  });

  it('one enzyme on both ends is allowed with a warning, and goes in forward', () => {
    const d = designCloningEnds(ctx, { forward: 'BamHI', reverse: 'BamHI' });
    expect(d.warnings.map((w) => w.kind)).toContain('sameEnzyme');
    const product = d.simulate().product;
    if (product === null) throw new Error('no product');
    const text = pUC19.sequence.toString();
    const site = siteOf(pUC19, 'BamHI');
    const expected =
      text.slice(0, site.siteStart + 6) + insertSequence(AXL2) + text.slice(site.siteStart);
    expect(product.sequence.toString().toUpperCase()).toBe(expected.toUpperCase());
  });

  it('Type IIS by override: the site points into the insert and the vector overhang is copied', () => {
    const d = designCloningEnds(ctx, { forward: 'KpnI', reverse: 'BfuAI' });
    expect(d.problem).toBeNull();
    expect(d.warnings.map((w) => w.kind)).toContain('typeIIS');
    expect(d.warnings.filter((w) => w.severity === 'danger')).toEqual([]);
    const bfuAI = siteOf(pUC19, 'BfuAI');
    expect(bfuAI).toMatchObject({ siteStart: 432, cut: 442, cutBottom: 446, strand: 'forward' });
    const { reverse } = d;
    expect(reverse.segments.site).toBe('ACCTGC');
    expect(reverse.segments.spacer).toHaveLength(8);
    const overhang = pUC19.subsequence({ start: 442, end: 446 });
    expect(reverse.segments.spacer.slice(4)).toBe(reverseComplement(overhang).toUpperCase());
    const product = d.simulate().product;
    if (product === null) throw new Error('no product');
    const text = pUC19.sequence.toString();
    const kpnI = siteOf(pUC19, 'KpnI');
    const expected = text.slice(0, kpnI.siteStart + 6) + insertSequence(AXL2) + text.slice(442);
    expect(product.sequence.toString().toUpperCase()).toBe(expected.toUpperCase());
  });

  it('fails plainly when an enzyme has no cut in the region or the insert is too short', () => {
    const d = designCloningEnds(ctx, { forward: 'NotI', reverse: 'BamHI' });
    expect(d.problem).toMatch(/NotI does not cut the vector inside the region/);
    expect(d.forward.sequence).toBe('');
    expect(d.simulate().problem).toBe(d.problem);
    const tiny = designCloningEnds(context(pUC19, { ...AXL2, range: { start: 686, end: 716 } }), {
      forward: 'KpnI',
      reverse: 'BamHI',
    });
    expect(tiny.problem).toMatch(/too short/);
  });

  it('designs the picked pair and up to five alternatives', () => {
    const results = designCloningResults(
      ctx,
      { forward: 'KpnI', reverse: 'BamHI' },
      { maxAlternatives: 3 },
    );
    expect(results.picked.pair.forward.enzyme).toBe('KpnI');
    expect(results.alternatives).toHaveLength(3);
    const s = suggestEnzymePairs(ctx);
    const top = s.pairs
      .filter((p) => p.usable && !(p.forward.enzyme === 'KpnI' && p.reverse.enzyme === 'BamHI'))
      .slice(0, 3);
    expect(results.alternatives.map((d) => [d.forward.enzyme, d.reverse.enzyme])).toEqual(
      top.map((p) => [p.forward.enzyme, p.reverse.enzyme]),
    );
    for (const alt of results.alternatives) expect(alt.simulate().problem).toBeNull();
  });

  it('raises the padding to the enzyme minimum and says so', () => {
    // NotI wants 8 bases (endFlanks.ts): put one site in a synthetic vector.
    const rand = seededRandom(108);
    const backbone = randomDna(rand, 1200);
    const text = `${backbone.slice(0, 600)}GAATTC${randomDna(rand, 12)}GCGGCCGC${backbone.slice(600)}`;
    const vector = SeqDocument.create({ name: 'pNot', sequence: text, topology: 'circular' });
    const insert: CloningInsert = {
      ...AXL2,
      range: { start: 3299, end: 3600 },
      strand: 'reverse',
      name: 'bit',
    };
    const c = context(vector, insert, { region: { start: 600, end: 626 } });
    const d = designCloningEnds(c, { forward: 'EcoRI', reverse: 'NotI' });
    expect(d.problem).toBeNull();
    expect(d.reverse.paddingRaised).toBe(8);
    expect(d.reverse.segments.padding).toHaveLength(8);
    expect(d.forward.paddingRaised).toBeNull();
    expect(d.warnings).toContainEqual(
      expect.objectContaining({ kind: 'paddingRaised', enzyme: 'NotI' }),
    );
    expect(
      designCloningEnds(c, { forward: 'EcoRI', reverse: 'NotI' }, { padding: 10 }).reverse
        .paddingRaised,
    ).toBeNull();
  });
});

describe('methylation', () => {
  // XbaI's TCTAGA followed by TC puts a Dam GATC over its last bases.
  const rand = seededRandom(303);
  const backbone = randomDna(rand, 1000);
  const text = `${backbone.slice(0, 500)}GAATTC${randomDna(rand, 10)}TCTAGATC${randomDna(rand, 10)}GGATCC${backbone.slice(500)}`;
  const region = { start: 500, end: 540 };
  const vector = SeqDocument.create({ name: 'pDam', sequence: text, topology: 'circular' });
  const source = SeqDocument.create({
    name: 'src',
    sequence: `${randomDna(rand, 100)}ATGGCTAGCAAGCTGACCGTTGAAGACTCTAGATCGGTAGCTGACGTTCCTGAAGGCTTGACCGCTGTAGTCGGAAGTCACGTACGATGCAGTTCGACCTGATCAGCTGGTTACCGTAAGCACTGGCATCGTTGAAGCCTGCAGTAGCTTCGTTAGCGGATTCAGCAGCTGTTCAGGCATGGCTAAGCTTGACTTGGTCGTAAGCTTCGACCACGGTAACGTCGTAGATGCTGAAG${randomDna(rand, 100)}`,
    topology: 'linear',
    methylation: METHYLATED_HOST,
  });
  // The whole stretch, with TCTAGATC near its start; and the part after it.
  const insert: CloningInsert = {
    document: source,
    range: { start: 100, end: source.length - 100 },
    strand: 'forward',
    name: 'ins',
  };
  const clean: CloningInsert = { ...insert, range: { start: 140, end: source.length - 100 } };

  it('blocks the vector site in a dam+ host and not in a dam− one', () => {
    expect(insertSequence(clean).toUpperCase()).not.toContain('TCTAGA');
    const blocked = evaluateEnzymePair(context(vector, clean, { region }), 'EcoRI', 'XbaI');
    expect(blocked.reverse.blocked).toEqual(['Dam']);
    expect(kinds(blocked)).toEqual(['methylation']);
    const clear = evaluateEnzymePair(
      context(vector.setMethylation(UNMETHYLATED_HOST), clean, { region }),
      'EcoRI',
      'XbaI',
    );
    expect(clear.reverse.blocked).toEqual([]);
    expect(clear.usable).toBe(true);
    expect(
      designCloningEnds(context(vector.setMethylation(UNMETHYLATED_HOST), clean, { region }), {
        forward: 'EcoRI',
        reverse: 'XbaI',
      }).simulate().problem,
    ).toBeNull();
    // Simulated on the dam+ vector, the digest does not cut there.
    const sim = designCloningEnds(context(vector, clean, { region }), {
      forward: 'EcoRI',
      reverse: 'XbaI',
    }).simulate();
    expect(sim.product).toBeNull();
    expect(sim.problem).toMatch(/XbaI does not cut pDam.*Dam/);
  });

  it('never blocks a site in the insert: the PCR product is unmethylated', () => {
    const c = context(vector.setMethylation(UNMETHYLATED_HOST), insert, { region });
    const bamHI = evaluateEnzymePair(c, 'EcoRI', 'BamHI');
    expect(kinds(bamHI)).toEqual([]);
    // The insert carries TCTAGATC too, inside a dam+ document: the scan reports it all the same.
    const inside = insertSequence(insert).toUpperCase().indexOf('TCTAGATC');
    expect(inside).toBeGreaterThan(0);
    const xbaI = evaluateEnzymePair(c, 'EcoRI', 'XbaI');
    expect(xbaI.reverse.insertCuts).toEqual([inside + 1]);
    expect(kinds(xbaI)).toEqual(['cutsInsert']);
    const sim = designCloningEnds(c, { forward: 'EcoRI', reverse: 'XbaI' }).simulate();
    expect(sim.product).toBeNull();
    expect(sim.problem).toMatch(/XbaI cuts inside the insert/);
  });
});

describe('scanForCloning', () => {
  it('asks the scanner for the vector and the insert stretch alone', async () => {
    const asked: string[] = [];
    const scans = await scanForCloning(
      {
        cutSites: (sequence, topology) => {
          asked.push(`${topology}:${sequence.length}`);
          return Promise.resolve(findCutSites(sequence, topology));
        },
      },
      pUC19,
      REV,
    );
    expect(asked).toEqual([`circular:${pUC19.length}`, 'linear:738']);
    expect(scans).toEqual(scanForCloningNow(pUC19, REV));
  });
});
