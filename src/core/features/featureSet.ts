import { type Range, isEmptyRange, rangeContains, rangesOverlap } from '../range';
import { type Feature, type FeatureId } from './feature';
import { type Interval, IntervalTree } from './intervalTree';

/**
 * Immutable, ordered collection of features with an id lookup and a lazily
 * built interval index for spatial queries. Order is the order features were
 * added (parsers keep file order), which is what the UI and writers want.
 */
export class FeatureSet implements Iterable<Feature> {
  static readonly EMPTY = new FeatureSet([], new Map());

  static from(features: Iterable<Feature>): FeatureSet {
    const items: Feature[] = [];
    const byId = new Map<FeatureId, Feature>();
    for (const f of features) {
      if (byId.has(f.id)) throw new Error(`Duplicate feature id "${f.id}"`);
      items.push(f);
      byId.set(f.id, f);
    }
    return items.length === 0 ? FeatureSet.EMPTY : new FeatureSet(items, byId);
  }

  private index: IntervalTree<Feature> | null = null;

  private constructor(
    private readonly items: readonly Feature[],
    private readonly byId: ReadonlyMap<FeatureId, Feature>,
  ) {}

  get size(): number {
    return this.items.length;
  }

  [Symbol.iterator](): Iterator<Feature> {
    return this.items[Symbol.iterator]();
  }

  all(): readonly Feature[] {
    return this.items;
  }

  get(id: FeatureId): Feature | undefined {
    return this.byId.get(id);
  }

  has(id: FeatureId): boolean {
    return this.byId.has(id);
  }

  add(feature: Feature): FeatureSet {
    if (this.byId.has(feature.id)) throw new Error(`Duplicate feature id "${feature.id}"`);
    const byId = new Map(this.byId);
    byId.set(feature.id, feature);
    return new FeatureSet([...this.items, feature], byId);
  }

  /** Replaces the feature with the same id; throws if it does not exist. */
  replace(feature: Feature): FeatureSet {
    const existing = this.byId.get(feature.id);
    if (existing === undefined) throw new Error(`Unknown feature id "${feature.id}"`);
    if (existing === feature) return this;
    const byId = new Map(this.byId);
    byId.set(feature.id, feature);
    return new FeatureSet(
      this.items.map((f) => (f.id === feature.id ? feature : f)),
      byId,
    );
  }

  remove(id: FeatureId): FeatureSet {
    if (!this.byId.has(id)) return this;
    const byId = new Map(this.byId);
    byId.delete(id);
    const items = this.items.filter((f) => f.id !== id);
    return items.length === 0 ? FeatureSet.EMPTY : new FeatureSet(items, byId);
  }

  /**
   * Applies `fn` to every feature. Returning `null` drops the feature. Used by
   * the document for coordinate shifts, which touch every feature at once.
   */
  map(fn: (feature: Feature) => Feature | null): FeatureSet {
    const items: Feature[] = [];
    const byId = new Map<FeatureId, Feature>();
    let changed = false;
    for (const f of this.items) {
      const next = fn(f);
      if (next === null) {
        changed = true;
        continue;
      }
      if (next !== f) changed = true;
      items.push(next);
      byId.set(next.id, next);
    }
    if (!changed) return this;
    return items.length === 0 ? FeatureSet.EMPTY : new FeatureSet(items, byId);
  }

  /**
   * Features with at least one segment touching `query`. A range segment
   * touches if it shares a base; a site touches if it lies strictly inside
   * the query. `query` may wrap.
   */
  overlapping(query: Range, seqLength: number): Feature[] {
    if (isEmptyRange(query)) return [];
    const tree = this.getIndex();
    const seen = new Set<FeatureId>();
    const out: Feature[] = [];
    const visit = (qs: number, qe: number): void => {
      for (const feature of tree.overlapping(qs, qe)) {
        if (seen.has(feature.id)) continue;
        if (this.touches(feature, query, seqLength)) {
          seen.add(feature.id);
          out.push(feature);
        }
      }
    };
    visit(query.start, query.end);
    visit(query.start + seqLength, query.end + seqLength);
    visit(query.start - seqLength, query.end - seqLength);
    return out;
  }

  /** Features with a range segment covering the base at `position`. */
  at(position: number, seqLength: number): Feature[] {
    if (position < 0 || position >= seqLength) return [];
    return this.overlapping({ start: position, end: position + 1 }, seqLength).filter((f) =>
      f.segments.some((seg) => seg.kind === 'range' && rangeContains(seg, position, seqLength)),
    );
  }

  private touches(feature: Feature, query: Range, seqLength: number): boolean {
    for (const seg of feature.segments) {
      if (seg.kind === 'range') {
        if (rangesOverlap(seg, query, seqLength)) return true;
      } else {
        const p = seg.position;
        if (
          (query.start < p && p < query.end) ||
          (query.start < p + seqLength && p + seqLength < query.end)
        ) {
          return true;
        }
      }
    }
    return false;
  }

  /**
   * The index stores unrolled coordinates and does not depend on sequence
   * length, so it can be cached on this immutable instance. It is a candidate
   * filter only; `touches` applies the exact circular test.
   */
  private getIndex(): IntervalTree<Feature> {
    if (this.index !== null) return this.index;
    const intervals: Interval<Feature>[] = [];
    for (const feature of this.items) {
      for (const seg of feature.segments) {
        if (seg.kind === 'range') {
          intervals.push({ start: seg.start, end: seg.end, value: feature });
        } else {
          // A site is indexed as the two bases it sits between.
          intervals.push({
            start: Math.max(0, seg.position - 1),
            end: seg.position + 1,
            value: feature,
          });
        }
      }
    }
    this.index = new IntervalTree(intervals);
    return this.index;
  }
}
