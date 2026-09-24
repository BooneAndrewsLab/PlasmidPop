import { analytics } from '../analytics';
import {
  type AgarosePercent,
  type AssemblyPart,
  type Coalesce,
  type CutSite,
  type DigestFragment,
  type EditOp,
  type FeatureId,
  type LadderChoice,
  type Orf,
  type PrimerCriteria,
  type Range,
  type RangeSegment,
  type TranslationTable,
  BUNDLED_ENZYME_SET,
  DEFAULT_PRIMER_CRITERIA,
  DEFAULT_TABLE,
  History,
  SeqDocument,
  activeEnzymes,
  createFeature,
  describeEditStep,
  documentChecksum,
  isEmptyRange,
  isoschizomerGroups,
  newId,
  rangeSegment,
} from '@/core';
import { type ParseResult, type ParseWarning } from '@/io';
import { type FontSize } from '@/view/linear';
import { type OverlaySpan } from '@/view/overlay';

import { type EditPlan, selectionAfterOp } from '../editing';
import { translationWarnings } from '../translationWarnings';
import { copyNameFor } from './derive';
import { type CloningReaction } from './cloningReaction';
import { type CutCountFilter } from './cutFilter';
import { type EnzymeSort } from './enzymeSort';
import { DEFAULT_LAYOUT, type LayoutSizes, clampLayout } from './layout';

export type ViewMode = 'sequence' | 'map' | 'both';
/**
 * What the edit marks in the sequence view compare the document against:
 * nothing, the state it was opened in, the version last written to a file,
 * or a point the user chose with "Mark from here".
 */
export type EditsBaseline = 'off' | 'opened' | 'saved' | 'marked';
export type SidebarTab =
  'features' | 'enzymes' | 'orfs' | 'translate' | 'primers' | 'align' | 'cloning' | 'history';

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

/**
 * How many single cutters a freshly opened document may tick by itself.
 *
 * Ticking the single cutters is the useful default, and with the bundled
 * table it stays one: pBR322, the largest thing the bundled 127 enzymes are
 * likely to meet, has 35 of them. An imported REBASE table has around ninety
 * on a 538 bp fragment, and ninety labels is a wall across the sequence view
 * and the map rather than a starting point. Past this many, nothing is ticked
 * and the Enzymes tab offers them in one click.
 */
export const MAX_DEFAULT_ENZYMES = 50;

/**
 * One name per isoschizomer group, the one the group lists first: ticking
 * BamHI and its eleven REBASE isoschizomers draws twelve labels on one cut.
 */
function firstOfEachGroup(names: readonly string[]): string[] {
  const wanted = new Set(names);
  const out: string[] = [];
  for (const group of isoschizomerGroups(activeEnzymes())) {
    const first = group.members.find((e) => wanted.has(e.name));
    if (first !== undefined) out.push(first.name);
  }
  return out;
}

/** Ops that leave the sequence and topology alone, so analysis results stay exact. */
const ANNOTATION_OPS: ReadonlySet<EditOp['type']> = new Set([
  'rename',
  'setMethylation',
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
 * The file a document was read from, and the document exactly as it was read.
 *
 * It is kept for the life of the tab so that the working copy an edit forks
 * off can still say what it came from and be compared against it. The
 * document is immutable and shares structure with every version edited out
 * of it, so holding on to it costs little.
 */
/** What `openDocument` needs to know about where a document is coming from. */
export interface OpenStorage {
  /** Id to reuse, when the document is one already in local storage. */
  readonly id?: string;
  /** Given explicitly — including as null — this is the origin, file name or not. */
  readonly origin?: DocumentOrigin | null;
  readonly derived?: boolean;
}

export interface DocumentOrigin {
  /** Name of the file as it was opened; the document's own `fileName` moves on. */
  readonly fileName: string;
  readonly doc: SeqDocument;
}

/**
 * A document stamped with the checksum of the molecule it was forked from.
 * Left alone when there is no checksum to take (an empty original), rather
 * than clearing whatever the file itself said about where *it* came from.
 */
function withProvenance(doc: SeqDocument, origin: DocumentOrigin): SeqDocument {
  const checksum = documentChecksum(origin.doc);
  if (checksum === null) return doc;
  return doc.setMetadata({
    derivedFrom: { checksum: checksum.text, fileName: origin.fileName },
  });
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
  /**
   * The feature that selection came from, when it came from one. A selection
   * is a range, and two features can cover the same range — a gene and the
   * CDS inside it — so the range alone does not say which was clicked.
   */
  readonly selectedFeatureId: FeatureId | null;
  /** The file it was read from, or the name it was last written out under. */
  readonly fileName: string | null;
  /** The version last written out as a file (or the version opened from one). */
  readonly savedDoc: SeqDocument | null;
  /** The document as it was opened, the baseline for `editsBaseline: 'opened'`. */
  readonly openedDoc: SeqDocument;
  /** The document when "Mark from here" was last used. */
  readonly markedDoc: SeqDocument | null;
  /** The file this document was read from, if it was read from one at all. */
  readonly origin: DocumentOrigin | null;
  /**
   * Whether this document has been forked off its origin: it has been edited,
   * carries a name of its own and has no handle to write back through, so the
   * file it came from cannot be overwritten from this tab.
   */
  readonly derived: boolean;
  readonly warnings: readonly ParseWarning[];
  /**
   * Set while a download is showing what this working copy changed about the
   * file it came from, before it is written out. Carries that file's name.
   */
  readonly saveReview: { readonly fileName: string } | null;
  readonly analysis: AnalysisState | null;
  /** Enzymes whose cut sites are drawn in the views. */
  readonly shownEnzymes: ReadonlySet<string>;
  /**
   * Whether the default shown-enzyme set was applied for this document: the
   * single cutters, or nothing at all when there are more of them than
   * `MAX_DEFAULT_ENZYMES`.
   */
  readonly enzymesInitialized: boolean;
  /** Bumped when the view should scroll to `revealPosition`. */
  readonly reveal: { readonly position: number; readonly nonce: number } | null;
  /** Set when the feature panel should open an inline rename for a feature. */
  readonly renameRequest: { readonly id: string; readonly nonce: number } | null;
  /** Feature currently open in the full editor. */
  readonly editingFeatureId: string | null;
  readonly findOpen: boolean;
  /**
   * Which sidebar panel this tab is on. Per document rather than shared,
   * because a tab is a piece of work: opening a fragment from the Cloning
   * tab used to leave the document it was cut from on Features, having
   * moved the whole app there for the new tab's sake.
   */
  readonly sidebarTab: SidebarTab;
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

  /**
   * Whether the sidebar is on screen at all. Hiding it gives the views the
   * whole window, which is what a map on a laptop screen wants; the tab it
   * was on is kept, so showing it again comes back to the same panel.
   */
  readonly sidebarOpen: boolean;
  /**
   * Whether cut sites are drawn at all. Off hides every site in the views and
   * in the SVG exports without touching `shownEnzymes`, so a carefully chosen
   * set survives decluttering the map; the Cloning digest and the Enzymes
   * tab's fragment list keep following the ticks.
   */
  readonly showCutSites: boolean;
  /**
   * How often an enzyme may cut to be listed in the Enzymes tab, and whose
   * catalogue it must be in. Both describe what the user is looking for
   * rather than the document in front of them — a lab that buys from one
   * supplier buys from it for every plasmid — so they are kept with the view
   * preferences and survive a reload. The tab's search box is not: it is a
   * question about the list in front of you, and coming back to a filtered
   * list with a forgotten word in the box would be a puzzle.
   */
  readonly enzymeCutFilter: CutCountFilter;
  /** Supplier code, or '' for any; only an imported REBASE table has them. */
  readonly enzymeSupplier: string;
  /**
   * Whether the list reads as a catalogue or as an answer to "which enzyme
   * gives bands I can tell apart". Kept with the filters above for the same
   * reason: it is how this user reads the tab, not a fact about the file.
   */
  readonly enzymeSort: EnzymeSort;
  /**
   * Whether enzymes with the same site and cut share one row of the Enzymes
   * tab, and one tick when a document opens (item 39). A REBASE table lists
   * a dozen names for BamHI's specificity; they are one choice at the bench.
   */
  readonly enzymeGroupIsoschizomers: boolean;
  /** The list order read backwards: Z–A, or the worst-separated lanes first. */
  readonly enzymeSortReversed: boolean;
  /**
   * The gel every drawn lane is calculated for, and the ladder beside it
   * (item 41). A lab runs the same gel week in, week out, so these are
   * remembered like the list options rather than asked per digest.
   */
  readonly gelAgarose: AgarosePercent;
  readonly gelLadder: LadderChoice;
  /**
   * Which of the three reactions the Cloning tab shows. Remembered for the
   * same reason the enzyme filters are: a lab that does Gibson does Gibson
   * every week, and coming back to the tab on someone else's reaction is a
   * small tax paid over and over.
   */
  readonly cloningReaction: CloningReaction;
  /** Minimum ORF length in codons. */
  readonly orfMinCodons: number;
  /**
   * The genetic code the Translate tab reads with and open reading frames are
   * found under. It is the app's, not a document's: a CDS carries its own
   * `/transl_table` and is read with that, while a six-frame translation and
   * an ORF scan have no feature to ask. A lab working on mitochondria works
   * on them all day, so it is remembered with the view preferences.
   */
  readonly geneticCode: TranslationTable;
  /**
   * What the Primers tab designs to and checks against: lengths, Tm and GC
   * ranges, where to look, and the hairpin and dimer limits. A lab has its
   * own habits here and keeps them from plasmid to plasmid, so they are kept
   * with the view preferences.
   */
  readonly primerCriteria: PrimerCriteria;
  /**
   * The fragment shelf: pieces collected for any of the Cloning tab's
   * reactions, in order. Independent of the open documents so pieces can be
   * gathered from several of them in turn (item 3).
   */
  readonly shelf: readonly AssemblyPart[];
  /**
   * What the Enzymes tab says it is scanning with. The enzymes themselves
   * live in `@/core`'s active set (and a copy of them in the worker); this is
   * only what the UI needs to describe it and to re-render on a change.
   */
  readonly enzymeSetInfo: EnzymeSetInfo;
  /**
   * The file name a save was last downloaded under, in a browser that cannot
   * write to files. Set because a download is not a save the app can repeat:
   * the browser owns the file from there on and numbers the next one, which
   * the user should hear once rather than discover as a pile of files.
   */
  readonly downloadNotice: { readonly fileName: string } | null;
  /**
   * That a share link was just copied, and how long it is. A link carries
   * the whole document, so the one thing the user has to be told is what
   * they are about to paste somewhere.
   */
  readonly shareNotice: { readonly chars: number } | null;
  /**
   * That a document's read (the qualities and trace of the AB1 or FASTQ it
   * was opened from) was just left behind: by an edit that changed the
   * bases, or by a download in a format that cannot hold it (#49). The
   * nonce restarts the notice when it happens again.
   */
  readonly readNotice: { readonly kind: 'edited' | 'downloaded'; readonly nonce: number } | null;
  /**
   * That the browser would ask the user before keeping this origin's
   * storage, and has not been asked yet. The banner explains what the
   * question means and puts it from a click, so the browser's own dialog
   * follows something the user did rather than appearing out of nowhere.
   */
  readonly storageNotice: boolean;
  /** What a panel is pointing at in the views; see `DocumentPreview`. */
  readonly preview: DocumentPreview | null;
  /** Bumped when a clickable previewed span is clicked in either view. */
  readonly previewActivated: PreviewActivation | null;
  /**
   * A file the document in front is being compared with: what it was called
   * and the document read out of it. Nothing is opened and nothing is
   * stored — the file is read, diffed and dropped — so this is the one place
   * a document PlasmidPop is not editing lives. Shared rather than per-tab
   * because the comparison is a modal dialog: only one can be up.
   */
  readonly comparison: { readonly fileName: string; readonly doc: SeqDocument } | null;
  /** Where the draggable boundaries sit; see `LayoutSizes`. */
  readonly layout: LayoutSizes;
}

/**
 * Spans a panel is pointing at — a primer pair being weighed up, every match
 * of a find — drawn in both views and in neither document. It is shared
 * rather than per-tab because only one panel points at a time, and it
 * carries the document it was computed against so a stale preview cannot be
 * drawn over another tab's sequence.
 */
export interface DocumentPreview {
  /**
   * Which panel put it there. Only that panel may take it away again, so
   * two panels that can be open at once — the find bar and a sidebar tab —
   * do not clear each other's spans when one of them closes.
   */
  readonly owner: PreviewOwner;
  readonly documentId: string;
  readonly items: readonly OverlaySpan[];
}

export type PreviewOwner = 'primers' | 'find' | 'cloning' | 'pcr';

/**
 * A click on a previewed span, for the panel that put it there to act on.
 * Only spans marked `clickable` raise one, so a preview that has nothing to
 * do with a click (a find match, a primer site) keeps the views' own
 * behaviour where it is drawn.
 */
export interface PreviewActivation {
  readonly owner: PreviewOwner;
  readonly id: string;
  readonly nonce: number;
}

/** A one-line description of the active enzyme set, for the Enzymes tab. */
export interface EnzymeSetInfo {
  readonly label: string;
  readonly count: number;
  /** Whether it is the bundled table rather than something imported. */
  readonly bundled: boolean;
  /** The file an imported set was read from. */
  readonly fileName: string | null;
  /** Supplier letter to company name; empty for the bundled table. */
  readonly suppliers: readonly { readonly code: string; readonly name: string }[];
}

/**
 * The fields of the document in front, or their empty values while the file
 * list is shown: a null history stands for "nothing open", as it always has.
 */
type ActiveDocumentFields = {
  readonly [K in keyof DocumentState]: K extends
    | 'warnings'
    | 'shownEnzymes'
    | 'enzymesInitialized'
    | 'findOpen'
    | 'derived'
    // The sidebar is shown beside the file list too, so its tab always has a
    // value; `NO_DOCUMENT` carries the one a new tab would start on.
    | 'sidebarTab'
    ? DocumentState[K]
    : DocumentState[K] | null;
};

/**
 * What the tab strip has in front: a document, the file list, or the Cloning
 * Bench (item 49), which works across documents and so is none of them.
 */
export type FrontTab = 'document' | 'files' | 'bench';

export interface EditorState extends SharedState, ActiveDocumentFields {
  /** What is in front; the document fields are empty unless it is a document. */
  readonly front: FrontTab;
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
  sidebarOpen: true,
  showCutSites: true,
  enzymeCutFilter: 'any',
  enzymeSupplier: '',
  enzymeSort: 'name',
  enzymeGroupIsoschizomers: true,
  enzymeSortReversed: false,
  gelAgarose: 1,
  gelLadder: 'auto',
  cloningReaction: 'ligation',
  orfMinCodons: 75,
  geneticCode: DEFAULT_TABLE,
  primerCriteria: DEFAULT_PRIMER_CRITERIA,
  shelf: [],
  downloadNotice: null,
  shareNotice: null,
  readNotice: null,
  storageNotice: false,
  preview: null,
  previewActivated: null,
  comparison: null,
  layout: DEFAULT_LAYOUT,
  enzymeSetInfo: {
    label: BUNDLED_ENZYME_SET.label,
    count: BUNDLED_ENZYME_SET.enzymes.length,
    bundled: true,
    fileName: null,
    suppliers: [],
  },
};

const NO_DOCUMENT: ActiveDocumentFields = {
  documentId: null,
  history: null,
  selection: null,
  fileName: null,
  savedDoc: null,
  openedDoc: null,
  markedDoc: null,
  origin: null,
  derived: false,
  warnings: [],
  saveReview: null,
  analysis: null,
  shownEnzymes: new Set(),
  enzymesInitialized: false,
  selectedFeatureId: null,
  reveal: null,
  renameRequest: null,
  editingFeatureId: null,
  findOpen: false,
  sidebarTab: 'features',
};

/**
 * Whether the document has changed since the last file was made of it — the
 * one it was read from, or the last download. True for a document no file
 * holds, which a working copy is until it is downloaded.
 */
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

/** Whether two previews would draw the same thing, so one can replace the other silently. */
function samePreview(a: readonly OverlaySpan[], b: readonly OverlaySpan[]): boolean {
  return (
    a.length === b.length &&
    a.every((x, i) => {
      const y = b[i];
      return (
        x.id === y?.id &&
        x.label === y.label &&
        x.shape === y.shape &&
        x.strand === y.strand &&
        x.range.start === y.range.start &&
        x.range.end === y.range.end
      );
    })
  );
}

function compose(
  shared: SharedState,
  documents: readonly DocumentState[],
  activeId: string | null,
  bench: boolean,
): EditorState {
  const active = documents.find((d) => d.documentId === activeId) ?? null;
  return {
    ...shared,
    ...(active ?? NO_DOCUMENT),
    front: active !== null ? 'document' : bench ? 'bench' : 'files',
    // A preview belongs to the tab it was computed for; behind another one
    // it is simply not there, and it comes back on the way back.
    preview: shared.preview?.documentId === activeId ? shared.preview : null,
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
  /** The document in front, or null while the file list or the Bench is shown. */
  private activeId: string | null = null;
  /** Whether the Bench is in front; only while `activeId` is null. */
  private bench = false;
  private state: EditorState = compose(this.shared, this.docs, this.activeId, this.bench);
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
    this.state = compose(this.shared, this.docs, this.activeId, this.bench);
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
  openParsed(
    result: ParseResult,
    fileName: string | null,
    storage: OpenStorage = {},
  ): string | null {
    const doc = result.documents[0];
    if (doc === undefined) {
      this.setShared({ error: 'The file contains no sequences.' });
      this.setActive({ warnings: result.warnings });
      return null;
    }
    analytics.track('file', 'open', result.format);
    // A tab holds one molecule. The rest of a many-record file (a FASTQ of
    // reads, say) is not opened, but it is not dropped without a word.
    const more = result.documents.length - 1;
    const rest: ParseWarning[] =
      more === 0
        ? []
        : [
            {
              message: `Only the first of ${result.documents.length.toLocaleString()} records was opened. To use another, drop the file on the Align tab's box and pick it there.`,
            },
          ];
    // The file's own /translation qualifiers are checked here rather than in
    // the parser: it is a question about the sequence and the features
    // together, and it is asked of whatever format they were read from.
    return this.openDocument(
      doc,
      fileName,
      [...result.warnings, ...rest, ...translationWarnings(doc)],
      storage,
    );
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
    storage: OpenStorage = {},
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
      selectedFeatureId: null,
      fileName,
      // A document opened from a file starts clean; a pasted/example one has nowhere to be saved yet.
      savedDoc: fileName === null ? null : doc,
      openedDoc: doc,
      markedDoc: null,
      // Only a document read from a file has one to protect; a paste, an
      // example or a "New" document is the user's own from the start. An
      // explicit `origin` wins either way: a working copy restored from
      // storage brings its own back (since `doc` is then the copy rather than
      // what the file holds), and the bundled example passes null because its
      // file name names nothing on the user's disk.
      origin:
        storage.origin !== undefined
          ? storage.origin
          : fileName === null
            ? null
            : { fileName, doc },
      derived: storage.derived ?? false,
      warnings,
      saveReview: null,
      analysis: null,
      shownEnzymes: new Set(),
      enzymesInitialized: false,
      reveal: { position: 0, nonce: 1 },
      renameRequest: null,
      editingFeatureId: null,
      findOpen: false,
      // A new tab opens on the panel the last one was on: opening the insert
      // while setting up a digest should not send you back to Features.
      sidebarTab: this.documentState()?.sidebarTab ?? 'features',
    };
    const active = this.documentState();
    this.docs =
      active !== null && isUntouchedNew(active)
        ? this.docs.map((d) => (d === active ? entry : d))
        : [...this.docs, entry];
    this.activeId = entry.documentId;
    this.bench = false;
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
          // A working copy is no longer that file: opening it again should
          // give the user the original back, not the tab they edited.
          !d.derived &&
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
    if (id === this.activeId && !this.bench) return;
    if (id !== null && this.documentState(id) === null) return;
    this.activeId = id;
    this.bench = false;
    // A comparison is against the document it was asked for, so it goes when
    // that document does. (The dialog is modal, so this is the path where a
    // tab is closed or opened from outside it.)
    this.shared = { ...this.shared, comparison: null };
    this.commit();
  }

  /** Shows the file list. The open documents stay in their tabs. */
  showFiles(): void {
    this.activateDocument(null);
  }

  /** Shows the Cloning Bench. The open documents stay in their tabs. */
  showBench(): void {
    if (this.bench) return;
    this.activeId = null;
    this.bench = true;
    this.shared = { ...this.shared, comparison: null };
    this.commit();
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
    this.shared = { ...this.shared, comparison: null };
    this.commit();
  }

  closeAllDocuments(): void {
    if (this.docs.length === 0 && this.activeId === null) return;
    this.docs = [];
    this.activeId = null;
    this.shared = { ...this.shared, comparison: null };
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

  /**
   * Records that a document has been written out under `fileName`: it is
   * what was last downloaded, so nothing is outstanding until the next edit.
   */
  markDownloaded(id: string, fileName: string): void {
    const target = this.documentState(id);
    if (target === null) return;
    analytics.track('file', 'download');
    const present = target.history.present;
    // Sealing keeps the version on disk reachable as a step of its own: a
    // keystroke right after a save must not be folded into the step that
    // produced what was written.
    const history = target.history.seal();
    this.setDocument(id, { savedDoc: present, fileName, history });
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

  /** Records that a save went out as a download, for the notice under the toolbar. */
  noteDownload(fileName: string): void {
    this.setShared({ downloadNotice: { fileName } });
  }

  dismissDownloadNotice(): void {
    if (this.state.downloadNotice !== null) this.setShared({ downloadNotice: null });
  }

  /** Records that a share link went to the clipboard, for the notice under the toolbar. */
  noteShareCopied(chars: number): void {
    this.setShared({ shareNotice: { chars } });
  }

  dismissShareNotice(): void {
    if (this.state.shareNotice !== null) this.setShared({ shareNotice: null });
  }

  /** Records that a read was left behind, for the notice under the toolbar. */
  noteReadLeftBehind(kind: 'edited' | 'downloaded'): void {
    this.setShared({ readNotice: { kind, nonce: (this.state.readNotice?.nonce ?? 0) + 1 } });
  }

  dismissReadNotice(): void {
    if (this.state.readNotice !== null) this.setShared({ readNotice: null });
  }

  /** Records that keeping the browser's storage is a question for the user, for the banner. */
  noteStoragePrompt(): void {
    if (!this.state.storageNotice) this.setShared({ storageNotice: true });
  }

  dismissStorageNotice(): void {
    if (this.state.storageNotice) this.setShared({ storageNotice: false });
  }

  /** Puts up the review of what this working copy changed, before a download writes it. */
  requestSaveReview(id: string, fileName: string): void {
    this.setDocument(id, { saveReview: { fileName } });
  }

  dismissSaveReview(): void {
    if (this.state.saveReview !== null) this.setActive({ saveReview: null });
  }

  dismissError(): void {
    this.clearErrorTimer();
    if (this.state.error !== null) this.setShared({ error: null, errorCountdown: null });
  }

  /**
   * Applies an op to a document, the one in front by default. The selection
   * follows the edit: a caret is mapped through inserts and deletes, and
   * document-wide ops (reverse complement, set origin) move it along;
   * `selectionAfter` overrides that when given. `coalesce` lets a change
   * that carries on from the one before it share its undo step, which is how
   * a run of typing stays one step; see `applyPlan`.
   */
  apply(
    op: EditOp,
    selectionAfter?: Range | null,
    id: string | null = this.activeId,
    coalesce?: Coalesce,
  ): void {
    const target = this.documentState(id);
    if (target === null) return;
    const doc = target.history.present;
    const edited = doc.apply(op);
    if (edited === doc) return;
    analytics.trackOnce('edit', op.type);
    // Whatever a panel was pointing at was computed against the document as
    // it stands; an edit moves the ground under it.
    this.clearPreview();
    // The file a document was opened from is never written to, so the first
    // edit forks the document into a working copy: it takes a name of its
    // own — the user's, when the edit is their rename — and starts a history
    // of its own from the file's contents under that name. Undo therefore
    // goes back to what the file holds and no further: there is no state in
    // which the copy is the original again, which is what let the name slip
    // back to the original's before. `derived` latches for the life of the
    // tab, and a copy is never written out under the original's name.
    const forkOrigin = target.derived ? null : target.origin;
    const forking = forkOrigin !== null;
    const copyName =
      op.type === 'rename'
        ? op.name
        : copyNameFor(
            doc.name,
            this.docs.map((d) => d.history.present.name),
          );
    // The copy records the molecule it came from as well as being renamed:
    // inside this browser `origin` says where it came from, but the file the
    // copy leaves as carries nothing at all without this (`derivedComment.ts`).
    const base = forkOrigin === null ? doc : withProvenance(doc.rename(copyName), forkOrigin);
    const next = forking ? base.apply(op) : edited;
    const history = forking ? History.create(base) : target.history;
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
      // A rename that forks is the whole of the fork: the copy is called
      // what the user called it, and there is no step to record on top.
      history:
        next === base
          ? history
          : history.push(next, describeEditStep(op, doc, next), Date.now(), coalesce),
      selection,
      reveal,
      analysis: carryAnalysis(target.analysis, doc, op, next),
      // The copy has never been written anywhere, whatever the file it came
      // from holds, so nothing about it is on disk yet.
      ...(forking ? { derived: true, savedDoc: null } : {}),
    });
    // The read described the bases this edit changed; undo brings it back.
    if (doc.read !== null && next.read === null) this.noteReadLeftBehind('edited');
  }

  applyPlan(plan: EditPlan | null): void {
    if (plan !== null) this.apply(plan.op, plan.selectionAfter, this.activeId, plan.coalesce);
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

  // Undo, redo and a jump all seal the step they land on, so the next edit
  // starts a step of its own rather than joining a run the user has just
  // stepped out of.
  undo(): void {
    const history = this.state.history;
    if (history?.canUndo !== true) return;
    analytics.trackOnce('edit', 'undo');
    this.setActive({ history: history.undo().seal(), selection: null });
  }

  redo(): void {
    const history = this.state.history;
    if (history?.canRedo !== true) return;
    analytics.trackOnce('edit', 'redo');
    this.setActive({ history: history.redo().seal(), selection: null });
  }

  /** Undoes or redoes to the state with `position` changes applied (0 = as opened). */
  jumpHistory(position: number): void {
    const history = this.state.history;
    if (history === null) return;
    const next = history.jumpTo(position);
    if (next === history) return;
    analytics.track('history', 'jump');
    this.setActive({ history: next.seal(), selection: null });
  }

  setSelection(selection: Range | null): void {
    const current = this.state.selection;
    const same =
      (selection === null && current === null) ||
      (selection !== null &&
        current !== null &&
        selection.start === current.start &&
        selection.end === current.end);
    // Selecting the same bases by hand is still a change when the store was
    // holding the feature they came from: it is a range now, not a feature.
    if (same && this.state.selectedFeatureId === null) return;
    // Whatever made this selection, it was not a click on a feature.
    this.setActive({ selection, selectedFeatureId: null });
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
      selectedFeatureId: featureId,
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
    if (open === this.state.findOpen) return;
    if (open) analytics.trackOnce('find', 'open');
    this.setActive({ findOpen: open });
  }

  finishRename(): void {
    if (this.state.renameRequest !== null) this.setActive({ renameRequest: null });
  }

  revealPosition(position: number): void {
    this.setActive({ reveal: { position, nonce: (this.state.reveal?.nonce ?? 0) + 1 } });
  }

  setSidebarTab(tab: SidebarTab): void {
    if (tab !== this.state.sidebarTab) this.setActive({ sidebarTab: tab });
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
      let singles = [...counts.entries()].filter(([, n]) => n === 1).map(([name]) => name);
      if (this.state.enzymeGroupIsoschizomers) singles = firstOfEachGroup(singles);
      shownEnzymes = new Set(singles.length > MAX_DEFAULT_ENZYMES ? [] : singles);
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

  setEnzymeCutFilter(filter: CutCountFilter): void {
    if (filter !== this.state.enzymeCutFilter) this.setShared({ enzymeCutFilter: filter });
  }

  setEnzymeSupplier(code: string): void {
    if (code !== this.state.enzymeSupplier) this.setShared({ enzymeSupplier: code });
  }

  setEnzymeSort(sort: EnzymeSort): void {
    if (sort !== this.state.enzymeSort) this.setShared({ enzymeSort: sort });
  }

  setEnzymeSortReversed(reversed: boolean): void {
    if (reversed !== this.state.enzymeSortReversed) {
      this.setShared({ enzymeSortReversed: reversed });
    }
  }

  setGelAgarose(percent: AgarosePercent): void {
    if (percent !== this.state.gelAgarose) this.setShared({ gelAgarose: percent });
  }

  setGelLadder(ladder: LadderChoice): void {
    if (ladder !== this.state.gelLadder) this.setShared({ gelLadder: ladder });
  }

  setEnzymeGroupIsoschizomers(group: boolean): void {
    if (group !== this.state.enzymeGroupIsoschizomers) {
      this.setShared({ enzymeGroupIsoschizomers: group });
    }
  }

  setCloningReaction(reaction: CloningReaction): void {
    if (reaction !== this.state.cloningReaction) this.setShared({ cloningReaction: reaction });
  }

  /** Puts every draggable boundary back where it started, sidebar included. */
  resetLayout(): void {
    this.setShared({ layout: DEFAULT_LAYOUT, sidebarOpen: true });
  }

  setSidebarOpen(open: boolean): void {
    if (open !== this.state.sidebarOpen) this.setShared({ sidebarOpen: open });
  }

  setShowCutSites(show: boolean): void {
    if (show !== this.state.showCutSites) this.setShared({ showCutSites: show });
  }

  /**
   * Moves one of the draggable boundaries. The floors a drag is held to are
   * in px and belong to the splitter that knows the container's size; what
   * is clamped here is only what could otherwise come back out of storage.
   */
  setLayout(patch: Partial<LayoutSizes>): void {
    const next = { ...this.state.layout, ...clampLayout(patch) };
    const current = this.state.layout;
    if (
      next.viewsSplit === current.viewsSplit &&
      next.viewsSplitStacked === current.viewsSplitStacked &&
      next.sidebarWidth === current.sidebarWidth
    ) {
      return;
    }
    this.setShared({ layout: next });
  }

  /**
   * Records which enzyme set is in use and drops every document's cached
   * analysis, since the cut sites were found with the old one.
   */
  /**
   * Points the views at a set of spans without touching the document: the
   * preview channel of the Primers and Find panels. Passing nothing clears
   * it, as does any edit — the positions would move under it.
   */
  setPreview(
    owner: PreviewOwner,
    items: readonly OverlaySpan[],
    id: string | null = this.activeId,
  ): void {
    if (id === null || items.length === 0) {
      this.clearPreview(owner);
      return;
    }
    const current = this.shared.preview;
    if (current?.documentId === id && current.owner === owner && samePreview(current.items, items))
      return;
    this.setShared({ preview: { owner, documentId: id, items } });
  }

  /** Shows what the document in front differs from in a file just read. */
  showComparison(fileName: string, doc: SeqDocument): void {
    this.setShared({ comparison: { fileName, doc } });
  }

  dismissComparison(): void {
    if (this.shared.comparison === null) return;
    this.setShared({ comparison: null });
  }

  /**
   * Reports a click on a previewed span to whichever panel drew it. The
   * panel watches the nonce, as the views watch `reveal`; nothing here knows
   * what a span means.
   */
  activatePreview(id: string): void {
    const preview = this.state.preview;
    if (preview === null) return;
    this.setShared({
      previewActivated: {
        owner: preview.owner,
        id,
        nonce: (this.shared.previewActivated?.nonce ?? 0) + 1,
      },
    });
  }

  /** Takes the preview away; with an owner, only if that panel put it there. */
  clearPreview(owner?: PreviewOwner): void {
    const current = this.shared.preview;
    if (current === null) return;
    if (owner !== undefined && current.owner !== owner) return;
    this.setShared({ preview: null });
  }

  setEnzymeSetInfo(info: EnzymeSetInfo): void {
    this.docs = this.docs.map((d) => (d.analysis === null ? d : { ...d, analysis: null }));
    this.setShared({ enzymeSetInfo: info });
  }

  /** Sets the ORF threshold; every open document's ORFs are recomputed. */
  setOrfMinCodons(n: number): void {
    const value = Math.max(1, Math.floor(n));
    if (value === this.state.orfMinCodons) return;
    this.docs = this.docs.map((d) => (d.analysis === null ? d : { ...d, analysis: null }));
    this.setShared({ orfMinCodons: value });
  }

  /**
   * Sets the genetic code for six-frame translation and ORFs; every open
   * document's ORFs are recomputed, because which codons stop a reading
   * differs by code.
   */
  setGeneticCode(table: TranslationTable): void {
    if (table === this.state.geneticCode) return;
    this.docs = this.docs.map((d) => (d.analysis === null ? d : { ...d, analysis: null }));
    this.setShared({ geneticCode: table });
  }

  setPrimerCriteria(criteria: PrimerCriteria): void {
    if (criteria !== this.state.primerCriteria) this.setShared({ primerCriteria: criteria });
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
    this.setShared({ editsBaseline: baseline });
  }

  /** Makes the present document the point the edit marks are measured from. */
  markEditsFromHere(): void {
    const target = this.documentState();
    if (target === null) return;
    analytics.track('edits', 'baseline', 'marked');
    // The marked state is a landmark too; the next edit starts a fresh step.
    this.setActive({ markedDoc: target.history.present, history: target.history.seal() });
    this.setShared({ editsBaseline: 'marked' });
  }

  editsBaselineDocument(): SeqDocument | null {
    return editsBaselineDocument(this.state);
  }

  // ---------------------------------------------------------------- shelf

  /**
   * Puts back the shelf the last session left behind. It gives way to
   * whatever is already there: if the user has started collecting fragments
   * while storage was being read, those are the ones they mean.
   */
  restoreShelf(parts: readonly AssemblyPart[]): void {
    if (parts.length === 0 || this.state.shelf.length > 0) return;
    this.setShared({ shelf: parts });
  }

  /** Appends a fragment to the shelf and returns its part id. */
  addToShelf(fragment: DigestFragment): string {
    const id = newId();
    this.setShared({
      // The shelf is drawn above every reaction's panel, so the fragment is
      // seen landing whichever reaction is picked; the picker stays put.
      shelf: [...this.state.shelf, { id, fragment, flipped: false }],
    });
    return id;
  }

  removeFromShelf(id: string): void {
    const next = this.state.shelf.filter((p) => p.id !== id);
    if (next.length !== this.state.shelf.length) this.setShared({ shelf: next });
  }

  /** Turns a part around (reverse complement); the caller supplies the flipped fragment. */
  flipShelfPart(id: string, flipped: DigestFragment): void {
    this.setShared({
      shelf: this.state.shelf.map((p) =>
        p.id === id ? { ...p, fragment: flipped, flipped: !p.flipped } : p,
      ),
    });
  }

  /** Treats a part with phosphatase, or takes the treatment back (#10). */
  setShelfPartDephosphorylated(id: string, dephosphorylated: boolean): void {
    this.setShared({
      shelf: this.state.shelf.map((p) =>
        p.id === id ? { ...p, fragment: { ...p.fragment, dephosphorylated } } : p,
      ),
    });
  }

  /** Moves a part up (-1) or down (+1) on the shelf, which is Ligation's order of joining. */
  moveShelfPart(id: string, delta: -1 | 1): void {
    const parts = [...this.state.shelf];
    const i = parts.findIndex((p) => p.id === id);
    const j = i + delta;
    const a = parts[i];
    const b = parts[j];
    if (i < 0 || a === undefined || b === undefined) return;
    parts[i] = b;
    parts[j] = a;
    this.setShared({ shelf: parts });
  }

  clearShelf(): void {
    if (this.state.shelf.length > 0) this.setShared({ shelf: [] });
  }
}

/**
 * The version the edit marks compare against, or null when they are off or
 * there is nothing to compare with — a document that has never been written
 * out and came from nowhere has no file to be measured against, and "Mark
 * from here" falls back to the state the document was opened in until it is
 * used.
 */
export function editsBaselineDocument(state: EditorState): SeqDocument | null {
  if (state.history === null) return null;
  switch (state.editsBaseline) {
    case 'off':
      return null;
    case 'saved':
      // A working copy that has not been downloaded yet is measured against
      // the file it came from: that is the last version of it on a disk.
      return state.savedDoc ?? state.origin?.doc ?? null;
    case 'marked':
      return state.markedDoc ?? state.openedDoc;
    case 'opened':
      return state.openedDoc;
  }
}

export const editorStore = new EditorStore();
