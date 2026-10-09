/**
 * GC content of a sequence, as a whole, over a range, and as a sliding
 * window along it (item 75).
 *
 * Ambiguity codes are counted for what they could be rather than skipped or
 * guessed: S is a G or a C and counts as GC (as `gcFraction` always has), W
 * as AT; R, Y, K and M are half GC, B and V two thirds, D and H one third;
 * N says nothing and leaves the base out of the denominator. Every weight is
 * a whole number of sixths so the sums are exact integers and a window slid
 * along a megabase accumulates no rounding.
 */

/** Sixths of a base that is G or C, by upper-case letter code; 0 for the rest. */
const GC_SIXTHS = new Uint8Array(128);
/** Sixths a base counts for in the denominator: 6, or 0 for N and for what is not a base. */
const COUNTED_SIXTHS = new Uint8Array(128);

(() => {
  const set = (letters: string, gc: number): void => {
    for (const c of letters) {
      GC_SIXTHS[c.charCodeAt(0)] = gc;
      COUNTED_SIXTHS[c.charCodeAt(0)] = 6;
    }
  };
  set('GCS', 6);
  set('ATUW', 0);
  set('RYKM', 3);
  set('BV', 4);
  set('DH', 2);
})();

function codeOf(sequence: string, i: number): number {
  const c = sequence.charCodeAt(i);
  // Fold lower case onto upper: the letters differ by the 32 bit.
  return c >= 97 && c <= 122 ? c - 32 : c;
}

/** The numerator and denominator, in sixths of a base, of `sequence.slice(start, end)`. */
export function gcCounts(
  sequence: string,
  start = 0,
  end = sequence.length,
): { readonly gc: number; readonly counted: number } {
  let gc = 0;
  let counted = 0;
  for (let i = Math.max(0, start); i < Math.min(sequence.length, end); i++) {
    const c = codeOf(sequence, i);
    if (c >= 128) continue;
    gc += GC_SIXTHS[c] ?? 0;
    counted += COUNTED_SIXTHS[c] ?? 0;
  }
  return { gc, counted };
}

/**
 * The fraction of G and C in `sequence.slice(start, end)`, 0 to 1, or null
 * when no base in it says what it is (empty, or all N).
 */
export function gcContent(sequence: string, start = 0, end = sequence.length): number | null {
  const { gc, counted } = gcCounts(sequence, start, end);
  return counted === 0 ? null : gc / counted;
}

/**
 * The GC content of a range of a circular sequence, which may run past the
 * end and on from the start: `[start, end)` with `end` allowed beyond the
 * length, as the document model has ranges.
 */
export function gcContentOfRange(
  sequence: string,
  start: number,
  end: number,
  circular: boolean,
): number | null {
  if (!circular || end <= sequence.length) return gcContent(sequence, start, end);
  const a = gcCounts(sequence, start, sequence.length);
  const b = gcCounts(sequence, 0, Math.min(end - sequence.length, start));
  const counted = a.counted + b.counted;
  return counted === 0 ? null : (a.gc + b.gc) / counted;
}

/**
 * The GC fraction in a window of `window` bases centred on each base, one
 * value per base, NaN where the window holds no base that says what it is.
 *
 * Linear sequences have no bases beyond the ends: the window there is the
 * part that exists, so the first and last bases are averaged over half a
 * window rather than padded. A circular sequence wraps, so the window across
 * the origin is the same as any other and a window as long as the sequence
 * (or longer) is its whole GC at every base. An even window leans one base to
 * the left of centre, so a window of 1 is the base itself.
 *
 * One pass with running sums: the cost is the length, not the length times
 * the window, and the answer is a `Float32Array` of four bytes a base.
 */
export function gcProfile(sequence: string, window: number, circular: boolean): Float32Array {
  const n = sequence.length;
  const out = new Float32Array(n);
  if (n === 0) return out;
  const w = Math.max(1, Math.floor(window));
  // Prefix sums over the sequence, in sixths; Int32 holds 357 Mb of them.
  const gc = new Int32Array(n + 1);
  const counted = new Int32Array(n + 1);
  for (let i = 0; i < n; i++) {
    const c = codeOf(sequence, i);
    gc[i + 1] = (gc[i] ?? 0) + (c < 128 ? (GC_SIXTHS[c] ?? 0) : 0);
    counted[i + 1] = (counted[i] ?? 0) + (c < 128 ? (COUNTED_SIXTHS[c] ?? 0) : 0);
  }
  const totalGc = gc[n] ?? 0;
  const totalCounted = counted[n] ?? 0;
  const back = Math.floor((w - 1) / 2);
  // The sum over [from, to) with from < to and both within [-n, 2n].
  const sum = (prefix: Int32Array, total: number, from: number, to: number): number => {
    const at = (p: number): number => {
      const laps = Math.floor(p / n);
      return laps * total + (prefix[p - laps * n] ?? 0);
    };
    return at(to) - at(from);
  };
  for (let i = 0; i < n; i++) {
    let from = i - back;
    let to = from + w;
    let g: number;
    let k: number;
    if (circular && w >= n) {
      g = totalGc;
      k = totalCounted;
    } else if (circular) {
      g = sum(gc, totalGc, from, to);
      k = sum(counted, totalCounted, from, to);
    } else {
      from = Math.max(0, from);
      to = Math.min(n, to);
      g = (gc[to] ?? 0) - (gc[from] ?? 0);
      k = (counted[to] ?? 0) - (counted[from] ?? 0);
    }
    out[i] = k === 0 ? Number.NaN : g / k;
  }
  return out;
}

/** The window the sequence view starts with, in bases. */
export const GC_WINDOW_SEQUENCE = 50;

/** The windows the Format menu offers, in bases. */
export const GC_WINDOW_CHOICES = [10, 20, 50, 100, 200, 500, 1000] as const;

/**
 * The window a track uses: the user's choice, or for the map about 1 % of
 * the sequence (at least 10 bases) and for the sequence view 50.
 */
export function gcWindowFor(chosen: number | null, length: number, onMap: boolean): number {
  if (chosen !== null) return chosen;
  return onMap ? Math.max(10, Math.round(length / 100)) : GC_WINDOW_SEQUENCE;
}

/** A GC fraction as the percentage the interface prints, one decimal: "52.3 %". */
export function formatGc(fraction: number): string {
  return `${(fraction * 100).toFixed(1)} %`;
}
