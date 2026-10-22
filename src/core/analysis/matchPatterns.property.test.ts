import fc from 'fast-check';

import { type Topology } from '../range';
import { reverseComplement } from '../sequence';
import {
  type Enzyme,
  activeEnzymes,
  findCutSites,
  findCutSitesOnePassEach,
  siteStillMatches,
} from './restriction';
import {
  findSequenceMatches,
  matchPatterns,
  matchPositions,
  patternMasks,
  sequenceMasks,
} from './search';

// #275: `matchPatterns` takes every site in one pass, and `findCutSites` is
// built on it. The pass per pattern it replaced, `matchPositions`, and
// `findCutSitesOnePassEach` built on that, are the oracles.

const IUPAC = 'ACGTRYSWKMBDHVN';

/** Mostly plain bases, with ambiguity codes, lower case and junk now and then. */
const sequenceArb = (maxLength: number) =>
  fc
    .array(
      fc.oneof(
        { weight: 30, arbitrary: fc.constantFrom('A', 'C', 'G', 'T') },
        { weight: 2, arbitrary: fc.constantFrom(...IUPAC.split('')) },
        { weight: 1, arbitrary: fc.constantFrom('a', 'c', 'g', 't', 'n', 'X', '-', 'U') },
      ),
      { maxLength },
    )
    .map((bases) => bases.join(''));

/** Every bundled site and its reverse complement, to plant among random bases. */
const BUNDLED = activeEnzymes();
const PLANTS = [...new Set(BUNDLED.flatMap((e) => [e.site, reverseComplement(e.site)]))];

/**
 * A sequence that holds bundled sites, so the six- and eight-cutters that
 * random bases rarely spell are matched too. A site's N, R and so on are
 * either kept, so the sequence is ambiguous there, or spelled out as a base.
 */
const plantedArb = fc
  .array(
    fc.oneof(
      sequenceArb(40),
      fc
        .tuple(fc.constantFrom(...PLANTS), fc.boolean(), fc.nat())
        .map(([site, keep, seed]) =>
          keep ? site : site.replace(/[^ACGT]/g, (_, i: number) => 'ACGT'.charAt((seed + i) % 4)),
        ),
    ),
    { maxLength: 30 },
  )
  .map((parts) => parts.join(''));

const topologyArb = fc.constantFrom<Topology>('linear', 'circular');

describe('matchPatterns (#275)', () => {
  it('gives each pattern exactly the starts matchPositions gives it', () => {
    const masksArb = fc
      .array(
        fc.oneof(
          { weight: 12, arbitrary: fc.constantFrom(1, 2, 4, 8) },
          { weight: 2, arbitrary: fc.integer({ min: 0, max: 15 }) },
        ),
        { maxLength: 200 },
      )
      .map((m) => Uint8Array.from(m));
    const patternArb = fc.array(
      fc.oneof(
        { weight: 8, arbitrary: fc.constantFrom(1, 2, 4, 8) },
        { weight: 3, arbitrary: fc.integer({ min: 0, max: 15 }) },
      ),
      { maxLength: 14 },
    );
    fc.assert(
      fc.property(
        masksArb,
        fc.array(fc.tuple(patternArb, fc.integer({ min: -3, max: 220 })), { maxLength: 12 }),
        (masks, list) => {
          const patterns = list.map(([p]) => p);
          const maxStarts = list.map(([, m]) => m);
          expect(matchPatterns(masks, patterns, maxStarts)).toEqual(
            patterns.map((p, i) => matchPositions(masks, p, maxStarts[i] ?? -1)),
          );
        },
      ),
      { numRuns: 500 },
    );
  }, 30_000);

  it('matches ambiguous sequence and patterns as matchPositions does', () => {
    const seq = 'ACGTNNNNGAATTCRGATCYGCCAGTCGGCNNACGTGATCAAAA';
    const masks = sequenceMasks(seq);
    const sites = ['GATC', 'GAATTC', 'GCCNNNNNGGC', 'NNNN', 'RGCY', 'GA', 'N', '', 'ACGTNN'];
    const patterns = sites.map(patternMasks);
    const maxStarts = sites.map((s) => seq.length - s.length);
    const expected = patterns.map((p, i) => matchPositions(masks, p, maxStarts[i] ?? -1));
    expect(matchPatterns(masks, patterns, maxStarts)).toEqual(expected);
    // The N run matches only patterns that allow N there, as before.
    expect(expected[3]).toContain(4);
    expect(expected[0]).toEqual([15, 36]);
  });

  it('returns nothing for every pattern over an empty sequence', () => {
    const patterns = ['GATC', 'GAATTC'].map(patternMasks);
    expect(matchPatterns(new Uint8Array(0), patterns, [10, 10])).toEqual([[], []]);
    expect(matchPatterns(sequenceMasks('ACGTACGT'), [], [])).toEqual([]);
  });
});

describe('findCutSites against one pass per site (#275)', () => {
  it('has the bundled enzymes to compare', () => {
    expect(BUNDLED.length).toBeGreaterThan(100);
  });

  it('gives the same sites in the same order on random sequences', () => {
    fc.assert(
      fc.property(sequenceArb(400), topologyArb, (seq, topology) => {
        expect(findCutSites(seq, topology, BUNDLED)).toEqual(
          findCutSitesOnePassEach(seq, topology, BUNDLED),
        );
      }),
      { numRuns: 150 },
    );
  }, 60_000);

  it('gives the same sites in the same order where bundled sites are planted', () => {
    fc.assert(
      fc.property(plantedArb, topologyArb, (seq, topology) => {
        expect(findCutSites(seq, topology, BUNDLED)).toEqual(
          findCutSitesOnePassEach(seq, topology, BUNDLED),
        );
      }),
      { numRuns: 200 },
    );
  }, 60_000);

  it('agrees for made-up enzymes: short, ambiguous, Type IIS and double cutters', () => {
    const enzymeArb = fc
      .tuple(
        fc.array(fc.constantFrom(...IUPAC.split('')), { minLength: 1, maxLength: 12 }),
        fc.integer({ min: -15, max: 25 }),
        fc.integer({ min: -15, max: 25 }),
        fc.option(fc.tuple(fc.integer({ min: -15, max: 25 }), fc.integer({ min: -15, max: 25 }))),
      )
      .map(([bases, cutTop, cutBottom, second]): Omit<Enzyme, 'name'> => {
        const site = bases.join('');
        return {
          site,
          cutTop,
          cutBottom,
          palindromic: site === reverseComplement(site),
          ...(second === null ? {} : { secondCut: { cutTop: second[0], cutBottom: second[1] } }),
        };
      });
    fc.assert(
      fc.property(
        fc.array(enzymeArb, { minLength: 1, maxLength: 10 }),
        sequenceArb(120),
        topologyArb,
        (made, seq, topology) => {
          const enzymes = made.map((e, i): Enzyme => ({ ...e, name: `E${i}` }));
          expect(findCutSites(seq, topology, enzymes)).toEqual(
            findCutSitesOnePassEach(seq, topology, enzymes),
          );
        },
      ),
      { numRuns: 300 },
    );
  }, 60_000);

  it('agrees on short circles, as long as a site or shorter', () => {
    fc.assert(
      fc.property(sequenceArb(12), (seq) => {
        expect(findCutSites(seq, 'circular', BUNDLED)).toEqual(
          findCutSitesOnePassEach(seq, 'circular', BUNDLED),
        );
      }),
      { numRuns: 300 },
    );
  }, 30_000);
});

describe('findCutSites against the other matchers (#277)', () => {
  // A cut that cannot fall off a line, so every site found is reported.
  const madeArb = fc
    .array(fc.constantFrom(...IUPAC.split('')), { minLength: 1, maxLength: 10 })
    .map((bases): Enzyme => {
      const site = bases.join('');
      return {
        name: 'M',
        site,
        cutTop: 0,
        cutBottom: 0,
        palindromic: site === reverseComplement(site),
      };
    });

  it('finds a site where findSequenceMatches finds it, and siteStillMatches keeps it, at any length', () => {
    fc.assert(
      fc.property(madeArb, sequenceArb(12), topologyArb, (enzyme, seq, topology) => {
        const sites = findCutSites(seq, topology, [enzyme]);
        for (const site of sites) expect(siteStillMatches(seq, topology, site, enzyme)).toBe(true);
        // findSequenceMatches reads both strands but reports a start once,
        // forward first; findCutSites skips the bottom strand only for a palindrome.
        const forward = (pattern: string) =>
          findSequenceMatches(seq, topology, pattern, { bothStrands: false }).map(
            (m) => m.range.start,
          );
        // Sites come sorted by cut, which on a circle need not follow the starts.
        const starts = (strand: 'forward' | 'reverse') =>
          sites
            .filter((s) => s.strand === strand)
            .map((s) => s.siteStart)
            .sort((a, b) => a - b);
        expect(starts('forward')).toEqual(forward(enzyme.site));
        expect(starts('reverse')).toEqual(
          enzyme.palindromic ? [] : forward(reverseComplement(enzyme.site)),
        );
      }),
      { numRuns: 1000 },
    );
  }, 30_000);
});
