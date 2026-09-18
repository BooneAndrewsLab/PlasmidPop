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
