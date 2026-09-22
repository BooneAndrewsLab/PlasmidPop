import { type TranslationTable, isTranslationTable } from '@/core';
import { type FontSize, isFontSize } from '@/view/linear';

import { type CutCountFilter, isCutCountFilter } from './cutFilter';
import { type EditsBaseline, type ViewMode, editorStore } from './editorStore';
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
  readonly showCutSites: boolean;
  readonly seqFontSize: FontSize;
  /** Null means "fit the window", as in the store. */
  readonly seqBasesPerRow: number | null;
  readonly numberComplement: boolean;
  readonly colorBases: boolean;
  /**
   * Which baseline the edit marks use. "Mark from here" is a point in one
   * session's work, so it is remembered as the state the document was opened
   * in instead — there is no baseline document to bring back.
   */
  readonly editsBaseline: Exclude<EditsBaseline, 'marked'>;
  /** Where the splitters were left; see `LayoutSizes`. */
  readonly layout: LayoutSizes;
  /** Whether the sidebar is shown at all. */
  readonly sidebarOpen: boolean;
  /** The Enzymes tab's filters; see `SharedState.enzymeCutFilter`. */
  readonly enzymeCutFilter: CutCountFilter;
  readonly enzymeSupplier: string;
  /** The code the Translate tab and the ORF scan read with. */
  readonly geneticCode: TranslationTable;
}

const KEY = 'plasmidpop.viewPrefs';

const VIEW_MODES: readonly ViewMode[] = ['sequence', 'map', 'both'];

function isViewMode(v: unknown): v is ViewMode {
  return typeof v === 'string' && (VIEW_MODES as readonly string[]).includes(v);
}

const BASELINES: readonly string[] = ['off', 'opened', 'saved'];

function isStoredBaseline(v: unknown): v is Exclude<EditsBaseline, 'marked'> {
  return typeof v === 'string' && BASELINES.includes(v);
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
  const bases = record['seqBasesPerRow'];
  if (bases === null) prefs.seqBasesPerRow = null;
  else if (typeof bases === 'number' && Number.isFinite(bases) && bases >= 10) {
    prefs.seqBasesPerRow = Math.round(bases);
  }
  if (isCutCountFilter(record['enzymeCutFilter'])) {
    prefs.enzymeCutFilter = record['enzymeCutFilter'];
  }
  // The code is not checked against a table here: which suppliers exist
  // depends on the imported set, and the panel falls back to "any" for a
  // code the table in use does not have.
  if (typeof record['enzymeSupplier'] === 'string') {
    prefs.enzymeSupplier = record['enzymeSupplier'].slice(0, 8);
  }
  const code = record['geneticCode'];
  if (typeof code === 'number' && isTranslationTable(code)) prefs.geneticCode = code;
  const layout = record['layout'];
  if (typeof layout === 'object' && layout !== null) {
    const l = layout as Record<string, unknown>;
    const numbers: { -readonly [K in keyof LayoutSizes]?: number } = {};
    for (const key of ['viewsSplit', 'viewsSplitStacked', 'sidebarWidth'] as const) {
      if (typeof l[key] === 'number') numbers[key] = l[key];
    }
    prefs.layout = { ...DEFAULT_LAYOUT, ...clampLayout(numbers) };
  }
  for (const key of [
    'showComplement',
    'showTranslations',
    'showCutSites',
    'numberComplement',
    'colorBases',
    'sidebarOpen',
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
    showCutSites,
    seqFontSize,
    seqBasesPerRow,
    numberComplement,
    colorBases,
    editsBaseline,
    layout,
    sidebarOpen,
    enzymeCutFilter,
    enzymeSupplier,
    geneticCode,
  } = editorStore.getState();
  return {
    view,
    showComplement,
    showTranslations,
    showCutSites,
    seqFontSize,
    seqBasesPerRow,
    numberComplement,
    colorBases,
    editsBaseline: editsBaseline === 'marked' ? 'opened' : editsBaseline,
    layout,
    sidebarOpen,
    enzymeCutFilter,
    enzymeSupplier,
    geneticCode,
  };
}

function same(a: ViewPrefs, b: ViewPrefs): boolean {
  return (
    a.view === b.view &&
    a.showComplement === b.showComplement &&
    a.showTranslations === b.showTranslations &&
    a.showCutSites === b.showCutSites &&
    a.seqFontSize === b.seqFontSize &&
    a.seqBasesPerRow === b.seqBasesPerRow &&
    a.numberComplement === b.numberComplement &&
    a.colorBases === b.colorBases &&
    a.editsBaseline === b.editsBaseline &&
    a.layout === b.layout &&
    a.sidebarOpen === b.sidebarOpen &&
    a.enzymeCutFilter === b.enzymeCutFilter &&
    a.enzymeSupplier === b.enzymeSupplier &&
    a.geneticCode === b.geneticCode
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
  if (stored.showCutSites !== undefined) editorStore.setShowCutSites(stored.showCutSites);
  if (stored.seqFontSize !== undefined) editorStore.setSeqFontSize(stored.seqFontSize);
  if (stored.seqBasesPerRow !== undefined) editorStore.setSeqBasesPerRow(stored.seqBasesPerRow);
  if (stored.numberComplement !== undefined) {
    editorStore.setNumberComplement(stored.numberComplement);
  }
  if (stored.colorBases !== undefined) editorStore.setColorBases(stored.colorBases);
  if (stored.editsBaseline !== undefined) editorStore.setEditsBaseline(stored.editsBaseline);
  if (stored.layout !== undefined) editorStore.setLayout(stored.layout);
  if (stored.sidebarOpen !== undefined) editorStore.setSidebarOpen(stored.sidebarOpen);
  if (stored.enzymeCutFilter !== undefined) editorStore.setEnzymeCutFilter(stored.enzymeCutFilter);
  if (stored.enzymeSupplier !== undefined) editorStore.setEnzymeSupplier(stored.enzymeSupplier);
  if (stored.geneticCode !== undefined) editorStore.setGeneticCode(stored.geneticCode);
  let last = snapshot();
  return editorStore.subscribe(() => {
    const now = snapshot();
    if (same(now, last)) return;
    last = now;
    saveViewPrefs(now);
  });
}
