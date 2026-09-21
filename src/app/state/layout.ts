/**
 * Where the draggable boundaries sit. The panes used to be fixed ratios in
 * CSS, which left a user who wanted the map at half the screen with no way
 * to say so; these are what the splitters move, remembered with the other
 * view preferences.
 */
export interface LayoutSizes {
  /** The map's share of the Both view, side by side. */
  readonly viewsSplit: number;
  /**
   * The map's share of the Both view stacked. A second number rather than
   * the same one, because the two layouts divide different axes and a ratio
   * chosen for a wide window is the wrong one on top of the sequence.
   */
  readonly viewsSplitStacked: number;
  /** The sidebar's width in px, tab rail included. */
  readonly sidebarWidth: number;
}

/** The ratios the stylesheet had before the splitters: 2fr/3fr and 1fr/1.4fr. */
export const DEFAULT_LAYOUT: LayoutSizes = {
  viewsSplit: 2 / 5,
  viewsSplitStacked: 1 / 2.4,
  sidebarWidth: 330,
};

/**
 * The breakpoints in `styles.css` where the Both view stacks and where the
 * sidebar moves under the editor. They are here as well as there because the
 * splitters have to know which axis they are dividing.
 */
export const VIEWS_STACKED_QUERY = '(max-width: 1000px)';
export const SIDEBAR_STACKED_QUERY = '(max-width: 720px)';

/** Floors, in px, for what a pane is still usable at. */
export const MIN_MAP_PX = 200;
/** Gutters plus a few columns of bases; the view itself fits 10 to a row. */
export const MIN_SEQUENCE_PX = 260;
/** The same floor stacked, where the sequence view is divided by height. */
export const MIN_SEQUENCE_HEIGHT_PX = 160;
export const MIN_SIDEBAR_PX = 240;
export const MIN_EDITOR_PX = 360;

export function clampFraction(f: number): number {
  if (!Number.isFinite(f)) return DEFAULT_LAYOUT.viewsSplit;
  return Math.min(0.95, Math.max(0.05, f));
}

export function clampSidebarWidth(px: number): number {
  if (!Number.isFinite(px)) return DEFAULT_LAYOUT.sidebarWidth;
  return Math.min(900, Math.max(MIN_SIDEBAR_PX, Math.round(px)));
}

/** Sanity-checks a patch on its way into the store or out of storage. */
export function clampLayout(patch: Partial<LayoutSizes>): Partial<LayoutSizes> {
  const next: { -readonly [K in keyof LayoutSizes]?: LayoutSizes[K] } = {};
  if (patch.viewsSplit !== undefined) next.viewsSplit = clampFraction(patch.viewsSplit);
  if (patch.viewsSplitStacked !== undefined) {
    next.viewsSplitStacked = clampFraction(patch.viewsSplitStacked);
  }
  if (patch.sidebarWidth !== undefined) next.sidebarWidth = clampSidebarWidth(patch.sidebarWidth);
  return next;
}
