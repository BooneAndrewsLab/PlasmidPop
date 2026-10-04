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
export function isGood(cell: number, quality: number | undefined, confidentFrom: number): boolean {
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

/**
 * Which strands the reads over a fully covered feature come from: `both` when
 * every base is read on each strand, `forward` or `reverse` when every base is
 * read on that strand and some not on the other, `mixed` when every base is
 * read but neither strand reaches all of them.
 */
export type VerdictStrands = 'both' | 'forward' | 'reverse' | 'mixed';

export interface FeatureVerdict {
  readonly name: string;
  readonly type: string;
  readonly kind: VerdictKindValue;
  /** Differing columns inside the feature (`Differences`), the reviewed ones left out. */
  readonly differences: number;
  /** Differing columns inside the feature marked reviewed or taken (#123): not held against it. */
  readonly reviewed: number;
  /**
   * Reads covering every base of the feature: the fewest over its bases,
   * either strand. 0 when some base is not covered.
   */
  readonly reads: number;
  /** Where the covering reads come from; null when some base is not covered. */
  readonly strands: VerdictStrands | null;
  /** Reference bases covered / in the feature. */
  readonly covered: number;
  readonly bases: number;
  /**
   * The document positions of the feature's first and last base, 1-based and
   * inclusive as the ruler numbers them (GenBank's convention). On a circle a
   * feature through the origin has `position > endPosition`.
   */
  readonly position: number;
  readonly endPosition: number;
  /** First column of the feature, to bring it into view. */
  readonly start: number;
  readonly end: number;
}

/**
 * A verdict for each annotation that is not an ORF, in document order (by
 * first base, then last; a tie keeps the order given). Annotations that do not fall in the alignment are left out. Only
 * reference columns count towards coverage, since another sample's insertion
 * is padding in the rest. `period` is the document's length when it is
 * circular, as for `buildTrack`. A difference in a `reviewed` column (#123)
 * is counted apart and does not stop a feature being confirmed.
 */
export function verdictsOf(
  stack: Stack,
  annotations: readonly TrackAnnotation[],
  coverage: Coverage,
  differences: readonly number[],
  period: number,
  reviewed: ReadonlySet<number> = new Set(),
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
    const reviewedKeys = new Set<number>();
    for (const c of differences) {
      if (inside.has(c)) (reviewed.has(c) ? reviewedKeys : diffKeys).add(key(c));
    }
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
    const full = covered === bases;
    const first = a.ranges[0];
    const last = a.ranges[a.ranges.length - 1];
    if (first === undefined || last === undefined) continue;
    out.push({
      name: a.name,
      type: a.type,
      kind,
      differences: diffs,
      reviewed: reviewedKeys.size,
      reads: full ? fewest : 0,
      strands: !full
        ? null
        : fewestForward > 0 && fewestReverse > 0
          ? 'both'
          : fewestForward > 0
            ? 'forward'
            : fewestReverse > 0
              ? 'reverse'
              : 'mixed',
      covered,
      bases,
      position: documentPosition(first.start, period),
      endPosition: documentPosition(last.end - 1, period),
      start,
      end,
    });
  }
  return out
    .map((v, i) => ({ v, i }))
    .sort((x, y) => x.v.position - y.v.position || x.v.endPosition - y.v.endPosition || x.i - y.i)
    .map(({ v }) => v);
}

/** A 0-based document index as the 1-based position the ruler shows, wrapped on a circle. */
function documentPosition(index: number, period: number): number {
  return (period > 0 ? ((index % period) + period) % period : index) + 1;
}

/** The order of the table of verdicts: the document's, or the ones needing a look first. */
export type VerdictOrder = 'position' | 'status';

const STATUS_RANK: Record<VerdictKindValue, number> = {
  [VerdictKind.Differences]: 0,
  [VerdictKind.Partial]: 1,
  [VerdictKind.NotCovered]: 2,
  [VerdictKind.Confirmed]: 3,
};

/**
 * The verdicts in `order`; `verdicts` is taken to be in document order (as
 * `verdictsOf` gives it), which breaks ties when sorting by status.
 */
export function sortVerdicts(
  verdicts: readonly FeatureVerdict[],
  order: VerdictOrder,
): FeatureVerdict[] {
  if (order === 'position') return [...verdicts];
  return verdicts
    .map((v, i) => ({ v, i }))
    .sort((x, y) => STATUS_RANK[x.v.kind] - STATUS_RANK[y.v.kind] || x.i - y.i)
    .map(({ v }) => v);
}

/** "Confirmed", "8 differences", "Partly covered", "Not covered": the status column; "(1 reviewed)" after. */
export function statusText(v: FeatureVerdict): string {
  const status = kindText(v);
  return v.reviewed === 0 ? status : `${status} (${v.reviewed.toLocaleString()} reviewed)`;
}

function kindText(v: FeatureVerdict): string {
  switch (v.kind) {
    case VerdictKind.Confirmed:
      return 'Confirmed';
    case VerdictKind.Differences:
      return `${v.differences.toLocaleString()} ${v.differences === 1 ? 'difference' : 'differences'}`;
    case VerdictKind.Partial:
      return 'Partly covered';
    case VerdictKind.NotCovered:
      return 'Not covered';
  }
}

/** "12–40", "6801–120" through a circle's origin, "7" for one base: as the differences list writes it. */
export function verdictPositionText(v: FeatureVerdict): string {
  return v.position === v.endPosition ? `${v.position}` : `${v.position}–${v.endPosition}`;
}

/** "both", "forward only", "reverse only", "mixed", or "" when some base is not covered. */
export function strandsText(v: FeatureVerdict): string {
  switch (v.strands) {
    case null:
      return '';
    case 'forward':
    case 'reverse':
      return `${v.strands} only`;
    case 'both':
    case 'mixed':
      return v.strands;
  }
}

/** "17 of 20". */
export function coveredText(v: FeatureVerdict): string {
  return `${v.covered.toLocaleString()} of ${v.bases.toLocaleString()}`;
}

const TABLE_HEADER = [
  'Status',
  'Feature',
  'Type',
  'Position',
  'Reads',
  'Strands',
  'Differences',
  'Bases covered',
];

/** The table as tab-separated text, a header line first. */
export function verdictsTsv(verdicts: readonly FeatureVerdict[]): string {
  const clean = (s: string): string => s.replace(/[\t\r\n]+/g, ' ');
  const lines = verdicts.map((v) =>
    [
      statusText(v),
      v.name,
      v.type,
      verdictPositionText(v),
      `${v.reads}`,
      strandsText(v),
      `${v.differences}`,
      coveredText(v),
    ]
      .map(clean)
      .join('\t'),
  );
  return [TABLE_HEADER.join('\t'), ...lines].join('\n');
}

/** "lacZα confirmed by 2 reads", "AmpR: 1 difference", "ori: not covered"; ", 1 reviewed" after. */
export function verdictText(v: FeatureVerdict): string {
  const text = verdictKindText(v);
  return v.reviewed === 0 ? text : `${text}, ${v.reviewed.toLocaleString()} reviewed`;
}

function verdictKindText(v: FeatureVerdict): string {
  const plural = (n: number, one: string, many: string): string => (n === 1 ? one : many);
  switch (v.kind) {
    case VerdictKind.Confirmed: {
      const by = `${v.reads.toLocaleString()} ${plural(v.reads, 'read', 'reads')}`;
      const one = v.strands === 'forward' || v.strands === 'reverse' ? v.strands : null;
      return `${v.name} confirmed by ${by}${one === null ? '' : `, ${one} strand only`}`;
    }
    case VerdictKind.Differences:
      return `${v.name}: ${v.differences.toLocaleString()} ${plural(v.differences, 'difference', 'differences')}`;
    case VerdictKind.Partial:
      return `${v.name}: ${v.covered.toLocaleString()} of ${v.bases.toLocaleString()} bases covered`;
    case VerdictKind.NotCovered:
      return `${v.name}: not covered`;
  }
}

/** The verdicts boiled down to one sentence and the features that need a look. */
export interface VerdictSummary {
  readonly total: number;
  readonly confirmed: number;
  /** The fewest reads over the confirmed features, 0 when none is confirmed. */
  readonly reads: number;
  /** Every confirmed feature is covered on one strand only: 'forward' or 'reverse'. */
  readonly oneStrand: 'forward' | 'reverse' | null;
  /** Everything but `Confirmed`, in the order given. */
  readonly exceptions: readonly FeatureVerdict[];
}

export function summariseVerdicts(verdicts: readonly FeatureVerdict[]): VerdictSummary {
  const confirmed = verdicts.filter((v) => v.kind === VerdictKind.Confirmed);
  const strands = new Set(
    confirmed.map((v) => (v.strands === 'forward' || v.strands === 'reverse' ? v.strands : null)),
  );
  const only = strands.size === 1 ? ([...strands][0] ?? null) : null;
  return {
    total: verdicts.length,
    confirmed: confirmed.length,
    reads: confirmed.length === 0 ? 0 : Math.min(...confirmed.map((v) => v.reads)),
    oneStrand: only,
    exceptions: verdicts.filter((v) => v.kind !== VerdictKind.Confirmed),
  };
}

/**
 * "All 27 features confirmed by all 5 reads", "24 of 27 features confirmed by
 * at least 3 reads, forward strand only". `samples` is how many are shown.
 */
export function verdictSummaryText(s: VerdictSummary, samples: number): string {
  if (s.confirmed === 0) return `No feature confirmed (of ${s.total.toLocaleString()})`;
  const count =
    s.confirmed === s.total
      ? `All ${s.total.toLocaleString()} features`
      : `${s.confirmed.toLocaleString()} of ${s.total.toLocaleString()} features`;
  const reads =
    s.reads >= samples
      ? samples === 1
        ? 'the read'
        : `all ${samples.toLocaleString()} reads`
      : `at least ${s.reads.toLocaleString()} ${s.reads === 1 ? 'read' : 'reads'}`;
  return `${count} confirmed by ${reads}${s.oneStrand === null ? '' : `, ${s.oneStrand} strand only`}`;
}
