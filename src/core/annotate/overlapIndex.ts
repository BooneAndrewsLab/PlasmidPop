import { type Range, type Topology, rangePieces } from '../range';

/** Bases per bucket: a few hits wide, so a query meets its neighbours and little else. */
const BUCKET = 512;

/**
 * Hits kept in buckets of the sequence they cover, so the question every
 * reduction step asks (does anything kept overlap this?) meets the hits near
 * it instead of all of them (#288). The step is otherwise quadratic in the
 * number of hits, minutes on a repeat-rich megabase.
 *
 * It only narrows: `some` offers a hit whose range shares a bucket with the
 * query's, which may still not overlap it, so the caller's own test stays
 * the judge and the answer is the one a scan of every hit would give.
 */
export class OverlapIndex<T extends { readonly range: Range }> {
  private readonly buckets = new Map<number, number[]>();
  private readonly items: T[] = [];
  private readonly seen: number[] = [];
  private stamp = 0;

  constructor(
    private readonly length: number,
    private readonly topology: Topology,
  ) {}

  add(item: T): void {
    const at = this.items.length;
    this.items.push(item);
    this.seen.push(0);
    this.eachBucket(item.range, (b) => {
      const list = this.buckets.get(b);
      if (list === undefined) this.buckets.set(b, [at]);
      else list.push(at);
      return false;
    });
  }

  /** Whether `test` holds for any item sharing a bucket with `range`. */
  some(range: Range, test: (item: T) => boolean): boolean {
    this.stamp++;
    return this.eachBucket(range, (b) => {
      for (const at of this.buckets.get(b) ?? []) {
        if (this.seen[at] === this.stamp) continue;
        this.seen[at] = this.stamp;
        const item = this.items[at];
        if (item !== undefined && test(item)) return true;
      }
      return false;
    });
  }

  private eachBucket(range: Range, visit: (bucket: number) => boolean): boolean {
    const pieces = this.topology === 'circular' ? rangePieces(range, this.length) : [range];
    for (const p of pieces) {
      const last = Math.floor(Math.max(p.start, p.end - 1) / BUCKET);
      for (let b = Math.floor(p.start / BUCKET); b <= last; b++) if (visit(b)) return true;
    }
    return false;
  }
}
