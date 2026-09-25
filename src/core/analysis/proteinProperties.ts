/**
 * The basic physico-chemical properties of a protein (#66), computed as
 * ExPASy's ProtParam computes them so the numbers agree with the tool
 * everyone checks against (`docs/design/57-protein-documents.md`):
 *
 * - Molecular weight from average residue masses plus one water.
 * - Theoretical pI by the pK values of Bjellqvist et al. (1993, 1994), with
 *   the N-terminal pK depending on the first residue. The C-terminal pK is
 *   3.55 whatever the last residue: Bjellqvist gives 4.55 after Asp and 4.75
 *   after Glu, but ProtParam does not use them (MKWVDDE is 4.03 there, 4.32
 *   with them).
 * - The extinction coefficient at 280 nm in water by Pace et al. (1995):
 *   5500 per Trp, 1490 per Tyr and 125 per cystine.
 */

/** Average masses of the residues (Da), as ExPASy lists them. */
const RESIDUE_MASS: Readonly<Record<string, number>> = {
  A: 71.0788,
  R: 156.1875,
  N: 114.1038,
  D: 115.0886,
  C: 103.1388,
  E: 129.1155,
  Q: 128.1307,
  G: 57.0519,
  H: 137.1411,
  I: 113.1594,
  L: 113.1594,
  K: 128.1741,
  M: 131.1926,
  F: 147.1766,
  P: 97.1167,
  S: 87.0782,
  T: 101.1051,
  W: 186.2132,
  Y: 163.176,
  V: 99.1326,
  // Selenocysteine, C3H5NOSe, and pyrrolysine, C12H19N3O2, from average
  // element masses: ProtParam has neither.
  U: 150.0379,
  O: 237.2982,
  // Isoleucine or leucine: the same mass either way.
  J: 113.1594,
};

/**
 * Masses for the codes that stand for more than one residue, which make the
 * weight approximate: B and Z the mean of their two, X a mean residue.
 */
const AMBIGUOUS_MASS: Readonly<Record<string, number>> = {
  B: (115.0886 + 114.1038) / 2,
  Z: (129.1155 + 128.1307) / 2,
  X: 110,
};

const WATER = 18.01524;

/** Bjellqvist's pK values for the side chains. */
const POSITIVE_PK: Readonly<Record<string, number>> = { K: 10.0, R: 12.0, H: 5.98 };
const NEGATIVE_PK: Readonly<Record<string, number>> = { D: 4.05, E: 4.45, C: 9.0, Y: 10.0 };
/** The N-terminus's pK, which depends on the residue at that end. */
const N_TERMINAL_PK: Readonly<Record<string, number>> = {
  A: 7.59,
  M: 7.0,
  S: 6.93,
  P: 8.36,
  T: 6.82,
  V: 7.44,
  E: 7.7,
};
const N_TERMINAL_DEFAULT = 7.5;
/** The C-terminus's pK, the same after every residue as ProtParam has it. */
const C_TERMINAL_PK = 3.55;

/** Pace et al.'s molar absorptivities at 280 nm (M⁻¹ cm⁻¹). */
const TRP_280 = 5500;
const TYR_280 = 1490;
const CYSTINE_280 = 125;

export interface ProteinProperties {
  /** Residues in the chain; a stop (`*`) is not one. */
  readonly length: number;
  /** Average molecular weight (Da); 0 for an empty chain. */
  readonly molecularWeight: number;
  /**
   * Residues written as B, Z or X, which the weight takes an average mass
   * for and the pI leaves uncharged: when there are any, both are estimates.
   */
  readonly ambiguous: number;
  /** Stops (`*`) in the text, which are left out of everything. */
  readonly stops: number;
  /** Theoretical isoelectric point; null for an empty chain. */
  readonly isoelectricPoint: number | null;
  /** Net charge at pH 7; 0 for an empty chain. */
  readonly chargeAtPH7: number;
  /** ε₂₈₀ (M⁻¹ cm⁻¹) with every pair of Cys a cystine. */
  readonly extinctionCystines: number;
  /** ε₂₈₀ (M⁻¹ cm⁻¹) with every Cys reduced. */
  readonly extinctionReduced: number;
  /** Absorbance of 1 g/L (Abs 0.1%) with cystines, and reduced; null when there is no weight. */
  readonly absorbanceCystines: number | null;
  readonly absorbanceReduced: number | null;
  /** How many of each residue, by one-letter code, in upper case. */
  readonly counts: ReadonlyMap<string, number>;
}

/** Residues of `protein` by code, upper-cased, stops left out. */
function countResidues(protein: string): Map<string, number> {
  const counts = new Map<string, number>();
  for (const ch of protein.toUpperCase()) {
    if (ch === '*') continue;
    counts.set(ch, (counts.get(ch) ?? 0) + 1);
  }
  return counts;
}

/** The chain's net charge at `pH`, by Bjellqvist's pK values. */
function netCharge(counts: ReadonlyMap<string, number>, first: string, pH: number) {
  const h = 10 ** pH;
  const positive = (pK: number): number => 10 ** pK / (10 ** pK + h);
  const negative = (pK: number): number => h / (10 ** pK + h);
  let charge = positive(N_TERMINAL_PK[first] ?? N_TERMINAL_DEFAULT);
  charge -= negative(C_TERMINAL_PK);
  for (const [residue, pK] of Object.entries(POSITIVE_PK)) {
    charge += (counts.get(residue) ?? 0) * positive(pK);
  }
  for (const [residue, pK] of Object.entries(NEGATIVE_PK)) {
    charge -= (counts.get(residue) ?? 0) * negative(pK);
  }
  return charge;
}

/** The pH at which the charge is nil, by bisection: the charge falls as the pH rises. */
function isoelectricPoint(counts: ReadonlyMap<string, number>, first: string) {
  let low = 0;
  let high = 14;
  while (high - low > 1e-4) {
    const mid = (low + high) / 2;
    if (netCharge(counts, first, mid) > 0) low = mid;
    else high = mid;
  }
  return (low + high) / 2;
}

/** The properties of the chain `protein` spells, in one-letter codes (either case). */
export function proteinProperties(protein: string): ProteinProperties {
  const counts = countResidues(protein);
  const chain = protein.toUpperCase().replace(/\*/g, '');
  const length = chain.length;
  let mass = 0;
  let ambiguous = 0;
  for (const [residue, n] of counts) {
    const known = RESIDUE_MASS[residue];
    if (known !== undefined) {
      mass += known * n;
      continue;
    }
    mass += (AMBIGUOUS_MASS[residue] ?? 0) * n;
    ambiguous += n;
  }
  const molecularWeight = length === 0 ? 0 : mass + WATER;
  const first = chain.charAt(0);
  const w = counts.get('W') ?? 0;
  const y = counts.get('Y') ?? 0;
  const c = counts.get('C') ?? 0;
  const extinctionReduced = w * TRP_280 + y * TYR_280;
  const extinctionCystines = extinctionReduced + Math.floor(c / 2) * CYSTINE_280;
  return {
    length,
    molecularWeight,
    ambiguous,
    stops: protein.length - protein.replace(/\*/g, '').length,
    isoelectricPoint: length === 0 ? null : isoelectricPoint(counts, first),
    chargeAtPH7: length === 0 ? 0 : netCharge(counts, first, 7),
    extinctionCystines,
    extinctionReduced,
    absorbanceCystines: molecularWeight > 0 ? extinctionCystines / molecularWeight : null,
    absorbanceReduced: molecularWeight > 0 ? extinctionReduced / molecularWeight : null,
    counts,
  };
}
