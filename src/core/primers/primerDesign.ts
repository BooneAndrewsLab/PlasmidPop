import { type Strand } from '../features';
import { type Range, type Topology, rangePieces } from '../range';
import { reverseComplement } from '../sequence';
import {
  gcFraction,
  longestHomopolymer,
  maxSelfComplementarity,
  meltingTemperature,
} from './thermo';

export interface PrimerReport {
  readonly sequence: string;
  readonly length: number;
  readonly tm: number;
  readonly gc: number;
  readonly homopolymer: number;
  readonly selfComplementarity: number;
  /** Ends in G or C (a "GC clamp"). */
  readonly gcClamp: boolean;
  readonly warnings: readonly string[];
}

export function analyzePrimer(sequence: string): PrimerReport {
  const seq = sequence.toUpperCase().replace(/[^ACGTU]/g, '');
  const tm = meltingTemperature(seq);
  const gc = gcFraction(seq);
  const homopolymer = longestHomopolymer(seq);
  const selfComplementarity = maxSelfComplementarity(seq);
  const last = seq.charAt(seq.length - 1);
  const gcClamp = last === 'G' || last === 'C';
  const warnings: string[] = [];
  if (seq.length < 18) warnings.push('Shorter than 18 bases');
  if (seq.length > 30) warnings.push('Longer than 30 bases');
  if (!Number.isNaN(tm) && tm < 52) warnings.push('Low melting temperature');
  if (tm > 65) warnings.push('High melting temperature');
  if (gc < 0.4) warnings.push('GC content below 40%');
  if (gc > 0.6) warnings.push('GC content above 60%');
  if (homopolymer >= 5) warnings.push(`Run of ${homopolymer} identical bases`);
  if (selfComplementarity >= 6) warnings.push('Self-complementary stretch of 6+ bases');
  if (!gcClamp) warnings.push('No GC clamp at the 3′ end');
  return {
    sequence: seq,
    length: seq.length,
    tm,
    gc,
    homopolymer,
    selfComplementarity,
    gcClamp,
    warnings,
  };
}

export interface DesignOptions {
  readonly minLength?: number; // default 18
  readonly maxLength?: number; // default 27
  readonly minTm?: number; // default 55
  readonly maxTm?: number; // default 65
  readonly maxTmDifference?: number; // default 3
  /** How far outside the target each primer may start (bp). Default 200. */
  readonly searchWindow?: number;
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

function candidatePenalty(report: PrimerReport, opts: Required<DesignOptions>): number | null {
  if (Number.isNaN(report.tm) || report.tm < opts.minTm || report.tm > opts.maxTm) return null;
  if (report.gc < 0.35 || report.gc > 0.65) return null;
  if (report.homopolymer >= 5 || report.selfComplementarity >= 7) return null;
  const idealTm = (opts.minTm + opts.maxTm) / 2;
  let penalty = Math.abs(report.tm - idealTm);
  penalty += Math.abs(report.gc - 0.5) * 10;
  if (!report.gcClamp) penalty += 1.5;
  penalty += Math.max(0, report.selfComplementarity - 3) * 0.5;
  penalty += Math.abs(report.length - 21) * 0.1;
  return penalty;
}

/**
 * Designs PCR primer pairs flanking `target`: forward primers whose 3' end
 * lies at or before the target start and reverse primers (on the bottom
 * strand) whose 3' end lies at or after the target end. Pairs are ranked by
 * a penalty combining Tm distance from the middle of the window, GC
 * balance, clamp, self-complementarity and Tm mismatch.
 */
export function designPrimers(
  sequence: string,
  topology: Topology,
  target: Range,
  options: DesignOptions = {},
): PrimerPair[] {
  const opts: Required<DesignOptions> = {
    minLength: options.minLength ?? 18,
    maxLength: options.maxLength ?? 27,
    minTm: options.minTm ?? 55,
    maxTm: options.maxTm ?? 65,
    maxTmDifference: options.maxTmDifference ?? 3,
    searchWindow: options.searchWindow ?? 200,
    maxPairs: options.maxPairs ?? 10,
  };
  const L = sequence.length;
  const text = sequence.toUpperCase();
  if (L === 0 || target.end <= target.start) return [];
  const circular = topology === 'circular';
  const norm = (p: number): number => (circular ? ((p % L) + L) % L : p);

  const forwards: Candidate[] = [];
  // Forward primer 3' end at position e (exclusive) with e in [target.start - window, target.start].
  for (let e = target.start; e >= target.start - opts.searchWindow; e--) {
    if (!circular && e < opts.minLength) break;
    for (let len = opts.minLength; len <= opts.maxLength; len++) {
      const s = e - len;
      if (!circular && s < 0) break;
      const site = { start: norm(s), end: norm(s) + len };
      if (site.end > L + site.start) continue;
      const report = analyzePrimer(basesAt(text, site, L));
      const penalty = candidatePenalty(report, opts);
      if (penalty !== null) forwards.push({ report, site, penalty });
    }
  }
  const reverses: Candidate[] = [];
  // Reverse primer anneals to the top strand at [s, s+len) with s >= target.end; its 3' end is at s.
  for (let s = target.end; s <= target.end + opts.searchWindow; s++) {
    if (!circular && s >= L) break;
    for (let len = opts.minLength; len <= opts.maxLength; len++) {
      if (!circular && s + len > L) break;
      const site = { start: norm(s), end: norm(s) + len };
      const report = analyzePrimer(reverseComplement(basesAt(text, site, L)));
      const penalty = candidatePenalty(report, opts);
      if (penalty !== null) reverses.push({ report, site, penalty });
    }
  }
  forwards.sort((a, b) => a.penalty - b.penalty);
  reverses.sort((a, b) => a.penalty - b.penalty);

  const pairs: PrimerPair[] = [];
  for (const f of forwards.slice(0, 40)) {
    for (const r of reverses.slice(0, 40)) {
      const tmDifference = Math.abs(f.report.tm - r.report.tm);
      if (tmDifference > opts.maxTmDifference) continue;
      let productLength = r.site.end - f.site.start;
      if (circular && productLength <= 0) productLength += L;
      if (productLength <= 0) continue;
      pairs.push({
        forward: f.report,
        reverse: r.report,
        forwardSite: f.site,
        reverseSite: r.site,
        productLength,
        tmDifference,
        penalty: f.penalty + r.penalty + tmDifference,
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
    if (out.length >= opts.maxPairs) break;
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
