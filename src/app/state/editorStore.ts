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
import { type FontSize } from '@/view/linear';

import { type EditPlan, selectionAfterOp } from '../editing';

export type ViewMode = 'sequence' | 'map' | 'both';
/**
 * What the edit marks in the sequence view compare the document against:
 * nothing, the state it was opened in, the version last written to a file,
 * or a point the user chose with "Mark from here".
 */
export type EditsBaseline = 'off' | 'opened' | 'saved' | 'marked';
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

/**
 * Everything that belongs to one open document: its own tab. The store keeps
 * one of these per tab and shows the one in front flattened into
 * `EditorState`, so a view that reads `state.selection` gets the selection of
 * the document it is drawing.
 */
export interface DocumentState {
  /** Stable id of the document in local storage; also the tab's identity. */
  readonly documentId: string;
  /** Undo history whose present is the document. */
  readonly history: History<SeqDocument>;
  /** Current selection; an empty range is a caret. Null when nothing is selected. */
  readonly selection: Range | null;
  readonly fileName: string | null;
  /** Handle of the file the document came from or was saved to, when the browser gave us one. */
  readonly fileHandle: FileSystemFileHandle | null;
  /** The version last written to a file (or the version opened from one). */
  readonly savedDoc: SeqDocument | null;
  /** The document as it was opened, the baseline for `editsBaseline: 'opened'`. */
  readonly openedDoc: SeqDocument;
  /** The document when "Mark from here" was last used. */
  readonly markedDoc: SeqDocument | null;
  readonly warnings: readonly ParseWarning[];
  /** Set while Save waits for the user to agree that it may overwrite the file on disk. */
  readonly overwritePrompt: { readonly fileName: string } | null;
  readonly analysis: AnalysisState | null;
  /** Enzymes whose cut sites are drawn in the views. */
  readonly shownEnzymes: ReadonlySet<string>;
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

/** State of the app as a whole, the same whichever document is in front. */
export interface SharedState {
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
  readonly showComplement: boolean;
  /** Whether amino-acid translations are drawn under CDS features in the sequence view. */
  readonly showTranslations: boolean;
  /** Size of the sequence view's text; the rest of the row scales with it. */
  readonly seqFontSize: FontSize;
  /**
   * Bases in one row of the sequence view, or null to fit as many as the
   * window holds. A fixed count that does not fit scrolls sideways.
   */
  readonly seqBasesPerRow: number | null;
  /** Whether the row's position number is repeated beside the complement. */
  readonly numberComplement: boolean;
  /** Whether bases are tinted by what they are (A/C/G/T). */
  readonly colorBases: boolean;
  /** Which version the sequence view marks changes against; see `EditsBaseline`. */
  readonly editsBaseline: EditsBaseline;
  readonly view: ViewMode;
  readonly sidebarTab: SidebarTab;
  /**
   * Whether cut sites are drawn at all. Off hides every site in the views and
   * in the SVG exports without touching `shownEnzymes`, so a carefully chosen
   * set survives decluttering the map; the Cloning digest and the Enzymes
   * tab's fragment list keep following the ticks.
   */
  readonly showCutSites: boolean;
  /** Minimum ORF length in codons. */
  readonly orfMinCodons: number;
  /**
   * Fragments collected for ligation, in order. Independent of the open
   * documents so pieces can be gathered from several of them in turn.
   */
  readonly assembly: readonly AssemblyPart[];
}

/**
 * The fields of the document in front, or their empty values while the file
 * list is shown: a null history stands for "nothing open", as it always has.
 */
type ActiveDocumentFields = {
  readonly [K in keyof DocumentState]: K extends
    'warnings' | 'shownEnzymes' | 'enzymesInitialized' | 'findOpen'
    ? DocumentState[K]
    : DocumentState[K] | null;
};

export interface EditorState extends SharedState, ActiveDocumentFields {
  /** The open documents, in tab order. */
  readonly documents: readonly DocumentState[];
  /** Whether the document in front differs from what is on disk. */
  readonly dirty: boolean;
}

const SHARED_INITIAL: SharedState = {
  error: null,
  errorCountdown: null,
  showComplement: true,
  showTranslations: true,
  seqFontSize: 13,
  seqBasesPerRow: null,
  numberComplement: false,
  colorBases: false,
  editsBaseline: 'opened',
  view: 'both',
  sidebarTab: 'features',
  showCutSites: true,
  orfMinCodons: 75,
  assembly: [],
};

const NO_DOCUMENT: ActiveDocumentFields = {
  documentId: null,
  history: null,
  selection: null,
  fileName: null,
  fileHandle: null,
  savedDoc: null,
  openedDoc: null,
  markedDoc: null,
  warnings: [],
  overwritePrompt: null,
  analysis: null,
  shownEnzymes: new Set(),
  enzymesInitialized: false,
  reveal: null,
  renameRequest: null,
  editingFeatureId: null,
  findOpen: false,
};

/** Whether the document differs from the file it was read from or written to (or has none). */
export function isDirty(d: DocumentState): boolean {
  return d.savedDoc !== d.history.present;
}

/**
 * A document from "New" that nothing has happened to yet. Opening a file
 * takes its place rather than leaving an empty tab behind.
 */
export function isUntouchedNew(d: DocumentState): boolean {
  const doc = d.history.present;
  return (
    d.fileName === null &&
    !d.history.canUndo &&
    !d.history.canRedo &&
    doc.length === 0 &&
    doc.features.size === 0
  );
}

function compose(
  shared: SharedState,
  documents: readonly DocumentState[],
  activeId: string | null,
): EditorState {
  const active = documents.find((d) => d.documentId === activeId) ?? null;
  return {
    ...shared,
    ...(active ?? NO_DOCUMENT),
    documents,
    dirty: active !== null && isDirty(active),
  };
}

type Listener = () => void;

/**
 * Minimal external store for the editor: immutable state, plain methods for
 * every action, and `subscribe`/`getState` for React's useSyncExternalStore.
 * Documents are open in tabs; the methods act on the one in front unless
 * they take an id. Everything document-related goes through `apply(op)` so
 * undo, and later a CRDT layer, see one vocabulary of changes.
 */
export class EditorStore {
  private shared: SharedState = SHARED_INITIAL;
  private docs: readonly DocumentState[] = [];
  /** The tab in front, or null while the file list is shown. */
  private activeId: string | null = null;
  private state: EditorState = compose(this.shared, this.docs, this.activeId);
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

  /** The document in front, or null while the file list is shown. */
  get document(): SeqDocument | null {
    return this.state.history?.present ?? null;
  }

  /** The state of an open document by id, the one in front by default; null when not open. */
  documentState(id: string | null = this.activeId): DocumentState | null {
    return id === null ? null : (this.docs.find((d) => d.documentId === id) ?? null);
  }

  private commit(): void {
    this.state = compose(this.shared, this.docs, this.activeId);
    for (const l of this.listeners) l();
  }

  private setShared(patch: Partial<SharedState>): void {
    this.shared = { ...this.shared, ...patch };
    this.commit();
  }

  private setDocument(id: string, patch: Partial<Omit<DocumentState, 'documentId'>>): void {
    const i = this.docs.findIndex((d) => d.documentId === id);
    const current = this.docs[i];
    if (current === undefined) return;
    const docs = [...this.docs];
    docs[i] = { ...current, ...patch };
    this.docs = docs;
    this.commit();
  }

  /** Patches the document in front; nothing happens while the file list is shown. */
  private setActive(patch: Partial<Omit<DocumentState, 'documentId'>>): void {
    if (this.activeId !== null) this.setDocument(this.activeId, patch);
  }

  /** Opens the first document of a parse result in a new tab; returns its id. */
  openParsed(result: ParseResult, fileName: string | null): string | null {
    const doc = result.documents[0];
    if (doc === undefined) {
      this.setShared({ error: 'The file contains no sequences.' });
      this.setActive({ warnings: result.warnings });
      return null;
    }
    analytics.track('file', 'open', result.format);
    return this.openDocument(doc, fileName, result.warnings);
  }

  /**
   * Opens a document in a new tab and brings it to the front, returning its
   * id. A document already open — under `storage.id`, or the same file
   * opened again — is brought to the front instead. An untouched "New"
   * document in front gives up its tab to the opened one, so New followed
   * by Open does not leave an empty tab behind.
   */
  openDocument(
    doc: SeqDocument,
    fileName: string | null = null,
    warnings: readonly ParseWarning[] = [],
    storage: { id?: string; handle?: FileSystemFileHandle | null } = {},
  ): string {
    const open =
      storage.id === undefined ? this.findOpenCopy(doc, fileName) : this.documentState(storage.id);
    if (open !== null) {
      this.activateDocument(open.documentId);
      return open.documentId;
    }
    const entry: DocumentState = {
      documentId: storage.id ?? newId(),
      history: History.create(doc),
      selection: null,
      fileName,
      fileHandle: storage.handle ?? null,
      // A document opened from a file starts clean; a pasted/example one has nowhere to be saved yet.
      savedDoc: fileName === null ? null : doc,
      openedDoc: doc,
      markedDoc: null,
      warnings,
      overwritePrompt: null,
      analysis: null,
      shownEnzymes: new Set(),
      enzymesInitialized: false,
      reveal: { position: 0, nonce: 1 },
      renameRequest: null,
      editingFeatureId: null,
      findOpen: false,
    };
    const active = this.documentState();
    this.docs =
      active !== null && isUntouchedNew(active)
        ? this.docs.map((d) => (d === active ? entry : d))
        : [...this.docs, entry];
    this.activeId = entry.documentId;
    this.commit();
    return entry.documentId;
  }

  /**
   * The tab holding the same file as it was opened, if any: the same name,
   * and the document as read from the file the same in sequence, topology
   * and number of features. Edits since do not count; it is still that file.
   * A document without a file name (a paste, an example) never matches.
   */
  private findOpenCopy(doc: SeqDocument, fileName: string | null): DocumentState | null {
    if (fileName === null) return null;
    return (
      this.docs.find((d) => {
        const o = d.openedDoc;
        return (
          d.fileName === fileName &&
          o.name === doc.name &&
          o.topology === doc.topology &&
          o.length === doc.length &&
          o.features.size === doc.features.size &&
          o.sequence.toString() === doc.sequence.toString()
        );
      }) ?? null
    );
  }

  /**
   * Opens a new, empty document to type or paste into. It starts clean (no
   * unsaved-changes warning until something is typed) with a caret at the
   * start so the first keystroke lands.
   */
  newDocument(topology: 'linear' | 'circular' = 'linear'): string {
    const doc = SeqDocument.create({
      name: 'Untitled',
      sequence: '',
      topology,
      metadata: { moleculeType: 'DNA' },
    });
    analytics.track('file', 'new');
    const id = this.openDocument(doc);
    this.setDocument(id, { savedDoc: doc, selection: { start: 0, end: 0 } });
    return id;
  }

  /** Brings an open document to the front; null shows the file list with the tabs kept. */
  activateDocument(id: string | null): void {
    if (id === this.activeId || (id !== null && this.documentState(id) === null)) return;
    this.activeId = id;
    this.commit();
  }

  /** Shows the file list. The open documents stay in their tabs. */
  showFiles(): void {
    this.activateDocument(null);
  }

  /**
   * Closes a tab, the one in front by default. Closing the front tab brings
   * its right-hand neighbour forward, else the left-hand one, else the file
   * list. The document stays in local storage.
   */
  closeDocument(id: string | null = this.activeId): void {
    if (id === null) return;
    const i = this.docs.findIndex((d) => d.documentId === id);
    if (i < 0) return;
    const docs = this.docs.filter((d) => d.documentId !== id);
    if (this.activeId === id) this.activeId = (docs[i] ?? docs[i - 1])?.documentId ?? null;
    this.docs = docs;
    this.commit();
  }

  closeAllDocuments(): void {
    if (this.docs.length === 0 && this.activeId === null) return;
    this.docs = [];
    this.activeId = null;
    this.commit();
  }

  /**
   * Re-keys an open document in local storage (used to merge into an
   * identical stored entry). Nothing happens when the new id is already a
   * tab of its own.
   */
  setDocumentId(from: string, to: string): void {
    if (from === to || this.documentState(from) === null || this.documentState(to) !== null) return;
    this.docs = this.docs.map((d) => (d.documentId === from ? { ...d, documentId: to } : d));
    if (this.activeId === from) this.activeId = to;
    this.commit();
  }

  setFileHandle(id: string, handle: FileSystemFileHandle | null): void {
    this.setDocument(id, { fileHandle: handle });
  }

  /** Records that a document now matches its file (optionally under a new name). */
  markSaved(id: string, fileName?: string): void {
    const target = this.documentState(id);
    if (target === null) return;
    analytics.track('file', 'save');
    const present = target.history.present;
    this.setDocument(
      id,
      fileName === undefined ? { savedDoc: present } : { savedDoc: present, fileName },
    );
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
      this.setShared({ error: message, errorCountdown: null });
      return;
    }
    const nonce = (this.state.errorCountdown?.nonce ?? 0) + 1;
    this.setShared({
      error: message,
      errorCountdown: { durationMs: ms, fadeMs: ERROR_FADE_MS, nonce },
    });
    this.errorTimer = setTimeout(() => {
      this.errorTimer = null;
      if (this.state.errorCountdown?.nonce === nonce)
        this.setShared({ error: null, errorCountdown: null });
    }, ms + ERROR_FADE_MS);
  }

  private clearErrorTimer(): void {
    if (this.errorTimer !== null) {
      clearTimeout(this.errorTimer);
      this.errorTimer = null;
    }
  }

  requestOverwrite(id: string, fileName: string): void {
    this.setDocument(id, { overwritePrompt: { fileName } });
  }

  dismissOverwrite(): void {
    if (this.state.overwritePrompt !== null) this.setActive({ overwritePrompt: null });
  }

  dismissError(): void {
    this.clearErrorTimer();
    if (this.state.error !== null) this.setShared({ error: null, errorCountdown: null });
  }

  /**
   * Applies an op to a document, the one in front by default. The selection
   * follows the edit: a caret is mapped through inserts and deletes, and
   * document-wide ops (reverse complement, set origin) move it along;
   * `selectionAfter` overrides that when given.
   */
  apply(op: EditOp, selectionAfter?: Range | null, id: string | null = this.activeId): void {
    const target = this.documentState(id);
    if (target === null) return;
    const history = target.history;
    const doc = history.present;
    const next = doc.apply(op);
    if (next === doc) return;
    let selection: Range | null;
    if (selectionAfter !== undefined) {
      selection = selectionAfter;
    } else if (target.selection !== null && isEmptyRange(target.selection)) {
      const p = doc.mapPositionThrough(op, target.selection.start);
      selection = { start: p, end: p };
    } else {
      selection = selectionAfterOp(doc, target.selection, op);
    }
    if (selection !== null && selection.start === selection.end && selection.start > next.length) {
      selection = { start: next.length, end: next.length };
    }
    const reveal =
      selection !== null && (op.type === 'insert' || op.type === 'delete' || op.type === 'replace')
        ? { position: selection.start, nonce: (target.reveal?.nonce ?? 0) + 1 }
        : target.reveal;
    this.setDocument(target.documentId, {
      history: history.push(next, describeEditOp(op)),
      selection,
      reveal,
      analysis: carryAnalysis(target.analysis, doc, op, next),
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
    this.setActive({
      renameRequest: { id: feature.id, nonce: (this.state.renameRequest?.nonce ?? 0) + 1 },
    });
  }

  undo(): void {
    const history = this.state.history;
    if (history?.canUndo !== true) return;
    this.setActive({ history: history.undo(), selection: null });
  }

  redo(): void {
    const history = this.state.history;
    if (history?.canRedo !== true) return;
    this.setActive({ history: history.redo(), selection: null });
  }

  /** Undoes or redoes to the state with `position` changes applied (0 = as opened). */
  jumpHistory(position: number): void {
    const history = this.state.history;
    if (history === null) return;
    const next = history.jumpTo(position);
    if (next === history) return;
    analytics.track('history', 'jump');
    this.setActive({ history: next, selection: null });
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
    this.setActive({ selection });
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
    this.setActive({
      selection,
      reveal: { position: first.start, nonce: (this.state.reveal?.nonce ?? 0) + 1 },
    });
  }

  requestRename(id: string): void {
    this.setActive({ renameRequest: { id, nonce: (this.state.renameRequest?.nonce ?? 0) + 1 } });
  }

  editFeature(id: string | null): void {
    if (id !== this.state.editingFeatureId) {
      this.setActive({ editingFeatureId: id, renameRequest: null });
    }
  }

  setFindOpen(open: boolean): void {
    if (open !== this.state.findOpen) this.setActive({ findOpen: open });
  }

  finishRename(): void {
    if (this.state.renameRequest !== null) this.setActive({ renameRequest: null });
  }

  revealPosition(position: number): void {
    this.setActive({ reveal: { position, nonce: (this.state.reveal?.nonce ?? 0) + 1 } });
  }

  setSidebarTab(tab: SidebarTab): void {
    if (tab !== this.state.sidebarTab) this.setShared({ sidebarTab: tab });
  }

  /**
   * Stores analysis results for whichever open document they are for, in
   * front or not; results for a version no tab holds any more are dropped.
   * The first results for a newly opened document also pick the default
   * enzymes to display: those that cut exactly once.
   */
  setAnalysis(doc: SeqDocument, cutSites: readonly CutSite[], orfs: readonly Orf[]): void {
    const target = this.docs.find((d) => d.history.present === doc);
    if (target === undefined) return; // stale result
    let shownEnzymes = target.shownEnzymes;
    let enzymesInitialized = target.enzymesInitialized;
    if (!enzymesInitialized) {
      const counts = new Map<string, number>();
      for (const s of cutSites) counts.set(s.enzyme, (counts.get(s.enzyme) ?? 0) + 1);
      shownEnzymes = new Set(
        [...counts.entries()].filter(([, n]) => n === 1).map(([name]) => name),
      );
      enzymesInitialized = true;
    }
    this.setDocument(target.documentId, {
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
    this.setActive({ shownEnzymes: next });
  }

  setShownEnzymes(names: Iterable<string>): void {
    this.setActive({ shownEnzymes: new Set(names), enzymesInitialized: true });
  }

  setShowCutSites(show: boolean): void {
    if (show !== this.state.showCutSites) this.setShared({ showCutSites: show });
  }

  /** Sets the ORF threshold; every open document's ORFs are recomputed. */
  setOrfMinCodons(n: number): void {
    const value = Math.max(1, Math.floor(n));
    if (value === this.state.orfMinCodons) return;
    this.docs = this.docs.map((d) => (d.analysis === null ? d : { ...d, analysis: null }));
    this.setShared({ orfMinCodons: value });
  }

  /**
   * Cut sites drawn for the document in front: those of the ticked enzymes,
   * or none while `showCutSites` is off.
   */
  visibleCutSites(): readonly CutSite[] {
    const a = this.state.analysis;
    if (a?.doc !== this.document || !this.state.showCutSites) return [];
    return a.cutSites.filter((s) => this.state.shownEnzymes.has(s.enzyme));
  }

  setView(view: ViewMode): void {
    if (view !== this.state.view) this.setShared({ view });
  }

  setShowComplement(show: boolean): void {
    if (show !== this.state.showComplement) this.setShared({ showComplement: show });
  }

  setShowTranslations(show: boolean): void {
    if (show !== this.state.showTranslations) this.setShared({ showTranslations: show });
  }

  setSeqFontSize(size: FontSize): void {
    if (size !== this.state.seqFontSize) this.setShared({ seqFontSize: size });
  }

  /** Fixes the row width in bases, or passes null to go back to fitting the window. */
  setSeqBasesPerRow(bases: number | null): void {
    const value = bases === null ? null : Math.max(10, Math.round(bases));
    if (value !== this.state.seqBasesPerRow) this.setShared({ seqBasesPerRow: value });
  }

  setNumberComplement(show: boolean): void {
    if (show !== this.state.numberComplement) this.setShared({ numberComplement: show });
  }

  setColorBases(color: boolean): void {
    if (color !== this.state.colorBases) this.setShared({ colorBases: color });
  }

  setEditsBaseline(baseline: EditsBaseline): void {
    if (baseline === this.state.editsBaseline) return;
    analytics.track('edits', 'baseline', baseline);
    this.setShared({ editsBaseline: baseline });
  }

  /** Makes the present document the point the edit marks are measured from. */
  markEditsFromHere(): void {
    const present = this.document;
    if (present === null) return;
    analytics.track('edits', 'baseline', 'marked');
    this.setActive({ markedDoc: present });
    this.setShared({ editsBaseline: 'marked' });
  }

  editsBaselineDocument(): SeqDocument | null {
    return editsBaselineDocument(this.state);
  }

  // ------------------------------------------------------------- assembly

  /** Appends a fragment to the assembly and returns its part id. */
  addToAssembly(fragment: DigestFragment): string {
    const id = newId();
    this.setShared({ assembly: [...this.state.assembly, { id, fragment, flipped: false }] });
    return id;
  }

  removeFromAssembly(id: string): void {
    const next = this.state.assembly.filter((p) => p.id !== id);
    if (next.length !== this.state.assembly.length) this.setShared({ assembly: next });
  }

  /** Turns a part around (reverse complement); the caller supplies the flipped fragment. */
  flipAssemblyPart(id: string, flipped: DigestFragment): void {
    this.setShared({
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
    this.setShared({ assembly: parts });
  }

  clearAssembly(): void {
    if (this.state.assembly.length > 0) this.setShared({ assembly: [] });
  }
}

/**
 * The version the edit marks compare against, or null when they are off or
 * there is nothing to compare with — a document that was never saved has no
 * file to be measured against, and "Mark from here" falls back to the state
 * the document was opened in until it is used.
 */
export function editsBaselineDocument(state: EditorState): SeqDocument | null {
  if (state.history === null) return null;
  switch (state.editsBaseline) {
    case 'off':
      return null;
    case 'saved':
      return state.savedDoc;
    case 'marked':
      return state.markedDoc ?? state.openedDoc;
    case 'opened':
      return state.openedDoc;
  }
}

export const editorStore = new EditorStore();
