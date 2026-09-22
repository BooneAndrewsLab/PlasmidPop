import { type CircularTheme } from '@/view/circular';

/**
 * The map's colours, read from the CSS custom properties in force on `el`,
 * so the canvas follows the stylesheet (and the light/dark theme) rather
 * than carrying a second palette. Shared by the circular map and the diff
 * map in the review dialogs, which draw the same ring.
 */
export function readCircularTheme(el: HTMLElement): CircularTheme {
  const css = getComputedStyle(el);
  const v = (name: string, fallback: string): string =>
    css.getPropertyValue(name).trim() || fallback;
  return {
    ink: v('--ink', '#1c2430'),
    inkMuted: v('--ink-3', '#8a94a3'),
    backbone: v('--ink-2', '#4a5566'),
    tick: v('--seq-rule', '#c8cdd5'),
    selectionFill: v('--seq-selection', 'rgba(27, 110, 140, 0.22)'),
    caret: v('--seq-caret', '#1b6e8c'),
    background: v('--surface', '#ffffff'),
    leader: v('--line', '#d5dae2'),
    cutSite: v('--seq-cut', '#b3261e'),
    preview: v('--seq-preview', '#6b4fd8'),
    editInsert: v('--seq-edit-insert', '#1d7a4c'),
    editChange: v('--seq-edit-change', '#a86200'),
    editDelete: v('--seq-edit-delete', '#b3261e'),
  };
}
