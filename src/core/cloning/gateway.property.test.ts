import fc from 'fast-check';

import { SeqDocument, createFeature, rangeSegment, reverseComplement } from '@/core';
import { parseGenBank, writeGenBank } from '@/io';
import { seededRandom, randomDna } from '@/test/random';

import { type GatewayReaction, attSites, gateway } from './gateway';

/**
 * Gateway recombination checked against a naive oracle (#62, item 48).
 *
 * A BP or LR is a double crossover: partner sites share a core, and the DNA
 * either side of it changes hands. Because the core is the same on both
 * partners, crossing over anywhere inside it gives the same molecules, so
 * the oracle needs no crossover point at all — it swaps *arms*. For sites
 * `l1·C1·r1` / `L1·C1·R1` and `l2·C2·r2` / `L2·C2·R2` around an insert
 * payload and a vector cassette, the two products are, as plain strings,
 *
 *   product    = L1·C1·r1 · payload  · l2·C2·R2 · vector backbone
 *   byproduct  = l1·C1·R1 · cassette · L2·C2·r2 · insert backbone
 *
 * (lower case the insert's arms, upper case the vector's). Nothing of
 * `gateway.ts` is used to compute that, so a wrong crossover, a lost base,
 * a swapped circle or a mislabelled site shows up as a difference.
 *
 * The designs are random and synthetic — random arms around random cores
 * of 7–15 bases, random payload and backbones, each circle rotated so a
 * site may wrap the origin, each molecule written on either strand (its
 * sites then annotated on the reverse), features annotated in random
 * order, numbers from the multisite set. Arms are repaired so a core
 * cannot run on into its arms, and a design is kept only if the core is
 * the one stretch of its length the two partners share: that is the
 * premise of the whole reaction, and without it the "right" answer is not
 * defined. None of the sequences is a real att site (a vendor's are
 * licensed, and the crossover needs only a shared core).
 *
 * Then fixed enumerations: every refusal the reaction makes, the core
 * length boundary (6 refuses, 7 runs), how `attSites` reads names, and the
 * warnings — frame across a site for every small gap, the 30-base reach,
 * ccdB and short cores.
 */

const rc = reverseComplement;

/** The codebase forbids `!`, and a missing product is a test failure worth a sentence. */
function must<T>(value: T | null | undefined, what: string): T {
  if (value === null || value === undefined) throw new Error(`expected ${what}`);
  return value;
}

/** Whether two strings are the same circle, read from any origin. */
function sameCircle(actual: string, expected: string): boolean {
  return actual.length === expected.length && (actual + actual).includes(expected);
}

/** Every (i, j) at which `a` and `b` share `length` bases. */
function sharedWindows(a: string, b: string, length: number): number {
  let n = 0;
  for (let i = 0; i + length <= a.length; i++) {
    const w = a.slice(i, i + length);
    for (let j = 0; j + length <= b.length; j++) if (b.slice(j, j + length) === w) n++;
  }
  return n;
}

/** Longest stretch two strings share, the naive way. */
function longestShared(a: string, b: string): number {
  let best = 0;
  for (let len = 1; len <= Math.min(a.length, b.length); len++) {
    if (sharedWindows(a, b, len) > 0) best = len;
    else break;
  }
  return best;
}

// ------------------------------------------------------------------ model

interface Site {
  readonly number: string;
  readonly left: string;
  readonly core: string;
  readonly right: string;
}

const siteText = (s: Site): string => s.left + s.core + s.right;

/** A molecule as the oracle sees it: two sites, what lies between, and the rest. */
interface Mol {
  readonly one: Site;
  readonly middle: string;
  readonly two: Site;
  readonly rest: string;
}

/** A molecule's features, by what they cover. */
interface Names {
  readonly middle: string;
  readonly rest: string;
}

const molText = (m: Mol): string => siteText(m.one) + m.middle + siteText(m.two) + m.rest;

/** The oracle: swap arms at each shared core. */
function recombine(insert: Mol, vector: Mol): { product: Mol; byproduct: Mol } {
  return {
    product: {
      one: { ...insert.one, left: vector.one.left },
      middle: insert.middle,
      two: { ...insert.two, right: vector.two.right },
      rest: vector.rest,
    },
    byproduct: {
      one: { ...insert.one, right: vector.one.right },
      middle: vector.middle,
      two: { ...insert.two, left: vector.two.left },
      rest: insert.rest,
    },
  };
}

interface Part {
  readonly text: string;
  readonly name?: string;
  readonly type?: string;
}

interface Layout {
  readonly reverse: boolean;
  /** Where the circle is opened, as any whole number (taken modulo the length). */
  readonly rotation: number;
  /** Sort keys giving the order the features are handed to the document in. */
  readonly order: readonly number[];
  readonly topology: 'circular' | 'linear';
}

const PLAIN: Layout = { reverse: false, rotation: 0, order: [], topology: 'circular' };

/**
 * Lays parts end to end (read on their own strand), then writes the
 * molecule on the chosen strand and opens the circle where asked. Each
 * named part becomes one feature, a site that wraps the origin as one
 * unrolled range, the way the model keeps it.
 */
function build(name: string, parts: readonly Part[], layout: Layout): SeqDocument {
  const read = parts.map((p) => p.text).join('');
  const L = read.length;
  let sequence = layout.reverse ? rc(read) : read;
  const rotation = layout.topology === 'circular' && L > 0 ? layout.rotation % L : 0;
  sequence = sequence.slice(rotation) + sequence.slice(0, rotation);
  const features = [];
  let at = 0;
  for (const part of parts) {
    const start = at;
    at += part.text.length;
    if (part.name === undefined || part.text.length === 0) continue;
    const s = layout.reverse ? L - at : start;
    const moved = (s - rotation + L) % L;
    features.push(
      createFeature({
        type: part.type ?? 'misc_feature',
        name: part.name,
        strand: layout.reverse ? 'reverse' : 'forward',
        segments: [rangeSegment(moved, moved + part.text.length)],
      }),
    );
  }
  const keyed = features.map((f, i) => ({ f, key: layout.order[i] ?? i }));
  keyed.sort((a, b) => a.key - b.key);
  return SeqDocument.create({
    name,
    topology: layout.topology,
    sequence,
    features: keyed.map((k) => k.f),
  });
}

function molParts(mol: Mol, kind: string, names: Names): Part[] {
  const site = (s: Site): Part => ({
    text: siteText(s),
    name: `att${kind}${s.number}`,
    type: 'protein_bind',
  });
  return [
    site(mol.one),
    { text: mol.middle, name: names.middle, type: 'CDS' },
    site(mol.two),
    { text: mol.rest, name: names.rest, type: 'CDS' },
  ];
}

/** The att features of a document, each read on its own strand. */
function attFeatures(doc: SeqDocument) {
  return doc.features
    .all()
    .filter((f) => /^att/i.test(f.name))
    .map((f) => ({ name: f.name, strand: f.strand, text: doc.featureSequence(f) }));
}

function otherNames(doc: SeqDocument): string[] {
  return doc.features
    .all()
    .filter((f) => !/^att/i.test(f.name))
    .map((f) => f.name)
    .sort();
}

/**
 * The recombinant sites are exactly the oracle's: one arm from each parent
 * round the core, named for the reaction, numbered for what pairs, on the
 * strand the insert was written on.
 */
function expectSites(doc: SeqDocument, kind: string, mol: Mol, reverse: boolean): void {
  const got = attFeatures(doc).sort((a, b) => a.name.localeCompare(b.name));
  const want = [mol.one, mol.two]
    .map((s) => ({
      name: `att${kind}${s.number}`,
      strand: reverse ? 'reverse' : 'forward',
      text: siteText(s),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
  expect(got).toEqual(want);
  expect(
    attSites(doc)
      .map((s) => s.kind)
      .join(''),
  ).toBe(kind + kind);
}

// ------------------------------------------------------------- arbitraries

const NUMBERS = ['1', '2', '3', '4', '5', '2r'] as const;
const ACGT = 'ACGT';
const base = fc.constantFrom(...ACGT.split(''));
const dna = (min: number, max: number) => fc.string({ unit: base, minLength: min, maxLength: max });
const armsArb = fc.record({ left: dna(4, 16), right: dna(4, 16) });
const layoutArb = (topology: 'circular' | 'linear' = 'circular'): fc.Arbitrary<Layout> =>
  fc.record({
    reverse: fc.boolean(),
    rotation: fc.nat({ max: 10_000 }),
    order: fc.array(fc.nat(), { minLength: 4, maxLength: 4 }),
    topology: fc.constant(topology),
  });

/** A base other than `b`, so a core cannot run on into the arms around it. */
const other = (b: string): string => ACGT.charAt((ACGT.indexOf(b) + 1 + (b.charCodeAt(0) % 3)) % 4);

/** `theirs` with its arms' inner ends changed where they would extend the core shared with `ours`. */
function repaired(
  ours: { left: string; right: string },
  theirs: { left: string; right: string },
): { left: string; right: string } {
  let { left, right } = theirs;
  if (left.slice(-1) === ours.left.slice(-1)) left = left.slice(0, -1) + other(left.slice(-1));
  if (ours.right !== '' && right.startsWith(ours.right.charAt(0)))
    right = other(right.charAt(0)) + right.slice(1);
  return { left, right };
}

/** Whether two partner sites share their core and nothing else as long. */
const pairsCleanly = (a: Site, b: Site): boolean =>
  sharedWindows(siteText(a), siteText(b), a.core.length) === 1;

interface Design {
  readonly insert: Mol;
  readonly vector: Mol;
}

/** Two partner molecules: sites numbered alike, sharing cores, arms their own. */
const designArb: fc.Arbitrary<Design> = fc
  .record({
    numbers: fc.shuffledSubarray([...NUMBERS], { minLength: 2, maxLength: 2 }),
    cores: fc.tuple(dna(7, 15), dna(7, 15)),
    insertArms: fc.tuple(armsArb, armsArb),
    vectorArms: fc.tuple(armsArb, armsArb),
    payload: dna(0, 40),
    insertRest: dna(0, 40),
    cassette: dna(1, 40),
    vectorRest: dna(0, 40),
  })
  .map((d): Design => {
    const [n1 = '1', n2 = '2'] = d.numbers;
    const site = (number: string, core: string, arms: { left: string; right: string }): Site => ({
      number,
      core,
      ...arms,
    });
    return {
      insert: {
        one: site(n1, d.cores[0], d.insertArms[0]),
        middle: d.payload,
        two: site(n2, d.cores[1], d.insertArms[1]),
        rest: d.insertRest,
      },
      vector: {
        one: site(n1, d.cores[0], repaired(d.insertArms[0], d.vectorArms[0])),
        middle: d.cassette,
        two: site(n2, d.cores[1], repaired(d.insertArms[1], d.vectorArms[1])),
        rest: d.vectorRest,
      },
    };
  })
  .filter(
    (d) => pairsCleanly(d.insert.one, d.vector.one) && pairsCleanly(d.insert.two, d.vector.two),
  );

const REACTIONS: Record<GatewayReaction, { from: [string, string]; to: [string, string] }> = {
  BP: { from: ['B', 'P'], to: ['L', 'R'] },
  LR: { from: ['L', 'R'], to: ['B', 'P'] },
};

const INSERT_NAMES: Names = { middle: 'gene', rest: 'ampR' };
const VECTOR_NAMES: Names = { middle: 'ccdB', rest: 'kanR' };

/** The feature names a molecule of the oracle should carry besides its att sites. */
function expectedNames(mol: Mol, middle: string, rest: string): string[] {
  return [mol.middle === '' ? [] : [middle], mol.rest === '' ? [] : [rest]].flat().sort();
}

// -------------------------------------------------------------- properties

describe('gateway against a naive recombination oracle', () => {
  for (const reaction of ['BP', 'LR'] as const) {
    it(`${reaction}: both circles, their sites and their bases are the oracle's`, () => {
      const { from, to } = REACTIONS[reaction];
      fc.assert(
        fc.property(designArb, layoutArb(), layoutArb(), (design, insertLayout, vectorLayout) => {
          const insert = build(
            'pIns',
            molParts(design.insert, from[0], INSERT_NAMES),
            insertLayout,
          );
          const vector = build(
            'pVec',
            molParts(design.vector, from[1], VECTOR_NAMES),
            vectorLayout,
          );
          const run = gateway(insert, vector, reaction);
          expect(run.problem).toBeNull();
          const product = must(run.product, 'a product');
          const byproduct = must(run.byproduct, 'a byproduct');
          const want = recombine(design.insert, design.vector);
          const oriented = (m: Mol): string => (insertLayout.reverse ? rc(molText(m)) : molText(m));

          // The circles, read from any origin, on the insert's strand.
          expect(sameCircle(product.sequence.toString(), oriented(want.product))).toBe(true);
          expect(sameCircle(byproduct.sequence.toString(), oriented(want.byproduct))).toBe(true);
          expect(product.isCircular && byproduct.isCircular).toBe(true);
          // No base made or lost.
          expect(product.length + byproduct.length).toBe(insert.length + vector.length);
          // Exactly two recombinant sites on each, of the kinds the reaction makes.
          expectSites(product, to[0], want.product, insertLayout.reverse);
          expectSites(byproduct, to[1], want.byproduct, insertLayout.reverse);
          // The clone is the circle without ccdB, however the sites fell.
          expect(otherNames(product)).toEqual(expectedNames(want.product, 'gene', 'kanR'));
          expect(otherNames(byproduct)).toEqual(expectedNames(want.byproduct, 'ccdB', 'ampR'));
          // The insert's payload arrives whole.
          const payload = insertLayout.reverse ? rc(design.insert.middle) : design.insert.middle;
          const p = product.sequence.toString();
          expect((p + p).includes(payload)).toBe(true);
        }),
        { numRuns: 150 },
      );
    }, 15_000);
  }

  it('a linear substrate gives the same clone, no byproduct, and loses exactly its flanks', () => {
    fc.assert(
      fc.property(
        designArb,
        dna(0, 30),
        dna(0, 30),
        layoutArb('linear'),
        layoutArb(),
        (design, flankL, flankR, insertLayout, vectorLayout) => {
          const insert = build(
            'attB-PCR',
            [
              { text: flankL },
              ...molParts(design.insert, 'B', INSERT_NAMES).slice(0, 3),
              { text: flankR },
            ],
            insertLayout,
          );
          const vector = build('pDONR', molParts(design.vector, 'P', VECTOR_NAMES), vectorLayout);
          const run = gateway(insert, vector, 'BP');
          expect(run.problem).toBeNull();
          expect(run.byproduct).toBeNull();
          const product = must(run.product, 'a product');
          const want = recombine(design.insert, design.vector).product;
          const text = insertLayout.reverse ? rc(molText(want)) : molText(want);
          expect(sameCircle(product.sequence.toString(), text)).toBe(true);
          expect(product.isCircular).toBe(true);
          // What is lost: each flank and the outer arm of each substrate
          // site from the substrate; from the donor, the cassette, the arms
          // beside it and the cores (the substrate's copies are kept).
          const lostInsert =
            flankL.length +
            flankR.length +
            design.insert.one.left.length +
            design.insert.two.right.length;
          const lostVector =
            design.vector.one.right.length +
            design.vector.middle.length +
            design.vector.two.left.length +
            design.vector.one.core.length +
            design.vector.two.core.length;
          expect(product.length).toBe(insert.length + vector.length - lostInsert - lostVector);
          expectSites(product, 'L', want, insertLayout.reverse);
        },
      ),
      { numRuns: 100 },
    );
  }, 15_000);

  it('BP then LR carries the insert whole into the expression clone, via a GenBank file or not', () => {
    const roundTrip = fc
      .record({
        design: designArb,
        destArms: fc.tuple(armsArb, armsArb),
        cassette: dna(1, 40),
        rest: dna(0, 40),
      })
      .map(({ design, destArms, cassette, rest }) => {
        const entry = recombine(design.insert, design.vector).product;
        const dest: Mol = {
          one: { ...entry.one, ...repaired(entry.one, destArms[0]) },
          middle: cassette,
          two: { ...entry.two, ...repaired(entry.two, destArms[1]) },
          rest,
        };
        return { design, entry, dest };
      })
      .filter(
        ({ entry, dest }) => pairsCleanly(entry.one, dest.one) && pairsCleanly(entry.two, dest.two),
      );
    fc.assert(
      fc.property(
        roundTrip,
        layoutArb(),
        layoutArb(),
        layoutArb(),
        fc.boolean(),
        ({ design, entry, dest }, subLayout, donorLayout, destLayout, viaFile) => {
          const substrate = build('pSub', molParts(design.insert, 'B', INSERT_NAMES), subLayout);
          const donor = build('pDONR', molParts(design.vector, 'P', VECTOR_NAMES), donorLayout);
          const destination = build(
            'pDEST',
            molParts(dest, 'R', { middle: 'ccdB', rest: 'specR' }),
            destLayout,
          );
          let clone = must(gateway(substrate, donor, 'BP').product, 'an entry clone');
          if (viaFile) clone = must(parseGenBank(writeGenBank(clone)).documents[0], 'a record');
          const run = gateway(clone, destination, 'LR');
          expect(run.problem).toBeNull();
          const expression = must(run.product, 'an expression clone');
          const want = recombine(entry, dest);
          const oriented = (m: Mol): string => (subLayout.reverse ? rc(molText(m)) : molText(m));
          expect(sameCircle(expression.sequence.toString(), oriented(want.product))).toBe(true);
          expect(
            sameCircle(
              must(run.byproduct, 'a byproduct').sequence.toString(),
              oriented(want.byproduct),
            ),
          ).toBe(true);
          expectSites(expression, 'B', want.product, subLayout.reverse);
          expect(otherNames(expression)).toEqual(expectedNames(want.product, 'gene', 'specR'));
          const e = expression.sequence.toString();
          const payload = subLayout.reverse ? rc(design.insert.middle) : design.insert.middle;
          expect((e + e).includes(payload)).toBe(true);
        },
      ),
      { numRuns: 80 },
    );
  }, 20_000);
});

// ----------------------------------------------------------- fixed designs

/**
 * A fixed design whose arms cannot run into the core: the insert's arms
 * are all A/C and the vector's all G/T. Cores are drawn from a seed until
 * the core is the only stretch of its length the partners share, which is
 * checked rather than assumed.
 */
function fixedDesign(
  coreLengths: readonly [number, number],
  numbers: [string, string] = ['1', '2'],
) {
  const insertArms = [
    { left: 'CACCAACACA', right: 'ACCACAACAC' },
    { left: 'AACACCACAA', right: 'CAACACCAAC' },
  ] as const;
  const vectorArms = [
    { left: 'GTTGTGGTGT', right: 'TGGTGTTGTG' },
    { left: 'TGTGGTTGTG', right: 'GGTTGTGTGG' },
  ] as const;
  const sites = coreLengths.map((length, k) => {
    const ia = insertArms[k] ?? insertArms[0];
    const va = vectorArms[k] ?? vectorArms[0];
    for (let seed = 1; ; seed++) {
      const core = randomDna(seededRandom(seed * 97 + length * 13 + k), length);
      const ins: Site = { number: numbers[k] ?? '1', core, ...ia };
      const vec: Site = { number: numbers[k] ?? '1', core, ...va };
      if (
        sharedWindows(siteText(ins), siteText(vec), length) === 1 &&
        longestShared(siteText(ins), siteText(vec)) === length
      ) {
        return { ins, vec };
      }
    }
  });
  const [one, two] = sites as [(typeof sites)[0], (typeof sites)[0]];
  const filler = (n: number, seed: number) => randomDna(seededRandom(seed), n);
  return {
    insert: { one: one.ins, middle: filler(120, 3), two: two.ins, rest: filler(200, 4) } as Mol,
    vector: { one: one.vec, middle: filler(90, 5), two: two.vec, rest: filler(150, 6) } as Mol,
  };
}

function fixedPair(
  insertKind: string,
  vectorKind: string,
  coreLengths: readonly [number, number] = [15, 15],
) {
  const d = fixedDesign(coreLengths);
  return {
    design: d,
    insert: build('pIns', molParts(d.insert, insertKind, INSERT_NAMES), PLAIN),
    vector: build('pVec', molParts(d.vector, vectorKind, VECTOR_NAMES), PLAIN),
  };
}

/** A copy of `doc` whose att features are renamed by `rename`, or dropped where it returns null. */
function relabel(
  doc: SeqDocument,
  rename: (name: string, i: number) => string | null,
): SeqDocument {
  let out = doc;
  attSites(doc).forEach((s, i) => {
    const name = rename(s.feature.name, i);
    out =
      name === null ? out.removeFeature(s.feature.id) : out.updateFeature(s.feature.id, { name });
  });
  return out;
}

describe('what gateway refuses', () => {
  const KINDS = ['B', 'P', 'L', 'R'] as const;

  it('runs only when the insert and vector carry the kinds the reaction takes', () => {
    for (const reaction of ['BP', 'LR'] as const) {
      const { from } = REACTIONS[reaction];
      for (const ik of KINDS) {
        for (const vk of KINDS) {
          const { insert, vector } = fixedPair(ik, vk);
          const run = gateway(insert, vector, reaction);
          const ok = ik === from[0] && vk === from[1];
          expect(run.problem === null, `${reaction} of att${ik} × att${vk}`).toBe(ok);
          if (!ok) {
            expect(run.product).toBeNull();
            expect(run.byproduct).toBeNull();
            expect(run.problem).toMatch(
              ik === from[0]
                ? new RegExp(`pVec has no att${from[1]} site annotated`)
                : new RegExp(`pIns has no att${from[0]} site annotated`),
            );
          }
        }
      }
    }
  });

  it('wants two sites of the kind on each side: not one, not three', () => {
    const { insert, vector } = fixedPair('B', 'P');
    expect(
      gateway(
        relabel(insert, (n, i) => (i === 0 ? null : n)),
        vector,
        'BP',
      ).problem,
    ).toMatch(/pIns has only one attB site annotated/);
    expect(
      gateway(
        insert,
        relabel(vector, (n, i) => (i === 1 ? null : n)),
        'BP',
      ).problem,
    ).toMatch(/pVec has only one attP site annotated/);
    const third = (doc: SeqDocument, name: string) =>
      doc.addFeature(
        createFeature({ type: 'protein_bind', name, segments: [rangeSegment(200, 230)] }),
      );
    expect(gateway(third(insert, 'attB3'), vector, 'BP').problem).toMatch(/More than two sites/);
    expect(gateway(insert, third(vector, 'attP3'), 'BP').problem).toMatch(/More than two sites/);
  });

  it('refuses an insert carrying one number twice, and numbers that do not pair', () => {
    const { insert, vector } = fixedPair('B', 'P');
    expect(
      gateway(
        relabel(insert, () => 'attB1'),
        vector,
        'BP',
      ).problem,
    ).toMatch(/pIns carries attB1 twice/);
    for (const [a, b] of [
      ['attP1', 'attP3'],
      ['attP3', 'attP2'],
      ['attP2r', 'attP1'],
      ['attP4', 'attP5'],
    ] as const) {
      const renamed = relabel(vector, (_n, i) => (i === 0 ? a : b));
      expect(gateway(insert, renamed, 'BP').problem, `${a} and ${b}`).toMatch(/do not pair/);
    }
    // Swapped labels still pair by number, but then the cores do not match.
    expect(
      gateway(
        insert,
        relabel(vector, (_n, i) => (i === 0 ? 'attP2' : 'attP1')),
        'BP',
      ).problem,
    ).toMatch(/share no core/);
  });

  it('refuses a vector turned over at one site but not the other', () => {
    const { insert, vector } = fixedPair('B', 'P');
    const site = must(attSites(vector)[0], 'attP1');
    const mixed = vector.updateFeature(site.feature.id, { strand: 'reverse' });
    expect(gateway(insert, mixed, 'BP').problem).toMatch(/do not lie the same way round/);
  });

  it('needs a core of seven: six shared bases refuse, seven run', () => {
    for (const [c1, c2, ok] of [
      [6, 15, false],
      [15, 6, false],
      [6, 6, false],
      [7, 15, true],
      [15, 7, true],
      [7, 7, true],
    ] as const) {
      const { insert, vector } = fixedPair('B', 'P', [c1, c2]);
      const run = gateway(insert, vector, 'BP');
      expect(run.problem === null, `cores ${c1} and ${c2}`).toBe(ok);
      if (!ok) {
        expect(run.problem).toMatch(
          new RegExp(`attB${c1 === 6 ? 1 : 2} of pIns and its partner in pVec share no core of 7`),
        );
      }
    }
  });
});

describe('attSites', () => {
  const named = (name: string) =>
    SeqDocument.create({
      sequence: 'ACGT'.repeat(10),
      features: [createFeature({ type: 'protein_bind', name, segments: [rangeSegment(2, 12)] })],
    });
  const read = (name: string) => attSites(named(name)).map((s) => `${s.kind}:${s.number}`);

  it.each([
    ['attB1', ['B:1']],
    ['ATTP2R', ['P:2r']],
    ['attP2r', ['P:2r']],
    ['attL10', ['L:10']],
    ['attR4', ['R:4']],
    ['AttL5', ['L:5']],
    [' attR1 ', ['R:1']],
    ['attX1', []],
    ['attB', []],
    ['attB1 site', []],
    ['my attB1', []],
    ['attB1rr', []],
    ['attBr', []],
    ['attB-1', []],
  ] as const)('reads %j as %j', (name, want) => {
    expect(read(name)).toEqual(want);
  });

  it('gives the range and strand it was annotated with, sorted along the molecule', () => {
    const doc = SeqDocument.create({
      sequence: 'ACGT'.repeat(10),
      topology: 'circular',
      features: [
        createFeature({ type: 'x', name: 'attB2', segments: [rangeSegment(30, 45)] }),
        createFeature({
          type: 'x',
          name: 'attB1',
          strand: 'reverse',
          segments: [rangeSegment(3, 9)],
        }),
      ],
    });
    expect(attSites(doc).map((s) => [s.number, s.range, s.strand])).toEqual([
      ['1', { start: 3, end: 9 }, 'reverse'],
      ['2', { start: 30, end: 45 }, 'forward'],
    ]);
  });
});

// ---------------------------------------------------------------- warnings

describe('gateway warnings', () => {
  const d = fixedDesign([15, 15]);
  const filler = (n: number, seed: number) => randomDna(seededRandom(seed), n);
  // The attB1 an LR of these makes: the destination's left arm, the entry's right.
  const siteLength =
    d.vector.one.left.length + d.insert.one.core.length + d.insert.one.right.length;

  /**
   * An LR in which a destination tag ends `before` bases short of attR1
   * and the entry's gene starts `after` bases past attL1, so in the
   * expression clone the two lie `before + attB1 + after` apart.
   */
  function fusion(before: number, after: number) {
    const entry = build(
      'pENTR',
      [
        { text: siteText(d.insert.one), name: `attL1`, type: 'protein_bind' },
        { text: 'A'.repeat(after) },
        { text: filler(60, 21), name: 'gene', type: 'CDS' },
        { text: 'A'.repeat(40) },
        { text: siteText(d.insert.two), name: 'attL2', type: 'protein_bind' },
        { text: filler(100, 22), name: 'kanR', type: 'misc_feature' },
      ],
      PLAIN,
    );
    const destination = build(
      'pDEST',
      [
        { text: filler(60, 23), name: 'tag', type: 'CDS' },
        { text: 'T'.repeat(before) },
        { text: siteText(d.vector.one), name: 'attR1', type: 'protein_bind' },
        { text: filler(50, 24), name: 'ccdB', type: 'CDS' },
        { text: siteText(d.vector.two), name: 'attR2', type: 'protein_bind' },
        { text: 'T'.repeat(100) },
      ],
      PLAIN,
    );
    const run = gateway(entry, destination, 'LR');
    expect(run.problem).toBeNull();
    return run.warnings.filter((w) => w.includes('out of frame'));
  }

  it('warns of a fusion out of frame for every small gap either side, and only then', () => {
    for (let before = 0; before <= 8; before++) {
      for (let after = 0; after <= 8; after++) {
        const gap = before + siteLength + after;
        const warned = fusion(before, after);
        expect(warned.length, `gaps ${before} and ${after}`).toBe(gap % 3 === 0 ? 0 : 1);
        if (gap % 3 !== 0) {
          expect(warned[0]).toContain(`tag and gene are ${gap} bases apart across attB1`);
        }
      }
    }
  });

  it('reads a coding feature as a fusion partner up to 30 bases away, not 31', () => {
    /** The first small gap on the other side that leaves the pair out of frame. */
    const offFrame = (fixed: number) =>
      [0, 1, 2].find((g) => (fixed + siteLength + g) % 3 !== 0) ?? 0;
    for (const reach of [29, 30, 31]) {
      const expected = reach <= 30 ? 1 : 0;
      expect(fusion(reach, offFrame(reach)).length, `tag ${reach} bases short`).toBe(expected);
      expect(fusion(offFrame(reach), reach).length, `gene ${reach} bases past`).toBe(expected);
    }
  });

  it('warns about ccdB exactly when the vector has a feature called so', () => {
    for (const [name, warns] of [
      ['ccdB', true],
      ['CCDB', true],
      ['ccdB toxin', true],
      ['cassette-ccdb', true],
      ['ccd', false],
      ['toxin', false],
      ['cat', false],
    ] as const) {
      const { insert } = fixedPair('B', 'P');
      const vector = build('pVec', molParts(d.vector, 'P', { middle: name, rest: 'kanR' }), PLAIN);
      const run = gateway(insert, vector, 'BP');
      expect(run.problem).toBeNull();
      expect(
        run.warnings.some((w) => w.includes('ccdB cassette of pVec leaves on the byproduct')),
        name,
      ).toBe(warns);
    }
  });

  it('warns of a short core exactly when a pair shares fewer than 15 bases', () => {
    for (const c1 of [7, 14, 15, 16]) {
      for (const c2 of [7, 14, 15, 16]) {
        const { insert, vector } = fixedPair('B', 'P', [c1, c2]);
        const run = gateway(insert, vector, 'BP');
        expect(run.problem).toBeNull();
        const short = run.warnings.flatMap((w) => /shares only (\d+) bases/.exec(w)?.[1] ?? []);
        const want = [c1, c2].filter((c) => c < 15).map(String);
        expect(short, `cores ${c1} and ${c2}`).toEqual(want);
      }
    }
  });
});
