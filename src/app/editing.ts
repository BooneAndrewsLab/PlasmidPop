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
  normalizeSequenceInput,
  isRnaDocument,
  fromRnaLetters,
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

/*
 * A caret is a boundary between bases, in [0, length] on either topology.
 * On a circle the caret after the last base and the one before the first are
 * the same point, but text typed at the one is appended and at the other
 * prepended, so a caret at `length` is never folded onto 0 (#265). Bases and
 * the ranges over them wrap; carets only wrap when they go past an end.
 */

/**
 * Where the start of a deleted selection sits once it is gone, as a valid
 * caret. The same point `SeqDocument.insertFragment` pastes at.
 */
function caretAfterDelete(doc: SeqDocument, selection: Range): number {
  const newLength = doc.length - (selection.end - selection.start);
  if (newLength === 0) return 0;
  return Math.min(shiftPositionForDelete(selection.start, selection, doc.length), newLength);
}

/**
 * Wraps or clamps a position so it is a valid caret for the document. On a
 * circle a step past either end comes round to the other end: one past
 * `length` is 0 and one before 0 is `length`, the same point on the circle,
 * so the caret passes no base on the way; further out it wraps round as
 * bases do. `length` itself stays the end, so the caret can always get there
 * to append. With `extend` (a Shift+arrow) the caret stops at the ends, as
 * on a linear sequence, since the selection's anchor would otherwise end up
 * across the whole circle from it.
 */
export function clampPosition(doc: SeqDocument, position: number, extend = false): number {
  if (doc.length === 0) return 0;
  if (doc.isCircular && !extend) {
    if (position >= 0 && position <= doc.length) return position;
    if (position === doc.length + 1) return 0;
    if (position === -1) return doc.length;
    return ((position % doc.length) + doc.length) % doc.length;
  }
  return Math.min(doc.length, Math.max(0, position));
}

/**
 * Where the caret goes after `selection` is replaced by `count` bases: just
 * past the last of them. Mirrors `SeqDocument.replace`, which overwrites the
 * common prefix in place and then inserts or deletes the difference.
 */
function caretAfterReplace(doc: SeqDocument, selection: Range, count: number): number {
  const oldLength = selection.end - selection.start;
  const common = Math.min(oldLength, count);
  const written = selection.start + common;
  if (count >= oldLength) {
    // The rest goes in after the overwritten bases, at the end of the circle
    // rather than its start when they reach it.
    const pivot = doc.isCircular && written > doc.length ? written - doc.length : written;
    return pivot + count - common;
  }
  // What is left over is deleted after the written bases; when they reach
  // the end of a circle it comes off the front, and the caret stays at the end.
  if (doc.isCircular && written === doc.length) return doc.length - (oldLength - common);
  const pivot = doc.isCircular ? written % doc.length : written;
  return caretAfterDelete(doc, range(pivot, pivot + oldLength - common));
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
  const typed = normalizeSequenceInput(rawText, doc.alphabet);
  // An RNA shows U but keeps T (#113): a U typed or pasted is stored as T.
  const text = isRnaDocument(doc) ? fromRnaLetters(typed) : typed;
  if (text.length === 0 || selection === null) return null;
  if (isEmptyRange(selection)) {
    const p = selection.start;
    const after = p + text.length;
    const plan: EditPlan = {
      op: { type: 'insert', position: p, text },
      selectionAfter: caret(after),
    };
    // Only one base at a time is typing; a longer run of text is a paste and
    // deserves an undo step of its own.
    if (text.length !== 1) return plan;
    // The key is the caret as the next keystroke will see it.
    return { ...plan, coalesce: typingRun(p, after) };
  }
  return {
    op: { type: 'replace', range: selection, text },
    selectionAfter: caret(caretAfterReplace(doc, selection, text.length)),
  };
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
  const after = caretAfterDelete(doc, selection) + fragment.sequence.length;
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
  const p = selection.start;
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
  const p = selection.start;
  if (p >= doc.length) {
    if (!doc.isCircular) return null;
    // Delete at the end of a circular sequence eats the first base; the
    // caret stays at the end, which is now one base nearer.
    return {
      op: { type: 'delete', range: range(0, 1) },
      selectionAfter: caret(doc.length - 1),
      coalesce: deleteForwardRun(p, doc.length - 1),
    };
  }
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
    case 'removeFeatures':
      return selection;
  }
}
