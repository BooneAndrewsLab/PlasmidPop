import { newId } from '../ids';
import { type Range } from '../range';
import { type Segment, segmentLength } from './segment';

export type Strand = 'forward' | 'reverse';

export function flipStrand(strand: Strand): Strand {
  return strand === 'forward' ? 'reverse' : 'forward';
}

/**
 * A GenBank qualifier (`/name="value"`). Order and duplicates are preserved
 * so files round-trip. `value` is `null` for bare flags such as `/pseudo`.
 */
export interface Qualifier {
  readonly name: string;
  readonly value: string | null;
}

export type FeatureId = string;

export interface Feature {
  readonly id: FeatureId;
  /** GenBank feature key: CDS, gene, promoter, misc_feature, … */
  readonly type: string;
  /** Display name. Parsers derive it from /label, /gene, /product, etc. */
  readonly name: string;
  readonly strand: Strand;
  /**
   * Location pieces in forward-coordinate order, exactly as a GenBank
   * `join(...)` lists them. For a reverse-strand feature the biological
   * sequence is the reverse complement of the concatenated segments.
   * Always non-empty.
   */
  readonly segments: readonly Segment[];
  /**
   * How the segments go together. Absent, they are one molecule read end to
   * end, GenBank's `join(...)` (and a single segment needs nothing). `'order'`
   * is GenBank's `order(...)`: the pieces are listed but not joined, as
   * GenPept lists the residues of a binding site. Nothing but GenBank and
   * GenPept I/O reads it; every edit carries it with the feature (#95).
   */
  readonly joining?: SegmentJoining | undefined;
  readonly qualifiers: readonly Qualifier[];
  /**
   * The feature this one is a piece of, when a cut or a region left only
   * some of its bases (#182). Ligation reads it to put the pieces back
   * together when they meet again exactly as they were. In-session
   * bookkeeping: GenBank, the clipboard and stored history do not carry it.
   */
  readonly origin?: FeatureOrigin | undefined;
}

/**
 * Where a piece of a feature came from (#182): the whole feature it was cut
 * from, and which of that feature's bases the piece holds.
 *
 * `whole` is the original laid out on its own, read 5′ to 3′ whichever
 * strand it was on: a forward-strand feature in a linear space of `span`
 * bases whose base 0 is the original's first base of reading, its located
 * qualifiers (`/transl_except`, `/anticodon`) moved along with it. That
 * makes the record the same whichever way round the piece is later turned,
 * and wherever it lands.
 */
export interface FeatureOrigin {
  /** The original's id; every piece of one feature carries the same key. */
  readonly key: FeatureId;
  /** The original, on the forward strand of its own `span`-base space, with no origin of its own. */
  readonly whole: Feature;
  readonly span: number;
  /**
   * A hash of the bases between each pair of consecutive segments of
   * `whole` (an intron, read 5′ to 3′), so two pieces cut apart there are
   * joined back only across the same bases.
   */
  readonly gaps: readonly number[];
  /**
   * A hash of all the original's bases, `[0, span)` of its own space read
   * 5′ to 3′, so pieces whose bases changed since the cut (an edit, a PCR
   * primer's mismatch) never give back the original's `/translation` (#188).
   */
  readonly bases: number;
  /** The piece's bases, `[from, to)` along the original's own bases from its 5′ end. */
  readonly from: number;
  readonly to: number;
}

/** The only value `Feature.joining` holds; `join(...)` is its absence. */
export type SegmentJoining = 'order';

export interface FeatureInit {
  readonly id?: FeatureId;
  readonly type: string;
  readonly name?: string;
  readonly strand?: Strand;
  readonly segments: readonly Segment[];
  readonly joining?: SegmentJoining | undefined;
  readonly qualifiers?: readonly Qualifier[];
}

export function newFeatureId(): FeatureId {
  return newId();
}

export function createFeature(init: FeatureInit): Feature {
  if (init.segments.length === 0) {
    throw new RangeError('A feature needs at least one segment');
  }
  return {
    id: init.id ?? newFeatureId(),
    type: init.type,
    name: init.name ?? '',
    strand: init.strand ?? 'forward',
    segments: init.segments,
    ...(init.joining === 'order' ? { joining: 'order' } : {}),
    qualifiers: init.qualifiers ?? [],
  };
}

/**
 * The stretch a feature covers as one range: its first range segment's
 * start through its last one's end, which is what selecting it selects and
 * what the map draws. Null for a feature of sites alone.
 */
export function featureExtent(feature: Feature): Range | null {
  const ranges = feature.segments.filter((s) => s.kind === 'range');
  const first = ranges[0];
  const last = ranges[ranges.length - 1];
  if (first?.kind !== 'range' || last?.kind !== 'range') return null;
  return { start: first.start, end: Math.max(first.end, last.end) };
}

/** Number of bases covered by all range segments. */
export function featureLength(feature: Feature): number {
  let total = 0;
  for (const seg of feature.segments) total += segmentLength(seg);
  return total;
}

export function qualifierValues(feature: Feature, name: string): readonly string[] {
  const out: string[] = [];
  for (const q of feature.qualifiers) {
    if (q.name === name && q.value !== null) out.push(q.value);
  }
  return out;
}

export function firstQualifier(feature: Feature, name: string): string | undefined {
  return qualifierValues(feature, name)[0];
}
