import { Cell, isDifference, type Stack } from './alignmentStack';
import { columnsOfIndex, spansOf, type TrackAnnotation } from './alignmentTrack';

/**
 * Read verification (#120): from a stack, how many reads cover each column at
 * good quality, and for each feature of the document whether the reads
 * confirm it, show differences in it, or do not reach it. Columns are the
 * stack's, 0-based half-open as everywhere in the large view.
 */

/** Reads covering one column at good quality, by strand. */
export interface Coverage {
  /** Per column, reads on the forward strand. */
  readonly forward: Uint16Array;
  /** Per column, reads that aligned reversed. */
  readonly reverse: Uint16Array;
}

/**
 * Whether a row's cell is a base the row stands behind: it has a base (or a
 * deletion the read spans) and, for a read with qualities, that base is at
 * `confidentFrom` or better. A gap carries no quality, so a deletion is
 * trusted as the read spanning it.
 */
function isGood(cell: number, quality: number | undefined, confidentFrom: number): boolean {
  if (cell === Cell.Blank || cell === Cell.Padding) return false;
  if (cell === Cell.Deletion || quality === undefined || Number.isNaN(quality)) return true;
  return quality >= confidentFrom;
}

/** Per column, the reads covering it at good quality (`confidentFrom` is the Phred cut-off). */
export function coverageOf(stack: Stack, confidentFrom: number): Coverage {
  const forward = new Uint16Array(stack.columns);
  const reverse = new Uint16Array(stack.columns);
  for (const row of stack.rows) {
    const side = row.result.strand === 'reverse' ? reverse : forward;
    for (let c = row.firstColumn; c < row.endColumn; c++) {
      if (isGood(row.cells[c] ?? Cell.Blank, row.qualities?.[c], confidentFrom)) {
        side[c] = (side[c] ?? 0) + 1;
      }
    }
  }
  return { forward, reverse };
}

/** The coverage of a column as 0, 1 or 2 (meaning 2 or more) for the overview band. */
export function coverageBand(coverage: Coverage, column: number): 0 | 1 | 2 {
  const n = (coverage.forward[column] ?? 0) + (coverage.reverse[column] ?? 0);
  return n >= 2 ? 2 : n === 1 ? 1 : 0;
}

/**
 * Columns where some row differs from the reference at good quality. A
 * mismatch in a poor stretch of a read is not evidence either way, so it is
 * left out here (it still shows in the view, faded).
 */
export function confidentDifferences(stack: Stack, confidentFrom: number): number[] {
  return stack.differences.filter((c) =>
    stack.rows.some(
      (row) =>
        isDifference(row.cells[c] ?? Cell.Blank) &&
        isGood(row.cells[c] ?? Cell.Blank, row.qualities?.[c], confidentFrom),
    ),
  );
}

export const VerdictKind = {
  /** Every base covered at good quality and no difference. */
  Confirmed: 'confirmed',
  /** One or more differences at good quality. */
  Differences: 'differences',
  /** Some bases covered, some not, and no difference in what is covered. */
  Partial: 'partial',
  NotCovered: 'not-covered',
} as const;
export type VerdictKindValue = (typeof VerdictKind)[keyof typeof VerdictKind];

export interface FeatureVerdict {
  readonly name: string;
  readonly type: string;
  readonly kind: VerdictKindValue;
  /** Differing columns inside the feature (`Differences`). */
  readonly differences: number;
  /** Reads covering every base of the feature (`Confirmed`): the fewest over its columns, either strand. */
  readonly reads: number;
  /** Confirmed, but every covering read is on one strand: 'forward' or 'reverse'. */
  readonly oneStrand: 'forward' | 'reverse' | null;
  /** Reference bases covered / in the feature. */
  readonly covered: number;
  readonly bases: number;
  /** First column of the feature, to bring it into view. */
  readonly start: number;
  readonly end: number;
}

/**
 * A verdict for each annotation that is not an ORF, in the order given.
 * Annotations that do not fall in the alignment are left out. Only
 * reference columns count towards coverage, since another sample's insertion
 * is padding in the rest. `period` is the document's length when it is
 * circular, as for `buildTrack`.
 */
export function verdictsOf(
  stack: Stack,
  annotations: readonly TrackAnnotation[],
  coverage: Coverage,
  differences: readonly number[],
  period: number,
): FeatureVerdict[] {
  const indexColumns = columnsOfIndex(stack);
  const out: FeatureVerdict[] = [];
  for (const a of annotations) {
    if (a.orf) continue;
    const spans = spansOf(stack, indexColumns, a.ranges, period);
    if (spans.length === 0) continue;
    // A join, or a circle's origin seen at both ends of the reference row, can
    // name one base in two columns: count each base once, by the best copy.
    const key = (c: number): number => {
      const i = stack.refIndex[c] ?? -1;
      return i < 0 ? -1 - c : period > 0 ? i % period : i;
    };
    const inside = new Set<number>();
    const best = new Map<number, { f: number; r: number }>();
    let start = Number.POSITIVE_INFINITY;
    let end = 0;
    for (const span of spans) {
      start = Math.min(start, span.start);
      end = Math.max(end, span.end);
      for (let c = span.start; c < span.end; c++) {
        inside.add(c);
        const k = key(c);
        if (k < 0) continue;
        const f = coverage.forward[c] ?? 0;
        const r = coverage.reverse[c] ?? 0;
        const seen = best.get(k);
        if (seen === undefined || f + r > seen.f + seen.r) best.set(k, { f, r });
      }
    }
    let covered = 0;
    let fewest = Number.POSITIVE_INFINITY;
    let fewestForward = Number.POSITIVE_INFINITY;
    let fewestReverse = Number.POSITIVE_INFINITY;
    for (const { f, r } of best.values()) {
      if (f + r > 0) covered++;
      fewest = Math.min(fewest, f + r);
      fewestForward = Math.min(fewestForward, f);
      fewestReverse = Math.min(fewestReverse, r);
    }
    const bases = best.size;
    const diffKeys = new Set<number>();
    for (const c of differences) if (inside.has(c)) diffKeys.add(key(c));
    const diffs = diffKeys.size;
    if (bases === 0) continue;
    const kind =
      diffs > 0
        ? VerdictKind.Differences
        : covered === bases
          ? VerdictKind.Confirmed
          : covered > 0
            ? VerdictKind.Partial
            : VerdictKind.NotCovered;
    const confirmed = kind === VerdictKind.Confirmed;
    out.push({
      name: a.name,
      type: a.type,
      kind,
      differences: diffs,
      reads: confirmed ? fewest : 0,
      oneStrand:
        confirmed && fewestReverse === 0 && fewestForward > 0
          ? 'forward'
          : confirmed && fewestForward === 0 && fewestReverse > 0
            ? 'reverse'
            : null,
      covered,
      bases,
      start,
      end,
    });
  }
  return out;
}

/** "lacZα confirmed by 2 reads", "AmpR: 1 difference", "ori: not covered". */
export function verdictText(v: FeatureVerdict): string {
  const plural = (n: number, one: string, many: string): string => (n === 1 ? one : many);
  switch (v.kind) {
    case VerdictKind.Confirmed: {
      const by = `${v.reads.toLocaleString()} ${plural(v.reads, 'read', 'reads')}`;
      return `${v.name} confirmed by ${by}${v.oneStrand === null ? '' : `, ${v.oneStrand} strand only`}`;
    }
    case VerdictKind.Differences:
      return `${v.name}: ${v.differences.toLocaleString()} ${plural(v.differences, 'difference', 'differences')}`;
    case VerdictKind.Partial:
      return `${v.name}: ${v.covered.toLocaleString()} of ${v.bases.toLocaleString()} bases covered`;
    case VerdictKind.NotCovered:
      return `${v.name}: not covered`;
  }
}
