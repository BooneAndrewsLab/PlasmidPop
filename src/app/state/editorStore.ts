import {
  type CutSite,
  type EditOp,
  type Orf,
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

export type ViewMode = 'sequence' | 'map' | 'both';
export type SidebarTab = 'features' | 'enzymes' | 'orfs' | 'primers' | 'align';

export interface AnalysisState {
  /** Document the results belong to; stale when it is not the present document. */
  readonly doc: SeqDocument;
  readonly cutSites: readonly CutSite[];
  readonly orfs: readonly Orf[];
}

export interface EditorState {
  /** Undo history whose present is the open document; null before a file is opened. */
  readonly history: History<SeqDocument> | null;
  /** Current selection; an empty range is a caret. Null when nothing is selected. */
  readonly selection: Range | null;
  readonly fileName: string | null;
  /** Stable id of the open document in local storage. */
  readonly documentId: string | null;
  /** Handle of the file the document came from or was saved to, when the browser gave us one. */
  readonly fileHandle: FileSystemFileHandle | null;
  /** The version last written to a file (or the version opened from one). */
  readonly savedDoc: SeqDocument | null;
  /** Whether the present document differs from what is on disk. */
  readonly dirty: boolean;
  readonly warnings: readonly ParseWarning[];
  readonly error: string | null;
  readonly showComplement: boolean;
  readonly view: ViewMode;
  readonly sidebarTab: SidebarTab;
  readonly analysis: AnalysisState | null;
  /** Enzymes whose cut sites are drawn in the views. */
  readonly shownEnzymes: ReadonlySet<string>;
  /** Minimum ORF length in codons. */
  readonly orfMinCodons: number;
  /** Whether the default shown-enzyme set (single cutters) was applied for this document. */
  readonly enzymesInitialized: boolean;
  /** Bumped when the view should scroll to `revealPosition`. */
  readonly reveal: { readonly position: number; readonly nonce: number } | null;
  /** Set when the feature panel should open an inline rename for a feature. */
  readonly renameRequest: { readonly id: string; readonly nonce: number } | null;
  /** Feature currently open in the full editor. */
  readonly editingFeatureId: string | null;
  readonly findOpen: boolean;
}

const INITIAL: EditorState = {
  history: null,
  selection: null,
  fileName: null,
  documentId: null,
  fileHandle: null,
  savedDoc: null,
  dirty: false,
  warnings: [],
  error: null,
  showComplement: true,
  view: 'both',
  sidebarTab: 'features',
  analysis: null,
  shownEnzymes: new Set(),
  orfMinCodons: 75,
  enzymesInitialized: false,
  reveal: null,
  renameRequest: null,
  editingFeatureId: null,
  findOpen: false,
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
    const next = { ...this.state, ...patch };
    const present = next.history?.present ?? null;
    next.dirty = present !== null && next.savedDoc !== present;
    this.state = next;
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
    storage: { id?: string; handle?: FileSystemFileHandle | null } = {},
  ): void {
    this.set({
      history: History.create(doc),
      selection: null,
      fileName,
      documentId: storage.id ?? crypto.randomUUID(),
      fileHandle: storage.handle ?? null,
      // A document opened from a file starts clean; a pasted/example one has nowhere to be saved yet.
      savedDoc: fileName === null ? null : doc,
      warnings,
      error: null,
      analysis: null,
      shownEnzymes: new Set(),
      enzymesInitialized: false,
      reveal: { position: 0, nonce: (this.state.reveal?.nonce ?? 0) + 1 },
    });
  }

  closeDocument(): void {
    this.set({
      history: null,
      selection: null,
      fileName: null,
      documentId: null,
      fileHandle: null,
      savedDoc: null,
      warnings: [],
      analysis: null,
      shownEnzymes: new Set(),
      enzymesInitialized: false,
      renameRequest: null,
    });
  }

  /** Re-keys the open document in local storage (used to merge into an identical stored entry). */
  setDocumentId(id: string): void {
    if (this.state.documentId !== null && id !== this.state.documentId)
      this.set({ documentId: id });
  }

  setFileHandle(handle: FileSystemFileHandle | null): void {
    this.set({ fileHandle: handle });
  }

  /** Records that the present document now matches the file (optionally under a new name). */
  markSaved(fileName?: string): void {
    const present = this.document;
    if (present === null) return;
    this.set(fileName === undefined ? { savedDoc: present } : { savedDoc: present, fileName });
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

  /** Undoes or redoes to the state with `position` changes applied (0 = as opened). */
  jumpHistory(position: number): void {
    const history = this.state.history;
    if (history === null) return;
    const next = history.jumpTo(position);
    if (next !== history) this.set({ history: next, selection: null });
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

  editFeature(id: string | null): void {
    if (id !== this.state.editingFeatureId) this.set({ editingFeatureId: id, renameRequest: null });
  }

  setFindOpen(open: boolean): void {
    if (open !== this.state.findOpen) this.set({ findOpen: open });
  }

  finishRename(): void {
    if (this.state.renameRequest !== null) this.set({ renameRequest: null });
  }

  revealPosition(position: number): void {
    this.set({ reveal: { position, nonce: (this.state.reveal?.nonce ?? 0) + 1 } });
  }

  setSidebarTab(tab: SidebarTab): void {
    if (tab !== this.state.sidebarTab) this.set({ sidebarTab: tab });
  }

  /**
   * Stores analysis results. The first results for a newly opened document
   * also pick the default enzymes to display: those that cut exactly once.
   */
  setAnalysis(doc: SeqDocument, cutSites: readonly CutSite[], orfs: readonly Orf[]): void {
    if (this.document !== doc) return; // stale result
    let shownEnzymes = this.state.shownEnzymes;
    let enzymesInitialized = this.state.enzymesInitialized;
    if (!enzymesInitialized) {
      const counts = new Map<string, number>();
      for (const s of cutSites) counts.set(s.enzyme, (counts.get(s.enzyme) ?? 0) + 1);
      shownEnzymes = new Set(
        [...counts.entries()].filter(([, n]) => n === 1).map(([name]) => name),
      );
      enzymesInitialized = true;
    }
    this.set({ analysis: { doc, cutSites, orfs }, shownEnzymes, enzymesInitialized });
  }

  setEnzymeShown(name: string, shown: boolean): void {
    if (this.state.shownEnzymes.has(name) === shown) return;
    const next = new Set(this.state.shownEnzymes);
    if (shown) next.add(name);
    else next.delete(name);
    this.set({ shownEnzymes: next });
  }

  setShownEnzymes(names: Iterable<string>): void {
    this.set({ shownEnzymes: new Set(names), enzymesInitialized: true });
  }

  setOrfMinCodons(n: number): void {
    const value = Math.max(1, Math.floor(n));
    if (value !== this.state.orfMinCodons) this.set({ orfMinCodons: value, analysis: null });
  }

  /** Cut sites of the enzymes currently shown, for the present document only. */
  visibleCutSites(): readonly CutSite[] {
    const a = this.state.analysis;
    if (a?.doc !== this.document) return [];
    return a.cutSites.filter((s) => this.state.shownEnzymes.has(s.enzyme));
  }

  setView(view: ViewMode): void {
    if (view !== this.state.view) this.set({ view });
  }

  setShowComplement(show: boolean): void {
    if (show !== this.state.showComplement) this.set({ showComplement: show });
  }
}

export const editorStore = new EditorStore();
