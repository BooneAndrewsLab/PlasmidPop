/**
 * Multiple sequence alignment of 3 to about 50 nucleotide or protein
 * sequences (#207), by the progressive method Feng and Doolittle (1987) and
 * ClustalW (Thompson, Higgins and Gibson 1994) made standard: a distance
 * between every pair, a guide tree built from the distances, and the
 * sequences joined along the tree, each join the alignment of two profiles.
 * Written from those papers; no other program's code is used.
 *
 * - Distances are k-mer distances, not pairwise alignments: 1 − the share of
 *   k-mers two sequences have in common. That costs a pass over each
 *   sequence instead of an n·m fill per pair, so 50 sequences of 5 kb are
 *   as quick as 50 of 500 bases, and it is what MAFFT and Clustal Omega
 *   do for the same reason.
 * - The guide tree is UPGMA. Its branch lengths give each sequence a weight
 *   (ClustalW's), so a clade of near-identical sequences does not outvote
 *   one distant relative in the profile it is part of.
 * - A profile is the weighted share of each residue in each column. Two
 *   profiles are aligned with the affine-gap dynamic programme the pairwise
 *   aligner uses (EDNAFULL for bases, BLOSUM62 for residues, the same gap
 *   costs), a column pair scoring the weighted average of the substitution
 *   scores of its residues. A gap costs less opposite a column that is
 *   mostly gaps already (`openShare`), and a gap at either end of the
 *   alignment pays to extend but not to open, so a fragment is not
 *   penalised for being a fragment.
 * - Gaps once opened stay, the usual weakness of the progressive method, so
 *   the result is refined: each branch of the tree in turn splits the
 *   alignment in two, the two halves are aligned again as profiles, and the
 *   new alignment is kept when its sum-of-pairs score is higher (Gotoh 1996;
 *   the "tree-dependent restricted partitioning" of MUSCLE and MAFFT). A
 *   work budget bounds it, so a long alignment is refined less, not slowly.
 * - A join of long, similar profiles is filled along a band (#372): one
 *   about the words their consensus shares, as `banded.ts` does for a pair,
 *   then the diagonals a path as good could reach, which hold the full
 *   fill's own path. The same alignment, from a few percent of the cells.
 */

import { bandAround, chainAnchors, dropStrays } from './banded';
import { at, sumOfPairs } from './msaFormat';
import { AlignmentTooLargeError, type Band, DEFAULT_MAX_CELLS, bandCells } from './pairwise';
import {
  CODES,
  PROTEIN_CODES,
  encode,
  encodeProtein,
  proteinScoreTable,
  scoreTable,
} from './scoring';

export const MAX_MSA_SEQUENCES = 50;

/** Cells the refinement may fill in all, counted as filled: a few seconds in the worker. */
export const REFINE_CELLS = 300_000_000;
/** Most passes over the tree the refinement makes. */
const REFINE_PASSES = 3;
/** A join with more cells than this is tried along a band first (#372): about 1 kb by 1 kb. */
export const BAND_ABOVE = 1_000_000;

export interface MsaOptions {
  readonly alphabet?: 'nucleotide' | 'protein';
  /** Score of the first position of a gap (default −10 for bases, −11 for residues). */
  readonly gapOpen?: number;
  /** Score of each further position (default −0.5 for bases, −1 for residues). */
  readonly gapExtend?: number;
  /** Refuse a join whose (n+1)(m+1) exceeds this (default `DEFAULT_MAX_CELLS`). */
  readonly maxCells?: number;
  /** Refine the progressive result (default true). */
  readonly refine?: boolean;
  /** Try a band first for a join of more cells than this (default `BAND_ABOVE`; 0 always, Infinity never). */
  readonly bandAbove?: number;
  /** After each join, the cells filled for it and the cells of its full matrix. */
  readonly onJoin?: (filled: number, full: number) => void;
  readonly onProgress?: (fraction: number) => void;
}

export interface MultipleAlignment {
  readonly alphabet: 'nucleotide' | 'protein';
  /** Aligned sequences with '-' for gaps, in the order of the input, all of one length. */
  readonly rows: readonly string[];
  readonly columns: number;
  /** The guide tree as nested input indices, for the record. */
  readonly tree: string;
}

/** The k of the k-mer distance: long enough to be specific, short enough that homologs share some. */
export function kmerLength(alphabet: 'nucleotide' | 'protein', shortest: number): number {
  if (alphabet === 'protein') return shortest < 30 ? 1 : 2;
  return shortest < 40 ? 3 : shortest < 200 ? 5 : 6;
}

function sameCodes(a: Uint8Array | undefined, b: Uint8Array | undefined): boolean {
  // Stryker disable next-line OptionalChaining: both are `codes[x]` with `x < n`, never undefined; the chain only satisfies the type checker
  if (a?.length !== b?.length) return false;
  // Stryker disable next-line OptionalChaining: the same two arrays as above, indexed within their equal lengths
  for (let i = 0; i < (a?.length ?? 0); i++) if (a?.[i] !== b?.[i]) return false;
  return true;
}

/**
 * 1 − (k-mers shared, counted with multiplicity) / (k-mers of the shorter
 * sequence), where only k-mers free of ambiguity codes count, on both sides; 0 for identical sequences, 1 for sequences with none in common.
 */
export function kmerDistances(codes: readonly Uint8Array[], radix: number, k: number): number[][] {
  const size = radix ** k;
  const windows: number[] = [];
  const counts = codes.map((seq) => {
    const c = new Uint32Array(size);
    let valid = 0;
    // Stryker disable next-line ArithmeticOperator: `i - k <= length` adds windows past the end, and a code read there is `radix`, which spoils the word, so none is counted
    for (let i = 0; i + k <= seq.length; i++) {
      let h = 0;
      let ok = true;
      for (let t = 0; t < k; t++) {
        const code = seq[i + t] ?? radix;
        // A letter outside the first `radix` codes (an ambiguity code) spoils the word.
        if (code >= radix) ok = false;
        h = h * radix + code;
      }
      if (ok) {
        c[h] = (c[h] ?? 0) + 1;
        valid++;
      }
    }
    windows.push(valid);
    return c;
  });
  const n = codes.length;
  const d: number[][] = Array.from({ length: n }, () => new Array<number>(n).fill(0));
  for (let a = 0; a < n; a++) {
    for (let b = a + 1; b < n; b++) {
      const ca = counts[a];
      const cb = counts[b];
      const la = Math.max(1, windows[a] ?? 0);
      const lb = Math.max(1, windows[b] ?? 0);
      let shared = 0;
      // Stryker disable next-line LogicalOperator: `counts` has an entry for every sequence, so neither is undefined
      if (ca !== undefined && cb !== undefined) {
        for (let h = 0; h < size; h++) shared += Math.min(ca[h] ?? 0, cb[h] ?? 0);
      }
      // With no valid window on either side there is no evidence either way: equal
      // sequences are 0 apart, and any other pair is 1 apart.
      const dist =
        // Stryker disable next-line LogicalOperator: with one side empty `shared` is 0, so the general formula gives 1, as `sameCodes` does for a pair that differs
        windows[a] === 0 && windows[b] === 0
          ? sameCodes(codes[a], codes[b])
            ? 0
            : 1
          : 1 - Math.min(1, shared / Math.min(la, lb));
      at(d, a)[b] = dist;
      at(d, b)[a] = dist;
    }
  }
  return d;
}

export interface TreeNode {
  /** Leaf: the input index. */
  readonly leaf: number | null;
  readonly left: TreeNode | null;
  readonly right: TreeNode | null;
  /** Height above the leaves (half the distance the node joins). */
  readonly height: number;
  readonly members: readonly number[];
}

/** A node's two children, or null for a leaf: a node has both or neither. */
function children(node: TreeNode): readonly [TreeNode, TreeNode] | null {
  // Stryker disable next-line LogicalOperator: a node has both children or neither, so `&&` and `||` agree
  return node.left === null || node.right === null ? null : [node.left, node.right];
}

/** UPGMA over a distance matrix: the closest pair joined first, ties to the lowest indices. */
export function upgma(d: readonly (readonly number[])[]): TreeNode {
  let nodes: TreeNode[] = d.map((_, i) => ({
    leaf: i,
    left: null,
    right: null,
    height: 0,
    members: [i],
  }));
  // Mean distances between the clusters, kept as a matrix over `nodes`.
  let dist = d.map((row) => [...row]);
  while (nodes.length > 1) {
    let bi = 0;
    let bj = 1;
    let best = Infinity;
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        // Stryker disable next-line OptionalChaining: `dist` has a row for every index of `nodes`
        const v = dist[i]?.[j] ?? Infinity;
        if (v < best) {
          best = v;
          bi = i;
          bj = j;
        }
      }
    }
    const a = at(nodes, bi);
    const b = at(nodes, bj);
    const merged: TreeNode = {
      leaf: null,
      left: a,
      right: b,
      height: Math.max(best / 2, a.height, b.height),
      members: [...a.members, ...b.members],
    };
    const keep: number[] = [];
    for (let k = 0; k < nodes.length; k++) if (k !== bi && k !== bj) keep.push(k);
    // Stryker disable next-line OptionalChaining: `keep` indexes rows of `dist`
    const next: number[][] = keep.map((r) => keep.map((c) => dist[r]?.[c] ?? 0));
    const row = keep.map(
      (k) =>
        // Stryker disable next-line OptionalChaining: bi, bj and k all index rows of `dist`
        ((dist[bi]?.[k] ?? 0) * a.members.length + (dist[bj]?.[k] ?? 0) * b.members.length) /
        merged.members.length,
    );
    nodes = [...keep.map((k) => at(nodes, k)), merged];
    dist = next.map((r, i) => [...r, row[i] ?? 0]);
    dist.push([...row, 0]);
  }
  return at(nodes, 0);
}

/** ClustalW's weights: each leaf gets its branch lengths, each shared by the leaves below it. */
export function treeWeights(root: TreeNode, n: number): number[] {
  const w = new Array<number>(n).fill(0);
  const walk = (node: TreeNode): void => {
    const kids = children(node);
    if (kids === null) return;
    for (const child of kids) {
      const branch = Math.max(0, node.height - child.height);
      for (const m of child.members) w[m] = (w[m] ?? 0) + branch / child.members.length;
      walk(child);
    }
  };
  walk(root);
  const total = w.reduce((s, x) => s + x, 0);
  // A tree of identical sequences has no branches: weigh them equally.
  return total <= 1e-12 ? w.map(() => 1 / n) : w.map((x) => x / total);
}

function newick(node: TreeNode): string {
  const kids = children(node);
  return kids === null ? String((node.leaf ?? 0) + 1) : `(${newick(kids[0])},${newick(kids[1])})`;
}

/** A set of rows (input indices) in one column space, with its weights. */
interface Profile {
  readonly members: readonly number[];
  readonly rows: readonly string[]; // aligned strings, '-' for gaps
  readonly codes: readonly Uint8Array[]; // per row, per column: the score-table code, or 255 for a gap
}

const GAP = 255;

function profileOf(
  members: readonly number[],
  rows: readonly string[],
  codes: readonly Uint8Array[],
): Profile {
  return { members, rows, codes };
}

/**
 * Per column: weight of each symbol (`k` of them) and the weight of gaps,
 * the weights summing to one over the profile's members.
 */
function columnsOf(
  p: Profile,
  weights: readonly number[],
  k: number,
): { freq: Float64Array; gap: Float64Array; length: number } {
  // Stryker disable next-line OptionalChaining: a profile has at least one row
  const length = p.rows[0]?.length ?? 0;
  const total = p.members.reduce((s, m) => s + (weights[m] ?? 0), 0) || 1;
  const freq = new Float64Array(length * k);
  const gap = new Float64Array(length);
  p.members.forEach((m, r) => {
    const w = (weights[m] ?? 0) / total;
    const codes = at(p.codes, r);
    for (let c = 0; c < length; c++) {
      const code = codes[c] ?? GAP;
      if (code === GAP) gap[c] = (gap[c] ?? 0) + w;
      else freq[c * k + code] = (freq[c * k + code] ?? 0) + w;
    }
  });
  return { freq, gap, length };
}

const NEG = -1e18;

/**
 * What a gap costs against a column that is `g` gaps already, as a share of
 * the full penalty. Linear in the residues' share would be the expected
 * cost; the square charges a column of mostly gaps almost nothing, which
 * keeps one insertion shared by several sequences from being paid for as
 * if each had made its own. Chosen on the oracle sets (design note 85):
 * on proteins it raised the share of true residue pairs found by 10 points
 * over linear, on bases it was within noise.
 */
const openShare = (g: number): number => (1 - g) * (1 - g);

/** What a join needs besides its two profiles. */
interface JoinContext {
  readonly weights: readonly number[];
  readonly table: Float64Array;
  readonly k: number;
  readonly gapOpen: number;
  readonly gapExtend: number;
  readonly maxCells: number;
  readonly alphabet: 'nucleotide' | 'protein';
  /** A join whose full matrix has more cells than this is tried along a band first. */
  readonly bandAbove: number;
  readonly onJoin: ((filled: number, full: number) => void) | undefined;
}

type Columns = ReturnType<typeof columnsOf>;

/** The two profiles' columns and what a cell of their matrix reads. */
interface Grid {
  readonly A: Columns;
  readonly B: Columns;
  readonly table: Float64Array;
  readonly k: number;
  /** Per column of B, its score against each symbol: Σ_b f_b S(symbol, b). */
  readonly against: Float64Array;
  /** The symbols present in each column of A. */
  readonly present: readonly Int32Array[];
}

function gridOf(a: Profile, b: Profile, ctx: JoinContext): Grid {
  const { table, k } = ctx;
  const A = columnsOf(a, ctx.weights, k);
  const B = columnsOf(b, ctx.weights, k);
  const m = B.length;
  const against = new Float64Array(m * k);
  for (let j = 0; j < m; j++) {
    for (let s = 0; s < k; s++) {
      let v = 0;
      for (let t = 0; t < k; t++) {
        const f = B.freq[j * k + t] ?? 0;
        if (f !== 0) v += f * (table[s * k + t] ?? 0);
      }
      against[j * k + s] = v;
    }
  }
  const present: Int32Array[] = [];
  for (let i = 0; i < A.length; i++) {
    const list: number[] = [];
    for (let s = 0; s < k; s++) if ((A.freq[i * k + s] ?? 0) !== 0) list.push(s);
    present.push(Int32Array.from(list));
  }
  return { A, B, table, k, against, present };
}

/** A path through the matrix: 0 both, 1 A only, 2 B only; its score; the cells filled for it. */
interface Path {
  readonly ops: readonly number[];
  readonly score: number;
  readonly cells: number;
}

/** Every cell of an n by m matrix, as a band. */
function wholeMatrix(n: number, m: number): Band {
  return { lo: new Int32Array(n + 1), hi: new Int32Array(n + 1).fill(m) };
}

/**
 * The best path through the cells of `band` (rows 0 to n, each from lo to hi,
 * both edges never falling; the corners in it), with the same recurrence,
 * order of comparison and traceback as over the whole matrix: a cell
 * outside the band is −∞. Over `wholeMatrix` it is the full fill.
 */
function fillBand(g: Grid, band: Band, gapOpen: number, gapExtend: number): Path {
  const { A, B, against, present, k } = g;
  const n = A.length;
  const m = B.length;
  const { lo, hi } = band;
  // Row i's cells in the traceback start at start[i], for column lo[i].
  const start = new Int32Array(n + 2);
  for (let i = 0; i <= n; i++) start[i + 1] = (start[i] ?? 0) + (hi[i] ?? 0) - (lo[i] ?? 0) + 1;
  const cells = start[n + 1] ?? 0;
  const trace = new Uint8Array(cells);
  // Traceback, two bits per state: M from (0 M, 1 X, 2 Y); X from (0 M, 1 X); Y from (0 M, 1 Y).
  // A column a row never reaches keeps −∞: the edges only rise, so no row
  // reads past its predecessor's end a value written there for an earlier row.
  let prevM = new Float64Array(m + 1).fill(NEG);
  let prevX = new Float64Array(m + 1).fill(NEG);
  let prevY = new Float64Array(m + 1).fill(NEG);
  let curM = new Float64Array(m + 1).fill(NEG);
  let curX = new Float64Array(m + 1).fill(NEG);
  let curY = new Float64Array(m + 1).fill(NEG);
  prevM[0] = 0;
  for (let j = 1; j <= (hi[0] ?? 0); j++) {
    // Along the top edge: a gap in A before it starts costs extension only.
    prevY[j] =
      Math.max(prevM[j - 1] ?? NEG, prevY[j - 1] ?? NEG) + gapExtend * openShare(B.gap[j - 1] ?? 0);
    trace[j] = 1 << 4;
  }
  for (let i = 1; i <= n; i++) {
    const fa = openShare(A.gap[i - 1] ?? 0);
    const sym = at(present, i - 1);
    const rowTerminal = i === n;
    const left = lo[i] ?? 0;
    const right = hi[i] ?? 0;
    const base = (start[i] ?? 0) - left;
    if (left === 0) {
      curM[0] = NEG;
      curY[0] = NEG;
      curX[0] = Math.max(prevM[0] ?? NEG, prevX[0] ?? NEG) + gapExtend * fa;
      trace[base] = 1 << 2;
    } else {
      // The cell left of the band: what this row's first Y, and the next row's first M, read.
      curM[left - 1] = NEG;
      curX[left - 1] = NEG;
      curY[left - 1] = NEG;
    }
    for (let j = Math.max(1, left); j <= right; j++) {
      const idx = base + j;
      // M: diagonal.
      const dm = prevM[j - 1] ?? NEG;
      const dx = prevX[j - 1] ?? NEG;
      const dy = prevY[j - 1] ?? NEG;
      let from = 0;
      let best = dm;
      if (dx > best) {
        best = dx;
        from = 1;
      }
      if (dy > best) {
        best = dy;
        from = 2;
      }
      let s = 0;
      for (let q = 0; q < sym.length; q++) {
        const sy = at(sym, q);
        s += (A.freq[(i - 1) * k + sy] ?? 0) * (against[(j - 1) * k + sy] ?? 0);
      }
      curM[j] = best + s;
      let bits = from;
      // X: A's column against a gap; terminal along the left and right edges.
      const xTerminal = j === m;
      const xOpen = (xTerminal ? gapExtend : gapOpen) * fa;
      const xm = (prevM[j] ?? NEG) + xOpen;
      const xx = (prevX[j] ?? NEG) + gapExtend * fa;
      if (xx > xm) {
        curX[j] = xx;
        bits |= 1 << 2;
      } else curX[j] = xm;
      // Y: B's column against a gap; terminal along the top and bottom edges.
      const fb = openShare(B.gap[j - 1] ?? 0);
      const yOpen = (rowTerminal ? gapExtend : gapOpen) * fb;
      const ym = (curM[j - 1] ?? NEG) + yOpen;
      const yy = (curY[j - 1] ?? NEG) + gapExtend * fb;
      if (yy > ym) {
        curY[j] = yy;
        bits |= 1 << 4;
      } else curY[j] = ym;
      trace[idx] = bits;
    }
    [prevM, curM] = [curM, prevM];
    [prevX, curX] = [curX, prevX];
    [prevY, curY] = [curY, prevY];
  }
  // Traceback from the best state of the last cell.
  let state: 0 | 1 | 2 = 0;
  let score = prevM[m] ?? NEG;
  if ((prevX[m] ?? NEG) > score) {
    score = prevX[m] ?? NEG;
    state = 1;
  }
  if ((prevY[m] ?? NEG) > score) {
    score = prevY[m] ?? NEG;
    state = 2;
  }
  const ops: number[] = []; // reversed
  let i = n;
  let j = m;
  while (i > 0 || j > 0) {
    // Stryker disable next-line BlockStatement: the top-edge trace entries make the general branch push the same 2
    if (i === 0) {
      ops.push(2);
      j--;
      continue;
    }
    // Stryker disable next-line BlockStatement: the left-edge trace entry (bit 2 set) keeps state 1, so the general branch pushes the same 1
    if (j === 0) {
      ops.push(1);
      i--;
      continue;
    }
    const bits = trace[(start[i] ?? 0) + j - (lo[i] ?? 0)] ?? 0;
    if (state === 0) {
      ops.push(0);
      state = (bits & 3) as 0 | 1 | 2;
      i--;
      j--;
    } else if (state === 1) {
      ops.push(1);
      state = ((bits >> 2) & 1) === 1 ? 1 : 0;
      i--;
    } else {
      ops.push(2);
      state = ((bits >> 4) & 1) === 1 ? 2 : 0;
      j--;
    }
  }
  ops.reverse();
  return { ops, score, cells };
}

/** Margin of the first band about the anchors, as `alignBanded` starts with. */
const BAND_MARGIN = 64;
/** A word met more often than this in a profile is a repeat, not an anchor. */
const MAX_OCCURRENCES = 4;
/** The fewest anchors worth banding around. */
const MIN_ANCHORS = 10;

/**
 * Where the two profiles share a word: words of their consensus (the symbol
 * that holds more than half of a column's weight; a column without one, or
 * whose symbol is an ambiguity code, breaks the word), 15 long for bases as
 * in `banded.ts`, 5 for residues; chained and cleaned as there. Null when
 * they share too few to band around.
 */
function profileAnchors(
  g: Grid,
  alphabet: 'nucleotide' | 'protein',
): { i: number; j: number }[] | null {
  const radix = alphabet === 'protein' ? 20 : 4;
  const word = alphabet === 'protein' ? 5 : 15;
  const size = radix ** word;
  const words = (c: Columns, visit: (w: number, start: number) => void): void => {
    let w = 0;
    let run = 0;
    for (let p = 0; p < c.length; p++) {
      let best = -1;
      for (let s = 0; s < radix; s++) if ((c.freq[p * g.k + s] ?? 0) > 0.5) best = s;
      if (best < 0) {
        run = 0;
        continue;
      }
      w = (w * radix + best) % size;
      if (++run >= word) visit(w, p - word + 1);
    }
  };
  const index = new Map<number, number[]>();
  words(g.A, (w, i) => {
    const list = index.get(w);
    if (list === undefined) index.set(w, [i]);
    else if (list.length <= MAX_OCCURRENCES) list.push(i);
  });
  const found: { i: number; j: number }[] = [];
  words(g.B, (w, j) => {
    const list = index.get(w);
    if (list === undefined || list.length > MAX_OCCURRENCES) return;
    for (const i of list) found.push({ i, j });
  });
  const links = dropStrays(chainAnchors(found));
  return links.length >= MIN_ANCHORS ? links : null;
}

/**
 * The diagonals d = i − j a path scoring at least `score` can touch, as a
 * band (design note 85, #372). Each column of A is used once, in a pair or
 * against a gap, and so is each column of B. A pair scores at most half of
 * what its column of A can score against the best column of B, plus half
 * the same for B's; a column against a gap scores at most one extension
 * scaled by its share of residues (`openShare`), as opening costs more.
 * So a path scores at most U, the sum over all columns of the better of
 * the two, less, for each column it puts against a gap, that column's loss
 * ≥ 0. A path from diagonal 0 to n − m that touches d has at least
 * |d| + |d − (n − m)| gap columns, so many of A's and of B's: at least the
 * cheapest that many cost. Diagonals where U less that loss is below
 * `score` hold no such path. A little slack keeps rounding on the safe,
 * wider side.
 */
function reachable(g: Grid, score: number, gapExtend: number): Band {
  const { A, B, table, k } = g;
  const n = A.length;
  const m = B.length;
  // The best each symbol scores against any column of the other profile.
  const bestB = new Float64Array(k).fill(NEG);
  for (let j = 0; j < m; j++) {
    for (let s = 0; s < k; s++) bestB[s] = Math.max(bestB[s] ?? NEG, g.against[j * k + s] ?? NEG);
  }
  const bestA = new Float64Array(k).fill(NEG);
  const row = new Float64Array(k);
  for (let i = 0; i < n; i++) {
    row.fill(0);
    for (const s of at(g.present, i)) {
      const f = A.freq[i * k + s] ?? 0;
      for (let t = 0; t < k; t++) row[t] = (row[t] ?? 0) + f * (table[s * k + t] ?? 0);
    }
    for (let t = 0; t < k; t++) bestA[t] = Math.max(bestA[t] ?? NEG, row[t] ?? 0);
  }
  let upper = 0;
  const losses = (c: Columns, best: Float64Array): Float64Array => {
    const out = new Float64Array(c.length);
    for (let p = 0; p < c.length; p++) {
      let gain = 0;
      for (let s = 0; s < k; s++) {
        const f = c.freq[p * k + s] ?? 0;
        if (f !== 0) gain += f * (best[s] ?? 0);
      }
      const gap = gapExtend * openShare(c.gap[p] ?? 0);
      const keep = Math.max(gain / 2, gap);
      upper += keep;
      out[p] = keep - gap;
    }
    out.sort();
    // Prefix sums: the least `t` gap columns can cost.
    // Stryker disable next-line ArithmeticOperator: one entry fewer is `undefined` in `lossA` or `lossB`, which `?? Infinity` turns into what `fits` already reads past the far diagonals
    const sums = new Float64Array(c.length + 1);
    for (let t = 0; t < c.length; t++) sums[t + 1] = (sums[t] ?? 0) + (out[t] ?? 0);
    return sums;
  };
  const lossA = losses(A, bestB);
  const lossB = losses(B, bestA);
  const slack = 1e-6 * (Math.abs(upper) + Math.abs(score) + 1);
  const shift = n - m;
  const fits = (d: number): boolean => {
    const gaps = Math.abs(d) + Math.abs(d - shift);
    const x = (gaps + shift) / 2;
    const y = (gaps - shift) / 2;
    return upper - (lossA[x] ?? Infinity) - (lossB[y] ?? Infinity) >= score - slack;
  };
  // Stryker disable next-line MethodExpression: `fits` has one value for every diagonal between 0 and n - m and is true for the guess's own path, so the climb from either end reaches the same `high`
  let high = Math.max(0, shift);
  while (high < n && fits(high + 1)) high++;
  // Stryker disable next-line MethodExpression: the same climb, downward
  let low = Math.min(0, shift);
  while (low > -m && fits(low - 1)) low--;
  const lo = new Int32Array(n + 1);
  const hi = new Int32Array(n + 1);
  for (let i = 0; i <= n; i++) {
    lo[i] = Math.max(0, i - high);
    hi[i] = Math.min(m, i - low);
  }
  return { lo, hi };
}

/** Whether every row of `inner` lies within the same row of `outer`. */
function within(inner: Band, outer: Band): boolean {
  for (let i = 0; i < inner.lo.length; i++) {
    if ((inner.lo[i] ?? 0) < (outer.lo[i] ?? 0) || (inner.hi[i] ?? 0) > (outer.hi[i] ?? 0)) {
      return false;
    }
  }
  return true;
}

/**
 * The full fill's path, found along a band (#372), or null when the band
 * cannot be shown to hold it; `cells` counts what was filled either way.
 * A band about the profiles' shared words gives a path and its score; no
 * better path, nor one that ties with it, can leave the diagonals
 * `reachable` gives for that score, so the path filled over them, every
 * cell and choice on it the full fill's own, is the full fill's path. When
 * the first band already holds them its path is that path.
 */
function alongBand(
  g: Grid,
  ctx: JoinContext,
  budget: number,
): { path: Path | null; cells: number } {
  const { gapOpen, gapExtend } = ctx;
  const n = g.A.length;
  const m = g.B.length;
  const full = (n + 1) * (m + 1);
  // The bound needs a gap to cost at least an extension, wherever it opens.
  if (!(gapOpen <= gapExtend && gapExtend <= 0)) return { path: null, cells: 0 };
  const links = profileAnchors(g, ctx.alphabet);
  if (links === null) return { path: null, cells: 0 };
  const first = bandAround(links, n, m, 'global', BAND_MARGIN);
  const firstCells = bandCells(first);
  if (2 * firstCells > full || firstCells > budget) return { path: null, cells: 0 };
  const guess = fillBand(g, first, gapOpen, gapExtend);
  const region = reachable(g, guess.score, gapExtend);
  if (within(region, first)) return { path: guess, cells: guess.cells };
  const regionCells = bandCells(region);
  if (regionCells >= full || guess.cells + regionCells > budget) {
    return { path: null, cells: guess.cells };
  }
  const exact = fillBand(g, region, gapOpen, gapExtend);
  return { path: exact, cells: guess.cells + exact.cells };
}

/** A join's merged profile and the cells filled for it. */
interface Joined {
  readonly joined: Profile;
  readonly cells: number;
}

/**
 * Aligns two profiles; returns the merged profile and the cells filled, or,
 * given a `budget`, null when the join would fill more cells than that.
 */
function joinProfiles(a: Profile, b: Profile, ctx: JoinContext): Joined;
function joinProfiles(a: Profile, b: Profile, ctx: JoinContext, budget: number): Joined | null;
function joinProfiles(a: Profile, b: Profile, ctx: JoinContext, budget = Infinity): Joined | null {
  const g = gridOf(a, b, ctx);
  const n = g.A.length;
  const m = g.B.length;
  const full = (n + 1) * (m + 1);
  if (full > ctx.maxCells) throw new AlignmentTooLargeError(full, ctx.maxCells);
  const tried = full > ctx.bandAbove ? alongBand(g, ctx, budget) : { path: null, cells: 0 };
  let cells = tried.cells;
  let path = tried.path;
  if (path === null) {
    if (cells + full > budget) return null;
    path = fillBand(g, wholeMatrix(n, m), ctx.gapOpen, ctx.gapExtend);
    cells += path.cells;
  }
  ctx.onJoin?.(cells, full);
  const { ops } = path;

  const build = (p: Profile, side: 0 | 1): { rows: string[]; codes: Uint8Array[] } => {
    const rows: string[] = [];
    const codes: Uint8Array[] = [];
    p.rows.forEach((row, r) => {
      const src = at(p.codes, r);
      // Stryker disable next-line ArrayDeclaration: every index 0 to ops.length - 1 is assigned below
      const out = new Array<string>(ops.length);
      const outCodes = new Uint8Array(ops.length);
      let c = 0;
      ops.forEach((op, o) => {
        const has = op === 0 || (side === 0 ? op === 1 : op === 2);
        if (has) {
          out[o] = row.charAt(c);
          outCodes[o] = src[c] ?? GAP;
          c++;
        } else {
          out[o] = '-';
          outCodes[o] = GAP;
        }
      });
      rows.push(out.join(''));
      codes.push(outCodes);
    });
    return { rows, codes };
  };
  const ra = build(a, 0);
  const rb = build(b, 1);
  return {
    joined: profileOf(
      [...a.members, ...b.members],
      [...ra.rows, ...rb.rows],
      [...ra.codes, ...rb.codes],
    ),
    cells,
  };
}

/** The score table as doubles, side `k`. */
function tableOf(alphabet: 'nucleotide' | 'protein'): { table: Float64Array; k: number } {
  if (alphabet === 'protein') {
    return { table: Float64Array.from(proteinScoreTable(1)), k: PROTEIN_CODES };
  }
  return { table: Float64Array.from(scoreTable(5, -4, true, 1)), k: CODES };
}

/**
 * Aligns `sequences` (letters only, no gaps) together. Throws on fewer than
 * two or more than `MAX_MSA_SEQUENCES`, on an empty sequence, and
 * `AlignmentTooLargeError` when a join is too big for the browser.
 */
export function alignMultiple(
  sequences: readonly string[],
  options: MsaOptions = {},
): MultipleAlignment {
  const alphabet = options.alphabet ?? 'nucleotide';
  const n = sequences.length;
  if (n < 2) throw new Error('A multiple alignment needs at least two sequences.');
  if (n > MAX_MSA_SEQUENCES) {
    throw new Error(`A multiple alignment takes at most ${MAX_MSA_SEQUENCES} sequences; got ${n}.`);
  }
  const clean = sequences.map((s) => s.replace(/[^A-Za-z*]/g, '').toUpperCase());
  if (clean.some((s) => s.length === 0)) throw new Error('A sequence is empty.');
  const gapOpen = options.gapOpen ?? (alphabet === 'protein' ? -11 : -10);
  const gapExtend = options.gapExtend ?? (alphabet === 'protein' ? -1 : -0.5);
  const maxCells = options.maxCells ?? DEFAULT_MAX_CELLS;
  const encoder = alphabet === 'protein' ? encodeProtein : encode;
  const codes = clean.map((s) => encoder(s));
  const { table, k } = tableOf(alphabet);
  const join = (weights: readonly number[]): JoinContext => ({
    weights,
    table,
    k,
    gapOpen,
    gapExtend,
    maxCells,
    alphabet,
    bandAbove: options.bandAbove ?? BAND_ABOVE,
    onJoin: options.onJoin,
  });

  const shortest = Math.min(...clean.map((s) => s.length));
  const word = kmerLength(alphabet, shortest);
  const dist = kmerDistances(codes, alphabet === 'protein' ? 20 : 4, word);
  const report = options.onProgress;
  const refining = options.refine !== false && n > 2;

  // One progressive pass along a tree; `from` to `to` is its share of the progress.
  const progressive = (root: TreeNode, weights: readonly number[], from: number, to: number) => {
    let done = 0;
    const ctx = join(weights);
    const run = (node: TreeNode): Profile => {
      const kids = children(node);
      if (kids === null) {
        const i = node.leaf ?? 0;
        return profileOf([i], [at(clean, i)], [at(codes, i)]);
      }
      const l = run(kids[0]);
      const r = run(kids[1]);
      const { joined } = joinProfiles(l, r, ctx);
      done++;
      report?.(from + ((to - from) * done) / (n - 1));
      return joined;
    };
    const final = run(root);
    // Stryker disable next-line ArrayDeclaration,StringLiteral: the starting value is overwritten for every member, and every sequence is a member
    const rows = new Array<string>(n).fill('');
    final.members.forEach((m, r) => {
      rows[m] = at(final.rows, r);
    });
    return rows;
  };

  let root = upgma(dist);
  let weights = treeWeights(root, n);
  let rows = progressive(root, weights, 0, refining ? 0.35 : 1);
  if (refining) {
    // The k-mer tree is a guess; the alignment itself says better who is close to whom.
    const again = upgma(identityDistances(rows));
    const againWeights = treeWeights(again, n);
    const second = progressive(again, againWeights, 0.35, 0.7);
    const score = (r: readonly string[]): number => sumOfPairs(r, alphabet, gapOpen, gapExtend);
    if (score(second) > score(rows)) {
      rows = second;
      root = again;
      weights = againWeights;
    }
    rows = refine(rows, root, (r) => encodeRow(r, encoder), {
      ...join(weights),
      onProgress: (f) => report?.(0.7 + 0.3 * f),
    });
  }
  report?.(1);
  // Stryker disable next-line OptionalChaining: `rows` has one row per sequence, at least two
  return { alphabet, rows, columns: rows[0]?.length ?? 0, tree: newick(root) };
}

/** 1 − identity over the columns where both sequences have a letter: the distances of an alignment. */
export function identityDistances(rows: readonly string[]): number[][] {
  const n = rows.length;
  const d: number[][] = Array.from({ length: n }, () => new Array<number>(n).fill(0));
  for (let a = 0; a < n; a++) {
    for (let b = a + 1; b < n; b++) {
      const ra = at(rows, a);
      const rb = at(rows, b);
      let same = 0;
      let both = 0;
      for (let c = 0; c < ra.length; c++) {
        if (ra[c] === '-' || rb[c] === '-') continue;
        both++;
        if (ra[c] === rb[c]) same++;
      }
      const dist = both === 0 ? 1 : 1 - same / both;
      at(d, a)[b] = dist;
      at(d, b)[a] = dist;
    }
  }
  return d;
}

/** A row's score-table codes, 255 at a gap. */
function encodeRow(row: string, encoder: (s: string) => Uint8Array): Uint8Array {
  const codes = encoder(row.replace(/-/g, 'A'));
  for (let c = 0; c < row.length; c++) if (row.charAt(c) === '-') codes[c] = GAP;
  return codes;
}

interface RefineContext extends JoinContext {
  readonly onProgress: (fraction: number) => void;
}

function refine(
  start: readonly string[],
  root: TreeNode,
  encodeAligned: (row: string) => Uint8Array,
  ctx: RefineContext,
): string[] {
  const n = start.length;
  let rows = [...start];
  let score = sumOfPairs(rows, ctx.alphabet, ctx.gapOpen, ctx.gapExtend);
  // Every branch but the root: the sequences below it against all the others.
  const groups: (readonly number[])[] = [];
  const collect = (node: TreeNode): void => {
    const kids = children(node);
    if (kids === null) return;
    for (const child of kids) {
      groups.push(child.members);
      collect(child);
    }
  };
  collect(root);
  let spent = 0;
  const total = REFINE_PASSES * groups.length;
  let step = 0;
  for (let pass = 0; pass < REFINE_PASSES; pass++) {
    let improved = false;
    for (const group of groups) {
      step++;
      ctx.onProgress(step / total);
      const inGroup = new Set(group);
      const rest = Array.from({ length: n }, (_, i) => i).filter((i) => !inGroup.has(i));
      if (rest.length === 0) continue;
      // Stryker disable next-line OptionalChaining: `rows` has one row per sequence
      const columns = rows[0]?.length ?? 0;
      const keep: number[] = [];
      for (let c = 0; c < columns; c++) {
        // Stryker disable next-line StringLiteral: no column of `rows` is all gaps (a join puts a residue in every column), so keeping every column is the same
        if (rows.some((r) => r.charAt(c) !== '-')) keep.push(c);
      }
      const cut = (members: readonly number[]): Profile => {
        // The columns where some member has a residue; the others are empty in this half.
        const cols: number[] = [];
        for (const c of keep) if (members.some((m) => at(rows, m).charAt(c) !== '-')) cols.push(c);
        const sub = members.map((m) => cols.map((c) => at(rows, m).charAt(c)).join(''));
        return profileOf(members, sub, sub.map(encodeAligned));
      };
      const a = cut(group);
      const b = cut(rest);
      let out: Joined | null;
      try {
        // The cells actually filled count, so a band's join costs what it took (#372).
        out = joinProfiles(a, b, ctx, REFINE_CELLS - spent);
      } catch {
        continue;
      }
      if (out === null) return rows;
      spent += out.cells;
      const { joined } = out;
      // Stryker disable next-line ArrayDeclaration,StringLiteral: the starting value is overwritten for every member, and every sequence is a member
      const candidate = new Array<string>(n).fill('');
      joined.members.forEach((m, r) => {
        candidate[m] = at(joined.rows, r);
      });
      const next = sumOfPairs(candidate, ctx.alphabet, ctx.gapOpen, ctx.gapExtend);
      if (next > score + 1e-9) {
        rows = candidate;
        score = next;
        improved = true;
      }
    }
    if (!improved) break;
  }
  return rows;
}
