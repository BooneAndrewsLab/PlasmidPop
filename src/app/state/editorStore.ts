import { analytics } from '../analytics';
import {
  type CutSite,
  type DigestFragment,
  type EditOp,
  type Orf,
  type Range,
  type RangeSegment,
  History,
  SeqDocument,
  createFeature,
  describeEditOp,
  isEmptyRange,
  newId,
  rangeSegment,
} from '@/core';
import { type ParseResult, type ParseWarning } from '@/io';

import { type EditPlan, selectionAfterOp } from '../editing';

export type ViewMode = 'sequence' | 'map' | 'both';
export type SidebarTab =
  'features' | 'enzymes' | 'orfs' | 'translate' | 'primers' | 'align' | 'cloning' | 'history';

/** A digest fragment set aside for ligation, in the orientation it will be joined. */
export interface AssemblyPart {
  readonly id: string;
  readonly fragment: DigestFragment;
  /** Whether the fragment was turned around since it was added. */
  readonly flipped: boolean;
}

export interface AnalysisState {
  /** Document the results belong to; stale when it is not the present document. */
  readonly doc: SeqDocument;
  readonly cutSites: readonly CutSite[];
  readonly orfs: readonly Orf[];
  /**
   * True when the results were carried over from the previous document by
   * shifting positions through an edit, so the views have something to draw
   * while the worker recomputes. Positions are approximate until then.
   */
  readonly provisional: boolean;
}

/** How long a self-dismissing error fades once its time is up. */
export const ERROR_FADE_MS = 400;

/** Ops that leave the sequence and topology alone, so analysis results stay exact. */
const ANNOTATION_OPS: ReadonlySet<EditOp['type']> = new Set([
  'rename',
  'setMetadata',
  'addFeature',
  'updateFeature',
  'removeFeature',
]);

/** Ops whose effect on positions `mapPositionThrough` knows how to follow. */
const MAPPABLE_OPS: ReadonlySet<EditOp['type']> = new Set([
  'insert',
  'delete',
  'replace',
  'insertFragment',
]);

/**
 * Analysis results for `next`, derived from the results for `doc` without
 * recomputing. Annotation-only ops keep them exact. Sequence edits shift every
 * position through the op and drop sites and ORFs the edit touched; the
 * result is provisional and replaced when the worker answers. Whole-document
 * ops (reverse complement, set origin, set topology) are not followed.
 */
function carryAnalysis(
  analysis: AnalysisState | null,
  doc: SeqDocument,
  op: EditOp,
  next: SeqDocument,
): AnalysisState | null {
  if (analysis?.doc !== doc) return null;
  if (ANNOTATION_OPS.has(op.type)) return { ...analysis, doc: next };
  if (!MAPPABLE_OPS.has(op.type)) return null;
  const map = (p: number) => doc.mapPositionThrough(op, p);
  const cutSites: CutSite[] = [];
  for (const s of analysis.cutSites) {
    const cut = map(s.cut);
    const cutBottom = map(s.cutBottom);
    const siteStart = map(s.siteStart);
    // The edit landed between the site and the cut: the site moved as a whole or is gone.
    if (cut - siteStart !== s.cut - s.siteStart || cutBottom - cut !== s.cutBottom - s.cut)
      continue;
    if (siteStart < 0 || siteStart >= next.length || cut > next.length) continue;
    cutSites.push({ ...s, cut, cutBottom, siteStart });
  }
  const orfs: Orf[] = [];
  for (const o of analysis.orfs) {
    // Unrolled ranges past the end cannot be mapped reliably; let the worker redo them.
    if (o.range.end > doc.length) continue;
    const start = map(o.range.start);
    const end = map(o.range.end);
    if (end - start !== o.range.end - o.range.start || end > next.length) continue;
    orfs.push({ ...o, range: { start, end } });
  }
  return { doc: next, cutSites, orfs, provisional: true };
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
  /**
   * Set while `error` will dismiss itself: how long it is shown in full, how
   * long it then takes to fade, and a nonce that changes every time the clock
   * is restarted so a countdown indicator can start over.
   */
  readonly errorCountdown: {
    readonly durationMs: number;
    readonly fadeMs: number;
    readonly nonce: number;
  } | null;
  /** Set while Save waits for the user to agree that it may overwrite the file on disk. */
  readonly overwritePrompt: { readonly fileName: string } | null;
  readonly showComplement: boolean;
  /** Whether amino-acid translations are drawn under CDS features in the sequence view. */
  readonly showTranslations: boolean;
  readonly view: ViewMode;
  readonly sidebarTab: SidebarTab;
  readonly analysis: AnalysisState | null;
  /** Enzymes whose cut sites are drawn in the views. */
  readonly shownEnzymes: ReadonlySet<string>;
  /**
   * Whether cut sites are drawn at all. Off hides every site in the views and
   * in the SVG exports without touching `shownEnzymes`, so a carefully chosen
   * set survives decluttering the map; the Cloning digest and the Enzymes
   * tab's fragment list keep following the ticks.
   */
  readonly showCutSites: boolean;
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
  /**
   * Fragments collected for ligation, in order. Independent of the open
   * document so pieces can be gathered from several files in turn.
   */
  readonly assembly: readonly AssemblyPart[];
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
  errorCountdown: null,
  overwritePrompt: null,
  showComplement: true,
  showTranslations: true,
  view: 'both',
  sidebarTab: 'features',
  analysis: null,
  shownEnzymes: new Set(),
  showCutSites: true,
  orfMinCodons: 75,
  enzymesInitialized: false,
  reveal: null,
  renameRequest: null,
  editingFeatureId: null,
  findOpen: false,
  assembly: [],
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
  /** Pending auto-dismiss of a timed error, see `fail`. */
  private errorTimer: ReturnType<typeof setTimeout> | null = null;

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
    analytics.track('file', 'open', result.format);
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
      documentId: storage.id ?? newId(),
      fileHandle: storage.handle ?? null,
      overwritePrompt: null,
      // A document opened from a file starts clean; a pasted/example one has nowhere to be saved yet.
      savedDoc: fileName === null ? null : doc,
      warnings,
      error: null,
      errorCountdown: null,
      analysis: null,
      shownEnzymes: new Set(),
      enzymesInitialized: false,
      reveal: { position: 0, nonce: (this.state.reveal?.nonce ?? 0) + 1 },
    });
  }

  /**
   * Opens a new, empty document to type or paste into. It starts clean (no
   * unsaved-changes warning until something is typed) with a caret at the
   * start so the first keystroke lands.
   */
  newDocument(topology: 'linear' | 'circular' = 'linear'): void {
    const doc = SeqDocument.create({
      name: 'Untitled',
      sequence: '',
      topology,
      metadata: { moleculeType: 'DNA' },
    });
    analytics.track('file', 'new');
    this.openDocument(doc);
    this.set({ savedDoc: doc, selection: { start: 0, end: 0 } });
  }

  closeDocument(): void {
    this.set({
      history: null,
      selection: null,
      fileName: null,
      documentId: null,
      fileHandle: null,
      overwritePrompt: null,
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
    analytics.track('file', 'save');
    this.set(fileName === undefined ? { savedDoc: present } : { savedDoc: present, fileName });
  }

  /**
   * Shows an error. With `autoDismissMs` the message goes away by itself that
   * long after the most recent call (plus a fade), so a burst of rejected
   * keystrokes reads as one notice that stays put until the user has had a
   * chance to see it.
   */
  fail(message: string, options: { readonly autoDismissMs?: number } = {}): void {
    this.clearErrorTimer();
    const ms = options.autoDismissMs;
    if (ms === undefined) {
      this.set({ error: message, errorCountdown: null });
      return;
    }
    const nonce = (this.state.errorCountdown?.nonce ?? 0) + 1;
    this.set({ error: message, errorCountdown: { durationMs: ms, fadeMs: ERROR_FADE_MS, nonce } });
    this.errorTimer = setTimeout(() => {
      this.errorTimer = null;
      if (this.state.errorCountdown?.nonce === nonce)
        this.set({ error: null, errorCountdown: null });
    }, ms + ERROR_FADE_MS);
  }

  private clearErrorTimer(): void {
    if (this.errorTimer !== null) {
      clearTimeout(this.errorTimer);
      this.errorTimer = null;
    }
  }

  requestOverwrite(fileName: string): void {
    this.set({ overwritePrompt: { fileName } });
  }

  dismissOverwrite(): void {
    if (this.state.overwritePrompt !== null) this.set({ overwritePrompt: null });
  }

  dismissError(): void {
    this.clearErrorTimer();
    if (this.state.error !== null) this.set({ error: null, errorCountdown: null });
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
    this.set({
      history: history.push(next, describeEditOp(op)),
      selection,
      reveal,
      analysis: carryAnalysis(this.state.analysis, doc, op, next),
    });
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
    if (next === history) return;
    analytics.track('history', 'jump');
    this.set({ history: next, selection: null });
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
    this.set({
      analysis: { doc, cutSites, orfs, provisional: false },
      shownEnzymes,
      enzymesInitialized,
    });
  }

  setEnzymeShown(name: string, shown: boolean): void {
    if (this.state.shownEnzymes.has(name) === shown) return;
    if (shown) analytics.track('enzymes', 'show');
    const next = new Set(this.state.shownEnzymes);
    if (shown) next.add(name);
    else next.delete(name);
    this.set({ shownEnzymes: next });
  }

  setShownEnzymes(names: Iterable<string>): void {
    this.set({ shownEnzymes: new Set(names), enzymesInitialized: true });
  }

  setShowCutSites(show: boolean): void {
    if (show !== this.state.showCutSites) this.set({ showCutSites: show });
  }

  setOrfMinCodons(n: number): void {
    const value = Math.max(1, Math.floor(n));
    if (value !== this.state.orfMinCodons) this.set({ orfMinCodons: value, analysis: null });
  }

  /**
   * Cut sites drawn for the present document: those of the ticked enzymes,
   * or none while `showCutSites` is off.
   */
  visibleCutSites(): readonly CutSite[] {
    const a = this.state.analysis;
    if (a?.doc !== this.document || !this.state.showCutSites) return [];
    return a.cutSites.filter((s) => this.state.shownEnzymes.has(s.enzyme));
  }

  setView(view: ViewMode): void {
    if (view !== this.state.view) this.set({ view });
  }

  setShowComplement(show: boolean): void {
    if (show !== this.state.showComplement) this.set({ showComplement: show });
  }

  setShowTranslations(show: boolean): void {
    if (show !== this.state.showTranslations) this.set({ showTranslations: show });
  }

  // ------------------------------------------------------------- assembly

  /** Appends a fragment to the assembly and returns its part id. */
  addToAssembly(fragment: DigestFragment): string {
    const id = newId();
    this.set({ assembly: [...this.state.assembly, { id, fragment, flipped: false }] });
    return id;
  }

  removeFromAssembly(id: string): void {
    const next = this.state.assembly.filter((p) => p.id !== id);
    if (next.length !== this.state.assembly.length) this.set({ assembly: next });
  }

  /** Turns a part around (reverse complement); the caller supplies the flipped fragment. */
  flipAssemblyPart(id: string, flipped: DigestFragment): void {
    this.set({
      assembly: this.state.assembly.map((p) =>
        p.id === id ? { ...p, fragment: flipped, flipped: !p.flipped } : p,
      ),
    });
  }

  /** Moves a part up (-1) or down (+1) in the order of joining. */
  moveAssemblyPart(id: string, delta: -1 | 1): void {
    const parts = [...this.state.assembly];
    const i = parts.findIndex((p) => p.id === id);
    const j = i + delta;
    const a = parts[i];
    const b = parts[j];
    if (i < 0 || a === undefined || b === undefined) return;
    parts[i] = b;
    parts[j] = a;
    this.set({ assembly: parts });
  }

  clearAssembly(): void {
    if (this.state.assembly.length > 0) this.set({ assembly: [] });
  }
}

export const editorStore = new EditorStore();
