import { type CutSite } from '../analysis/restriction';
import {
  type DocumentEnds,
  type OverhangKind,
  type StrandEnd,
  BLUNT_END,
  fragmentFromRange,
  type SeqDocument,
} from '../document';
import { type Feature } from '../features';
import { type Range, type Topology } from '../range';

/**
 * One end of a double-stranded fragment: the same description a document
 * carries for its own ends (`core/document/ends.ts`), where the convention
 * for `overhang` is spelled out. It makes compatibility a plain comparison:
 * a right end and a left end ligate when their kinds and overhangs are equal
 * (see `ligate.ts`).
 */
export type FragmentEnd = StrandEnd;

/** A piece of a digest, detached from its source document. */
export interface DigestFragment {
  /**
   * Top strand from the top-strand cut of the left end to that of the right
   * end. For 3' overhangs this includes the overhang at the right end and
   * for 5' overhangs the one at the left end; the other overhangs are on the
   * bottom strand and are described by the ends.
   */
  readonly sequence: string;
  /** Features of the source trimmed to the fragment, in fragment coordinates. */
  readonly features: readonly Feature[];
  /** Where `sequence` came from in the source (unrolled; may wrap the origin). */
  readonly range: Range;
  readonly left: FragmentEnd;
  readonly right: FragmentEnd;
  /** Name of the document the fragment was cut from. */
  readonly source: string;
  /**
   * Whether its 5′ phosphates have been removed (CIP, rSAP; #10). A ligase
   * joins a strand only to a 5′ phosphate, so a dephosphorylated end cannot
   * be joined to another dephosphorylated one — which is the point: a vector
   * treated this way cannot close on itself, but still takes an insert,
   * whose phosphates join one strand at each junction. Absent means
   * phosphorylated, as an enzyme leaves an end.
   */
  readonly dephosphorylated?: boolean;
}

/** A fragment of a partial digest, and how many cuts inside it were missed. */
export interface PartialFragment extends DigestFragment {
  /** Sites inside the fragment left uncut; 0 for a fragment of the complete digest. */
  readonly uncut: number;
}

/**
 * Signed distance from the top-strand cut to the bottom-strand cut. Positive
 * means the bottom strand is cut further along (a 5' overhang), negative a
 * 3' overhang. On circular sequences the stored positions are wrapped, so
 * the difference is folded back into the shorter arc.
 */
export function cutOffset(
  site: Pick<CutSite, 'cut' | 'cutBottom'>,
  length: number,
  topology: Topology,
): number {
  let d = site.cutBottom - site.cut;
  if (topology === 'circular' && length > 0) {
    d = ((d % length) + length) % length;
    if (d > length / 2) d -= length;
  }
  return d;
}

/** Overhang region of a cut as an unrolled range on the top strand. */
function overhangRange(site: CutSite, length: number, topology: Topology): Range {
  const d = cutOffset(site, length, topology);
  const start = d >= 0 ? site.cut : site.cut + d;
  const wrapped =
    topology === 'circular' && length > 0 ? ((start % length) + length) % length : start;
  return { start: wrapped, end: wrapped + Math.abs(d) };
}

function endAt(doc: SeqDocument, site: CutSite): FragmentEnd {
  const d = cutOffset(site, doc.length, doc.topology);
  const kind: OverhangKind = d === 0 ? 'blunt' : d > 0 ? "5'" : "3'";
  const overhang = d === 0 ? '' : doc.subsequence(overhangRange(site, doc.length, doc.topology));
  return { kind, overhang, enzyme: site.enzyme };
}

/**
 * Keeps one cut per top-strand position (an enzyme that cuts on both
 * strands at a palindromic site, or two enzymes with the same cut, would
 * otherwise produce empty fragments). On a linear molecule cuts at the very
 * ends are dropped: they leave the molecule whole.
 */
function distinctCuts(sites: readonly CutSite[], length: number, topology: Topology): CutSite[] {
  const byCut = new Map<number, CutSite>();
  for (const s of [...sites].sort((a, b) => a.cut - b.cut || a.enzyme.localeCompare(b.enzyme))) {
    if (topology === 'linear' && (s.cut <= 0 || s.cut >= length)) continue;
    const cut = topology === 'circular' && length > 0 ? s.cut % length : s.cut;
    if (!byCut.has(cut)) byCut.set(cut, { ...s, cut });
  }
  return [...byCut.values()];
}

/**
 * Cuts `doc` at the given sites and returns the fragments in the order they
 * lie along the top strand, starting at the first cut (circular) or the
 * molecule's start (linear). The outermost ends of a linear molecule are the
 * molecule's own (`doc.ends`), so digesting a fragment again keeps the ends
 * it already had; a circular molecule without cuts yields nothing, since it
 * has no ends to ligate.
 */
export function digest(doc: SeqDocument, sites: readonly CutSite[]): DigestFragment[] {
  const L = doc.length;
  if (L === 0) return [];
  const cuts = distinctCuts(sites, L, doc.topology);
  const piece = (r: Range, left: FragmentEnd, right: FragmentEnd): DigestFragment => {
    const frag = fragmentFromRange(doc, r);
    return {
      sequence: frag.sequence,
      features: frag.features,
      range: r,
      left,
      right,
      source: doc.name,
    };
  };

  if (doc.topology === 'linear') {
    const natural: DocumentEnds = doc.ends ?? { left: BLUNT_END, right: BLUNT_END };
    const out: DigestFragment[] = [];
    let start = 0;
    let left = natural.left;
    for (const s of cuts) {
      out.push(piece({ start, end: s.cut }, left, endAt(doc, s)));
      start = s.cut;
      left = endAt(doc, s);
    }
    out.push(piece({ start, end: L }, left, natural.right));
    return out;
  }

  if (cuts.length === 0) return [];
  return cuts.map((s, i) => {
    const next = cuts[(i + 1) % cuts.length] ?? s;
    const end = next.cut > s.cut ? next.cut : next.cut + L;
    return piece({ start: s.cut, end }, endAt(doc, s), endAt(doc, next));
  });
}

/**
 * Every fragment a partial digest can give (#10): each stretch from one cut
 * (or a linear molecule's own end) to a later one, with any cuts between left
 * uncut. The complete digest's fragments are among them, with `uncut` 0. On a
 * circle a fragment can run from a cut all the way round to the same cut,
 * the molecule linearised there; a linear molecule's list includes the
 * whole of it, uncut. Longest first.
 *
 * The count grows with the square of the cuts (35 cuts on a circle give
 * 1,225), and cutting out each piece's bases and features is most of the
 * cost, so `limit` keeps that many and cuts out only those: the ones that
 * miss the fewest sites, which is what a partial digest mostly gives (a
 * piece that needs ten sites missed is rare in the tube), longest first
 * among those that miss as many.
 */
export function partialDigest(
  doc: SeqDocument,
  sites: readonly CutSite[],
  limit = Infinity,
): PartialFragment[] {
  const L = doc.length;
  if (L === 0) return [];
  const cuts = distinctCuts(sites, L, doc.topology);
  interface Stop {
    readonly at: number;
    readonly end: () => FragmentEnd;
  }
  const spans: {
    readonly from: Stop;
    readonly to: Stop;
    readonly end: number;
    readonly uncut: number;
  }[] = [];
  const atCut = (s: CutSite): Stop => ({ at: s.cut, end: () => endAt(doc, s) });
  if (doc.topology === 'linear') {
    const natural: DocumentEnds = doc.ends ?? { left: BLUNT_END, right: BLUNT_END };
    // The molecule's two ends and every cut, in order along it.
    const stops: Stop[] = [
      { at: 0, end: () => natural.left },
      ...cuts.map(atCut),
      { at: L, end: () => natural.right },
    ];
    stops.forEach((from, i) => {
      stops.slice(i + 1).forEach((to, k) => {
        spans.push({ from, to, end: to.at, uncut: k });
      });
    });
  } else {
    const stops = cuts.map(atCut);
    const n = stops.length;
    stops.forEach((from, i) => {
      for (let k = 1; k <= n; k++) {
        const to = stops[(i + k) % n];
        if (to === undefined) continue;
        const end = k === n || to.at <= from.at ? to.at + L : to.at;
        spans.push({ from, to, end, uncut: k - 1 });
      }
    });
  }
  const length = (x: (typeof spans)[number]): number => x.end - x.from.at;
  const kept =
    spans.length <= limit
      ? spans
      : [...spans]
          .sort((a, b) => a.uncut - b.uncut || length(b) - length(a))
          .slice(0, Math.max(0, limit));
  kept.sort((a, b) => length(b) - length(a) || a.uncut - b.uncut || a.from.at - b.from.at);
  return kept.map(({ from, to, end, uncut }) => {
    const range = { start: from.at, end };
    const frag = fragmentFromRange(doc, range);
    return {
      sequence: frag.sequence,
      features: frag.features,
      range,
      left: from.end(),
      right: to.end(),
      source: doc.name,
      uncut,
    };
  });
}

/** How many fragments `partialDigest` would give without a limit. */
export function partialDigestSize(doc: SeqDocument, sites: readonly CutSite[]): number {
  if (doc.length === 0) return 0;
  const n = distinctCuts(sites, doc.length, doc.topology).length;
  return doc.topology === 'linear' ? ((n + 2) * (n + 1)) / 2 : n * n;
}
