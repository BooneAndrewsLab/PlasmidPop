import fc from 'fast-check';

import { type Strand } from '../features';
import { type Topology } from '../range';
import { reverseComplement } from '../sequence';
import {
  type Nuclease,
  MAX_LISTED_SITES,
  MIT_WEIGHTS,
  NUCLEASES,
  OLIGO_SCHEMES,
  findCrisprGuides,
  guideOligos,
  mitSiteScore,
  nucleaseProblem,
  oligoSchemesFor,
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
        specificity: 100,
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

  it('takes a fractional or missing-number limit as a whole one', () => {
    const seq = `${UNIT}${FILLER}CC${'A'.repeat(18)}TGG`;
    expect(findCrisprGuides(seq, 'linear', SPCAS9, { maxMismatches: 2.5 })[0]?.offTargets).toEqual([
      0, 0, 1,
    ]);
    expect(findCrisprGuides(seq, 'linear', SPCAS9, { maxMismatches: NaN })[0]?.offTargets).toEqual([
      0, 0, 1, 0,
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

  it('offers the Cas9 sgRNA overhangs to Cas9-like nucleases only', () => {
    expect(oligoSchemesFor(SPCAS9).map((s) => s.id)).toEqual(['px330', 'none']);
    expect(oligoSchemesFor(nuclease('sacas9')).map((s) => s.id)).toEqual(['px330', 'none']);
    expect(oligoSchemesFor(ASCAS12A).map((s) => s.id)).toEqual(['none']);
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

describe('MIT specificity', () => {
  it('scores the published formula by hand', () => {
    const w = MIT_WEIGHTS;
    expect(mitSiteScore([])).toBe(1);
    // One mismatch: just 1 - weight.
    expect(mitSiteScore([13])).toBeCloseTo(1 - (w[13] ?? 0), 12);
    // Two at 5 and 15: mean distance 10, so 1 / ((9/19)*4 + 1), then 1/4.
    const expected =
      (1 - (w[5] ?? 0)) * (1 - (w[15] ?? 0)) * (1 / (((19 - 10) / 19) * 4 + 1)) * (1 / 4);
    expect(mitSiteScore([5, 15])).toBeCloseTo(expected, 12);
    // Three at 2, 4, 10: mean consecutive distance (2 + 6) / 2 = 4.
    const three =
      ((1 - (w[2] ?? 0)) *
        (1 - (w[4] ?? 0)) *
        (1 - (w[10] ?? 0)) *
        (1 / (((19 - 4) / 19) * 4 + 1))) /
      9;
    expect(mitSiteScore([2, 4, 10])).toBeCloseTo(three, 12);
  });

  const twice = `${UNIT}${'A'.repeat(13)}${UNIT}`;

  it('is 100 with no other site and 50 with one exact copy', () => {
    expect(findCrisprGuides(`${UNIT}${'A'.repeat(10)}`, 'linear', SPCAS9)[0]?.specificity).toBe(
      100,
    );
    expect(findCrisprGuides(twice, 'linear', SPCAS9)[0]?.specificity).toBe(50);
  });

  it('sums over every site, not only the listed ones', () => {
    const copies = Array.from({ length: MAX_LISTED_SITES + 10 }, () => UNIT).join('A'.repeat(13));
    const g = findCrisprGuides(copies, 'linear', SPCAS9)[0];
    expect(g?.sites).toHaveLength(MAX_LISTED_SITES);
    expect(g?.specificity).toBeCloseTo(100 / (1 + (g?.offTargets[0] ?? 0)), 9);
  });

  it('weights a mismatch by its position from the 5′ end', () => {
    const at = (pos: number): number | null | undefined => {
      const mutated = `${A20.slice(0, pos)}C${A20.slice(pos + 1)}`;
      const seq = `${UNIT}${'A'.repeat(13)}${mutated}TGG`;
      return findCrisprGuides(seq, 'linear', SPCAS9).find((x) => x.range.start === 0)?.specificity;
    };
    // PAM-proximal mismatch (weight .583) leaves a lower score than a
    // distal one (weight 0).
    expect(at(19)).toBeCloseTo(100 / (1 + 1 - 0.583), 9);
    expect(at(0)).toBeCloseTo(50, 9);
  });

  it('is null for a nuclease the weights do not describe', () => {
    const sa = NUCLEASES.find((n) => n.id === 'sacas9');
    if (sa === undefined) throw new Error('no SaCas9 preset');
    const seq = `${'A'.repeat(21)}TGGGGT${'A'.repeat(10)}`;
    for (const g of findCrisprGuides(seq, 'linear', sa)) expect(g.specificity).toBeNull();
  });
});

// ------------------------------------------------- edges found by mutation testing

/** A spacer of all four bases that makes no GG or CC, so no PAM of its own. */
const S20 = 'ACGTACGTACGTACGTACGT';

/** `s` with the bases at the given positions replaced. */
function substitute(s: string, edits: Readonly<Record<number, string>>): string {
  return Array.from(s, (c, i) => edits[i] ?? c).join('');
}

function custom(pam: string, pamSide: Nuclease['pamSide'], spacerLength: number): Nuclease {
  return {
    id: 'custom',
    name: 'Custom',
    pam,
    pamSide,
    spacerLength,
    cut: { pamStrand: 17, targetStrand: 17 },
  };
}

describe('custom nuclease limits', () => {
  it('accepts the longest PAM and the shortest and longest spacers', () => {
    expect(nucleaseProblem('NNNNNNNN', 20)).toBeNull();
    expect(nucleaseProblem('NGG', 15)).toBeNull();
    expect(nucleaseProblem('NGG', 30)).toBeNull();
  });

  it('words each reason exactly', () => {
    expect(nucleaseProblem('', 20)).toBe('Enter a PAM.');
    expect(nucleaseProblem('NNNNNNNNN', 20)).toBe('A PAM is at most 8 bases.');
    expect(nucleaseProblem('NXG', 20)).toBe('“X” is not an IUPAC base.');
    expect(nucleaseProblem('NGG', 14)).toBe('A spacer is 15–30 bases.');
    expect(nucleaseProblem('NGG', 31)).toBe('A spacer is 15–30 bases.');
    expect(nucleaseProblem('NGG', 20.5)).toBe('A spacer is 15–30 bases.');
  });
});

describe('findCrisprGuides window edges', () => {
  it('finds nothing in a sequence shorter than PAM plus spacer, even with a PAM at the start', () => {
    expect(findCrisprGuides('TTTAACGT', 'linear', ASCAS12A)).toEqual([]);
    expect(findCrisprGuides('TTTAACGT', 'circular', ASCAS12A)).toEqual([]);
  });

  it('needs the whole spacer after a 5′ PAM at the end of a linear sequence', () => {
    // 22 bases follow the PAM, a spacer is 23.
    expect(findCrisprGuides(`AAAATTTA${'C'.repeat(22)}`, 'linear', ASCAS12A)).toEqual([]);
    const guides = findCrisprGuides(`AAAATTTA${'C'.repeat(23)}`, 'linear', ASCAS12A);
    expect(guides).toHaveLength(1);
    // The target strand is cut at the very end: boundary 31 of 31.
    expect(guides[0]).toMatchObject({
      strand: 'forward',
      range: { start: 8, end: 31 },
      cut: { forward: 26, reverse: 31 },
    });
  });

  it('reads a circle that is exactly one window long through its origin', () => {
    const rotated = `${UNIT.slice(5)}${UNIT.slice(0, 5)}`;
    expect(rotated).toHaveLength(23);
    const guides = findCrisprGuides(rotated, 'circular', SPCAS9);
    expect(guides).toHaveLength(1);
    expect(guides[0]).toMatchObject({ range: { start: 18, end: 38 }, pam: 'TGG' });
  });

  it('lists a guide on a circle once, not again for the window that wraps back to the start', () => {
    const guides = findCrisprGuides(`TTTA${'C'.repeat(23)}`, 'circular', ASCAS12A);
    expect(guides).toHaveLength(1);
    expect(guides[0]?.range).toEqual({ start: 4, end: 27 });
  });

  it('does not take a character that is no base for a PAM base', () => {
    expect(findCrisprGuides(`${A20}XGG${'A'.repeat(5)}`, 'linear', SPCAS9)).toEqual([]);
    expect(findCrisprGuides(`${A20}TG-${'A'.repeat(5)}`, 'linear', SPCAS9)).toEqual([]);
  });

  it('sorts a forward and a reverse guide with the same start forward first', () => {
    // S20 forward with its TGG, and S20 again on the reverse strand with its PAM
    // (CCA on this one) round the origin: both spacers cover [0, 20).
    const guides = findCrisprGuides(`${S20}TGGATATCCA`, 'circular', SPCAS9);
    expect(guides.map((g) => [g.strand, g.range.start])).toEqual([
      ['forward', 0],
      ['reverse', 0],
    ]);
  });
});

describe('findCrisprGuides off-targets in detail', () => {
  const pre = FILLER + FILLER;

  it('compares all four bases, so a copy with any base changed is counted by how many', () => {
    const other = substitute(S20, { 0: 'C', 1: 'G', 2: 'T', 3: 'A' });
    const seq = `${pre}${S20}TGG${FILLER}${other}TGG`;
    const guides = findCrisprGuides(seq, 'linear', SPCAS9, { maxMismatches: 4 });
    expect(guides.map((g) => g.range.start)).toEqual([20, 53]);
    expect(guides[0]?.offTargets).toEqual([0, 0, 0, 0, 1]);
    expect(guides[0]?.sites).toEqual([
      { doc: 0, strand: 'forward', range: { start: 53, end: 73 }, mismatches: 4 },
    ]);
    expect(guides[1]?.offTargets).toEqual([0, 0, 0, 0, 1]);
  });

  it('finds an exact copy of a spacer made of all four bases, wherever it is', () => {
    const seq = `${pre}${S20}TGG${FILLER}${S20}TGG`;
    const guides = findCrisprGuides(seq, 'linear', SPCAS9);
    expect(guides.map((g) => g.offTargets)).toEqual([
      [1, 0, 0, 0],
      [1, 0, 0, 0],
    ]);
  });

  it('offers a site to every guide that could match it, not only the first to ask', () => {
    const x = 'ACGT'.repeat(5);
    const y = 'TGCA'.repeat(5);
    const guides = findCrisprGuides(`${x}TGG${FILLER}${y}TGG${FILLER}${y}TGG`, 'linear', SPCAS9);
    expect(guides.map((g) => g.offTargets[0])).toEqual([0, 1, 1]);
  });

  it('finds a copy across the origin of a circular document', () => {
    const seq = `${UNIT.slice(5)}${FILLER}${UNIT}AAAAA`;
    const guides = findCrisprGuides(seq, 'circular', SPCAS9);
    const middle = guides.find((g) => g.range.start === 28);
    expect(middle?.offTargets).toEqual([1, 0, 0, 0]);
    expect(middle?.sites).toEqual([
      { doc: 0, strand: 'forward', range: { start: 51, end: 71 }, mismatches: 0 },
    ]);
  });

  it('finds a copy whose spacer runs far past the origin of a short circle', () => {
    // 24 bases, a 15 nt spacer and an NGG. The PAM at 3-5 has its spacer at 12,
    // holding the Gs of the other PAM; the PAM at 14-16 has its spacer at 23,
    // wrapping round the origin and holding the Gs of the first. The two
    // spacers differ at four places.
    const seq = substitute('A'.repeat(24), { 4: 'G', 5: 'G', 15: 'G', 16: 'G' });
    const guides = findCrisprGuides(seq, 'circular', custom('NGG', '3prime', 15), {
      maxMismatches: 4,
    });
    expect(guides.map((g) => g.range.start)).toEqual([12, 23]);
    expect(guides.map((g) => g.offTargets)).toEqual([
      [0, 0, 0, 0, 1],
      [0, 0, 0, 0, 1],
    ]);
  });

  it('counts a site whose PAM has an ambiguous base, which is not itself a guide', () => {
    const guides = findCrisprGuides(`${UNIT}${FILLER}${A20}TNG`, 'linear', SPCAS9);
    expect(guides).toHaveLength(1);
    expect(guides[0]?.offTargets).toEqual([1, 0, 0, 0]);
  });

  it('counts a site that is ambiguous in every block of the seed index', () => {
    const blurred = substitute(A20, { 2: 'N', 7: 'N', 12: 'N', 17: 'N' });
    const guides = findCrisprGuides(`${UNIT}${FILLER}${blurred}TGG`, 'linear', SPCAS9);
    expect(guides).toHaveLength(1);
    expect(guides[0]?.offTargets).toEqual([1, 0, 0, 0]);
  });

  it('counts the same spacer on the other strand at the same place, and in another document', () => {
    const seq = `${UNIT}${FILLER}${reverseComplement(UNIT)}`;
    const guides = findCrisprGuides(seq, 'linear', SPCAS9);
    expect(guides.map((g) => [g.strand, g.offTargets[0]])).toEqual([
      ['forward', 1],
      ['reverse', 1],
    ]);
    expect(guides[0]?.sites[0]).toMatchObject({ doc: 0, strand: 'reverse' });
    expect(guides[1]?.sites[0]).toMatchObject({ doc: 0, strand: 'forward', range: { start: 0 } });

    const same = findCrisprGuides(`${UNIT}${'A'.repeat(10)}`, 'linear', SPCAS9, {
      background: [{ sequence: `${UNIT}${'A'.repeat(10)}`, topology: 'linear' }],
    });
    expect(same[0]?.offTargets).toEqual([1, 0, 0, 0]);
    expect(same[0]?.sites).toEqual([
      { doc: 1, strand: 'forward', range: { start: 0, end: 20 }, mismatches: 0 },
    ]);
  });

  it('lists sites fewest mismatches first, then by document, then by position', () => {
    const at = (edits: Record<number, string>): string => `${substitute(S20, edits)}TGG`;
    const doc0 = [at({}), at({ 0: 'T' }), at({ 5: 'T' }), at({}), at({ 0: 'T', 5: 'T' })].join(
      FILLER,
    );
    const doc1 = [FILLER, at({}), FILLER, at({ 5: 'T' })].join('');
    const guides = findCrisprGuides(doc0, 'linear', SPCAS9, {
      background: [{ sequence: doc1, topology: 'linear' }],
    });
    const first = guides.find((g) => g.range.start === 0);
    expect(first?.offTargets).toEqual([2, 3, 1, 0]);
    expect(first?.sites).toEqual([
      { doc: 0, strand: 'forward', range: { start: 99, end: 119 }, mismatches: 0 },
      { doc: 1, strand: 'forward', range: { start: 10, end: 30 }, mismatches: 0 },
      { doc: 0, strand: 'forward', range: { start: 33, end: 53 }, mismatches: 1 },
      { doc: 0, strand: 'forward', range: { start: 66, end: 86 }, mismatches: 1 },
      { doc: 1, strand: 'forward', range: { start: 43, end: 63 }, mismatches: 1 },
      { doc: 0, strand: 'forward', range: { start: 132, end: 152 }, mismatches: 2 },
    ]);
  });
});

describe('findCrisprGuides sites of equal mismatches', () => {
  it('lists the one in the searched document before the one in a background document', () => {
    // The background copy shares the guide's first seed block and the other
    // copy does not, so the index offers the background one first.
    const doc0 = `${S20}TGG${FILLER}${substitute(S20, { 0: 'T' })}TGG`;
    const background = `${substitute(S20, { 5: 'T' })}TGG`;
    const guides = findCrisprGuides(doc0, 'linear', SPCAS9, {
      background: [{ sequence: background, topology: 'linear' }],
    });
    expect(guides[0]?.sites.map((s) => [s.doc, s.mismatches])).toEqual([
      [0, 1],
      [1, 1],
    ]);
  });
});

describe('findCrisprGuides progress', () => {
  function progressOf(copies: number): number[] {
    const calls: number[] = [];
    const seq = Array.from({ length: copies }, () => UNIT).join('');
    findCrisprGuides(seq, 'linear', SPCAS9, { onProgress: (f) => calls.push(f), maxMismatches: 0 });
    return calls;
  }

  it('reports each guide while there are few, then 1', () => {
    const calls = progressOf(3);
    expect(calls).toHaveLength(4);
    [0, 1 / 3, 2 / 3, 1].forEach((x, i) => {
      expect(calls[i]).toBeCloseTo(x, 12);
    });
  });

  it('reports about fifty times however many guides there are', () => {
    const calls = progressOf(120);
    // Every second guide of 120, then the final 1.
    expect(calls).toHaveLength(61);
    calls.slice(0, 60).forEach((c, i) => {
      expect(c).toBeCloseTo((2 * i) / 120, 12);
    });
    expect(calls[60]).toBe(1);
  });
});

describe('the MIT score is only for a 20 nt NGG nuclease with the PAM 3′', () => {
  it('is null if any one of the three differs', () => {
    expect(findCrisprGuides(`${A20}TGG`, 'linear', SPCAS9)[0]?.specificity).toBe(100);
    const first = (n: Nuclease, seq: string) =>
      findCrisprGuides(seq, 'linear', n).find((g) => g.strand === 'forward');
    const fiveUp = first(custom('NGG', '5prime', 20), `TGG${A20}`);
    expect(fiveUp).toBeDefined();
    expect(fiveUp?.specificity).toBeNull();
    const long = first(custom('NGG', '3prime', 21), `${'A'.repeat(21)}TGG`);
    expect(long).toBeDefined();
    expect(long?.specificity).toBeNull();
    const nag = first(custom('NAG', '3prime', 20), `${A20}TAG`);
    expect(nag).toBeDefined();
    expect(nag?.specificity).toBeNull();
  });
});

describe('a region is met by a base on either side of the cut', () => {
  const straight = `${UNIT}${'A'.repeat(10)}`;
  const starts = (seq: string, topology: Topology, region: { start: number; end: number }) =>
    findCrisprGuides(seq, topology, SPCAS9, { region }).length;

  it('takes the base after the cut, or the base before it, on a linear sequence', () => {
    // The cut is between bases 16 and 17.
    expect(starts(straight, 'linear', { start: 17, end: 18 })).toBe(1);
    expect(starts(straight, 'linear', { start: 16, end: 17 })).toBe(1);
    expect(starts(straight, 'linear', { start: 0, end: 16 })).toBe(0);
    expect(starts(straight, 'linear', { start: 18, end: 33 })).toBe(0);
  });

  it('does not wrap a cut at the end of a linear sequence round to its start', () => {
    const atEnd: Nuclease = {
      ...custom('NGG', '3prime', 20),
      cut: { pamStrand: 23, targetStrand: 23 },
    };
    const n = (seq: string, start: number, end: number): number =>
      findCrisprGuides(seq, 'linear', atEnd, { region: { start, end } }).length;
    // Forward strand: the cut is at boundary 23 of 23, after the last base.
    expect(n(UNIT, 0, 1)).toBe(0);
    expect(n(UNIT, 22, 23)).toBe(1);
    // Reverse strand: the cut is at boundary 0, before the first base.
    const reverse = `${reverseComplement(UNIT)}${'A'.repeat(10)}`;
    expect(n(reverse, 0, 1)).toBe(1);
    expect(n(reverse, 32, 33)).toBe(0);
  });

  it('takes base 0 as the base before a cut at boundary 1', () => {
    const cutAtOne: Nuclease = {
      ...custom('NGG', '3prime', 20),
      cut: { pamStrand: 1, targetStrand: 1 },
    };
    const n = (start: number, end: number): number =>
      findCrisprGuides(straight, 'linear', cutAtOne, { region: { start, end } }).filter(
        (g) => g.strand === 'forward',
      ).length;
    expect(n(0, 1)).toBe(1);
    expect(n(1, 2)).toBe(1);
    expect(n(2, 33)).toBe(0);
  });

  it('works through the origin of a circle', () => {
    const rotated = `${straight.slice(5)}${straight.slice(0, 5)}`;
    // The cut is between bases 11 and 12 of 33.
    expect(starts(rotated, 'circular', { start: 12, end: 13 })).toBe(1);
    expect(starts(rotated, 'circular', { start: 11, end: 12 })).toBe(1);
    expect(starts(rotated, 'circular', { start: 13, end: 20 })).toBe(0);
  });

  it('puts a cut at the origin between the last base and the first', () => {
    const long = `${UNIT}${'A'.repeat(17)}`;
    const rotated = `${long.slice(17)}${long.slice(0, 17)}`;
    const guides = findCrisprGuides(rotated, 'circular', SPCAS9);
    expect(guides[0]?.cut.forward).toBe(0);
    expect(starts(rotated, 'circular', { start: 0, end: 1 })).toBe(1);
    expect(starts(rotated, 'circular', { start: 39, end: 40 })).toBe(1);
    expect(starts(rotated, 'circular', { start: 1, end: 39 })).toBe(0);
    expect(starts(rotated, 'circular', { start: 1, end: 2 })).toBe(0);
  });
});
