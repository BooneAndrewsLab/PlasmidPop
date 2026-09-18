import {
  type EditOp,
  type SeqFragment,
  type Range,
  type SeqDocument,
  assertValidSequence,
  isEmptyRange,
  newFeatureId,
  normalizePosition,
  normalizeSequenceInput,
  range,
  shiftPositionForDelete,
} from '@/core';

/** An edit to apply plus where the selection should land afterwards. */
export interface EditPlan {
  readonly op: EditOp;
  readonly selectionAfter: Range;
}

function caret(position: number): Range {
  return range(position, position);
}

/** Where the start of a deleted selection sits once it is gone, as a valid caret. */
function caretAfterDelete(doc: SeqDocument, selection: Range): number {
  const newLength = doc.length - (selection.end - selection.start);
  if (newLength === 0) return 0;
  const start = normalizePosition(selection.start, doc.length, doc.topology);
  const moved = shiftPositionForDelete(start, selection, doc.length);
  return doc.isCircular ? moved % newLength : Math.min(moved, newLength);
}

/** Wraps or clamps a position so it is a valid caret for the document. */
export function clampPosition(doc: SeqDocument, position: number): number {
  if (doc.length === 0) return 0;
  if (doc.isCircular) return ((position % doc.length) + doc.length) % doc.length;
  return Math.min(doc.length, Math.max(0, position));
}

/**
 * Typing or pasting: inserts at a caret, or replaces the selection. Throws
 * `InvalidSequenceError` for non-nucleotide text. Returns null when there is
 * nothing to do.
 */
export function typeText(
  doc: SeqDocument,
  selection: Range | null,
  rawText: string,
): EditPlan | null {
  const text = normalizeSequenceInput(rawText);
  if (text.length === 0 || selection === null) return null;
  if (isEmptyRange(selection)) {
    const p = normalizePosition(selection.start, doc.length, doc.topology);
    return { op: { type: 'insert', position: p, text }, selectionAfter: caret(p + text.length) };
  }
  const newLength = doc.length - (selection.end - selection.start) + text.length;
  const after =
    doc.isCircular && newLength > 0
      ? (selection.start + text.length) % newLength
      : selection.start + text.length;
  return { op: { type: 'replace', range: selection, text }, selectionAfter: caret(after) };
}

/**
 * Pasting a fragment: its bases replace the selection (or go in at the
 * caret) and its features come along, shifted to the paste position and
 * given fresh ids so the same fragment can be pasted more than once. A
 * fragment without features behaves exactly like pasted text.
 */
export function pasteFragment(
  doc: SeqDocument,
  selection: Range | null,
  fragment: SeqFragment,
): EditPlan | null {
  if (fragment.features.length === 0) return typeText(doc, selection, fragment.sequence);
  if (selection === null) return null;
  assertValidSequence(fragment.sequence);
  const features = fragment.features.map((f) => ({ ...f, id: newFeatureId() }));
  const newLength = doc.length - (selection.end - selection.start) + fragment.sequence.length;
  const end = caretAfterDelete(doc, selection) + fragment.sequence.length;
  const after = doc.isCircular && newLength > 0 ? end % newLength : end;
  return {
    op: { type: 'insertFragment', range: selection, fragment: { ...fragment, features } },
    selectionAfter: caret(after),
  };
}

/** Deletes the selection and leaves a caret where it started. */
export function deleteSelection(doc: SeqDocument, selection: Range): EditPlan {
  return {
    op: { type: 'delete', range: selection },
    selectionAfter: caret(caretAfterDelete(doc, selection)),
  };
}

/** Backspace: the selection, or the base before the caret (wrapping on circular sequences). */
export function deleteBackward(doc: SeqDocument, selection: Range | null): EditPlan | null {
  if (selection === null || doc.length === 0) return null;
  if (!isEmptyRange(selection)) return deleteSelection(doc, selection);
  const p = normalizePosition(selection.start, doc.length, doc.topology);
  if (p === 0) {
    if (!doc.isCircular) return null;
    return {
      op: { type: 'delete', range: range(doc.length - 1, doc.length) },
      selectionAfter: caret(0),
    };
  }
  return { op: { type: 'delete', range: range(p - 1, p) }, selectionAfter: caret(p - 1) };
}

/** Delete key: the selection, or the base after the caret. */
export function deleteForward(doc: SeqDocument, selection: Range | null): EditPlan | null {
  if (selection === null || doc.length === 0) return null;
  if (!isEmptyRange(selection)) return deleteSelection(doc, selection);
  const p = normalizePosition(selection.start, doc.length, doc.topology);
  if (p >= doc.length) return null;
  return { op: { type: 'delete', range: range(p, p + 1) }, selectionAfter: caret(p) };
}

/** Selection spanning `anchor` and `focus` in either order. */
export function selectionBetween(anchor: number, focus: number): Range {
  return anchor <= focus ? range(anchor, focus) : range(focus, anchor);
}

/** Where the caret should sit after a document-wide op, so the user does not lose their place. */
export function selectionAfterOp(
  doc: SeqDocument,
  selection: Range | null,
  op: EditOp,
): Range | null {
  if (selection === null) return null;
  switch (op.type) {
    case 'reverseComplement': {
      const len = selection.end - selection.start;
      let start = doc.length - selection.end;
      if (doc.isCircular && doc.length > 0)
        start = ((start % doc.length) + doc.length) % doc.length;
      return range(start, start + len);
    }
    case 'setOrigin': {
      if (doc.length === 0) return selection;
      const start = (((selection.start - op.position) % doc.length) + doc.length) % doc.length;
      return range(start, start + (selection.end - selection.start));
    }
    case 'setTopology':
      return op.topology === 'linear' && selection.end > doc.length ? null : selection;
    case 'insert':
    case 'delete':
    case 'replace':
    case 'insertFragment':
    case 'rename':
    case 'setMetadata':
    case 'addFeature':
    case 'updateFeature':
    case 'removeFeature':
      return selection;
  }
}
