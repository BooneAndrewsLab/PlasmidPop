/**
 * Zoom in the alignment's large view (#263). A zoom of 1 is the view as it
 * has always drawn, 13 px letters; the column width and the letter size
 * scale with it. Pure, so the arithmetic is tested without a window.
 */

export const ZOOM_MIN = 0.005;
export const ZOOM_MAX = 2;
/** One step of the buttons, the keys and a notch of the wheel. */
export const ZOOM_STEP = 1.25;
/** Below this letter size (px) the bases give way to coloured bars. */
export const LETTER_MIN_FONT = 7;
/** The letter size is not grown past this, whatever the zoom: a row is 20 px high. */
export const LETTER_MAX_FONT = 16;
/** A monospaced glyph is about this wide as a fraction of its font size. */
const GLYPH_WIDTH = 0.6;

export function clampZoom(zoom: number): number {
  if (!Number.isFinite(zoom)) return 1;
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, zoom));
}

/** The zoom one step further in (`steps` > 0) or out (< 0), clamped. */
export function stepZoom(zoom: number, steps: number): number {
  return clampZoom(zoom * ZOOM_STEP ** steps);
}

/** The zoom at which `columns` span `width` px, clamped; 1 for nothing to fit. */
export function fitZoom(columns: number, width: number, baseCharWidth: number): number {
  if (columns <= 0 || width <= 0 || baseCharWidth <= 0) return 1;
  return clampZoom(width / columns / baseCharWidth);
}

/** The letter size at `zoom`, given the size at zoom 1. */
export function letterFont(zoom: number, baseFont: number): number {
  return Math.min(LETTER_MAX_FONT, baseFont * zoom);
}

/** Whether a column `charWidth` px wide has room for a legible letter (else it is a bar). */
export function lettersLegible(charWidth: number): boolean {
  return charWidth >= LETTER_MIN_FONT * GLYPH_WIDTH;
}

/**
 * The scroll offset that keeps the column under `anchor` (px from the left
 * of the columns' area) where it was when the column width goes from `from`
 * to `to`.
 */
export function zoomedScroll(left: number, anchor: number, from: number, to: number): number {
  if (from <= 0 || to <= 0) return Math.max(0, left);
  return Math.max(0, ((left + anchor) / from) * to - anchor);
}

const STEPS = [1, 2, 5];

/**
 * The smallest of 10, 20, 50, 100, 200, 500 … that puts labelled ticks at
 * least `labelWidth + gap` px apart, when a position or a codon is `unit` px
 * wide.
 */
export function rulerStep(unit: number, labelWidth: number, gap = 10): number {
  const need = labelWidth + gap;
  if (!(unit > 0)) return 10;
  for (let decade = 10; ; decade *= 10) {
    for (const s of STEPS) {
      const step = s * decade;
      if (step * unit >= need) return step;
    }
    if (decade > 1e12) return decade;
  }
}

/**
 * The zoom after a wheel event of `deltaY` (Ctrl+wheel, or a trackpad's
 * pinch, which arrives the same way): a mouse notch of 100 is about one step.
 * `mode` is the event's `deltaMode`, 1 meaning lines.
 */
export function wheelZoom(zoom: number, deltaY: number, mode = 0): number {
  const pixels = mode === 1 ? deltaY * 33 : mode === 2 ? deltaY * 400 : deltaY;
  const limited = Math.max(-300, Math.min(300, pixels));
  return clampZoom(zoom * Math.exp((-limited * Math.log(ZOOM_STEP)) / 100));
}
