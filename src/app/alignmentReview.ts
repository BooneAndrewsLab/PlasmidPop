import type { SeqDocument } from '@/core';

import {
  Cell,
  type DifferenceRegion,
  isDifference,
  type Stack,
  type StackRow,
} from './alignmentStack';

/**
 * Acting on a difference in the large view (#123): marking it reviewed (a
 * known poor call, say) or taking the sample's bases there into the
 * document as an ordinary edit.
 *
 * A mark is keyed by where the region sits on the reference, not by its
 * column or its index, because hiding a sample rebuilds the stack (#127):
 * columns another sample's insertion opened come and go, and regions are
 * renumbered. Columns are 0-based; document positions 0-based half-open.
 */

/** What was done with a difference: looked at and let stand, or written into the document. */
export type ReviewMark = 'reviewed' | 'taken';

/**
 * A column as "p" (reference index p) or "p+k" (the k-th column after
 * reference index p, an insertion; p is -1 before the first base).
 */
function anchorOf(stack: Stack, column: number): string {
  const own = stack.refIndex[column] ?? -1;
  if (own >= 0) return `${own}`;
  let c = column - 1;
  while (c >= 0 && (stack.refIndex[c] ?? -1) < 0) c--;
  return `${c < 0 ? -1 : (stack.refIndex[c] ?? -1)}+${column - c}`;
}

/** The region's key: its first and last column anchored on the reference. */
export function regionKey(stack: Stack, region: DifferenceRegion): string {
  return `${anchorOf(stack, region.start)}..${anchorOf(stack, region.end - 1)}`;
}

/** Per region index, its mark, for the regions that have one. */
export function marksOf(
  stack: Stack,
  regions: readonly DifferenceRegion[],
  marks: ReadonlyMap<string, ReviewMark>,
): Map<number, ReviewMark> {
  const out = new Map<number, ReviewMark>();
  if (marks.size === 0) return out;
  regions.forEach((region, i) => {
    const mark = marks.get(regionKey(stack, region));
    if (mark !== undefined) out.set(i, mark);
  });
  return out;
}

/** Every column of the marked regions, for dimming them and leaving them out of the verdict. */
export function markedColumns(
  regions: readonly DifferenceRegion[],
  marked: ReadonlyMap<number, ReviewMark>,
): Set<number> {
  const out = new Set<number>();
  for (const i of marked.keys()) {
    const region = regions[i];
    if (region === undefined) continue;
    for (let c = region.start; c < region.end; c++) out.add(c);
  }
  return out;
}

/** One change written into the document, in its coordinates when written: `[start, end)` became `text`. */
export interface DocumentEdit {
  readonly start: number;
  readonly end: number;
  readonly text: string;
}

export type TakeResult =
  | { readonly ok: true; readonly edit: DocumentEdit }
  | { readonly ok: false; readonly reason: string };

/**
 * The edit that writes `row`'s bases over the region into the document the
 * reference was taken from, `length` long. The reference's bases in the
 * region are replaced by the sample's, gaps left out: a deletion removes
 * bases, an insertion adds them before the next reference base. Refused when
 * the sample does not reach every column of the region, carries no
 * difference there, or the region runs through a circle's origin (an edit
 * is one range of the document).
 */
export function takeEdit(
  stack: Stack,
  region: DifferenceRegion,
  row: StackRow,
  length: number,
  circular: boolean,
): TakeResult {
  let differs = false;
  for (let c = region.start; c < region.end; c++) {
    const cell = row.cells[c] ?? Cell.Blank;
    if (cell === Cell.Blank) {
      return { ok: false, reason: `${row.name} does not reach all of this difference` };
    }
    if (isDifference(cell)) differs = true;
  }
  if (!differs) return { ok: false, reason: `${row.name} matches the document here` };
  const text = row.bases.slice(region.start, region.end).replace(/[- ]/g, '');
  const toDocument = (index: number): number => {
    const p = stack.offset + index;
    return circular && length > 0 && p >= length ? p - length : p;
  };
  let first = -1;
  let last = -1;
  for (let c = region.start; c < region.end; c++) {
    const i = stack.refIndex[c] ?? -1;
    if (i < 0) continue;
    if (first < 0) first = i;
    last = i;
  }
  if (first >= 0) {
    const start = toDocument(first);
    const end = start + (last - first + 1);
    if (end > length) return { ok: false, reason: 'This difference runs through the origin' };
    return { ok: true, edit: { start, end, text } };
  }
  // Only inserted columns: the bases go before the next reference base, or after the last.
  let next = -1;
  for (let c = region.end; c < stack.columns && next < 0; c++) next = stack.refIndex[c] ?? -1;
  let position: number;
  if (next >= 0) position = toDocument(next);
  else {
    let before = -1;
    for (let c = region.start - 1; c >= 0 && before < 0; c--) before = stack.refIndex[c] ?? -1;
    position = before < 0 ? toDocument(0) : toDocument(before) + 1;
  }
  return { ok: true, edit: { start: position, end: position, text } };
}

/**
 * A range of the document as it was aligned, carried through the edits taken
 * since (in order), or null when it overlaps one of them, which means that
 * difference was already written over.
 */
export function mapThroughEdits(
  edits: readonly DocumentEdit[],
  range: { readonly start: number; readonly end: number },
): { start: number; end: number } | null {
  let { start, end } = range;
  for (const e of edits) {
    const shift = e.text.length - (e.end - e.start);
    if (start >= e.end) {
      start += shift;
      end += shift;
    } else if (end > e.start) {
      return null;
    }
  }
  return { start, end };
}

/**
 * The text to write, in the case of the document's bases beside it: a
 * document written in lower case (as many SnapGene files are) gets lower
 * case, so a taken base does not stand out for its letter alone.
 */
export function inDocumentCase(text: string, beside: string): string {
  return /[a-z]/.test(beside) && !/[A-Z]/.test(beside) ? text.toLowerCase() : text.toUpperCase();
}

/** Whether `doc` holds the reference's bases where the reference says it was cut from. */
export function documentHoldsReference(
  doc: SeqDocument,
  reference: { readonly sequence: string; readonly offset: number },
): boolean {
  const { sequence, offset } = reference;
  if (offset + sequence.length > doc.length) return false;
  return (
    doc.sequence.slice(offset, offset + sequence.length).toUpperCase() === sequence.toUpperCase()
  );
}

/**
 * What the large view keeps of a review for the life of an alignment result:
 * the marks, the edits taken and the documents before and after them, so
 * opening the window again on the same result finds them. Keyed by the
 * result's reference object, which every alignment run makes afresh.
 */
export interface ReviewState {
  marks: Map<string, ReviewMark>;
  edits: DocumentEdit[];
  /** The document the alignment was made against, once it has been checked to hold the reference. */
  aligned: SeqDocument | null;
  /** The document after the last edit taken, which the next one must find in front. */
  latest: SeqDocument | null;
}

const reviews = new WeakMap<object, ReviewState>();

export function reviewStateFor(reference: object): ReviewState {
  let state = reviews.get(reference);
  if (state === undefined) {
    state = { marks: new Map(), edits: [], aligned: null, latest: null };
    reviews.set(reference, state);
  }
  return state;
}

/**
 * Holds `doc` as the document the result was aligned against, the first time
 * it is asked and only when it holds the reference; returns what is held.
 */
export function holdAlignedDocument(
  reference: { readonly sequence: string; readonly offset: number },
  doc: SeqDocument | null,
): SeqDocument | null {
  const state = reviewStateFor(reference);
  if (state.aligned === null && doc !== null && documentHoldsReference(doc, reference)) {
    state.aligned = doc;
  }
  return state.aligned;
}

/** Marks a region of the result by its key, or takes the mark off; returns the marks now. */
export function setReviewMark(
  reference: object,
  key: string,
  mark: ReviewMark | null,
): Map<string, ReviewMark> {
  const { marks } = reviewStateFor(reference);
  if (mark === null) marks.delete(key);
  else marks.set(key, mark);
  return new Map(marks);
}

/** Records an edit taken into the document, and the document it made. */
export function recordTaken(
  reference: object,
  edit: DocumentEdit,
  after: SeqDocument | null,
): void {
  const state = reviewStateFor(reference);
  state.edits.push(edit);
  state.latest = after;
}
