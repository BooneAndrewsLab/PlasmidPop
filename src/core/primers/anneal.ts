import { type Strand } from '../features';
import { type Range, type Topology } from '../range';
import { reverseComplement } from '../sequence';
import { meltingTemperature } from './thermo';

/**
 * Where a primer anneals when only part of it is meant to.
 *
 * `findPrimerBindingSites` (`primerDesign.ts`) asks whether the *whole*
 * primer matches, which is the right question for "is this oligo specific to
 * my plasmid". It is the wrong one for PCR: a cloning primer is a 3′ half
 * that anneals and a 5′ tail that does not — a restriction site, a Gibson
 * homology arm, a tag, a mutation. The tail matches nothing on the template
 * and is copied into the product all the same, which is the whole point of
 * it, and a search that insists on a full-length match cannot see such a
 * primer at all.
 *
 * So this walks *back from the 3′ end*, which is the end that matters: a
 * polymerase extends from there, and a mismatch under the last few bases
 * stops the reaction whatever the rest of the oligo does. Whatever is left
 * over at the 5′ end is the tail, reported rather than rejected.
 */
export interface AnnealingSite {
  /** The whole primer, cleaned: tail and annealing part together. */
  readonly primer: string;
  /** Bases of the template the 3′ part pairs with, unrolled forward coordinates. */
  readonly range: Range;
  /**
   * Which strand the primer lies along, and so which way it extends:
   * `forward` primes rightwards along the top strand, `reverse` leftwards.
   */
  readonly strand: Strand;
  /** How many of the primer's 3′ bases anneal; `range` is this long. */
  readonly annealLength: number;
  /** The 5′ bases that do not anneal, in the primer's own direction. */
  readonly tail: string;
  /** Mismatches inside the annealing part, outside the 3′ anchor. */
  readonly mismatches: number;
  /**
   * Melting temperature of the annealing part alone, which is what the first
   * cycle of a PCR sees — the tail is single-stranded until the second round,
   * when the product carries it. Mismatches are not modelled, so a site with
   * one reads a degree or two high.
   */
  readonly tm: number;
}

export interface AnnealOptions {
  /** Shortest 3′ match to call a site. */
  readonly minAnneal?: number;
  /** Mismatches tolerated inside the annealing part, outside the anchor. */
  readonly maxMismatches?: number;
  /** Bases at the 3′ end that must match exactly. */
  readonly exactThreePrime?: number;
}

export const ANNEAL_DEFAULTS: Required<AnnealOptions> = {
  minAnneal: 15,
  maxMismatches: 2,
  exactThreePrime: 5,
};

/**
 * The longest run from the 3′ end that pairs, or null where nothing does.
 * `probe` reads 3′ first: for a primer on the top strand that is the primer
 * reversed, for one on the bottom strand its reverse complement, so one walk
 * serves both.
 *
 * The run is trimmed back to a match, so a site never begins with a mismatch
 * hanging off its 5′ end: those bases are tail, which is what a tail is.
 */
function annealRun(
  probe: string,
  baseAt: (i: number) => string,
  anchor: number,
  step: number,
  opts: Required<AnnealOptions>,
): { readonly length: number; readonly mismatches: number } | null {
  let mismatches = 0;
  let best = 0;
  let bestMismatches = 0;
  for (let i = 0; i < probe.length; i++) {
    const base = baseAt(anchor + step * i);
    // Off the end of a linear template: the primer hangs over the tip, and
    // what it has matched so far is all there is.
    if (base === '') break;
    if (base === probe.charAt(i)) {
      best = i + 1;
      bestMismatches = mismatches;
      continue;
    }
    // A mismatch under the last few bases is not a weak site, it is no site:
    // the 3′ end has to be paired for the polymerase to extend it.
    if (i < opts.exactThreePrime) return null;
    if (++mismatches > opts.maxMismatches) break;
  }
  return best >= opts.minAnneal ? { length: best, mismatches: bestMismatches } : null;
}

/**
 * Every place `primer` would anneal by its 3′ end, on either strand. Sites
 * may wrap the origin of a circular template.
 */
export function findAnnealingSites(
  sequence: string,
  topology: Topology,
  primer: string,
  options: AnnealOptions = {},
): AnnealingSite[] {
  const opts = { ...ANNEAL_DEFAULTS, ...options };
  const p = primer.toUpperCase().replace(/[^ACGT]/g, '');
  const L = sequence.length;
  const n = p.length;
  if (n < opts.minAnneal || L === 0) return [];
  const text = sequence.toUpperCase();
  const circular = topology === 'circular';
  const baseAt = (i: number): string =>
    circular ? text.charAt(((i % L) + L) % L) : i < 0 || i >= L ? '' : text.charAt(i);
  const norm = (i: number): number => (circular ? ((i % L) + L) % L : i);

  const site = (
    range: Range,
    strand: Strand,
    run: { readonly length: number; readonly mismatches: number },
  ): AnnealingSite => ({
    primer: p,
    range,
    strand,
    annealLength: run.length,
    tail: p.slice(0, n - run.length),
    mismatches: run.mismatches,
    tm: meltingTemperature(p.slice(n - run.length)),
  });

  const out: AnnealingSite[] = [];
  // Top strand: the primer reads the same way the sequence does, so its 3′
  // base sits at `e - 1` and the match runs leftwards from there.
  let forward = '';
  for (let i = n - 1; i >= 0; i--) forward += p.charAt(i);
  for (let e = 1; e <= L; e++) {
    const run = annealRun(forward, baseAt, e - 1, -1, opts);
    if (run === null) continue;
    const start = norm(e - run.length);
    out.push(site({ start, end: start + run.length }, 'forward', run));
  }
  // Bottom strand: the primer's reverse complement matches the top strand,
  // and its 3′ base is that probe's *first* one, so the match runs rightwards.
  const reverse = reverseComplement(p);
  for (let s = 0; s < L; s++) {
    const run = annealRun(reverse, baseAt, s, 1, opts);
    if (run === null) continue;
    out.push(site({ start: norm(s), end: norm(s) + run.length }, 'reverse', run));
  }
  out.sort((a, b) => a.range.start - b.range.start || a.strand.localeCompare(b.strand));
  return out;
}
