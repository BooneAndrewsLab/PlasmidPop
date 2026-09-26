/**
 * Oligo thermodynamics: nearest-neighbour melting temperature after
 * SantaLucia (1998, PNAS 95:1460) with the unified parameter set, entropy
 * salt correction, and end/symmetry terms. Good to about ±2 °C for typical
 * PCR primers at standard conditions.
 */

interface NN {
  readonly dH: number; // kcal/mol
  readonly dS: number; // cal/(K·mol)
}

const NN_PARAMS: Readonly<Record<string, NN>> = {
  AA: { dH: -7.9, dS: -22.2 },
  TT: { dH: -7.9, dS: -22.2 },
  AT: { dH: -7.2, dS: -20.4 },
  TA: { dH: -7.2, dS: -21.3 },
  CA: { dH: -8.5, dS: -22.7 },
  TG: { dH: -8.5, dS: -22.7 },
  GT: { dH: -8.4, dS: -22.4 },
  AC: { dH: -8.4, dS: -22.4 },
  CT: { dH: -7.8, dS: -21.0 },
  AG: { dH: -7.8, dS: -21.0 },
  GA: { dH: -8.2, dS: -22.2 },
  TC: { dH: -8.2, dS: -22.2 },
  CG: { dH: -10.6, dS: -27.2 },
  GC: { dH: -9.8, dS: -24.4 },
  GG: { dH: -8.0, dS: -19.9 },
  CC: { dH: -8.0, dS: -19.9 },
};

const INIT_GC: NN = { dH: 0.1, dS: -2.8 };
const INIT_AT: NN = { dH: 2.3, dS: 4.1 };
const SYMMETRY_DS = -1.4;
const R = 1.987; // cal/(K·mol)

export interface ThermoConditions {
  /** Total oligo concentration in nM (default 500). */
  readonly oligoNM?: number;
  /** Monovalent cation concentration in mM (default 50). */
  readonly sodiumMM?: number;
}

const COMPLEMENT: Readonly<Record<string, string>> = { A: 'T', C: 'G', G: 'C', T: 'A' };

function isSelfComplementary(seq: string): boolean {
  const n = seq.length;
  for (let i = 0; i < n; i++) if (COMPLEMENT[seq.charAt(i)] !== seq.charAt(n - 1 - i)) return false;
  return true;
}

/**
 * Melting temperature in °C. Returns NaN for sequences shorter than 2 bases
 * or containing characters other than A, C, G, T (U is treated as T).
 */
export function meltingTemperature(sequence: string, conditions: ThermoConditions = {}): number {
  const seq = sequence.toUpperCase().replace(/U/g, 'T');
  if (seq.length < 2 || /[^ACGT]/.test(seq)) return NaN;
  let dH = 0;
  let dS = 0;
  for (let i = 0; i + 1 < seq.length; i++) {
    const nn = NN_PARAMS[seq.slice(i, i + 2)];
    if (nn === undefined) return NaN;
    dH += nn.dH;
    dS += nn.dS;
  }
  for (const end of [seq.charAt(0), seq.charAt(seq.length - 1)]) {
    const init = end === 'G' || end === 'C' ? INIT_GC : INIT_AT;
    dH += init.dH;
    dS += init.dS;
  }
  const symmetric = isSelfComplementary(seq);
  if (symmetric) dS += SYMMETRY_DS;

  const sodium = (conditions.sodiumMM ?? 50) / 1000;
  dS += 0.368 * (seq.length - 1) * Math.log(sodium);
  const ct = (conditions.oligoNM ?? 500) * 1e-9;
  const effective = symmetric ? ct : ct / 4;
  return (dH * 1000) / (dS + R * Math.log(effective)) - 273.15;
}

/**
 * Monovalent cation concentration (M) that reproduces NEB's Tm Calculator
 * for Q5 (#69). NEB does not publish its buffers; with its documented method
 * (below) 150 mM gives every one of eleven primers from 17 to 32 nt and 9 to
 * 90 % GC the Tm the calculator showed on 2026-09-25, to the degree.
 */
const Q5_MONOVALENT_M = 0.15;
/** Primer concentration NEB assumes for Q5 (M). */
const Q5_PRIMER_M = 500e-9;
/** Q5's annealing temperature never goes above its extension temperature. */
const Q5_MAX_ANNEAL = 72;

/**
 * Melting temperature in °C as NEB's Tm Calculator gives it for Q5 (#69).
 * NEB documents the method: SantaLucia (1998) nearest neighbours at 1 M,
 * with the whole primer concentration in the logarithm (the calculator
 * divided it by four until 2016, and says so), then Owczarzy et al. (2004)'s
 * monovalent salt correction to the buffer. It reads 1–3 °C above
 * `meltingTemperature`, which is what NEB means by other calculators
 * underestimating the Tm for use with Q5. NaN as `meltingTemperature` is.
 */
export function q5MeltingTemperature(sequence: string): number {
  const seq = sequence.toUpperCase().replace(/U/g, 'T');
  if (seq.length < 2 || /[^ACGT]/.test(seq)) return NaN;
  let dH = 0;
  let dS = 0;
  for (let i = 0; i + 1 < seq.length; i++) {
    const nn = NN_PARAMS[seq.slice(i, i + 2)];
    if (nn === undefined) return NaN;
    dH += nn.dH;
    dS += nn.dS;
  }
  for (const end of [seq.charAt(0), seq.charAt(seq.length - 1)]) {
    const init = end === 'G' || end === 'C' ? INIT_GC : INIT_AT;
    dH += init.dH;
    dS += init.dS;
  }
  const oneMolar = (dH * 1000) / (dS + R * Math.log(Q5_PRIMER_M));
  const ln = Math.log(Q5_MONOVALENT_M);
  const gc = gcFraction(seq);
  return 1 / (1 / oneMolar + ((4.29 * gc - 3.95) * ln + 0.94 * ln * ln) * 1e-5) - 273.15;
}

/**
 * NEB's annealing temperature for a Q5 PCR with primers of these Q5 Tms
 * (`q5MeltingTemperature`): one degree over the lower, never above 72 °C.
 * The rule is read off the calculator (#69), where it held for every pair
 * tried; NEB's older advice of Tm + 3 °C was written for Tms 2 °C lower,
 * before its 2016 correction, and its Ta values were left as they were.
 */
export function q5AnnealingTemperature(tmA: number, tmB: number): number {
  return Math.min(Math.round(Math.min(tmA, tmB)) + 1, Q5_MAX_ANNEAL);
}

/** Fraction of G and C bases, 0–1 (0 for empty input). */
export function gcFraction(sequence: string): number {
  if (sequence.length === 0) return 0;
  let gc = 0;
  for (const c of sequence.toUpperCase()) if (c === 'G' || c === 'C' || c === 'S') gc++;
  return gc / sequence.length;
}

/** Longest run of one base, e.g. 4 for "GGGG". */
export function longestHomopolymer(sequence: string): number {
  let best = 0;
  let run = 0;
  let prev = '';
  for (const c of sequence.toUpperCase()) {
    run = c === prev ? run + 1 : 1;
    prev = c;
    if (run > best) best = run;
  }
  return best;
}

/**
 * Longest stretch of a primer that is complementary to another stretch of
 * the same primer in antiparallel orientation (self-dimer / hairpin
 * propensity). Values of 5+ bases at the 3' end are usually trouble.
 */
export function maxSelfComplementarity(sequence: string): number {
  const seq = sequence.toUpperCase();
  const n = seq.length;
  let best = 0;
  // Slide the reverse complement across the sequence and count the longest
  // contiguous run of complementary pairs.
  for (let offset = -(n - 1); offset < n; offset++) {
    let run = 0;
    for (let i = 0; i < n; i++) {
      const j = n - 1 - (i + offset);
      if (j < 0 || j >= n) {
        run = 0;
        continue;
      }
      if (COMPLEMENT[seq.charAt(i)] === seq.charAt(j)) {
        run++;
        if (run > best) best = run;
      } else run = 0;
    }
  }
  return best;
}

/**
 * Longest stem a primer can fold back on itself to form: `k` consecutive
 * bases pairing, antiparallel, with `k` further along, and at least
 * `minLoop` unpaired bases between the two arms (three is the tightest turn
 * a single strand can make). A hairpin ties up the 3′ end before it finds
 * the template, which is why it is filtered on separately from a dimer.
 */
export function longestHairpinStem(sequence: string, minLoop = 3): number {
  const seq = sequence.toUpperCase();
  const n = seq.length;
  let best = 0;
  // run[i][j]: stem length whose innermost pair is (i, j), growing outward
  // to (i - 1, j + 1) and so on. Rolled into one row per j.
  let outer = new Array<number>(n + 1).fill(0); // row for j + 1
  for (let j = n - 1; j >= 0; j--) {
    const row = new Array<number>(n + 1).fill(0);
    for (let i = 0; i + minLoop < j; i++) {
      if (COMPLEMENT[seq.charAt(i)] !== seq.charAt(j)) continue;
      const run = (i > 0 ? (outer[i - 1] ?? 0) : 0) + 1;
      row[i] = run;
      if (run > best) best = run;
    }
    outer = row;
  }
  return best;
}

/**
 * How many bases at the 3′ end of `a` would pair with `b` laid antiparallel
 * against it: the longest `k` for which the last `k` bases of `a`,
 * reverse-complemented, occur in `b`. That is the dimer a polymerase can
 * extend, which makes it the one that matters; a dimer in the middle of two
 * primers mostly costs a little Tm. Pass the same primer twice for a
 * self-dimer, or the two of a pair for a primer-dimer.
 */
export function threePrimeComplementarity(a: string, b: string): number {
  const x = a.toUpperCase();
  const y = b.toUpperCase();
  let best = 0;
  for (let k = 1; k <= x.length && k <= y.length; k++) {
    let rc = '';
    for (let i = x.length - 1; i >= x.length - k; i--) rc += COMPLEMENT[x.charAt(i)] ?? 'N';
    if (!y.includes(rc)) break;
    best = k;
  }
  return best;
}
