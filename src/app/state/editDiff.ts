import { useMemo } from 'react';

import {
  type DocumentDiff,
  type Range,
  type SeqDocument,
  diffDocuments,
  isEmptyDiff,
} from '@/core';

import { analytics } from '../analytics';
import { type ChangeTarget } from '@/view/circular';

import {
  type IdentityChange,
  changeSelection,
  changeStops,
  identityChange,
  stepChange,
} from '../editsView';
import { isCopyNameOf } from './derive';
import {
  type EditorState,
  editorStore,
  editsBaselineDocument,
  effectiveEditsBaseline,
} from './editorStore';
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

/**
 * The name and topology the active baseline had, where they differ from the
 * document's now (#31): null when the marks are off, as the marks are.
 */
export function identityChangeOf(state: EditorState): IdentityChange | null {
  const baseline = editsBaselineDocument(state);
  const current = state.history?.present ?? null;
  const change = identityChange(baseline, current);
  // A working copy takes a name of its own by itself (item 24), which the
  // copy banner already says; only a name the user gave it is a rename.
  // Against another file the other's name is what it is, copy or not.
  if (
    change?.nameWas == null ||
    !state.derived ||
    effectiveEditsBaseline(state) === 'compared' ||
    current === null ||
    !isCopyNameOf(current.name, change.nameWas)
  )
    return change;
  return change.topologyWas === null ? null : { nameWas: null, topologyWas: change.topologyWas };
}

export function useIdentityChange(): IdentityChange | null {
  const state = useEditorState();
  return useMemo(() => identityChangeOf(state), [state]);
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

/**
 * A click on a change on the map (#27): selects it as Next change would —
 * a mark's span, a deletion's caret, a removed feature's mapped span — and
 * scrolls the views to it. False when the diff has no such change any more.
 */
export function selectChange(target: ChangeTarget): boolean {
  const state = editorStore.getState();
  const doc = state.history?.present ?? null;
  const diff = editDiffOf(state);
  if (doc === null || diff === null) return false;
  const range = changeSelection(target, diff, doc.length, doc.topology === 'circular');
  if (range === null) return false;
  analytics.trackOnce('edits', 'map-click', target.kind);
  editorStore.setSelection(range);
  editorStore.revealPosition(range.start);
  return true;
}
