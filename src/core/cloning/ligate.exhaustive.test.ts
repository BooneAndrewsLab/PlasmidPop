import fc from 'fast-check';

import { type DigestFragment, type FragmentEnd } from './digest';
import { assemblyJunctions, endsCompatible, flipFragment, ligate, overhangsMatch } from './ligate';

/**
 * Which ends a ligase can join, and when a phosphatase stops it (#10, #11).
 *
 * - `overhangsMatch` over every pair of single characters — the IUPAC codes
 *   in both cases, U, and characters that are no base — against a
 *   set-intersection oracle written out here from the IUPAC definitions, and
 *   over every pair of overhangs of length 0..3 on a small alphabet (plain
 *   bases, ambiguity codes, an invalid character);
 * - `endsCompatible`: same kind and matching overhangs, for every pair of a
 *   set of ends of all three kinds;
 * - `assemblyJunctions` and `ligate` for every chain of up to three pieces
 *   drawn from those ends, each untreated, phosphorylated or
 *   dephosphorylated, open or closed: a junction is compatible exactly when
 *   the ends match and not both sides are dephosphorylated; `dephosphorylated`
 *   is set only when the ends match and both are bare; ligation throws the
 *   first failing junction's message, or joins the top strands;
 * - `flipFragment` carries the treatment over, and flipping twice is the
 *   same piece;
 * - fast-check properties for long random overhangs and chains.
 */

function must<T>(value: T | null | undefined, what: string): T {
  if (value === null || value === undefined) throw new Error(`expected ${what}`);
  return value;
}

/** What each code can stand for, straight from the IUPAC table; anything else stands for nothing. */
const MEANS: Readonly<Record<string, string>> = {
  A: 'A',
  C: 'C',
  G: 'G',
  T: 'T',
  U: 'T',
  R: 'AG',
  Y: 'CT',
  S: 'CG',
  W: 'AT',
  K: 'GT',
  M: 'AC',
  B: 'CGT',
  D: 'AGT',
  H: 'ACT',
  V: 'ACG',
  N: 'ACGT',
};

const bases = (c: string): Set<string> => new Set(MEANS[c.toUpperCase()] ?? '');

function oracleMatch(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const x = bases(a.charAt(i));
    if (![...bases(b.charAt(i))].some((y) => x.has(y))) return false;
  }
  return true;
}

const CODES = Object.keys(MEANS);
const CHARS = [...CODES, ...CODES.map((c) => c.toLowerCase()), 'X', '-', '*', ' ', 'Z'];

function strings(alphabet: readonly string[], maxLength: number): string[] {
  let level = [''];
  const out = [''];
  for (let n = 1; n <= maxLength; n++) {
    level = level.flatMap((s) => alphabet.map((c) => s + c));
    out.push(...level);
  }
  return out;
}

describe('overhangsMatch', () => {
  it('agrees with set intersection for every pair of characters', () => {
    for (const a of CHARS)
      for (const b of CHARS) expect(overhangsMatch(a, b), `${a} ~ ${b}`).toBe(oracleMatch(a, b));
  });

  it('pairs each code with the bases it stands for and nothing else', () => {
    for (const code of CODES)
      for (const base of 'ACGT')
        expect(overhangsMatch(code, base)).toBe(must(MEANS[code], code).includes(base));
    // N stands for anything, an unknown character for nothing, not even itself.
    for (const c of CHARS) expect(overhangsMatch('N', c)).toBe(bases(c).size > 0);
    expect(overhangsMatch('X', 'X')).toBe(false);
    expect(overhangsMatch('', '')).toBe(true);
  });

  it('agrees with the oracle for every pair of overhangs up to 3 long', () => {
    const all = strings(['A', 'G', 'r', 'N', 'Y', 'X'], 3);
    const wrong: string[] = [];
    for (const a of all)
      for (const b of all) if (overhangsMatch(a, b) !== oracleMatch(a, b)) wrong.push(`${a}~${b}`);
    expect(wrong).toEqual([]);
    expect(all.length).toBe(1 + 6 + 36 + 216);
  });

  it('is symmetric and agrees with the oracle on long random overhangs', () => {
    const s = fc.string({ unit: fc.constantFrom(...CHARS), maxLength: 12 });
    fc.assert(
      fc.property(s, s, (a, b) => {
        expect(overhangsMatch(a, b)).toBe(oracleMatch(a, b));
        expect(overhangsMatch(a, b)).toBe(overhangsMatch(b, a));
        // An overhang made only of real codes always matches itself.
        if (Array.from(a).every((c) => bases(c).size > 0)) expect(overhangsMatch(a, a)).toBe(true);
      }),
      { numRuns: 300 },
    );
  });
});

// ------------------------------------------------------------------ ends

const ENDS: readonly FragmentEnd[] = [
  { kind: 'blunt', overhang: '', enzyme: 'SmaI' },
  { kind: 'blunt', overhang: '', enzyme: null },
  { kind: "5'", overhang: 'AATT', enzyme: 'EcoRI' },
  { kind: "5'", overhang: 'AATN', enzyme: 'X' },
  { kind: "5'", overhang: 'GATC', enzyme: 'BamHI' },
  { kind: "5'", overhang: 'GA', enzyme: 'Y' },
  { kind: "3'", overhang: 'AATT', enzyme: 'Z' },
  { kind: "3'", overhang: 'TGCA', enzyme: 'PstI' },
  { kind: "3'", overhang: 'NN', enzyme: 'BglI' },
];

const oracleEnds = (right: FragmentEnd, left: FragmentEnd): boolean =>
  right.kind === left.kind && oracleMatch(right.overhang, left.overhang);

describe('endsCompatible', () => {
  it('needs the same kind and matching overhangs, for every pair of ends', () => {
    for (const r of ENDS)
      for (const l of ENDS)
        expect(endsCompatible(r, l), `${r.kind}${r.overhang} / ${l.kind}${l.overhang}`).toBe(
          oracleEnds(r, l),
        );
    // The enzyme that made an end does not matter, only its shape.
    expect(endsCompatible(must(ENDS[0], 'SmaI end'), must(ENDS[1], 'plain end'))).toBe(true);
  });
});

// ------------------------------------------------------------------ junctions and ligation

type Treatment = undefined | false | true;
const TREATMENTS: readonly Treatment[] = [undefined, false, true];

let counter = 0;
function piece(left: FragmentEnd, right: FragmentEnd, treated: Treatment): DigestFragment {
  counter += 1;
  const base: DigestFragment = {
    sequence: `ACG${'T'.repeat(counter % 3)}`,
    features: [],
    range: { start: 0, end: 3 + (counter % 3) },
    left,
    right,
    source: `p${counter}`,
  };
  return treated === undefined ? base : { ...base, dephosphorylated: treated };
}

interface JunctionOracle {
  readonly compatible: boolean;
  readonly dephosphorylated: boolean;
}

function oracleJunction(a: DigestFragment, b: DigestFragment): JunctionOracle {
  const match = oracleEnds(a.right, b.left);
  const bare = a.dephosphorylated === true && b.dephosphorylated === true;
  return { compatible: match && !bare, dephosphorylated: match && bare };
}

function checkChain(chain: readonly DigestFragment[], circular: boolean): void {
  const joins = assemblyJunctions(chain, circular);
  const pairs: [DigestFragment, DigestFragment][] = [];
  for (let i = 1; i < chain.length; i++) pairs.push([must(chain[i - 1], 'a'), must(chain[i], 'b')]);
  if (circular && chain.length > 0)
    pairs.push([must(chain[chain.length - 1], 'last'), must(chain[0], 'first')]);
  expect(joins.length).toBe(pairs.length);
  pairs.forEach(([a, b], i) => {
    const j = must(joins[i], `junction ${i}`);
    expect(j.from).toBe(a.right);
    expect(j.to).toBe(b.left);
    expect({ compatible: j.compatible, dephosphorylated: j.dephosphorylated }).toEqual(
      oracleJunction(a, b),
    );
    // Never both: a phosphate problem is only reported where the ends match.
    expect(j.compatible && j.dephosphorylated).toBe(false);
  });

  if (chain.length === 0) {
    expect(() => ligate(chain, { name: 'x', circular })).toThrow('Nothing to ligate');
    return;
  }
  const firstBad = pairs.map(([a, b]) => oracleJunction(a, b)).find((j) => !j.compatible);
  const run = (): ReturnType<typeof ligate> => ligate(chain, { name: 'x', circular });
  if (firstBad === undefined) {
    const product = run();
    expect(product.sequence.toString()).toBe(chain.map((f) => f.sequence).join(''));
    expect(product.topology).toBe(circular ? 'circular' : 'linear');
    if (!circular) {
      const ends = product.ends;
      const first = must(chain[0], 'first');
      const last = must(chain[chain.length - 1], 'last');
      const plain = (e: FragmentEnd): boolean => e.kind === 'blunt' && e.enzyme === null;
      if (plain(first.left) && plain(last.right)) expect(ends).toBeNull();
      else expect(ends).toEqual({ left: first.left, right: last.right });
    } else expect(product.ends).toBeNull();
  } else if (firstBad.dephosphorylated) {
    expect(run).toThrow(/^Both ends are dephosphorylated: /);
  } else {
    expect(run).toThrow(/^Incompatible ends: /);
  }
}

describe('assemblyJunctions and ligate', () => {
  it('follow the oracle for every chain of up to three pieces, treated or not', () => {
    // The ends that meet are what matters; the outer ones are fixed.
    const outer = must(ENDS[1], 'plain end');
    let chains = 0;
    for (const circular of [false, true]) {
      checkChain([], circular);
      for (const r of ENDS)
        for (const t of TREATMENTS) {
          checkChain([piece(outer, r, t)], circular);
          checkChain([piece(r, r, t)], circular);
          chains += 2;
        }
      for (const r1 of ENDS)
        for (const l2 of ENDS)
          for (const t1 of TREATMENTS)
            for (const t2 of TREATMENTS) {
              checkChain([piece(outer, r1, t1), piece(l2, outer, t2)], circular);
              // Closing on itself as well: the closing join is l1 ← r2.
              checkChain([piece(l2, r1, t1), piece(l2, r1, t2)], circular);
              chains += 2;
            }
      const few = ENDS.filter((_, i) => i % 2 === 0);
      for (const a of few)
        for (const b of few)
          for (const t1 of TREATMENTS)
            for (const t2 of TREATMENTS)
              for (const t3 of TREATMENTS) {
                checkChain([piece(b, a, t1), piece(a, b, t2), piece(b, a, t3)], circular);
                chains += 1;
              }
    }
    expect(chains).toBeGreaterThan(1000);
  }, 20_000);

  it('follow the oracle for random chains', () => {
    const endArb = fc.constantFrom(...ENDS);
    const partArb = fc.record({
      left: endArb,
      right: endArb,
      treated: fc.constantFrom<Treatment>(undefined, false, true),
    });
    fc.assert(
      fc.property(fc.array(partArb, { maxLength: 6 }), fc.boolean(), (parts, circular) => {
        checkChain(
          parts.map((p) => piece(p.left, p.right, p.treated)),
          circular,
        );
      }),
      { numRuns: 300 },
    );
  });

  it('a dephosphorylated piece joins an untreated one, and two treated pieces never join', () => {
    const eco = must(ENDS[2], 'EcoRI end');
    for (const t of TREATMENTS) {
      const vector = piece(eco, eco, true);
      const insert = piece(eco, eco, t);
      const joins = assemblyJunctions([vector, insert], true);
      expect(joins.every((j) => j.compatible)).toBe(t !== true);
      expect(joins.every((j) => j.dephosphorylated)).toBe(t === true);
    }
  });
});

describe('flipFragment and the phosphatase', () => {
  // A sticky piece whose sequence holds its own top-strand overhangs: 5′
  // AATT on the left, 3′ TGCA on the right.
  const sticky = (treated: Treatment): DigestFragment =>
    piece(
      { kind: "5'", overhang: 'AATT', enzyme: 'EcoRI' },
      { kind: "3'", overhang: 'TGCA', enzyme: 'PstI' },
      treated,
    );

  it('keeps the treatment through a flip, and a double flip is the same piece', () => {
    for (const t of TREATMENTS) {
      const base = sticky(t);
      const frag = { ...base, sequence: `AATT${base.sequence}TGCA` };
      const flipped = flipFragment(frag);
      expect(flipped.dephosphorylated).toBe(t);
      expect('dephosphorylated' in flipped).toBe(t !== undefined);
      const back = flipFragment(flipped);
      expect(back).toEqual(frag);
    }
  });

  it('keeps it for every pair of ends', () => {
    for (const l of ENDS)
      for (const r of ENDS)
        for (const t of TREATMENTS) {
          const frag = piece(l, r, t);
          // The sequence carries the overhangs its own top strand has.
          const head = l.kind === "5'" ? l.overhang : '';
          const tail = r.kind === "3'" ? r.overhang : '';
          const long = { ...frag, sequence: `${head}ACGTACGT${tail}` };
          expect(flipFragment(long).dephosphorylated).toBe(t);
          expect(flipFragment(flipFragment(long))).toEqual(long);
        }
  });
});
