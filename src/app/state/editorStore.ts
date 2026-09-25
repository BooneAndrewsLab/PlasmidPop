import { analytics } from '../analytics';
import {
  type Alphabet,
  type AgarosePercent,
  type AssemblyPart,
  type Coalesce,
  type CutSite,
  type DocumentTool,
  type DigestFragment,
  type EditOp,
  type FeatureId,
  type LadderChoice,
  type Orf,
  type PrimerCriteria,
  type Range,
  type TranslationTable,
  BUNDLED_ENZYME_SET,
  CONFIDENT_QUALITY,
  DEFAULT_MIN_IDENTITY,
  DEFAULT_PRIMER_CRITERIA,
  DEFAULT_TABLE,
  History,
  SeqDocument,
  TRIM_CUTOFF,
  activeEnzymes,
  cleanStateName,
  createFeature,
  defaultFragmentName,
  describeEditStep,
  featureExtent,
  hasTool,
  documentChecksum,
  withPhosphates,
  isConfidentQuality,
  isMinIdentityChoice,
  isEmptyRange,
  isTrimCutoff,
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
import { type BenchPanel, type BenchSettings, DEFAULT_BENCH } from './benchSettings';
import { type CloningReaction, type SidebarReaction, isSidebarReaction } from './cloningReaction';
import { type CutCountFilter } from './cutFilter';
import { type EnzymeSort } from './enzymeSort';
import { DEFAULT_LAYOUT, type LayoutSizes, clampLayout } from './layout';

export type ViewMode = 'sequence' | 'map' | 'both';
/**
 * What the edit marks in the sequence view compare the document against:
 * nothing, the state it was opened in, the version last written to a file,
 * a point the user chose with "Mark from here", or the other side of a
 * Compare with… that was marked in the views (`DocumentState.compared`).
 */
export type EditsBaseline = 'off' | 'opened' | 'saved' | 'marked' | 'compared';

/** Where the other side of a Compare with… came from, so the dialog can open it (#37). */
export type ComparisonSource =
  | {
      readonly kind: 'file';
      /** The file as picked, so opening it goes the way File ▸ Open does. */
      readonly file: File;
    }
  | { readonly kind: 'tab'; readonly documentId: string };

/**
 * The Compare with… dialog: first choosing what to compare with (another
 * tab, or a file on disk), then the comparison itself.
 */
export type Comparison =
  | { readonly stage: 'choose' }
  | {
      readonly stage: 'review';
      /** The file's name, or the other tab's document name. */
      readonly name: string;
      /** The other side as read or as the tab has it now, not yet lined up. */
      readonly doc: SeqDocument;
      readonly source: ComparisonSource;
    };

/** The four base colours a user may set, as `#rrggbb`. */
export interface CustomBaseColors {
  readonly a: string;
  readonly c: string;
  readonly g: string;
  readonly t: string;
}

const HEX_COLOR = /^#[0-9a-f]{6}$/i;

/** Colours read back from storage, or null when any of the four is not one. */
export function toBaseColors(v: unknown): CustomBaseColors | null {
  if (typeof v !== 'object' || v === null) return null;
  const r = v as Record<string, unknown>;
  const out: Record<string, string> = {};
  for (const k of ['a', 'c', 'g', 't']) {
    const c = r[k];
    if (typeof c !== 'string' || !HEX_COLOR.test(c)) return null;
    out[k] = c.toLowerCase();
  }
  return out as unknown as CustomBaseColors;
}

/** How a read's trace is drawn in the sequence view; see `SharedState.traceSize`. */
export type TraceSize = 'off' | 'short' | 'tall';

export function isTraceSize(v: unknown): v is TraceSize {
  return v === 'off' || v === 'short' || v === 'tall';
}
export type SidebarTab =
  | 'features'
  | 'protein'
  | 'enzymes'
  | 'orfs'
  | 'translate'
  | 'primers'
  | 'align'
  | 'cloning'
  | 'history';

/** The three things the phone reader shows, one at a time (`PhoneShell`, item 15). */
export type PhonePane = 'map' | 'sequence' | 'details';

export const PHONE_PANES: readonly PhonePane[] = ['map', 'sequence', 'details'];

export function isPhonePane(v: unknown): v is PhonePane {
  return typeof v === 'string' && (PHONE_PANES as readonly string[]).includes(v);
}

/**
 * How many documents' phone panes are kept across a reload. The tabs a
 * session reopens are what they are for; the cap keeps documents that were
 * never reopened from piling up in the stored preferences.
 */
export const MAX_REMEMBERED_PANES = 20;

/** The sidebar's tabs in the rail's order, top to bottom, which `Alt+[` and `Alt+]` step through. */
export const SIDEBAR_TABS: readonly SidebarTab[] = [
  'features',
  'protein',
  'orfs',
  'translate',
  'primers',
  'enzymes',
  'cloning',
  'align',
  'history',
];

/** The tool a tab is the panel of, for the tabs a document may not have (#66). */
const SIDEBAR_TAB_TOOLS: Readonly<Partial<Record<SidebarTab, DocumentTool>>> = {
  protein: 'proteinProperties',
  orfs: 'orfs',
  translate: 'translate',
  primers: 'primers',
  enzymes: 'enzymes',
  cloning: 'cloning',
  align: 'align',
};

/** Whether a document has the panel `tab` is: a protein has no Enzymes, DNA no Protein. */
export function hasSidebarTab(doc: SeqDocument | null, tab: SidebarTab): boolean {
  const tool = SIDEBAR_TAB_TOOLS[tab];
  return tool === undefined || doc === null || hasTool(doc, tool);
}

/**
 * The tab a new tab for `doc` opens on, given the one the tab in front was
 * on: the same when `doc` has it, else the panel for what `doc` is.
 */
function inheritedSidebarTab(doc: SeqDocument, tab: SidebarTab): SidebarTab {
  if (hasSidebarTab(doc, tab)) return tab;
  return doc.isProtein ? 'protein' : 'features';
}

/** The rail's tabs for a document, in `SIDEBAR_TABS` order. */
export function sidebarTabsFor(doc: SeqDocument | null): readonly SidebarTab[] {
  return SIDEBAR_TABS.filter((tab) => hasSidebarTab(doc, tab));
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
  'styleBases',
  'setMetadata',
  'addFeature',
  'addFeatures',
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
  /**
   * The undo history kept in local storage, whose present is the document
   * being opened, and the two baselines as they stood (item 51). Without it
   * the document starts a fresh history as it always did.
   */
  readonly history?: {
    readonly history: History<SeqDocument>;
    readonly opened: SeqDocument;
    readonly saved: SeqDocument | null;
  };
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
  /**
   * The other side of a Compare with… marked in the views, lined up as the
   * dialog lined it up, and what it is called: the baseline for
   * `editsBaseline: 'compared'`. This document's own, so another tab's
   * comparison is not drawn over it; not kept across a reload.
   */
  readonly compared: { readonly name: string; readonly doc: SeqDocument } | null;
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
  /**
   * Which pane the phone reader shows for this tab (#43): per document, like
   * `sidebarTab`, so a switch of tabs comes back to it. A document opened
   * fresh — a file, a share link — starts on the map, which is what a link
   * is opened to see; one brought back from local storage gets the pane it
   * was left on (`restorePhonePanes`).
   */
  readonly phonePane: PhonePane;
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
  /**
   * How tall a sequencing read's trace is drawn above its bases, or not at
   * all (#55): a read with features and translations has tall rows, and the
   * chromatogram is not always what is being read.
   */
  readonly traceSize: TraceSize;
  /**
   * Colours for A, C, G and T chosen by the user (#29), or null for the
   * theme's, which differ between light and dark.
   */
  readonly baseColors: CustomBaseColors | null;
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
   *
   * Two preferences, one per layout (#43): the phone reader has its own,
   * off by default, and the desktop's is left as it was chosen. Which one
   * applies is `phoneLayout`; `EditorState.showCutSites` is that one.
   */
  readonly desktopShowCutSites: boolean;
  /**
   * The phone reader's. Off by default: on a 390 px ring the site labels
   * crowd the few feature names that fit, and a finger landing on the map
   * or the bases meets a site as often as what it was after. Not for the
   * label layout's sake — sites rank below features there and cost them
   * nothing (item 15, measured) — but for what a small screen shows first.
   */
  readonly phoneShowCutSites: boolean;
  /** Whether the app is laid out as the phone reader (`PHONE_QUERY`); set by `App`. */
  readonly phoneLayout: boolean;
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
   * Which of the digest, PCR and Mutate the sidebar's Cloning tab shows.
   * Remembered for the same reason the enzyme filters are: a lab
   * that does PCR does PCR every week, and coming back to the tab on someone
   * else's reaction is a small tax paid over and over.
   */
  readonly sidebarReaction: SidebarReaction;
  /** What the Bench's reactions were left at, the open one included; see `BenchSettings`. */
  readonly bench: BenchSettings;
  /**
   * What Undo and Redo would do to the shelf while the Bench is in front,
   * or null when there is nothing to undo or redo. The shelf keeps a history
   * of its own, apart from every document's (item 49): a fragment on it can
   * be the work of a digest in a tab since closed, and Remove or Clear should
   * not lose it for good.
   */
  readonly shelfUndo: string | null;
  readonly shelfRedo: string | null;
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
   * The Phred quality from which a read's base counts as confident (#56):
   * the Align tab's count, list and shading of differences, and the status
   * bar's share of good bases. Q20 by default, the common Sanger line; a
   * lab working with nanopore consensus reads wants Q40 every time, so it is
   * kept with the view preferences. One of `CONFIDENT_QUALITY_CHOICES`.
   */
  readonly readConfidentQuality: number;
  /**
   * The error probability per base the Align tab trims a read's ends at
   * (#56); 0.05, about Q13, by default. One of `TRIM_CUTOFF_CHOICES`.
   */
  readonly readTrimCutoff: number;
  /**
   * Whether a file opened with no features of its own is searched for the
   * library's common ones straight away (item 59); off by default, since
   * it is work the user did not ask for each time. Kept with the view
   * preferences.
   */
  readonly detectOnOpen: boolean;
  /** How closely Detect features insists a part match; one of `MIN_IDENTITY_CHOICES`. */
  readonly detectMinIdentity: number;
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
  readonly shareNotice: ShareNoticeInfo | null;
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
  /**
   * What each panel is pointing at in the views, one entry per panel
   * (#32); see `DocumentPreview`. The views draw `EditorState.preview`, the
   * ones for the document in front put together.
   */
  readonly previews: readonly DocumentPreview[];
  /** Bumped when a clickable previewed span is clicked in either view. */
  readonly previewActivated: PreviewActivation | null;
  /**
   * The Compare with… dialog, while it is up: choosing what to compare the
   * document in front with, or the comparison with a file or another tab.
   * Nothing is opened and nothing is stored — a file is read, diffed and
   * dropped — so this is the one place a document PlasmidPop is not editing
   * lives. Shared rather than per-tab because it is a modal dialog: only one
   * can be up.
   */
  readonly comparison: Comparison | null;
  /**
   * Whether the New sequence dialog is up (#6): a name and a topology asked
   * for before the empty document opens, rather than fixed afterwards.
   */
  readonly newDialog: boolean;
  /** Whether the Open from NCBI dialog is up (#65, item 58). */
  readonly ncbiDialog: boolean;
  /** Where the draggable boundaries sit; see `LayoutSizes`. */
  readonly layout: LayoutSizes;
}

/**
 * Spans a panel is pointing at — a primer pair being weighed up, every match
 * of a find — drawn in both views and in neither document. It carries the
 * document it was computed against so a stale preview cannot be drawn over
 * another tab's sequence. Each panel has one of its own, so the find bar and
 * a sidebar tab can both point at once (#32).
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

export type PreviewOwner = 'primers' | 'collection' | 'find' | 'cloning' | 'pcr' | 'orfs';

/**
 * The previews for the document in front, put together for the views: each
 * span's id is its panel's and its own (`primers:forward`), so two panels'
 * spans never share a lane or a click. `owners` says whose they are.
 */
export interface MergedPreview {
  readonly documentId: string;
  readonly owners: readonly PreviewOwner[];
  readonly items: readonly OverlaySpan[];
}

/** The id a span has in `MergedPreview`: its panel's, then its own. */
function mergedId(owner: PreviewOwner, id: string): string {
  return `${owner}:${id}`;
}

let lastMerge: {
  readonly previews: readonly DocumentPreview[];
  readonly activeId: string | null;
  readonly merged: MergedPreview | null;
} | null = null;

/**
 * The previews of the document in front, merged; the same object for as
 * long as neither changes, so a view that draws it redraws no more than it
 * must.
 */
function mergePreviews(
  previews: readonly DocumentPreview[],
  activeId: string | null,
): MergedPreview | null {
  if (lastMerge !== null && lastMerge.previews === previews && lastMerge.activeId === activeId)
    return lastMerge.merged;
  const mine = previews.filter((p) => p.documentId === activeId);
  const merged =
    activeId === null || mine.length === 0
      ? null
      : {
          documentId: activeId,
          owners: mine.map((p) => p.owner),
          items: mine.flatMap((p) => p.items.map((i) => ({ ...i, id: mergedId(p.owner, i.id) }))),
        };
  lastMerge = { previews, activeId, merged };
  return merged;
}

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
    | 'phonePane'
    ? DocumentState[K]
    : DocumentState[K] | null;
};

/**
 * What the tab strip has in front: a document, the file list, or the Cloning
 * Bench (item 49), which works across documents and so is none of them.
 */
export type FrontTab = 'document' | 'files' | 'bench';

/** What a copied share link carries (#39), for the notice under the toolbar. */
export interface ShareNoticeInfo {
  /** The link's length, in characters. */
  readonly chars: number;
  /** Whether it is the whole document or the selection extracted as one. */
  readonly of: 'document' | 'selection';
  /**
   * The length it would have had with its references and comments, when
   * they were left out to bring it under the limit; else null.
   */
  readonly fullChars: number | null;
}

export interface EditorState extends SharedState, ActiveDocumentFields {
  /**
   * Whether the views draw cut sites: the phone's preference or the
   * desktop's, whichever layout is on screen.
   */
  readonly showCutSites: boolean;
  /** What is in front; the document fields are empty unless it is a document. */
  readonly front: FrontTab;
  /** What the panels are pointing at in the document in front, for the views to draw. */
  readonly preview: MergedPreview | null;
  /** The open documents, in tab order. */
  readonly documents: readonly DocumentState[];
  /** Whether the document in front differs from what is on disk. */
  readonly dirty: boolean;
}

/** How many shelf changes Undo can go back through. */
const SHELF_UNDO_LIMIT = 100;

const SHARED_INITIAL: SharedState = {
  error: null,
  errorCountdown: null,
  showComplement: true,
  showTranslations: true,
  seqFontSize: 13,
  seqBasesPerRow: null,
  numberComplement: false,
  colorBases: false,
  traceSize: 'short',
  baseColors: null,
  editsBaseline: 'opened',
  view: 'both',
  sidebarOpen: true,
  desktopShowCutSites: true,
  phoneShowCutSites: false,
  phoneLayout: false,
  enzymeCutFilter: 'any',
  enzymeSupplier: '',
  enzymeSort: 'name',
  enzymeGroupIsoschizomers: true,
  enzymeSortReversed: false,
  gelAgarose: 1,
  gelLadder: 'auto',
  sidebarReaction: 'digest',
  bench: DEFAULT_BENCH,
  shelfUndo: null,
  shelfRedo: null,
  orfMinCodons: 75,
  geneticCode: DEFAULT_TABLE,
  primerCriteria: DEFAULT_PRIMER_CRITERIA,
  readConfidentQuality: CONFIDENT_QUALITY,
  readTrimCutoff: TRIM_CUTOFF,
  detectOnOpen: false,
  detectMinIdentity: DEFAULT_MIN_IDENTITY,
  shelf: [],
  downloadNotice: null,
  shareNotice: null,
  readNotice: null,
  storageNotice: false,
  previews: [],
  previewActivated: null,
  comparison: null,
  newDialog: false,
  ncbiDialog: false,
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
  compared: null,
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
  phonePane: 'map',
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
/**
 * The open tabs that hold DNA, which is all a reaction of the bench can use:
 * a protein is not a template, an insert or a vector (#66).
 */
export function cloningDocuments(documents: readonly DocumentState[]): DocumentState[] {
  return documents.filter((d) => hasTool(d.history.present, 'cloning'));
}

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
    showCutSites: shared.phoneLayout ? shared.phoneShowCutSites : shared.desktopShowCutSites,
    front: active !== null ? 'document' : bench ? 'bench' : 'files',
    // A preview belongs to the tab it was computed for; behind another one
    // it is simply not there, and it comes back on the way back.
    preview: mergePreviews(shared.previews, active === null ? null : activeId),
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
  /** See `restorePhonePanes`. */
  private panesToRestore = new Map<string, PhonePane>();
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
    // A history brought back from storage is only taken when it ends at the
    // document being opened; it then says where the baselines were.
    const kept = storage.history?.history.present === doc ? storage.history : undefined;
    const entry: DocumentState = {
      documentId: storage.id ?? newId(),
      history: kept?.history ?? History.create(doc),
      selection: null,
      selectedFeatureId: null,
      fileName,
      // A document opened from a file starts clean; a pasted/example one has nowhere to be saved yet.
      savedDoc: kept === undefined ? (fileName === null ? null : doc) : kept.saved,
      openedDoc: kept?.opened ?? doc,
      markedDoc: null,
      compared: null,
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
      // while setting up a digest should not send you back to Features —
      // unless this one has no such panel (#66): a protein opened from the
      // Translate tab goes to the one that is about it.
      sidebarTab: inheritedSidebarTab(doc, this.documentState()?.sidebarTab ?? 'features'),
      phonePane: this.takeRememberedPane(storage.id),
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
  newDocument(
    topology: 'linear' | 'circular' = 'linear',
    name = 'Untitled',
    alphabet: Alphabet = 'nucleotide',
  ): string {
    const protein = alphabet === 'protein';
    const doc = SeqDocument.create({
      name: name.trim() === '' ? 'Untitled' : name.trim(),
      sequence: '',
      alphabet,
      // A protein is a chain with two ends.
      topology: protein ? 'linear' : topology,
      metadata: { moleculeType: protein ? '' : 'DNA' },
    });
    analytics.track('file', 'new');
    const id = this.openDocument(doc);
    this.setDocument(id, { savedDoc: doc, selection: { start: 0, end: 0 } });
    return id;
  }

  /**
   * Translate ▸ Open as protein (#66): the protein, made from a CDS or a
   * translated frame, in a tab of its own on its Protein panel. It has no
   * file behind it, so it is the user's to keep from the start, and it
   * starts clean like a New document: nothing is lost by closing it that
   * the DNA it came from does not still have.
   */
  openProtein(protein: SeqDocument, from: 'cds' | 'frame'): string {
    analytics.track('protein', 'open', from);
    const id = this.openDocument(protein);
    this.setDocument(id, { savedDoc: protein, sidebarTab: 'protein' });
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
  showBench(from?: 'tab' | 'link' | 'key'): void {
    if (this.bench) return;
    if (from !== undefined) analytics.trackOnce('cloning', 'bench', from);
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

  /**
   * Moves a tab to `index` in the strip, counted as the tabs stand before
   * the move; out-of-range indexes go to either end. Nothing else changes:
   * the front tab stays in front, and `Alt+1..9` follow the new order.
   */
  moveDocument(id: string, index: number): void {
    const from = this.docs.findIndex((d) => d.documentId === id);
    const moving = this.docs[from];
    if (moving === undefined) return;
    const rest = this.docs.filter((d) => d !== moving);
    const to = Math.max(0, Math.min(rest.length, Math.round(index)));
    if (to === from) return;
    this.docs = [...rest.slice(0, to), moving, ...rest.slice(to)];
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
   * Re-keys a tab that has no steps of its own into the stored entry it is
   * identical to, and makes it that entry reopened, as **Recent files**
   * would give it (#84): its undo history, **Since opened**, and where it
   * came from, so the autosave that follows writes the entry's history back
   * rather than the tab's empty one over it, and a first edit does not fork
   * a working copy that throws the history away. `stored.history.present`
   * has the same contents as the tab's present (the merge is only made when
   * it has), so nothing in the view moves. A tab that was clean is still
   * clean: the file it was just read from holds the present. Nothing
   * happens when the tab is gone, has steps, or the new id is a tab of its own.
   */
  mergeIntoStored(
    from: string,
    to: string,
    stored: {
      readonly history: {
        readonly history: History<SeqDocument>;
        readonly opened: SeqDocument;
        readonly saved: SeqDocument | null;
      };
      readonly origin: DocumentOrigin | null;
      readonly derived: boolean;
    },
  ): void {
    const d = this.documentState(from);
    if (d === null || from === to || this.documentState(to) !== null || d.history.size > 0) return;
    const { history, opened, saved } = stored.history;
    const savedDoc = d.savedDoc === d.history.present ? history.present : saved;
    const merged: DocumentState = {
      ...d,
      documentId: to,
      history,
      openedDoc: opened,
      savedDoc,
      origin: stored.origin,
      derived: stored.derived,
    };
    this.docs = this.docs.map((x) => (x === d ? merged : x));
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
  noteShareCopied(notice: ShareNoticeInfo): void {
    this.setShared({ shareNotice: notice });
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

  /**
   * Names the state `position` changes lead to in the document in front, or
   * clears its name when `name` is blank (#4). A name is not an undo step:
   * it says something about the history rather than changing the document,
   * and a step for it would put the named state itself one Undo back, so
   * naming the present would make it the one state Undo leaves. It is kept
   * with the history, though, and saved with it.
   */
  nameHistoryState(position: number, name: string): void {
    const history = this.state.history;
    if (history === null) return;
    const next = history.named(position, name);
    if (next === history) return;
    analytics.track('history', 'name', cleanStateName(name) === '' ? 'clear' : 'set');
    this.setActive({ history: next });
  }

  /** Renames a named state the limit has dropped from the steps, or forgets it with a blank name. */
  nameKeptState(index: number, name: string): void {
    const history = this.state.history;
    if (history === null) return;
    const next = history.renamedKept(index, name);
    if (next === history) return;
    analytics.track('history', 'name', cleanStateName(name) === '' ? 'clear' : 'set');
    this.setActive({ history: next });
  }

  /**
   * Makes a named state the limit dropped the present again. It is not in
   * the undo stack any more, so this is a change of its own, and undoing it
   * gives back the state it replaced.
   */
  bringBackKeptState(index: number): void {
    const target = this.documentState();
    const kept = target?.history.kept[index];
    if (target === null || kept === undefined) return;
    if (kept.state === target.history.present) return;
    analytics.track('history', 'bring-back');
    this.clearPreview();
    this.setActive({
      history: target.history.push(kept.state, `Back to “${kept.name}”`).seal(),
      selection: null,
    });
  }

  /**
   * Makes a state of the history — one of its steps, or a named state kept
   * outside them — what the edit marks measure from, through the same
   * baseline Compare with… uses (#37): the views, Next and Previous change
   * and the Edits menu then show what has changed since it. `name` is what
   * the menu and the notes call it: the state's name, or its step number.
   */
  markChangesSince(doc: SeqDocument, name: string): void {
    if (this.activeId === null) return;
    analytics.track('history', 'mark-since');
    this.shared = { ...this.shared, editsBaseline: 'compared' };
    this.setActive({ compared: { name, doc } });
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
    const selection = featureExtent(feature);
    if (selection === null) return;
    this.setActive({
      selection,
      selectedFeatureId: featureId,
      reveal: { position: selection.start, nonce: (this.state.reveal?.nonce ?? 0) + 1 },
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
    // A protein has no Enzymes tab, and DNA no Protein one (#66).
    if (tab !== this.state.sidebarTab && hasSidebarTab(this.document, tab)) {
      this.setActive({ sidebarTab: tab });
    }
  }

  setPhonePane(pane: PhonePane): void {
    if (pane !== this.state.phonePane) this.setActive({ phonePane: pane });
  }

  /**
   * The panes documents were left on before a reload, from the stored view
   * preferences: each is given to its document when that is reopened from
   * local storage under the same id, and only then.
   */
  restorePhonePanes(panes: Readonly<Record<string, PhonePane>>): void {
    this.panesToRestore = new Map(Object.entries(panes));
  }

  /**
   * The panes to keep across a reload: every open tab's that is not the
   * map, then those still waiting for their document to be reopened, up to
   * `MAX_REMEMBERED_PANES`. The map is left out as the default it is.
   */
  rememberedPhonePanes(): Readonly<Record<string, PhonePane>> {
    const out: Record<string, PhonePane> = {};
    let n = 0;
    const add = (id: string, pane: PhonePane): void => {
      if (n >= MAX_REMEMBERED_PANES || pane === 'map' || id in out) return;
      out[id] = pane;
      n++;
    };
    for (const d of this.docs) add(d.documentId, d.phonePane);
    for (const [id, pane] of this.panesToRestore) {
      if (this.documentState(id) === null) add(id, pane);
    }
    return out;
  }

  /** The pane a document reopened under `id` was left on; the map for anything else. */
  private takeRememberedPane(id: string | undefined): PhonePane {
    if (id === undefined) return 'map';
    const pane = this.panesToRestore.get(id);
    this.panesToRestore.delete(id);
    return pane ?? 'map';
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

  /** Picks a reaction: PCR and Mutate in the sidebar, the others on the Bench. */
  setCloningReaction(reaction: CloningReaction): void {
    if (isSidebarReaction(reaction)) {
      if (reaction !== this.state.sidebarReaction) this.setShared({ sidebarReaction: reaction });
    } else if (reaction !== this.state.bench.reaction) {
      this.setShared({ bench: { ...this.state.bench, reaction } });
    }
  }

  /** Changes what one of the Bench's panels is set to. */
  updateBench<K extends BenchPanel>(panel: K, patch: Partial<BenchSettings[K]>): void {
    const current = this.state.bench[panel];
    const changed = (Object.keys(patch) as (keyof BenchSettings[K])[]).some(
      (k) => patch[k] !== current[k],
    );
    if (!changed) return;
    this.setShared({ bench: { ...this.state.bench, [panel]: { ...current, ...patch } } });
  }

  /** Puts back the Bench's settings a previous session left, on start-up. */
  restoreBench(bench: BenchSettings): void {
    this.setShared({ bench });
  }

  /** Puts every draggable boundary back where it started, sidebar included. */
  resetLayout(): void {
    this.setShared({ layout: DEFAULT_LAYOUT, sidebarOpen: true });
  }

  setSidebarOpen(open: boolean): void {
    if (open !== this.state.sidebarOpen) this.setShared({ sidebarOpen: open });
  }

  /**
   * Shows or hides cut sites for the layout on screen, or for the one named:
   * the toolbar toggle and the Enzymes tab's link change the one in use, and
   * the stored preferences are put back into each by name.
   */
  setShowCutSites(show: boolean, layout: 'desktop' | 'phone' = this.layoutName()): void {
    if (layout === 'phone') {
      if (show !== this.shared.phoneShowCutSites) this.setShared({ phoneShowCutSites: show });
    } else if (show !== this.shared.desktopShowCutSites) {
      this.setShared({ desktopShowCutSites: show });
    }
  }

  setPhoneLayout(phone: boolean): void {
    if (phone !== this.shared.phoneLayout) this.setShared({ phoneLayout: phone });
  }

  private layoutName(): 'desktop' | 'phone' {
    return this.shared.phoneLayout ? 'phone' : 'desktop';
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
      next.sidebarWidth === current.sidebarWidth &&
      next.sidebarHeightStacked === current.sidebarHeightStacked
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
    const current = this.shared.previews.find((p) => p.owner === owner);
    if (current?.documentId === id && samePreview(current.items, items)) return;
    this.setShared({
      previews: [
        ...this.shared.previews.filter((p) => p.owner !== owner),
        { owner, documentId: id, items },
      ],
    });
  }

  /** Asks for a new sequence's name and topology before opening it (#6). */
  requestNewDocument(): void {
    if (!this.shared.newDialog) this.setShared({ newDialog: true });
  }

  dismissNewDocument(): void {
    if (this.shared.newDialog) this.setShared({ newDialog: false });
  }

  /** Asks which accessions to fetch from NCBI; nothing is sent until the user says so. */
  requestNcbi(): void {
    if (!this.shared.ncbiDialog) this.setShared({ ncbiDialog: true });
  }

  dismissNcbi(): void {
    if (this.shared.ncbiDialog) this.setShared({ ncbiDialog: false });
  }

  /** Opens Compare with… on its first question: what to compare with. */
  requestComparison(): void {
    if (this.activeId === null || this.shared.comparison !== null) return;
    this.setShared({ comparison: { stage: 'choose' } });
  }

  /** Shows what the document in front differs from in a file just read, or another tab. */
  showComparison(name: string, doc: SeqDocument, source: ComparisonSource): void {
    const front = this.document;
    if (this.activeId === null || front === null) return;
    // Residues and bases have nothing to line up (#66).
    if (doc.alphabet !== front.alphabet) {
      this.fail(
        front.isProtein
          ? `“${name}” is DNA and this is a protein; a protein is compared with a protein.`
          : `“${name}” is a protein and this is DNA; translate it first, or compare it with a protein.`,
      );
      return;
    }
    this.setShared({ comparison: { stage: 'review', name, doc, source } });
  }

  /** Compares the document in front with another tab's present version. */
  compareWithTab(id: string): void {
    const other = this.documentState(id);
    if (other === null || id === this.activeId) return;
    const doc = other.history.present;
    this.showComparison(doc.name, doc, { kind: 'tab', documentId: id });
  }

  /**
   * Makes `doc` — the other side of a comparison, lined up as the dialog
   * lined it up — what the edit marks of the document in front measure
   * from, and closes the dialog.
   */
  markComparedInViews(name: string, doc: SeqDocument): void {
    if (this.activeId === null) return;
    this.shared = { ...this.shared, comparison: null, editsBaseline: 'compared' };
    this.setActive({ compared: { name, doc } });
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
    // The views know a span by its merged id; the panel knows it by its own.
    const owner = preview.owners.find((o) => id.startsWith(`${o}:`));
    if (owner === undefined) return;
    this.setShared({
      previewActivated: {
        owner,
        id: id.slice(owner.length + 1),
        nonce: (this.shared.previewActivated?.nonce ?? 0) + 1,
      },
    });
  }

  /** Takes a panel's preview away, or every panel's. */
  clearPreview(owner?: PreviewOwner): void {
    const next = owner === undefined ? [] : this.shared.previews.filter((p) => p.owner !== owner);
    if (next.length === this.shared.previews.length) return;
    this.setShared({ previews: next });
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

  /** Sets the quality a read's base counts as confident from; see `readConfidentQuality`. */
  setReadConfidentQuality(q: number): void {
    if (isConfidentQuality(q) && q !== this.state.readConfidentQuality) {
      this.setShared({ readConfidentQuality: q });
    }
  }

  /** Sets the error rate a read's ends are trimmed at; see `readTrimCutoff`. */
  setReadTrimCutoff(cutoff: number): void {
    if (isTrimCutoff(cutoff) && cutoff !== this.state.readTrimCutoff) {
      this.setShared({ readTrimCutoff: cutoff });
    }
  }

  /** Turns on or off Detect features for files opened with none; see `detectOnOpen`. */
  setDetectOnOpen(on: boolean): void {
    if (on !== this.state.detectOnOpen) this.setShared({ detectOnOpen: on });
  }

  /** Sets how closely Detect features insists a part match; see `detectMinIdentity`. */
  setDetectMinIdentity(identity: number): void {
    if (isMinIdentityChoice(identity) && identity !== this.state.detectMinIdentity) {
      this.setShared({ detectMinIdentity: identity });
    }
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
    const value = bases === null ? null : Math.min(1000, Math.max(10, Math.round(bases)));
    if (value !== this.state.seqBasesPerRow) this.setShared({ seqBasesPerRow: value });
  }

  setNumberComplement(show: boolean): void {
    if (show !== this.state.numberComplement) this.setShared({ numberComplement: show });
  }

  setColorBases(color: boolean): void {
    if (color !== this.state.colorBases) this.setShared({ colorBases: color });
  }

  setTraceSize(size: TraceSize): void {
    if (size !== this.state.traceSize) this.setShared({ traceSize: size });
  }

  /** The base colours the user picked, or null for the theme's. */
  setBaseColors(colors: CustomBaseColors | null): void {
    const current = this.state.baseColors;
    const same =
      colors === null
        ? current === null
        : current !== null &&
          colors.a === current.a &&
          colors.c === current.c &&
          colors.g === current.g &&
          colors.t === current.t;
    if (!same) this.setShared({ baseColors: colors === null ? null : { ...colors } });
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

  /** Earlier shelves, newest last, each with the change that left it; see `shelfUndo`. */
  private shelfPast: { readonly shelf: readonly AssemblyPart[]; readonly label: string }[] = [];
  private shelfFuture: { readonly shelf: readonly AssemblyPart[]; readonly label: string }[] = [];

  /** Replaces the shelf as one step of its history, which `label` describes ("Remove pUC19"). */
  private changeShelf(shelf: readonly AssemblyPart[], label: string): void {
    this.shelfPast = [...this.shelfPast, { shelf: this.state.shelf, label }].slice(
      -SHELF_UNDO_LIMIT,
    );
    this.shelfFuture = [];
    this.setShared({ shelf, shelfUndo: label, shelfRedo: null });
  }

  /** Takes the shelf back one change. */
  undoShelf(): void {
    const step = this.shelfPast.at(-1);
    if (step === undefined) return;
    analytics.track('cloning', 'shelf-undo');
    this.shelfPast = this.shelfPast.slice(0, -1);
    this.shelfFuture = [...this.shelfFuture, { shelf: this.state.shelf, label: step.label }];
    this.setShared({
      shelf: step.shelf,
      shelfUndo: this.shelfPast.at(-1)?.label ?? null,
      shelfRedo: step.label,
    });
  }

  /** Makes the shelf change undone last again. */
  redoShelf(): void {
    const step = this.shelfFuture.at(-1);
    if (step === undefined) return;
    analytics.track('cloning', 'shelf-redo');
    this.shelfFuture = this.shelfFuture.slice(0, -1);
    this.shelfPast = [...this.shelfPast, { shelf: this.state.shelf, label: step.label }];
    this.setShared({
      shelf: step.shelf,
      shelfUndo: step.label,
      shelfRedo: this.shelfFuture.at(-1)?.label ?? null,
    });
  }

  /**
   * Puts back the shelf the last session left behind. It gives way to
   * whatever is already there: if the user has started collecting fragments
   * while storage was being read, those are the ones they mean. It is where
   * the shelf's history starts, not a step of it.
   */
  restoreShelf(parts: readonly AssemblyPart[]): void {
    if (parts.length === 0 || this.state.shelf.length > 0) return;
    this.shelfPast = [];
    this.shelfFuture = [];
    this.setShared({ shelf: parts, shelfUndo: null, shelfRedo: null });
  }

  /** Appends a fragment to the shelf and returns its part id. */
  addToShelf(fragment: DigestFragment): string {
    const id = newId();
    this.changeShelf(
      [...this.state.shelf, { id, fragment, flipped: false }],
      `Add ${defaultFragmentName(fragment)}`,
    );
    return id;
  }

  removeFromShelf(id: string): void {
    const part = this.state.shelf.find((p) => p.id === id);
    if (part === undefined) return;
    this.changeShelf(
      this.state.shelf.filter((p) => p !== part),
      `Remove ${defaultFragmentName(part.fragment)}`,
    );
  }

  /** Turns a part around (reverse complement); the caller supplies the flipped fragment. */
  flipShelfPart(id: string, flipped: DigestFragment): void {
    const part = this.state.shelf.find((p) => p.id === id);
    if (part === undefined) return;
    this.changeShelf(
      this.state.shelf.map((p) =>
        p === part ? { ...p, fragment: flipped, flipped: !p.flipped } : p,
      ),
      `Flip ${defaultFragmentName(part.fragment)}`,
    );
  }

  /** Treats a part with phosphatase, or takes the treatment back (#10). */
  setShelfPartDephosphorylated(id: string, dephosphorylated: boolean): void {
    const part = this.state.shelf.find((p) => p.id === id);
    if (part === undefined || (part.fragment.dephosphorylated === true) === dephosphorylated) {
      return;
    }
    this.changeShelf(
      this.state.shelf.map((p) =>
        // The treatment is a step of the part's lineage too (#67).
        p === part ? { ...p, fragment: withPhosphates(p.fragment, dephosphorylated) } : p,
      ),
      `${dephosphorylated ? 'Dephosphorylate' : 'Phosphorylate'} ${defaultFragmentName(part.fragment)}`,
    );
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
    this.changeShelf(parts, `Move ${defaultFragmentName(a.fragment)}`);
  }

  clearShelf(): void {
    if (this.state.shelf.length > 0) this.changeShelf([], 'Clear the shelf');
  }
}

/**
 * The baseline the document in front is actually measured from. The choice
 * is shared by every tab but a comparison belongs to one document, so on a
 * document that has not been compared with anything "compared" means
 * "since opened", and the Edits menu says so rather than naming nothing.
 */
export function effectiveEditsBaseline(state: EditorState): EditsBaseline {
  return state.editsBaseline === 'compared' && state.compared === null
    ? 'opened'
    : state.editsBaseline;
}

/**
 * The version the edit marks compare against, or null when they are off or
 * there is nothing to compare with — a document that has never been written
 * out and came from nowhere has no file to be measured against, and "Mark
 * from here" falls back to the state the document was opened in until it is
 * used, as "compared" does on a document not compared with anything.
 */
export function editsBaselineDocument(state: EditorState): SeqDocument | null {
  if (state.history === null) return null;
  switch (effectiveEditsBaseline(state)) {
    case 'compared':
      return state.compared?.doc ?? state.openedDoc;
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
