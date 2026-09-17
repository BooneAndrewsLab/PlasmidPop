import {
  type EditOp,
  type Range,
  type RangeSegment,
  type SeqDocument,
  History,
  describeEditOp,
  isEmptyRange,
} from '@/core';
import { type ParseResult, type ParseWarning } from '@/io';

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
}

const INITIAL: EditorState = {
  history: null,
  selection: null,
  fileName: null,
  warnings: [],
  error: null,
  showComplement: true,
  reveal: null,
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

  apply(op: EditOp): void {
    const history = this.state.history;
    if (history === null) return;
    const next = history.present.apply(op);
    if (next === history.present) return;
    const selection =
      this.state.selection === null
        ? null
        : isEmptyRange(this.state.selection)
          ? (() => {
              const p = history.present.mapPositionThrough(op, this.state.selection.start);
              return { start: p, end: p };
            })()
          : null;
    this.set({ history: history.push(next, describeEditOp(op)), selection });
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

  revealPosition(position: number): void {
    this.set({ reveal: { position, nonce: (this.state.reveal?.nonce ?? 0) + 1 } });
  }

  setShowComplement(show: boolean): void {
    if (show !== this.state.showComplement) this.set({ showComplement: show });
  }
}

export const editorStore = new EditorStore();
