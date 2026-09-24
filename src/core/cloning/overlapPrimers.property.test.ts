import fc from 'fast-check';

import { SeqDocument, meltingTemperature, reverseComplement } from '@/core';
import { randomDna, seededRandom } from '@/test/random';

import { KIT_OVERLAP, type OverlapKit, designOverlapPrimers } from './overlapPrimers';

/**
 * In-Fusion and NEBuilder primer design (#63), checked by what the design
 * makes rather than by how it is written.
 *
 * For random linear vectors and random regions of random templates — linear
 * and circular, regions over a circle's origin too — a design without a
 * problem must close: the product is circular, as long as the vector and
 * the region together, and is the vector followed by the insert, read from
 * any origin. The forward tail is the vector's last k bases and the reverse
 * tail the reverse complement of its first k, with k = 15 for In-Fusion and
 * 20 for NEBuilder; the annealing parts are the insert's own ends grown to
 * 60 °C. The refusals are checked at their edges (a region one base too
 * short, a circular vector, a vector shorter than the homology), and the
 * case the design's comment warns of is built on purpose: a vector whose
 * end happens to continue the template past the region, so the annealing
 * search counts a tail base as template and the amplicon's template range
 * starts before the selection — the design must still pick that amplicon.
 *
 * Sequences come from a seeded mulberry32 (`@/test/random`) rather than the
 * old LCG, whose bad seeds give repetitive sequence where no primer is
 * unique; a design that is still not specific is counted, not failed.
 */

function must<T>(value: T | null | undefined, what: string): T {
  if (value === null || value === undefined) throw new Error(`expected ${what}`);
  return value;
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
  readonly template: SeqDocument;
  readonly region: { start: number; end: number };
  readonly insert: string;
  readonly kit: OverlapKit;
}

const setupArb: fc.Arbitrary<Setup> = fc
  .record({
    seed: fc.integer({ min: 1, max: 0x7fffffff }),
    vLength: fc.integer({ min: 200, max: 2000 }),
    tLength: fc.integer({ min: 900, max: 3000 }),
    circular: fc.boolean(),
    where: fc.integer({ min: 0, max: 1_000_000 }),
    size: fc.integer({ min: 36, max: 800 }),
    kit: fc.constantFrom<OverlapKit>('in-fusion', 'nebuilder'),
    lower: fc.boolean(),
  })
  .map((r) => {
    // One stream for both, so a shrunk case never makes them the same.
    const rand = seededRandom(r.seed);
    const v = randomDna(rand, r.vLength);
    const t = randomDna(rand, r.tLength);
    const vText = r.lower ? v.toLowerCase() : v;
    const start = r.circular ? r.where % r.tLength : r.where % (r.tLength - r.size + 1);
    const region = { start, end: start + r.size };
    return {
      vector: SeqDocument.create({ name: 'pVec', sequence: vText, topology: 'linear' }),
      template: SeqDocument.create({
        name: 'src',
        sequence: t,
        topology: r.circular ? 'circular' : 'linear',
      }),
      region,
      insert: wrapped(t, region.start, region.end),
      kit: r.kit,
    };
  });

/** The rules every closed design keeps. */
function checkDesign(s: Setup): boolean {
  const d = designOverlapPrimers(s.vector, s.template, s.region, s.kit);
  const k = KIT_OVERLAP[s.kit];
  const v = s.vector.sequence.toString();
  expect(d.kit).toBe(s.kit);
  expect(d.forward.tail).toBe(v.slice(v.length - k).toUpperCase());
  expect(d.reverse.tail).toBe(reverseComplement(v.slice(0, k)).toUpperCase());
  const fa = d.forward.annealLength;
  const ra = d.reverse.annealLength;
  expect(d.forward.sequence).toBe(d.forward.tail + s.insert.slice(0, fa).toLowerCase());
  expect(d.reverse.sequence).toBe(
    d.reverse.tail + reverseComplement(s.insert.slice(s.insert.length - ra)).toLowerCase(),
  );
  for (const p of [d.forward, d.reverse]) {
    expect(p.annealLength).toBeGreaterThanOrEqual(18);
    // Grown to 60 °C, but never past 30 bases or half the insert, where the
    // two would overlap and amplify nothing.
    const cap = Math.min(30, Math.floor(s.insert.length / 2));
    expect(p.annealLength).toBeLessThanOrEqual(cap);
    expect(p.tm).toBe(meltingTemperature(p.sequence.slice(p.tail.length)));
    if (p.annealLength < cap) expect(p.tm).toBeGreaterThanOrEqual(60);
  }
  if (d.problem !== null) {
    expect(d.product).toBeNull();
    return false;
  }
  const amplicon = must(d.amplicon, 'an amplicon');
  expect(amplicon.sequence.toString().toUpperCase()).toBe(
    (v.slice(v.length - k) + s.insert + v.slice(0, k)).toUpperCase(),
  );
  const product = must(d.product, 'a product');
  expect(product.isCircular).toBe(true);
  expect(product.length).toBe(v.length + s.insert.length);
  expect(sameCircle(product.sequence.toString(), v + s.insert)).toBe(true);
  expect(d.warnings).toContain(
    `${s.kit === 'in-fusion' ? 'In-Fusion' : 'NEBuilder HiFi'} asks for ${k} bases of homology, which both tails carry.`,
  );
  return true;
}

describe('designOverlapPrimers, for random vectors and inserts', () => {
  it('closes into vector ‖ insert, with the kit’s homology on the tails', () => {
    let closed = 0;
    let runs = 0;
    fc.assert(
      fc.property(setupArb, (s) => {
        runs++;
        if (checkDesign(s)) closed++;
      }),
      { numRuns: 100 },
    );
    // Random sequence is specific almost always; a design that fails should
    // be the rare template that primes twice.
    expect(closed).toBeGreaterThan(runs * 0.9);
  }, 15_000);

  it('picks the designed amplicon when a tail base continues the template', () => {
    // The vector's last bases are the template's just before the region, and
    // its first ones the template's just after, so both tails anneal a little
    // and the site starts before the selection. The design finds its product
    // by what it holds, not by where it starts.
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 0x7fffffff }),
        fc.integer({ min: 1, max: 4 }),
        fc.integer({ min: 0, max: 4 }),
        fc.constantFrom<OverlapKit>('in-fusion', 'nebuilder'),
        (seed, before, after, kit) => {
          const rand = seededRandom(seed);
          const t = randomDna(rand, 1500);
          const region = { start: 500, end: 900 };
          const middle = randomDna(rand, 600);
          const v =
            t.slice(region.end, region.end + after) +
            middle +
            t.slice(region.start - before, region.start);
          const s: Setup = {
            vector: SeqDocument.create({ name: 'pVec', sequence: v }),
            template: SeqDocument.create({ name: 'src', sequence: t }),
            region,
            insert: t.slice(region.start, region.end),
            kit,
          };
          const d = designOverlapPrimers(s.vector, s.template, s.region, kit);
          fc.pre(!(d.problem ?? '').includes('not specific'));
          expect(d.problem).toBeNull();
          expect(checkDesign(s)).toBe(true);
        },
      ),
      { numRuns: 60 },
    );
  }, 10_000);
});

describe('designOverlapPrimers refuses', () => {
  const t = randomDna(seededRandom(77), 2000);
  const template = SeqDocument.create({ name: 'src', sequence: t });
  const v = randomDna(seededRandom(31), 800);
  const vector = SeqDocument.create({ name: 'pVec', sequence: v });

  it.each<OverlapKit>(['in-fusion', 'nebuilder'])(
    'a region shorter than two annealing parts, and takes one exactly that long (%s)',
    (kit) => {
      const short = designOverlapPrimers(vector, template, { start: 1000, end: 1035 }, kit);
      expect(short.problem).toBe(
        'The selected 35 bp is too short to amplify: a primer needs 18 bases at each end.',
      );
      expect(short.amplicon).toBeNull();
      expect(short.forward.sequence).toBe('');
      expect(short.forward.tm).toBeNaN();
      const enough = designOverlapPrimers(vector, template, { start: 1000, end: 1036 }, kit);
      expect(enough.problem).toBeNull();
      expect(must(enough.product, 'a product').length).toBe(v.length + 36);
      // Every short insert the check lets through closes: the annealing
      // parts stop at half the insert rather than overlap and amplify nothing.
      for (let size = 36; size <= 70; size++) {
        const d = designOverlapPrimers(vector, template, { start: 1000, end: 1000 + size }, kit);
        expect(d.problem).toBeNull();
        expect(d.forward.annealLength + d.reverse.annealLength).toBeLessThanOrEqual(size);
        expect(must(d.product, 'a product').length).toBe(v.length + size);
      }
    },
  );

  it('a circular vector, and a vector shorter than the homology', () => {
    const circle = SeqDocument.create({ name: 'pRing', sequence: v, topology: 'circular' });
    for (const kit of ['in-fusion', 'nebuilder'] as const) {
      const d = designOverlapPrimers(circle, template, { start: 100, end: 600 }, kit);
      expect(d.problem).toMatch(/^pRing is circular, so it has no ends/);
      expect(d.product).toBeNull();
    }
    const stub = (n: number) => SeqDocument.create({ name: 'pStub', sequence: v.slice(0, n) });
    expect(
      designOverlapPrimers(stub(14), template, { start: 100, end: 600 }, 'in-fusion').problem,
    ).toBe('pStub is shorter than the 15 bases of homology In-Fusion asks for.');
    expect(
      designOverlapPrimers(stub(15), template, { start: 100, end: 600 }, 'in-fusion').problem,
    ).toBeNull();
    expect(
      designOverlapPrimers(stub(19), template, { start: 100, end: 600 }, 'nebuilder').problem,
    ).toBe('pStub is shorter than the 20 bases of homology NEBuilder HiFi asks for.');
  });

  it('warns of other products, and still picks the one that holds the whole insert', () => {
    // The region's first and last 30 bases again, earlier in the template
    // and closer together, so a shorter product without the whole insert
    // wins the tube.
    const ends = t.slice(1000, 1030) + randomDna(seededRandom(9), 100) + t.slice(1470, 1500);
    const repeated = SeqDocument.create({
      name: 'rep',
      sequence: t.slice(0, 300) + ends + t.slice(300),
    });
    const shift = ends.length;
    const d = designOverlapPrimers(
      vector,
      repeated,
      { start: 1000 + shift, end: 1500 + shift },
      'in-fusion',
    );
    // Its own product is still there, and is still the one chosen.
    expect(d.problem).toBeNull();
    expect(d.warnings.join(' ')).toMatch(/also amplify \d+ other/);
    expect(must(d.product, 'a product').length).toBe(v.length + 500);
  });
});
