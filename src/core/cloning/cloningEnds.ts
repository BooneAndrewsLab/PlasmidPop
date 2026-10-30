import {
  type HostMethylation,
  blockedByHost,
  cuttableSites,
  hostMethylationAt,
  isHostMethylationSensitive,
} from '../analysis/methylation';
import {
  type CutSite,
  type Enzyme,
  activeEnzymes,
  cutLabel,
  findCutSites,
  getEnzyme,
  isDoubleCutter,
  isTypeIIS,
  overhangKind,
} from '../analysis/restriction';
import { type SeqDocument, describeEnd, flipEnd } from '../document';
import { type Feature, type Strand, featureExtent } from '../features';
import {
  DEFAULT_PRIMER_CRITERIA,
  type PrimerCriteria,
  type PrimerReport,
  designAnchoredPrimers,
  findPrimerBindingSites,
} from '../primers';
import { type Range, type Topology, rangeContains } from '../range';
import { reverseComplement } from '../sequence';
import { type DigestFragment, type FragmentEnd, cutEnd, cutOffset, digest } from './digest';
import { endFlank } from './endFlanks';
import { assemblyJunctions, endsCompatible, flipFragment, ligate } from './ligate';
import { productHolding } from './overlapPrimers';
import { pcr, primerDimers } from './pcr';

/**
 * Restriction-cloning ends (#303, item 108): primers whose 5′ tails put two
 * enzyme sites on an insert, so that after PCR and a digest the insert's
 * ends match a vector cut with the same two enzymes, in one orientation.
 *
 * Three steps, each a function the Design page can call on its own:
 *
 * 1. `suggestEnzymePairs` lists the pairs that would work — each cuts the
 *    vector once, inside the region, unblocked by the vector's dam/dcm,
 *    leaving two sticky ends that cannot ligate to each other, with room
 *    for both to cut, and neither cuts the amplified insert — and the pairs
 *    that would not, each with the reasons (`PairIssue`), so a user can see
 *    why EcoRI · HindIII is greyed and still pick it (`evaluateEnzymePair`
 *    judges any two, in any order).
 * 2. `designCloningEnds` makes the two oligos for a pair: padding, the site
 *    (and for a Type IIS enzyme the spacer and the vector's own overhang),
 *    then an annealing part the primer designer chose on the insert's end.
 *    The padding is raised where NEB's data say an enzyme cuts poorly near
 *    an end (`endFlanks.ts`), and its bases are picked to make no new site
 *    where padding, site and insert meet.
 * 3. `simulate` on a design runs the oligos — `pcr` on the insert's own
 *    document, `digest` of the amplicon and of the vector, `ligate` — and
 *    gives the product, so the design is checked by what it makes rather
 *    than by what it claims (the In-Fusion designer's rule).
 *
 * The amplified insert is a PCR product and carries no methylation: the
 * insert's source document's dam/dcm never block a site in it, while the
 * vector's host methylation decides what cuts the vector. The scans the
 * suggestions read come in as plain cut sites (`CloningScans`), so a page
 * takes them from the analysis worker (`scanForCloning`) and the engine
 * itself never blocks the main thread on a scan.
 */

// ---------------------------------------------------------------- inputs

/** What goes in: a stretch of another document, read as one of its strands. */
export interface CloningInsert {
  /** The tab the insert is on, which is also the PCR template. */
  readonly document: SeqDocument;
  /** Unrolled, 0-based half-open; may wrap the origin of a circular source. */
  readonly range: Range;
  /** The insert reads 5′→3′ as this strand of `document` over `range`. */
  readonly strand: Strand;
  /** What to call it: the feature's name, or the user's; names the primers. */
  readonly name: string;
}

/** The insert's bases 5′→3′ as it reads: the range, reverse-complemented for the reverse strand. */
export function insertSequence(insert: CloningInsert): string {
  const bases = insert.document.subsequence(insert.range);
  return insert.strand === 'reverse' ? reverseComplement(bases) : bases;
}

/** Where on the vector the insert goes, and how that was decided. */
export interface VectorRegion {
  readonly range: Range;
  /**
   * `given` is a selection the user made; `mcs` the one feature named as
   * the cloning site; `whole` the fallback when there is neither, which a
   * page should say ("select a region to narrow").
   */
  readonly source: 'given' | 'mcs' | 'whole';
  /** The feature the `mcs` region came from. */
  readonly feature: Feature | null;
}

const MCS_NAME = /^(mcs|multiple[ _-]?cloning[ _-]?site|polylinker)$|\bmcs\b/i;

/** Whether a feature is the vector's cloning site, by its name. */
export function isCloningSiteFeature(feature: Feature): boolean {
  return MCS_NAME.test(feature.name.trim());
}

/**
 * The region the suggestions are limited to: the selection when there is
 * one; else the one feature named as the MCS, if the document has exactly
 * one; else the whole molecule, flagged so a page can hint at narrowing.
 * Never a guess the user did not see.
 */
export function resolveVectorRegion(vector: SeqDocument, given: Range | null): VectorRegion {
  if (given !== null && given.end > given.start) {
    return { range: given, source: 'given', feature: null };
  }
  const named = vector.features.all().filter(isCloningSiteFeature);
  const only = named.length === 1 ? named[0] : undefined;
  const extent = only === undefined ? null : featureExtent(only);
  if (only !== undefined && extent !== null && extent.end > extent.start) {
    return { range: extent, source: 'mcs', feature: only };
  }
  return { range: { start: 0, end: vector.length }, source: 'whole', feature: null };
}

/** The cut sites the suggestions read: the vector's, and the amplified insert's. */
export interface CloningScans {
  /** Every enzyme's sites on the vector, as `findCutSites` lists them. */
  readonly vectorSites: readonly CutSite[];
  /**
   * The sites on the insert alone (`insertSequence`, linear): the stretch
   * between the annealing ends, which is what the primers copy. Sites a
   * tail would make at a junction are the design's to find.
   */
  readonly insertSites: readonly CutSite[];
}

/** What `scanForCloning` needs of the analysis worker (`analysisClient.cutSites`). */
export interface CutSiteScanner {
  cutSites(
    sequence: string,
    topology: Topology,
    enzymes?: readonly string[],
  ): Promise<readonly CutSite[]>;
}

/**
 * Both scans off the main thread. The vector's is the same scan the
 * Enzymes tab keeps, so a page that has it can pass its sites instead.
 */
export async function scanForCloning(
  scanner: CutSiteScanner,
  vector: SeqDocument,
  insert: CloningInsert,
): Promise<CloningScans> {
  const [vectorSites, insertSites] = await Promise.all([
    scanner.cutSites(vector.sequence.toString(), vector.topology),
    scanner.cutSites(insertSequence(insert), 'linear'),
  ]);
  return { vectorSites, insertSites };
}

/** Both scans here and now, for tests and for a template too small to be worth a worker. */
export function scanForCloningNow(
  vector: SeqDocument,
  insert: CloningInsert,
  enzymes: readonly Enzyme[] = activeEnzymes(),
): CloningScans {
  return {
    vectorSites: findCutSites(vector.sequence.toString(), vector.topology, enzymes),
    insertSites: findCutSites(insertSequence(insert), 'linear', enzymes),
  };
}

/** Everything the three steps share. */
export interface CloningContext {
  readonly vector: SeqDocument;
  readonly region: VectorRegion;
  readonly insert: CloningInsert;
  /**
   * Flip: the insert's 5′ end goes to the higher cut, so it reads along
   * the vector's bottom strand. Off, it goes to the lower cut.
   */
  readonly flipped: boolean;
  readonly scans: CloningScans;
  /** The enzyme table the scans were made with; the active set by default. */
  readonly enzymes?: readonly Enzyme[];
}

export interface CloningSettings {
  /** Bases 5′ of each site; raised per enzyme by `endFlanks.ts`. */
  readonly padding: number;
  /** Pick padding bases that make no new site where padding, site and insert meet. */
  readonly avoidJunctionSites: boolean;
  /** The plain designer's settings, which the annealing parts are held to. */
  readonly criteria: Partial<PrimerCriteria>;
  /** Other usable pairs designed beside the picked one. */
  readonly maxAlternatives: number;
}

export const CLONING_DEFAULTS: CloningSettings = {
  padding: 6,
  avoidJunctionSites: true,
  criteria: {},
  maxAlternatives: 5,
};

// ---------------------------------------------------------------- pairs

/** One enzyme as one end of the insert. */
export interface EnzymeEnd {
  readonly enzyme: string;
  /** How many times it cuts the vector, anywhere. */
  readonly vectorCuts: number;
  /** Its one cut inside the region, or null when it has none there. */
  readonly site: CutSite | null;
  /** The end that cut leaves on the vector; null without a cut. */
  readonly end: FragmentEnd | null;
  /** The vector's methylation that blocks that cut: empty when it cuts. */
  readonly blocked: readonly HostMethylation[];
  /** Where it cuts the insert (0-based, bases before the cut), in `insertSequence` coordinates. */
  readonly insertCuts: readonly number[];
  /** Cuts outside its site (Golden Gate's enzymes), or on both sides of it. */
  readonly typeIIS: boolean;
}

/** Why a pair is not suggested; the override turns each into a warning. */
export type PairIssue =
  | { readonly kind: 'unknownEnzyme'; readonly enzyme: string }
  | { readonly kind: 'vectorCuts'; readonly enzyme: string; readonly count: number }
  | { readonly kind: 'outsideRegion'; readonly enzyme: string }
  | {
      readonly kind: 'methylation';
      readonly enzyme: string;
      readonly marks: readonly HostMethylation[];
    }
  | { readonly kind: 'blunt'; readonly enzyme: string }
  | { readonly kind: 'typeIIS'; readonly enzyme: string }
  | { readonly kind: 'sameEnzyme'; readonly enzyme: string }
  | {
      readonly kind: 'compatibleEnds';
      readonly forward: FragmentEnd;
      readonly reverse: FragmentEnd;
    }
  | {
      readonly kind: 'tooClose';
      readonly enzyme: string;
      /** Bases left beside its site once the other enzyme has cut. */
      readonly flank: number;
      readonly needed: number;
    }
  | { readonly kind: 'cutsInsert'; readonly enzyme: string; readonly positions: readonly number[] };

export interface EnzymePairReport {
  /** The enzyme on the forward primer: the insert's 5′ end. */
  readonly forward: EnzymeEnd;
  /** The enzyme on the reverse primer: the insert's 3′ end. */
  readonly reverse: EnzymeEnd;
  readonly issues: readonly PairIssue[];
  /** No issues at all. */
  readonly usable: boolean;
  /**
   * The vector's bases between the two cuts, unrolled, which the insert
   * replaces; empty for one enzyme; null without both cuts.
   */
  readonly replaced: Range | null;
  /**
   * `forward` when the insert reads along the vector's top strand (the
   * forward primer's cut is the lower one), `reverse` when it reads the
   * other way; `forward` for one enzyme and when a cut is missing.
   */
  readonly orientation: Strand;
}

/** `suggestEnzymePairs`' answer. */
export interface EnzymePairSuggestions {
  /** Every pair of candidates, usable ones first in rank, then the excluded ones. */
  readonly pairs: readonly EnzymePairReport[];
  /** How many of `pairs` are usable. */
  readonly usable: number;
  /** The enzymes the pairs were made from: those with a cut inside the region. */
  readonly candidates: readonly string[];
  /**
   * The pair the page had picked, judged again on this context (#303,
   * decision 8): kept, and with its reasons when it no longer holds. Null
   * when none was given.
   */
  readonly picked: EnzymePairReport | null;
}

interface Geometry {
  readonly L: number;
  readonly topology: Topology;
  readonly region: Range;
}

function wrapMod(x: number, L: number): number {
  return ((x % L) + L) % L;
}

/** Where a cut lies from the region's start, unrolled, or null when it is outside. */
function regionOffset(cut: number, g: Geometry): number | null {
  const span = g.region.end - g.region.start;
  let d = cut - g.region.start;
  if (g.topology === 'circular') d = wrapMod(d, g.L);
  return d >= 0 && d <= span ? d : null;
}

/** A site's positions laid out around its unrolled cut, so they compare across the origin. */
interface LaidOut {
  readonly cut: number;
  readonly cutBottom: number;
  readonly siteStart: number;
  readonly siteEnd: number;
}

function layOut(site: CutSite, cutUnrolled: number, siteLength: number, g: Geometry): LaidOut {
  const near = (p: number): number => {
    if (g.topology !== 'circular') return p;
    let d = wrapMod(p - site.cut, g.L);
    if (d > g.L / 2) d -= g.L;
    return cutUnrolled + d;
  };
  const cutBottom = cutUnrolled + cutOffset(site, g.L, g.topology);
  const siteStart = near(site.siteStart);
  return { cut: cutUnrolled, cutBottom, siteStart, siteEnd: siteStart + siteLength };
}

class Lookup {
  private readonly byName: ReadonlyMap<string, Enzyme> | null;
  constructor(enzymes: readonly Enzyme[] | undefined) {
    this.byName = enzymes === undefined ? null : new Map(enzymes.map((e) => [e.name, e]));
  }
  get(name: string): Enzyme | undefined {
    return this.byName === null ? getEnzyme(name) : this.byName.get(name);
  }
  all(): readonly Enzyme[] {
    return this.byName === null ? activeEnzymes() : [...this.byName.values()];
  }
}

function geometryOf(ctx: CloningContext): Geometry {
  return { L: ctx.vector.length, topology: ctx.vector.topology, region: ctx.region.range };
}

/** One enzyme judged on the vector and the insert, before any pairing. */
function enzymeEnd(ctx: CloningContext, lookup: Lookup, name: string): EnzymeEnd | null {
  const enzyme = lookup.get(name);
  if (enzyme === undefined) return null;
  const g = geometryOf(ctx);
  const onVector = ctx.scans.vectorSites.filter((s) => s.enzyme === name);
  const inRegion = onVector
    .map((s) => ({ site: s, offset: regionOffset(s.cut, g) }))
    .filter((x): x is { site: CutSite; offset: number } => x.offset !== null)
    .sort((a, b) => a.offset - b.offset);
  const site = inRegion[0]?.site ?? null;
  const text = ctx.vector.sequence.toString();
  const blocked =
    site !== null && isHostMethylationSensitive(name)
      ? hostMethylationAt(text, g.topology, site, enzyme.site.length).filter((m) =>
          blockedByHost(ctx.vector.methylation, [m]),
        )
      : [];
  return {
    enzyme: name,
    vectorCuts: onVector.length,
    site,
    end: site === null ? null : cutEnd(ctx.vector, site),
    blocked,
    insertCuts: ctx.scans.insertSites.filter((s) => s.enzyme === name).map((s) => s.cut),
    typeIIS: isTypeIIS(enzyme) || isDoubleCutter(enzyme),
  };
}

function unknownEnd(name: string): EnzymeEnd {
  return {
    enzyme: name,
    vectorCuts: 0,
    site: null,
    end: null,
    blocked: [],
    insertCuts: [],
    typeIIS: false,
  };
}

/** The issues of one end on its own. */
function endIssues(end: EnzymeEnd, lookup: Lookup): PairIssue[] {
  const out: PairIssue[] = [];
  const enzyme = lookup.get(end.enzyme);
  if (enzyme === undefined) return [{ kind: 'unknownEnzyme', enzyme: end.enzyme }];
  if (end.vectorCuts !== 1)
    out.push({ kind: 'vectorCuts', enzyme: end.enzyme, count: end.vectorCuts });
  else if (end.site === null) out.push({ kind: 'outsideRegion', enzyme: end.enzyme });
  if (end.blocked.length > 0) {
    out.push({ kind: 'methylation', enzyme: end.enzyme, marks: end.blocked });
  }
  if (overhangKind(enzyme) === 'blunt') out.push({ kind: 'blunt', enzyme: end.enzyme });
  if (end.typeIIS) out.push({ kind: 'typeIIS', enzyme: end.enzyme });
  if (end.insertCuts.length > 0) {
    out.push({ kind: 'cutsInsert', enzyme: end.enzyme, positions: end.insertCuts });
  }
  return out;
}

function pairReport(
  ctx: CloningContext,
  lookup: Lookup,
  forward: EnzymeEnd,
  reverse: EnzymeEnd,
): EnzymePairReport {
  const g = geometryOf(ctx);
  const issues: PairIssue[] = [...endIssues(forward, lookup)];
  if (reverse.enzyme === forward.enzyme) {
    issues.push({ kind: 'sameEnzyme', enzyme: forward.enzyme });
  } else {
    issues.push(...endIssues(reverse, lookup));
  }

  let replaced: Range | null = null;
  let orientation: Strand = 'forward';
  const fSite = forward.site;
  const rSite = reverse.site;
  const fEnzyme = lookup.get(forward.enzyme);
  const rEnzyme = lookup.get(reverse.enzyme);
  if (fSite !== null && rSite !== null && fEnzyme !== undefined && rEnzyme !== undefined) {
    const fOffset = regionOffset(fSite.cut, g) ?? 0;
    const rOffset = regionOffset(rSite.cut, g) ?? 0;
    const start = g.region.start;
    if (forward.enzyme === reverse.enzyme) {
      replaced = { start: start + fOffset, end: start + fOffset };
    } else {
      orientation = fOffset <= rOffset ? 'forward' : 'reverse';
      const f = { end: forward, site: fSite, offset: fOffset, enzyme: fEnzyme };
      const r = { end: reverse, site: rSite, offset: rOffset, enzyme: rEnzyme };
      const [low, high] = orientation === 'forward' ? [f, r] : [r, f];
      replaced = { start: start + low.offset, end: start + high.offset };
      // Room for both to cut (`endFlanks.ts`): once one enzyme has cut,
      // the other's site sits near a fresh end and wants its flank there.
      const a = layOut(low.site, start + low.offset, low.enzyme.site.length, g);
      const b = layOut(high.site, start + high.offset, high.enzyme.site.length, g);
      const flankB = b.siteStart - Math.max(a.cut, a.cutBottom);
      const flankA = Math.min(b.cut, b.cutBottom) - a.siteEnd;
      const needA = endFlank(low.end.enzyme);
      const needB = endFlank(high.end.enzyme);
      if (flankA < needA) {
        issues.push({ kind: 'tooClose', enzyme: low.end.enzyme, flank: flankA, needed: needA });
      }
      if (flankB < needB) {
        issues.push({ kind: 'tooClose', enzyme: high.end.enzyme, flank: flankB, needed: needB });
      }
      // Directional: the vector must not close on itself, and the insert
      // must not fit the other way round.
      const fEnd = forward.end;
      const rEnd = reverse.end;
      if (
        fEnd !== null &&
        rEnd !== null &&
        fEnd.kind !== 'blunt' &&
        rEnd.kind !== 'blunt' &&
        (endsCompatible(fEnd, rEnd) || endsCompatible(fEnd, flipEnd(rEnd)))
      ) {
        issues.push({ kind: 'compatibleEnds', forward: fEnd, reverse: rEnd });
      }
    }
  }
  return { forward, reverse, issues, usable: issues.length === 0, replaced, orientation };
}

/**
 * Judges any two enzymes, in the order they go on the primers, by the
 * same rules the suggestions use; the override's path, and decision 8's
 * re-check of a picked pair after the insert or region changed.
 */
export function evaluateEnzymePair(
  ctx: CloningContext,
  forward: string,
  reverse: string,
): EnzymePairReport {
  const lookup = new Lookup(ctx.enzymes);
  const f = enzymeEnd(ctx, lookup, forward) ?? unknownEnd(forward);
  const r = enzymeEnd(ctx, lookup, reverse) ?? unknownEnd(reverse);
  return pairReport(ctx, lookup, f, r);
}

/** The enzymes with a cut inside the region; for the whole-molecule fallback, those that cut once. */
function candidateNames(ctx: CloningContext): string[] {
  const g = geometryOf(ctx);
  const counts = new Map<string, number>();
  const inRegion = new Set<string>();
  for (const s of ctx.scans.vectorSites) {
    counts.set(s.enzyme, (counts.get(s.enzyme) ?? 0) + 1);
    if (regionOffset(s.cut, g) !== null) inRegion.add(s.enzyme);
  }
  const names = [...inRegion].filter(
    (name) => ctx.region.source !== 'whole' || counts.get(name) === 1,
  );
  return names.sort((a, b) => a.localeCompare(b));
}

function spacing(p: EnzymePairReport): number {
  return p.replaced === null ? -1 : p.replaced.end - p.replaced.start;
}

function comparePairs(a: EnzymePairReport, b: EnzymePairReport): number {
  if (a.usable !== b.usable) return a.usable ? -1 : 1;
  if (a.usable && spacing(a) !== spacing(b)) return spacing(b) - spacing(a);
  return (
    a.forward.enzyme.localeCompare(b.forward.enzyme) ||
    a.reverse.enzyme.localeCompare(b.reverse.enzyme)
  );
}

/**
 * Every pair of the region's enzymes, oriented for `ctx.flipped` (the
 * forward primer's enzyme is the lower cut's, or the higher one's when
 * flipped), usable pairs first — the wider the stretch between the cuts
 * the better, since both have room to cut — then the excluded ones with
 * their reasons. One enzyme with itself is listed and excluded (not
 * directional), since the override allows it.
 */
export function suggestEnzymePairs(
  ctx: CloningContext,
  picked: { readonly forward: string; readonly reverse: string } | null = null,
): EnzymePairSuggestions {
  const lookup = new Lookup(ctx.enzymes);
  const g = geometryOf(ctx);
  const candidates = candidateNames(ctx);
  const ends = new Map<string, EnzymeEnd>();
  for (const name of candidates) {
    const end = enzymeEnd(ctx, lookup, name);
    if (end !== null) ends.set(name, end);
  }
  const offsetOf = (end: EnzymeEnd): number =>
    end.site === null ? Infinity : (regionOffset(end.site.cut, g) ?? Infinity);
  const pairs: EnzymePairReport[] = [];
  const list = [...ends.values()];
  list.forEach((x, i) => {
    pairs.push(pairReport(ctx, lookup, x, x));
    list.slice(i + 1).forEach((y) => {
      const [lower, higher] =
        offsetOf(x) < offsetOf(y) || (offsetOf(x) === offsetOf(y) && x.enzyme < y.enzyme)
          ? [x, y]
          : [y, x];
      const [forward, reverse] = ctx.flipped ? [higher, lower] : [lower, higher];
      pairs.push(pairReport(ctx, lookup, forward, reverse));
    });
  });
  pairs.sort(comparePairs);
  return {
    pairs,
    usable: pairs.filter((p) => p.usable).length,
    candidates: [...ends.keys()],
    picked: picked === null ? null : evaluateEnzymePair(ctx, picked.forward, picked.reverse),
  };
}

/** One sentence per issue, for a reason column or a warning list. */
export function describePairIssue(issue: PairIssue): string {
  switch (issue.kind) {
    case 'unknownEnzyme':
      return `${issue.enzyme} is not in the enzyme set.`;
    case 'vectorCuts':
      return issue.count === 0
        ? `${issue.enzyme} does not cut the vector.`
        : `${issue.enzyme} cuts the vector ${issue.count} times.`;
    case 'outsideRegion':
      return `${issue.enzyme} cuts the vector outside the region.`;
    case 'methylation':
      return `${issue.enzyme}'s site on the vector is blocked by ${issue.marks.join(' and ')} methylation.`;
    case 'blunt':
      return `${issue.enzyme} leaves a blunt end.`;
    case 'typeIIS':
      return `${issue.enzyme} cuts outside its site (Type IIS).`;
    case 'sameEnzyme':
      return `One enzyme gives the same end twice: the insert can go in either way.`;
    case 'compatibleEnds':
      return `The two ends ligate to each other (${describeEnd(issue.forward)} and ${describeEnd(issue.reverse)}): not directional.`;
    case 'tooClose':
      return `${issue.enzyme} has ${issue.flank} ${issue.flank === 1 ? 'base' : 'bases'} beside its site once the other enzyme has cut; it wants ${issue.needed}.`;
    case 'cutsInsert':
      return `${issue.enzyme} cuts inside the insert after base ${issue.positions.join(', ')}.`;
  }
}

// ---------------------------------------------------------------- design

/** The parts of a cloning primer, 5′→3′, kept apart for the page to style. */
export interface PrimerSegments {
  readonly padding: string;
  /** The recognition site as it is on the oligo. */
  readonly site: string;
  /**
   * For a Type IIS enzyme: the bases between the site and the cut, then
   * the vector's own overhang, copied so the ends match. Empty otherwise.
   */
  readonly spacer: string;
  /** The 3′ part that anneals to the insert. */
  readonly annealing: string;
}

export interface CloningPrimer {
  /** `<insert>-F-<enzyme>` or `<insert>-R-<enzyme>`. */
  readonly name: string;
  /** The oligo 5′→3′: tail in lower case, annealing part in upper case. */
  readonly sequence: string;
  readonly segments: PrimerSegments;
  readonly enzyme: string;
  /** Tm of the annealing part alone, which is what the first cycle sees. */
  readonly tm: number;
  /** The designer's report on the annealing part. */
  readonly annealing: PrimerReport;
  /** The padding the enzyme made the design use when more than asked for; null otherwise. */
  readonly paddingRaised: number | null;
}

export type WarningSeverity = 'danger' | 'caution';

export interface CloningWarning {
  readonly kind:
    | PairIssue['kind']
    | 'paddingRaised'
    | 'junctionSite'
    | 'extraSite'
    | 'annealing'
    | 'notSpecific'
    | 'dimer'
    | 'vectorPieces'
    // Golden Gate ends (#310, item 113), which share these primers:
    | 'internalSite'
    | 'overhang'
    | 'frame'
    | 'ambiguous'
    | 'destination';
  /** `danger`: the clone will be wrong; `caution`: look before ordering. */
  readonly severity: WarningSeverity;
  readonly text: string;
  readonly enzyme?: string;
}

export interface CloningDesign {
  readonly pair: EnzymePairReport;
  readonly forward: CloningPrimer;
  readonly reverse: CloningPrimer;
  /** The PCR product the two make, top strand, as the design expects it. */
  readonly amplicon: string;
  /** Its length, tails and all. */
  readonly productLength: number;
  readonly warnings: readonly CloningWarning[];
  /** Why no primers could be made; the primers are empty then. */
  readonly problem: string | null;
  /** Runs the oligos: PCR, both digests, the ligation. */
  readonly simulate: () => CloningSimulation;
}

export interface CloningSimulation {
  /** The PCR product off the insert's document, or null when the primers made none. */
  readonly amplicon: SeqDocument | null;
  /** The vector with the insert in it, or null when something stopped it. */
  readonly product: SeqDocument | null;
  readonly problem: string | null;
  readonly warnings: readonly CloningWarning[];
}

/** The two names Save both uses: `ACT1-F-EcoRI`, `ACT1-R-BamHI`. */
export function cloningPrimerNames(
  insert: string,
  forward: string,
  reverse: string,
): { readonly forward: string; readonly reverse: string } {
  const base = insert.trim().replace(/\s+/g, '_') || 'insert';
  return { forward: `${base}-F-${forward}`, reverse: `${base}-R-${reverse}` };
}

/** Where the site sits on a tail and how it cuts there, in tail coordinates from the site's start. */
export interface TailSite {
  readonly bases: string;
  readonly cutTop: number;
  readonly cutBottom: number;
}

/**
 * The site as the primer at a junction carries it. At the lower cut the
 * primer runs along the vector's top strand into the insert, so it copies
 * the vector's own bases there; at the higher cut it runs along the bottom
 * strand, so it copies their reverse complement. Copying the vector's
 * bases, rather than the table's IUPAC site, makes the overhangs match for
 * a degenerate site (AccI's GTMKAC) and a non-palindromic one alike. A
 * Type IIS site instead points into the insert whichever strand the
 * vector's is on, and the overhang is copied separately.
 */
function tailSite(
  ctx: CloningContext,
  enzyme: Enzyme,
  site: CutSite,
  junction: 'lower' | 'higher',
): TailSite {
  const g = geometryOf(ctx);
  const n = enzyme.site.length;
  const topBases = ctx.vector
    .subsequence({ start: site.siteStart, end: site.siteStart + n })
    .toUpperCase();
  if (isTypeIIS(enzyme)) {
    const tableBases = site.strand === 'forward' ? topBases : reverseComplement(topBases);
    const rightward = Math.max(enzyme.cutTop, enzyme.cutBottom) > n;
    return rightward
      ? { bases: tableBases, cutTop: enzyme.cutTop, cutBottom: enzyme.cutBottom }
      : {
          bases: reverseComplement(tableBases),
          cutTop: n - enzyme.cutBottom,
          cutBottom: n - enzyme.cutTop,
        };
  }
  const laid = layOut(site, site.cut, n, g);
  const cutTop = laid.cut - laid.siteStart;
  const cutBottom = laid.cutBottom - laid.siteStart;
  return junction === 'lower'
    ? { bases: topBases, cutTop, cutBottom }
    : { bases: reverseComplement(topBases), cutTop: n - cutBottom, cutBottom: n - cutTop };
}

/** Small seeded PRNG (mulberry32), so a design is the same each time it is made. */
function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const FREE_BASE_TRIES = 256;

/** Random bases with no run of three, the free bases of a tail are drawn from. */
function freeBases(rand: () => number, n: number): string {
  let out = '';
  while (out.length < n) {
    const b = 'ACGT'.charAt(Math.floor(rand() * 4));
    if (out.length >= 2 && out.endsWith(b + b)) continue;
    out += b;
  }
  return out;
}

export interface TailPlan {
  readonly enzyme: Enzyme;
  readonly site: TailSite;
  /** The overhang the insert's end must carry, in the primer's own direction; empty for a cut inside the site. */
  readonly overhang: string;
  readonly padding: number;
}

export interface Tail {
  readonly segments: Omit<PrimerSegments, 'annealing'>;
  /** Whether the free bases make no site of the enzymes checked. */
  readonly clean: boolean;
}

/**
 * The tail: padding, site, and for a Type IIS enzyme the spacer and the
 * overhang. The padding and spacer bases are free, and are drawn until
 * none of `check` has a site touching them (the intended site, at the
 * padding's end, is allowed); past `FREE_BASE_TRIES` the first draw stands.
 */
export function buildTail(
  plan: TailPlan,
  annealing: string,
  check: readonly Enzyme[],
  avoid: boolean,
  seed: number,
): Tail {
  const n = plan.site.bases.length;
  const spacerLength = isTypeIIS(plan.enzyme)
    ? Math.max(0, Math.min(plan.site.cutTop, plan.site.cutBottom) - n)
    : 0;
  const rand = seeded(seed);
  let first: Tail | null = null;
  for (let i = 0; i < (avoid ? FREE_BASE_TRIES : 1); i++) {
    const padding = freeBases(rand, plan.padding);
    const spacer = freeBases(rand, spacerLength) + plan.overhang.toUpperCase();
    const segments = { padding, site: plan.site.bases, spacer };
    const tail = padding + plan.site.bases + spacer;
    const window = tail + annealing;
    const free = [
      { start: 0, end: padding.length },
      { start: padding.length + n, end: padding.length + n + spacerLength },
    ].filter((f) => f.end > f.start);
    const sites = findCutSites(window, 'linear', check);
    const clean =
      !avoid ||
      sites.every((s) => {
        const length =
          s.enzyme === plan.enzyme.name
            ? n
            : (check.find((e) => e.name === s.enzyme)?.site.length ?? n);
        const intended = s.enzyme === plan.enzyme.name && s.siteStart === padding.length;
        const touchesFree = free.some((f) => s.siteStart < f.end && s.siteStart + length > f.start);
        return intended || !touchesFree;
      });
    const made = { segments, clean };
    if (clean) return made;
    first ??= made;
  }
  return first ?? { segments: { padding: '', site: plan.site.bases, spacer: '' }, clean: false };
}

function severityOf(issue: PairIssue): WarningSeverity {
  switch (issue.kind) {
    case 'unknownEnzyme':
    case 'vectorCuts':
    case 'outsideRegion':
    case 'methylation':
    case 'cutsInsert':
      return 'danger';
    case 'blunt':
    case 'typeIIS':
    case 'sameEnzyme':
    case 'compatibleEnds':
    case 'tooClose':
      return 'caution';
  }
}

function issueWarning(issue: PairIssue): CloningWarning {
  const text = describePairIssue(issue);
  const enzyme = 'enzyme' in issue ? issue.enzyme : undefined;
  const advice: Partial<Record<PairIssue['kind'], string>> = {
    sameEnzyme: ' Dephosphorylate the vector and screen the orientation.',
    compatibleEnds: ' Dephosphorylate the vector and screen the orientation.',
    tooClose: ' Digest with one enzyme, then the other.',
    typeIIS:
      ' The site is placed 5′ of the cut with the vector’s overhang copied after it, so the product keeps no site at that junction; for a part with overhangs of your own, switch Ends to Golden Gate part.',
    cutsInsert: ' The digest will cut the insert too.',
    vectorCuts: ' The simulated product uses the cut inside the region.',
  };
  return {
    kind: issue.kind,
    severity: severityOf(issue),
    text: text + (advice[issue.kind] ?? ''),
    ...(enzyme === undefined ? {} : { enzyme }),
  };
}

export function emptyPrimer(name: string, enzyme: string): CloningPrimer {
  return {
    name,
    sequence: '',
    segments: { padding: '', site: '', spacer: '', annealing: '' },
    enzyme,
    tm: NaN,
    annealing: {
      sequence: '',
      length: 0,
      tm: NaN,
      gc: 0,
      homopolymer: 0,
      selfDimerDg: 0,
      hairpinDg: 0,
      hairpinTm: 0,
      threePrimeSelf: 0,
      gcClamp: false,
      degenerate: 0,
      molecules: 1,
      tmRange: null,
      gcRange: { min: 0, max: 0 },
      warnings: [],
    },
    paddingRaised: null,
  };
}

function failedDesign(
  pair: EnzymePairReport,
  names: { readonly forward: string; readonly reverse: string },
  problem: string,
  warnings: readonly CloningWarning[],
): CloningDesign {
  return {
    pair,
    forward: emptyPrimer(names.forward, pair.forward.enzyme),
    reverse: emptyPrimer(names.reverse, pair.reverse.enzyme),
    amplicon: '',
    productLength: 0,
    warnings,
    problem,
    simulate: () => ({ amplicon: null, product: null, problem, warnings }),
  };
}

/**
 * The two oligos for `pair` on `ctx`'s insert, with the warnings the pair's
 * issues and the oligos themselves raise, and `simulate` to run them. A
 * pair the suggestions excluded is designed all the same (the override):
 * its reasons come back as warnings, danger or caution, and the simulated
 * product shows the consequence.
 */
export function designCloningEnds(
  ctx: CloningContext,
  pair: { readonly forward: string; readonly reverse: string },
  settings: Partial<CloningSettings> = {},
): CloningDesign {
  const s: CloningSettings = { ...CLONING_DEFAULTS, ...settings };
  const criteria: PrimerCriteria = { ...DEFAULT_PRIMER_CRITERIA, ...s.criteria };
  const lookup = new Lookup(ctx.enzymes);
  const report = evaluateEnzymePair(ctx, pair.forward, pair.reverse);
  const names = cloningPrimerNames(ctx.insert.name, pair.forward, pair.reverse);
  const warnings: CloningWarning[] = report.issues.map(issueWarning);

  const fEnzyme = lookup.get(pair.forward);
  const rEnzyme = lookup.get(pair.reverse);
  if (fEnzyme === undefined || rEnzyme === undefined) {
    return failedDesign(
      report,
      names,
      `${fEnzyme === undefined ? pair.forward : pair.reverse} is not in the enzyme set.`,
      warnings,
    );
  }
  const fSite = report.forward.site;
  const rSite = report.reverse.site;
  if (fSite === null || rSite === null) {
    const missing = fSite === null ? pair.forward : pair.reverse;
    return failedDesign(
      report,
      names,
      `${missing} does not cut the vector inside the region, so there is no end for the insert to match.`,
      warnings,
    );
  }
  const insert = insertSequence(ctx.insert);
  const anchored = designAnchoredPrimers(insert, criteria);
  if (anchored === null) {
    return failedDesign(
      report,
      names,
      `The ${insert.length.toLocaleString()} bp insert is too short to amplify: a primer needs ${criteria.minLength} bases at each end.`,
      warnings,
    );
  }
  if (!anchored.withinCriteria) {
    const broken = [...anchored.forward.warnings, ...anchored.reverse.warnings];
    warnings.push({
      kind: 'annealing',
      severity: 'caution',
      text: `No annealing part at the insert's ends meets the settings; the nearest ${broken.length > 0 ? `(${[...new Set(broken)].join('; ')})` : ''} is used.`,
    });
  }

  // Each primer runs from the vector into the insert: along the top strand
  // at the lower cut, along the bottom strand at the higher one.
  const fJunction = report.orientation === 'forward' ? 'lower' : 'higher';
  const rJunction = fJunction === 'lower' ? 'higher' : 'lower';
  const overhangFor = (
    end: FragmentEnd | null,
    junction: 'lower' | 'higher',
    enzyme: Enzyme,
  ): string => {
    if (end === null || !isTypeIIS(enzyme)) return '';
    return junction === 'lower' ? end.overhang : reverseComplement(end.overhang);
  };
  const paddingFor = (
    enzyme: string,
  ): { readonly used: number; readonly raised: number | null } => {
    const need = endFlank(enzyme);
    return need > s.padding ? { used: need, raised: need } : { used: s.padding, raised: null };
  };
  const fPadding = paddingFor(pair.forward);
  const rPadding = paddingFor(pair.reverse);
  const fPlan: TailPlan = {
    enzyme: fEnzyme,
    site: tailSite(ctx, fEnzyme, fSite, fJunction),
    overhang: overhangFor(report.forward.end, fJunction, fEnzyme),
    padding: fPadding.used,
  };
  const rPlan: TailPlan = {
    enzyme: rEnzyme,
    site: tailSite(ctx, rEnzyme, rSite, rJunction),
    overhang: overhangFor(report.reverse.end, rJunction, rEnzyme),
    padding: rPadding.used,
  };
  // Free bases must make no site of the two enzymes nor of any the
  // suggestions would list: the user may yet pick another pair.
  const checkNames = new Set([pair.forward, pair.reverse, ...candidateNames(ctx)]);
  const check = [...checkNames]
    .map((name) => lookup.get(name))
    .filter((e): e is Enzyme => e !== undefined);
  const fTail = buildTail(fPlan, anchored.forward.sequence, check, s.avoidJunctionSites, 0x303);
  const rTail = buildTail(rPlan, anchored.reverse.sequence, check, s.avoidJunctionSites, 0x303 + 1);
  for (const [tail, enzyme] of [
    [fTail, pair.forward],
    [rTail, pair.reverse],
  ] as const) {
    if (!tail.clean) {
      warnings.push({
        kind: 'junctionSite',
        severity: 'caution',
        enzyme,
        text: `No padding found for the ${enzyme} tail that makes no new site where it meets the insert; check the sites on the amplicon.`,
      });
    }
  }
  for (const [padding, enzyme] of [
    [fPadding, pair.forward],
    [rPadding, pair.reverse],
  ] as const) {
    if (padding.raised !== null) {
      warnings.push({
        kind: 'paddingRaised',
        severity: 'caution',
        enzyme,
        text: `Padding ${padding.raised} nt: ${enzyme} cuts poorly within ${padding.raised - 1} nt of an end.`,
      });
    }
  }

  const primer = (
    name: string,
    enzyme: string,
    tail: Tail,
    annealing: PrimerReport,
    raised: number | null,
  ): CloningPrimer => {
    const segments: PrimerSegments = { ...tail.segments, annealing: annealing.sequence };
    const lower = (segments.padding + segments.site + segments.spacer).toLowerCase();
    return {
      name,
      sequence: lower + segments.annealing.toUpperCase(),
      segments,
      enzyme,
      tm: annealing.tm,
      annealing,
      paddingRaised: raised,
    };
  };
  const forward = primer(names.forward, pair.forward, fTail, anchored.forward, fPadding.raised);
  const reverse = primer(names.reverse, pair.reverse, rTail, anchored.reverse, rPadding.raised);

  // The amplicon as designed, scanned again for both enzymes (decision 6):
  // a site beyond the two intended is a cut the digest will make.
  const body = insert.slice(anchored.forward.length, insert.length - anchored.reverse.length);
  const amplicon =
    forward.sequence.toUpperCase() + body + reverseComplement(reverse.sequence.toUpperCase());
  const fTailLength = forward.sequence.length - anchored.forward.length;
  const rTailLength = reverse.sequence.length - anchored.reverse.length;
  const insertBody: Range = { start: fTailLength, end: amplicon.length - rTailLength };
  const intended = (site: CutSite): boolean =>
    (site.enzyme === pair.forward && site.siteStart === fTail.segments.padding.length) ||
    (site.enzyme === pair.reverse &&
      site.siteStart === amplicon.length - rTail.segments.padding.length - rPlan.site.bases.length);
  // A cut the pair's `cutsInsert` already reported, in amplicon coordinates.
  const reported = new Set(
    [report.forward, report.reverse].flatMap((end) =>
      end.insertCuts.map((cut) => `${end.enzyme}:${cut + insertBody.start}`),
    ),
  );
  const extra = findCutSites(amplicon, 'linear', [fEnzyme, rEnzyme]).filter(
    // A site wholly inside the insert is the pair's own `cutsInsert`, unless
    // the insert's scan dropped it: a Type IIS site at the insert's edge
    // whose cut falls outside the stretch, which here lands in the tail.
    (site) => !intended(site) && !reported.has(`${site.enzyme}:${site.cut}`),
  );
  for (const site of extra) {
    warnings.push({
      kind: 'extraSite',
      severity: 'danger',
      enzyme: site.enzyme,
      text: `${site.enzyme} has another site on the amplicon, at ${cutLabel(site.cut, amplicon.length, 'linear')}, where a tail meets the insert.`,
    });
  }

  // The annealing parts on their own template, and the oligos on each other.
  const template = ctx.insert.document.sequence.toString();
  for (const [p, strand] of [
    [forward, 'forward'],
    [reverse, 'reverse'],
  ] as const) {
    const hits = findPrimerBindingSites(
      template,
      ctx.insert.document.topology,
      p.segments.annealing,
    );
    const elsewhere = hits.length - 1;
    if (elsewhere > 0) {
      warnings.push({
        kind: 'notSpecific',
        severity: 'caution',
        enzyme: p.enzyme,
        text: `The ${strand} primer's annealing part also binds ${ctx.insert.document.name} at ${elsewhere} other ${elsewhere === 1 ? 'place' : 'places'}.`,
      });
    }
  }
  const dimers = primerDimers([
    { name: names.forward, sequence: forward.sequence },
    { name: names.reverse, sequence: reverse.sequence },
  ]);
  if (dimers.length > 0) {
    const worst = Math.max(...dimers.map((d) => d.bases));
    warnings.push({
      kind: 'dimer',
      severity: 'caution',
      text: `The oligos pair at a 3′ end over ${worst} bases: a primer dimer a polymerase could extend.`,
    });
  }

  return {
    pair: report,
    forward,
    reverse,
    amplicon,
    productLength: amplicon.length,
    warnings,
    problem: null,
    simulate: () => simulate(ctx, lookup, report, forward, reverse, insert, warnings),
  };
}

/** Picks the fragment of a digest that still holds all of `bases`. */
function fragmentHolding(
  fragments: readonly DigestFragment[],
  bases: string,
): DigestFragment | undefined {
  const upper = bases.toUpperCase();
  return fragments.find((f) => f.sequence.toUpperCase().includes(upper));
}

function simulate(
  ctx: CloningContext,
  lookup: Lookup,
  report: EnzymePairReport,
  forward: CloningPrimer,
  reverse: CloningPrimer,
  insert: string,
  designWarnings: readonly CloningWarning[],
): CloningSimulation {
  const warnings: CloningWarning[] = [...designWarnings];
  const fail = (problem: string, amplicon: SeqDocument | null = null): CloningSimulation => ({
    amplicon,
    product: null,
    problem,
    warnings,
  });
  const enzymes = [...new Set([forward.enzyme, reverse.enzyme])]
    .map((name) => lookup.get(name))
    .filter((e): e is Enzyme => e !== undefined);
  const siteLength = (name: string): number => lookup.get(name)?.site.length ?? 0;

  // PCR on the insert's own document, which is where the primers anneal.
  const reaction = pcr(ctx.insert.document, [
    { name: forward.name, sequence: forward.sequence },
    { name: reverse.name, sequence: reverse.sequence },
  ]);
  // `pcr` reads the product along the template's top strand, so an insert
  // on the bottom strand comes out reverse-complemented; turned back, the
  // amplicon reads as the insert does, forward primer first.
  const made = productHolding(reaction.products, insert);
  const turned =
    made === undefined ? productHolding(reaction.products, reverseComplement(insert)) : undefined;
  const amplicon = made?.document ?? turned?.document.reverseComplement();
  if (amplicon === undefined) {
    return fail(
      reaction.problem ??
        `The primers amplify ${reaction.products.length} other ${reaction.products.length === 1 ? 'product' : 'products'} of ${ctx.insert.document.name} but not the insert.`,
    );
  }

  // The amplicon is unmethylated (`pcr`): every site cuts.
  const ampliconSites = findCutSites(amplicon.sequence.toString(), 'linear', enzymes);
  const pieces = digest(amplicon, ampliconSites);
  const insertPiece = fragmentHolding(pieces, insert);
  if (insertPiece === undefined) {
    const inside = enzymes
      .filter((e) =>
        ampliconSites.some(
          (s) =>
            s.enzyme === e.name &&
            s.cut > forward.sequence.length &&
            s.cut < amplicon.length - reverse.sequence.length,
        ),
      )
      .map((e) => e.name);
    return fail(
      inside.length > 0
        ? `${inside.join(' and ')} ${inside.length === 1 ? 'cuts' : 'cut'} inside the insert, so no fragment of the digest holds all of it.`
        : 'No fragment of the digested amplicon holds the whole insert.',
      amplicon,
    );
  }

  // The vector, cut where its host's methylation lets the two enzymes cut.
  const vector = ctx.vector;
  const L = vector.length;
  const text = vector.sequence.toString();
  const wanted = ctx.scans.vectorSites.filter(
    (s) => s.enzyme === forward.enzyme || s.enzyme === reverse.enzyme,
  );
  const cuttable = cuttableSites(text, vector.topology, vector.methylation, wanted, siteLength);
  const fragments = digest(vector, cuttable);
  const replaced = report.replaced;
  if (replaced === null) return fail('The pair has no cut inside the region.', amplicon);
  const lowCut = vector.isCircular ? wrapMod(replaced.start, L) : replaced.start;
  const highCut = vector.isCircular ? wrapMod(replaced.end, L) : replaced.end;
  const sameEnzyme = forward.enzyme === reverse.enzyme;

  const placed = report.orientation === 'reverse' ? flipFragment(insertPiece) : insertPiece;
  let parts: DigestFragment[];
  let circular: boolean;
  if (vector.isCircular) {
    const backbone = fragments.find((f) => f.range.start === highCut);
    if (backbone === undefined) {
      return fail(
        blockedText(ctx, report, highCut === lowCut ? forward.enzyme : enzymeAt(report, 'higher')),
        amplicon,
      );
    }
    const backboneEnd = wrapMod(backbone.range.end, L);
    if (!sameEnzyme && backboneEnd !== lowCut) {
      if (!cuttable.some((s) => wrapMod(s.cut, L) === lowCut)) {
        return fail(blockedText(ctx, report, enzymeAt(report, 'lower')), amplicon);
      }
      warnings.push(vectorPiecesWarning(backbone, vector));
    }
    parts = [backbone, placed];
    circular = true;
  } else {
    const left = fragments.find((f) => f.range.end === lowCut);
    const right = fragments.find((f) => f.range.start === highCut);
    if (left === undefined)
      return fail(blockedText(ctx, report, enzymeAt(report, 'lower')), amplicon);
    if (right === undefined)
      return fail(blockedText(ctx, report, enzymeAt(report, 'higher')), amplicon);
    if (left.range.start !== 0 || right.range.end !== L)
      warnings.push(vectorPiecesWarning(left.range.start !== 0 ? left : right, vector));
    parts = [left, placed, right];
    circular = false;
  }

  const bad = assemblyJunctions(parts, circular).find((j) => !j.compatible);
  if (bad !== undefined) {
    return fail(
      `The ends do not match: ${describeEnd(bad.from)} cannot be joined to ${describeEnd(bad.to)}.`,
      amplicon,
    );
  }
  let product = ligate(parts, {
    name: `${vector.name}-${ctx.insert.name}`,
    circular,
    metadata: {
      description: `${ctx.insert.name} cloned into ${vector.name} with ${forward.enzyme}${sameEnzyme ? '' : ` and ${reverse.enzyme}`}`,
    },
  });
  // Keep the vector's numbering when its first base survived the cut.
  if (
    circular &&
    !rangeContains({ start: lowCut, end: lowCut + (replaced.end - replaced.start) }, 0, L)
  ) {
    const origin = wrapMod(L - highCut, L);
    if (origin !== 0 && origin < product.length) product = product.setOrigin(origin);
  }
  return { amplicon, product, problem: null, warnings };
}

function enzymeAt(report: EnzymePairReport, junction: 'lower' | 'higher'): string {
  const forwardIsLower = report.orientation === 'forward';
  const wantLower = junction === 'lower';
  return wantLower === forwardIsLower ? report.forward.enzyme : report.reverse.enzyme;
}

function blockedText(ctx: CloningContext, report: EnzymePairReport, enzyme: string): string {
  const end = report.forward.enzyme === enzyme ? report.forward : report.reverse;
  return end.blocked.length > 0
    ? `${enzyme} does not cut ${ctx.vector.name}: its site is blocked by ${end.blocked.join(' and ')} methylation.`
    : `${enzyme} does not cut ${ctx.vector.name} inside the region.`;
}

function vectorPiecesWarning(piece: DigestFragment, vector: SeqDocument): CloningWarning {
  return {
    kind: 'vectorPieces',
    severity: 'danger',
    text: `${vector.name} is cut more than twice; the simulated product uses the ${piece.sequence.length.toLocaleString()} bp piece next to the region, which is not the whole backbone.`,
  };
}

// ---------------------------------------------------------------- results

export interface CloningResults {
  readonly picked: CloningDesign;
  /** Up to `maxAlternatives` other usable pairs, in the suggestions' rank, designed with the same settings. */
  readonly alternatives: readonly CloningDesign[];
}

/**
 * The Results page's rows: the picked pair first, then the other usable
 * pairs the suggestions rank highest, each designed the same way.
 */
export function designCloningResults(
  ctx: CloningContext,
  picked: { readonly forward: string; readonly reverse: string },
  settings: Partial<CloningSettings> = {},
): CloningResults {
  const s: CloningSettings = { ...CLONING_DEFAULTS, ...settings };
  const suggestions = suggestEnzymePairs(ctx);
  const same = (p: EnzymePairReport): boolean =>
    p.forward.enzyme === picked.forward && p.reverse.enzyme === picked.reverse;
  const alternatives = suggestions.pairs
    .filter((p) => p.usable && !same(p))
    .slice(0, Math.max(0, s.maxAlternatives))
    .map((p) =>
      designCloningEnds(ctx, { forward: p.forward.enzyme, reverse: p.reverse.enzyme }, s),
    );
  return { picked: designCloningEnds(ctx, picked, s), alternatives };
}
