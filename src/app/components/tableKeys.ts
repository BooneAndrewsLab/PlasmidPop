/**
 * Where an arrow key takes the selection among `count` rows, from `at` (or
 * from nowhere), or null for a key that is not one of the table's.
 */
export function nextRowIndex(key: string, at: number | null, count: number): number | null {
  if (count === 0) return null;
  switch (key) {
    case 'ArrowDown':
      return at === null ? 0 : Math.min(count - 1, at + 1);
    case 'ArrowUp':
      return at === null ? count - 1 : Math.max(0, at - 1);
    case 'Home':
      return 0;
    case 'End':
      return count - 1;
    default:
      return null;
  }
}
