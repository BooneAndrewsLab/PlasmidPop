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
  readonly qualifiers: readonly Qualifier[];
}

export interface FeatureInit {
  readonly id?: FeatureId;
  readonly type: string;
  readonly name?: string;
  readonly strand?: Strand;
  readonly segments: readonly Segment[];
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
