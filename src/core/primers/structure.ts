/**
 * Secondary-structure free energy of primers: the stability of a hairpin, a
 * self-dimer or a primer-dimer as a nearest-neighbour ΔG in kcal/mol at 37 °C,
 * 50 mM monovalent salt (the conditions of `meltingTemperature`). Item 123.
 *
 * It is the model Primer3's `thal` uses (SantaLucia 1998 stacks; SantaLucia
 * and Hicks 2004 loop initiations; terminal mismatches and dangling ends),
 * written for one temperature and with the loop terms reduced from Primer3's
 * per-nucleotide tables to a handful of scalars, so it is ours, small and
 * fast. Wobble (G·T) pairs, the special tri- and tetraloop bonuses and
 * multibranch structures are left out, as they are in `thal`'s duplex
 * search. The scalars were fitted to Primer3's output (see item 123 for
 * how well they agree).
 *
 * Energies are never positive: a structure that costs more than it gives is
 * not formed, and the answer is 0.
 */
import { NN_PARAMS } from './thermo';

/** Free energy, kcal/mol, of a thermodynamic term. */
export interface StructureParams {
  /** Salt correction added to every stack (50 mM Na+). */
  readonly stackSalt: number;
  /** Duplex initiation, two strands coming together. */
  readonly duplexInit: number;
  /** Hairpin initiation. */
  readonly hairpinInit: number;
  /** Extra for an A·T pair at the end of a helix or beside a loop. */
  readonly atClose: number;
  /** Hairpin loop of 3..10 bases (index 0 is size 3). */
  readonly hairpinLoop: readonly number[];
  /** Terminal mismatch beside a hairpin loop, by the closing pair. */
  readonly hairpinMismatchGc: number;
  readonly hairpinMismatchAt: number;
  /** Bulge of 1..10 bases (index 0 is size 1). */
  readonly bulge: readonly number[];
  /** Interior loop by total size 2..12 (index 0 is size 2, the 1x1 loop). */
  readonly interior: readonly number[];
  /**
   * Stacking of a mismatched pair against a Watson-Crick neighbour, by the
   * unordered pair of bases (AA, AC, AG, CC, CT, GG, GT, TT) and whether the
   * neighbour is G·C or A·T. Mismatches are not all costly: G·T, G·G and
   * G·A beside a G·C pair stabilise a helix almost as a stack does.
   */
  readonly mismatchGc: readonly number[];
  readonly mismatchAt: readonly number[];
  /** Per base of asymmetry in an interior loop, and its ceiling. */
  readonly asymmetry: number;
  readonly asymmetryMax: number;
  /** Terminal mismatch at a helix end (both overhanging bases present). */
  readonly endMismatchGc: number;
  readonly endMismatchAt: number;
  /** One overhanging base at a helix end. */
  readonly danglingGc: number;
  readonly danglingAt: number;
}

export const STRUCTURE_PARAMS: StructureParams = {
  stackSalt: 0.34,
  duplexInit: 2.2,
  hairpinInit: 0.2,
  atClose: 0.05,
  hairpinLoop: [3.5, 3.5, 3.7, 4.1, 4.2, 4.4, 4.5, 4.7],
  hairpinMismatchGc: -0.8,
  hairpinMismatchAt: -0.6,
  bulge: [3.8, 3.5, 3.7, 3.7, 4.0, 4.2, 4.6, 4.7, 4.8, 4.9],
  interior: [0.8, 2.0, 2.4, 2.6, 3.0, 3.3, 3.5, 3.7, 3.9, 4.1, 4.3],
  mismatchGc: [0, 0.1, -0.3, 0.4, 0.5, -1.0, -0.5, -0.5],
  mismatchAt: [1.3, 0, -0.1, 1.0, 0.3, 0, -0.1, 0.5],
  asymmetry: 0.8,
  asymmetryMax: 1.2,
  endMismatchGc: -1.1,
  endMismatchAt: -0.6,
  danglingGc: -0.7,
  danglingAt: -0.3,
};

const BODY_TEMPERATURE = 310.15;
/** 1.75 RT at 37 °C: how a loop's cost grows with its size past the table. */
const LOOP_GROWTH = 1.75 * 0.001987 * BODY_TEMPERATURE;
/** Unpaired bases allowed on either side of an interior loop or bulge. */
const MAX_LOOP = 4;
const INF = 1e9;

/** 0 A, 1 C, 2 G, 3 T, 4 anything else. */
function codes(seq: string): Uint8Array {
  const out = new Uint8Array(seq.length);
  for (let i = 0; i < seq.length; i++) {
    const c = seq.charCodeAt(i) | 0x20;
    out[i] = c === 97 ? 0 : c === 99 ? 1 : c === 103 ? 2 : c === 116 || c === 117 ? 3 : 4;
  }
  return out;
}

const BASES = 'ACGT';
/** ΔG37 of a stack, indexed by the two bases of the 5'→3' strand. */
const STACK = ((): Float64Array => {
  const t = new Float64Array(16);
  for (let a = 0; a < 4; a++) {
    for (let b = 0; b < 4; b++) {
      const nn = NN_PARAMS[BASES.charAt(a) + BASES.charAt(b)];
      if (nn !== undefined) t[a * 4 + b] = nn.dH - (BODY_TEMPERATURE * nn.dS) / 1000;
    }
  }
  return t;
})();

/** Watson-Crick partners: A-T, C-G. */
const pairs = (a: number, b: number): boolean => a < 4 && b < 4 && a + b === 3;
const isGc = (a: number): boolean => a === 1 || a === 2;

/** Index of an unordered mismatch: AA AC AG CC CT GG GT TT; -1 for none. */
const MISMATCH = ((): Int8Array => {
  const t = new Int8Array(25).fill(-1);
  const names = ['AA', 'AC', 'AG', 'CC', 'CT', 'GG', 'GT', 'TT'];
  names.forEach((name, k) => {
    const a = BASES.indexOf(name.charAt(0));
    const b = BASES.indexOf(name.charAt(1));
    t[a * 5 + b] = k;
    t[b * 5 + a] = k;
  });
  return t;
})();

/** Stacking of the mismatch (u, w) against the pair whose base is `a`. */
function mismatchEnergy(p: StructureParams, a: number, u: number, w: number): number {
  const k = u < 4 && w < 4 ? (MISMATCH[u * 5 + w] ?? -1) : -1;
  if (k < 0) return 0;
  return (isGc(a) ? p.mismatchGc[k] : p.mismatchAt[k]) ?? 0;
}

function hairpinLoopEnergy(p: StructureParams, size: number): number {
  const t = p.hairpinLoop;
  const last = t.length + 2;
  if (size <= last) return t[size - 3] ?? INF;
  return (t[t.length - 1] ?? 0) + LOOP_GROWTH * Math.log(size / last);
}

/**
 * What it costs to leave a helix end with these bases hanging off it:
 * a terminal mismatch if both strands continue, a dangling base if one does,
 * and the A·T penalty. `a` is the end pair's base on either strand;
 * `over1` and `over2` are the neighbours (4 when the strand ends there).
 */
function endEnergy(p: StructureParams, a: number, over1: number, over2: number): number {
  const gc = isGc(a);
  let e = gc ? 0 : p.atClose;
  if (over1 < 4 && over2 < 4) e += gc ? p.endMismatchGc : p.endMismatchAt;
  else if (over1 < 4 || over2 < 4) e += gc ? p.danglingGc : p.danglingAt;
  return e;
}

/**
 * Loop between the pair (a1, b1) and the next pair (a2, b2) along a helix
 * with `up` unpaired bases on one strand and `down` on the other. `a1`/`a2`
 * are the bases on the strand that is read 5'→3' through the helix; the
 * other strand holds their complements.
 */
function loopEnergy(
  p: StructureParams,
  a1: number,
  a2: number,
  up: number,
  down: number,
  l1: number,
  l2: number,
  r1: number,
  r2: number,
): number {
  if (up === 0 && down === 0) return (STACK[a1 * 4 + a2] ?? 0) + p.stackSalt;
  const closing = (isGc(a1) ? 0 : p.atClose) + (isGc(a2) ? 0 : p.atClose);
  if (up === 0 || down === 0) {
    const n = up + down;
    const init = p.bulge[n - 1] ?? INF;
    // A bulge of one keeps the helix stacked across it.
    if (n === 1) return init + (STACK[a1 * 4 + a2] ?? 0) + p.stackSalt;
    return init + closing;
  }
  const n = up + down;
  const t = p.interior;
  const init =
    n - 2 < t.length
      ? (t[n - 2] ?? INF)
      : (t[t.length - 1] ?? 0) + LOOP_GROWTH * Math.log(n / (t.length + 1));
  return (
    init +
    Math.min(p.asymmetryMax, p.asymmetry * Math.abs(up - down)) +
    mismatchEnergy(p, a1, l1, l2) +
    mismatchEnergy(p, a2, r1, r2) +
    (n === 2 ? 0 : closing)
  );
}

/**
 * ΔG, kcal/mol (0 or negative), of the most stable hairpin a primer can
 * fold into: one helix, which may carry bulges and interior loops, closed by
 * a loop of at least three bases. A foldback at the 3' end ties up the
 * primer before it finds the template.
 */
export function hairpinEnergy(
  sequence: string,
  p: StructureParams = STRUCTURE_PARAMS,
  maxLoop = MAX_LOOP,
): number {
  const x = codes(sequence);
  const n = x.length;
  if (n < 6) return 0;
  const width = n + 1;
  // v[i * width + j]: best ΔG of a helix whose outermost pair is (i, j).
  const v = new Float64Array(width * width).fill(INF);
  let best = 0;
  for (let len = 5; len <= n; len++) {
    for (let i = 0; i + len - 1 < n; i++) {
      const j = i + len - 1;
      const xi = x[i] ?? 4;
      if (!pairs(xi, x[j] ?? 4)) continue;
      const loop = j - i - 1;
      let e =
        hairpinLoopEnergy(p, loop) +
        (loop === 3
          ? isGc(xi)
            ? 0
            : p.atClose
          : isGc(xi)
            ? p.hairpinMismatchGc
            : p.hairpinMismatchAt);
      // Extend inward: the next pair (q, r) inside.
      for (let a = i + 1; a <= i + 1 + maxLoop && a < j; a++) {
        const up = a - i - 1;
        for (let b = j - 1; b >= j - 1 - maxLoop && b > a + 2; b--) {
          const down = j - 1 - b;
          const inner = v[a * width + b] ?? INF;
          if (inner >= INF) continue;
          const c =
            inner +
            loopEnergy(
              p,
              xi,
              x[a] ?? 4,
              up,
              down,
              x[i + 1] ?? 4,
              x[j - 1] ?? 4,
              x[a - 1] ?? 4,
              x[b + 1] ?? 4,
            );
          if (c < e) e = c;
        }
      }
      v[i * width + j] = e;
      const total =
        e +
        p.hairpinInit +
        endEnergy(p, xi, i > 0 ? (x[i - 1] ?? 4) : 4, j + 1 < n ? (x[j + 1] ?? 4) : 4);
      if (total < best) best = total;
    }
  }
  return best;
}

/**
 * ΔG, kcal/mol (0 or negative), of the most stable duplex between two
 * primers: one helix, with bulges and interior loops allowed, and what
 * overhangs at either end counted as terminal mismatches and dangling ends.
 * For `a` against itself this is the self-dimer.
 */
export function dimerEnergy(
  a: string,
  b: string,
  p: StructureParams = STRUCTURE_PARAMS,
  maxLoop = MAX_LOOP,
): number {
  const x = codes(a);
  // b read 3'→5', so that x[i] pairs with y[j] when they are complementary
  // and the helix runs through both with i and j increasing.
  const y = codes(b).reverse();
  const n = x.length;
  const m = y.length;
  if (n < 2 || m < 2) return 0;
  // f[i * m + j]: best ΔG of a helix whose last pair so far is (i, j).
  const f = new Float64Array(n * m).fill(INF);
  let best = 0;
  for (let i = 0; i < n; i++) {
    const xi = x[i] ?? 4;
    for (let j = 0; j < m; j++) {
      if (!pairs(xi, y[j] ?? 4)) continue;
      let e = endEnergy(p, xi, i > 0 ? (x[i - 1] ?? 4) : 4, j > 0 ? (y[j - 1] ?? 4) : 4);
      for (let pi = i - 1; pi >= 0 && pi >= i - 1 - maxLoop; pi--) {
        const up = i - 1 - pi;
        for (let pj = j - 1; pj >= 0 && pj >= j - 1 - maxLoop; pj--) {
          const prev = f[pi * m + pj] ?? INF;
          if (prev >= INF) continue;
          const c =
            prev +
            loopEnergy(
              p,
              x[pi] ?? 4,
              xi,
              up,
              j - 1 - pj,
              x[pi + 1] ?? 4,
              y[pj + 1] ?? 4,
              x[i - 1] ?? 4,
              y[j - 1] ?? 4,
            );
          if (c < e) e = c;
        }
      }
      f[i * m + j] = e;
      const total =
        e +
        p.duplexInit +
        endEnergy(p, xi, i + 1 < n ? (x[i + 1] ?? 4) : 4, j + 1 < m ? (y[j + 1] ?? 4) : 4);
      if (total < best) best = total;
    }
  }
  return best;
}

/** `dimerEnergy` of a primer with itself. */
export function selfDimerEnergy(sequence: string): number {
  return dimerEnergy(sequence, sequence);
}
