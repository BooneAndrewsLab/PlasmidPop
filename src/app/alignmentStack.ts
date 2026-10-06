import type { SampleFeatures } from './alignmentSampleTrack';
import type { ReadAlignment, ReferenceInput } from './readAlignment';

/**
 * Several pairwise alignments to one reference, laid out in one column space
 * so a column reads straight down through the reference and every sample
 * (#103). This is not a multiple alignment: each sample was aligned to the
 * reference alone. An insertion in any sample opens gap columns in the
 * reference and, as padding, in every other sample; the samples' own
 * insertions at one place share those columns, left-aligned, rather than
 * each opening its own.
 */

export interface StackSample {
  readonly name: string;
  readonly result: ReadAlignment;
  /** The sample's own features, when it is a document that has them (#128). */
  readonly features?: SampleFeatures;
}

/** How one sample stands against the reference in one column. */
export const Cell = {
  /** Outside the stretch this sample was aligned over. */
  Blank: 0,
  Match: 1,
  /** Compatible through an ambiguity code. */
  Ambiguous: 2,
  Mismatch: 3,
  /** The reference has a base and the sample has none. */
  Deletion: 4,
  /** The sample has a base and the reference has none. */
  Insertion: 5,
  /** A gap in both: another sample's insertion, padded. */
  Padding: 6,
} as const;

export interface StackRow {
  readonly name: string;
  /** The sample's character in each column: a base, '-' or ' ' outside its stretch. */
  readonly bases: string;
  /** Per column, a `Cell`. */
  readonly cells: Uint8Array;
  /** Per column, the sample's quality, or null when it had none. */
  readonly qualities: Float32Array | null;
  /**
   * Per column, the index in `result.trace`'s read of the base there, or -1
   * where the sample has none; null when the sample has no trace (#110).
   */
  readonly readIndex: Int32Array | null;
  /** The columns the sample covers, half-open. */
  readonly firstColumn: number;
  readonly endColumn: number;
  readonly result: ReadAlignment;
}

export interface Stack {
  readonly columns: number;
  /** The reference's character per column: a base, or '-' in a column another sample opened. */
  readonly reference: string;
  /**
   * Per column, the reference's position along its sequence (before the
   * reference's `offset`), or -1 in an inserted column. Runs past the
   * sequence's length only when a sample runs through a circle's origin.
   */
  readonly refIndex: Int32Array;
  /**
   * Per column, the column showing the same reference base from the other
   * side of a circle's origin (p and p + length), or -1: in a column no
   * sample reaches round the origin, in an inserted column, on a linear
   * reference. Reads over the origin that do and do not wrap put one base in
   * these two columns, so whatever combines reads by base looks at both.
   */
  readonly twin: Int32Array;
  readonly rows: readonly StackRow[];
  /** Every column where some sample is not a match, ascending. */
  readonly differences: readonly number[];
  readonly offset: number;
  readonly wrap: number | null;
}

/** A typed array's element, 0 past its end (which noUncheckedIndexedAccess cannot rule out). */
function at(a: ArrayLike<number>, i: number): number {
  return a[i] ?? 0;
}

/** Whether a cell counts as a difference from the reference. */
export function isDifference(cell: number): boolean {
  return cell === Cell.Mismatch || cell === Cell.Deletion || cell === Cell.Insertion;
}

/**
 * Lays `samples` out against `reference`. The reference row is the whole of
 * the reference, so samples covering different stretches of it sit where they
 * belong; it runs on past the end when a sample runs through the origin.
 */
export function stackAlignments(reference: ReferenceInput, samples: readonly StackSample[]): Stack {
  const length = reference.sequence.length;
  const hi = samples.reduce((m, s) => Math.max(m, s.result.alignment.endA), length);
  // Insertions per boundary: boundary p is before reference base p.
  const slot = new Int32Array(hi + 1);
  const runsOf = samples.map((s) => insertionRuns(s.result));
  for (const runs of runsOf) {
    for (const [p, n] of runs) if (n > at(slot, p)) slot[p] = n;
  }
  // First column of each boundary's slot, and of each reference base.
  const boundaryColumn = new Int32Array(hi + 2);
  let columns = 0;
  for (let p = 0; p <= hi; p++) {
    boundaryColumn[p] = columns;
    columns += at(slot, p) + (p < hi ? 1 : 0);
  }
  boundaryColumn[hi + 1] = columns;
  const refColumn = (p: number): number => at(boundaryColumn, p) + at(slot, p);

  const refChars = new Array<string>(columns).fill('-');
  const refIndex = new Int32Array(columns).fill(-1);
  for (let p = 0; p < hi; p++) {
    const c = refColumn(p);
    refChars[c] = reference.sequence.charAt(p % Math.max(length, 1)).toUpperCase();
    refIndex[c] = p;
  }

  const twin = new Int32Array(columns).fill(-1);
  if (reference.wrap !== null && length > 0) {
    for (let p = length; p < hi; p++) {
      const high = refColumn(p);
      const low = refColumn(p - length);
      twin[high] = low;
      twin[low] = high;
    }
  }

  const differenceColumns = new Set<number>();
  const rows: StackRow[] = samples.map((s, k) => {
    const { alignment, qualities } = s.result;
    const chars = new Array<string>(columns).fill(' ');
    const cells = new Uint8Array(columns);
    const q = qualities === null ? null : new Float32Array(columns).fill(Number.NaN);
    const readIndex = s.result.trace === null ? null : new Int32Array(columns).fill(-1);
    // The read's own numbering, as the trace keeps it: the aligned stretch starts at offsetB.
    let index = alignment.startB + s.result.offsetB;
    // The stretch this sample covers: padding wherever it has no base of its own.
    const from = at(boundaryColumn, alignment.startA);
    const to = at(boundaryColumn, alignment.endA) + (runsOf[k]?.get(alignment.endA) ?? 0);
    for (let c = from; c < to; c++) {
      chars[c] = '-';
      cells[c] = refChars[c] === '-' ? Cell.Padding : Cell.Deletion;
    }
    let p = alignment.startA;
    let run = 0;
    for (let i = 0; i < alignment.columns; i++) {
      const a = alignment.alignedA.charAt(i);
      const b = alignment.alignedB.charAt(i);
      let c: number;
      if (a === '-') {
        c = at(boundaryColumn, p) + run++;
      } else {
        c = refColumn(p++);
        run = 0;
      }
      chars[c] = b;
      if (q !== null) q[c] = qualities?.[i] ?? Number.NaN;
      if (b !== '-') {
        if (readIndex !== null) readIndex[c] = index;
        index++;
      }
      if (a === '-') cells[c] = Cell.Insertion;
      else if (b === '-') cells[c] = Cell.Deletion;
      else {
        const m = alignment.matchLine.charAt(i);
        cells[c] = m === '|' ? Cell.Match : m === ':' ? Cell.Ambiguous : Cell.Mismatch;
      }
      if (isDifference(at(cells, c))) differenceColumns.add(c);
    }
    return {
      name: s.name,
      bases: chars.join(''),
      cells,
      qualities: q,
      readIndex,
      firstColumn: from,
      endColumn: to,
      result: s.result,
    };
  });

  return {
    columns,
    reference: refChars.join(''),
    refIndex,
    twin,
    rows,
    // A base differing in both of its copies is one difference, listed at the first.
    differences: [...differenceColumns]
      .filter((c) => {
        const t = twin[c] ?? -1;
        return !(t >= 0 && t < c && differenceColumns.has(t));
      })
      .sort((x, y) => x - y),
    offset: reference.offset,
    wrap: reference.wrap,
  };
}

/** Length of the run of the sample's inserted bases before each reference base. */
function insertionRuns(result: ReadAlignment): Map<number, number> {
  const { alignment } = result;
  const runs = new Map<number, number>();
  let p = alignment.startA;
  let run = 0;
  for (let i = 0; i < alignment.columns; i++) {
    if (alignment.alignedA.charAt(i) === '-') {
      run++;
      runs.set(p, run);
    } else {
      p++;
      run = 0;
    }
  }
  return runs;
}

/** A run of neighbouring differing columns, `[start, end)`. */
export interface DifferenceRegion {
  readonly start: number;
  readonly end: number;
}

/** The sorted differing columns gathered into runs of adjacent ones, so a 5-base gap is one stop. */
export function differenceRegions(differences: readonly number[]): DifferenceRegion[] {
  const regions: DifferenceRegion[] = [];
  for (const d of differences) {
    const last = regions[regions.length - 1];
    if (last?.end === d) regions[regions.length - 1] = { start: last.start, end: d + 1 };
    else regions.push({ start: d, end: d + 1 });
  }
  return regions;
}

/** The first region starting after `column` (or before it, going back), wrapping round; null when there are none. */
export function nextDifference(
  regions: readonly DifferenceRegion[],
  column: number,
  backwards: boolean,
): DifferenceRegion | null {
  if (regions.length === 0) return null;
  if (!backwards) return regions.find((r) => r.start > column) ?? regions[0] ?? null;
  for (let i = regions.length - 1; i >= 0; i--) {
    const r = regions[i];
    if (r !== undefined && r.start < column) return r;
  }
  return regions[regions.length - 1] ?? null;
}

/** The reference position (1-based, as numbered on screen) of a column, or null in an inserted one. */
export function columnPosition(stack: Stack, column: number): number | null {
  const i = stack.refIndex[column];
  if (i === undefined || i < 0) return null;
  const at = stack.offset + i;
  return (stack.wrap === null ? at : at % stack.wrap) + 1;
}
