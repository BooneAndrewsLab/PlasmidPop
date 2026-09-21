import { type LinearTheme } from '@/view/linear';

/**
 * The sequence view's colours, read from the CSS custom properties in force
 * on `el`, so the canvas follows the stylesheet (and the light/dark theme)
 * rather than carrying a second palette. Shared by the sequence view and the
 * save review, which draws the same rows in a dialog.
 */
export function readLinearTheme(el: HTMLElement): LinearTheme {
  const css = getComputedStyle(el);
  const v = (name: string, fallback: string): string =>
    css.getPropertyValue(name).trim() || fallback;
  return {
    ink: v('--seq-ink', '#1c2430'),
    inkMuted: v('--seq-ink-muted', '#8a94a3'),
    gutterText: v('--seq-gutter', '#8a94a3'),
    rulerLine: v('--seq-rule', '#c8cdd5'),
    selectionFill: v('--seq-selection', 'rgba(27, 110, 140, 0.22)'),
    caret: v('--seq-caret', '#1b6e8c'),
    background: v('--surface', '#ffffff'),
    cutSite: v('--seq-cut', '#b3261e'),
    editInsert: v('--seq-edit-insert', '#1d7a4c'),
    editChange: v('--seq-edit-change', '#a86200'),
    editDelete: v('--seq-edit-delete', '#b3261e'),
    baseColors: {
      a: v('--seq-base-a', '#2f7d32'),
      c: v('--seq-base-c', '#1b6ec8'),
      g: v('--seq-base-g', '#8a5a00'),
      t: v('--seq-base-t', '#c0392b'),
      other: v('--seq-base-other', '#6b7280'),
    },
  };
}
