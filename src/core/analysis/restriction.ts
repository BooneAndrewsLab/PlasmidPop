import { type OverhangKind } from '../document';
import { type Topology } from '../range';
import { reverseComplement } from '../sequence';
import { ENZYME_TABLE } from './enzymeTable';
import { matchPositions, patternMasks, sequenceMasks } from './search';

export interface Enzyme {
  readonly name: string;
  /** Recognition site 5'→3', IUPAC. */
  readonly site: string;
  /** Top-strand cut offset from the site start (may exceed the site or be negative). */
  readonly cutTop: number;
  /** Bottom-strand cut offset from the site start, in top-strand coordinates. */
  readonly cutBottom: number;
  /** Site reads the same on both strands, so one match is one cut. */
  readonly palindromic: boolean;
  /**
   * REBASE one-letter codes of the companies that sell it, absent for the
   * bundled table and for an enzyme nobody sells. See `EnzymeSet.suppliers`
   * for what the letters stand for.
   */
  readonly suppliers?: readonly string[];
  /** Other enzymes with the same specificity, as REBASE lists them. */
  readonly isoschizomers?: readonly string[];
  /**
   * Where the enzyme's *own* methyltransferase methylates its site, in
   * REBASE's notation (`3(6)` is N6-methyladenine at base 3). This is not
   * Dam/Dcm sensitivity, which REBASE keeps elsewhere; see docs/design/07-rebase-enzymes.md.
   */
  readonly methylation?: string;
}

export function overhangKind(e: Pick<Enzyme, 'cutTop' | 'cutBottom'>): OverhangKind {
  if (e.cutTop === e.cutBottom) return 'blunt';
  return e.cutTop < e.cutBottom ? "5'" : "3'";
}

export function overhangLength(e: Pick<Enzyme, 'cutTop' | 'cutBottom'>): number {
  return Math.abs(e.cutTop - e.cutBottom);
}

/**
 * Whether the enzyme cuts outside its recognition site, the defining trait of
 * a Type IIS enzyme (BsaI, BsmBI, BbsI, SapI). It is what makes Golden Gate
 * work: the cut leaves an overhang of the user's own choosing and takes the
 * site away with the piece that is thrown out.
 */
export function isTypeIIS(e: Pick<Enzyme, 'site' | 'cutTop' | 'cutBottom'>): boolean {
  const n = e.site.length;
  return e.cutTop < 0 || e.cutTop > n || e.cutBottom < 0 || e.cutBottom > n;
}

/** Whether a recognition sequence reads the same on both strands. */
export function isPalindromicSite(site: string): boolean {
  return reverseComplement(site).toUpperCase() === site.toUpperCase();
}

/** The table that ships with the app: common cloning enzymes, no more. */
export const ENZYMES: readonly Enzyme[] = ENZYME_TABLE.map(([name, site, cutTop, cutBottom]) => ({
  name,
  site,
  cutTop,
  cutBottom,
  palindromic: isPalindromicSite(site),
}));

/**
 * A named list of enzymes: the bundled table, or one the user imported from
 * a REBASE file of their own. We never ship REBASE data — see
 * `src/io/rebase/withrefm.ts` — so a bigger table is always the user's copy,
 * held in their browser.
 */
export interface EnzymeSet {
  /** `bundled`, or `rebase` for an imported one. */
  readonly id: string;
  /** What to call it in the UI, e.g. `REBASE 609`. */
  readonly label: string;
  readonly enzymes: readonly Enzyme[];
  /** Supplier letter to company name, empty for the bundled table. */
  readonly suppliers: readonly { readonly code: string; readonly name: string }[];
}

export const BUNDLED_ENZYME_SET: EnzymeSet = {
  id: 'bundled',
  label: 'Bundled table',
  enzymes: ENZYMES,
  suppliers: [],
};

/** The bundled table by lowercased name; also the fallback in `getEnzyme`. */
const BUNDLED_BY_NAME: ReadonlyMap<string, Enzyme> = new Map(
  ENZYMES.map((e) => [e.name.toLowerCase(), e] as const),
);

let activeSet: EnzymeSet = BUNDLED_ENZYME_SET;
let byName: ReadonlyMap<string, Enzyme> = BUNDLED_BY_NAME;

/**
 * The set every scan, digest and panel works from. It is module state
 * rather than a parameter because the alternative is threading an enzyme
 * list through every caller of `findCutSites`; the worker keeps its own
 * copy, which `AnalysisClient` sets whenever it starts one.
 */
export function activeEnzymeSet(): EnzymeSet {
  return activeSet;
}

export function activeEnzymes(): readonly Enzyme[] {
  return activeSet.enzymes;
}

/** Installs a set, or the bundled table when given null. */
export function setActiveEnzymeSet(set: EnzymeSet | null): void {
  activeSet = set ?? BUNDLED_ENZYME_SET;
  byName =
    activeSet === BUNDLED_ENZYME_SET
      ? BUNDLED_BY_NAME
      : new Map(activeSet.enzymes.map((e) => [e.name.toLowerCase(), e] as const));
}

/**
 * An enzyme by name from the active set, falling back to the bundled table
 * so a name remembered from before an import (a ticked enzyme, a fragment's
 * end) still resolves.
 */
export function getEnzyme(name: string): Enzyme | undefined {
  const key = name.toLowerCase();
  return byName.get(key) ?? BUNDLED_BY_NAME.get(key);
}

export interface CutSite {
  readonly enzyme: string;
  /** Where the top strand is cut: the index of the first base after the cut, 0..length. */
  readonly cut: number;
  /** Where the bottom strand is cut, in top-strand coordinates (may differ for overhangs). */
  readonly cutBottom: number;
  /** Start of the recognition site, 0..length-1. */
  readonly siteStart: number;
  /** Whether the site was matched on the forward or reverse strand (always forward for palindromes). */
  readonly strand: 'forward' | 'reverse';
}

function wrap(position: number, length: number, topology: Topology): number | null {
  if (topology === 'circular') return length === 0 ? 0 : ((position % length) + length) % length;
  return position < 0 || position > length ? null : position;
}

/**
 * Finds every cut site of the given enzymes. On circular sequences sites
 * and cuts may straddle the origin. On linear sequences a Type IIS cut that
 * would fall outside the molecule is dropped.
 */
export function findCutSites(
  sequence: string,
  topology: Topology,
  enzymes: readonly Enzyme[] = activeEnzymes(),
): CutSite[] {
  const L = sequence.length;
  if (L === 0) return [];
  const longestSite = Math.max(0, ...enzymes.map((e) => e.site.length));
  // Extend circular sequences so sites spanning the origin are seen once.
  const extended =
    topology === 'circular' ? sequence + sequence.slice(0, Math.min(L, longestSite - 1)) : sequence;
  const masks = sequenceMasks(extended);
  const out: CutSite[] = [];

  // Enzymes that share a recognition sequence share its matches, and
  // isoschizomers are everywhere: a REBASE import of 1,581 enzymes has only
  // 346 distinct sites between them. Matching once per site rather than once
  // per enzyme is what keeps a full imported table scannable
  // (docs/perf-notes.md).
  const bySite = new Map<string, Enzyme[]>();
  for (const enzyme of enzymes) {
    const key = enzyme.site.toUpperCase();
    const group = bySite.get(key);
    if (group === undefined) bySite.set(key, [enzyme]);
    else group.push(enzyme);
  }

  for (const [site, group] of bySite) {
    const n = site.length;
    const maxStart = topology === 'circular' ? L - 1 : L - n;
    const forward = matchPositions(masks, patternMasks(site), maxStart);
    // A site on the bottom strand reads as its reverse complement on top; the
    // cut offsets mirror around the site. Palindromy follows from the site, so
    // every enzyme in the group agrees about whether there is a reverse pass.
    const reverse =
      (group[0]?.palindromic ?? true)
        ? []
        : matchPositions(masks, patternMasks(reverseComplement(site)), maxStart);

    for (const enzyme of group) {
      const push = (
        siteStart: number,
        cutTop: number,
        cutBottom: number,
        strand: CutSite['strand'],
      ): void => {
        const cut = wrap(cutTop, L, topology);
        const bottom = wrap(cutBottom, L, topology);
        if (cut === null || bottom === null) return;
        out.push({ enzyme: enzyme.name, cut, cutBottom: bottom, siteStart: siteStart % L, strand });
      };
      for (const start of forward) {
        push(start, start + enzyme.cutTop, start + enzyme.cutBottom, 'forward');
      }
      for (const start of reverse) {
        push(start, start + n - enzyme.cutBottom, start + n - enzyme.cutTop, 'reverse');
      }
    }
  }
  out.sort((a, b) => a.cut - b.cut || a.enzyme.localeCompare(b.enzyme));
  return out;
}

export interface EnzymeSummary {
  readonly enzyme: Enzyme;
  readonly sites: readonly CutSite[];
}

/** Cut sites grouped per enzyme, including enzymes that do not cut (empty list). */
export function summarizeEnzymes(
  sites: readonly CutSite[],
  enzymes: readonly Enzyme[] = activeEnzymes(),
): EnzymeSummary[] {
  const byName = new Map<string, CutSite[]>();
  for (const s of sites) {
    const list = byName.get(s.enzyme) ?? [];
    list.push(s);
    byName.set(s.enzyme, list);
  }
  return enzymes.map((enzyme) => ({ enzyme, sites: byName.get(enzyme.name) ?? [] }));
}

export interface Fragment {
  readonly start: number;
  readonly end: number;
  readonly length: number;
}

/** Fragments produced by cutting at the given top-strand cut positions. */
export function digestFragments(
  cuts: readonly number[],
  seqLength: number,
  topology: Topology,
): Fragment[] {
  const unique = [...new Set(cuts.filter((c) => c >= 0 && c <= seqLength))].sort((a, b) => a - b);
  if (seqLength === 0) return [];
  if (topology === 'linear') {
    const bounds = [0, ...unique.filter((c) => c > 0 && c < seqLength), seqLength];
    const out: Fragment[] = [];
    for (let i = 1; i < bounds.length; i++) {
      const start = bounds[i - 1] ?? 0;
      const end = bounds[i] ?? seqLength;
      out.push({ start, end, length: end - start });
    }
    return out;
  }
  const points = [...new Set(unique.map((c) => c % seqLength))].sort((a, b) => a - b);
  if (points.length === 0) return [{ start: 0, end: seqLength, length: seqLength }];
  if (points.length === 1) {
    const p = points[0] ?? 0;
    return [{ start: p, end: p + seqLength, length: seqLength }];
  }
  return points.map((p, i) => {
    const next = points[(i + 1) % points.length] ?? p;
    const end = next > p ? next : next + seqLength;
    return { start: p, end, length: end - p };
  });
}
