import { type Strand } from '../features';
import { type Range, type Topology, rangePieces } from '../range';
import { reverseComplement } from '../sequence';
import { DEFAULT_PRIMER_CRITERIA, type PrimerCriteria } from './criteria';
import {
  gcFraction,
  longestHairpinStem,
  longestHomopolymer,
  maxSelfComplementarity,
  meltingTemperature,
  threePrimeComplementarity,
} from './thermo';

export interface PrimerReport {
  readonly sequence: string;
  readonly length: number;
  readonly tm: number;
  readonly gc: number;
  readonly homopolymer: number;
  readonly selfComplementarity: number;
  /** Longest stem it can fold into (`longestHairpinStem`). */
  readonly hairpin: number;
  /** Bases at its 3′ end that pair with itself (`threePrimeComplementarity`). */
  readonly threePrimeSelf: number;
  /** Ends in G or C (a "GC clamp"). */
  readonly gcClamp: boolean;
  readonly warnings: readonly string[];
}

function pct(x: number): string {
  return `${Math.round(x * 100)}%`;
}

/**
 * Measures a primer and names every criterion it breaks. The criteria are
 * the designer's own, so a pasted primer is judged by the rules the designed
 * ones had to pass.
 */
export function analyzePrimer(
  sequence: string,
  criteria: PrimerCriteria = DEFAULT_PRIMER_CRITERIA,
): PrimerReport {
  const c = criteria;
  const seq = sequence.toUpperCase().replace(/[^ACGTU]/g, '');
  const tm = meltingTemperature(seq);
  const gc = gcFraction(seq);
  const homopolymer = longestHomopolymer(seq);
  const selfComplementarity = maxSelfComplementarity(seq);
  const hairpin = longestHairpinStem(seq);
  const threePrimeSelf = threePrimeComplementarity(seq, seq);
  const last = seq.charAt(seq.length - 1);
  const gcClamp = last === 'G' || last === 'C';
  const warnings: string[] = [];
  if (seq.length < c.minLength) warnings.push(`Shorter than ${c.minLength} bases`);
  if (seq.length > c.maxLength) warnings.push(`Longer than ${c.maxLength} bases`);
  if (!Number.isNaN(tm) && tm < c.minTm) warnings.push(`Tm below ${c.minTm} °C`);
  if (tm > c.maxTm) warnings.push(`Tm above ${c.maxTm} °C`);
  if (gc < c.minGc) warnings.push(`GC content below ${pct(c.minGc)}`);
  if (gc > c.maxGc) warnings.push(`GC content above ${pct(c.maxGc)}`);
  if (homopolymer > c.maxHomopolymer) warnings.push(`Run of ${homopolymer} identical bases`);
  if (hairpin > c.maxHairpin) warnings.push(`Hairpin with a ${hairpin} bp stem`);
  if (selfComplementarity > c.maxSelfComplementarity) {
    warnings.push(`Self-complementary stretch of ${selfComplementarity} bases`);
  }
  if (threePrimeSelf > c.maxThreePrime) {
    warnings.push(`3′ end pairs with itself over ${threePrimeSelf} bases`);
  }
  if (!gcClamp) warnings.push('No GC clamp at the 3′ end');
  return {
    sequence: seq,
    length: seq.length,
    tm,
    gc,
    homopolymer,
    selfComplementarity,
    hairpin,
    threePrimeSelf,
    gcClamp,
    warnings,
  };
}

export interface DesignOptions extends Partial<PrimerCriteria> {
  readonly maxPairs?: number; // default 10
}

export interface PrimerPair {
  readonly forward: PrimerReport;
  readonly reverse: PrimerReport;
  /** Where the forward primer anneals, forward coordinates (unrolled). */
  readonly forwardSite: Range;
  readonly reverseSite: Range;
  readonly productLength: number;
  readonly tmDifference: number;
  /** Longest stretch at either primer's 3′ end that pairs with the other one. */
  readonly crossDimer: number;
  /** Lower is better. */
  readonly penalty: number;
}

interface Candidate {
  readonly report: PrimerReport;
  readonly site: Range;
  readonly penalty: number;
}

function basesAt(text: string, r: Range, seqLength: number): string {
  return rangePieces(r, seqLength)
    .map((p) => text.slice(p.start, p.end))
    .join('');
}

/** Null when the candidate breaks a criterion, else how far it is from ideal. */
function candidatePenalty(report: PrimerReport, c: PrimerCriteria): number | null {
  if (Number.isNaN(report.tm) || report.tm < c.minTm || report.tm > c.maxTm) return null;
  if (report.gc < c.minGc || report.gc > c.maxGc) return null;
  if (report.homopolymer > c.maxHomopolymer) return null;
  if (report.hairpin > c.maxHairpin) return null;
  if (report.selfComplementarity > c.maxSelfComplementarity) return null;
  if (report.threePrimeSelf > c.maxThreePrime) return null;
  if (c.requireGcClamp && !report.gcClamp) return null;
  const idealTm = (c.minTm + c.maxTm) / 2;
  const idealGc = (c.minGc + c.maxGc) / 2;
  const idealLength = Math.min(c.maxLength, Math.max(c.minLength, 21));
  let penalty = Math.abs(report.tm - idealTm);
  penalty += Math.abs(report.gc - idealGc) * 10;
  if (!report.gcClamp) penalty += 1.5;
  penalty += Math.max(0, report.selfComplementarity - 3) * 0.5;
  penalty += Math.max(0, report.hairpin - 2) * 0.5;
  penalty += report.threePrimeSelf * 0.3;
  penalty += Math.abs(report.length - idealLength) * 0.1;
  return penalty;
}

/** How many of each primer, best first, go on to be paired. */
const SHORTLIST = 40;
/**
 * How many candidates the specificity check may look at before giving up on
 * filling the shortlist. It is a scan of the whole template per candidate,
 * so on a repetitive template that is short of specific primers it is this
 * rather than the candidate count that bounds the time.
 */
const MAX_SPECIFICITY_CHECKS = 400;

/**
 * The best candidates, and with `specific` only those that anneal nowhere
 * but their own site. Checked in penalty order and only until the list is
 * full, because the check scans the whole template: most candidates never
 * need it.
 */
function shortlist(
  candidates: readonly Candidate[],
  strand: Strand,
  sequence: string,
  topology: Topology,
  specific: boolean,
): Candidate[] {
  if (!specific) return candidates.slice(0, SHORTLIST);
  const out: Candidate[] = [];
  for (let i = 0; i < candidates.length && i < MAX_SPECIFICITY_CHECKS; i++) {
    const cand = candidates[i];
    if (cand === undefined) break;
    const sites = findPrimerBindingSites(sequence, topology, cand.report.sequence);
    const elsewhere = sites.some((b) => b.strand !== strand || b.range.start !== cand.site.start);
    if (elsewhere) continue;
    out.push(cand);
    if (out.length >= SHORTLIST) break;
  }
  return out;
}

/**
 * Designs PCR primer pairs flanking `target`: forward primers lying within
 * `forwardRegion` of the target start and reverse primers (on the bottom
 * strand) within `reverseRegion` of its end. Every candidate must meet the
 * criteria — including, with `requireSpecific`, annealing nowhere else on
 * the template — and a pair must also match in Tm, give a product in the
 * size range and not pair at a 3′ end with its partner. Pairs are ranked by a penalty combining Tm distance from the
 * middle of the range, GC balance, clamp, self-complementarity, hairpins and
 * Tm mismatch.
 */
export function designPrimers(
  sequence: string,
  topology: Topology,
  target: Range,
  options: DesignOptions = {},
): PrimerPair[] {
  const { maxPairs = 10, ...given } = options;
  const c: PrimerCriteria = { ...DEFAULT_PRIMER_CRITERIA, ...given };
  const L = sequence.length;
  const text = sequence.toUpperCase();
  if (L === 0 || target.end <= target.start) return [];
  const circular = topology === 'circular';
  const norm = (p: number): number => (circular ? ((p % L) + L) % L : p);
  // On a circle a region wider than the molecule would meet itself.
  const span = (r: { near: number; far: number }): number => Math.min(r.far - r.near, L);

  const forwards: Candidate[] = [];
  // Forward primers lie within [start - far, start - near); the 3' end is
  // the right-hand end of the site.
  const fLo = target.start - c.forwardRegion.near - span(c.forwardRegion);
  const fHi = target.start - c.forwardRegion.near;
  for (let e = fHi; e - c.minLength >= fLo; e--) {
    if (!circular && e > L) continue;
    if (!circular && e < c.minLength) break;
    for (let len = c.minLength; len <= c.maxLength; len++) {
      const s = e - len;
      if (s < fLo || (!circular && s < 0)) break;
      const site = { start: norm(s), end: norm(s) + len };
      const report = analyzePrimer(basesAt(text, site, L), c);
      const penalty = candidatePenalty(report, c);
      if (penalty !== null) forwards.push({ report, site, penalty });
    }
  }
  const reverses: Candidate[] = [];
  // Reverse primers anneal to the top strand within [end + near, end + far);
  // the 3' end is the left-hand end of the site.
  const rLo = target.end + c.reverseRegion.near;
  const rHi = rLo + span(c.reverseRegion);
  for (let s = rLo; s + c.minLength <= rHi; s++) {
    if (!circular && s < 0) continue;
    for (let len = c.minLength; len <= c.maxLength; len++) {
      if (s + len > rHi || (!circular && s + len > L)) break;
      const site = { start: norm(s), end: norm(s) + len };
      const report = analyzePrimer(reverseComplement(basesAt(text, site, L)), c);
      const penalty = candidatePenalty(report, c);
      if (penalty !== null) reverses.push({ report, site, penalty });
    }
  }
  forwards.sort((a, b) => a.penalty - b.penalty);
  reverses.sort((a, b) => a.penalty - b.penalty);
  const bestForwards = shortlist(forwards, 'forward', sequence, topology, c.requireSpecific);
  const bestReverses = shortlist(reverses, 'reverse', sequence, topology, c.requireSpecific);

  const pairs: PrimerPair[] = [];
  for (const f of bestForwards) {
    for (const r of bestReverses) {
      const tmDifference = Math.abs(f.report.tm - r.report.tm);
      if (tmDifference > c.maxTmDifference) continue;
      let productLength = r.site.end - f.site.start;
      if (circular && productLength <= 0) productLength += L;
      // Primers that overlap past each other amplify nothing.
      if (productLength < Math.max(f.report.length, r.report.length)) continue;
      if (circular && productLength > L) continue;
      if (productLength < c.minProduct || productLength > c.maxProduct) continue;
      const crossDimer = Math.max(
        threePrimeComplementarity(f.report.sequence, r.report.sequence),
        threePrimeComplementarity(r.report.sequence, f.report.sequence),
      );
      if (crossDimer > c.maxThreePrime) continue;
      pairs.push({
        forward: f.report,
        reverse: r.report,
        forwardSite: f.site,
        reverseSite: r.site,
        productLength,
        tmDifference,
        crossDimer,
        penalty: f.penalty + r.penalty + tmDifference + crossDimer * 0.3,
      });
    }
  }
  pairs.sort((a, b) => a.penalty - b.penalty);
  // Avoid near-duplicate pairs (same forward with several reverses etc.).
  const seen = new Set<string>();
  const out: PrimerPair[] = [];
  for (const p of pairs) {
    const key = `${p.forwardSite.start}-${p.reverseSite.end}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(p);
    if (out.length >= maxPairs) break;
  }
  return out;
}

export interface BindingSite {
  /** Bases the primer anneals to, forward coordinates (unrolled). */
  readonly range: Range;
  readonly strand: Strand;
  readonly mismatches: number;
}

export interface BindingOptions {
  /** Mismatches tolerated outside the 3' anchor. Default 2. */
  readonly maxMismatches?: number;
  /** Bases at the 3' end that must match exactly. Default 5. */
  readonly exactThreePrime?: number;
}

/**
 * Where a primer would anneal on either strand: the 3' end must match
 * exactly for `exactThreePrime` bases and the rest may carry up to
 * `maxMismatches` mismatches. Sites may wrap on circular molecules.
 */
export function findPrimerBindingSites(
  sequence: string,
  topology: Topology,
  primer: string,
  options: BindingOptions = {},
): BindingSite[] {
  const maxMismatches = options.maxMismatches ?? 2;
  const anchor = options.exactThreePrime ?? 5;
  const p = primer.toUpperCase().replace(/[^ACGT]/g, '');
  const L = sequence.length;
  const n = p.length;
  if (n === 0 || L === 0 || n > L) return [];
  const text = sequence.toUpperCase();
  const scan = topology === 'circular' ? text + text.slice(0, n - 1) : text;
  const out: BindingSite[] = [];

  const search = (probe: string, strand: Strand): void => {
    for (let s = 0; s + n <= scan.length; s++) {
      let mismatches = 0;
      let ok = true;
      for (let i = 0; i < n; i++) {
        if (scan.charCodeAt(s + i) === probe.charCodeAt(i)) continue;
        // For a forward primer the 3' end is the right end of the probe; for a
        // reverse primer (probe = its reverse complement) it is the left end.
        const fromThreePrime = strand === 'forward' ? n - 1 - i : i;
        if (fromThreePrime < anchor || ++mismatches > maxMismatches) {
          ok = false;
          break;
        }
      }
      if (ok) out.push({ range: { start: s, end: s + n }, strand, mismatches });
    }
  };
  search(p, 'forward');
  search(reverseComplement(p), 'reverse');
  out.sort((a, b) => a.range.start - b.range.start);
  return out;
}
