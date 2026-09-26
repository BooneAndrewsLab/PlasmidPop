/**
 * How residue numbers are shown over the translation lines (#97, item 60):
 * not at all, the first and every tenth residue, or every residue.
 */
export type ResidueNumbering = 'off' | 'tens' | 'every';

export const RESIDUE_NUMBERINGS: readonly ResidueNumbering[] = ['off', 'tens', 'every'];

export const DEFAULT_RESIDUE_NUMBERING: ResidueNumbering = 'tens';

export function isResidueNumbering(v: unknown): v is ResidueNumbering {
  return typeof v === 'string' && (RESIDUE_NUMBERINGS as readonly string[]).includes(v);
}

/** The numbering step a setting asks for: every residue or every tenth; null when off. */
export function residueStep(numbering: ResidueNumbering): number | null {
  return numbering === 'off' ? null : numbering === 'every' ? 1 : 10;
}

/** A number that could be drawn, centred on `x`, `width` wide. */
export interface LabelCandidate {
  readonly x: number;
  readonly width: number;
  /** The first residue or a tenth one: placed before any other. */
  readonly major: boolean;
}

/**
 * Which of a line's numbers are drawn: none may come within `gap` of
 * another, and a number that would is dropped rather than drawn over its
 * neighbour. The major ones (1, 10, 20, …) are placed first, so when every
 * residue is numbered and they are crowded the tens stay and the ones between
 * them go; the rest are then placed left to right in what room is left.
 * Returns a flag per candidate, in the order given.
 */
export function placeLabels(candidates: readonly LabelCandidate[], gap: number): boolean[] {
  const kept = candidates.map(() => false);
  // Kept extents, sorted by left edge; they never overlap, so neither do their right edges.
  const lefts: number[] = [];
  const rights: number[] = [];
  const order = candidates
    .map((_, i) => i)
    .sort((a, b) => {
      const ca = candidates[a];
      const cb = candidates[b];
      if (ca === undefined || cb === undefined) return 0;
      if (ca.major !== cb.major) return ca.major ? -1 : 1;
      return ca.x - cb.x;
    });
  for (const i of order) {
    const c = candidates[i];
    if (c === undefined) continue;
    const left = c.x - c.width / 2;
    const right = c.x + c.width / 2;
    // The first kept extent starting at or after this one's left edge.
    let lo = 0;
    let hi = lefts.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if ((lefts[mid] ?? 0) < left) lo = mid + 1;
      else hi = mid;
    }
    const before = rights[lo - 1];
    const after = lefts[lo];
    if (before !== undefined && before + gap > left) continue;
    if (after !== undefined && right + gap > after) continue;
    lefts.splice(lo, 0, left);
    rights.splice(lo, 0, right);
    kept[i] = true;
  }
  return kept;
}
