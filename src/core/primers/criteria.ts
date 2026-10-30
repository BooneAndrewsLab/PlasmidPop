/**
 * What a designed primer has to be. One set of numbers serves both the
 * designer, which refuses a candidate that breaks any of them, and the check
 * of a pasted primer, which names each one it breaks — so the two can never
 * disagree about what a good primer is.
 */
export interface PrimerCriteria {
  readonly minLength: number;
  readonly maxLength: number;
  /** °C, nearest-neighbour (`meltingTemperature`). */
  readonly minTm: number;
  readonly maxTm: number;
  /** Fractions, 0–1. */
  readonly minGc: number;
  readonly maxGc: number;
  /** The most the two primers of a pair may differ in Tm, °C. */
  readonly maxTmDifference: number;
  /**
   * Where each primer may lie, in bp from the selection's edges: the forward
   * primer wholly between `far` bp before the start and `near` bp before it,
   * the reverse primer likewise after the end. A negative `near` lets a
   * primer reach into the selection, which is how an ORF is amplified from
   * its own start codon.
   */
  readonly forwardRegion: PrimerRegion;
  readonly reverseRegion: PrimerRegion;
  /** Longest run of one base allowed (`GGGG` is 4). */
  readonly maxHomopolymer: number;
  /**
   * Hairpin free energy, kcal/mol (`hairpinEnergy`): a primer whose best
   * hairpin is at or below this is refused. Less negative is more lenient.
   */
  readonly hairpinDg: number;
  /**
   * Hairpin melting temperature, °C (`hairpinTm`): a primer whose best hairpin
   * melts above this is refused. Primer3's `PRIMER_MAX_HAIRPIN_TH`, same
   * default, so a pair is not selected that Primer3 would turn down for a
   * hairpin too stable at the annealing step (#345).
   */
  readonly hairpinTm: number;
  /**
   * Dimer free energy, kcal/mol (`dimerEnergy`): a primer that pairs with
   * itself, or a pair that pairs with each other, at or below this is refused.
   */
  readonly dimerDg: number;
  /**
   * Longest 3′-end complementarity, to itself and to the other primer of the
   * pair (`threePrimeComplementarity`): the dimer a polymerase can extend.
   * Kept beside the free energy on purpose: a 3′ match of a few bases is
   * extended whatever its ΔG, which a mid-primer dimer is not.
   */
  readonly maxThreePrime: number;
  /** Refuse a primer that does not end in G or C, rather than only preferring one. */
  readonly requireGcClamp: boolean;
  /** Shortest and longest product a pair may give, bp. */
  readonly minProduct: number;
  readonly maxProduct: number;
  /**
   * Refuse a primer that would also anneal somewhere else on the template,
   * either strand, by `findPrimerBindingSites`' rule (exact 3′ end, up to
   * two mismatches elsewhere) — the second band nobody asked for.
   */
  readonly requireSpecific: boolean;
}

export interface PrimerRegion {
  readonly near: number;
  readonly far: number;
}

/**
 * The free-energy cutoffs, kcal/mol, at 37 °C, 50 mM Na+. A hairpin at or
 * below -2 and a dimer at or below -6 are the conventional limits for a PCR
 * primer (Primer3's own defaults for its hairpin and dimer checks are on the
 * same scale, as ΔG at the annealing temperature), and the two that agreed
 * best with Primer3's flags when swept (design notes 121 and 123).
 */
export const DEFAULT_HAIRPIN_DG = -2;
export const DEFAULT_DIMER_DG = -6;
/** Primer3's `PRIMER_MAX_HAIRPIN_TH`, °C. */
export const DEFAULT_HAIRPIN_TM = 47;

export const DEFAULT_PRIMER_CRITERIA: PrimerCriteria = {
  minLength: 18,
  maxLength: 27,
  minTm: 55,
  maxTm: 65,
  minGc: 0.35,
  maxGc: 0.65,
  maxTmDifference: 3,
  forwardRegion: { near: 0, far: 200 },
  reverseRegion: { near: 0, far: 200 },
  maxHomopolymer: 4,
  hairpinDg: DEFAULT_HAIRPIN_DG,
  hairpinTm: DEFAULT_HAIRPIN_TM,
  dimerDg: DEFAULT_DIMER_DG,
  maxThreePrime: 4,
  requireGcClamp: false,
  minProduct: 0,
  // The PCR reaction's own ceiling (`src/core/cloning/pcr.ts`).
  maxProduct: 20_000,
  requireSpecific: true,
};

/** The shortest and longest primer the designer will consider. */
export const PRIMER_LENGTH_LIMITS = { min: 8, max: 60 } as const;
/** How far from the selection a primer may be looked for, either way. */
export const PRIMER_REGION_LIMIT = 5000;
/** The longest product the settings will ask for. */
export const PRIMER_PRODUCT_LIMIT = 1_000_000;

function num(v: unknown, fallback: number, lo: number, hi: number, integer = true): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) return fallback;
  const x = integer ? Math.round(v) : v;
  return Math.min(hi, Math.max(lo, x));
}

function region(v: unknown, fallback: PrimerRegion): PrimerRegion {
  const r = typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : {};
  const near = num(r['near'], fallback.near, -PRIMER_REGION_LIMIT, PRIMER_REGION_LIMIT);
  const far = num(r['far'], fallback.far, -PRIMER_REGION_LIMIT, PRIMER_REGION_LIMIT);
  return near <= far ? { near, far } : { near: far, far: near };
}

/**
 * Criteria from anything — a stored preference, a half-typed form — held to
 * ranges the designer can work with and with each minimum at or under its
 * maximum. A missing or unreadable field takes the default, so an older
 * stored entry cannot leave the designer with nothing to go on.
 */
export function normalizePrimerCriteria(input: unknown): PrimerCriteria {
  const d = DEFAULT_PRIMER_CRITERIA;
  const r = typeof input === 'object' && input !== null ? (input as Record<string, unknown>) : {};
  const { min: lenLo, max: lenHi } = PRIMER_LENGTH_LIMITS;
  const pair = (a: number, b: number): [number, number] => (a <= b ? [a, b] : [b, a]);
  const [minLength, maxLength] = pair(
    num(r['minLength'], d.minLength, lenLo, lenHi),
    num(r['maxLength'], d.maxLength, lenLo, lenHi),
  );
  const [minTm, maxTm] = pair(
    num(r['minTm'], d.minTm, 0, 100, false),
    num(r['maxTm'], d.maxTm, 0, 100, false),
  );
  const [minGc, maxGc] = pair(
    num(r['minGc'], d.minGc, 0, 1, false),
    num(r['maxGc'], d.maxGc, 0, 1, false),
  );
  const [minProduct, maxProduct] = pair(
    num(r['minProduct'], d.minProduct, 0, PRIMER_PRODUCT_LIMIT),
    num(r['maxProduct'], d.maxProduct, 0, PRIMER_PRODUCT_LIMIT),
  );
  return {
    minLength,
    maxLength,
    minTm,
    maxTm,
    minGc,
    maxGc,
    maxTmDifference: num(r['maxTmDifference'], d.maxTmDifference, 0, 100, false),
    forwardRegion: region(r['forwardRegion'], d.forwardRegion),
    reverseRegion: region(r['reverseRegion'], d.reverseRegion),
    maxHomopolymer: num(r['maxHomopolymer'], d.maxHomopolymer, 1, lenHi),
    hairpinDg: num(r['hairpinDg'], d.hairpinDg, -50, 0, false),
    hairpinTm: num(r['hairpinTm'], d.hairpinTm, 0, 150, false),
    dimerDg: num(r['dimerDg'], d.dimerDg, -100, 0, false),
    maxThreePrime: num(r['maxThreePrime'], d.maxThreePrime, 0, lenHi),
    requireGcClamp:
      typeof r['requireGcClamp'] === 'boolean' ? r['requireGcClamp'] : d.requireGcClamp,
    minProduct,
    maxProduct,
    requireSpecific:
      typeof r['requireSpecific'] === 'boolean' ? r['requireSpecific'] : d.requireSpecific,
  };
}

export function samePrimerCriteria(a: PrimerCriteria, b: PrimerCriteria): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** The criteria as one line, for the closed settings and the note above them. */
export function describePrimerCriteria(c: PrimerCriteria): string {
  const region = (r: PrimerCriteria['forwardRegion']): string => `${r.near}–${r.far}`;
  const regions =
    c.forwardRegion.near === c.reverseRegion.near && c.forwardRegion.far === c.reverseRegion.far
      ? `within ${region(c.forwardRegion)} bp of the target`
      : `forward ${region(c.forwardRegion)} bp before, reverse ${region(c.reverseRegion)} bp after`;
  return `${c.minLength}–${c.maxLength} nt, Tm ${c.minTm}–${c.maxTm} °C, GC ${Math.round(c.minGc * 100)}–${Math.round(c.maxGc * 100)} %, ${regions}`;
}
