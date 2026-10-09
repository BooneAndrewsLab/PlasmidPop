import fc from 'fast-check';

import { type Strand } from '../features';
import { type Topology } from '../range';
import { reverseComplement } from '../sequence';
import {
  type Nuclease,
  MAX_LISTED_SITES,
  NUCLEASES,
  OLIGO_SCHEMES,
  findCrisprGuides,
  guideOligos,
  nucleaseProblem,
} from './crispr';
import { codeMask } from './search';

function nuclease(id: string): Nuclease {
  const n = NUCLEASES.find((x) => x.id === id);
  if (n === undefined) throw new Error(id);
  return n;
}
const SPCAS9 = nuclease('spcas9');
const ASCAS12A = nuclease('ascas12a');

const A20 = 'A'.repeat(20);
/** One SpCas9 site: a 20 nt spacer of A's and a TGG PAM. */
const UNIT = `${A20}TGG`;
/** Neither GG nor CC, so it contributes no PAM on either strand. */
const FILLER = 'CTCTCTCTCT';

// ---------------------------------------------------------------- the oracle

/**
 * The same scan written the slow, obvious way: read every window base by
 * base, wrapping by hand on a circle, and compare the PAM character by
 * character. `findCrisprGuides` must agree with it.
 */
function bruteForceGuides(
  sequence: string,
  topology: Topology,
  n: Nuclease,
): { start: number; strand: Strand; spacer: string; pam: string }[] {
  const L = sequence.length;
  const W = n.spacerLength + n.pam.length;
  const out: { start: number; strand: Strand; spacer: string; pam: string }[] = [];
  if (L < W) return out;
  for (const strand of ['forward', 'reverse'] as const) {
    const text = (strand === 'forward' ? sequence : reverseComplement(sequence)).toUpperCase();
    const starts = topology === 'circular' ? L : L - W + 1;
    for (let i = 0; i < starts; i++) {
      let window = '';
      for (let j = 0; j < W; j++) window += text.charAt((i + j) % L);
      const spacer =
        n.pamSide === '3prime' ? window.slice(0, n.spacerLength) : window.slice(n.pam.length);
      const pam =
        n.pamSide === '3prime' ? window.slice(n.spacerLength) : window.slice(0, n.pam.length);
      if (!/^[ACGT]+$/.test(spacer)) continue;
      let fits = true;
      for (let j = 0; j < pam.length; j++) {
        const m = codeMask(pam.charAt(j));
        if (m === 0 || (m & ~codeMask(n.pam.charAt(j))) !== 0) fits = false;
      }
      if (!fits) continue;
      const spacerAt = n.pamSide === '3prime' ? i : i + n.pam.length;
      // The spacer's forward-strand start, as `toForward` computes it.
      const start =
        strand === 'forward' ? spacerAt % L : (((L - (spacerAt + n.spacerLength)) % L) + L) % L;
      out.push({ start, strand, spacer, pam });
    }
  }
  return out;
}

const key = (g: { start: number; strand: Strand; spacer: string; pam: string }): string =>
  `${g.strand}:${String(g.start)}:${g.spacer}:${g.pam}`;

const dna = (min: number, max: number): fc.Arbitrary<string> =>
  fc
    .array(fc.constantFrom('A', 'C', 'G', 'T', 'N'), { minLength: min, maxLength: max })
    .map((a) => a.join(''));

// ----------------------------------------------------------------- the scan

describe('findCrisprGuides', () => {
  it('finds a forward SpCas9 guide with its PAM, cut and flags', () => {
    const seq = `${UNIT}${'A'.repeat(10)}`;
    expect(findCrisprGuides(seq, 'linear', SPCAS9)).toEqual([
      {
        range: { start: 0, end: 20 },
        strand: 'forward',
        spacer: A20,
        pam: 'TGG',
        pamRange: { start: 20, end: 23 },
        // Blunt, three bases in from the PAM.
        cut: { forward: 17, reverse: 17 },
        gc: 0,
        polyT: false,
        longestRun: 20,
        offTargets: [0, 0, 0, 0],
        sites: [],
      },
    ]);
  });

  it('reports a reverse-strand guide in forward coordinates', () => {
    const seq = reverseComplement(`${UNIT}${'A'.repeat(10)}`);
    const guides = findCrisprGuides(seq, 'linear', SPCAS9);
    expect(guides).toHaveLength(1);
    expect(guides[0]).toMatchObject({
      range: { start: 13, end: 33 },
      strand: 'reverse',
      spacer: A20,
      pam: 'TGG',
      // The PAM lies 3' of the spacer on the reverse strand, so before it here.
      pamRange: { start: 10, end: 13 },
      cut: { forward: 16, reverse: 16 },
    });
  });

  it('reads through the origin of a circular sequence', () => {
    const straight = `${UNIT}${'A'.repeat(10)}`;
    const rotated = `${straight.slice(5)}${straight.slice(0, 5)}`;
    const guides = findCrisprGuides(rotated, 'circular', SPCAS9);
    expect(guides).toHaveLength(1);
    // The spacer now begins five bases before the origin and wraps.
    expect(guides[0]).toMatchObject({
      range: { start: 28, end: 48 },
      strand: 'forward',
      spacer: A20,
      pam: 'TGG',
      pamRange: { start: 15, end: 18 },
      cut: { forward: 12, reverse: 12 },
    });
  });

  it('finds no guide where the window runs off the end of a linear sequence', () => {
    // The same bases, but the PAM is only reachable round the origin.
    const straight = `${UNIT}${'A'.repeat(10)}`;
    const rotated = `${straight.slice(5)}${straight.slice(0, 5)}`;
    expect(findCrisprGuides(rotated, 'linear', SPCAS9)).toEqual([]);
  });

  it('cuts a Cas12a site with a staggered end, PAM first', () => {
    const spacer = 'GACTGACTGACTGACTGACTGAC';
    const seq = `TTTA${spacer}${'A'.repeat(5)}`;
    const guide = findCrisprGuides(seq, 'linear', ASCAS12A).find((g) => g.strand === 'forward');
    expect(guide).toMatchObject({
      range: { start: 4, end: 27 },
      spacer,
      pam: 'TTTA',
      pamRange: { start: 0, end: 4 },
      // After base 18 of the PAM strand and base 23 of the target strand:
      // a five-base 5' overhang.
      cut: { forward: 22, reverse: 27 },
    });
  });

  it('flags GC, a poly-T terminator and homopolymer runs', () => {
    const spacer = 'GCGCTTTTGCAAAAAGCGCG';
    const guides = findCrisprGuides(`${spacer}CGG`, 'linear', SPCAS9);
    expect(guides[0]).toMatchObject({ spacer, polyT: true, longestRun: 5 });
    expect(guides[0]?.gc).toBeCloseTo(11 / 20);
  });

  it('agrees with a brute-force scan on random sequences', () => {
    fc.assert(
      fc.property(dna(25, 70), fc.constantFrom<Topology>('linear', 'circular'), (seq, topology) => {
        const got = findCrisprGuides(seq, topology, SPCAS9)
          .map((g) => key({ ...g, start: g.range.start }))
          .sort();
        const want = bruteForceGuides(seq, topology, SPCAS9).map(key).sort();
        expect(got).toEqual(want);
      }),
      { numRuns: 200 },
    );
  });

  it('gives the same guides wherever a circular sequence is cut open', () => {
    fc.assert(
      fc.property(dna(30, 70), fc.nat(), (seq, k) => {
        const L = seq.length;
        const by = k % L;
        const rotated = `${seq.slice(by)}${seq.slice(0, by)}`;
        const before = findCrisprGuides(seq, 'circular', SPCAS9)
          .map((g) => key({ ...g, start: (g.range.start - by + L) % L }))
          .sort();
        const after = findCrisprGuides(rotated, 'circular', SPCAS9)
          .map((g) => key({ ...g, start: g.range.start }))
          .sort();
        expect(after).toEqual(before);
      }),
      { numRuns: 100 },
    );
  });
});

// ------------------------------------------------------------- off-targets

describe('findCrisprGuides off-targets', () => {
  const twice = `${UNIT}${FILLER}${UNIT}`;

  it('counts another exact site and lists where it is', () => {
    const guides = findCrisprGuides(twice, 'linear', SPCAS9);
    expect(guides.map((g) => g.range.start)).toEqual([0, 33]);
    expect(guides[0]?.offTargets).toEqual([1, 0, 0, 0]);
    expect(guides[0]?.sites).toEqual([
      { doc: 0, strand: 'forward', range: { start: 33, end: 53 }, mismatches: 0 },
    ]);
    expect(guides[1]?.sites).toEqual([
      { doc: 0, strand: 'forward', range: { start: 0, end: 20 }, mismatches: 0 },
    ]);
  });

  it('counts mismatched sites by how many bases differ', () => {
    // Two bases of the second spacer changed.
    const seq = `${UNIT}${FILLER}CC${'A'.repeat(18)}TGG`;
    const guides = findCrisprGuides(seq, 'linear', SPCAS9);
    const first = guides.find((g) => g.range.start === 0);
    expect(first?.offTargets).toEqual([0, 0, 1, 0]);
    expect(first?.sites[0]).toMatchObject({ mismatches: 2, range: { start: 33, end: 53 } });
  });

  it('stops counting past the mismatch limit', () => {
    const seq = `${UNIT}${FILLER}CC${'A'.repeat(18)}TGG`;
    expect(findCrisprGuides(seq, 'linear', SPCAS9, { maxMismatches: 1 })[0]?.offTargets).toEqual([
      0, 0,
    ]);
  });

  it('never lets an ambiguous base hide an off-target', () => {
    // An N in the second site: it is not a guide itself, but it could be
    // the same spacer, so it is still counted against the first.
    const seq = `${UNIT}${FILLER}${'A'.repeat(19)}NTGG`;
    const guides = findCrisprGuides(seq, 'linear', SPCAS9);
    expect(guides).toHaveLength(1);
    expect(guides[0]?.offTargets).toEqual([1, 0, 0, 0]);
  });

  it('counts sites in the background documents too', () => {
    const guides = findCrisprGuides(`${UNIT}${'A'.repeat(10)}`, 'linear', SPCAS9, {
      background: [{ sequence: `${FILLER}${UNIT}`, topology: 'linear' }],
    });
    expect(guides[0]?.offTargets).toEqual([1, 0, 0, 0]);
    expect(guides[0]?.sites[0]).toMatchObject({ doc: 1, range: { start: 10, end: 30 } });
  });

  it('lists no more sites than the cap, but still counts them all', () => {
    const seq = Array.from({ length: 60 }, () => UNIT).join('');
    const guides = findCrisprGuides(seq, 'linear', SPCAS9);
    expect(guides[0]?.offTargets[0]).toBe(59);
    expect(guides[0]?.sites).toHaveLength(MAX_LISTED_SITES);
  });

  it('lists every site it counted while under the cap', () => {
    fc.assert(
      fc.property(dna(30, 70), fc.constantFrom<Topology>('linear', 'circular'), (seq, topology) => {
        for (const g of findCrisprGuides(seq, topology, SPCAS9)) {
          const total = g.offTargets.reduce((a, b) => a + b, 0);
          if (total <= MAX_LISTED_SITES) expect(g.sites).toHaveLength(total);
          expect(g.sites.every((s) => s.mismatches <= 3)).toBe(true);
        }
      }),
      { numRuns: 100 },
    );
  });
});

// ------------------------------------------------------------- region, oligos

describe('a region and the oligos', () => {
  it('keeps only guides cutting inside the region', () => {
    const seq = `${UNIT}${FILLER}${UNIT}`;
    const guides = findCrisprGuides(seq, 'linear', SPCAS9, { region: { start: 40, end: 56 } });
    expect(guides.map((g) => g.range.start)).toEqual([33]);
  });

  it('writes the pX330 oligos, adding the U6 G where the spacer lacks one', () => {
    const px330 = OLIGO_SCHEMES[0];
    expect(px330).toBeDefined();
    const spacer = 'ACCTGCATTGGCATTGCATT';
    expect(guideOligos(spacer, { top: 'CACC', bottom: 'AAAC', leadingG: true })).toEqual({
      top: `CACCG${spacer}`,
      bottom: `AAAC${reverseComplement(`G${spacer}`)}`,
    });
    const withG = `G${spacer.slice(1)}`;
    expect(guideOligos(withG, { top: 'CACC', bottom: 'AAAC', leadingG: true }).top).toBe(
      `CACC${withG}`,
    );
    expect(guideOligos(spacer, { top: '', bottom: '', leadingG: false })).toEqual({
      top: spacer,
      bottom: reverseComplement(spacer),
    });
  });

  it('says why a custom nuclease cannot be used', () => {
    expect(nucleaseProblem('NGG', 20)).toBeNull();
    expect(nucleaseProblem('', 20)).toMatch(/Enter a PAM/);
    expect(nucleaseProblem('NNNNNNNNN', 20)).toMatch(/at most/);
    expect(nucleaseProblem('NXG', 20)).toMatch(/not an IUPAC base/);
    expect(nucleaseProblem('NGG', 14)).toMatch(/15–30/);
    expect(nucleaseProblem('NGG', 31)).toMatch(/15–30/);
  });

  it('finds guides for a custom PAM', () => {
    const custom: Nuclease = {
      id: 'custom',
      name: 'Custom',
      pam: 'NNGRRT',
      pamSide: '3prime',
      spacerLength: 21,
      cut: { pamStrand: 18, targetStrand: 18 },
    };
    const spacer = 'ACGTACGTACGTACGTACGTA';
    const guides = findCrisprGuides(`${spacer}CCGAAT${'A'.repeat(5)}`, 'linear', custom);
    expect(guides.find((g) => g.strand === 'forward')).toMatchObject({ spacer, pam: 'CCGAAT' });
  });
});
