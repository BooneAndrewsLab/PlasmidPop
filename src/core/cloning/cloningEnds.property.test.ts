import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { SeqDocument, reverseComplement } from '@/core';
import { randomDna, seededRandom } from '@/test/random';

import { METHYLATED_HOST, UNMETHYLATED_HOST } from '../analysis/methylation';
import { type Enzyme, findCutSites, getEnzyme } from '../analysis/restriction';
import { IUPAC_SETS } from '../analysis/codons';
import {
  type CloningContext,
  type CloningInsert,
  designCloningEnds,
  insertSequence,
  resolveVectorRegion,
  scanForCloningNow,
  suggestEnzymePairs,
} from './cloningEnds';

/**
 * Restriction-cloning ends (#303, item 108), checked by what a design
 * makes rather than by how it is written.
 *
 * A synthetic vector is a random circle with a polylinker of two sites in
 * it, turned by a random amount so the region, a site or a cut can lie
 * across the origin; the insert is a random stretch of a random document,
 * linear or circular, read as either strand, with or without Flip. For
 * every such case the pair is among the suggestions and usable (or, where
 * a random base made an extra site, excluded for exactly that), the design
 * raises no red warning, and `simulate` gives a circle that is the vector
 * up to the end of the lower site, the insert as placed, and the vector
 * from the start of the higher site — the two sites come back whole at the
 * junctions — with the vector's own base 0 kept as the product's. The
 * enzymes are the common sticky Type IIP cutters, with AccI and AvaI for
 * their degenerate sites (the primer copies the vector's bases, so the
 * overhangs match whichever bases the vector has there). A second property
 * puts a Type IIS site (BsaI) at either end, pointing either way, and
 * expects the overhang copied from the vector so the product is the vector
 * to the far side of the lower cut, the insert, and the vector from the
 * near side of the higher cut, with the site gone when it lay in the
 * replaced stretch. A third keeps the insert's own methylation out of it.
 *
 * Sequences come from a seeded mulberry32 (`@/test/random`).
 */

const STICKY = [
  'EcoRI',
  'BamHI',
  'HindIII',
  'KpnI',
  'PstI',
  'SacI',
  'SalI',
  'XbaI',
  'SphI',
  'XhoI',
  'NheI',
  'NcoI',
  'AccI',
  'AvaI',
];

function enzyme(name: string): Enzyme {
  const e = getEnzyme(name);
  if (e === undefined) throw new Error(name);
  return e;
}

/** One concrete spelling of an IUPAC site. */
function concrete(site: string, rand: () => number): string {
  return Array.from(site, (code) => {
    const bases = IUPAC_SETS[code] ?? [code];
    return bases[Math.floor(rand() * bases.length)] ?? code;
  }).join('');
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

interface Setup {
  readonly vector: SeqDocument;
  /** Unrolled region on the turned vector. */
  readonly region: { start: number; end: number };
  readonly insert: CloningInsert;
  readonly a: string;
  readonly b: string;
  /** In the turned vector's coordinates, unrolled from the region start. */
  readonly aSite: { start: number; end: number };
  readonly bSite: { start: number; end: number };
  readonly flipped: boolean;
}

const setupArb: fc.Arbitrary<Setup> = fc
  .record({
    seed: fc.integer({ min: 1, max: 0x7fffffff }),
    backbone: fc.integer({ min: 300, max: 1500 }),
    gap: fc.integer({ min: 10, max: 40 }),
    pair: fc.uniqueArray(fc.constantFrom(...STICKY), { minLength: 2, maxLength: 2 }),
    turn: fc.integer({ min: 0, max: 2000 }),
    insertLength: fc.integer({ min: 80, max: 600 }),
    sourceCircular: fc.boolean(),
    strand: fc.constantFrom('forward', 'reverse'),
    flipped: fc.boolean(),
  })
  .map(({ seed, backbone, gap, pair, turn, insertLength, sourceCircular, strand, flipped }) => {
    const rand = seededRandom(seed);
    const [a, b] = pair as [string, string];
    const siteA = concrete(enzyme(a).site, rand);
    const siteB = concrete(enzyme(b).site, rand);
    const linker = `${siteA}${randomDna(rand, gap)}${siteB}`;
    const at = Math.floor(backbone / 2);
    const text = randomDna(rand, at) + linker + randomDna(rand, backbone - at);
    const L = text.length;
    // Unmethylated: the methylation property is its own, and a random base
    // beside a site would otherwise block it now and then (XbaI by Dam).
    const plain = SeqDocument.create({
      name: 'pTest',
      sequence: text,
      topology: 'circular',
      methylation: UNMETHYLATED_HOST,
    });
    const origin = turn % L;
    const vector = plain.setOrigin(origin);
    const shift = (p: number): number => (((p - origin) % L) + L) % L;
    const regionStart = shift(at);
    const region = { start: regionStart, end: regionStart + linker.length };
    const aSite = { start: regionStart, end: regionStart + siteA.length };
    const bSite = { start: region.end - siteB.length, end: region.end };
    const sourceText = randomDna(rand, insertLength + 400);
    const from = 150 + Math.floor(rand() * 100);
    const source = SeqDocument.create({
      name: 'src',
      sequence: sourceText,
      topology: sourceCircular ? 'circular' : 'linear',
    });
    const insert: CloningInsert = {
      document: source,
      range: { start: from, end: from + insertLength },
      strand,
      name: 'ins',
    };
    return { vector, region, insert, a, b, aSite, bSite, flipped };
  });

function contextOf(s: Setup): CloningContext {
  return {
    vector: s.vector,
    region: resolveVectorRegion(s.vector, s.region),
    insert: s.insert,
    flipped: s.flipped,
    scans: scanForCloningNow(s.vector, s.insert),
  };
}

/** Whether `a` and `b` each cut the vector exactly once and the insert not at all. */
function cleanCase(s: Setup): boolean {
  const count = (text: string, topology: 'linear' | 'circular', name: string): number =>
    findCutSites(text, topology, [enzyme(name)]).length;
  const vectorText = s.vector.sequence.toString();
  const insert = insertSequence(s.insert);
  return [s.a, s.b].every(
    (name) => count(vectorText, 'circular', name) === 1 && count(insert, 'linear', name) === 0,
  );
}

describe('cloning ends (property)', () => {
  it('a usable pair makes the vector with the insert between its two sites, whichever way it is turned', () => {
    let designed = 0;
    fc.assert(
      fc.property(setupArb, (s) => {
        fc.pre(cleanCase(s));
        const ctx = contextOf(s);
        const pair = s.flipped ? { forward: s.b, reverse: s.a } : { forward: s.a, reverse: s.b };
        const suggestions = suggestEnzymePairs(ctx);
        const listed = suggestions.pairs.find(
          (p) => p.forward.enzyme === pair.forward && p.reverse.enzyme === pair.reverse,
        );
        expect(listed, `${pair.forward} · ${pair.reverse} listed`).toBeDefined();
        if (listed === undefined) return;
        // The sites are 10+ bases apart, so the only thing that can exclude
        // the pair is a compatible pair of overhangs, which two different
        // enzymes of this list can give (AvaI's CYCGRG spelled as XhoI's site).
        const issues = listed.issues.map((i) => i.kind);
        expect(issues.filter((k) => k !== 'compatibleEnds')).toEqual([]);
        expect(listed.orientation).toBe(s.flipped ? 'reverse' : 'forward');
        expect(listed.replaced).toEqual({
          start: s.aSite.start + enzyme(s.a).cutTop,
          end: s.bSite.start + enzyme(s.b).cutTop,
        });

        // Where a site and the insert's first or last bases happen to spell a
        // site of either enzyme, the design must say so in red and the
        // digest cuts there; the construction below assumes they do not.
        const insert = insertSequence(s.insert);
        const placedInsert = s.flipped ? reverseComplement(insert) : insert;
        const vectorText = s.vector.sequence.toString();
        const junctionSites = (window: string): number =>
          findCutSites(window, 'linear', [enzyme(s.a), enzyme(s.b)]).length;
        const lowerJunction =
          wrapped(vectorText, s.aSite.start, s.aSite.end) + placedInsert.slice(0, 12);
        const higherJunction =
          placedInsert.slice(-12) + wrapped(vectorText, s.bSite.start, s.bSite.end);
        const cleanJunctions =
          junctionSites(lowerJunction) === 1 && junctionSites(higherJunction) === 1;
        const design = designCloningEnds(ctx, pair);
        expect(design.problem).toBeNull();
        const danger = design.warnings.filter((w) => w.severity === 'danger');
        if (!cleanJunctions) {
          expect(danger.map((w) => w.kind)).toContain('extraSite');
          return;
        }
        expect(danger).toEqual([]);
        expect(design.productLength).toBe(
          insert.length +
            design.forward.sequence.length +
            design.reverse.sequence.length -
            design.forward.annealing.length -
            design.reverse.annealing.length,
        );
        const sim = design.simulate();
        expect(sim.problem).toBeNull();
        const product = sim.product;
        if (product === null) return;
        designed++;
        const text = vectorText;
        const L = text.length;
        const expected = wrapped(text, s.bSite.start, s.aSite.end + L) + placedInsert;
        expect(product.isCircular).toBe(true);
        expect(product.length).toBe(expected.length);
        expect(sameCircle(product.sequence.toString(), expected)).toBe(true);
        // Base 0 of the vector stays base 0 of the product unless it was cut out.
        const replaced = listed.replaced;
        if (replaced !== null && replaced.end <= L) {
          const keep = Math.min(30, replaced.start);
          expect(product.sequence.toString().slice(0, keep).toUpperCase()).toBe(
            text.slice(0, keep).toUpperCase(),
          );
        }
      }),
      { numRuns: 80 },
    );
    expect(designed).toBeGreaterThan(30);
  });

  it('a Type IIS enzyme by override points into the insert and copies the vector overhang', () => {
    const arb = fc.record({
      seed: fc.integer({ min: 1, max: 0x7fffffff }),
      backbone: fc.integer({ min: 300, max: 1200 }),
      gap: fc.integer({ min: 10, max: 30 }),
      other: fc.constantFrom('EcoRI', 'BamHI', 'HindIII', 'KpnI', 'PstI', 'SphI'),
      iisLower: fc.boolean(),
      pointsIn: fc.boolean(),
      turn: fc.integer({ min: 0, max: 2000 }),
      insertLength: fc.integer({ min: 80, max: 400 }),
      flipped: fc.boolean(),
    });
    let designed = 0;
    fc.assert(
      fc.property(
        arb,
        ({ seed, backbone, gap, other, iisLower, pointsIn, turn, insertLength, flipped }) => {
          const rand = seededRandom(seed);
          const bsaI = enzyme('BsaI');
          // BsaI GGTCTC(1/5): pointing right, the cut is 1 and 5 bases past the
          // site; pointing left (the site on the bottom strand) it is before it.
          const right = 'GGTCTC' + randomDna(rand, 5);
          const left = randomDna(rand, 5) + 'GAGACC';
          // `pointsIn`: the site points into the replaced stretch (and leaves
          // with it); otherwise it points out, into the backbone.
          const iisBlock = iisLower ? (pointsIn ? right : left) : pointsIn ? left : right;
          const otherSite = enzyme(other).site;
          const linker = iisLower
            ? `${iisBlock}${randomDna(rand, gap)}${otherSite}`
            : `${otherSite}${randomDna(rand, gap)}${iisBlock}`;
          const at = Math.floor(backbone / 2);
          const text = randomDna(rand, at) + linker + randomDna(rand, backbone - at);
          const L = text.length;
          const vectorPlain = SeqDocument.create({
            name: 'pIIS',
            sequence: text,
            topology: 'circular',
            methylation: UNMETHYLATED_HOST,
          });
          const sourceText = randomDna(rand, insertLength + 300);
          const source = SeqDocument.create({
            name: 'src',
            sequence: sourceText,
            topology: 'linear',
          });
          const insert: CloningInsert = {
            document: source,
            range: { start: 150, end: 150 + insertLength },
            strand: 'forward',
            name: 'ins',
          };
          const count = (seq: string, topology: 'linear' | 'circular', e: Enzyme): number =>
            findCutSites(seq, topology, [e]).length;
          fc.pre(
            count(text, 'circular', bsaI) === 1 && count(text, 'circular', enzyme(other)) === 1,
          );
          fc.pre(count(insertSequence(insert), 'linear', bsaI) === 0);
          fc.pre(count(insertSequence(insert), 'linear', enzyme(other)) === 0);

          const origin = turn % L;
          const vector = vectorPlain.setOrigin(origin);
          const shift = (p: number): number => (((p - origin) % L) + L) % L;
          const regionStart = shift(at);
          const region = { start: regionStart, end: regionStart + linker.length };
          const ctx: CloningContext = {
            vector,
            region: resolveVectorRegion(vector, region),
            insert,
            flipped,
            scans: scanForCloningNow(vector, insert),
          };
          const [lowerName, higherName] = iisLower ? ['BsaI', other] : [other, 'BsaI'];
          const pair = flipped
            ? { forward: higherName, reverse: lowerName }
            : { forward: lowerName, reverse: higherName };
          const design = designCloningEnds(ctx, pair);
          expect(design.problem).toBeNull();
          expect(design.pair.issues.map((i) => i.kind)).toEqual(['typeIIS']);
          const iisPrimer = design.forward.enzyme === 'BsaI' ? design.forward : design.reverse;
          expect(iisPrimer.segments.site).toBe('GGTCTC');
          expect(iisPrimer.segments.spacer).toHaveLength(5);
          const sim = design.simulate();
          expect(sim.problem).toBeNull();
          const product = sim.product;
          if (product === null) return;
          designed++;
          // Where the two cuts fall on the turned vector, unrolled from the region start.
          const iisSite = findCutSites(vector.sequence.toString(), 'circular', [bsaI])[0];
          const otherFound = findCutSites(vector.sequence.toString(), 'circular', [
            enzyme(other),
          ])[0];
          if (iisSite === undefined || otherFound === undefined) throw new Error('sites');
          const unroll = (p: number): number => (p < regionStart ? p + L : p);
          const iisCuts = [iisSite.cut, iisSite.cutBottom].map(unroll);
          const iisMin = Math.min(...iisCuts);
          const iisMax = Math.max(...iisCuts);
          const otherStart = unroll(otherFound.siteStart);
          const otherEnd = otherStart + otherSite.length;
          // Lower junction: the vector to the far side of a Type IIS cut, or the
          // whole Type IIP site; higher junction: from the near side, or the site.
          const lowerEnd = iisLower ? iisMax : otherEnd;
          const higherStart = iisLower ? otherStart : iisMin;
          const insertText = insertSequence(insert);
          const placed = flipped ? reverseComplement(insertText) : insertText;
          const expected = wrapped(vector.sequence.toString(), higherStart, lowerEnd + L) + placed;
          expect(product.length).toBe(expected.length);
          expect(sameCircle(product.sequence.toString(), expected)).toBe(true);
          // The overhang the primer carries is the vector's own bases at the cut.
          const overhang = wrapped(vector.sequence.toString(), iisMin, iisMax).toUpperCase();
          const carried = iisPrimer.segments.spacer.slice(1);
          expect(carried).toBe(iisLower ? overhang : reverseComplement(overhang));
        },
      ),
      { numRuns: 60 },
    );
    expect(designed).toBeGreaterThan(20);
  });

  it("the insert's methylation never blocks a site in it, while the vector's blocks the vector's", () => {
    // XbaI's TCTAGA followed by TC carries a Dam GATC over its end.
    const arb = fc.record({
      seed: fc.integer({ min: 1, max: 0x7fffffff }),
      damVector: fc.boolean(),
      damSource: fc.boolean(),
      insertHasSite: fc.boolean(),
    });
    fc.assert(
      fc.property(arb, ({ seed, damVector, damSource, insertHasSite }) => {
        const rand = seededRandom(seed);
        const blocked = 'TCTAGATC';
        const vectorText = `${randomDna(rand, 400)}GAATTC${randomDna(rand, 12)}${blocked}${randomDna(rand, 400)}`;
        const vector = SeqDocument.create({
          name: 'pV',
          sequence: vectorText,
          topology: 'circular',
          methylation: damVector ? METHYLATED_HOST : UNMETHYLATED_HOST,
        });
        const body = insertHasSite
          ? `${randomDna(rand, 60)}${blocked}${randomDna(rand, 60)}`
          : randomDna(rand, 128);
        const source = SeqDocument.create({
          name: 'src',
          sequence: `${randomDna(rand, 50)}${body}${randomDna(rand, 50)}`,
          topology: 'linear',
          methylation: damSource ? METHYLATED_HOST : UNMETHYLATED_HOST,
        });
        const insert: CloningInsert = {
          document: source,
          range: { start: 50, end: 50 + body.length },
          strand: 'forward',
          name: 'ins',
        };
        const count = (seq: string, topology: 'linear' | 'circular', name: string): number =>
          findCutSites(seq, topology, [enzyme(name)]).length;
        fc.pre(
          count(vectorText, 'circular', 'EcoRI') === 1 &&
            count(vectorText, 'circular', 'XbaI') === 1,
        );
        fc.pre(count(body, 'linear', 'EcoRI') === 0);
        fc.pre(count(body, 'linear', 'XbaI') === (insertHasSite ? 1 : 0));
        // No site spelled by a site and the insert's own first or last bases.
        const junction = (window: string): number =>
          count(window, 'linear', 'EcoRI') + count(window, 'linear', 'XbaI');
        fc.pre(junction(`GAATTC${body.slice(0, 12)}`) === 1);
        fc.pre(junction(`${body.slice(-12)}TCTAGA`) === 1);
        const ctx: CloningContext = {
          vector,
          region: resolveVectorRegion(vector, { start: 400, end: 426 }),
          insert,
          flipped: false,
          scans: scanForCloningNow(vector, insert),
        };
        const report = suggestEnzymePairs(ctx, { forward: 'EcoRI', reverse: 'XbaI' }).picked;
        if (report === null) throw new Error('picked');
        const kinds = report.issues.map((i) => i.kind).sort();
        const expected = [
          ...(damVector ? ['methylation'] : []),
          ...(insertHasSite ? ['cutsInsert'] : []),
        ].sort();
        expect(kinds).toEqual(expected);
        expect(report.reverse.blocked).toEqual(damVector ? ['Dam'] : []);
        const sim = designCloningEnds(ctx, { forward: 'EcoRI', reverse: 'XbaI' }).simulate();
        if (insertHasSite) expect(sim.problem).toMatch(/XbaI cuts inside the insert/);
        else if (damVector) expect(sim.problem).toMatch(/blocked by Dam/);
        else expect(sim.problem).toBeNull();
      }),
      { numRuns: 40 },
    );
  });
});
