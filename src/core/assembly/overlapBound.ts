import { reverseComplement } from '../sequence/alphabet';

/**
 * A cheap, exact test that two reads cannot overlap (item 123, #353).
 *
 * An overlap is an alignment of at least `minOverlap` columns in which the
 * identical definite bases are at least `minIdentity` of the columns. Let one
 * have `m` such columns and `e` others (mismatches, ambiguity matches, gaps),
 * so `e <= m (1 - id) / id` and `m >= ceil(id * minOverlap)`. Score each
 * identical column +1 and every other column `-PENALTY`, whatever kind it is:
 * the alignment scores `m - PENALTY * e >= m (1 - PENALTY (1 - id) / id)`, and
 * so at least that coefficient times the fewest `m` allowed. The best local
 * alignment under those plain costs (one state, no traceback: about a tenth
 * of the work of the affine alignment the assembler uses) scores at least as
 * much as any alignment does, so a pair whose best falls short has no overlap
 * on that strand and cannot pass, whatever the affine alignment finds. Two
 * unrelated 700-base reads reach about 10 where the bar is 18.
 *
 * A pair that clears the bar may still have no overlap; it is aligned as
 * before. The bar needs `id > PENALTY / (1 + PENALTY)`; below that nothing is
 * refused.
 */
const PENALTY = 2;

const CODE = ((): Uint8Array => {
  const t = new Uint8Array(128).fill(4);
  t[65] = 0;
  t[67] = 1;
  t[71] = 2;
  t[84] = 3;
  t[97] = 0;
  t[99] = 1;
  t[103] = 2;
  t[116] = 3;
  return t;
})();

/** Bases as 0 to 3; `other` for anything else, which matches nothing. */
function encode(seq: string, other: number): Uint8Array {
  const out = new Uint8Array(seq.length);
  for (let i = 0; i < seq.length; i++) {
    const c = seq.charCodeAt(i);
    const code = c < 128 ? (CODE[c] ?? 4) : 4;
    out[i] = code === 4 ? other : code;
  }
  return out;
}

/** The best local score over alignments of `a` and `b` with +1, and `-PENALTY` for anything else; stops at `bar`. */
function reaches(a: Uint8Array, b: Uint8Array, bar: number): boolean {
  const m = b.length;
  // One row, updated in place: `h[j]` is the row above's until it is overwritten.
  const h = new Int32Array(m + 1);
  for (const x of a) {
    let diagonal = 0;
    let left = 0;
    for (let j = 1; j <= m; j++) {
      const above = h[j] ?? 0;
      let v = diagonal + (x === b[j - 1] ? 1 : -PENALTY);
      const gap = (above > left ? above : left) - PENALTY;
      if (gap > v) v = gap;
      if (v < 0) v = 0;
      else if (v >= bar) return true;
      h[j] = v;
      diagonal = above;
      left = v;
    }
  }
  return false;
}

/** A read, ready to be compared with many others. */
export class OverlapScreen {
  private readonly forward: Uint8Array;
  private readonly reverse: Uint8Array;

  constructor(sequence: string) {
    // Different codes for the two sides, so that an ambiguity code matches nothing.
    this.forward = encode(sequence, 5);
    this.reverse = encode(reverseComplement(sequence), 5);
  }

  /**
   * False only when `other` provably has no overlap with this read on either
   * strand under `minOverlap` and `minIdentity`.
   */
  mayOverlap(other: string, minOverlap: number, minIdentity: number): boolean {
    if (minIdentity <= PENALTY / (1 + PENALTY) + 1e-9 || minIdentity > 1) return true;
    const fewest = Math.ceil(minIdentity * minOverlap - 1e-9);
    const bar = Math.ceil(fewest * (1 - (PENALTY * (1 - minIdentity)) / minIdentity) - 1e-9);
    if (bar <= 0) return true;
    const mine = encode(other, 4);
    return reaches(mine, this.forward, bar) || reaches(mine, this.reverse, bar);
  }
}
