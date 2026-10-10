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
 */

import { at, sumOfPairs } from './msaFormat';
import { AlignmentTooLargeError, DEFAULT_MAX_CELLS } from './pairwise';
import {
  CODES,
  PROTEIN_CODES,
  encode,
  encodeProtein,
  proteinScoreTable,
  scoreTable,
} from './scoring';

export const MAX_MSA_SEQUENCES = 50;

/** Cells the refinement may fill in all: a few seconds in the worker. */
export const REFINE_CELLS = 300_000_000;
/** Most passes over the tree the refinement makes. */
const REFINE_PASSES = 3;

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

/**
 * 1 − (k-mers shared, counted with multiplicity) / (k-mers of the shorter
 * sequence); 0 for identical sequences, 1 for sequences with none in common.
 */
export function kmerDistances(codes: readonly Uint8Array[], radix: number, k: number): number[][] {
  const size = radix ** k;
  const counts = codes.map((seq) => {
    const c = new Uint16Array(size);
    for (let i = 0; i + k <= seq.length; i++) {
      let h = 0;
      let ok = true;
      for (let t = 0; t < k; t++) {
        const code = seq[i + t] ?? radix;
        // A letter outside the first `radix` codes (an ambiguity code) spoils the word.
        if (code >= radix) ok = false;
        h = h * radix + code;
      }
      if (ok) c[h] = Math.min(65535, (c[h] ?? 0) + 1);
    }
    return c;
  });
  const n = codes.length;
  const d: number[][] = Array.from({ length: n }, () => new Array<number>(n).fill(0));
  for (let a = 0; a < n; a++) {
    for (let b = a + 1; b < n; b++) {
      const ca = counts[a];
      const cb = counts[b];
      const la = Math.max(1, (codes[a]?.length ?? 0) - k + 1);
      const lb = Math.max(1, (codes[b]?.length ?? 0) - k + 1);
      let shared = 0;
      if (ca !== undefined && cb !== undefined) {
        for (let h = 0; h < size; h++) shared += Math.min(ca[h] ?? 0, cb[h] ?? 0);
      }
      const dist = 1 - Math.min(1, shared / Math.min(la, lb));
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
    const next: number[][] = keep.map((r) => keep.map((c) => dist[r]?.[c] ?? 0));
    const row = keep.map(
      (k) =>
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
    if (node.left === null || node.right === null) return;
    for (const child of [node.left, node.right]) {
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
  return node.left === null || node.right === null
    ? String((node.leaf ?? 0) + 1)
    : `(${newick(node.left)},${newick(node.right)})`;
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

/** Aligns two profiles; returns the merged profile. */
function joinProfiles(
  a: Profile,
  b: Profile,
  weights: readonly number[],
  table: Float64Array,
  k: number,
  gapOpen: number,
  gapExtend: number,
  maxCells: number,
): Profile {
  const A = columnsOf(a, weights, k);
  const B = columnsOf(b, weights, k);
  const n = A.length;
  const m = B.length;
  const cells = (n + 1) * (m + 1);
  if (cells > maxCells) throw new AlignmentTooLargeError(cells, maxCells);

  // Per column of B, its score against each symbol: Σ_b f_b S(symbol, b).
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
  // The symbols present in each column of A.
  const present: Int32Array[] = [];
  for (let i = 0; i < n; i++) {
    const list: number[] = [];
    for (let s = 0; s < k; s++) if ((A.freq[i * k + s] ?? 0) !== 0) list.push(s);
    present.push(Int32Array.from(list));
  }

  const trace = new Uint8Array(cells);
  // Traceback, two bits per state: M from (0 M, 1 X, 2 Y); X from (0 M, 1 X); Y from (0 M, 1 Y).
  let prevM = new Float64Array(m + 1).fill(NEG);
  let prevX = new Float64Array(m + 1).fill(NEG);
  let prevY = new Float64Array(m + 1).fill(NEG);
  let curM = new Float64Array(m + 1);
  let curX = new Float64Array(m + 1);
  let curY = new Float64Array(m + 1);
  prevM[0] = 0;
  for (let j = 1; j <= m; j++) {
    // Along the top edge: a gap in A before it starts costs extension only.
    prevY[j] =
      Math.max(prevM[j - 1] ?? NEG, prevY[j - 1] ?? NEG) + gapExtend * openShare(B.gap[j - 1] ?? 0);
    trace[j] = 1 << 4;
  }
  for (let i = 1; i <= n; i++) {
    const fa = openShare(A.gap[i - 1] ?? 0);
    const sym = at(present, i - 1);
    const rowTerminal = i === n;
    curM[0] = NEG;
    curY[0] = NEG;
    curX[0] = Math.max(prevM[0] ?? NEG, prevX[0] ?? NEG) + gapExtend * fa;
    trace[i * (m + 1)] = 1 << 2;
    for (let j = 1; j <= m; j++) {
      const idx = i * (m + 1) + j;
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
  let top = prevM[m] ?? NEG;
  if ((prevX[m] ?? NEG) > top) {
    top = prevX[m] ?? NEG;
    state = 1;
  }
  if ((prevY[m] ?? NEG) > top) state = 2;
  const ops: number[] = []; // 0 both, 1 A only, 2 B only; reversed
  let i = n;
  let j = m;
  while (i > 0 || j > 0) {
    const bits = trace[i * (m + 1) + j] ?? 0;
    if (i === 0) {
      ops.push(2);
      j--;
      continue;
    }
    if (j === 0) {
      ops.push(1);
      i--;
      continue;
    }
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

  const build = (p: Profile, side: 0 | 1): { rows: string[]; codes: Uint8Array[] } => {
    const rows: string[] = [];
    const codes: Uint8Array[] = [];
    p.rows.forEach((row, r) => {
      const src = at(p.codes, r);
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
  return profileOf(
    [...a.members, ...b.members],
    [...ra.rows, ...rb.rows],
    [...ra.codes, ...rb.codes],
  );
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

  const shortest = Math.min(...clean.map((s) => s.length));
  const word = kmerLength(alphabet, shortest);
  const dist = kmerDistances(codes, alphabet === 'protein' ? 20 : 4, word);
  const report = options.onProgress;
  const refining = options.refine !== false && n > 2;

  // One progressive pass along a tree; `from` to `to` is its share of the progress.
  const progressive = (root: TreeNode, weights: readonly number[], from: number, to: number) => {
    let done = 0;
    const run = (node: TreeNode): Profile => {
      if (node.left === null || node.right === null) {
        const i = node.leaf ?? 0;
        return profileOf([i], [at(clean, i)], [at(codes, i)]);
      }
      const l = run(node.left);
      const r = run(node.right);
      const joined = joinProfiles(l, r, weights, table, k, gapOpen, gapExtend, maxCells);
      done++;
      report?.(from + ((to - from) * done) / (n - 1));
      return joined;
    };
    const final = run(root);
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
      weights,
      table,
      k,
      gapOpen,
      gapExtend,
      maxCells,
      alphabet,
      onProgress: (f) => report?.(0.7 + 0.3 * f),
    });
  }
  report?.(1);
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

interface RefineContext {
  readonly weights: readonly number[];
  readonly table: Float64Array;
  readonly k: number;
  readonly gapOpen: number;
  readonly gapExtend: number;
  readonly maxCells: number;
  readonly alphabet: 'nucleotide' | 'protein';
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
    if (node.left === null || node.right === null) return;
    for (const child of [node.left, node.right]) {
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
      const columns = rows[0]?.length ?? 0;
      const keep: number[] = [];
      for (let c = 0; c < columns; c++) {
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
      const cells = (a.rows[0]?.length ?? 0) * (b.rows[0]?.length ?? 0);
      spent += cells;
      if (spent > REFINE_CELLS) return rows;
      let joined: Profile;
      try {
        joined = joinProfiles(
          a,
          b,
          ctx.weights,
          ctx.table,
          ctx.k,
          ctx.gapOpen,
          ctx.gapExtend,
          ctx.maxCells,
        );
      } catch {
        continue;
      }
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
