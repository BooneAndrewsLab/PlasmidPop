import {
  type EditOp,
  type Range,
  type RangeSegment,
  type SeqDocument,
  History,
  createFeature,
  describeEditOp,
  isEmptyRange,
  rangeSegment,
} from '@/core';
import { type ParseResult, type ParseWarning } from '@/io';

import { type EditPlan, selectionAfterOp } from '../editing';

export interface EditorState {
  /** Undo history whose present is the open document; null before a file is opened. */
  readonly history: History<SeqDocument> | null;
  /** Current selection; an empty range is a caret. Null when nothing is selected. */
  readonly selection: Range | null;
  readonly fileName: string | null;
  readonly warnings: readonly ParseWarning[];
  readonly error: string | null;
  readonly showComplement: boolean;
  /** Bumped when the view should scroll to `revealPosition`. */
  readonly reveal: { readonly position: number; readonly nonce: number } | null;
  /** Set when the feature panel should open an inline rename for a feature. */
  readonly renameRequest: { readonly id: string; readonly nonce: number } | null;
}

const INITIAL: EditorState = {
  history: null,
  selection: null,
  fileName: null,
  warnings: [],
  error: null,
  showComplement: true,
  reveal: null,
  renameRequest: null,
};

type Listener = () => void;

/**
 * Minimal external store for the editor: immutable state, plain methods for
 * every action, and `subscribe`/`getState` for React's useSyncExternalStore.
 * Everything document-related goes through `apply(op)` so undo, and later a
 * CRDT layer, see one vocabulary of changes.
 */
export class EditorStore {
  private state: EditorState = INITIAL;
  private readonly listeners = new Set<Listener>();

  getState = (): EditorState => this.state;

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  get document(): SeqDocument | null {
    return this.state.history?.present ?? null;
  }

  private set(patch: Partial<EditorState>): void {
    this.state = { ...this.state, ...patch };
    for (const l of this.listeners) l();
  }

  /** Shows the first document of a parse result. */
  openParsed(result: ParseResult, fileName: string | null): void {
    const doc = result.documents[0];
    if (doc === undefined) {
      this.set({ error: 'The file contains no sequences.', warnings: result.warnings });
      return;
    }
    this.openDocument(doc, fileName, result.warnings);
  }

  openDocument(
    doc: SeqDocument,
    fileName: string | null = null,
    warnings: readonly ParseWarning[] = [],
  ): void {
    this.set({
      history: History.create(doc),
      selection: null,
      fileName,
      warnings,
      error: null,
      reveal: { position: 0, nonce: (this.state.reveal?.nonce ?? 0) + 1 },
    });
  }

  fail(message: string): void {
    this.set({ error: message });
  }

  dismissError(): void {
    if (this.state.error !== null) this.set({ error: null });
  }

  /**
   * Applies an op. The selection follows the edit: a caret is mapped through
   * inserts and deletes, and document-wide ops (reverse complement, set
   * origin) move it along; `selectionAfter` overrides that when given.
   */
  apply(op: EditOp, selectionAfter?: Range | null): void {
    const history = this.state.history;
    if (history === null) return;
    const doc = history.present;
    const next = doc.apply(op);
    if (next === doc) return;
    let selection: Range | null;
    if (selectionAfter !== undefined) {
      selection = selectionAfter;
    } else if (this.state.selection !== null && isEmptyRange(this.state.selection)) {
      const p = doc.mapPositionThrough(op, this.state.selection.start);
      selection = { start: p, end: p };
    } else {
      selection = selectionAfterOp(doc, this.state.selection, op);
    }
    if (selection !== null && selection.start === selection.end && selection.start > next.length) {
      selection = { start: next.length, end: next.length };
    }
    const reveal =
      selection !== null && (op.type === 'insert' || op.type === 'delete' || op.type === 'replace')
        ? { position: selection.start, nonce: (this.state.reveal?.nonce ?? 0) + 1 }
        : this.state.reveal;
    this.set({ history: history.push(next, describeEditOp(op)), selection, reveal });
  }

  applyPlan(plan: EditPlan | null): void {
    if (plan !== null) this.apply(plan.op, plan.selectionAfter);
  }

  /** Annotates the current selection as a new feature and asks the panel to name it. */
  addFeatureFromSelection(): void {
    const doc = this.document;
    const selection = this.state.selection;
    if (doc === null || selection === null || isEmptyRange(selection)) return;
    const feature = createFeature({
      type: 'misc_feature',
      name: 'New feature',
      segments: [rangeSegment(selection.start, selection.end)],
    });
    this.apply({ type: 'addFeature', feature }, selection);
    this.set({
      renameRequest: { id: feature.id, nonce: (this.state.renameRequest?.nonce ?? 0) + 1 },
    });
  }

  undo(): void {
    const history = this.state.history;
    if (history?.canUndo !== true) return;
    this.set({ history: history.undo(), selection: null });
  }

  redo(): void {
    const history = this.state.history;
    if (history?.canRedo !== true) return;
    this.set({ history: history.redo(), selection: null });
  }

  setSelection(selection: Range | null): void {
    const current = this.state.selection;
    if (
      (selection === null && current === null) ||
      (selection !== null &&
        current !== null &&
        selection.start === current.start &&
        selection.end === current.end)
    ) {
      return;
    }
    this.set({ selection });
  }

  /** Selects a feature's full extent (its first range segment through its last) and scrolls to it. */
  selectFeature(featureId: string): void {
    const feature = this.document?.getFeature(featureId);
    if (feature === undefined) return;
    const ranges = feature.segments.filter((s): s is RangeSegment => s.kind === 'range');
    const first = ranges[0];
    const last = ranges[ranges.length - 1];
    if (first === undefined || last === undefined) return;
    const selection = { start: first.start, end: Math.max(last.end, first.end) };
    this.set({
      selection,
      reveal: { position: first.start, nonce: (this.state.reveal?.nonce ?? 0) + 1 },
    });
  }

  requestRename(id: string): void {
    this.set({ renameRequest: { id, nonce: (this.state.renameRequest?.nonce ?? 0) + 1 } });
  }

  finishRename(): void {
    if (this.state.renameRequest !== null) this.set({ renameRequest: null });
  }

  revealPosition(position: number): void {
    this.set({ reveal: { position, nonce: (this.state.reveal?.nonce ?? 0) + 1 } });
  }

  setShowComplement(show: boolean): void {
    if (show !== this.state.showComplement) this.set({ showComplement: show });
  }
}

export const editorStore = new EditorStore();
