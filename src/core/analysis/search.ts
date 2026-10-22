import { type Strand } from '../features';
import { type Range, type Topology } from '../range';
import { reverseComplement } from '../sequence';
import { IUPAC_SETS } from './codons';

const BASE_BITS: Readonly<Record<string, number>> = { A: 1, C: 2, G: 4, T: 8 };

export function codeMask(code: string): number {
  let mask = 0;
  // Stryker disable next-line ArrayDeclaration: a fallback holding a non-base string adds no bits, the same as an empty one
  for (const b of IUPAC_SETS[code.toUpperCase()] ?? []) mask |= BASE_BITS[b] ?? 0;
  return mask;
}

/** `codeMask` of every ASCII character, by its code. */
const ASCII_MASKS = Uint8Array.from({ length: 128 }, (_, c) => codeMask(String.fromCharCode(c)));

/**
 * Bitmask per position of the sequence; unknown characters match nothing.
 * ASCII goes through a table: `codeMask` per base was 380 ms of a 4.64 Mb
 * restriction scan, the table 26-29 ms (item 99). Anything else, which a
 * sequence does not hold, takes `codeMask` itself, so the two never differ.
 */
export function sequenceMasks(sequence: string): Uint8Array {
  const out = new Uint8Array(sequence.length);
  for (let i = 0; i < sequence.length; i++) {
    const c = sequence.charCodeAt(i);
    out[i] = c < 128 ? (ASCII_MASKS[c] ?? 0) : codeMask(sequence.charAt(i));
  }
  return out;
}

export function patternMasks(pattern: string): number[] {
  const out: number[] = [];
  for (let i = 0; i < pattern.length; i++) out.push(codeMask(pattern.charAt(i)));
  return out;
}

/**
 * Start positions in `masks` where `pattern` matches: every sequence base
 * must be a subset of the pattern's possibilities, so N in the sequence
 * only matches N in the pattern while N in the pattern matches anything.
 */
export function matchPositions(
  masks: Uint8Array,
  pattern: readonly number[],
  maxStart: number,
): number[] {
  const n = pattern.length;
  if (n > 0 && n <= SHIFT_AND_MAX) return shiftAnd(masks, pattern, maxStart);
  const out: number[] = [];
  // Stryker disable next-line ArithmeticOperator: i - n <= length lets through starts whose bases run off the end, which read as 0 and fail
  outer: for (let i = 0; i <= maxStart && i + n <= masks.length; i++) {
    for (let j = 0; j < n; j++) {
      const s = masks[i + j] ?? 0;
      const p = pattern[j] ?? 0;
      if (s === 0 || (s & ~p) !== 0) continue outer;
    }
    out.push(i);
  }
  return out;
}

/** Longest pattern the bit-parallel matcher takes: one bit per base in a 32-bit int. */
const SHIFT_AND_MAX = 31;

/**
 * `matchPositions` by Shift-And: bit j of `state` says the last j + 1 bases
 * match the pattern's first j + 1, so each base costs one shift and one AND
 * whatever the pattern's length. `accepts[m]` has bit j set when a sequence
 * base with mask m fits pattern position j — the subset rule of
 * `matchPositions`, precomputed for the sixteen masks there are. It is what
 * keeps a REBASE table's ~350 distinct sites cheap (docs/perf-notes.md).
 */
function shiftAnd(masks: Uint8Array, pattern: readonly number[], maxStart: number): number[] {
  const n = pattern.length;
  const accepts = new Int32Array(16);
  for (let m = 1; m < 16; m++) {
    let bits = 0;
    for (let j = 0; j < n; j++) if ((m & ~(pattern[j] ?? 0)) === 0) bits |= 1 << j;
    accepts[m] = bits;
  }
  const last = 1 << (n - 1);
  const end = Math.min(masks.length, maxStart + n);
  const out: number[] = [];
  let state = 0;
  for (let i = 0; i < end; i++) {
    state = ((state << 1) | 1) & (accepts[masks[i] ?? 0] ?? 0);
    if ((state & last) !== 0) out.push(i - n + 1);
  }
  return out;
}

/** Shortest pattern `matchPatterns` indexes; shorter ones get a `matchPositions` pass each. */
const INDEX_MIN = 4;
/** Longest window it indexes: 4^6 = 4,096 buckets. */
const INDEX_MAX = 6;
/** The base a sequence mask spells, A C G T as 0-3; -1 for an ambiguity code or nothing. */
const MASK_BASE = Int8Array.from({ length: 16 }, (_, m) => [1, 2, 4, 8].indexOf(m));

/**
 * `matchPositions` for many patterns in one pass over `masks` (#275): entry
 * p of the result is exactly `matchPositions(masks, patterns[p],
 * maxStarts[p])`, the same starts in the same ascending order.
 *
 * Each pattern is filed under the k-mers of A, C, G and T its most specific
 * window of k positions accepts (k the shortest pattern's length, at most
 * six). Where the sequence's k bases from a position are all plain bases,
 * only the patterns filed under that k-mer can start there (less the
 * window's offset), and each is checked base by base by the subset rule of
 * `matchPositions`. Where an ambiguity code or a non-base falls in that
 * window, every pattern whose window opens with a code that admits the
 * position's base is checked the same way, so ambiguous sequence still
 * matches as it does there. A pattern shorter than four bases, or empty,
 * gets its own `matchPositions` pass.
 *
 * The bundled table's sites at 4.64 Mb: 0.19 s, against 1.12 s for a
 * Shift-And pass per pattern (item 100).
 */
export function matchPatterns(
  masks: Uint8Array,
  patterns: readonly (readonly number[])[],
  maxStarts: readonly number[],
): number[][] {
  const out: number[][] = patterns.map(() => []);
  const indexed: number[] = [];
  patterns.forEach((pattern, p) => {
    // Stryker disable UnaryOperator: every pattern has its maxStart
    if (pattern.length >= INDEX_MIN) indexed.push(p);
    else out[p] = matchPositions(masks, pattern, maxStarts[p] ?? -1);
    // Stryker restore UnaryOperator
  });
  if (indexed.length === 0) return out;
  // Stryker disable next-line OptionalChaining: p comes from indexed, so the pattern is there
  const k = Math.min(INDEX_MAX, ...indexed.map((p) => patterns[p]?.length ?? 0));

  // The window of each pattern: the k positions that admit the fewest k-mers.
  const offsets = new Int32Array(patterns.length);
  // Stryker disable next-line BlockStatement: the window only decides which bucket a pattern waits in, so leaving every offset at 0 is slower, not wrong
  for (const p of indexed) {
    // Stryker disable next-line ArrayDeclaration,LogicalOperator: p comes from indexed; and an empty stand-in leaves the offset at 0, which is slower, not wrong
    const pattern = patterns[p] ?? [];
    let best = Infinity;
    // Stryker disable next-line ConditionalExpression,EqualityOperator,BlockStatement: any window of k positions files the pattern correctly, so choosing another (or none, offset 0) is only slower
    for (let o = 0; o + k <= pattern.length; o++) {
      let count = 1;
      // Stryker disable next-line ConditionalExpression,EqualityOperator,ArithmeticOperator,LogicalOperator,AssignmentOperator: the count only ranks windows, any of which files the pattern correctly
      for (let j = o; j < o + k; j++) count *= popcount(pattern[j] ?? 0);
      // Stryker disable next-line ConditionalExpression,EqualityOperator,BlockStatement: the count only ranks windows, any of which files the pattern correctly
      if (count < best) {
        best = count;
        offsets[p] = o;
      }
    }
  }

  // Buckets of pattern indices by k-mer, as one array with a start per k-mer.
  const buckets = 1 << (2 * k);
  const starts = new Int32Array(buckets + 1);
  // Stryker disable next-line ArrayDeclaration: p comes from indexed, so the pattern is there
  const kmers = indexed.map((p) => windowKmers(patterns[p] ?? [], offsets[p] ?? 0, k));
  for (const list of kmers) for (const code of list) starts[code + 1] = (starts[code + 1] ?? 0) + 1;
  for (let c = 0; c < buckets; c++) starts[c + 1] = (starts[c + 1] ?? 0) + (starts[c] ?? 0);
  const filed = new Int32Array(starts[buckets] ?? 0);
  const fill = starts.slice(0, buckets);
  indexed.forEach((p, i) => {
    // Stryker disable next-line ArrayDeclaration: kmers has an entry for every indexed pattern
    for (const code of kmers[i] ?? []) {
      const at = fill[code] ?? 0;
      filed[at] = p;
      fill[code] = at + 1;
    }
  });
  // For windows holding an ambiguity code: the patterns whose window's first
  // position admits each of the sixteen masks.
  const byMask: number[][] = Array.from({ length: 16 }, (_, m) =>
    // Stryker disable next-line ArrayDeclaration,MethodExpression,OptionalChaining: a wider list is only slower: check turns away a pattern that cannot start there, and a non-index has no pattern and a maxStart of -1
    m === 0 ? [] : indexed.filter((p) => (m & ~(patterns[p]?.[offsets[p] ?? 0] ?? 0)) === 0),
  );

  const length = masks.length;
  const check = (p: number, start: number): void => {
    // Stryker disable next-line ArrayDeclaration: check is only given patterns' indices
    const pattern = patterns[p] ?? [];
    const n = pattern.length;
    // Stryker disable next-line UnaryOperator,ArithmeticOperator: every pattern has its maxStart; and bases past the end read as 0, which fails the loop below
    if (start < 0 || start > (maxStarts[p] ?? -1) || start + n > length) return;
    for (let j = 0; j < n; j++) {
      const s = masks[start + j] ?? 0;
      if (s === 0 || (s & ~(pattern[j] ?? 0)) !== 0) return;
    }
    // Stryker disable next-line OptionalChaining: out has a list for every pattern
    out[p]?.push(start);
  };
  const codeBits = buckets - 1;
  let code = 0;
  // Stryker disable next-line UnaryOperator: starting at 1 sends the first windows the slower, ambiguous way, which finds the same
  let lastAmbiguous = -1;
  for (let j = 0; j < length; j++) {
    // Stryker disable next-line LogicalOperator,UnaryOperator: reading a base as ambiguous only sends its windows the slower way, which finds the same
    const base = MASK_BASE[masks[j] ?? 0] ?? -1;
    if (base < 0) lastAmbiguous = j;
    code = ((code << 2) | (base & 3)) & codeBits;
    const i = j - k + 1;
    if (i < 0) continue;
    if (lastAmbiguous < i) {
      const end = starts[code + 1] ?? 0;
      for (let e = starts[code] ?? 0; e < end; e++) {
        const p = filed[e] ?? 0;
        check(p, i - (offsets[p] ?? 0));
      }
    } else {
      // Stryker disable next-line ArrayDeclaration: byMask has all sixteen masks
      for (const p of byMask[masks[i] ?? 0] ?? []) check(p, i - (offsets[p] ?? 0));
    }
  }
  return out;
}

// Stryker disable next-line BlockStatement: popcount only ranks the windows of matchPatterns, any of which is correct
function popcount(mask: number): number {
  let n = 0;
  // Stryker disable next-line ConditionalExpression,UpdateOperator: popcount only ranks the windows of matchPatterns, any of which is correct
  for (let m = mask; m !== 0; m &= m - 1) n++;
  return n;
}

/** Every k-mer, as 2 bits a base, that positions o..o+k-1 of `pattern` admit. */
function windowKmers(pattern: readonly number[], o: number, k: number): number[] {
  let codes = [0];
  for (let j = o; j < o + k; j++) {
    const mask = pattern[j] ?? 0;
    const next: number[] = [];
    for (const c of codes)
      for (let b = 0; b < 4; b++) if ((mask & (1 << b)) !== 0) next.push((c << 2) | b);
    codes = next;
  }
  return codes;
}

export interface SequenceMatch {
  readonly range: Range;
  readonly strand: Strand;
}

/**
 * Occurrences of an IUPAC pattern in a sequence, on both strands, wrapping
 * the origin on circular molecules. Ranges are forward coordinates,
 * unrolled. A palindromic pattern is reported once per position.
 */
export function findSequenceMatches(
  sequence: string,
  topology: Topology,
  pattern: string,
  options: { readonly bothStrands?: boolean } = {},
): SequenceMatch[] {
  const p = pattern.toUpperCase().replace(/U/g, 'T');
  const L = sequence.length;
  const n = p.length;
  if (n === 0 || L === 0 || n > L || !/^[ACGTRYSWKMBDHVN]+$/.test(p)) return [];
  // Stryker disable next-line MethodExpression: a longer wrap is never read: the last start is L - 1 and the pattern at most L long
  const scan = topology === 'circular' ? sequence + sequence.slice(0, n - 1) : sequence;
  const masks = sequenceMasks(scan);
  // Stryker disable next-line ArithmeticOperator: a start past what scan holds finds nothing: a line's scan ends at L, a circle's at L + n - 1
  const maxStart = topology === 'circular' ? L - 1 : L - n;
  const out: SequenceMatch[] = [];
  const forwardStarts = new Set<number>();
  for (const s of matchPositions(masks, patternMasks(p), maxStart)) {
    out.push({ range: { start: s, end: s + n }, strand: 'forward' });
    forwardStarts.add(s);
  }
  if (options.bothStrands ?? true) {
    // A reverse-strand hit at the same position as a forward hit is the same
    // site read the other way (palindromes, including IUPAC ones): report once.
    for (const s of matchPositions(masks, patternMasks(reverseComplement(p)), maxStart)) {
      if (!forwardStarts.has(s)) out.push({ range: { start: s, end: s + n }, strand: 'reverse' });
    }
  }
  // Stryker disable next-line EqualityOperator,StringLiteral,UnaryOperator: a reverse hit at a forward hit's start was dropped above, so no two hits share a start and the tie-break never runs
  out.sort((a, b) => a.range.start - b.range.start || (a.strand === 'forward' ? -1 : 1));
  return out;
}

/** The residues each amino-acid code of a pattern stands for; any other letter is itself. */
const RESIDUE_SETS: Readonly<Record<string, string>> = {
  B: 'BDN',
  Z: 'ZEQ',
  J: 'JIL',
};

/**
 * Where a residue pattern occurs in a protein (#66): one strand, no
 * wrapping, case ignored. `X` in the pattern is any residue, and B, Z and J
 * the two each stands for, as well as themselves.
 */
export function findResidueMatches(sequence: string, pattern: string): Range[] {
  const p = pattern.toUpperCase();
  const s = sequence.toUpperCase();
  const n = p.length;
  if (n === 0 || n > s.length || !/^[A-Z*]+$/.test(p)) return [];
  const out: Range[] = [];
  for (let start = 0; start + n <= s.length; start++) {
    let hit = true;
    for (let i = 0; i < n && hit; i++) {
      const want = p.charAt(i);
      const got = s.charAt(start + i);
      hit = want === 'X' || want === got || (RESIDUE_SETS[want]?.includes(got) ?? false);
    }
    if (hit) out.push({ start, end: start + n });
  }
  return out;
}

/** Whether text can be a nucleotide search pattern (IUPAC codes only). */
export function looksLikeSequence(text: string): boolean {
  return /^[ACGTURYSWKMBDHVN]+$/i.test(text.trim());
}
