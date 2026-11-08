/**
 * The enzymes whose cut sites a view draws: the ticked ones, and whichever
 * the pointer is on in the Enzymes table (#401), ticked or not. The same set
 * back when nothing is highlighted, so a memo keyed on it does not move.
 */
export function withHighlighted(
  shown: ReadonlySet<string>,
  highlighted: ReadonlySet<string>,
): ReadonlySet<string> {
  if (highlighted.size === 0) return shown;
  return new Set([...shown, ...highlighted]);
}
