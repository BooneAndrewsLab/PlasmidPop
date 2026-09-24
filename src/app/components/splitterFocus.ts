/** What had the keyboard before `focusNextSplitter` took it, for Escape to give it back. */
let focusedBefore: HTMLElement | null = null;

/**
 * Moves the keyboard to the next boundary on screen, from wherever it is
 * (Alt+B, #36), where the arrow keys move it; Escape goes back. Returns
 * whether there was one.
 */
export function focusNextSplitter(): boolean {
  const all = [...document.querySelectorAll<HTMLElement>('.splitter')];
  if (all.length === 0) return false;
  const active = document.activeElement;
  const at = all.findIndex((el) => el === active);
  if (at < 0) focusedBefore = active instanceof HTMLElement ? active : null;
  all[(at + 1) % all.length]?.focus();
  return true;
}

/** Escape on a boundary: back to what had the keyboard before Alt+B, or nowhere. */
export function returnFocus(from: HTMLElement): void {
  const to = focusedBefore;
  focusedBefore = null;
  if (to !== null && to.isConnected && to !== from) to.focus();
  else from.blur();
}
