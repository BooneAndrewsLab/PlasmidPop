import fc from 'fast-check';

import { SeqDocument, getEnzyme, reverseComplement } from '@/core';

import { goldenGate, overhangWarnings } from './goldenGate';

/**
 * Golden Gate II (#11) checked past the examples in `goldenGate.test.ts`.
 *
 * Two things here are small enough to check completely rather than sample:
 *
 * - `overhangWarnings` over **every** four-base ACGT overhang (256) for the
 *   single-overhang rules, and over every unordered pair of them (32,640)
 *   for the pair rules, against an oracle written from the design rules
 *   themselves rather than from the implementation: Hamming distance 1
 *   between two overhangs, or distance 0 or 1 between one and the other's
 *   reverse complement. Every three-base (SapI) overhang and pair of them
 *   goes through the same oracle, which is where the palindrome rule has to
 *   stay silent: an odd-length overhang can never be its own reverse
 *   complement. Ambiguity codes are enumerated over a small alphabet, and
 *   the mismatch count is by IUPAC mask, so N sits one base from anything.
 *   The point of the sweep is the boundary between the rules: the code
 *   reports at most one pair warning per pair, and which one it reports is
 *   an if/else chain that a single pair of examples cannot pin down.
 *
 * - random two-enzyme designs (fast-check): a vector plus k parts, each one
 *   made for BsaI or BsmBI at random, with overhangs drawn so that no
 *   overhang is another's reverse complement (which is what makes the order
 *   forced). The product must be the circle the design spells out — from any
 *   origin, and on either strand, since the piece the search starts from
 *   fixes both. With one enzyme in the tube the same set must fail as soon
 *   as any part needs the other, and every piece dropped for keeping a site
 *   must name an enzyme whose site it really keeps.
 */

const BsaI = must(getEnzyme('BsaI'), 'BsaI in the enzyme table');
const BsmBI = must(getEnzyme('BsmBI'), 'BsmBI in the enzyme table');

function must<T>(value: T | null | undefined, what: string): T {
  if (value === null || value === undefined) throw new Error(`expected ${what}`);
  return value;
}

// ------------------------------------------------------------------ oracle

/** IUPAC masks, written here rather than imported: the oracle is independent. */
const MASKS: Readonly<Record<string, number>> = {
  A: 1,
  C: 2,
  G: 4,
  T: 8,
  R: 1 | 4,
  Y: 2 | 8,
  S: 2 | 4,
  W: 1 | 8,
  N: 15,
};

const COMPLEMENT: Readonly<Record<string, string>> = {
  A: 'T',
  C: 'G',
  G: 'C',
  T: 'A',
  R: 'Y',
  Y: 'R',
  S: 'S',
  W: 'W',
  N: 'N',
};

function flip(text: string): string {
  let out = '';
  for (let i = text.length - 1; i >= 0; i--) {
    out += must(COMPLEMENT[text.charAt(i)], `complement of ${text.charAt(i)}`);
  }
  return out;
}

/** Positions where the two codes cannot stand for the same base. */
function distance(a: string, b: string): number {
  let n = 0;
  for (let i = 0; i < a.length; i++) {
    const x = MASKS[a.charAt(i)] ?? 0;
    const y = MASKS[b.charAt(i)] ?? 0;
    if ((x & y) === 0) n++;
  }
  return n;
}

type Expected =
  | { readonly rule: 'ambiguous' | 'palindrome'; readonly overhangs: readonly [string] }
  | {
      readonly rule: 'one-base' | 'turned' | 'turned-one-base';
      readonly overhangs: readonly [string, string];
    };

/** The single-overhang rules, from the design rules rather than the code. */
function expectedSingle(o: string): Expected | null {
  if (/[^ACGT]/.test(o)) return { rule: 'ambiguous', overhangs: [o] };
  if (o.length > 0 && o === flip(o)) return { rule: 'palindrome', overhangs: [o] };
  return null;
}

/** The pair rules; at most one applies to a pair. */
function expectedPair(a: string, b: string): Expected | null {
  if (a.length !== b.length || a.length === 0) return null;
  const turned = distance(a, flip(b));
  if (distance(a, b) === 1) return { rule: 'one-base', overhangs: [a, b] };
  if (turned === 0) return { rule: 'turned', overhangs: [a, b] };
  if (turned === 1) return { rule: 'turned-one-base', overhangs: [a, b] };
  return null;
}

/** Which rule a warning's sentence states, so texts are checked and not just pairs. */
function ruleOf(text: string): Expected['rule'] {
  if (text.includes('ambiguity code')) return 'ambiguous';
  if (text.includes('own reverse complement')) return 'palindrome';
  if (text.includes('differ at one base')) return 'one-base';
  if (text.includes('is one base from')) return 'turned-one-base';
  if (text.includes('turned around')) return 'turned';
  throw new Error(`unrecognised warning: ${text}`);
}

function classify(set: readonly string[]): Expected[] {
  return overhangWarnings(set).map((w) => {
    const rule = ruleOf(w.text);
    const overhangs = w.overhangs;
    const [a, b] = overhangs;
    if (overhangs.length === 1 && a !== undefined) return { rule, overhangs: [a] } as Expected;
    if (a === undefined || b === undefined) throw new Error('a warning with no overhangs');
    return { rule, overhangs: [a, b] } as Expected;
  });
}

function kmers(alphabet: string, k: number): string[] {
  const letters: string[] = [];
  for (let i = 0; i < alphabet.length; i++) letters.push(alphabet.charAt(i));
  let out = [''];
  for (let i = 0; i < k; i++) out = out.flatMap((s) => letters.map((c) => s + c));
  return out;
}

const FOUR = kmers('ACGT', 4);
const THREE = kmers('ACGT', 3);

describe('overhangWarnings over every overhang', () => {
  it('flags exactly the palindromes among all 256 four-base overhangs', () => {
    const flagged: string[] = [];
    for (const o of FOUR) {
      const warnings = classify([o]);
      const expected = expectedSingle(o);
      expect(warnings).toEqual(expected === null ? [] : [expected]);
      if (warnings.length > 0) flagged.push(o);
    }
    // 4^2 = 16 of them: the first two bases decide the last two.
    expect(flagged).toHaveLength(16);
    expect(flagged).toContain('GATC');
    expect(flagged).toContain('AATT');
    expect(flagged).not.toContain('AATG');
  });

  it('never calls a three-base overhang a palindrome', () => {
    for (const o of THREE) {
      expect(overhangWarnings([o])).toEqual([]);
      expect(expectedSingle(o)).toBeNull();
    }
  });

  /**
   * Every unordered pair of a set, compared as strings: 32,640 pairs is too
   * many for an `expect` apiece (a second and a half of matcher), so the
   * disagreements are collected and asserted once.
   */
  function disagreements(set: readonly string[]): string[] {
    const out: string[] = [];
    const counts = new Map<Expected['rule'] | 'none', number>();
    for (let i = 0; i < set.length; i++) {
      for (let j = i + 1; j < set.length; j++) {
        const a = must(set[i], 'a');
        const b = must(set[j], 'b');
        const pair = expectedPair(a, b);
        const expected = [expectedSingle(a), expectedSingle(b), pair].filter(
          (e): e is Expected => e !== null,
        );
        const got = classify([a, b]);
        if (JSON.stringify(got) !== JSON.stringify(expected)) {
          out.push(`${a}/${b}: ${JSON.stringify(got)} but expected ${JSON.stringify(expected)}`);
        }
        // The pair rules are an if/else chain: one pair, one warning at most.
        const pairs = got.filter((w) => w.overhangs.length === 2).length;
        if (pairs !== (pair === null ? 0 : 1)) out.push(`${a}/${b}: ${pairs} pair warnings`);
        const rule = pair?.rule ?? 'none';
        counts.set(rule, (counts.get(rule) ?? 0) + 1);
      }
    }
    // Every rule has to be reached, or the sweep proves nothing.
    for (const rule of ['one-base', 'turned', 'turned-one-base', 'none'] as const) {
      if ((counts.get(rule) ?? 0) === 0) out.push(`no pair exercised the ${rule} rule`);
    }
    return out;
  }

  it('matches the oracle on every unordered pair of four-base overhangs', () => {
    expect(disagreements(FOUR)).toEqual([]);
  });

  it('matches the oracle on every unordered pair of three-base overhangs (SapI)', () => {
    expect(disagreements(THREE)).toEqual([]);
  });

  it('says nothing about a pair of identical overhangs that is not a palindrome', () => {
    // A duplicate overhang is not a ligase's mistake but the designer's, and
    // `goldenGate` refuses the assembly as ambiguous rather than warning.
    expect(overhangWarnings(['AATG', 'AATG'])).toEqual([]);
    expect(overhangWarnings(['GATC', 'GATC']).map((w) => w.overhangs)).toEqual([
      ['GATC'],
      ['GATC'],
      ['GATC', 'GATC'],
    ]);
  });

  it('reads an overhang the same in either case, and in either order', () => {
    for (const [a, b] of [
      ['AATG', 'CATT'],
      ['AATG', 'CATA'],
      ['AATG', 'AATC'],
      ['AATG', 'GCTT'],
    ] as const) {
      expect(classify([a.toLowerCase(), b.toLowerCase()])).toEqual(classify([a, b]));
      const forward = classify([a, b]).map((w) => w.rule);
      const back = classify([b, a]).map((w) => w.rule);
      expect(back).toEqual(forward);
    }
  });

  it('flags every overhang with an ambiguity code, and only those', () => {
    for (const o of kmers('ACGTRN', 4)) {
      const expected = expectedSingle(o);
      expect(classify([o])).toEqual(expected === null ? [] : [expected]);
    }
  });

  it('matches the oracle on ambiguous pairs, where a code pairs with each base it stands for', () => {
    const set = kmers('ACN', 4);
    for (let i = 0; i < set.length; i++) {
      for (let j = i + 1; j < set.length; j++) {
        const a = must(set[i], 'a');
        const b = must(set[j], 'b');
        const expected = [expectedSingle(a), expectedSingle(b), expectedPair(a, b)].filter(
          (e): e is Expected => e !== null,
        );
        expect(classify([a, b])).toEqual(expected);
      }
    }
  });

  it('matches the oracle on random sets of several overhangs', () => {
    const overhang = fc.constantFrom(...kmers('ACGTR', 4));
    fc.assert(
      fc.property(fc.array(overhang, { minLength: 0, maxLength: 6 }), (set) => {
        const expected: Expected[] = [];
        for (const o of set) {
          const single = expectedSingle(o);
          if (single !== null) expected.push(single);
        }
        for (let i = 0; i < set.length; i++) {
          for (let j = i + 1; j < set.length; j++) {
            const pair = expectedPair(must(set[i], 'a'), must(set[j], 'b'));
            if (pair !== null) expected.push(pair);
          }
        }
        expect(classify(set)).toEqual(expected);
      }),
      { numRuns: 200 },
    );
  });
});

// ------------------------------------------------- two enzymes in one tube

/**
 * Overhangs no two of which are each other's reverse complement, so a part
 * fits its neighbours one way round only and the order is forced.
 */
const POOL = ['AATG', 'GCTT', 'CGCT', 'TTCG', 'AGGA', 'CCAA', 'TACA', 'GTAG'] as const;

interface EnzymeShape {
  readonly name: 'BsaI' | 'BsmBI';
  readonly site: string;
  readonly back: string;
}

const SHAPES: Readonly<Record<'BsaI' | 'BsmBI', EnzymeShape>> = {
  BsaI: { name: 'BsaI', site: 'GGTCTC', back: 'GAGACC' },
  BsmBI: { name: 'BsmBI', site: 'CGTCTC', back: 'GAGACG' },
};

/** A part as ordered: the site at each end pointing inwards, one spacer base. */
function linearPart(shape: EnzymeShape, left: string, payload: string, right: string): string {
  return `TT${shape.site}A${left}${payload}${right}A${shape.back}TT`;
}

/** The same closed into a circle, so the stuffer carries both sites away. */
function circularPart(shape: EnzymeShape, left: string, payload: string, right: string): string {
  return `${left}${payload}${right}A${shape.back}TTTT${shape.site}A`;
}

function occurrences(text: string, pattern: string): number {
  return text.split(pattern).length - 1;
}

/** Every site of either enzyme, on both strands, in a piece of DNA. */
function siteCount(text: string, shape: EnzymeShape): number {
  return occurrences(text, shape.site) + occurrences(text, shape.back);
}

interface Piece {
  readonly name: string;
  readonly shape: EnzymeShape;
  readonly left: string;
  readonly right: string;
  readonly payload: string;
  readonly sequence: string;
  readonly circular: boolean;
  readonly reversed: boolean;
}

interface Design {
  readonly pieces: readonly Piece[];
  /** The product the design spells out, read from the vector. */
  readonly circle: string;
}

const payloadArb = fc
  .array(fc.constantFrom('A', 'C', 'G', 'T'), { minLength: 12, maxLength: 24 })
  .map((bases) => bases.join(''));

const designArb: fc.Arbitrary<Design> = fc
  .tuple(
    fc.uniqueArray(fc.integer({ min: 0, max: POOL.length - 1 }), { minLength: 2, maxLength: 6 }),
    fc.array(payloadArb, { minLength: 6, maxLength: 6 }),
    fc.array(fc.boolean(), { minLength: 6, maxLength: 6 }),
    fc.array(fc.boolean(), { minLength: 6, maxLength: 6 }),
  )
  .map(([picked, payloads, useSecond, reversed]) => {
    const overhangs = picked.map((i) => must(POOL[i], 'an overhang'));
    const n = overhangs.length;
    const pieces: Piece[] = [];
    let circle = '';
    for (let i = 0; i < n; i++) {
      const left = must(overhangs[i], 'left');
      const right = must(overhangs[(i + 1) % n], 'right');
      const payload = must(payloads[i], 'payload');
      const shape = must(useSecond[i], 'choice') ? SHAPES.BsmBI : SHAPES.BsaI;
      const circular = i === 0;
      const built = circular
        ? circularPart(shape, left, payload, right)
        : linearPart(shape, left, payload, right);
      const turned = !circular && must(reversed[i], 'flip');
      pieces.push({
        name: circular ? 'pDest' : `insert${i}`,
        shape,
        left,
        right,
        payload,
        sequence: turned ? reverseComplement(built) : built,
        circular,
        reversed: turned,
      });
      circle += left + payload;
    }
    return { pieces, circle };
  })
  // No accidental site anywhere: exactly the two the design puts in, and
  // none at all of the other enzyme's.
  .filter(({ pieces }) =>
    pieces.every(
      (p) =>
        siteCount(p.sequence, p.shape) === 2 &&
        siteCount(p.sequence, p.shape.name === 'BsaI' ? SHAPES.BsmBI : SHAPES.BsaI) === 0,
    ),
  );

function documentsOf(design: Design, order: readonly number[]): SeqDocument[] {
  return order.map((i) => {
    const piece = must(design.pieces[i], 'a piece');
    return SeqDocument.create({
      name: piece.name,
      sequence: piece.sequence,
      topology: piece.circular ? 'circular' : 'linear',
    });
  });
}

/** Whether `product` is `circle` read from some origin, on either strand. */
function sameCircle(product: string, circle: string): boolean {
  if (product.length !== circle.length) return false;
  const doubled = (circle + circle).toUpperCase();
  const seen = product.toUpperCase();
  return (
    doubled.includes(seen) || (reverseComplement(circle) + reverseComplement(circle)).includes(seen)
  );
}

describe('goldenGate with a second enzyme (#11)', () => {
  it('assembles one three-part design for every enzyme, orientation and order', () => {
    // Fixed and complete, next to the random designs below: three pieces,
    // every assignment of the two enzymes (8), every orientation of the two
    // inserts (4) and every order the tube could be listed in (6).
    const overhangs = ['AATG', 'GCTT', 'CGCT'] as const;
    const payloads = ['CCCCTTTTAAAAGG', 'AGTCAGTCAGTCAG', 'TTGCATGCATGCAT'] as const;
    const circle = overhangs.map((o, i) => o + must(payloads[i], 'payload')).join('');
    const orders = [
      [0, 1, 2],
      [0, 2, 1],
      [1, 0, 2],
      [1, 2, 0],
      [2, 0, 1],
      [2, 1, 0],
    ];
    let runs = 0;
    for (let enzymeBits = 0; enzymeBits < 8; enzymeBits++) {
      for (let flipBits = 0; flipBits < 4; flipBits++) {
        const pieces: Piece[] = overhangs.map((left, i) => {
          const shape = (enzymeBits >> i) % 2 === 1 ? SHAPES.BsmBI : SHAPES.BsaI;
          const right = must(overhangs[(i + 1) % overhangs.length], 'right');
          const payload = must(payloads[i], 'payload');
          const circular = i === 0;
          const built = circular
            ? circularPart(shape, left, payload, right)
            : linearPart(shape, left, payload, right);
          const reversed = !circular && (flipBits >> (i - 1)) % 2 === 1;
          return {
            name: circular ? 'pDest' : `insert${i}`,
            shape,
            left,
            right,
            payload,
            sequence: reversed ? reverseComplement(built) : built,
            circular,
            reversed,
          };
        });
        for (const piece of pieces) {
          expect(siteCount(piece.sequence, piece.shape)).toBe(2);
        }
        for (const order of orders) {
          const result = goldenGate(documentsOf({ pieces, circle }, order), {
            enzyme: BsaI,
            secondEnzyme: BsmBI,
          });
          expect(result.problem).toBeNull();
          const product = must(result.assembly, 'an assembly').product;
          expect(sameCircle(product.sequence.toString(), circle)).toBe(true);
          runs++;
        }
      }
    }
    expect(runs).toBe(8 * 4 * 6);
  });

  it('builds the circle the design spells out, whatever order and orientation the parts come in', () => {
    let mixed = 0;
    let turned = 0;
    let many = 0;
    fc.assert(
      fc.property(designArb, fc.integer({ min: 0, max: 719 }), (design, rotation) => {
        const n = design.pieces.length;
        if (new Set(design.pieces.map((p) => p.shape.name)).size > 1) mixed++;
        if (design.pieces.some((p) => p.reversed)) turned++;
        if (n >= 4) many++;
        // A rotation and a reversal of the order: the parts are a tube,
        // not a list, so which one the search starts from is arbitrary.
        const base = [...Array(n).keys()];
        const shift = rotation % n;
        const order = [...base.slice(shift), ...base.slice(0, shift)];
        if (rotation % 2 === 1) order.reverse();

        const docs = documentsOf(design, order);
        const both = goldenGate(docs, { enzyme: BsaI, secondEnzyme: BsmBI });
        expect(both.problem).toBeNull();
        const assembly = must(both.assembly, 'an assembly');
        expect(assembly.product.isCircular).toBe(true);
        expect(assembly.product.length).toBe(design.circle.length);
        expect(sameCircle(assembly.product.sequence.toString(), design.circle)).toBe(true);
        expect(assembly.order).toHaveLength(n);
        // Every part is in the product once.
        expect(new Set(assembly.order.map((p) => p.fragment.source)).size).toBe(n);
        // A part given back to front is turned round, and one given the
        // right way round is not — unless it is the one the search
        // started from, whose orientation defines the strand.
        for (const part of assembly.order.slice(1)) {
          const piece = must(
            design.pieces.find((p) => p.name === part.fragment.source),
            'the piece',
          );
          const startedReversed = must(design.pieces[must(order[0], 'first')], 'first').reversed;
          expect(part.flipped).toBe(piece.reversed !== startedReversed);
        }
      }),
      { numRuns: 120 },
    );
    // The generator has to have produced the cases the test is about.
    expect(mixed).toBeGreaterThan(0);
    expect(turned).toBeGreaterThan(0);
    expect(many).toBeGreaterThan(0);
  }, 20000);

  it('fails with one enzyme exactly when a part needs the other, and names the site kept', () => {
    let mixed = 0;
    let single = 0;
    let named = 0;
    fc.assert(
      fc.property(designArb, (design) => {
        const docs = documentsOf(design, [...Array(design.pieces.length).keys()]);
        const needsBoth = new Set(design.pieces.map((p) => p.shape.name)).size > 1;
        const alone = goldenGate(docs, { enzyme: BsaI });
        if (needsBoth) {
          mixed++;
          expect(alone.assembly).toBeNull();
          expect(alone.problem).not.toBeNull();
        } else if (design.pieces.every((p) => p.shape.name === 'BsaI')) {
          single++;
          expect(alone.problem).toBeNull();
          expect(
            sameCircle(must(alone.assembly, 'assembly').product.sequence.toString(), design.circle),
          ).toBe(true);
        }
        // Whatever the outcome, a piece dropped for a site really keeps one
        // of that enzyme's, on one strand or the other.
        for (const drop of goldenGate(docs, { enzyme: BsaI, secondEnzyme: BsmBI }).dropped) {
          if (drop.reason !== 'site') continue;
          const name = must(drop.enzyme, 'the enzyme of a dropped piece');
          expect(name === 'BsaI' || name === 'BsmBI').toBe(true);
          const shape = must(SHAPES[name === 'BsaI' ? 'BsaI' : 'BsmBI'], 'a shape');
          expect(siteCount(drop.fragment.sequence.toUpperCase(), shape)).toBeGreaterThan(0);
          named++;
        }
      }),
      { numRuns: 120 },
    );
    expect(mixed).toBeGreaterThan(0);
    expect(single).toBeGreaterThan(0);
    expect(named).toBeGreaterThan(0);
  });

  it('treats a second enzyme the same as the first as one enzyme', () => {
    fc.assert(
      fc.property(designArb, (design) => {
        const docs = documentsOf(design, [...Array(design.pieces.length).keys()]);
        const one = goldenGate(docs, { enzyme: BsaI });
        const twice = goldenGate(docs, { enzyme: BsaI, secondEnzyme: BsaI });
        expect(twice.problem).toEqual(one.problem);
        expect(twice.usable.map((f) => f.sequence)).toEqual(one.usable.map((f) => f.sequence));
        expect(twice.assembly?.product.sequence.toString()).toEqual(
          one.assembly?.product.sequence.toString(),
        );
        // And it says "BsaI", not "BsaI and BsaI".
        expect(twice.problem ?? twice.assembly?.product.metadata.description ?? '').not.toContain(
          'BsaI and BsaI',
        );
      }),
      { numRuns: 60 },
    );
  });
});
