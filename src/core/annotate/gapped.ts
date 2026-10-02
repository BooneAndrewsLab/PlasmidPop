/**
 * A part matched with insertions and deletions as well as substitutions
 * (#94): the check a seed gets when its own diagonal has too many
 * mismatches, because an indel between the part's start and the seed has
 * moved the rest of it off that diagonal.
 *
 * It is an edit-distance fill in a band around the seed's diagonal, the idea
 * of item 46's banded alignment cut down to what a seed needs. The whole
 * part is aligned (it is the query), the sequence's ends are free (it is the
 * target), every substitution, ambiguity code and inserted or deleted base
 * costs one, and the fill gives up on the first row whose every cell is
 * already over the budget — which for a chance seed is a few dozen rows.
 *
 * Why not `alignInBand` itself: that one scores reads (affine gaps, a
 * substitution matrix), builds its band from a chain of anchors and
 * allocates per call; here it runs for every seed that fails its diagonal,
 * thousands of times a megabase, and only the count of edits matters, so it
 * works on the masks `detect.ts` already has, in one buffer kept for the
 * whole search.
 */

export interface GappedMatch {
  /** Where the part lies in the target, `[start, end)`. */
  readonly start: number;
  readonly end: number;
  /** Bases of the target that rule out the part's base. */
  readonly mismatches: number;
  /** Ambiguity codes in the target that allow the part's base. */
  readonly ambiguous: number;
  /** Bases of the target with no base of the part opposite them. */
  readonly insertions: number;
  /** Bases of the part missing from the target. */
  readonly deletions: number;
}

/** Cells `alignNearDiagonal` needs for a part of `length` bases and a band of `width`. */
export function bandCells(length: number, width: number): number {
  return (length + 1) * (2 * width + 1);
}

/**
 * The best placement of `part` in `target[lo, hi)` at most `width` bases
 * off `diagonal` (where the part's first base would lie with no indel), with
 * at most `budget` edits, or null when there is none.
 *
 * Bases are the four-bit masks of `detect.ts` (A = 1, C = 2, G = 4, T = 8,
 * codes their union, 0 for anything else); equal masks match. Ties go to
 * the substitution over an indel, and between two ends equally good, to the
 * later one, so a base that differs at the very end of the part is a
 * mismatch rather than a deletion.
 *
 * Near an edge of the target, an alignment with fewer than `flank` paired
 * bases outside its first or last indel is none. Its edge would be a few
 * bases caught by chance after a run of deletions: a part running past the
 * edge read as gapped. At the end of a linear sequence the partial match has
 * it right; at the edge of a circle's array the copy a turn on does. Away
 * from the edges a short flank stands: an indel in a run of one base is
 * placed as early in the run as it can go, however far from the part's end
 * it really was.

 * `cells` must hold `bandCells(part.length, width)` entries; it is scratch,
 * overwritten.
 */
export function alignNearDiagonal(
  target: Uint8Array,
  lo: number,
  hi: number,
  part: Uint8Array,
  diagonal: number,
  width: number,
  budget: number,
  cells: Uint16Array,
  flank: number,
): GappedMatch | null {
  const len = part.length;
  const w = 2 * width + 1;
  const over = budget + 1;
  // Row i, column c is the target position diagonal + i − width + c: the
  // cost of the part's first i bases ending just before it. Row 0 is free:
  // the part may start anywhere in the band.
  const first = diagonal - width;
  for (let c = 0; c < w; c++) {
    const j = first + c;
    cells[c] = j >= lo && j <= hi ? 0 : over;
  }
  for (let i = 1; i <= len; i++) {
    const q = part[i - 1] ?? 0;
    const row = i * w;
    const prev = row - w;
    const base = first + i;
    let best = over;
    for (let c = 0; c < w; c++) {
      const j = base + c;
      let v = over;
      if (j >= lo && j <= hi) {
        // The part's base against the target's, from (i − 1, j − 1).
        if (j > lo) {
          const d = (cells[prev + c] ?? over) + (target[j - 1] === q ? 0 : 1);
          if (d < v) v = d;
        }
        // The part's base deleted, from (i − 1, j).
        if (c + 1 < w) {
          const d = (cells[prev + c + 1] ?? over) + 1;
          if (d < v) v = d;
        }
        // The target's base inserted, from (i, j − 1).
        if (c > 0) {
          const d = (cells[row + c - 1] ?? over) + 1;
          if (d < v) v = d;
        }
      }
      cells[row + c] = v;
      if (v < best) best = v;
    }
    if (best > budget) return null;
  }

  // The best end, the later of two as good.
  const last = len * w;
  let c = 0;
  for (let k = 1; k < w; k++) if ((cells[last + k] ?? over) <= (cells[last + c] ?? over)) c = k;
  if ((cells[last + c] ?? over) > budget) return null;
  const end = first + len + c;
  const endColumn = c;

  // The walk back from the end, an indel placed as early as it can go, or
  // with `gapsFirst` as late as it can once the end has a flank.
  const walk = (gapsFirst: boolean): GappedMatch | null => {
    let c = endColumn;
    let mismatches = 0;
    let ambiguous = 0;
    let insertions = 0;
    let deletions = 0;
    let i = len;
    // Paired columns since the last indel the walk met, and before the
    // first: the alignment's two flanks.
    let run = 0;
    let endFlank = -1;
    const gap = (): void => {
      if (endFlank < 0) endFlank = run;
      run = 0;
    };
    while (i > 0) {
      const row = i * w;
      const prev = row - w;
      const v = cells[row + c] ?? over;
      const j = first + i + c;
      const deleted = c + 1 < w && (cells[prev + c + 1] ?? over) + 1 === v;
      const inserted = c > 0 && (cells[row + c - 1] ?? over) + 1 === v;
      const t = target[j - 1] ?? 0;
      const q = part[i - 1] ?? 0;
      const cost = t === q ? 0 : 1;
      const paired = j > lo && (cells[prev + c] ?? over) + cost === v;
      // Late gaps once the end has its flank: the end is placed as well
      // as the first walk placed it, the start as well as it can be.
      const gapHere = gapsFirst && (deleted || inserted) && (endFlank >= 0 || run >= flank);
      if (paired && !gapHere) {
        if (cost !== 0) {
          if ((t & q) === 0) mismatches++;
          else ambiguous++;
        }
        i--;
        run++;
      } else if (deleted) {
        deletions++;
        i--;
        c++;
        gap();
      } else {
        insertions++;
        c--;
        gap();
      }
    }
    const start = first + c;
    if (endFlank >= 0) {
      const reach = flank + width;
      if (run < flank && start < lo + reach) return null;
      if (endFlank < flank && end > hi - reach) return null;
    }
    return { start, end, mismatches, ambiguous, insertions, deletions };
  };
  // An indel in a run of one base near the start of the target, placed
  // early, would leave too short a flank there; placed late, it may not.
  return walk(false) ?? walk(true);
}
