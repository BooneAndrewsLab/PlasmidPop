import {
  type Coalesce,
  type EditOp,
  type SeqFragment,
  type Range,
  type SeqDocument,
  assertFragmentFits,
  backspaceRun,
  deleteForwardRun,
  flipWindow,
  flippedLength,
  isEmptyRange,
  newFeatureId,
  normalizePosition,
  normalizeSequenceInput,
  range,
  shiftPositionForDelete,
  typingRun,
  windowShift,
} from '@/core';

/** An edit to apply plus where the selection should land afterwards. */
export interface EditPlan {
  readonly op: EditOp;
  readonly selectionAfter: Range;
  /**
   * Set when this edit may join the one before it as a single undo step: one
   * base of a run of typing, one press of a held Backspace or Delete. See
   * `core/document/coalesce.ts`.
   */
  readonly coalesce?: Coalesce;
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
 * `InvalidSequenceError` for text outside the document's alphabet. Returns null when there is
 * nothing to do.
 */
export function typeText(
  doc: SeqDocument,
  selection: Range | null,
  rawText: string,
): EditPlan | null {
  const text = normalizeSequenceInput(rawText, doc.alphabet);
  if (text.length === 0 || selection === null) return null;
  if (isEmptyRange(selection)) {
    const p = normalizePosition(selection.start, doc.length, doc.topology);
    const after = p + text.length;
    const plan: EditPlan = {
      op: { type: 'insert', position: p, text },
      selectionAfter: caret(after),
    };
    // Only one base at a time is typing; a longer run of text is a paste and
    // deserves an undo step of its own.
    if (text.length !== 1) return plan;
    // The key is the caret as the next keystroke will see it, so a run that
    // reaches the origin of a circular sequence carries on across it.
    return {
      ...plan,
      coalesce: typingRun(p, normalizePosition(after, doc.length + text.length, doc.topology)),
    };
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
  // Residues never paste into DNA, nor bases into a protein, even where the letters would do (#66).
  assertFragmentFits(fragment, doc.alphabet);
  if (fragment.features.length === 0) return typeText(doc, selection, fragment.sequence);
  if (selection === null) return null;
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
    // Backspacing at the origin of a circular sequence eats the last base
    // and leaves the caret where it was, so the whole run shares a key.
    return {
      op: { type: 'delete', range: range(doc.length - 1, doc.length) },
      selectionAfter: caret(0),
      coalesce: backspaceRun(0, 0),
    };
  }
  return {
    op: { type: 'delete', range: range(p - 1, p) },
    selectionAfter: caret(p - 1),
    coalesce: backspaceRun(p, p - 1),
  };
}

/** Delete key: the selection, or the base after the caret. */
export function deleteForward(doc: SeqDocument, selection: Range | null): EditPlan | null {
  if (selection === null || doc.length === 0) return null;
  if (!isEmptyRange(selection)) return deleteSelection(doc, selection);
  const p = normalizePosition(selection.start, doc.length, doc.topology);
  if (p >= doc.length) return null;
  return {
    op: { type: 'delete', range: range(p, p + 1) },
    selectionAfter: caret(p),
    coalesce: deleteForwardRun(p),
  };
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
      // A sticky-ended molecule comes out of a flip a different length and
      // with its bases at a different offset (`flipWindow` in `core/document`),
      // so the mirror is about the new length, not this one; a selection on
      // an overhang that has gone collapses to the end it was at.
      const window = flipWindow(doc.ends);
      const flipped = flippedLength(window, doc.length);
      const start = flipped - (selection.end + windowShift(window));
      if (doc.isCircular && doc.length > 0) {
        const wrapped = ((start % doc.length) + doc.length) % doc.length;
        return range(wrapped, wrapped + len);
      }
      const clamp = (p: number): number => Math.max(0, Math.min(p, flipped));
      return range(clamp(start), clamp(start + len));
    }
    case 'setOrigin': {
      if (doc.length === 0) return selection;
      const start = (((selection.start - op.position) % doc.length) + doc.length) % doc.length;
      return range(start, start + (selection.end - selection.start));
    }
    case 'setTopology':
      return op.topology === 'linear' && selection.end > doc.length ? null : selection;
    case 'bluntEnds':
      // Trimming a left 5′ overhang takes bases off the start; every other
      // case adds or removes them only at the right end.
      return range(
        doc.mapPositionThrough(op, selection.start),
        doc.mapPositionThrough(op, selection.end),
      );
    case 'setEnds':
    case 'setMethylation':
    case 'styleBases':
    case 'changeCase':
    case 'insert':
    case 'delete':
    case 'replace':
    case 'insertFragment':
    case 'rename':
    case 'setMetadata':
    case 'addFeature':
    case 'addFeatures':
    case 'updateFeature':
    case 'removeFeature':
      return selection;
  }
}
