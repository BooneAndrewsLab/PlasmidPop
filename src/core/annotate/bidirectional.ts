import { type Feature, type Strand } from '../features';
import { type Topology } from '../range';
import { type FeatureHit, overlapLength } from './detect';
import { type LibraryPart } from './library';

/**
 * The strand in use at a bidirectional element (#282,
 * docs/design/59-detect-features.md).
 *
 * The SV40 early and late poly(A) signals are one stretch of DNA read either
 * way: the late part (222 bp) holds the early one (75 bp) whole on its other
 * strand. Every vector that carries the late fragment has both, and only one
 * is used there — the one a gene on that strand runs into. Offering both on
 * every copy labels the same bases twice, one of them the wrong way round.
 *
 * So where a part that is the `complementOf` another is called, and that
 * other part is called over its bases on the other strand, each is offered
 * only where a gene on its own strand runs into it: a gene whose 3′ end lies
 * no more than `RUN_IN_BASES` before the signal's 5′ end, or inside the
 * signal. Where neither strand has one, the named part is offered alone, as
 * the generic label (for SV40, the early signal, which is what a record
 * means by "SV40 poly(A)"). Where both have one, both are offered.
 *
 * A gene is a CDS hit among the ones found, or a CDS the document annotates.
 * A hit's 3′ end is where its frame stops: the hit's own last codon if that
 * is a stop, or else the first stop its frame reaches, since a part may be
 * only the start of the gene that carries it (the TetR of an rtTA, a FLAG
 * tag before an insert). An annotated CDS ends where it says.
 */

/** Furthest a gene's 3′ end may lie before a signal's 5′ end and still run into it. */
export const RUN_IN_BASES = 500;

/** What the rule needs of a found hit: the hit, and the part's name, type and pairing. */
export interface PairedHit {
  readonly hit: FeatureHit;
  readonly part: Pick<LibraryPart, 'name' | 'type' | 'complementOf'>;
}

/** Bases read one at a time: a string, or a document's sequence. */
export interface Bases {
  readonly length: number;
  charAt(index: number): string;
}

const STOPS = new Set(['TAA', 'TAG', 'TGA']);
const COMPLEMENT: Readonly<Record<string, string>> = { A: 'T', C: 'G', G: 'C', T: 'A' };

/** The codon whose forward-strand bases start at `q`, read on `strand`; '' past a linear end. */
function codonAt(bases: Bases, circular: boolean, q: number, strand: Strand): string {
  const n = bases.length;
  if (!circular && (q < 0 || q + 3 > n)) return '';
  const base = (i: number): string => bases.charAt((((q + i) % n) + n) % n).toUpperCase();
  if (strand === 'forward') return base(0) + base(1) + base(2);
  const complement = (i: number): string => COMPLEMENT[base(i)] ?? 'N';
  return complement(2) + complement(1) + complement(0);
}

/**
 * Where a CDS hit's frame stops, as a position in forward coordinates: the
 * end of the stop codon on the forward strand, its start on the reverse. Null
 * where the frame runs off a linear end, or on for `limit` bases without one.
 */
function stopOf(hit: FeatureHit, bases: Bases, circular: boolean, limit: number): number | null {
  const forward = hit.strand === 'forward';
  // A hit cut off at its 3′ end by a linear end is a gene that runs on past it.
  if (forward ? hit.partialEnd === true : hit.partialStart === true) return null;
  const step = forward ? 3 : -3;
  let q = forward ? hit.range.end - 3 : hit.range.start;
  for (let walked = 0; walked <= limit; walked += 3, q += step) {
    const codon = codonAt(bases, circular, q, hit.strand);
    if (codon === '') return null;
    if (STOPS.has(codon)) return forward ? q + 3 : q;
  }
  return null;
}

/** How far before `signal`'s 5′ end, on its strand, `end` lies; negative inside the signal. */
function before(signal: FeatureHit, end: number, length: number, circular: boolean): number {
  const start = signal.strand === 'forward' ? signal.range.start : signal.range.end;
  const gap = signal.strand === 'forward' ? start - end : end - start;
  if (!circular) return gap;
  // On a circle the gap is taken the short way round from the signal's start
  // back, so a 3′ end just inside the signal reads as a small negative.
  const size = signal.range.end - signal.range.start;
  const around = ((gap % length) + length) % length;
  return around > length - size ? around - length : around;
}

/** Whether a gene ending at `end` (forward coordinates, its 3′ end) runs into `signal`. */
function runsInto(signal: FeatureHit, end: number, length: number, circular: boolean): boolean {
  const gap = before(signal, end, length, circular);
  const size = signal.range.end - signal.range.start;
  return gap <= RUN_IN_BASES && gap > -size;
}

/** The 3′ end of an annotated CDS, in forward coordinates, or null where it has no range. */
function annotatedEnd(f: Feature): number | null {
  const ranges = f.segments.filter((s) => s.kind === 'range');
  const first = ranges[0];
  const last = ranges[ranges.length - 1];
  if (first?.kind !== 'range' || last?.kind !== 'range') return null;
  return f.strand === 'forward' ? last.end : first.start;
}

/**
 * `found` with, at each bidirectional element, the strand no gene runs into
 * left out (see above). `bases` is read only where such an element was
 * found, to follow a CDS hit's frame to its stop; `annotated` are the
 * document's features, of which the CDS count as genes.
 */
export function inUseStrands<T extends PairedHit>(
  found: readonly T[],
  bases: Bases,
  topology: Topology,
  annotated: Iterable<Feature> = [],
): T[] {
  const length = bases.length;
  const circular = topology === 'circular';
  const size = (h: FeatureHit): number => h.range.end - h.range.start;
  const pairs: { readonly one: T; readonly generic: T }[] = [];
  for (const one of found) {
    const name = one.part.complementOf;
    if (name === undefined) continue;
    for (const generic of found) {
      if (
        generic.part.name === name &&
        generic.hit.strand !== one.hit.strand &&
        overlapLength(generic.hit.range, one.hit.range, length, topology) >= size(generic.hit)
      )
        pairs.push({ one, generic });
    }
  }
  if (pairs.length === 0) return [...found];
  const ends: { readonly strand: Strand; readonly at: number }[] = [];
  for (const f of annotated) {
    if (f.type !== 'CDS') continue;
    const at = annotatedEnd(f);
    if (at !== null) ends.push({ strand: f.strand, at });
  }
  for (const { hit, part } of found) {
    if (part.type !== 'CDS') continue;
    const at = stopOf(hit, bases, circular, length);
    if (at !== null) ends.push({ strand: hit.strand, at });
  }
  const inUse = (signal: FeatureHit): boolean =>
    ends.some((e) => e.strand === signal.strand && runsInto(signal, e.at, length, circular));
  const hidden = new Set<T>();
  for (const { one, generic } of pairs) {
    const oneUsed = inUse(one.hit);
    if (!oneUsed) hidden.add(one);
    else if (!inUse(generic.hit)) hidden.add(generic);
  }
  return found.filter((d) => !hidden.has(d));
}
