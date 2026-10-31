import { SeqDocument } from '../document';
import { type Strand } from '../features';
import {
  type AnnealingSite,
  DEFAULT_PRIMER_CRITERIA,
  type PrimerCriteria,
  type PrimerReport,
  analyzePrimer,
  candidatePenalty,
  PAIR_WEIGHTS,
  pairPenalty,
  dimerEnergy,
  cleanPrimer,
  findAnnealingSites,
  annealsElsewhere,
  gcFraction,
  longestHomopolymer,
  meltingTemperature,
  threePrimeComplementarity,
  threePrimeDimer,
} from '../primers';
import { type Range, rangePieces } from '../range';
import { reverseComplement } from '../sequence';
import { type PcrPrimer, pcr } from './pcr';

/**
 * Colony-PCR check primers for a cloning product (#311, item 120).
 *
 * A clone is screened by PCR on a colony: a pair across a junction of the
 * vector and the insert gives a band only when the insert is there, and
 * which junction it spans tells which way round the insert went; a pair on
 * the vector either side of the insert gives one size with the insert and
 * another without. This module designs such pairs on the product itself,
 * with the designer's own candidate rules (`analyzePrimer`,
 * `candidatePenalty`, specificity by `annealsElsewhere`), and then
 * runs `pcr` on the clone, on the empty vector and on the clone with its
 * insert the wrong way round, so the bands it promises are the ones the
 * simulation would draw.
 *
 * Everything is in the product's own 0-based half-open coordinates,
 * unrolled past the origin where a stretch crosses it; the UI adds one.
 */

/** A stretch two molecules share: where it lies on the product. */
export interface SharedStretch {
  /** On the product, unrolled (`end` may pass the length of a circle). */
  readonly range: Range;
  /** The molecule's reverse complement is what the product carries. */
  readonly flipped: boolean;
}

/** Shortest stretch worth calling shared; a shorter one is coincidence. */
const KMER = 12;

function kmerIndex(text: string, span: number): Map<string, number[]> {
  const index = new Map<string, number[]>();
  for (let i = 0; i < span && i + KMER <= text.length; i++) {
    const key = text.slice(i, i + KMER);
    const at = index.get(key);
    if (at === undefined) index.set(key, [i]);
    else at.push(i);
  }
  return index;
}

/**
 * The longest stretch of bases `molecule` and `product` have in common, on
 * either strand of the molecule, as a range on the product. Both may be
 * circular, in which case the stretch may run through either origin.
 * Null when they share less than `KMER` bases.
 *
 * Found by anchoring on shared 12-mers and extending each left-maximal one,
 * so a 20 kb plasmid against its own backbone takes milliseconds rather
 * than the quadratic table a textbook longest-common-substring builds.
 */
export function longestSharedStretch(
  product: SeqDocument,
  molecule: SeqDocument,
): SharedStretch | null {
  const P = product.sequence.toString().toUpperCase();
  const LP = P.length;
  const M = molecule.sequence.toString().toUpperCase();
  const LM = M.length;
  if (LP < KMER || LM < KMER) return null;
  const circularP = product.isCircular;
  const circularM = molecule.isCircular;
  const scanP = circularP ? P + P : P;
  const strands: readonly { text: string; flipped: boolean }[] = [
    { text: M, flipped: false },
    { text: reverseComplement(M), flipped: true },
  ];
  let best: SharedStretch | null = null;
  let bestLength = KMER - 1;
  for (const { text, flipped } of strands) {
    const scanM = circularM ? text + text : text;
    const index = kmerIndex(scanM, LM);
    const starts = circularP ? LP : LP - KMER + 1;
    for (let i = 0; i < starts; i++) {
      const hits = index.get(scanP.slice(i, i + KMER));
      if (hits === undefined) continue;
      for (const j of hits) {
        // Left-maximal only: a match that continues to the left is found
        // from the position before, once, instead of from every base of it.
        const leftP = i > 0 ? i - 1 : circularP ? LP - 1 : -1;
        const leftM = j > 0 ? j - 1 : circularM ? LM - 1 : -1;
        if (leftP >= 0 && leftM >= 0 && scanP.charAt(leftP) === scanM.charAt(leftM)) continue;
        const cap = Math.min(LP, LM, scanP.length - i, scanM.length - j);
        let len = KMER;
        while (len < cap && scanP.charCodeAt(i + len) === scanM.charCodeAt(j + len)) len++;
        if (len > bestLength) {
          bestLength = len;
          best = { range: { start: i, end: i + len }, flipped };
        }
      }
    }
  }
  return best;
}

/**
 * Where the insert lies on a product and where its pieces meet: what the
 * check primers are designed around.
 */
export interface CloneGeometry {
  /** The insert on the product: 0-based half-open, unrolled on a circle. */
  readonly insert: Range;
  /**
   * The junctions a check pair can span, as positions on the product
   * (normalised to `[0, length)`): the insert's start, then its end (left
   * out on a linear product where the insert reaches the molecule's end),
   * then any junction between the pieces of a multi-part insert, in order
   * along the insert.
   */
  readonly junctions: readonly number[];
}

/**
 * Shortest stretch that counts as the vector on the product: two unrelated
 * 20 kb molecules share a 14-mer or so by chance, a backbone is hundreds
 * of bases.
 */
const MIN_SHARED = 50;
/** Shortest stretch that counts as a part of the insert: a tag can be thirty bases. */
const MIN_PART = 2 * KMER;
/** A junction this close to the insert's end, or to another, is that one. */
const JUNCTION_GAP = 20;

/**
 * Locates the insert on a product as everything that is not the vector:
 * the vector is the longest stretch the product shares with `vector`, and
 * the insert is the rest of the circle. With `parts` (the inserts of a
 * multi-part build), each one's stretch on the product adds the junction
 * between each two neighbours: the middle of their overlap, or of the gap
 * between them, which for sticky ends and homology arms alike is the
 * bases both pieces carry.
 *
 * Null when the vector is nowhere on the product, when it is all of it
 * (nothing was inserted), or on a linear product whose vector sits in the
 * middle, which would have two inserts and is not a clone to screen.
 */
export function locateInsert(
  product: SeqDocument,
  vector: SeqDocument,
  parts: readonly SeqDocument[] = [],
): CloneGeometry | null {
  const L = product.length;
  const norm = (p: number): number => ((p % L) + L) % L;
  const stretch = longestSharedStretch(product, vector);
  if (stretch === null) return null;
  const vectorLength = stretch.range.end - stretch.range.start;
  if (vectorLength < MIN_SHARED || vectorLength >= L) return null;
  let insert: Range;
  let junctions: number[];
  if (product.isCircular) {
    const start = norm(stretch.range.end);
    insert = { start, end: start + (L - vectorLength) };
    junctions = [start, norm(insert.end)];
  } else if (stretch.range.start === 0) {
    insert = { start: stretch.range.end, end: L };
    junctions = [insert.start];
  } else if (stretch.range.end === L) {
    insert = { start: 0, end: stretch.range.start };
    junctions = [insert.end];
  } else {
    return null;
  }
  for (const j of partJunctions(product, insert, parts)) junctions.push(j);
  return { insert, junctions };
}

/**
 * The junctions between the pieces of an insert, as positions on the
 * product: each part's stretch on the product (`longestSharedStretch`) as
 * an offset along the insert, and between each two neighbours the middle
 * of their overlap or gap, which for sticky ends and homology arms alike
 * is the bases both pieces carry. A part found mostly outside the insert,
 * or barely at all, is not one of its pieces; a junction within
 * `JUNCTION_GAP` of the insert's ends or of another is dropped. For a
 * linear molecule that is all insert — an overlap-extension fusion — the
 * insert is the whole molecule.
 */
export function partJunctions(
  product: SeqDocument,
  insert: Range,
  parts: readonly SeqDocument[],
): number[] {
  const L = product.length;
  const norm = (p: number): number => ((p % L) + L) % L;
  const insertLength = insert.end - insert.start;
  const stretches: { start: number; end: number }[] = [];
  for (const part of parts) {
    const found = longestSharedStretch(product, part);
    if (found === null) continue;
    const length = found.range.end - found.range.start;
    if (length < MIN_PART) continue;
    let start = product.isCircular
      ? norm(found.range.start - insert.start)
      : found.range.start - insert.start;
    // A homology arm or sticky end shared with the vector starts the
    // stretch a little before the insert: a small negative offset, not a
    // large one near the end of the circle.
    if (product.isCircular && start >= insertLength) start -= L;
    const middle = start + length / 2;
    if (middle < 0 || middle >= insertLength) continue;
    stretches.push({ start, end: start + length });
  }
  stretches.sort((a, b) => a.start - b.start);
  const inner: number[] = [];
  for (let i = 1; i < stretches.length; i++) {
    const prev = stretches[i - 1];
    const cur = stretches[i];
    if (prev === undefined || cur === undefined) continue;
    const offset = Math.floor((prev.end + cur.start) / 2);
    if (offset <= JUNCTION_GAP || offset >= insertLength - JUNCTION_GAP) continue;
    if (inner.some((o) => Math.abs(o - offset) < JUNCTION_GAP)) continue;
    inner.push(offset);
  }
  return inner.map((o) => norm(insert.start + o));
}

/**
 * The clone with its insert the wrong way round: the product with the
 * insert's bases reverse-complemented in place. Features are not carried
 * over; this molecule exists to be a PCR template. An insert that crosses
 * the origin is turned with the sequence rotated to start at it, which on
 * a circle is the same molecule.
 */
export function flipInsert(product: SeqDocument, insert: Range): SeqDocument {
  const text = product.sequence.toString();
  const L = text.length;
  const pieces = rangePieces(insert, L);
  const bases = pieces.map((p) => text.slice(p.start, p.end)).join('');
  const turned = reverseComplement(bases);
  const sequence =
    insert.end <= L
      ? text.slice(0, insert.start) + turned + text.slice(insert.end)
      : turned + text.slice(insert.end - L, insert.start);
  return SeqDocument.create({
    name: `${product.name}, insert reversed`,
    sequence,
    topology: product.topology,
    methylation: product.methylation,
  });
}

export interface CheckOptions {
  /** Shortest and longest band a pair may give on the clone, bp. */
  readonly minProduct?: number;
  readonly maxProduct?: number;
  /** How far from the junction either primer's nearer end must be, bp. */
  readonly minDistance?: number;
  /** The primer designer's rules; `requireSpecific` is always applied on the product. */
  readonly criteria?: Partial<PrimerCriteria>;
  /** A primer already designed, whose counterpart alone is to be found. */
  readonly reuse?: PcrPrimer | null;
  /** The molecule a colony without the insert carries; null when none can be said. */
  readonly empty?: SeqDocument | null;
  /** Whether the insert could have gone in the other way round. */
  readonly orientation?: 'open' | 'fixed';
  /** Pairs kept per junction and for the flank, best first. */
  readonly maxPairs?: number;
}

export const CHECK_DEFAULTS = {
  minProduct: 300,
  maxProduct: 1000,
  minDistance: 50,
  maxPairs: 5,
} as const;

/** The sizes a pair gives on each molecule, by `pcr`, shortest first; empty when nothing amplifies. */
export interface CheckBands {
  readonly clone: readonly number[];
  /** Null when no empty vector was given. */
  readonly empty: readonly number[] | null;
  /** Null when the orientation is fixed by the method. */
  readonly flipped: readonly number[] | null;
}

export interface CheckPair {
  /** Across one junction (band only with the insert), or on the vector either side of it (a size). */
  readonly kind: 'junction' | 'flank';
  /** Index into `CloneGeometry.junctions` for a junction pair; null for the flank. */
  readonly junction: number | null;
  readonly forward: PrimerReport;
  readonly reverse: PrimerReport;
  /** Where each anneals on the product, normalised to `[0, length)`, unrolled past it. */
  readonly forwardSite: Range;
  readonly reverseSite: Range;
  /** Which primer was reused rather than designed, if either. */
  readonly fixed: 'forward' | 'reverse' | null;
  /** The band on the clone, tails included; what `bands.clone` gives. */
  readonly productLength: number;
  readonly tmDifference: number;
  readonly crossDimer: number;
  /** ΔG of the best dimer the two primers make, kcal/mol, 0 or less. */
  readonly crossDimerDg: number;
  /** The designer's; lower is better. */
  readonly penalty: number;
  readonly bands: CheckBands;
  /**
   * What stops the pair telling what it is for: a junction pair that also
   * amplifies the empty vector, a flank pair whose empty-vector band is the
   * clone's size. Empty for a pair that does its job.
   */
  readonly problems: readonly string[];
}

export interface CheckDesign {
  /** Best first within each kind; junction pairs in junction order, then the flank. */
  readonly pairs: readonly CheckPair[];
  /** What could not be designed, and why, one sentence each. */
  readonly notes: readonly string[];
  /** The reused primer's site on the product, when one was given and anneals. */
  readonly reused: AnnealingSite | null;
}

interface Candidate {
  readonly report: PrimerReport;
  /** Unrolled in the frame of the window it was found in. */
  readonly site: Range;
  readonly penalty: number;
}

/** Candidates kept per side, best first; the rest are never paired. */
const PER_SIDE = 300;

/** A ratio of band sizes a gel tells apart (the gel module's own default). */
const RESOLUTION = 1.15;

function basesAt(text: string, r: Range, L: number): string {
  return rangePieces(r, L)
    .map((p) => text.slice(p.start, p.end))
    .join('');
}

/**
 * The candidates of a design, judged once each: the windows of the kinds
 * overlap (the flank's left window is the first junction's), so a primer
 * is measured once however many windows it falls in.
 */
type CandidateCache = Map<string, Candidate | null>;

/**
 * Every primer of `strand` lying wholly inside `window` (unrolled; clipped
 * to the molecule on a linear product) that meets the criteria, best first,
 * at most `PER_SIDE` of them. Specificity is judged later, per pair.
 */
function candidatesIn(
  product: SeqDocument,
  text: string,
  window: Range,
  strand: Strand,
  c: PrimerCriteria,
  cache: CandidateCache,
): Candidate[] {
  const L = text.length;
  const circular = product.isCircular;
  const norm = (p: number): number => ((p % L) + L) % L;
  const lo = circular ? window.start : Math.max(0, window.start);
  const hi = circular ? window.end : Math.min(L, window.end);
  const out: Candidate[] = [];
  for (let s = lo; s + c.minLength <= hi; s++) {
    for (let len = c.minLength; len <= c.maxLength && s + len <= hi; len++) {
      const key = `${strand}:${norm(s)}:${len}`;
      let cand = cache.get(key);
      if (cand === undefined) {
        cand = judge(text, { start: norm(s), end: norm(s) + len }, strand, c);
        cache.set(key, cand);
      }
      if (cand !== null) out.push({ ...cand, site: { start: s, end: s + len } });
    }
  }
  out.sort((a, b) => a.penalty - b.penalty || a.site.start - b.site.start);
  return out.slice(0, PER_SIDE);
}

/**
 * One stretch as a primer of `strand`, or null when it breaks a criterion.
 * The cheap rules go first — most of a window fails Tm or GC content, and
 * the full report's hairpin and self-complementarity scans are quadratic
 * in the length — so the report is only written for the few that pass.
 */
function judge(text: string, on: Range, strand: Strand, c: PrimerCriteria): Candidate | null {
  const bases = basesAt(text, on, text.length);
  const primer = strand === 'forward' ? bases : reverseComplement(bases);
  const gc = gcFraction(primer);
  if (gc < c.minGc || gc > c.maxGc) return null;
  if (longestHomopolymer(primer) > c.maxHomopolymer) return null;
  // NaN (an ambiguity code) fails both bounds, as the report would refuse it.
  const tm = meltingTemperature(primer);
  if (!(tm >= c.minTm && tm <= c.maxTm)) return null;
  const report = analyzePrimer(primer, c);
  const penalty = candidatePenalty(report, c);
  return penalty === null ? null : { report, site: on, penalty };
}

function dimer(a: string, b: string): number {
  return Math.max(threePrimeComplementarity(a, b), threePrimeComplementarity(b, a));
}

interface Paired {
  readonly forward: Candidate;
  readonly reverse: Candidate;
  readonly productLength: number;
  readonly tmDifference: number;
  readonly crossDimer: number;
  readonly crossDimerDg: number;
  readonly penalty: number;
}

/**
 * Whether a primer anneals nowhere on the product but at its own site, by
 * the designer's rule (`annealsElsewhere`), remembered per oligo so
 * a candidate in many pairs is scanned once.
 */
class Specificity {
  private readonly known = new Map<string, boolean>();
  /** Scans run so far: each is a walk over the whole product. */
  scans = 0;

  constructor(
    private readonly product: SeqDocument,
    private readonly text: string,
  ) {}

  specific(cand: Candidate, strand: Strand): boolean {
    const L = this.text.length;
    const own = ((cand.site.start % L) + L) % L;
    const key = `${strand}:${own}:${cand.report.sequence}`;
    const seen = this.known.get(key);
    if (seen !== undefined) return seen;
    this.scans++;
    const elsewhere = annealsElsewhere(
      this.text,
      this.product.topology,
      cand.report.sequence,
      strand,
      cand.site,
    );
    this.known.set(key, !elsewhere);
    return !elsewhere;
  }
}

/**
 * Scans one pairing may spend before giving up: on a repetitive product
 * every candidate anneals elsewhere, and each scan walks the whole
 * molecule, so without a bound a 20 kb repeat costs seconds for nothing.
 */
const SCAN_BUDGET = 60;

const REPETITIVE =
  'Many candidates anneal elsewhere on the product (a repeat near a junction?), so fewer were tried.';

/**
 * Pairs forward and reverse candidates in one unrolled frame, by the
 * designer's rules: Tm within the difference allowed, no 3′ dimer, and the
 * band (tails included) inside the size window. Then, best first, only
 * pairs whose two primers anneal nowhere else on the product, one per
 * (forward start, reverse end), until `maxPairs`. A reused primer
 * (`fixed`) is not held to specificity: it is what it is, and the bands
 * say what it amplifies.
 *
 * The dimer and the specificity scan are the dear checks, so they run in
 * order of the rest of the penalty and stop once no later pair can beat
 * the `maxPairs` found: the dimer only adds to a penalty.
 */
function pairUp(
  forwards: readonly Candidate[],
  reverses: readonly Candidate[],
  tails: number,
  c: PrimerCriteria,
  size: { readonly min: number; readonly max: number },
  maxPairs: number,
  specificity: Specificity,
  fixed: 'forward' | 'reverse' | null = null,
): { readonly pairs: Paired[]; readonly exhausted: boolean } {
  interface Rough {
    readonly forward: Candidate;
    readonly reverse: Candidate;
    readonly productLength: number;
    readonly tmDifference: number;
    readonly penalty: number;
  }
  const rough: Rough[] = [];
  for (const f of forwards) {
    for (const r of reverses) {
      const tmDifference = Math.abs(f.report.tm - r.report.tm);
      if (tmDifference > c.maxTmDifference) continue;
      const productLength = r.site.end - f.site.start + tails;
      if (productLength < size.min || productLength > size.max) continue;
      rough.push({
        forward: f,
        reverse: r,
        productLength,
        tmDifference,
        penalty: pairPenalty(f.penalty, r.penalty, tmDifference, 0),
      });
    }
  }
  rough.sort((a, b) => a.penalty - b.penalty || a.productLength - b.productLength);
  const seen = new Set<string>();
  const out: Paired[] = [];
  const scansBefore = specificity.scans;
  let exhausted = false;
  for (const p of rough) {
    const worst = out[maxPairs - 1]?.penalty;
    if (worst !== undefined && p.penalty >= worst) break;
    if (specificity.scans - scansBefore >= SCAN_BUDGET) {
      exhausted = true;
      break;
    }
    const key = `${p.forward.site.start}-${p.reverse.site.end}`;
    if (seen.has(key)) continue;
    const crossDimer = dimer(p.forward.report.sequence, p.reverse.report.sequence);
    const forwardSeq = p.forward.report.sequence;
    const reverseSeq = p.reverse.report.sequence;
    if (threePrimeDimer(forwardSeq, reverseSeq, c.maxThreePrime, c.threePrimeDg)) continue;
    const crossDimerDg = dimerEnergy(forwardSeq, reverseSeq);
    if (crossDimerDg <= c.dimerDg) continue;
    if (fixed !== 'forward' && !specificity.specific(p.forward, 'forward')) continue;
    if (fixed !== 'reverse' && !specificity.specific(p.reverse, 'reverse')) continue;
    seen.add(key);
    const full: Paired = {
      ...p,
      crossDimer,
      crossDimerDg,
      penalty: p.penalty + crossDimer * PAIR_WEIGHTS.crossDimer,
    };
    const at = out.findIndex((q) => q.penalty > full.penalty);
    out.splice(at === -1 ? out.length : at, 0, full);
    if (out.length > maxPairs) out.pop();
  }
  return { pairs: out, exhausted };
}

/** What `pcr` makes of the pair on a molecule: the band sizes, shortest first. */
function bandsOn(template: SeqDocument, forward: string, reverse: string): number[] {
  const result = pcr(
    template,
    [
      { name: 'F', sequence: forward },
      { name: 'R', sequence: reverse },
    ],
    { polymerase: 'proofreading', maxProduct: 20_000 },
  );
  return result.products.map((p) => p.length).sort((a, b) => a - b);
}

/** Whether a band of `a` has a band of `b` a gel would not tell it from. */
function sameBand(a: readonly number[], b: readonly number[]): boolean {
  return a.some((n) => b.some((m) => Math.max(n, m) / Math.min(n, m) < RESOLUTION));
}

/** A reused primer as a candidate, at its one site, judged as a whole oligo but paired by its annealing Tm. */
function reusedCandidate(site: AnnealingSite, c: PrimerCriteria): Candidate {
  const report = analyzePrimer(site.primer, c);
  // The pair is judged by what anneals: a tailed primer's whole-oligo Tm is
  // not the temperature it cycles at.
  return { report: { ...report, tm: site.tm }, site: site.range, penalty: 0 };
}

/**
 * Designs check pairs for the product around `geometry`: one set across
 * each junction (the band exists only with the insert, and only in the
 * orientation that puts that junction there), and one on the vector either
 * side of the whole insert (one size with it, another without). With
 * `reuse`, only the counterpart of that primer is designed, across the
 * junction it points at. The bands on the clone, the empty vector and the
 * insert turned round come from `pcr` on each.
 */
export function designCheckPrimers(
  product: SeqDocument,
  geometry: CloneGeometry,
  options: CheckOptions = {},
): CheckDesign {
  const minProduct = options.minProduct ?? CHECK_DEFAULTS.minProduct;
  const maxProduct = options.maxProduct ?? CHECK_DEFAULTS.maxProduct;
  const minDistance = options.minDistance ?? CHECK_DEFAULTS.minDistance;
  const maxPairs = options.maxPairs ?? CHECK_DEFAULTS.maxPairs;
  const c: PrimerCriteria = {
    ...DEFAULT_PRIMER_CRITERIA,
    ...options.criteria,
    minProduct,
    maxProduct,
    requireSpecific: true,
  };
  const empty = options.empty ?? null;
  const orientation = options.orientation ?? 'open';
  const text = product.sequence.toString().toUpperCase();
  const L = text.length;
  const circular = product.isCircular;
  const norm = (p: number): number => ((p % L) + L) % L;
  const size = { min: minProduct, max: maxProduct };
  const notes: string[] = [];
  const { insert } = geometry;
  const insertLength = insert.end - insert.start;
  // The junctions in product order, unrolled from the insert's start, so
  // each one's neighbours bound the windows on either side of it.
  const ordered = [...geometry.junctions]
    .map((j) => (circular ? insert.start + norm(j - insert.start) : j))
    .sort((a, b) => a - b);
  const index = (j: number): number => geometry.junctions.indexOf(norm(j));
  // The nearest junction before and after a position, in whatever turn of
  // the circle the position is in; the molecule's ends on a linear product.
  const before = (j: number): number => {
    if (!circular) return ordered.filter((o) => o < j).at(-1) ?? 0;
    let best = -Infinity;
    for (const o of ordered) {
      let x = o + Math.ceil((j - o) / L) * L;
      if (x >= j) x -= L;
      best = Math.max(best, x);
    }
    return best;
  };
  const after = (j: number): number => {
    if (!circular) return ordered.find((o) => o > j) ?? L;
    let best = Infinity;
    for (const o of ordered) {
      let x = o + Math.floor((j - o) / L) * L;
      if (x <= j) x += L;
      best = Math.min(best, x);
    }
    return best;
  };
  const flipped = orientation === 'open' ? flipInsert(product, insert) : null;

  const finish = (
    kind: CheckPair['kind'],
    junction: number | null,
    p: Paired,
    fixed: CheckPair['fixed'],
  ): CheckPair => {
    const f = p.forward.report.sequence;
    const r = p.reverse.report.sequence;
    const bands: CheckBands = {
      clone: bandsOn(product, f, r),
      empty: empty === null ? null : bandsOn(empty, f, r),
      flipped: flipped === null ? null : bandsOn(flipped, f, r),
    };
    const problems: string[] = [];
    if (kind === 'junction') {
      if (bands.empty !== null && bands.empty.length > 0) {
        problems.push(
          `Amplifies the empty vector too: ${bands.empty.map((n) => n.toLocaleString()).join(', ')} bp`,
        );
      }
      if (
        bands.flipped !== null &&
        bands.flipped.length > 0 &&
        sameBand(bands.flipped, bands.clone)
      ) {
        problems.push('The insert the other way round gives the same band');
      }
    } else if (bands.empty !== null && sameBand(bands.empty, bands.clone)) {
      problems.push('The empty vector gives a band of the same size');
    }
    return {
      kind,
      junction,
      forward: p.forward.report,
      reverse: p.reverse.report,
      forwardSite: {
        start: norm(p.forward.site.start),
        end: norm(p.forward.site.start) + (p.forward.site.end - p.forward.site.start),
      },
      reverseSite: {
        start: norm(p.reverse.site.start),
        end: norm(p.reverse.site.start) + (p.reverse.site.end - p.reverse.site.start),
      },
      fixed,
      productLength: p.productLength,
      tmDifference: p.tmDifference,
      crossDimer: p.crossDimer,
      crossDimerDg: p.crossDimerDg,
      penalty: p.penalty,
      bands,
      problems,
    };
  };

  const pairs: CheckPair[] = [];

  // --- One primer given: its counterpart across the junction it points at.
  const specificity = new Specificity(product, text);
  const cache: CandidateCache = new Map();
  // The nearest a primer's far end can be to the junction, and so how far
  // from it the other primer may start and still give a band in the window.
  const nearest = minDistance + c.minLength;
  // Whether any pairing spent its scan budget (set inside `widening`).
  const spent = { exhausted: false };

  /**
   * Pairs from windows that start close to the junction and widen, doubling,
   * only while fewer than `maxPairs` come out: a colony band is best small,
   * and a 1 kb window either side is ten thousand candidates to judge.
   */
  const widening = (
    minReach: number,
    maxReach: number,
    windows: (reach: number) => {
      readonly forwards: readonly Candidate[];
      readonly reverses: readonly Candidate[];
      readonly tails: number;
      readonly fixed: 'forward' | 'reverse' | null;
    },
  ): Paired[] => {
    let reach = Math.min(minReach, maxReach);
    for (;;) {
      const w = windows(reach);
      const found = pairUp(
        w.forwards,
        w.reverses,
        w.tails,
        c,
        size,
        maxPairs,
        specificity,
        w.fixed,
      );
      spent.exhausted ||= found.exhausted;
      if (found.pairs.length >= maxPairs || reach >= maxReach || found.exhausted) {
        return found.pairs;
      }
      reach = Math.min(maxReach, reach * 2);
    }
  };
  /** How far out to look first: enough for a band of `minProduct` with room to choose. */
  const firstReach = (already: number): number =>
    Math.max(nearest + 150, Math.ceil((minProduct - already) / 2) + 50);

  if (options.reuse !== undefined && options.reuse !== null) {
    const name = options.reuse.name;
    const sites = findAnnealingSites(text, product.topology, options.reuse.sequence);
    const best = [...sites].sort(
      (a, b) => a.mismatches - b.mismatches || b.annealLength - a.annealLength,
    )[0];
    if (best === undefined) {
      notes.push(`${name} does not anneal to ${product.name}, so it has no counterpart here.`);
      return { pairs, notes, reused: null };
    }
    if (sites.length > 1) {
      notes.push(
        `${name} anneals at ${sites.length.toLocaleString()} places on ${product.name}; the counterpart is designed for its best site, and a second band is possible.`,
      );
    }
    const tail = best.tail.length;
    // In the frame unrolled from the insert's start.
    const at = circular ? insert.start + norm(best.range.start - insert.start) : best.range.start;
    const site = { start: at, end: at + (best.range.end - best.range.start) };
    const fixed = { ...reusedCandidate(best, c), site };
    // The counterpart matches the reused primer's annealing Tm, whatever the
    // settings' range: a pair cycles at one temperature.
    const match: PrimerCriteria = {
      ...c,
      minTm: best.tm - c.maxTmDifference,
      maxTm: best.tm + c.maxTmDifference,
    };
    if (best.strand === 'forward') {
      // The first junction past its 3′ end; the counterpart lies beyond it.
      const j = after(site.end - 1);
      const already = j - site.start + tail;
      const paired = widening(firstReach(already), maxProduct - already, (reach) => ({
        forwards: [fixed],
        reverses: candidatesIn(
          product,
          text,
          { start: j + minDistance, end: Math.min(after(j), j + reach) },
          'reverse',
          match,
          cache,
        ),
        tails: tail,
        fixed: 'forward',
      }));
      if (paired.length === 0) {
        notes.push(
          `No counterpart for ${name}: it anneals ${(j - site.start).toLocaleString()} bp before the junction it points at, so the band would be at least ${(already + nearest).toLocaleString()} bp; widen the size window or move further from the junction.`,
        );
      }
      for (const p of paired) pairs.push(finish('junction', index(j), p, 'forward'));
    } else {
      const j = before(site.start + 1);
      const already = site.end - j + tail;
      const paired = widening(firstReach(already), maxProduct - already, (reach) => ({
        forwards: candidatesIn(
          product,
          text,
          { start: Math.max(before(j), j - reach), end: j - minDistance },
          'forward',
          match,
          cache,
        ),
        reverses: [fixed],
        tails: tail,
        fixed: 'reverse',
      }));
      if (paired.length === 0) {
        notes.push(
          `No counterpart for ${name}: it anneals ${(site.end - j).toLocaleString()} bp past the junction it points at, so the band would be at least ${(already + nearest).toLocaleString()} bp; widen the size window or move further from the junction.`,
        );
      }
      for (const p of paired) pairs.push(finish('junction', index(j), p, 'reverse'));
    }
    if (spent.exhausted) notes.push(REPETITIVE);
    return { pairs, notes, reused: best };
  }

  // --- Across each junction: a band only with the insert, in this orientation.
  for (const j of ordered) {
    const paired = widening(firstReach(0), maxProduct - nearest, (reach) => ({
      forwards: candidatesIn(
        product,
        text,
        { start: Math.max(before(j), j - reach), end: j - minDistance },
        'forward',
        c,
        cache,
      ),
      reverses: candidatesIn(
        product,
        text,
        { start: j + minDistance, end: Math.min(after(j), j + reach) },
        'reverse',
        c,
        cache,
      ),
      tails: 0,
      fixed: null,
    }));
    if (paired.length === 0) {
      notes.push(
        `No pair across the junction at ${(norm(j) + 1).toLocaleString()} within ${minProduct.toLocaleString()}–${maxProduct.toLocaleString()} bp.`,
      );
    }
    for (const p of paired) pairs.push(finish('junction', index(j), p, null));
  }

  // --- On the vector either side of the insert: one size with it, another without.
  if (geometry.junctions.length >= 2 || !circular) {
    const flankable = circular || (insert.start > 0 && insert.end < L);
    if (!flankable) {
      notes.push('The insert reaches an end of the linear product, so no pair can flank it.');
    } else if (insertLength + 2 * nearest > maxProduct) {
      notes.push(
        `A pair flanking the whole insert would give at least ${(insertLength + 2 * nearest).toLocaleString()} bp; raise the size window to design one.`,
      );
    } else {
      const paired = widening(
        firstReach(insertLength),
        maxProduct - insertLength - nearest,
        (reach) => ({
          forwards: candidatesIn(
            product,
            text,
            {
              start: Math.max(insert.end - L, insert.start - reach),
              end: insert.start - minDistance,
            },
            'forward',
            c,
            cache,
          ),
          reverses: candidatesIn(
            product,
            text,
            {
              start: insert.end + minDistance,
              end: Math.min(insert.start + L, insert.end + reach),
            },
            'reverse',
            c,
            cache,
          ),
          tails: 0,
          fixed: null,
        }),
      );
      if (paired.length === 0) {
        notes.push(
          `No pair flanking the insert within ${minProduct.toLocaleString()}–${maxProduct.toLocaleString()} bp.`,
        );
      }
      for (const p of paired) pairs.push(finish('flank', null, p, null));
    }
  }
  if (spent.exhausted) notes.push(REPETITIVE);

  return { pairs, notes, reused: null };
}

/** The primer as a PCR would see it, for the pair's actions. */
export function checkPairPrimers(pair: CheckPair, names: readonly [string, string]): PcrPrimer[] {
  return [
    { name: names[0], sequence: cleanPrimer(pair.forward.sequence) },
    { name: names[1], sequence: cleanPrimer(pair.reverse.sequence) },
  ];
}
