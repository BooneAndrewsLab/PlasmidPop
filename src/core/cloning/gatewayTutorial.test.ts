import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { type SeqDocument, attSites, findOrfs, gateway, recordGateway, translate } from '@/core';
import { parseGenBank } from '@/io/genbank/parseGenBank';
import { writeGenBank } from '@/io/genbank/writeGenBank';

/**
 * Verifies docs/tutorials/gateway.md: the files it hands out and every
 * number it prints, through the function the Gateway panel calls. The att
 * sites in the files are invented (two arms around a 15 base core); the app
 * carries no att sequences, and the tests below depend only on partners
 * sharing a core.
 */

const DIR = join(__dirname, '../../../docs/tutorials/files');
function tut(name: string): SeqDocument {
  const doc = parseGenBank(readFileSync(join(DIR, `${name}.gb`), 'utf8')).documents[0];
  if (doc === undefined) throw new Error(name);
  return doc;
}
const seq = (doc: SeqDocument): string => doc.sequence.toString().toUpperCase();
const names = (doc: SeqDocument): string[] => [...doc.features].map((f) => f.name);
const count = (doc: SeqDocument, name: string): number =>
  names(doc).filter((n) => n === name).length;
const feature = (doc: SeqDocument, name: string) => {
  const f = [...doc.features].find((x) => x.name === name);
  if (f === undefined) throw new Error(`${doc.name} has no ${name}`);
  return f;
};
/** One-based inclusive start and end of a feature's first segment. */
const span = (doc: SeqDocument, name: string): [number, number] => {
  const s = feature(doc, name).segments[0];
  if (s?.kind !== 'range') throw new Error(name);
  return [s.start + 1, s.end];
};
/** Text of the att site of a document, read the way the core reads it. */
const site = (doc: SeqDocument, name: string): string => {
  const s = attSites(doc).find((a) => `att${a.kind}${a.number}` === name);
  if (s === undefined) throw new Error(`${doc.name} has no ${name}`);
  return doc.subsequence(s.range).toUpperCase();
};
/** Longest common substring of two strings, which for partner sites is their core. */
function core(a: string, b: string): number {
  let best = 0;
  let prev = new Array<number>(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i++) {
    const row = new Array<number>(b.length + 1).fill(0);
    for (let j = 1; j <= b.length; j++) {
      if (a[i - 1] !== b[j - 1]) continue;
      row[j] = (prev[j - 1] ?? 0) + 1;
      best = Math.max(best, row[j] ?? 0);
    }
    prev = row;
  }
  return best;
}
/** True when `piece` occurs in the circle read from some point round. */
const inCircle = (circle: SeqDocument, piece: string): boolean =>
  (seq(circle) + seq(circle)).includes(piece);

const FILES = ['GW-Insert', 'GW-pDONR', 'GW-pDEST', 'GW-bad-pDEST'];
const insert = tut('GW-Insert');
const donor = tut('GW-pDONR');
const dest = tut('GW-pDEST');
const bp = gateway(insert, donor, 'BP');
const entry = bp.product;
if (entry === null) throw new Error('BP made nothing');
const lr = gateway(entry, dest, 'LR');
const expression = lr.product;
const byproduct = lr.byproduct;
if (expression === null || byproduct === null) throw new Error('LR made nothing');

describe('gateway.md: the files', () => {
  it.each(FILES)('%s parses, round-trips and says it is synthetic', (f) => {
    const doc = tut(f);
    expect(doc.metadata.description).toMatch(/synthetic/i);
    const again = parseGenBank(writeGenBank(doc)).documents[0];
    expect(again?.sequence.toString()).toBe(doc.sequence.toString());
    expect(names(again ?? doc)).toEqual(names(doc));
    expect(again?.topology).toBe(doc.topology);
  });

  it('are the sizes, topologies and features the page gives', () => {
    expect(FILES.map((f) => tut(f).length)).toEqual([422, 1390, 1837, 1837]);
    expect(FILES.map((f) => tut(f).topology)).toEqual([
      'linear',
      'circular',
      'circular',
      'circular',
    ]);
    expect(span(insert, 'attB1')).toEqual([1, 25]);
    expect(span(insert, 'synthGene')).toEqual([32, 391]);
    expect(span(insert, 'attB2')).toEqual([398, 422]);
    expect(span(donor, 'attP1')).toEqual([41, 95]);
    expect(span(donor, 'ccdB')).toEqual([106, 405]);
    expect(span(donor, 'attP2')).toEqual([416, 470]);
    expect(span(donor, 'KanR')).toEqual([531, 920]);
    expect(span(dest, 'attR1')).toEqual([123, 162]);
    expect(span(dest, 'ccdB')).toEqual([173, 472]);
    expect(span(dest, 'CmR')).toEqual([481, 780]);
    expect(span(dest, 'attR2')).toEqual([791, 830]);
    expect(span(dest, 'AmpR')).toEqual([948, 1367]);
    expect(span(tut('GW-bad-pDEST'), 'attR3')).toEqual([791, 830]);
  });

  it('annotate their att sites: attB 25 bp, attP 55 bp, attR 40 bp, as the pickers list them', () => {
    const describe = (d: SeqDocument): string[] =>
      attSites(d).map((s) => `att${s.kind}${s.number}:${s.range.end - s.range.start}`);
    expect(describe(insert)).toEqual(['attB1:25', 'attB2:25']);
    expect(describe(donor)).toEqual(['attP1:55', 'attP2:55']);
    expect(describe(dest)).toEqual(['attR1:40', 'attR2:40']);
    expect(describe(tut('GW-bad-pDEST'))).toEqual(['attR1:40', 'attR3:40']);
  });

  it('partner sites share exactly a 15 base core, and the two cores differ', () => {
    expect(core(site(insert, 'attB1'), site(donor, 'attP1'))).toBe(15);
    expect(core(site(insert, 'attB2'), site(donor, 'attP2'))).toBe(15);
    expect(core(site(insert, 'attB1'), site(donor, 'attP2'))).toBeLessThan(10);
    expect(core(site(insert, 'attB2'), site(donor, 'attP1'))).toBeLessThan(10);
  });

  it('the gene is 120 codons, ATG to a stop; the stand-in genes carry no att site', () => {
    const gene = seq(insert).slice(31, 391);
    expect(translate(gene)).toHaveLength(120);
    expect(translate(gene).startsWith('M')).toBe(true);
    expect(translate(gene).indexOf('*')).toBe(119);
    expect(seq(insert).slice(0, 25)).toBe(site(insert, 'attB1'));
  });
});

describe('gateway.md: Tutorial 1, the BP reaction', () => {
  it('runs without a problem and with one warning, the ccdB sentence', () => {
    expect(bp.problem).toBeNull();
    expect(bp.warnings).toEqual([
      'The ccdB cassette of GW-pDONR leaves on the byproduct, so an entry clone that grows in an ordinary strain is the one you want; a ccdB-resistant strain (DB3.1) grows both.',
    ]);
  });

  it('a linear substrate makes no byproduct circle', () => {
    expect(bp.byproduct).toBeNull();
  });

  it('the entry clone is 1,412 bp, circular, named as the panel names it', () => {
    expect(entry.length).toBe(1412);
    expect(entry.topology).toBe('circular');
    expect(entry.name).toBe('GW-Insert × GW-pDONR BP');
    expect(names(entry)).toEqual(['synthGene', 'KanR', 'ori', 'attL1', 'attL2']);
  });

  it('is 397 bp of insert and 1,015 bp of donor backbone; 400 bp of the 1,812 are left out', () => {
    // The insert from the middle of the attB1 core to the middle of the attB2 core.
    expect(422 - 12 - 13).toBe(397);
    expect(inCircle(entry, seq(insert).slice(12, 422 - 13))).toBe(true);
    // The donor outside the cassette, which runs from the middle of the attP1 core to the middle of attP2.
    const cassette = 415 + 27 - (40 + 27);
    expect(cassette).toBe(375);
    expect(1390 - cassette).toBe(1015);
    expect(397 + 1015).toBe(1412);
    expect(422 + 1390 - 1412).toBe(400);
    expect(cassette + 12 + 13).toBe(400);
  });

  it('KanR and ori came with the backbone, once each; ccdB stayed behind', () => {
    expect(count(entry, 'KanR')).toBe(1);
    expect(count(entry, 'ori')).toBe(1);
    expect(count(entry, 'ccdB')).toBe(0);
    expect(count(entry, 'synthGene')).toBe(1);
    expect(feature(entry, 'KanR').strand).toBe('reverse');
  });

  it('attL1 and attL2 are 40 bp each, half of an attB and half of an attP', () => {
    const l1 = site(entry, 'attL1');
    const l2 = site(entry, 'attL2');
    expect(l1).toHaveLength(40);
    expect(l2).toHaveLength(40);
    expect(l1).toBe(site(donor, 'attP1').slice(0, 27) + site(insert, 'attB1').slice(12));
    expect(l2).toBe(site(insert, 'attB2').slice(0, 12) + site(donor, 'attP2').slice(27));
    // What it shares with the attB1 it came from: the core and the 5 bp arm on the gene side.
    expect(core(l1, site(insert, 'attB1'))).toBe(20);
  });

  it('attL1 runs across the origin: the sites are listed attL2 first', () => {
    const l1 = attSites(entry).find((a) => a.number === '1');
    expect(l1?.range.end).toBeGreaterThan(entry.length);
    expect(attSites(entry).map((a) => `att${a.kind}${a.number}`)).toEqual(['attL2', 'attL1']);
  });

  it('the gene is whole, in one piece, between the two sites', () => {
    const gene = seq(insert).slice(31, 391);
    expect(inCircle(entry, gene)).toBe(true);
    const [start, end] = span(entry, 'synthGene');
    expect(end - start + 1).toBe(360);
    expect(span(entry, 'attL2')[0]).toBe(386);
    expect(start).toBe(20);
    expect(
      findOrfs(seq(entry), 'circular', { minCodons: 100 }).map((o) => o.range.start),
    ).toContain(19);
  });

  it('Open clone records how it was made: the Gateway BP with its two molecules', () => {
    const opened = recordGateway(entry, insert, donor, 'BP', false);
    expect(opened.length).toBe(1412);
    expect(opened.metadata.lineage).not.toBeNull();
  });
});

describe('gateway.md: Tutorial 2, the LR reaction', () => {
  it('runs without a problem and with the one ccdB sentence for the destination', () => {
    expect(lr.problem).toBeNull();
    expect(lr.warnings).toEqual([
      'The ccdB cassette of GW-pDEST leaves on the byproduct, so an expression clone that grows in an ordinary strain is the one you want; a ccdB-resistant strain (DB3.1) grows both.',
    ]);
  });

  it('the expression clone is 1,551 bp, circular', () => {
    expect(expression.length).toBe(1551);
    expect(expression.topology).toBe('circular');
    expect(expression.name).toBe('GW-Insert × GW-pDONR BP × GW-pDEST LR');
    expect(names(expression)).toEqual([
      'synthGene',
      'synthetic promoter',
      'synthetic terminator',
      'AmpR',
      'ori',
      'attB1',
      'attB2',
    ]);
  });

  it('the byproduct is 1,698 bp, circular, and the two circles hold the 3,249 bp that went in', () => {
    expect(byproduct.length).toBe(1698);
    expect(byproduct.topology).toBe('circular');
    expect(byproduct.name).toBe('GW-Insert × GW-pDONR BP × GW-pDEST LR byproduct');
    expect(1412 + 1837).toBe(3249);
    expect(expression.length + byproduct.length).toBe(3249);
    expect(names(byproduct)).toEqual(['ccdB', 'CmR', 'KanR', 'ori', 'attP1', 'attP2']);
  });

  it('the markers swap: AmpR with the expression clone; ccdB, CmR and KanR with the byproduct', () => {
    for (const n of ['AmpR', 'ori', 'synthGene']) expect(count(expression, n)).toBe(1);
    for (const n of ['ccdB', 'CmR', 'KanR']) expect(count(expression, n)).toBe(0);
    for (const n of ['ccdB', 'CmR', 'KanR', 'ori']) expect(count(byproduct, n)).toBe(1);
    for (const n of ['AmpR', 'synthGene']) expect(count(byproduct, n)).toBe(0);
  });

  it('the recombinant sites are attB again: 25 bp, the very bases the PCR product had', () => {
    expect(site(expression, 'attB1')).toHaveLength(25);
    expect(site(expression, 'attB2')).toHaveLength(25);
    expect(site(expression, 'attB1')).toBe(site(insert, 'attB1'));
    expect(site(expression, 'attB2')).toBe(site(insert, 'attB2'));
  });

  it('the byproduct sites are attP again: 55 bp, the donor’s own', () => {
    expect(site(byproduct, 'attP1')).toHaveLength(55);
    expect(site(byproduct, 'attP1')).toBe(site(donor, 'attP1'));
    expect(site(byproduct, 'attP2')).toBe(site(donor, 'attP2'));
  });

  it('the gene sits whole between the promoter and the terminator: 6 bp after attB1, 12 bp before the terminator', () => {
    const gene = seq(insert).slice(31, 391);
    expect(inCircle(expression, gene)).toBe(true);
    const L = expression.length;
    const [pStart] = span(expression, 'synthetic promoter');
    const b1 = attSites(expression).find((a) => a.number === '1');
    const g = feature(expression, 'synthGene').segments[0];
    if (b1 === undefined || g?.kind !== 'range') throw new Error('sites');
    expect(pStart).toBe(1458);
    expect((g.start - b1.range.end + L) % L).toBe(6);
    const [tStart] = span(expression, 'synthetic terminator');
    const b2 = attSites(expression).find((a) => a.number === '2');
    // 0-based exclusive end of attB2 to the 1-based start of the terminator: 12 bases between.
    expect(tStart - (b2?.range.end ?? 0) - 1).toBe(12);
    expect(translate(gene).indexOf('*')).toBe(119);
  });

  it('the clone is the entry clone’s 397 bp plus 1,154 bp of destination; the byproduct 683 plus 1,015', () => {
    // The destination's cassette runs from the middle of the attR1 core to the middle of the attR2 core.
    const cassette = 790 + 27 - (122 + 12);
    expect(cassette).toBe(683);
    expect(1837 - cassette).toBe(1154);
    expect(397 + 1154).toBe(expression.length);
    expect(cassette + (1412 - 397)).toBe(byproduct.length);
  });
});

describe('gateway.md: Tutorial 3, what goes wrong', () => {
  it('attR3 where attR2 was: the sites do not pair, and nothing is made', () => {
    const r = gateway(entry, tut('GW-bad-pDEST'), 'LR');
    expect(r.problem).toBe(
      'The sites do not pair: GW-Insert × GW-pDONR BP has attL1 and attL2, GW-bad-pDEST has attR1 and attR3. Each number recombines only with its own.',
    );
    expect(r.product).toBeNull();
    expect(r.byproduct).toBeNull();
  });

  it('the PCR product offered as the entry clone has no attL site', () => {
    expect(gateway(insert, dest, 'LR').problem).toBe(
      'GW-Insert has no attL site annotated. A LR needs two, flanking the DNA to move; annotate them, or open a file that does.',
    );
  });

  it('the destination offered as the donor has no attP site', () => {
    expect(gateway(insert, dest, 'BP').problem).toBe(
      'GW-pDEST has no attP site annotated. A BP needs two, flanking the cassette they replace.',
    );
  });
});
