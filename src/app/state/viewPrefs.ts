import { type ViewMode, editorStore } from './editorStore';

/**
 * How the views were left: the toolbar's view switcher and its three
 * toggles. Remembered so a chosen arrangement — no cut sites on a busy map,
 * say — survives a reload instead of coming back at the defaults. Nothing
 * here describes a document, so it is one setting for the app rather than
 * something stored per file.
 */
export interface ViewPrefs {
  readonly view: ViewMode;
  readonly showComplement: boolean;
  readonly showTranslations: boolean;
  readonly showCutSites: boolean;
}

const KEY = 'plasmidpop.viewPrefs';

const VIEW_MODES: readonly ViewMode[] = ['sequence', 'map', 'both'];

function isViewMode(v: unknown): v is ViewMode {
  return typeof v === 'string' && (VIEW_MODES as readonly string[]).includes(v);
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
  for (const key of ['showComplement', 'showTranslations', 'showCutSites'] as const) {
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
  const { view, showComplement, showTranslations, showCutSites } = editorStore.getState();
  return { view, showComplement, showTranslations, showCutSites };
}

function same(a: ViewPrefs, b: ViewPrefs): boolean {
  return (
    a.view === b.view &&
    a.showComplement === b.showComplement &&
    a.showTranslations === b.showTranslations &&
    a.showCutSites === b.showCutSites
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
  let last = snapshot();
  return editorStore.subscribe(() => {
    const now = snapshot();
    if (same(now, last)) return;
    last = now;
    saveViewPrefs(now);
  });
}
