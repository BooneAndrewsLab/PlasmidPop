import {
  type AgarosePercent,
  type LadderChoice,
  type PrimerCriteria,
  type TranslationTable,
  isAgarosePercent,
  isConfidentQuality,
  isLadderChoice,
  isMinIdentityChoice,
  isTranslationTable,
  isTrimCutoff,
  normalizePrimerCriteria,
  samePrimerCriteria,
} from '@/core';
import { type FontSize, isFontSize } from '@/view/linear';

import { type BenchSettings, normalizeBenchSettings } from './benchSettings';
import { type SidebarReaction, isBenchReaction, isSidebarReaction } from './cloningReaction';
import { type CutCountFilter, isCutCountFilter } from './cutFilter';
import { type EnzymeSort, isEnzymeSort } from './enzymeSort';
import {
  type CustomBaseColors,
  type EditsBaseline,
  type PhonePane,
  type TraceSize,
  type ViewMode,
  editorStore,
  MAX_REMEMBERED_PANES,
  isPhonePane,
  isTraceSize,
  toBaseColors,
} from './editorStore';
import { DEFAULT_LAYOUT, type LayoutSizes, clampLayout } from './layout';

/**
 * How the views were left: the toolbar's view switcher, its three toggles
 * and the Format menu's sequence-view options. Remembered so a chosen
 * arrangement — no cut sites on a busy map, large text on a small screen —
 * survives a reload instead of coming back at the defaults. Nothing here
 * describes a document, so it is one setting for the app rather than
 * something stored per file.
 */
export interface ViewPrefs {
  readonly view: ViewMode;
  readonly showComplement: boolean;
  readonly showTranslations: boolean;
  /** The desktop's; see `SharedState.desktopShowCutSites`. */
  readonly showCutSites: boolean;
  /** The phone reader's, off until chosen there; see `SharedState.phoneShowCutSites`. */
  readonly phoneShowCutSites: boolean;
  readonly seqFontSize: FontSize;
  /** Null means "fit the window", as in the store. */
  readonly seqBasesPerRow: number | null;
  readonly numberComplement: boolean;
  readonly colorBases: boolean;
  /** How tall a read's trace is drawn; see `SharedState.traceSize`. */
  readonly traceSize: TraceSize;
  /** The base colours the user chose; see `SharedState.baseColors`. */
  readonly baseColors: CustomBaseColors | null;
  /**
   * Which baseline the edit marks use. "Mark from here" is a point in one
   * session's work, and a comparison marked in the views is a file or tab of
   * this session, so both are remembered as the state the document was
   * opened in instead — there is no baseline document to bring back.
   */
  readonly editsBaseline: StoredBaseline;
  /** Where the splitters were left; see `LayoutSizes`. */
  readonly layout: LayoutSizes;
  /** Whether the sidebar is shown at all. */
  readonly sidebarOpen: boolean;
  /** The Enzymes tab's filters and order; see `SharedState.enzymeCutFilter`. */
  readonly enzymeCutFilter: CutCountFilter;
  readonly enzymeSupplier: string;
  readonly enzymeSort: EnzymeSort;
  readonly enzymeGroupIsoschizomers: boolean;
  readonly enzymeSortReversed: boolean;
  /** The gel lanes are drawn for; see `SharedState.gelAgarose`. */
  readonly gelAgarose: AgarosePercent;
  readonly gelLadder: LadderChoice;
  /** Which reaction the Cloning tab shows; see `SharedState.sidebarReaction`. */
  readonly sidebarReaction: SidebarReaction;
  /** What the Bench's reactions were left at; see `BenchSettings`. */
  readonly bench: BenchSettings;
  /** The code the Translate tab and the ORF scan read with. */
  readonly geneticCode: TranslationTable;
  /** The Primers tab's settings; see `SharedState.primerCriteria`. */
  readonly primerCriteria: PrimerCriteria;
  /** What a read's confident bases and trimmed ends are; see `SharedState.readConfidentQuality`. */
  readonly readConfidentQuality: number;
  readonly readTrimCutoff: number;
  /** Detect features' settings; see `SharedState.detectOnOpen`. */
  readonly detectOnOpen: boolean;
  readonly detectMinIdentity: number;
  /**
   * The phone reader's pane per document, by the id it is stored under
   * (#43), so a reload comes back to the pane each tab was left on. The one
   * thing here that is about particular documents, and only a word about
   * each; a document not listed opens on the map.
   */
  readonly phonePanes: Readonly<Record<string, PhonePane>>;
}

const KEY = 'plasmidpop.viewPrefs';

const VIEW_MODES: readonly ViewMode[] = ['sequence', 'map', 'both'];

function isViewMode(v: unknown): v is ViewMode {
  return typeof v === 'string' && (VIEW_MODES as readonly string[]).includes(v);
}

const BASELINES: readonly string[] = ['off', 'opened', 'saved'];

type StoredBaseline = Exclude<EditsBaseline, 'marked' | 'compared'>;

function isStoredBaseline(v: unknown): v is StoredBaseline {
  return typeof v === 'string' && BASELINES.includes(v);
}

/**
 * The stored panes that are panes, under ids that could be ids, no more of
 * them than are kept.
 */
function toPhonePanes(v: unknown): Record<string, PhonePane> | null {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return null;
  const out: Record<string, PhonePane> = {};
  let n = 0;
  for (const [id, pane] of Object.entries(v as Record<string, unknown>)) {
    if (n >= MAX_REMEMBERED_PANES) break;
    if (id === '' || id.length > 64 || !isPhonePane(pane)) continue;
    out[id] = pane;
    n++;
  }
  return out;
}

function samePanes(
  a: Readonly<Record<string, PhonePane>>,
  b: Readonly<Record<string, PhonePane>>,
): boolean {
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every((k) => a[k] === b[k]);
}

/**
 * Reads the stored preferences, keeping only the fields that are there and
 * of the right type: an older or hand-edited entry must not be able to put
 * the store into a state the UI cannot show.
 */
export function loadViewPrefs(): Partial<ViewPrefs> {
  let raw: string | null;
  try {
    raw = globalThis.localStorage.getItem(KEY);
  } catch {
    return {}; // Storage unavailable (private mode, blocked cookies).
  }
  if (raw === null) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {};
  }
  if (typeof parsed !== 'object' || parsed === null) return {};
  const record = parsed as Record<string, unknown>;
  const prefs: { -readonly [K in keyof ViewPrefs]?: ViewPrefs[K] } = {};
  if (isViewMode(record['view'])) prefs.view = record['view'];
  if (isStoredBaseline(record['editsBaseline'])) prefs.editsBaseline = record['editsBaseline'];
  if (isFontSize(record['seqFontSize'])) prefs.seqFontSize = record['seqFontSize'];
  if (isTraceSize(record['traceSize'])) prefs.traceSize = record['traceSize'];
  if (record['baseColors'] === null) prefs.baseColors = null;
  else {
    const colors = toBaseColors(record['baseColors']);
    if (colors !== null) prefs.baseColors = colors;
  }
  const bases = record['seqBasesPerRow'];
  if (bases === null) prefs.seqBasesPerRow = null;
  else if (typeof bases === 'number' && Number.isFinite(bases) && bases >= 10) {
    prefs.seqBasesPerRow = Math.min(1000, Math.round(bases));
  }
  if (isCutCountFilter(record['enzymeCutFilter'])) {
    prefs.enzymeCutFilter = record['enzymeCutFilter'];
  }
  if (isEnzymeSort(record['enzymeSort'])) prefs.enzymeSort = record['enzymeSort'];
  if (isAgarosePercent(record['gelAgarose'])) prefs.gelAgarose = record['gelAgarose'];
  if (isLadderChoice(record['gelLadder'])) prefs.gelLadder = record['gelLadder'];
  if (isSidebarReaction(record['sidebarReaction'])) {
    prefs.sidebarReaction = record['sidebarReaction'];
  }
  if (typeof record['bench'] === 'object' && record['bench'] !== null) {
    prefs.bench = normalizeBenchSettings(record['bench']);
  }
  // Before the Bench (1.4) one field held all six reactions; it goes to
  // whichever of the two places now shows the one it names.
  const legacy = record['cloningReaction'];
  if (isSidebarReaction(legacy)) prefs.sidebarReaction ??= legacy;
  else if (isBenchReaction(legacy) && prefs.bench === undefined) {
    prefs.bench = normalizeBenchSettings({ reaction: legacy });
    prefs.sidebarReaction ??= 'digest';
  }
  // The code is not checked against a table here: which suppliers exist
  // depends on the imported set, and the panel falls back to "any" for a
  // code the table in use does not have.
  if (typeof record['enzymeSupplier'] === 'string') {
    prefs.enzymeSupplier = record['enzymeSupplier'].slice(0, 8);
  }
  const code = record['geneticCode'];
  if (typeof code === 'number' && isTranslationTable(code)) prefs.geneticCode = code;
  if (typeof record['primerCriteria'] === 'object' && record['primerCriteria'] !== null) {
    prefs.primerCriteria = normalizePrimerCriteria(record['primerCriteria']);
  }
  // Only the values the Align tab offers, so its selects can always show them.
  if (isConfidentQuality(record['readConfidentQuality'])) {
    prefs.readConfidentQuality = record['readConfidentQuality'];
  }
  if (isTrimCutoff(record['readTrimCutoff'])) prefs.readTrimCutoff = record['readTrimCutoff'];
  if (isMinIdentityChoice(record['detectMinIdentity'])) {
    prefs.detectMinIdentity = record['detectMinIdentity'];
  }
  const panes = toPhonePanes(record['phonePanes']);
  if (panes !== null) prefs.phonePanes = panes;
  const layout = record['layout'];
  if (typeof layout === 'object' && layout !== null) {
    const l = layout as Record<string, unknown>;
    const numbers: { -readonly [K in keyof LayoutSizes]?: number } = {};
    for (const key of [
      'viewsSplit',
      'viewsSplitStacked',
      'sidebarWidth',
      'sidebarHeightStacked',
    ] as const) {
      if (typeof l[key] === 'number') numbers[key] = l[key];
    }
    prefs.layout = { ...DEFAULT_LAYOUT, ...clampLayout(numbers) };
  }
  for (const key of [
    'showComplement',
    'showTranslations',
    'showCutSites',
    'phoneShowCutSites',
    'numberComplement',
    'colorBases',
    'sidebarOpen',
    'enzymeGroupIsoschizomers',
    'enzymeSortReversed',
    'detectOnOpen',
  ] as const) {
    if (typeof record[key] === 'boolean') prefs[key] = record[key];
  }
  return prefs;
}

export function saveViewPrefs(prefs: ViewPrefs): void {
  try {
    globalThis.localStorage.setItem(KEY, JSON.stringify(prefs));
  } catch {
    // Best effort, like the rest of local persistence.
  }
}

function snapshot(): ViewPrefs {
  const {
    view,
    showComplement,
    showTranslations,
    desktopShowCutSites,
    phoneShowCutSites,
    seqFontSize,
    seqBasesPerRow,
    numberComplement,
    colorBases,
    traceSize,
    baseColors,
    editsBaseline,
    layout,
    sidebarOpen,
    enzymeCutFilter,
    enzymeSupplier,
    enzymeSort,
    enzymeGroupIsoschizomers,
    enzymeSortReversed,
    gelAgarose,
    gelLadder,
    sidebarReaction,
    bench,
    geneticCode,
    primerCriteria,
    readConfidentQuality,
    readTrimCutoff,
    detectOnOpen,
    detectMinIdentity,
  } = editorStore.getState();
  return {
    view,
    showComplement,
    showTranslations,
    showCutSites: desktopShowCutSites,
    phoneShowCutSites,
    seqFontSize,
    seqBasesPerRow,
    numberComplement,
    colorBases,
    traceSize,
    baseColors,
    editsBaseline:
      editsBaseline === 'marked' || editsBaseline === 'compared' ? 'opened' : editsBaseline,
    layout,
    sidebarOpen,
    enzymeCutFilter,
    enzymeSupplier,
    enzymeSort,
    enzymeGroupIsoschizomers,
    enzymeSortReversed,
    gelAgarose,
    gelLadder,
    sidebarReaction,
    bench,
    geneticCode,
    primerCriteria,
    readConfidentQuality,
    readTrimCutoff,
    detectOnOpen,
    detectMinIdentity,
    phonePanes: editorStore.rememberedPhonePanes(),
  };
}

function same(a: ViewPrefs, b: ViewPrefs): boolean {
  return (
    a.view === b.view &&
    a.showComplement === b.showComplement &&
    a.showTranslations === b.showTranslations &&
    a.showCutSites === b.showCutSites &&
    a.phoneShowCutSites === b.phoneShowCutSites &&
    a.seqFontSize === b.seqFontSize &&
    a.seqBasesPerRow === b.seqBasesPerRow &&
    a.numberComplement === b.numberComplement &&
    a.colorBases === b.colorBases &&
    a.traceSize === b.traceSize &&
    a.baseColors === b.baseColors &&
    a.editsBaseline === b.editsBaseline &&
    a.layout === b.layout &&
    a.sidebarOpen === b.sidebarOpen &&
    a.enzymeCutFilter === b.enzymeCutFilter &&
    a.enzymeSupplier === b.enzymeSupplier &&
    a.enzymeSort === b.enzymeSort &&
    a.enzymeGroupIsoschizomers === b.enzymeGroupIsoschizomers &&
    a.enzymeSortReversed === b.enzymeSortReversed &&
    a.gelAgarose === b.gelAgarose &&
    a.gelLadder === b.gelLadder &&
    a.sidebarReaction === b.sidebarReaction &&
    a.bench === b.bench &&
    a.geneticCode === b.geneticCode &&
    samePrimerCriteria(a.primerCriteria, b.primerCriteria) &&
    a.readConfidentQuality === b.readConfidentQuality &&
    a.readTrimCutoff === b.readTrimCutoff &&
    a.detectOnOpen === b.detectOnOpen &&
    a.detectMinIdentity === b.detectMinIdentity &&
    samePanes(a.phonePanes, b.phonePanes)
  );
}

/**
 * Applies the stored preferences to the store and then writes them back
 * whenever they change. Returns the unsubscribe function.
 */
export function startViewPrefs(): () => void {
  const stored = loadViewPrefs();
  if (stored.view !== undefined) editorStore.setView(stored.view);
  if (stored.showComplement !== undefined) editorStore.setShowComplement(stored.showComplement);
  if (stored.showTranslations !== undefined) {
    editorStore.setShowTranslations(stored.showTranslations);
  }
  if (stored.showCutSites !== undefined) {
    editorStore.setShowCutSites(stored.showCutSites, 'desktop');
  }
  if (stored.phoneShowCutSites !== undefined) {
    editorStore.setShowCutSites(stored.phoneShowCutSites, 'phone');
  }
  if (stored.seqFontSize !== undefined) editorStore.setSeqFontSize(stored.seqFontSize);
  if (stored.seqBasesPerRow !== undefined) editorStore.setSeqBasesPerRow(stored.seqBasesPerRow);
  if (stored.numberComplement !== undefined) {
    editorStore.setNumberComplement(stored.numberComplement);
  }
  if (stored.colorBases !== undefined) editorStore.setColorBases(stored.colorBases);
  if (stored.traceSize !== undefined) editorStore.setTraceSize(stored.traceSize);
  if (stored.baseColors !== undefined) editorStore.setBaseColors(stored.baseColors);
  if (stored.editsBaseline !== undefined) editorStore.setEditsBaseline(stored.editsBaseline);
  if (stored.layout !== undefined) editorStore.setLayout(stored.layout);
  if (stored.sidebarOpen !== undefined) editorStore.setSidebarOpen(stored.sidebarOpen);
  if (stored.enzymeCutFilter !== undefined) editorStore.setEnzymeCutFilter(stored.enzymeCutFilter);
  if (stored.enzymeSupplier !== undefined) editorStore.setEnzymeSupplier(stored.enzymeSupplier);
  if (stored.enzymeSort !== undefined) editorStore.setEnzymeSort(stored.enzymeSort);
  if (stored.enzymeSortReversed !== undefined) {
    editorStore.setEnzymeSortReversed(stored.enzymeSortReversed);
  }
  if (stored.gelAgarose !== undefined) editorStore.setGelAgarose(stored.gelAgarose);
  if (stored.gelLadder !== undefined) editorStore.setGelLadder(stored.gelLadder);
  if (stored.enzymeGroupIsoschizomers !== undefined) {
    editorStore.setEnzymeGroupIsoschizomers(stored.enzymeGroupIsoschizomers);
  }
  if (stored.sidebarReaction !== undefined) {
    editorStore.setCloningReaction(stored.sidebarReaction);
  }
  if (stored.bench !== undefined) editorStore.restoreBench(stored.bench);
  if (stored.geneticCode !== undefined) editorStore.setGeneticCode(stored.geneticCode);
  if (stored.primerCriteria !== undefined) editorStore.setPrimerCriteria(stored.primerCriteria);
  if (stored.readConfidentQuality !== undefined) {
    editorStore.setReadConfidentQuality(stored.readConfidentQuality);
  }
  if (stored.readTrimCutoff !== undefined) editorStore.setReadTrimCutoff(stored.readTrimCutoff);
  if (stored.detectOnOpen !== undefined) editorStore.setDetectOnOpen(stored.detectOnOpen);
  if (stored.detectMinIdentity !== undefined) {
    editorStore.setDetectMinIdentity(stored.detectMinIdentity);
  }
  if (stored.phonePanes !== undefined) editorStore.restorePhonePanes(stored.phonePanes);
  let last = snapshot();
  return editorStore.subscribe(() => {
    const now = snapshot();
    if (same(now, last)) return;
    last = now;
    saveViewPrefs(now);
  });
}
