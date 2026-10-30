import { type Strand } from '../features';
import { type Range, type Topology, rangePieces } from '../range';
import { reverseComplement } from '../sequence';
import { IUPAC_SETS } from '../analysis/codons';
import {
  type AnnealIndex,
  buildAnnealIndex,
  cleanPrimer,
  findAnnealingSites,
  pairsWithCode,
} from './anneal';
import { DEFAULT_PRIMER_CRITERIA, type PrimerCriteria } from './criteria';
import {
  gcFraction,
  longestHomopolymer,
  meltingTemperature,
  threePrimeComplementarity,
} from './thermo';
import { dimerEnergy, hairpinEnergy, hairpinTm, selfDimerEnergy } from './structure';

export interface PrimerReport {
  readonly sequence: string;
  readonly length: number;
  readonly tm: number;
  readonly gc: number;
  readonly homopolymer: number;
  /** ΔG of its best self-dimer, kcal/mol, 0 or less (`selfDimerEnergy`). */
  readonly selfDimerDg: number;
  /** ΔG of its best hairpin, kcal/mol, 0 or less (`hairpinEnergy`). */
  readonly hairpinDg: number;
  /** Melting temperature of that hairpin, °C; 0 when it has none (`hairpinTm`). */
  readonly hairpinTm: number;
  /** Bases at its 3′ end that pair with itself (`threePrimeComplementarity`). */
  readonly threePrimeSelf: number;
  /** Ends in G or C (a "GC clamp"). */
  readonly gcClamp: boolean;
  /**
   * Ambiguity codes in the primer (#76). A degenerate primer is a mix of
   * molecules, so its Tm and GC content are ranges over the mix; `tm` is NaN
   * for one and `gc` counts only the bases every molecule shares.
   */
  readonly degenerate: number;
  /** How many molecules the mix holds; 1 for a plain primer. */
  readonly molecules: number;
  /**
   * Lowest and highest Tm over the mix, or null for a plain primer and for
   * one too degenerate to list (more than `MAX_MOLECULES` molecules).
   */
  readonly tmRange: { readonly min: number; readonly max: number } | null;
  /** Lowest and highest GC fraction over the mix; both `gc` for a plain primer. */
  readonly gcRange: { readonly min: number; readonly max: number };
  readonly warnings: readonly string[];
}

/** Molecules of a degenerate primer listed for its Tm range; 4,096 is N⁶. */
export const MAX_MOLECULES = 4096;

/** Every molecule a degenerate primer stands for, or null past `limit`. */
function molecules(seq: string, limit: number): string[] | null {
  let out = [''];
  for (const code of seq) {
    const bases = IUPAC_SETS[code] ?? [code];
    if (out.length * bases.length > limit) return null;
    out = out.flatMap((prefix) => bases.map((b) => prefix + b));
  }
  return out;
}

/** A ΔG as the reports show it: one decimal, a true minus sign. */
export function formatDg(x: number): string {
  const r = Math.round(x * 10) / 10;
  return r === 0 ? '0.0' : r.toFixed(1).replace('-', '−');
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
  // Codes kept in place (#76): dropping one would measure an oligo nobody
  // ordered, its neighbours joined up.
  const seq = cleanPrimer(sequence);
  const degenerate = Array.from(seq).filter((b) => !'ACGT'.includes(b)).length;
  const count = Array.from(seq).reduce((n, b) => n * (IUPAC_SETS[b]?.length ?? 1), 1);
  const mix = degenerate === 0 ? null : molecules(seq, MAX_MOLECULES);
  const tms = mix?.map((m) => meltingTemperature(m)) ?? [];
  const tmRange = mix === null ? null : { min: Math.min(...tms), max: Math.max(...tms) };
  const tm = degenerate === 0 ? meltingTemperature(seq) : NaN;
  const gc = gcFraction(seq);
  // Exact without listing the mix: each position holds a G or C in the
  // fewest molecules when none of its bases is one, in the most when any is.
  const gcRange =
    seq.length === 0
      ? { min: 0, max: 0 }
      : {
          min:
            Array.from(seq).filter((b) =>
              (IUPAC_SETS[b] ?? []).every((x) => x === 'G' || x === 'C'),
            ).length / seq.length,
          max:
            Array.from(seq).filter((b) => (IUPAC_SETS[b] ?? []).some((x) => x === 'G' || x === 'C'))
              .length / seq.length,
        };
  const homopolymer = longestHomopolymer(seq);
  const selfDimerDg = selfDimerEnergy(seq);
  const hairpinDg = hairpinEnergy(seq);
  const hairpinMelt = hairpinTm(seq);
  const threePrimeSelf = threePrimeComplementarity(seq, seq);
  const last = seq.charAt(seq.length - 1);
  // S is G or C, so a clamp whichever molecule of the mix it is.
  const gcClamp = last === 'G' || last === 'C' || last === 'S';
  const warnings: string[] = [];
  if (seq.length < c.minLength) warnings.push(`Shorter than ${c.minLength} bases`);
  if (seq.length > c.maxLength) warnings.push(`Longer than ${c.maxLength} bases`);
  // A mix is out of bounds when all of it is, and worth a word when part is.
  const tmLow = degenerate === 0 ? tm : (tmRange?.min ?? NaN);
  const tmHigh = degenerate === 0 ? tm : (tmRange?.max ?? NaN);
  if (degenerate > 0 && tmRange === null) {
    warnings.push(`Too degenerate to give a Tm: ${count.toLocaleString()} molecules`);
  }
  if (!Number.isNaN(tmHigh) && tmHigh < c.minTm) warnings.push(`Tm below ${c.minTm} °C`);
  else if (!Number.isNaN(tmLow) && tmLow < c.minTm) {
    warnings.push(`Part of the mix has a Tm below ${c.minTm} °C`);
  }
  if (tmLow > c.maxTm) warnings.push(`Tm above ${c.maxTm} °C`);
  else if (tmHigh > c.maxTm) warnings.push(`Part of the mix has a Tm above ${c.maxTm} °C`);
  if (gcRange.max < c.minGc) warnings.push(`GC content below ${pct(c.minGc)}`);
  else if (gcRange.min < c.minGc) {
    warnings.push(`Part of the mix has GC content below ${pct(c.minGc)}`);
  }
  if (gcRange.min > c.maxGc) warnings.push(`GC content above ${pct(c.maxGc)}`);
  else if (gcRange.max > c.maxGc) {
    warnings.push(`Part of the mix has GC content above ${pct(c.maxGc)}`);
  }
  if (homopolymer > c.maxHomopolymer) warnings.push(`Run of ${homopolymer} identical bases`);
  if (hairpinDg <= c.hairpinDg) warnings.push(`Hairpin, ΔG ${formatDg(hairpinDg)} kcal/mol`);
  if (hairpinMelt > c.hairpinTm) {
    warnings.push(`Hairpin melts at ${Math.round(hairpinMelt)} °C, above ${c.hairpinTm} °C`);
  }
  if (selfDimerDg <= c.dimerDg) warnings.push(`Self-dimer, ΔG ${formatDg(selfDimerDg)} kcal/mol`);
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
    selfDimerDg,
    hairpinDg,
    hairpinTm: hairpinMelt,
    threePrimeSelf,
    gcClamp,
    degenerate,
    molecules: count,
    tmRange,
    gcRange,
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
  /** ΔG of the best dimer the two primers make, kcal/mol, 0 or less. */
  readonly crossDimerDg: number;
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

/**
 * Null when the candidate breaks a criterion, else how far it is from ideal.
 * Exported for the clone-check designer (item 120), which enumerates its
 * own candidates around a junction and judges them by this same rule.
 */
export function candidatePenalty(report: PrimerReport, c: PrimerCriteria): number | null {
  if (Number.isNaN(report.tm) || report.tm < c.minTm || report.tm > c.maxTm) return null;
  if (report.gc < c.minGc || report.gc > c.maxGc) return null;
  if (report.homopolymer > c.maxHomopolymer) return null;
  if (report.hairpinDg <= c.hairpinDg) return null;
  if (report.hairpinTm > c.hairpinTm) return null;
  if (report.selfDimerDg <= c.dimerDg) return null;
  if (report.threePrimeSelf > c.maxThreePrime) return null;
  if (c.requireGcClamp && !report.gcClamp) return null;
  const idealTm = (c.minTm + c.maxTm) / 2;
  const idealGc = (c.minGc + c.maxGc) / 2;
  const idealLength = Math.min(c.maxLength, Math.max(c.minLength, 21));
  let penalty = Math.abs(report.tm - idealTm);
  penalty += Math.abs(report.gc - idealGc) * 10;
  if (!report.gcClamp) penalty += 1.5;
  // Half a point per kcal/mol of hairpin and a quarter per kcal/mol of
  // self-dimer: a primer at its limit costs what a 4 bp stem (-2) or a
  // 6 bp self-complementary stretch (-6) did under the stem heuristics.
  penalty += -report.selfDimerDg * 0.25;
  penalty += -report.hairpinDg * 0.5;
  penalty += report.threePrimeSelf * 0.3;
  penalty += Math.abs(report.length - idealLength) * 0.1;
  return penalty;
}

/**
 * Whether a stretch already breaks Tm, GC or the base run, which is cheap to
 * tell and rules most of a window out before the free-energy scans (item
 * 123) are paid for. The same tests as `candidatePenalty`'s first lines.
 */
function failsBasics(bases: string, c: PrimerCriteria): boolean {
  const seq = cleanPrimer(bases);
  const gc = gcFraction(seq);
  if (gc < c.minGc || gc > c.maxGc) return true;
  if (longestHomopolymer(seq) > c.maxHomopolymer) return true;
  const tm = meltingTemperature(seq);
  return !(tm >= c.minTm && tm <= c.maxTm);
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

/** The last template `annealsElsewhere` indexed: a design asks about hundreds of primers on one. */
let indexed: AnnealIndex | null = null;

function annealIndex(sequence: string, topology: Topology): AnnealIndex | null {
  if (indexed?.sequence !== sequence || indexed.topology !== topology) {
    indexed = buildAnnealIndex(sequence, topology);
  }
  return indexed;
}

/**
 * Whether a primer anneals anywhere but at `own` on `strand`: by the whole
 * -primer rule (`findPrimerBindingSites`) or by the rule `pcr` primes with
 * (`findAnnealingSites`: the 3' end, at least 15 bases, two mismatches), so
 * a primer that only part-anneals at a second site, and would draw a second
 * band, is not called specific (#351). Sites are told apart by the 3' end,
 * the base a polymerase extends from.
 */
export function annealsElsewhere(
  sequence: string,
  topology: Topology,
  primer: string,
  strand: Strand,
  own: Range,
): boolean {
  const L = sequence.length;
  const norm = (x: number): number => ((x % L) + L) % L;
  // Position of the 3' end in forward coordinates, wrapped on a circle.
  const threePrime = (r: Range, s: Strand): number => norm(s === 'forward' ? r.end : r.start);
  const ownEnd = threePrime(own, strand);
  const wholeElsewhere = findPrimerBindingSites(sequence, topology, primer).some(
    (b) => b.strand !== strand || threePrime(b.range, b.strand) !== ownEnd,
  );
  if (wholeElsewhere) return true;
  return findAnnealingSites(sequence, topology, primer, {}, annealIndex(sequence, topology)).some(
    (b) => b.strand !== strand || threePrime(b.range, b.strand) !== ownEnd,
  );
}

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
    if (annealsElsewhere(sequence, topology, cand.report.sequence, strand, cand.site)) continue;
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
      const bases = basesAt(text, site, L);
      if (failsBasics(bases, c)) continue;
      const report = analyzePrimer(bases, c);
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
      const bases = reverseComplement(basesAt(text, site, L));
      if (failsBasics(bases, c)) continue;
      const report = analyzePrimer(bases, c);
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
      const crossDimerDg = dimerEnergy(f.report.sequence, r.report.sequence);
      if (crossDimerDg <= c.dimerDg) continue;
      pairs.push({
        forward: f.report,
        reverse: r.report,
        forwardSite: f.site,
        reverseSite: r.site,
        productLength,
        tmDifference,
        crossDimer,
        crossDimerDg,
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

/**
 * The two primers that amplify exactly `insert`, nothing before or after
 * it: the forward one starts at its first base and the reverse one ends at
 * its last. What a tailed primer for cloning wants (item 108): the tail
 * carries the site, and the annealing part must begin where the insert
 * does, so only its length is free.
 */
export interface AnchoredPair {
  readonly forward: PrimerReport;
  readonly reverse: PrimerReport;
  readonly tmDifference: number;
  readonly crossDimer: number;
  /** As `PrimerPair.crossDimerDg`. */
  readonly crossDimerDg: number;
  /** As `PrimerPair.penalty`; meaningless when `withinCriteria` is false. */
  readonly penalty: number;
  /**
   * Whether both primers meet every criterion and pair within the Tm
   * difference. When nothing does, the pair is the least bad one, and each
   * report's `warnings` say what it breaks.
   */
  readonly withinCriteria: boolean;
}

/**
 * Designs `AnchoredPair` for `insert` (5′→3′, the strand the forward primer
 * copies), judging each length of either end by the designer's own
 * criteria and penalty and each pairing by its rules, so a tailed cloning
 * primer is held to what a plain one is. Neither annealing part grows past
 * half the insert, since two that overlap are not an amplicon (`pcr`).
 * Null when the insert is too short for two primers of `minLength`.
 * Specificity (`requireSpecific`) is not judged here: the template the
 * primers run on is the caller's to check.
 */
export function designAnchoredPrimers(
  insert: string,
  options: Partial<PrimerCriteria> = {},
): AnchoredPair | null {
  const c: PrimerCriteria = { ...DEFAULT_PRIMER_CRITERIA, ...options };
  const text = insert.toUpperCase();
  const longest = Math.min(c.maxLength, Math.floor(text.length / 2));
  if (longest < c.minLength) return null;
  interface Anchored {
    readonly report: PrimerReport;
    readonly penalty: number | null;
  }
  const ends = (read: (n: number) => string): Anchored[] => {
    const out: Anchored[] = [];
    for (let n = c.minLength; n <= longest; n++) {
      const report = analyzePrimer(read(n), c);
      out.push({ report, penalty: candidatePenalty(report, c) });
    }
    return out;
  };
  const forwards = ends((n) => text.slice(0, n));
  const reverses = ends((n) => reverseComplement(text.slice(text.length - n)));
  const dimer = (f: PrimerReport, r: PrimerReport): number =>
    Math.max(
      threePrimeComplementarity(f.sequence, r.sequence),
      threePrimeComplementarity(r.sequence, f.sequence),
    );

  let best: AnchoredPair | null = null;
  for (const f of forwards) {
    for (const r of reverses) {
      if (f.penalty === null || r.penalty === null) continue;
      const tmDifference = Math.abs(f.report.tm - r.report.tm);
      if (tmDifference > c.maxTmDifference) continue;
      const crossDimer = dimer(f.report, r.report);
      if (crossDimer > c.maxThreePrime) continue;
      const crossDimerDg = dimerEnergy(f.report.sequence, r.report.sequence);
      if (crossDimerDg <= c.dimerDg) continue;
      const penalty = f.penalty + r.penalty + tmDifference + crossDimer * 0.3;
      if (best === null || penalty < best.penalty) {
        best = {
          forward: f.report,
          reverse: r.report,
          tmDifference,
          crossDimer,
          crossDimerDg,
          penalty,
          withinCriteria: true,
        };
      }
    }
  }
  if (best !== null) return best;

  // Nothing passes: the least bad end on each side, judged by how many
  // criteria it breaks and then by its distance from the middle of the Tm
  // range, which is what a user relaxing the settings would look at first.
  const idealTm = (c.minTm + c.maxTm) / 2;
  const tmDistance = (r: PrimerReport): number =>
    Number.isNaN(r.tm) ? Infinity : Math.abs(r.tm - idealTm);
  const leastBad = (list: readonly Anchored[]): PrimerReport | undefined =>
    [...list].sort(
      (a, b) =>
        a.report.warnings.length - b.report.warnings.length ||
        tmDistance(a.report) - tmDistance(b.report),
    )[0]?.report;
  const forward = leastBad(forwards);
  const reverse = leastBad(reverses);
  // Both lists hold at least the `minLength` candidate.
  if (forward === undefined || reverse === undefined) return null;
  return {
    forward,
    reverse,
    tmDifference: Math.abs(forward.tm - reverse.tm),
    crossDimer: dimer(forward, reverse),
    crossDimerDg: dimerEnergy(forward.sequence, reverse.sequence),
    penalty: Infinity,
    withinCriteria: false,
  };
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
  // Codes kept in place, and paired as PCR pairs them (#76).
  const p = cleanPrimer(primer);
  const L = sequence.length;
  const n = p.length;
  if (n === 0 || L === 0 || n > L) return [];
  const text = sequence.toUpperCase();
  const scan = topology === 'circular' ? text + text.slice(0, n - 1) : text;
  const out: BindingSite[] = [];

  const search = (probe: string, strand: Strand): void => {
    // The probe's codes once, and which of its bases are plain (an exact
    // match is then a code comparison; only a mismatch or an ambiguity
    // code asks `pairsWithCode`). The 3′ anchor is visited first: it must
    // match exactly, so nearly every position is refused on its first
    // base rather than after walking to the third mismatch.
    const codes = Array.from(probe, (b) => b.charCodeAt(0));
    const plain = Array.from(probe, (b) => 'ACGT'.includes(b));
    const order = Array.from({ length: n }, (_, k) => (strand === 'forward' ? n - 1 - k : k));
    for (let s = 0; s + n <= scan.length; s++) {
      let mismatches = 0;
      let ok = true;
      for (const i of order) {
        if (scan.charCodeAt(s + i) === codes[i] && plain[i] === true) continue;
        if (pairsWithCode(scan.charAt(s + i), probe.charAt(i))) continue;
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
