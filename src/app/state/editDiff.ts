import { useMemo } from 'react';

import {
  type DocumentDiff,
  type Range,
  type SeqDocument,
  diffDocuments,
  isEmptyDiff,
} from '@/core';

import { analytics } from '../analytics';
import { changeStops, stepChange } from '../editsView';
import { type EditorState, editorStore, editsBaselineDocument } from './editorStore';
import { useEditorState } from './useEditorStore';

/**
 * Last computed diff. Documents are immutable, so the pair of versions is a
 * complete key; this keeps the sequence view and the Edits menu from diffing
 * the same two documents twice per render.
 */
let cache: { baseline: SeqDocument; current: SeqDocument; diff: DocumentDiff } | null = null;

export function editDiffBetween(
  baseline: SeqDocument | null,
  current: SeqDocument | null,
): DocumentDiff | null {
  if (baseline === null || current === null || baseline === current) return null;
  if (cache !== null && cache.baseline === baseline && cache.current === current) return cache.diff;
  const diff = diffDocuments(baseline, current);
  cache = { baseline, current, diff };
  return diff;
}

/** The changes the views should mark, or null when there is nothing to mark. */
export function editDiffOf(state: EditorState): DocumentDiff | null {
  const diff = editDiffBetween(editsBaselineDocument(state), state.history?.present ?? null);
  return diff === null || isEmptyDiff(diff) ? null : diff;
}

export function useEditDiff(): DocumentDiff | null {
  const state = useEditorState();
  return useMemo(() => editDiffOf(state), [state]);
}

/** Where Next change and Previous change can go in the document in front; see `changeStops`. */
export function changeStopsOf(state: EditorState): readonly Range[] {
  const doc = state.history?.present ?? null;
  if (doc === null) return [];
  return changeStops(editDiffOf(state), doc.length, doc.topology === 'circular');
}

/**
 * Next change (`1`) or Previous change (`-1`): selects the next edit mark
 * from the selection, or puts the caret on the next deletion, and scrolls
 * the views to it, as Find does with a match. False when nothing is marked.
 */
export function goToChange(direction: 1 | -1): boolean {
  const state = editorStore.getState();
  const stop = stepChange(changeStopsOf(state), state.selection, direction);
  if (stop === null) return false;
  analytics.trackOnce('edits', direction === 1 ? 'next' : 'prev');
  editorStore.setSelection(stop);
  editorStore.revealPosition(stop.start);
  return true;
}
