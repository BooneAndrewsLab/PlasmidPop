import { useMemo } from 'react';

import { type DocumentDiff, type SeqDocument, diffDocuments, isEmptyDiff } from '@/core';

import { type EditorState, editsBaselineDocument } from './editorStore';
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
