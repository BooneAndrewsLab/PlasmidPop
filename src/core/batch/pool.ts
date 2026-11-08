import { DEFAULT_DIMER_DG, dimerEnergy, meltingTemperature } from '../primers';

/**
 * Checks across the oligos of a finished batch (#358, item 141): what no one
 * pair of primers shows, but an order of 192 oligos in one plate does. Pure
 * functions over names and bases, so they run on the main thread for the
 * handful a batch makes and in a worker if a batch ever needs it.
 */

export interface PoolOligo {
  readonly name: string;
  readonly sequence: string;
}

export interface DuplicateName {
  /** The name as the first oligo wrote it. */
  readonly name: string;
  /** Positions in the pool of every oligo with this name, in order. */
  readonly indexes: readonly number[];
}

export interface SameBases {
  readonly sequence: string;
  /** The distinct names the bases are ordered under. */
  readonly names: readonly string[];
}

export interface PoolDimer {
  readonly a: string;
  readonly b: string;
  /** ΔG, kcal/mol, of the most stable duplex between the two. */
  readonly dg: number;
}

export interface TmSpread {
  readonly min: number;
  readonly max: number;
  readonly spread: number;
  readonly lowest: string;
  readonly highest: string;
  /** True when the spread is wider than the limit given. */
  readonly exceeds: boolean;
}

export interface PoolCheck {
  readonly duplicateNames: readonly DuplicateName[];
  readonly sameBases: readonly SameBases[];
  readonly dimers: readonly PoolDimer[];
  /** Null when no oligo has a Tm (none given, or all degenerate). */
  readonly tm: TmSpread | null;
}

export interface PoolOptions {
  /** Cross-dimers at or below this ΔG are reported. */
  readonly dimerDg?: number;
  /** A Tm spread wider than this, °C, is flagged. */
  readonly maxTmSpread?: number;
}

/** The widest Tm range a pool shares an annealing temperature across without comment, °C. */
export const DEFAULT_MAX_TM_SPREAD = 5;

const bases = (oligo: PoolOligo): string => oligo.sequence.replace(/\s+/g, '').toUpperCase();

/** Names used more than once, without regard to case, as a vendor's form treats them. */
export function duplicateNames(oligos: readonly PoolOligo[]): DuplicateName[] {
  const seen = new Map<string, { name: string; indexes: number[] }>();
  oligos.forEach((o, i) => {
    const key = o.name.trim().toLowerCase();
    const entry = seen.get(key);
    if (entry === undefined) seen.set(key, { name: o.name, indexes: [i] });
    else entry.indexes.push(i);
  });
  return [...seen.values()].filter((e) => e.indexes.length > 1);
}

/** Bases ordered under more than one name: the same oligo twice, which is paid for twice. */
export function sameBases(oligos: readonly PoolOligo[]): SameBases[] {
  const byBases = new Map<string, string[]>();
  for (const o of oligos) {
    const key = bases(o);
    const names = byBases.get(key) ?? [];
    if (!names.includes(o.name)) names.push(o.name);
    byBases.set(key, names);
  }
  return [...byBases.entries()]
    .filter(([, names]) => names.length > 1)
    .map(([sequence, names]) => ({ sequence, names }));
}

/**
 * The most stable duplex between every two oligos of different bases (an
 * oligo with itself is its self-dimer, which its own report has), kept when
 * its ΔG is at or below `maxDg`: the design's own cross-dimer cutoff by
 * default, so a short 3′ match that the designer accepts is not reported
 * here. Most stable first.
 */
export function crossDimers(
  oligos: readonly PoolOligo[],
  maxDg: number = DEFAULT_DIMER_DG,
): PoolDimer[] {
  const unique = new Map<string, string>();
  for (const o of oligos) if (!unique.has(bases(o))) unique.set(bases(o), o.name);
  const list = [...unique.entries()];
  const out: PoolDimer[] = [];
  for (let i = 0; i < list.length; i++) {
    const [seqA, nameA] = list[i] ?? ['', ''];
    for (let j = i + 1; j < list.length; j++) {
      const [seqB, nameB] = list[j] ?? ['', ''];
      const dg = dimerEnergy(seqA, seqB);
      if (dg <= maxDg) out.push({ a: nameA, b: nameB, dg });
    }
  }
  return out.sort((x, y) => x.dg - y.dg);
}

/** The lowest and highest Tm in the pool; degenerate oligos, which have no one Tm, are left out. */
export function tmSpread(
  oligos: readonly PoolOligo[],
  maxSpread: number = DEFAULT_MAX_TM_SPREAD,
): TmSpread | null {
  let low: { tm: number; name: string } | null = null;
  let high: { tm: number; name: string } | null = null;
  for (const o of oligos) {
    const tm = meltingTemperature(bases(o));
    if (Number.isNaN(tm)) continue;
    if (low === null || tm < low.tm) low = { tm, name: o.name };
    if (high === null || tm > high.tm) high = { tm, name: o.name };
  }
  if (low === null || high === null) return null;
  const spread = high.tm - low.tm;
  return {
    min: low.tm,
    max: high.tm,
    spread,
    lowest: low.name,
    highest: high.name,
    exceeds: spread > maxSpread,
  };
}

/** All the pool checks at once. */
export function checkPool(oligos: readonly PoolOligo[], options: PoolOptions = {}): PoolCheck {
  return {
    duplicateNames: duplicateNames(oligos),
    sameBases: sameBases(oligos),
    dimers: crossDimers(oligos, options.dimerDg),
    tm: tmSpread(oligos, options.maxTmSpread),
  };
}
