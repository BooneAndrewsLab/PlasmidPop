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

function isPalindromic(site: string): boolean {
  return reverseComplement(site).toUpperCase() === site.toUpperCase();
}

export const ENZYMES: readonly Enzyme[] = ENZYME_TABLE.map(([name, site, cutTop, cutBottom]) => ({
  name,
  site,
  cutTop,
  cutBottom,
  palindromic: isPalindromic(site),
}));

const ENZYME_BY_NAME = new Map(ENZYMES.map((e) => [e.name.toLowerCase(), e] as const));

export function getEnzyme(name: string): Enzyme | undefined {
  return ENZYME_BY_NAME.get(name.toLowerCase());
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
  enzymes: readonly Enzyme[] = ENZYMES,
): CutSite[] {
  const L = sequence.length;
  if (L === 0) return [];
  const longestSite = Math.max(0, ...enzymes.map((e) => e.site.length));
  // Extend circular sequences so sites spanning the origin are seen once.
  const extended =
    topology === 'circular' ? sequence + sequence.slice(0, Math.min(L, longestSite - 1)) : sequence;
  const masks = sequenceMasks(extended);
  const out: CutSite[] = [];

  for (const enzyme of enzymes) {
    const n = enzyme.site.length;
    const maxStart = topology === 'circular' ? L - 1 : L - n;
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
    for (const start of matchPositions(masks, patternMasks(enzyme.site), maxStart)) {
      push(start, start + enzyme.cutTop, start + enzyme.cutBottom, 'forward');
    }
    if (!enzyme.palindromic) {
      // A site on the bottom strand reads as its reverse complement on top;
      // the cut offsets mirror around the site.
      for (const start of matchPositions(
        masks,
        patternMasks(reverseComplement(enzyme.site)),
        maxStart,
      )) {
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
  enzymes: readonly Enzyme[] = ENZYMES,
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
