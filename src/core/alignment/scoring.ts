/**
 * Base-pair scores for the aligner, IUPAC ambiguity codes included. The
 * values are EMBOSS's EDNAFULL (NCBI NUC.4.4, Todd Lowe 1992): +5 for a
 * match and −4 for a mismatch between definite bases, and for an ambiguity
 * code about the expected score of the bases it stands for — A against R
 * (A or G) scores +1, A against N −2, N against N −1. Without them an N
 * in a read would be a mismatch against everything and a degenerate base
 * in the document would never match (#47).
 */

/** Row and column order of the matrix below. */
const ORDER = 'ATGCSWRYKMBVHDN';

// prettier-ignore
const NUC44: readonly (readonly number[])[] = [
  //A   T   G   C   S   W   R   Y   K   M   B   V   H   D   N
  [ 5, -4, -4, -4, -4,  1,  1, -4, -4,  1, -4, -1, -1, -1, -2], // A
  [-4,  5, -4, -4, -4,  1, -4,  1,  1, -4, -1, -4, -1, -1, -2], // T
  [-4, -4,  5, -4,  1, -4,  1, -4,  1, -4, -1, -1, -4, -1, -2], // G
  [-4, -4, -4,  5,  1, -4, -4,  1, -4,  1, -1, -1, -1, -4, -2], // C
  [-4, -4,  1,  1, -1, -4, -2, -2, -2, -2, -1, -1, -3, -3, -1], // S
  [ 1,  1, -4, -4, -4, -1, -2, -2, -2, -2, -3, -3, -1, -1, -1], // W
  [ 1, -4,  1, -4, -2, -2, -1, -4, -2, -2, -3, -1, -3, -1, -1], // R
  [-4,  1, -4,  1, -2, -2, -4, -1, -2, -2, -1, -3, -1, -3, -1], // Y
  [-4,  1,  1, -4, -2, -2, -2, -2, -1, -4, -1, -3, -3, -1, -1], // K
  [ 1, -4, -4,  1, -2, -2, -2, -2, -4, -1, -3, -1, -1, -3, -1], // M
  [-4, -1, -1, -1, -1, -3, -3, -1, -1, -3, -1, -2, -2, -2, -1], // B
  [-1, -4, -1, -1, -1, -3, -1, -3, -3, -1, -2, -1, -2, -2, -1], // V
  [-1, -1, -4, -1, -3, -1, -3, -1, -3, -1, -2, -2, -1, -2, -1], // H
  [-1, -1, -1, -4, -3, -1, -1, -3, -1, -3, -2, -2, -2, -1, -1], // D
  [-2, -2, -2, -2, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1], // N
];

/** Code of a character outside the alphabet: a mismatch against everything. */
export const UNKNOWN = ORDER.length;
/** Side of the square score table `scoreTable` returns. */
export const CODES = ORDER.length + 1;

/** Character code (either case) to its row in the matrix; U reads as T. */
const CODE_OF = (() => {
  const table = new Uint8Array(128).fill(UNKNOWN);
  for (let k = 0; k < ORDER.length; k++) {
    table[ORDER.charCodeAt(k)] = k;
    table[ORDER.toLowerCase().charCodeAt(k)] = k;
  }
  table['U'.charCodeAt(0)] = ORDER.indexOf('T');
  table['u'.charCodeAt(0)] = ORDER.indexOf('T');
  return table;
})();

/** The sequence as matrix rows, one byte per base. */
export function encode(seq: string): Uint8Array {
  const out = new Uint8Array(seq.length);
  for (let k = 0; k < seq.length; k++) {
    const c = seq.charCodeAt(k);
    out[k] = c < 128 ? (CODE_OF[c] ?? UNKNOWN) : UNKNOWN;
  }
  return out;
}

/**
 * The CODES × CODES score table, multiplied by `scale`. Definite bases use
 * the caller's match and mismatch; ambiguity codes use EDNAFULL's values,
 * or with `iupac` false only an identical code matches.
 */
export function scoreTable(
  match: number,
  mismatch: number,
  iupac: boolean,
  scale: number,
): Int32Array {
  const table = new Int32Array(CODES * CODES);
  for (let x = 0; x < CODES; x++) {
    for (let y = 0; y < CODES; y++) {
      let s: number;
      if (x === UNKNOWN || y === UNKNOWN) s = mismatch;
      else if (x < 4 && y < 4) s = x === y ? match : mismatch;
      else if (!iupac) s = x === y ? match : mismatch;
      else s = NUC44[x]?.[y] ?? mismatch;
      table[x * CODES + y] = Math.round(s * scale);
    }
  }
  return table;
}

/** Bases each code stands for, as a bit set (A 1, C 2, G 4, T 8). */
const BASES: Readonly<Record<string, number>> = {
  A: 1,
  C: 2,
  G: 4,
  T: 8,
  U: 8,
  R: 5,
  Y: 10,
  S: 6,
  W: 9,
  K: 12,
  M: 3,
  B: 14,
  D: 13,
  H: 11,
  V: 7,
  N: 15,
};

/**
 * How two aligned characters relate: `'|'` the same definite base, `':'`
 * compatible through an ambiguity code (A against R or N), `'.'` a mismatch.
 */
export function pairMark(x: string, y: string): '|' | ':' | '.' {
  const bx = BASES[x.toUpperCase()] ?? 0;
  const by = BASES[y.toUpperCase()] ?? 0;
  if ((bx & by) === 0) return '.';
  const definite = (bx & (bx - 1)) === 0;
  return bx === by && definite ? '|' : ':';
}
