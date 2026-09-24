import fc from 'fast-check';

import {
  SeqDocument,
  findAnnealingSites,
  meltingTemperature,
  reverseComplement,
  threePrimeComplementarity,
} from '@/core';
import { randomDna, seededRandom } from '@/test/random';

import { UNMETHYLATED_HOST } from '../analysis/methylation';
import { digest } from './digest';
import { assemblyJunctions, flipFragment, ligate } from './ligate';
import { POLYMERASE_REACH, type Polymerase, type PcrPrimer, pcr, primerDimers } from './pcr';

/**
 * PCR II (#14) against what a bench would do with the same oligos.
 *
 * - **Taq A-tailing.** For random templates and random primer pairs, tails
 *   and all — linear, circular across the origin, and inverse PCR round a
 *   whole plasmid — Taq's product is the proofreading product with one A
 *   more, its ends exactly a 3′ T on the left and a 3′ A on the right, and
 *   it ligates into a synthetic T-vector (3′ T on both ends) either way
 *   round, to give vector and insert and nothing else. A blunt product does
 *   not, and neither closes on itself.
 * - **Reach.** `POLYMERASE_REACH` is inclusive: a 5,000 bp product is Taq's,
 *   5,001 is too long; 20,000 and 20,001 likewise for a proofreading enzyme;
 *   an explicit `maxProduct` overrides either, for random lengths.
 * - **`primerDimers`** against a brute-force oracle (every 3′ stretch of one
 *   oligo against every place in the other) over random short primers, with
 *   the threshold exactly: 4 paired bases are not a dimer, 5 are.
 * - **`templateTm`** equals `tm` without a mismatch and is the Tm of the 3′
 *   stretch before the first mismatch with one, found here by walking the
 *   template independently. It is usually lower than `tm` but not always:
 *   nearest-neighbour Tm is not monotone in length (a fixed case shows it).
 * - Every product is made in a tube, so carries no methylation.
 *
 * Templates come from a seeded mulberry32 (`@/test/random`), not the LCG of
 * older tests, whose bad seeds give repetitive sequence; a random pair that
 * still primes more than once is assumed away, since it is the template's
 * doing rather than the reaction's.
 */

function must<T>(value: T | null | undefined, what: string): T {
  if (value === null || value === undefined) throw new Error(`expected ${what}`);
  return value;
}

function wrapped(text: string, from: number, to: number): string {
  const L = text.length;
  let out = '';
  for (let i = from; i < to; i++) out += text.charAt(((i % L) + L) % L);
  return out;
}

const dna = (min: number, max: number) =>
  fc
    .array(fc.constantFrom('A', 'C', 'G', 'T'), { minLength: min, maxLength: max })
    .map((a) => a.join(''));

interface Reaction {
  readonly template: SeqDocument;
  readonly primers: readonly PcrPrimer[];
  /** Tail, template copied, tail: what the product must read. */
  readonly expected: string;
}

/**
 * A random template and a pair designed on it: a forward site, a span, a
 * reverse site ending the span, random 5′ tails. On a circle the span may
 * cross the origin, or be the whole circle (inverse PCR).
 */
const reactionArb: fc.Arbitrary<Reaction> = fc
  .record({
    seed: fc.integer({ min: 1, max: 0x7fffffff }),
    length: fc.integer({ min: 300, max: 3000 }),
    topology: fc.constantFrom<'linear' | 'circular'>('linear', 'circular'),
    shape: fc.constantFrom('ordinary', 'origin', 'inverse'),
    where: fc.integer({ min: 0, max: 1_000_000 }),
    span: fc.integer({ min: 60, max: 1_000_000 }),
    fLen: fc.integer({ min: 18, max: 28 }),
    rLen: fc.integer({ min: 18, max: 28 }),
    fTail: dna(0, 12),
    rTail: dna(0, 12),
  })
  .map((r) => {
    const text = randomDna(seededRandom(r.seed), r.length);
    const L = text.length;
    const circular = r.topology === 'circular';
    let start: number;
    let span: number;
    if (!circular) {
      span = 60 + (r.span % (L - 60));
      start = r.where % (L - span + 1);
    } else if (r.shape === 'inverse') {
      span = L;
      start = r.where % L;
    } else if (r.shape === 'origin') {
      span = 60 + (r.span % (L - 60));
      // Start late enough that the span runs over the origin.
      start = L - 1 - (r.where % (span - 1));
    } else {
      span = 60 + (r.span % (L - 60));
      start = r.where % L;
    }
    const f = wrapped(text, start, start + r.fLen);
    const rv = reverseComplement(wrapped(text, start + span - r.rLen, start + span));
    return {
      template: SeqDocument.create({ name: 'tpl', sequence: text, topology: r.topology }),
      primers: [
        { name: 'F', sequence: r.fTail + f },
        { name: 'R', sequence: r.rTail + rv },
      ],
      expected: r.fTail + wrapped(text, start, start + span) + reverseComplement(r.rTail),
    };
  });

/** A T-vector: linear, one untemplated 3′ T on each strand's end. */
function tVector(bases: string): SeqDocument {
  return SeqDocument.create({
    name: 'pT',
    sequence: `${bases}T`,
    topology: 'linear',
    ends: {
      // The bottom strand's 3′ T hangs off the left end; the top strand
      // would read A there.
      left: { kind: "3'", overhang: 'A', enzyme: null },
      right: { kind: "3'", overhang: 'T', enzyme: null },
    },
  });
}

describe('Taq A-tailing, for random reactions', () => {
  it('is the proofreading product and an A, with a 3′ T left and a 3′ A right', () => {
    fc.assert(
      fc.property(reactionArb, (x) => {
        const blunt = pcr(x.template, x.primers);
        const taq = pcr(x.template, x.primers, { polymerase: 'taq' });
        expect(blunt.products.length).toBeGreaterThanOrEqual(1);
        fc.pre(blunt.products.length === 1);
        expect(taq.products).toHaveLength(1);
        const b = must(blunt.products[0], 'a blunt product').document;
        const t = must(taq.products[0], 'a Taq product').document;
        expect(b.sequence.toString()).toBe(x.expected);
        expect(t.sequence.toString()).toBe(`${x.expected}A`);
        expect(b.ends).toBeNull();
        expect(t.ends).toEqual({
          left: { kind: "3'", overhang: 'T', enzyme: null },
          right: { kind: "3'", overhang: 'A', enzyme: null },
        });
        expect(t.topology).toBe('linear');
        // Listed as long as the document it opens as, A and all (#74): the
        // list, the gel and the shelf all say one number.
        expect(must(blunt.products[0], 'a blunt product').length).toBe(b.length);
        expect(must(taq.products[0], 'a Taq product').length).toBe(t.length);
        expect(t.length).toBe(b.length + 1);
        // Made in a tube: no methylase has seen either, whatever the template's host.
        expect(x.template.methylation).not.toEqual(UNMETHYLATED_HOST);
        expect(b.methylation).toEqual(UNMETHYLATED_HOST);
        expect(t.methylation).toEqual(UNMETHYLATED_HOST);
      }),
      { numRuns: 150 },
    );
  }, 10_000);

  it('ligates into a T-vector either way round, and nothing else does', () => {
    fc.assert(
      fc.property(reactionArb, fc.integer({ min: 1, max: 0x7fffffff }), (x, vSeed) => {
        const taq = pcr(x.template, x.primers, { polymerase: 'taq' });
        fc.pre(taq.products.length === 1);
        const product = must(taq.products[0], 'a product').document;
        const [insert] = digest(product, []);
        const ins = must(insert, 'the whole product');
        expect(ins.left).toEqual({ kind: "3'", overhang: 'T', enzyme: null });
        expect(ins.right).toEqual({ kind: "3'", overhang: 'A', enzyme: null });

        const bases = randomDna(seededRandom(vSeed), 400);
        const [vector] = digest(tVector(bases), []);
        const vec = must(vector, 'the vector');
        const circle = ligate([vec, ins], { name: 'TA', circular: true });
        expect(circle.isCircular).toBe(true);
        expect(circle.sequence.toString()).toBe(`${bases}T${x.expected}A`);
        // TA cloning has no direction: the insert goes in the other way too.
        const back = ligate([vec, flipFragment(ins)], { name: 'TA', circular: true });
        expect(back.sequence.toString()).toBe(
          `${bases}T${reverseComplement(`${x.expected}A`).slice(1)}A`,
        );
        expect(back.length).toBe(bases.length + x.expected.length + 2);

        // An A-tailed product cannot close on itself, and a blunt one does not
        // go into a T-vector.
        expect(assemblyJunctions([ins], true).every((j) => j.compatible)).toBe(false);
        const blunt = must(
          digest(must(pcr(x.template, x.primers).products[0], 'blunt').document, [])[0],
          'blunt',
        );
        expect(assemblyJunctions([vec, blunt], true).some((j) => j.compatible)).toBe(false);
        expect(() => ligate([vec, blunt], { name: 'x', circular: true })).toThrow(/Incompatible/);
      }),
      { numRuns: 100 },
    );
  }, 10_000);

  it('A-tails a product that crosses the origin, and the whole plasmid', () => {
    const text = randomDna(seededRandom(101), 1500);
    const plasmid = SeqDocument.create({ name: 'p', sequence: text, topology: 'circular' });
    const across = pcr(
      plasmid,
      [
        { name: 'F', sequence: text.slice(1400, 1422) },
        { name: 'R', sequence: reverseComplement(text.slice(80, 102)) },
      ],
      { polymerase: 'taq' },
    );
    expect(across.products.map((p) => p.document.sequence.toString())).toEqual([
      `${text.slice(1400)}${text.slice(0, 102)}A`,
    ]);
    const whole = pcr(
      plasmid,
      [
        { name: 'F', sequence: text.slice(0, 22) },
        { name: 'R', sequence: reverseComplement(text.slice(1478)) },
      ],
      { polymerase: 'taq' },
    );
    expect(whole.products.map((p) => p.document.sequence.toString())).toEqual([`${text}A`]);
  });
});

describe('inverse PCR with primers whose 5′ ends overlap', () => {
  const text = randomDna(seededRandom(606), 1200);
  const plasmid = SeqDocument.create({ name: 'p', sequence: text, topology: 'circular' });

  it('copies the whole circle and the overlap again, for every overlap up to a site', () => {
    // Back to back at 700, the reverse primer's site running k bases past
    // the forward one's 5′ end: both still point away from each other.
    for (let k = 0; k < 22; k++) {
      for (const polymerase of ['proofreading', 'taq'] as const) {
        const result = pcr(
          plasmid,
          [
            { name: 'F', sequence: text.slice(700, 724) },
            { name: 'R', sequence: reverseComplement(text.slice(678 + k, 700 + k)) },
          ],
          { polymerase },
        );
        const product = must(result.products[0], `a product at overlap ${k}`);
        expect(result.products).toHaveLength(1);
        // Counted as its document is: a Taq product's A is in it (#74).
        expect(product.length).toBe(1200 + k + (polymerase === 'taq' ? 1 : 0));
        expect(product.length).toBe(product.document.length);
        const expected = text.slice(700) + text.slice(0, 700 + k);
        expect(product.document.sequence.toString()).toBe(
          polymerase === 'taq' ? `${expected}A` : expected,
        );
        // The range drawn on the views stays a valid one: the whole circle.
        expect(product.templateRange).toEqual({ start: 700, end: 1900 });
      }
    }
  });

  it('still amplifies nothing from two primers on top of each other', () => {
    // QuikChange's pair: each 3′ end sits in the other's site.
    const site = text.slice(690, 720);
    const result = pcr(plasmid, [
      { name: 'F', sequence: site },
      { name: 'R', sequence: reverseComplement(site) },
    ]);
    expect(result.products).toEqual([]);
    expect(result.problem).toMatch(/overlap each other/);
  });
});

describe('polymerase reach', () => {
  const text = randomDna(seededRandom(2026), 20_200);
  const long = SeqDocument.create({ name: 'long', sequence: text });
  /** A pair copying exactly `span` bases from 50. */
  const pair = (span: number): PcrPrimer[] => [
    { name: 'F', sequence: text.slice(50, 72) },
    { name: 'R', sequence: reverseComplement(text.slice(50 + span - 22, 50 + span)) },
  ];

  it.each<[Polymerase, number, boolean]>([
    ['taq', 5_000, true],
    ['taq', 5_001, false],
    ['proofreading', 20_000, true],
    ['proofreading', 20_001, false],
    ['proofreading', 5_001, true],
  ])('%s makes a %i bp product: %s', (polymerase, span, made) => {
    const result = pcr(long, pair(span), { polymerase });
    const reach = POLYMERASE_REACH[polymerase];
    if (made) {
      // The reach is of the duplex; a Taq product is listed with its A too.
      expect(result.products.map((p) => p.length)).toEqual([span + (polymerase === 'taq' ? 1 : 0)]);
      expect(result.problem).toBeNull();
    } else {
      expect(result.products).toEqual([]);
      expect(result.tooLong).toBe(1);
      expect(result.problem).toBe(
        `The primers would amplify, but the product is longer than ${reach.toLocaleString()} bp.`,
      );
    }
  });

  it('gives way to an explicit maxProduct, above the reach or below it', () => {
    expect(pcr(long, pair(5_500), { polymerase: 'taq', maxProduct: 6_000 }).products).toHaveLength(
      1,
    );
    expect(pcr(long, pair(900), { polymerase: 'proofreading', maxProduct: 899 }).tooLong).toBe(1);
    const strip = SeqDocument.create({ name: 's', sequence: text.slice(0, 2200) });
    fc.assert(
      fc.property(
        fc.integer({ min: 60, max: 2_100 }),
        fc.integer({ min: 44, max: 2_100 }),
        fc.constantFrom<Polymerase>('taq', 'proofreading'),
        (span, max, polymerase) => {
          const result = pcr(strip, pair(span), { polymerase, maxProduct: max });
          // A reverse primer that happens to prime a second time is the
          // template's doing.
          fc.pre(result.sites.length === 2);
          if (span <= max) {
            expect(result.products.map((p) => p.length)).toEqual([
              span + (polymerase === 'taq' ? 1 : 0),
            ]);
            expect(result.tooLong).toBe(0);
          } else {
            expect(result.products).toEqual([]);
            expect(result.tooLong).toBe(1);
            expect(result.problem).toMatch(`longer than ${max.toLocaleString()} bp`);
          }
        },
      ),
      { numRuns: 150 },
    );
  });
});

/** Every 3′ stretch of `a`, reverse-complemented, looked for anywhere in `b`. */
function dimerOracle(a: string, b: string): number {
  let best = 0;
  for (let k = 1; k <= Math.min(a.length, b.length); k++) {
    const rc = reverseComplement(a.slice(a.length - k));
    for (let i = 0; i + k <= b.length; i++) {
      if (b.slice(i, i + k) === rc) best = Math.max(best, k);
    }
  }
  return best;
}

describe('primerDimers', () => {
  const oligo = fc
    .array(fc.constantFrom('A', 'C', 'G', 'T', 'a', 'c', 'g', 't', 'N', '-', ' '), {
      maxLength: 14,
    })
    .map((a) => a.join(''));

  it('reports every ordered pair, itself included, past the threshold, as the oracle does', () => {
    fc.assert(
      fc.property(
        fc.array(oligo, { minLength: 1, maxLength: 3 }),
        fc.integer({ min: 0, max: 7 }),
        (sequences, max) => {
          const primers = sequences.map((sequence, i) => ({ name: `P${i}`, sequence }));
          const clean = primers.map((p) => p.sequence.toUpperCase().replace(/[^ACGT]/g, ''));
          const want: { primer: string; partner: string; bases: number }[] = [];
          clean.forEach((a, i) => {
            clean.forEach((b, j) => {
              if (a === '' || b === '') return;
              const bases = dimerOracle(a, b);
              if (bases > max) want.push({ primer: `P${i}`, partner: `P${j}`, bases });
            });
          });
          expect(primerDimers(primers, max)).toEqual(want);
          for (const a of clean)
            for (const b of clean) {
              expect(threePrimeComplementarity(a, b)).toBe(dimerOracle(a, b));
            }
        },
      ),
      { numRuns: 400 },
    );
  });

  it('counts 4 paired bases as no dimer and 5 as one, by default', () => {
    // GACC's reverse complement GGTC is in the partner, TGACC's GGTCA is not.
    const four = primerDimers([
      { name: 'Forward', sequence: 'TTTTTTTTTGACC' },
      { name: 'Reverse', sequence: 'CCCCGGTCCCCC' },
    ]);
    expect(four).toEqual([]);
    const five = primerDimers([
      { name: 'Forward', sequence: 'TTTTTTTTTGACC' },
      { name: 'Reverse', sequence: 'CCCCGGTCACCC' },
    ]);
    expect(five).toEqual([{ primer: 'Forward', partner: 'Reverse', bases: 5 }]);
    // Reported from the primer whose 3′ end pairs, so swapping the order of
    // the two changes the order of the list, not its entries.
    expect(
      primerDimers([
        { name: 'Reverse', sequence: 'CCCCGGTCACCC' },
        { name: 'Forward', sequence: 'TTTTTTTTTGACC' },
      ]),
    ).toEqual([{ primer: 'Forward', partner: 'Reverse', bases: 5 }]);
    // A palindrome at the 3′ end pairs with a second copy of itself.
    expect(primerDimers([{ name: 'Solo', sequence: 'ttttGAATTC' }])).toEqual([
      { primer: 'Solo', partner: 'Solo', bases: 6 },
    ]);
    expect(primerDimers([])).toEqual([]);
    expect(primerDimers([{ name: 'Empty', sequence: 'NNNN' }])).toEqual([]);
  });
});

describe('templateTm', () => {
  /** Primer bases before the first mismatch, walked from the 3′ end over the site. */
  function perfectStretch(
    text: string,
    circular: boolean,
    site: {
      primer: string;
      range: { start: number; end: number };
      strand: string;
      annealLength: number;
    },
  ): number {
    const L = text.length;
    const at = (i: number) => (circular ? text.charAt(((i % L) + L) % L) : text.charAt(i));
    const n = site.primer.length;
    for (let i = 0; i < site.annealLength; i++) {
      const primerBase = site.primer.charAt(n - 1 - i);
      const paired =
        site.strand === 'forward'
          ? at(site.range.end - 1 - i)
          : reverseComplement(at(site.range.start + i));
      if (paired !== primerBase) return i;
    }
    return site.annealLength;
  }

  it('is tm without a mismatch, and the Tm of the 3′ stretch before the first one with', () => {
    let mismatched = 0;
    let higher = 0;
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 0x7fffffff }),
        fc.integer({ min: 200, max: 900 }),
        fc.boolean(),
        fc.integer({ min: 0, max: 1_000_000 }),
        fc.integer({ min: 18, max: 32 }),
        fc.boolean(),
        fc.array(fc.integer({ min: 5, max: 31 }), { maxLength: 2 }),
        dna(0, 6),
        (seed, length, circular, where, len, onTop, flips, tail) => {
          const text = randomDna(seededRandom(seed), length);
          const start = where % (circular ? length : length - len);
          const site = wrapped(text, start, start + len);
          let primer = (onTop ? site : reverseComplement(site)).split('');
          for (const back of flips) {
            if (back >= len) continue;
            const i = len - 1 - back;
            const base = must(primer[i], 'a base');
            primer[i] = base === 'A' ? 'C' : base === 'C' ? 'G' : base === 'G' ? 'T' : 'A';
          }
          primer = [...tail.split(''), ...primer];
          const sites = findAnnealingSites(text, circular ? 'circular' : 'linear', primer.join(''));
          for (const s of sites) {
            const k = perfectStretch(text, circular, s);
            expect(s.tm).toBe(meltingTemperature(s.primer.slice(s.primer.length - s.annealLength)));
            expect(s.templateTm).toBe(meltingTemperature(s.primer.slice(s.primer.length - k)));
            if (s.mismatches === 0) {
              expect(k).toBe(s.annealLength);
              expect(s.templateTm).toBe(s.tm);
            } else {
              mismatched++;
              expect(k).toBeLessThan(s.annealLength);
              // Not always ≤ tm: a nearest-neighbour Tm is not monotone in
              // length, and a GC-rich 3′ stretch can melt higher than itself
              // plus a mismatched AT-rich run (see the fixed case below).
              if (s.templateTm > s.tm) higher++;
            }
          }
        },
      ),
      { numRuns: 300 },
    );
    expect(mismatched).toBeGreaterThan(50);
    // The usual case is lower; the exception is rare.
    expect(higher).toBeLessThan(mismatched / 4);
  });

  it('can exceed tm, when the mismatched part is weak enough to pull the whole down', () => {
    // The counterexample fast-check found: an 18-base site whose 5′ tail TAT
    // happens to continue it, with mismatches, for a few AT bases more.
    const text = randomDna(seededRandom(1919937706), 200);
    const primer = `TAT${text.slice(11, 29)}`;
    const [site] = findAnnealingSites(text, 'linear', primer).filter((s) => s.strand === 'forward');
    const s = must(site, 'a site');
    expect(s.mismatches).toBeGreaterThan(0);
    expect(s.templateTm).toBe(meltingTemperature(text.slice(11, 29)));
    expect(s.templateTm).toBeGreaterThan(s.tm);
  });

  it('carries through pcr to each site it reports', () => {
    const text = randomDna(seededRandom(5150), 1200);
    const doc = SeqDocument.create({ name: 't', sequence: text });
    const f = text.slice(100, 110) + (text.charAt(110) === 'A' ? 'C' : 'A') + text.slice(111, 130);
    const [site] = pcr(doc, [{ name: 'F', sequence: f }]).sites;
    const s = must(site, 'a site');
    expect(s.mismatches).toBe(1);
    expect(s.templateTm).toBe(meltingTemperature(text.slice(111, 130)));
    expect(s.tm).toBe(meltingTemperature(f));
  });
});
