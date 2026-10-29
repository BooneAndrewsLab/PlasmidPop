import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { beforeAll, describe, expect, it } from 'vitest';

import {
  BUNDLED_ENZYME_SET,
  type CutSite,
  type DigestFragment,
  type Enzyme,
  SeqDocument,
  cuttableSites,
  findCutSites,
  getEnzyme,
  setActiveEnzymeSet,
} from '@/core';
import { parseGenBank } from '@/io/genbank/parseGenBank';

import { reverseComplement } from '../sequence';
import {
  type CheckPair,
  type CloneGeometry,
  designCheckPrimers,
  flipInsert,
  locateInsert,
  longestSharedStretch,
} from './checkPrimers';
import { digest } from './digest';
import { gateway } from './gateway';
import { gibson } from './gibson';
import { goldenGate } from './goldenGate';
import { emptyVector, flipFragment, ligate } from './ligate';
import { pcr } from './pcr';

/**
 * Check primers for a clone (#311, item 120), on the tutorials' synthetic
 * files: a directional ligation, a one-enzyme ligation whose insert can go
 * either way, a three-part Golden Gate, a two-insert Gibson and a Gateway
 * LR. Every band a pair promises is checked against the stretch of the
 * product between its two sites, and the simulation is run on the clone
 * made the other way round as the Bench would make it.
 */

const DIR = join(__dirname, '../../../docs/tutorials/files');

function tut(name: string): SeqDocument {
  const doc = parseGenBank(readFileSync(join(DIR, `${name}.gb`), 'utf8')).documents[0];
  if (doc === undefined) throw new Error(`${name} has no record`);
  return doc;
}

function enz(name: string): Enzyme {
  const e = getEnzyme(name);
  if (e === undefined) throw new Error(`no enzyme ${name}`);
  return e;
}

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

function longest(frags: DigestFragment[]): DigestFragment {
  const f = [...frags].sort((a, b) => b.sequence.length - a.sequence.length)[0];
  if (f === undefined) throw new Error('no fragments');
  return f;
}

function def<T>(value: T | null | undefined): T {
  if (value === undefined || value === null) throw new Error('expected a value');
  return value;
}

const seq = (doc: SeqDocument): string => doc.sequence.toString().toUpperCase();

function linear(name: string, sequence: string): SeqDocument {
  return SeqDocument.create({ name, sequence, topology: 'linear' });
}

function circular(name: string, sequence: string): SeqDocument {
  return SeqDocument.create({ name, sequence, topology: 'circular' });
}

/** The circle `doc` read from `origin`: the same molecule, numbered from elsewhere. */
function rotated(doc: SeqDocument, origin: number): SeqDocument {
  const text = doc.sequence.toString();
  return circular(doc.name, text.slice(origin) + text.slice(0, origin));
}

/** The same circle whatever its origin: its text has one rotation that sorts first. */
function canonical(doc: SeqDocument): string {
  const text = seq(doc);
  let best = text;
  for (let i = 1; i < text.length; i++) {
    const r = text.slice(i) + text.slice(0, i);
    if (r < best) best = r;
  }
  return best;
}

/** What the pair amplifies, by the stretch of the product between its sites: the band it promises. */
function sliceLength(pair: CheckPair, L: number, circular: boolean, tails = 0): number {
  let n = pair.reverseSite.end - pair.forwardSite.start;
  if (circular && n <= 0) n += L;
  return n + tails;
}

/** Deterministic enough to compare runs by. */
function summary(pair: CheckPair): string {
  return `${pair.kind}:${pair.junction ?? '-'}:${pair.forward.sequence}:${pair.reverse.sequence}:${pair.productLength}`;
}

/** A random-looking sequence that is the same every run (a 32-bit LCG, top bits). */
function pseudo(n: number, seed: number): string {
  let x = seed >>> 0;
  let out = '';
  for (let i = 0; i < n; i++) {
    x = (Math.imul(x, 1664525) + 1013904223) >>> 0;
    out += 'ACGT'.charAt(x >>> 30);
  }
  return out;
}

beforeAll(() => {
  setActiveEnzymeSet(BUNDLED_ENZYME_SET);
});

describe('longestSharedStretch', () => {
  const backbone = pseudo(600, 7);
  const insert = pseudo(300, 11);

  it('finds a linear molecule inside a linear product', () => {
    const product = linear('p', backbone.slice(0, 400) + insert + backbone.slice(400));
    expect(longestSharedStretch(product, linear('i', insert))).toEqual({
      range: { start: 400, end: 700 },
      flipped: false,
    });
  });

  it('finds the reverse complement, and says so', () => {
    const product = linear(
      'p',
      backbone.slice(0, 400) + reverseComplement(insert) + backbone.slice(400),
    );
    expect(longestSharedStretch(product, linear('i', insert))).toEqual({
      range: { start: 400, end: 700 },
      flipped: true,
    });
  });

  it('follows a stretch through the origin of a circular product', () => {
    // The insert sits over the origin: its last 100 bases first, then the backbone, then its first 200.
    const product = circular('p', insert.slice(200) + backbone + insert.slice(0, 200));
    const found = def(longestSharedStretch(product, linear('i', insert)));
    expect(found.range).toEqual({ start: 700, end: 1000 });
    expect(found.flipped).toBe(false);
  });

  it('follows a stretch through the origin of a circular molecule', () => {
    const vector = circular('v', backbone);
    // The product carries the whole backbone starting from its base 450.
    const product = circular('p', backbone.slice(450) + backbone.slice(0, 450) + insert);
    const found = def(longestSharedStretch(product, vector));
    expect(found.range.end - found.range.start).toBe(600);
    expect(found.range.start).toBe(0);
  });

  it('is null for molecules sharing under twelve bases', () => {
    expect(
      longestSharedStretch(linear('a', pseudo(200, 3)), linear('b', pseudo(200, 5))),
    ).toBeNull();
  });
});

describe('locateInsert', () => {
  it('a directional ligation: the insert is the EcoRI–BamHI piece, two junctions', () => {
    const vector = tut('pLig-Vector');
    const backbone = longest(cut(vector, ['EcoRI', 'BamHI']));
    const piece = longest(cut(tut('Insert-EcoRI-BamHI'), ['EcoRI', 'BamHI']));
    const product = ligate([backbone, piece], { name: 'clone', circular: true });
    const g = def(locateInsert(product, vector));
    // The sites are regenerated at both junctions, so the vector's stretch
    // runs a few bases into the piece on either side.
    const length = g.insert.end - g.insert.start;
    expect(length).toBeGreaterThanOrEqual(780);
    expect(length).toBeLessThanOrEqual(801);
    expect(g.junctions).toHaveLength(2);
    expect(g.junctions[0]).toBe(g.insert.start);
    expect(g.junctions[1]).toBe(g.insert.end % product.length);
    // The whole insert piece lies inside what was located, bar the shared site bases.
    expect(seq(product).slice(g.insert.start, g.insert.end)).toContain(
      piece.sequence.toUpperCase().slice(10, -10),
    );
  });

  it('a one-enzyme ligation, either way round', () => {
    const vector = tut('pLig-Vector');
    const lin = longest(cut(vector, ['EcoRI']));
    const piece = longest(cut(tut('Insert-EcoRI-EcoRI'), ['EcoRI']));
    const fwd = ligate([lin, piece], { name: 'fwd', circular: true });
    const rev = ligate([lin, flipFragment(piece)], { name: 'rev', circular: true });
    const a = def(locateInsert(fwd, vector));
    const b = def(locateInsert(rev, vector));
    expect(a.insert.end - a.insert.start).toBe(b.insert.end - b.insert.start);
    expect(a.junctions).toHaveLength(2);
  });

  it('a four-part Golden Gate: three internal junctions between the parts', () => {
    const dest = tut('pGG-Destination');
    const parts = ['GG-prom', 'GG-cds', 'GG-tag', 'GG-term'].map(tut);
    const r = goldenGate([dest, ...parts], { enzyme: enz('BsaI') });
    const product = def(r.assembly).product;
    expect(product.length).toBe(3118);
    const g = def(locateInsert(product, dest, parts));
    expect(g.junctions).toHaveLength(5);
    const L = product.length;
    const along = (j: number): number => (((j - g.insert.start) % L) + L) % L;
    const inner = g.junctions.slice(2).map(along);
    expect(inner).toEqual([...inner].sort((a, b) => a - b));
    // Each inner junction lies in the four bases two neighbours share.
    const promoter = def(longestSharedStretch(product, def(parts[0])));
    const cds = def(longestSharedStretch(product, def(parts[1])));
    expect(def(inner[0])).toBeGreaterThanOrEqual(along(cds.range.start));
    expect(def(inner[0])).toBeLessThanOrEqual(along(promoter.range.end));
  });

  it('a two-insert Gibson: the vector is what the product shares with GB-Vector', () => {
    const vector = tut('GB-Vector');
    const inserts = ['GB-Insert1', 'GB-Insert2'].map(tut);
    const r = gibson([vector, ...inserts]);
    const product = def(r.assembly).product;
    const g = def(locateInsert(product, vector, inserts));
    expect(g.junctions).toHaveLength(3);
    // The vector is in the product whole, overlaps included.
    expect(product.length - (g.insert.end - g.insert.start)).toBe(vector.length);
  });

  it('a Gateway LR: the destination vector less its ccdB cassette', () => {
    const dest = tut('GW-pDEST');
    const entry = def(gateway(tut('GW-Insert'), tut('GW-pDONR'), 'BP').product);
    const expression = def(gateway(entry, dest, 'LR').product);
    const g = def(locateInsert(expression, dest));
    expect(g.junctions).toHaveLength(2);
    expect(g.insert.end - g.insert.start).toBeGreaterThan(300);
  });

  it('is null when the vector is nowhere, or everywhere, or in the middle of a linear product', () => {
    const backbone = pseudo(600, 7);
    const insert = pseudo(300, 11);
    expect(
      locateInsert(circular('p', backbone + insert), circular('v', pseudo(600, 13))),
    ).toBeNull();
    expect(locateInsert(circular('p', backbone), circular('v', backbone))).toBeNull();
    expect(locateInsert(linear('p', insert + backbone + insert), linear('v', backbone))).toBeNull();
    // At either end of a linear product the other side is the insert.
    expect(def(locateInsert(linear('p', backbone + insert), linear('v', backbone))).insert).toEqual(
      {
        start: 600,
        end: 900,
      },
    );
    expect(def(locateInsert(linear('p', insert + backbone), linear('v', backbone))).insert).toEqual(
      {
        start: 0,
        end: 300,
      },
    );
  });

  it('a product numbered from inside the insert gives the same geometry, over the origin', () => {
    const vector = tut('pLig-Vector');
    const backbone = longest(cut(vector, ['EcoRI', 'BamHI']));
    const piece = longest(cut(tut('Insert-EcoRI-BamHI'), ['EcoRI', 'BamHI']));
    const product = ligate([backbone, piece], { name: 'clone', circular: true });
    const g = def(locateInsert(product, vector));
    const origin = g.insert.start + 300;
    const turned = rotated(product, origin);
    const h = def(locateInsert(turned, vector));
    expect(h.insert.end - h.insert.start).toBe(g.insert.end - g.insert.start);
    expect(h.insert.end).toBeGreaterThan(turned.length);
    expect(h.insert.start).toBe(product.length - 300);
  });
});

describe('flipInsert', () => {
  const backbone = pseudo(600, 7);
  const insert = pseudo(300, 11);

  it('reverse-complements the insert in place and twice is the original', () => {
    const product = circular('p', backbone + insert);
    const flipped = flipInsert(product, { start: 600, end: 900 });
    expect(seq(flipped)).toBe(backbone + reverseComplement(insert));
    expect(flipped.isCircular).toBe(true);
    expect(seq(flipInsert(flipped, { start: 600, end: 900 }))).toBe(seq(product));
  });

  it('turns an insert over the origin into the same circle as turning it anywhere', () => {
    const product = circular('p', backbone + insert);
    const straight = flipInsert(product, { start: 600, end: 900 });
    const turned = rotated(product, 700);
    const over = flipInsert(turned, { start: 800, end: 1100 });
    expect(canonical(over)).toBe(canonical(straight));
  });
});

describe('designCheckPrimers: a directional ligation (EcoRI + BamHI)', () => {
  const vector = tut('pLig-Vector');
  const backbone = longest(cut(vector, ['EcoRI', 'BamHI']));
  const piece = longest(cut(tut('Insert-EcoRI-BamHI'), ['EcoRI', 'BamHI']));
  const product = ligate([backbone, piece], { name: 'clone', circular: true });
  const geometry = def(locateInsert(product, vector));
  // Two enzymes: the cut vector cannot close, so there is no empty vector.
  const empty = emptyVector(backbone);
  const design = designCheckPrimers(product, geometry, { empty, orientation: 'fixed' });

  it('the cut vector has no empty form, and the orientation is fixed', () => {
    expect(empty).toBeNull();
    for (const p of design.pairs) {
      expect(p.bands.empty).toBeNull();
      expect(p.bands.flipped).toBeNull();
    }
  });

  it('gives pairs across both junctions and a flank pair, best first within each', () => {
    const kinds = design.pairs.map((p) => `${p.kind}${p.junction ?? ''}`);
    expect(new Set(kinds)).toEqual(new Set(['junction0', 'junction1', 'flank']));
    for (const kind of ['junction0', 'junction1', 'flank']) {
      const penalties = design.pairs
        .filter((p) => `${p.kind}${p.junction ?? ''}` === kind)
        .map((p) => p.penalty);
      expect(penalties).toEqual([...penalties].sort((a, b) => a - b));
      expect(penalties.length).toBeLessThanOrEqual(5);
    }
    expect(design.notes).toEqual([]);
  });

  it('every band is the stretch between the two sites, and the one pcr draws', () => {
    for (const p of design.pairs) {
      expect(p.bands.clone).toEqual([p.productLength]);
      expect(p.productLength).toBe(sliceLength(p, product.length, true));
      expect(p.productLength).toBeGreaterThanOrEqual(300);
      expect(p.productLength).toBeLessThanOrEqual(1000);
      expect(p.problems).toEqual([]);
    }
  });

  it('a junction pair has one primer on each side, at least 50 bp from the junction', () => {
    const L = product.length;
    const along = (x: number): number => (((x - geometry.insert.start) % L) + L) % L;
    const insertLength = geometry.insert.end - geometry.insert.start;
    const inInsert = (r: { start: number; end: number }): boolean =>
      along(r.start) < insertLength && along(r.end - 1) < insertLength;
    for (const p of design.pairs) {
      const f = inInsert(p.forwardSite);
      const r = inInsert(p.reverseSite);
      if (p.kind === 'junction' && p.junction === 0) {
        expect([f, r]).toEqual([false, true]);
        expect(along(p.reverseSite.start)).toBeGreaterThanOrEqual(50);
        expect(L - along(p.forwardSite.end)).toBeGreaterThanOrEqual(50);
      } else if (p.kind === 'junction') {
        expect([f, r]).toEqual([true, false]);
        expect(insertLength - along(p.forwardSite.end)).toBeGreaterThanOrEqual(50);
        expect(along(p.reverseSite.start) - insertLength).toBeGreaterThanOrEqual(50);
      } else {
        expect([f, r]).toEqual([false, false]);
        expect(p.productLength).toBeGreaterThan(insertLength + 100);
      }
    }
  });

  it('each designed primer anneals nowhere else on the product, and meets the designer’s rules', () => {
    for (const p of design.pairs) {
      for (const report of [p.forward, p.reverse]) {
        expect(report.warnings).toEqual([]);
        expect(report.tm).toBeGreaterThanOrEqual(55);
        expect(report.tm).toBeLessThanOrEqual(65);
      }
      expect(p.tmDifference).toBeLessThanOrEqual(3);
      expect(p.crossDimer).toBeLessThanOrEqual(4);
      const run = pcr(product, [
        { name: 'F', sequence: p.forward.sequence },
        { name: 'R', sequence: p.reverse.sequence },
      ]);
      expect(run.products).toHaveLength(1);
    }
  });

  it('is deterministic', () => {
    const again = designCheckPrimers(product, geometry, { empty, orientation: 'fixed' });
    expect(again.pairs.map(summary)).toEqual(design.pairs.map(summary));
  });

  it('honours the size window and the distance from the junction', () => {
    const tight = designCheckPrimers(product, geometry, {
      minProduct: 400,
      maxProduct: 600,
      minDistance: 120,
      orientation: 'fixed',
    });
    const L = product.length;
    const along = (x: number): number => (((x - geometry.insert.start) % L) + L) % L;
    for (const p of tight.pairs) {
      expect(p.productLength).toBeGreaterThanOrEqual(400);
      expect(p.productLength).toBeLessThanOrEqual(600);
      if (p.kind === 'junction' && p.junction === 0) {
        expect(along(p.reverseSite.start)).toBeGreaterThanOrEqual(120);
      }
    }
    // The insert alone is 800 bp: no flank pair fits in 600.
    expect(tight.pairs.some((p) => p.kind === 'flank')).toBe(false);
    expect(tight.notes.join(' ')).toMatch(/flanking the whole insert would give at least/);
  });

  it('designs the same pairs on the product numbered from inside the insert', () => {
    const origin = geometry.insert.start + 300;
    const turned = rotated(product, origin);
    const g = def(locateInsert(turned, vector));
    const over = designCheckPrimers(turned, g, { orientation: 'fixed' });
    const bases = (d: typeof design): string[] =>
      d.pairs.map(
        (p) => `${p.kind}:${p.forward.sequence}:${p.reverse.sequence}:${p.productLength}`,
      );
    expect(bases(over)).toEqual(bases(design));
    for (const p of over.pairs) {
      expect(p.forwardSite.start).toBeGreaterThanOrEqual(0);
      expect(p.forwardSite.start).toBeLessThan(turned.length);
      expect(p.productLength).toBe(sliceLength(p, turned.length, true));
    }
  });
});

describe('designCheckPrimers: one enzyme, the insert either way round (EcoRI)', () => {
  const vector = tut('pLig-Vector');
  const lin = longest(cut(vector, ['EcoRI']));
  const piece = longest(cut(tut('Insert-EcoRI-EcoRI'), ['EcoRI']));
  const fwd = ligate([lin, piece], { name: 'fwd', circular: true });
  const rev = ligate([lin, flipFragment(piece)], { name: 'rev', circular: true });
  const empty = def(emptyVector(lin));
  const geometry = def(locateInsert(fwd, vector));
  const design = designCheckPrimers(fwd, geometry, { empty, orientation: 'open' });

  it('a junction pair gives no band on the empty vector and none in the other orientation', () => {
    const junctions = design.pairs.filter((p) => p.kind === 'junction');
    expect(junctions.length).toBeGreaterThan(0);
    for (const p of junctions) {
      expect(p.bands.empty).toEqual([]);
      expect(p.bands.flipped).toEqual([]);
      expect(p.problems).toEqual([]);
      // The clone made the other way round, as the Bench makes it, agrees with the turned insert.
      const onRev = pcr(rev, [
        { name: 'F', sequence: p.forward.sequence },
        { name: 'R', sequence: p.reverse.sequence },
      ]);
      expect(onRev.products).toHaveLength(0);
    }
  });

  it('a flank pair gives the empty vector’s band plus the 801 bp insert, in either orientation', () => {
    const flanks = design.pairs.filter((p) => p.kind === 'flank');
    expect(flanks.length).toBeGreaterThan(0);
    for (const p of flanks) {
      expect(p.bands.empty).toHaveLength(1);
      expect(def(p.bands.clone[0]) - def(p.bands.empty?.[0])).toBe(801);
      expect(p.bands.flipped).toEqual(p.bands.clone);
      expect(p.problems).toEqual([]);
    }
  });

  it('with the orientation fixed, no turned clone is simulated', () => {
    const fixed = designCheckPrimers(fwd, geometry, { empty, orientation: 'fixed' });
    expect(fixed.pairs.every((p) => p.bands.flipped === null)).toBe(true);
  });
});

describe('designCheckPrimers: reusing a primer', () => {
  const vector = tut('pLig-Vector');
  const lin = longest(cut(vector, ['EcoRI']));
  const piece = longest(cut(tut('Insert-EcoRI-EcoRI'), ['EcoRI']));
  const product = ligate([lin, piece], { name: 'fwd', circular: true });
  const empty = def(emptyVector(lin));
  const geometry = def(locateInsert(product, vector));
  const body = piece.sequence.toUpperCase().slice(4, -4);

  it('the insert’s own forward primer: the counterpart lies on the vector past the far junction', () => {
    const reuse = { name: 'ins-F', sequence: body.slice(0, 22) };
    const d = designCheckPrimers(product, geometry, { empty, reuse, maxProduct: 1200 });
    expect(d.reused?.strand).toBe('forward');
    expect(d.pairs.length).toBeGreaterThan(0);
    for (const p of d.pairs) {
      expect(p.fixed).toBe('forward');
      expect(p.kind).toBe('junction');
      expect(p.junction).toBe(1);
      expect(p.forward.sequence).toBe(reuse.sequence);
      expect(p.bands.clone).toEqual([p.productLength]);
      expect(p.productLength).toBe(sliceLength(p, product.length, true));
      expect(p.productLength).toBeGreaterThan(801);
      expect(p.bands.empty).toEqual([]);
      expect(p.bands.flipped).toEqual([]);
    }
  });

  it('the insert’s own reverse primer: the counterpart lies on the vector before the near junction', () => {
    const reuse = { name: 'ins-R', sequence: reverseComplement(body.slice(-22)) };
    const d = designCheckPrimers(product, geometry, { empty, reuse, maxProduct: 1200 });
    expect(d.reused?.strand).toBe('reverse');
    expect(d.pairs.length).toBeGreaterThan(0);
    for (const p of d.pairs) {
      expect(p.fixed).toBe('reverse');
      expect(p.junction).toBe(0);
      expect(p.reverse.sequence).toBe(reuse.sequence);
      expect(p.bands.clone).toEqual([p.productLength]);
      expect(p.productLength).toBe(sliceLength(p, product.length, true));
    }
  });

  it('a tailed primer: the tail is in the band, as pcr counts it', () => {
    const tail = 'TTTTGAATTC';
    const reuse = { name: 'ins-F', sequence: tail + body.slice(0, 22) };
    const d = designCheckPrimers(product, geometry, { empty, reuse, maxProduct: 1200 });
    expect(d.pairs.length).toBeGreaterThan(0);
    for (const p of d.pairs) {
      const annealed = def(d.reused).annealLength;
      expect(p.bands.clone).toEqual([p.productLength]);
      expect(p.productLength).toBe(
        sliceLength(p, product.length, true) + (reuse.sequence.length - annealed),
      );
    }
  });

  it('a primer on the vector pointing into the insert: the counterpart lies inside the insert', () => {
    const L = product.length;
    const text = seq(product);
    // 100 bases before the left junction, pointing right.
    const at = (geometry.insert.start - 100 + L) % L;
    const reuse = { name: 'vec-F', sequence: text.slice(at, at + 22) };
    const d = designCheckPrimers(product, geometry, { empty, reuse });
    expect(d.pairs.length).toBeGreaterThan(0);
    for (const p of d.pairs) {
      expect(p.junction).toBe(0);
      const along = (((p.reverseSite.start - geometry.insert.start) % L) + L) % L;
      expect(along).toBeGreaterThanOrEqual(50);
      expect(along).toBeLessThan(geometry.insert.end - geometry.insert.start);
    }
  });

  it('a window too small for the reused primer says what the band would at least be', () => {
    const reuse = { name: 'ins-F', sequence: body.slice(0, 22) };
    const d = designCheckPrimers(product, geometry, { empty, reuse, maxProduct: 500 });
    expect(d.pairs).toEqual([]);
    expect(d.notes[0]).toMatch(
      /No counterpart for ins-F.*at least [\d,]+ bp; widen the size window/,
    );
  });

  it('a primer that does not anneal has no counterpart', () => {
    const d = designCheckPrimers(product, geometry, {
      reuse: { name: 'x', sequence: pseudo(22, 99) },
    });
    expect(d.pairs).toEqual([]);
    expect(d.reused).toBeNull();
    expect(d.notes).toEqual(['x does not anneal to fwd, so it has no counterpart here.']);
  });
});

describe('designCheckPrimers: multi-part builds', () => {
  it('a four-part Golden Gate: a pair across each junction with room for one', () => {
    const dest = tut('pGG-Destination');
    const parts = ['GG-prom', 'GG-cds', 'GG-tag', 'GG-term'].map(tut);
    const product = def(goldenGate([dest, ...parts], { enzyme: enz('BsaI') }).assembly).product;
    const geometry = def(locateInsert(product, dest, parts));
    const d = designCheckPrimers(product, geometry, { empty: dest, orientation: 'fixed' });
    const covered = new Set(d.pairs.filter((p) => p.kind === 'junction').map((p) => p.junction));
    // The 33 bp tag is too short to hold a primer 50 bp from either of its
    // junctions, so those two are said to have no pair; the rest are covered.
    expect(covered).toEqual(new Set([0, 1, 2]));
    expect(d.notes.filter((n) => n.startsWith('No pair across the junction'))).toHaveLength(2);
    for (const p of d.pairs) {
      expect(p.bands.clone).toEqual([p.productLength]);
      expect(p.productLength).toBe(sliceLength(p, product.length, true));
      if (p.kind === 'junction') expect(p.bands.empty).toEqual([]);
    }
    // The uncut destination carries its dropout: a flank pair gives a different size on it.
    for (const p of d.pairs.filter((q) => q.kind === 'flank')) {
      expect(p.bands.empty).toHaveLength(1);
      expect(p.bands.empty).not.toEqual(p.bands.clone);
    }
  });

  it('a Gateway LR clone: junction pairs are silent on the destination vector', () => {
    const dest = tut('GW-pDEST');
    const entry = def(gateway(tut('GW-Insert'), tut('GW-pDONR'), 'BP').product);
    const product = def(gateway(entry, dest, 'LR').product);
    const geometry = def(locateInsert(product, dest));
    const d = designCheckPrimers(product, geometry, { empty: dest, orientation: 'fixed' });
    expect(d.pairs.filter((p) => p.kind === 'junction').length).toBeGreaterThan(0);
    for (const p of d.pairs) {
      expect(p.productLength).toBe(sliceLength(p, product.length, true));
      expect(p.bands.clone).toEqual([p.productLength]);
      if (p.kind === 'junction') expect(p.bands.empty).toEqual([]);
    }
  });
});

describe('designCheckPrimers: edge cases', () => {
  it('a junction pair cannot use a stretch with an ambiguity code', () => {
    const backbone = pseudo(1200, 7);
    const insert = pseudo(500, 11);
    // Ns across the insert’s first 120 bases: the reverse primer of the left
    // junction must lie past them.
    const smudged = 'N'.repeat(120) + insert.slice(120);
    const product = circular('p', backbone + smudged);
    const geometry: CloneGeometry = { insert: { start: 1200, end: 1700 }, junctions: [1200, 0] };
    const d = designCheckPrimers(product, geometry, { orientation: 'fixed' });
    for (const p of d.pairs) {
      expect(p.forward.sequence).toMatch(/^[ACGT]+$/);
      expect(p.reverse.sequence).toMatch(/^[ACGT]+$/);
      if (p.kind === 'junction' && p.junction === 0) {
        expect(p.reverseSite.start).toBeGreaterThanOrEqual(1320);
      }
    }
  });

  it('a linear product with the insert at its end: one junction, no flank pair', () => {
    const backbone = pseudo(1200, 7);
    const insert = pseudo(500, 11);
    const product = linear('p', backbone + insert);
    const geometry = def(locateInsert(product, linear('v', backbone)));
    expect(geometry.junctions).toEqual([1200]);
    const d = designCheckPrimers(product, geometry, { orientation: 'fixed' });
    expect(d.pairs.length).toBeGreaterThan(0);
    expect(d.pairs.every((p) => p.kind === 'junction' && p.junction === 0)).toBe(true);
    for (const p of d.pairs) {
      expect(p.forwardSite.end).toBeLessThanOrEqual(1150);
      expect(p.reverseSite.start).toBeGreaterThanOrEqual(1250);
      expect(p.productLength).toBe(sliceLength(p, product.length, false));
      expect(p.bands.clone).toEqual([p.productLength]);
    }
    expect(d.notes).toContain(
      'The insert reaches an end of the linear product, so no pair can flank it.',
    );
  });

  it('a flank pair whose empty-vector band is the clone’s size is flagged', () => {
    // An "empty vector" that is the clone itself: every size is the same.
    const backbone = pseudo(1200, 7);
    const insert = pseudo(400, 11);
    const product = circular('p', backbone + insert);
    const geometry: CloneGeometry = { insert: { start: 1200, end: 1600 }, junctions: [1200, 0] };
    const d = designCheckPrimers(product, geometry, { empty: product, orientation: 'fixed' });
    for (const p of d.pairs) {
      if (p.kind === 'flank') {
        expect(p.problems).toEqual(['The empty vector gives a band of the same size']);
      } else {
        expect(p.problems[0]).toMatch(/^Amplifies the empty vector too: [\d,]+ bp$/);
      }
    }
  });
});
