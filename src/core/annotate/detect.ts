import { type Strand } from '../features';
import { type Range, type Topology, rangePieces } from '../range';
import { alignNearDiagonal, bandCells } from './gapped';
import { type FeatureLibrary } from './library';
import { detectHomologues } from './homologue';
import { detectProteinFeatures } from './protein';

/**
 * Finding the library's parts in a sequence (item 59): on both strands,
 * exactly or with a few substitutions or small indels, through the origin of
 * a circle.
 *
 * The parts are indexed once by every 12-mer they contain, on both strands.
 * The sequence is read 12-mer by 12-mer; each word it shares with a part
 * names a diagonal — where the part would start if the word is where it
 * belongs — and each diagonal is checked once, base by base, stopping as soon
 * as it has more mismatches than the part is allowed. A chance word is
 * therefore dismissed after a handful of bases, and a 1 Mb sequence against
 * the whole library takes a fraction of a second (docs/perf-notes.md).
 *
 * The seeding is sure: a part of L bases matched with m mismatches has
 * L + 1 − 12(m + 1) words in common with the sequence (the q-gram lemma), at
 * least one when m < L / 12, so the budget is capped there and a match within
 * it is never missed for want of a seed. Parts shorter than 24 bases must
 * match exactly.
 *
 * Indels (#94, `gapped.ts`): after the scan, wherever a part's seeds gather
 * on a few neighbouring diagonals in the numbers a match within its budget
 * must leave, a banded fill looks for it with up to `MAX_INDEL` bases
 * inserted or deleted, each spending the budget as a mismatch does. The
 * q-gram lemma holds for edits as well as substitutions, so with the budget
 * one lower (`indelBudget`) such a match is sure to leave at least 13 seeds,
 * which a chance word never does.
 *
 * Align's banded seeding (items 45, 46) answers a different question — one
 * long read against one reference, anchors chained along a diagonal — and
 * its index is of the reference; here there are hundreds of short queries and
 * one long target, so the index is of the queries and a diagonal is checked
 * directly rather than chained.
 */

export const SEED = 12;
const SEED_MASK = (1 << (2 * SEED)) - 1;

/** Default least share of a part's bases that must match, 0–1. */
export const DEFAULT_MIN_IDENTITY = 0.95;

/** The identities the Features tab offers to insist on: exact, 98%, 95%, 90%. */
export const MIN_IDENTITY_CHOICES: readonly number[] = [1, 0.98, 0.95, 0.9];

export function isMinIdentityChoice(value: unknown): value is number {
  // Stryker disable next-line ConditionalExpression: equivalent, `includes` on the number list is false for any non-number
  return typeof value === 'number' && MIN_IDENTITY_CHOICES.includes(value);
}

export interface DetectOptions {
  /** Least share of a part's bases that must match, 0–1; `DEFAULT_MIN_IDENTITY` by default. */
  readonly minIdentity?: number;
  readonly onProgress?: (fraction: number) => void;
  /**
   * Whether to look for the parts that carry a protein in the six frames
   * too (#93). On by default; `detectProteinFeatures` is what it runs.
   */
  readonly protein?: boolean;
  /**
   * Whether to look for homologues of the parts with a protein (#219): a
   * gapped, BLOSUM62-scored search of the six translations. On by default,
   * and only when `protein` is.
   */
  readonly homologues?: boolean;
  /**
   * Whether a part may hang off the end of a linear sequence and be offered
   * for the piece that is there (#94). On by default: a fragment cut out of
   * a vector ends in the middle of whatever it ends in, and saying so is
   * more use than saying nothing. A circle has no ends to hang off.
   */
  readonly partialEnds?: boolean;
  /**
   * Whether a part may match with bases inserted or deleted (#94), up to
   * `MAX_INDEL` of them and within the same budget as mismatches. On by
   * default.
   */
  readonly gapped?: boolean;
}

/**
 * Most bases a match may have inserted and deleted in all (#94), which is
 * also the half-width of the band it is looked for in. A part's budget caps
 * it too (`indelBudget`), so a short part gets a narrower band, and one
 * under 36 bases none.
 */
export const MAX_INDEL = 8;

/**
 * How much further than the longest part a circle is read on, for gapped
 * matching: an insertion's worth, and the flank and band that keep a hit
 * starting just past the origin clear of the array's end.
 */
export const GAPPED_OVERHANG = 2 * MAX_INDEL + SEED;

export interface FeatureHit {
  /** Index of the part in the library. */
  readonly part: number;
  /** Where it lies, unrolled: `end` passes the length when it runs over the origin. */
  readonly range: Range;
  readonly strand: Strand;
  /** Bases of the sequence that differ from the part's. */
  readonly mismatches: number;
  /** Ambiguity codes in the sequence (N, R, …) that allow the part's base. */
  readonly ambiguous: number;
  /** Share of the part's bases matched exactly, 0–1. */
  readonly identity: number;
  /**
   * Whether it was found by what it codes for rather than by its bases
   * (#93): then `mismatches` and `identity` are of residues, not bases.
   */
  readonly viaProtein?: boolean;
  /**
   * A homologue (#219): the part's protein was matched with substitutions
   * and gaps, not nearly whole. The hit is "similar to" the part, never the
   * part; `identity` is of the aligned columns, `coverage` the share of the
   * part's protein the alignment spans, and `mismatches` the columns that
   * differ.
   */
  readonly similar?: { readonly coverage: number; readonly bits: number };
  /**
   * That the part runs off the start or the end of a linear sequence (#94),
   * so only the piece inside it was matched. The feature made from it is
   * marked partial there, as GenBank's `<`/`>` mean.
   */
  readonly partialStart?: boolean;
  readonly partialEnd?: boolean;
  /**
   * Bases of the sequence with no base of the part opposite them, and bases
   * of the part missing from the sequence (#94); absent for a match with
   * substitutions only. Then `identity` is of the alignment's columns.
   */
  readonly insertions?: number;
  readonly deletions?: number;
}

/**
 * Least of a part that must be inside a linear sequence for the piece to be
 * offered (#94): more than two seeds' worth of bases, which do not line up
 * by chance, and a fifth of the part, so a fragment is not annotated with
 * something it holds a sliver of.
 */
export const MIN_PARTIAL_BASES = 30;
export const MIN_PARTIAL_SHARE = 0.2;

/** A–T as bits of a mask, IUPAC codes as the bases they stand for; 0 is not a base. */
const MASKS = (() => {
  const m = new Uint8Array(128);
  const set = (letters: string, mask: number): void => {
    for (const c of letters) {
      m[c.charCodeAt(0)] = mask;
      m[c.toLowerCase().charCodeAt(0)] = mask;
    }
  };
  set('A', 1);
  set('C', 2);
  set('G', 4);
  set('TU', 8);
  set('R', 5);
  set('Y', 10);
  set('S', 6);
  set('W', 9);
  set('K', 12);
  set('M', 3);
  set('B', 14);
  set('D', 13);
  set('H', 11);
  set('V', 7);
  set('N', 15);
  return m;
})();

/** Two bits per definite base; -1 for anything else. */
const BITS = (() => {
  const b = new Int8Array(16).fill(-1);
  b[1] = 0;
  b[2] = 1;
  b[4] = 2;
  b[8] = 3;
  return b;
})();

function masksOf(seq: string): Uint8Array {
  const out = new Uint8Array(seq.length);
  for (let i = 0; i < seq.length; i++) out[i] = MASKS[seq.charCodeAt(i)] ?? 0;
  return out;
}

const COMPLEMENT_MASK = (() => {
  const c = new Uint8Array(16);
  for (let m = 0; m < 16; m++) {
    c[m] = ((m & 1) << 3) | ((m & 2) << 1) | ((m & 4) >> 1) | ((m & 8) >> 3);
  }
  return c;
})();

interface Entry {
  readonly part: number;
  readonly strand: Strand;
  /** The part as it lies on the forward strand of a hit. */
  readonly masks: Uint8Array;
  /** The part is reported only when every base matches (`LibraryPart.exact`). */
  readonly exact: boolean;
}

interface FeatureIndex {
  readonly entries: readonly Entry[];
  /** 12-mer → (entry, offset) pairs, flattened. */
  readonly seeds: ReadonlyMap<number, readonly number[]>;
  /**
   * One bit per possible 12-mer (2 MB), set for those in `seeds`: nearly
   * every word of a sequence is in no part, and a bit says so faster than
   * the map can.
   */
  readonly present: Uint8Array;
  readonly longest: number;
}

/**
 * The most mismatches a part of `length` bases may have: what the identity
 * allows, capped where a seed is still certain.
 */
export function mismatchBudget(length: number, minIdentity: number): number {
  const byIdentity = Math.floor(length * (1 - minIdentity) + 1e-9);
  const bySeed = Math.floor(length / SEED) - 1;
  return Math.max(0, Math.min(byIdentity, bySeed));
}

const indexes = new WeakMap<FeatureLibrary, FeatureIndex>();

function indexFor(library: FeatureLibrary): FeatureIndex {
  const known = indexes.get(library);
  if (known !== undefined) return known;
  const entries: Entry[] = [];
  const seeds = new Map<number, number[]>();
  const present = new Uint8Array((SEED_MASK + 1) >>> 3);
  let longest = 0;
  library.parts.forEach((part, index) => {
    if (part.sequence.length < SEED) return;
    longest = Math.max(longest, part.sequence.length);
    const forward = masksOf(part.sequence);
    const reverse = new Uint8Array(forward.length);
    for (let i = 0; i < forward.length; i++) {
      reverse[forward.length - 1 - i] = COMPLEMENT_MASK[forward[i] ?? 0] ?? 0;
    }
    for (const [strand, masks] of [
      ['forward', forward],
      ['reverse', reverse],
    ] as const) {
      const e = entries.length;
      entries.push({ part: index, strand, masks, exact: part.exact === true });
      forEachSeed(masks, masks.length, (word, at) => {
        present[word >>> 3] = (present[word >>> 3] ?? 0) | (1 << (word & 7));
        const list = seeds.get(word);
        if (list === undefined) seeds.set(word, [e, at]);
        else list.push(e, at);
      });
    }
  });
  const built = { entries, seeds, present, longest };
  indexes.set(library, built);
  return built;
}

/** Calls `visit(word, start)` for each 12-mer of definite bases in `masks[0, end)`. */
function forEachSeed(
  masks: Uint8Array,
  end: number,
  visit: (word: number, start: number) => void,
  onStride?: (at: number) => void,
): void {
  let word = 0;
  let run = 0;
  for (let p = 0; p < end; p++) {
    if (onStride !== undefined && (p & 0xffff) === 0) onStride(p);
    const bits = BITS[masks[p] ?? 0] ?? -1;
    if (bits < 0) {
      run = 0;
      continue;
    }
    word = ((word << 2) | bits) & SEED_MASK;
    if (++run >= SEED) visit(word, p - SEED + 1);
  }
}

/**
 * Every part of the library found in `sequence`, overlapping hits of one kind
 * reduced to the best (see `keepBest`), in order along the sequence.
 */
export function detectFeatures(
  sequence: string,
  topology: Topology,
  library: FeatureLibrary,
  options: DetectOptions = {},
): FeatureHit[] {
  const minIdentity = options.minIdentity ?? DEFAULT_MIN_IDENTITY;
  const index = indexFor(library);
  // An exact part (#94 follow-up) has no budget at any identity: a mismatch,
  // an ambiguity code in the sequence and an indel all rule it out.
  const budgets = index.entries.map((e) =>
    e.exact ? 0 : mismatchBudget(e.masks.length, minIdentity),
  );
  const n = sequence.length;
  if (n === 0 || index.entries.length === 0) return [];
  const circular = topology === 'circular';
  // A circle is read on past its origin far enough for the longest part
  // (and never so far that a part could cover a base twice), and for a
  // gapped one (#94) as far again as an insertion lengthens it and its flank
  // keeps it from the array's end (see `gappedHits`).
  const extra = circular ? Math.min(index.longest - 1 + GAPPED_OVERHANG, n - 1) : 0;
  const target = new Uint8Array(n + extra);
  target.set(masksOf(sequence));
  for (let i = 0; i < extra; i++) target[n + i] = target[i % n] ?? 0;
  const total = target.length;

  const tried = new Set<number>();
  // The diagonals a whole part was found on with substitutions only.
  const found = new Set<number>();
  const entryCount = index.entries.length;
  const raw: FeatureHit[] = [];
  // A part may hang off either end of a linear sequence, and then only the
  // piece inside it is compared (#94).
  const partialEnds = options.partialEnds !== false && !circular;
  const limit = circular ? total : n;
  const check = (e: number, start: number): void => {
    const entry = index.entries[e];
    if (entry === undefined) return;
    const len = entry.masks.length;
    // Where the part is inside the sequence: the whole of it, unless it is
    // allowed to run off a linear end.
    const from = Math.max(0, start);
    const to = Math.min(start + len, limit);
    const overlap = to - from;
    const whole = overlap === len && start >= 0;
    if (!whole) {
      // A part cut off by a linear end cannot be shown to match in full.
      if (!partialEnds || entry.exact) return;
      if (overlap < MIN_PARTIAL_BASES || overlap < len * MIN_PARTIAL_SHARE) return;
    }
    if (start >= n || (whole && (len > n || start + len > total))) return;
    const key = start * entryCount + e;
    if (tried.has(key)) return;
    tried.add(key);
    let mismatches = 0;
    let ambiguous = 0;
    // The budget is of the piece compared, so a part half inside is held to
    // the same identity as one wholly inside.
    const budget = whole
      ? (budgets[e] ?? 0)
      : Math.min(budgets[e] ?? 0, Math.floor((overlap / len) * (budgets[e] ?? 0)));
    for (let i = from - start; i < to - start; i++) {
      const t = target[start + i] ?? 0;
      const q = entry.masks[i] ?? 0;
      if (t === q) continue;
      if ((t & q) === 0) mismatches++;
      else ambiguous++;
      if (mismatches + ambiguous > budget) return;
    }
    if (whole) found.add(key);
    raw.push({
      part: entry.part,
      range: { start: from, end: to },
      strand: entry.strand,
      mismatches,
      ambiguous,
      identity: (overlap - mismatches - ambiguous) / overlap,
      // Which end was cut off is a fact about the sequence, not the strand:
      // a reverse-strand part missing its 5' end is missing it at the
      // sequence's far end, and GenBank's `<`/`>` are in sequence order too.
      ...(start < 0 ? { partialStart: true } : {}),
      ...(start + len > to ? { partialEnd: true } : {}),
    });
  };

  // Every seed of a part that may match with indels, as (entry, diagonal),
  // for the gapped pass after the scan (#94).
  const gapped = options.gapped !== false;
  const indelBudgets = index.entries.map((e) =>
    gapped && !e.exact ? indelBudget(e.masks.length, minIdentity) : 0,
  );
  const seeded: number[] = [];

  const onProgress = options.onProgress;
  const seedVisit = (word: number, at: number): void => {
    // Stryker disable next-line all: performance only, the present-seeds bitmap skips a lookup that would find no list
    if (((index.present[word >>> 3] ?? 0) & (1 << (word & 7))) === 0) return;
    const list = index.seeds.get(word);
    // Stryker disable next-line all: performance only, a seed with no list has nothing to visit
    if (list === undefined) return;
    // Stryker disable next-line all: equivalent, the lists hold (entry, start) pairs so the bound is only ever hit on an even length
    for (let k = 0; k + 1 < list.length; k += 2) {
      const e = list[k] ?? 0;
      const start = at - (list[k + 1] ?? 0);
      check(e, start);
      // Stryker disable next-line all: performance only, seeds of a part with no indel budget are not offered to the gapped pass
      if ((indelBudgets[e] ?? 0) > 0) seeded.push(e, start);
    }
  };
  forEachSeed(
    target,
    total,
    seedVisit,
    onProgress === undefined
      ? undefined
      : (at) => {
          onProgress(at / total);
        },
  );
  // Stryker disable next-line all: performance only, the gapped pass has nothing to do without seeds
  if (seeded.length > 0) {
    const onFoundDiagonal = (e: number, start: number): boolean =>
      found.has(start * entryCount + e);
    raw.push(...gappedHits(index, target, n, limit, seeded, indelBudgets, onFoundDiagonal));
  }
  // The parts that are looked for by what they code for (#93): the short
  // tags no record spells in DNA, and the proteins a construct carries with
  // synonymous changes. Their hits join the rest and are reduced with them,
  // so a part found both ways is offered once.
  const dna = substitutionsFirst(raw, n, topology);
  const withProtein =
    options.protein === false
      ? dna
      : [...dna, ...detectProteinFeatures(sequence, topology, library)];
  const kept = keepBest(withProtein, library, n, topology);
  if (options.protein === false || options.homologues === false) return kept;
  return withHomologues(kept, detectHomologues(sequence, topology, library), library, n, topology);
}

/**
 * Homologue hits (#219) beside the ones that are the parts themselves: a
 * "similar to" is dropped where a part of the same type was already found
 * over at least half of it (the part is the better answer), and the rest
 * are reduced among themselves, the better score winning where two parts
 * are similar to the same bases.
 */
function withHomologues(
  kept: readonly FeatureHit[],
  similar: readonly FeatureHit[],
  library: FeatureLibrary,
  length: number,
  topology: Topology,
): FeatureHit[] {
  const bySimilar = [...similar].sort(
    (x, y) => (y.similar?.bits ?? 0) - (x.similar?.bits ?? 0) || x.part - y.part,
  );
  const out: FeatureHit[] = [];
  for (const h of bySimilar) {
    const type = library.parts[h.part]?.type;
    const size = h.range.end - h.range.start;
    const covered = (k: FeatureHit): boolean =>
      library.parts[k.part]?.type === type &&
      overlapLength(k.range, h.range, length, topology) >= 0.5 * size;
    if (kept.some(covered) || out.some(covered)) continue;
    out.push(h);
  }
  return [...kept, ...out].sort(
    (x, y) =>
      x.range.start - y.range.start || y.range.end - y.range.start - (x.range.end - x.range.start),
  );
}

/**
 * The most edits a part of `length` bases may have when some are indels
 * (#94): what the identity allows, capped one lower than `mismatchBudget`.
 * The lower cap leaves a match within it sharing at least 13 seeds with the
 * part (the q-gram lemma again: L + 1 − 12(k + 1) of them), all within
 * `MAX_INDEL` diagonals of each other, so the gapped pass only looks where
 * that many have gathered — which a chance word never does. At the default
 * 95% the identity binds first for any part over 60 bases, and the cap
 * changes nothing; parts under 36 bases match without indels.
 */
export function indelBudget(length: number, minIdentity: number): number {
  const byIdentity = Math.floor(length * (1 - minIdentity) + 1e-9);
  const bySeed = Math.floor(length / SEED) - 2;
  return Math.max(0, Math.min(byIdentity, bySeed));
}

/** Seeds a match of `length` bases with `edits` edits shares with the part, at least. */
export function seedsAtLeast(length: number, edits: number): number {
  return length + 1 - SEED * (edits + 1);
}

/**
 * The gapped pass (#94). The seeds of each entry, in order of diagonal, are
 * swept by a window `MAX_INDEL` (or the entry's budget) diagonals wide; where
 * a window holds as many seeds as a match within the budget must have, a
 * banded fill around its middle looks for the part with indels. A hit with
 * no indel is left to the diagonal check, which has found it already. One
 * copy is often found from several windows (a run of one base seeds every
 * diagonal), so of overlapping readings the one with fewest edits is kept.
 */
function gappedHits(
  index: FeatureIndex,
  target: Uint8Array,
  n: number,
  limit: number,
  seeded: readonly number[],
  budgets: readonly number[],
  onFoundDiagonal: (entry: number, diagonal: number) => boolean,
): FeatureHit[] {
  // (entry, diagonal) as one sortable number; a diagonal can be negative on
  // a linear sequence, by up to the longest part.
  const shift = index.longest;
  const stride = limit + 2 * index.longest + 1;
  const keys = new Float64Array(seeded.length / 2);
  for (let k = 0; k < keys.length; k++) {
    keys[k] = (seeded[2 * k] ?? 0) * stride + (seeded[2 * k + 1] ?? 0) + shift;
  }
  keys.sort();
  const cells = new Uint16Array(bandCells(index.longest, MAX_INDEL));
  const hits: FeatureHit[] = [];
  let from = 0;
  while (from < keys.length) {
    const e = Math.floor((keys[from] ?? 0) / stride);
    let to = from;
    while (to < keys.length && Math.floor((keys[to] ?? 0) / stride) === e) to++;
    const entry = index.entries[e];
    const budget = budgets[e] ?? 0;
    // Stryker disable next-line all: performance only, a part with no budget holds no indel and an entry is always defined
    if (entry !== undefined && budget > 0) {
      const len = entry.masks.length;
      const width = Math.min(budget, MAX_INDEL);
      const need = seedsAtLeast(len, budget);
      const diagonal = (k: number): number => (keys[k] ?? 0) - e * stride - shift;
      // The band last filled: a window inside it has been looked at.
      // Stryker disable next-line all: performance only, the band last filled only spares a repeated fill
      let bandLo = -Infinity;
      let bandHi = -Infinity;
      const readings: FeatureHit[] = [];
      let lo = from;
      // Stryker disable next-line all: performance only, seed windowing
      for (let hi = from; hi < to; hi++) {
        // Stryker disable next-line all: performance only, seed windowing decides where a banded fill is tried, not what it finds
        while (diagonal(hi) - diagonal(lo) > width) lo++;
        // Stryker disable next-line all: performance only, the seed count is a prefilter that a fill which finds nothing would agree with
        if (hi - lo + 1 < need) continue;
        const first = diagonal(lo);
        const last = diagonal(hi);
        // Stryker disable next-line all: performance only, a window inside the band last filled has been looked at
        if (first >= bandLo && last <= bandHi) continue;
        // A copy that substitutions alone explain was found on its own
        // diagonal; an indel is only offered where they cannot.
        let explained = false;
        // Stryker disable next-line all: performance only, a copy substitutions explain is otherwise read again as a gapped hit and dropped for having no gaps
        for (let d = first; d <= last && !explained; d++) explained = onFoundDiagonal(e, d);
        // Stryker disable next-line all: performance only, as above
        if (explained) continue;
        const middle = Math.floor((first + last) / 2);
        // Stryker disable next-line all: performance only, the band last filled only spares a repeated fill
        bandLo = middle - width;
        // Stryker disable next-line all: performance only, the band last filled only spares a repeated fill
        bandHi = middle + width;
        // Stryker disable next-line all: performance only, a reading longer than the sequence is dropped again below
        if (len > n) continue;
        const found = alignNearDiagonal(
          target,
          0,
          limit,
          entry.masks,
          middle,
          width,
          budget,
          cells,
          SEED,
        );
        if (found === null) continue;
        // None is a substitution-only hit, found on its own diagonal; more
        // than the width is past what the band is sure to hold (it reaches
        // `width` either side of a window up to `width` wide).
        const gaps = found.insertions + found.deletions;
        if (gaps === 0 || gaps > width) continue;
        // One turn of a circle at most, starting in the first. A reading
        // starting at the array's start may be a part running in from
        // before it, which the flank rule turns away; the copy a turn on
        // (the overhang is long enough for it) is then the one found, and
        // is moved back a turn.
        if (found.end - found.start > n) continue;
        const turn = found.start >= n ? n : 0;
        const edits = found.mismatches + found.ambiguous + found.insertions + found.deletions;
        readings.push({
          part: entry.part,
          range: { start: found.start - turn, end: found.end - turn },
          strand: entry.strand,
          mismatches: found.mismatches,
          ambiguous: found.ambiguous,
          identity: 1 - edits / (len + found.insertions),
          insertions: found.insertions,
          deletions: found.deletions,
        });
      }
      hits.push(...fewestEdits(readings));
    }
    from = to;
  }
  return hits;
}

/** Readings of one entry, overlapping ones reduced to the one with fewest edits, then first. */
function fewestEdits(readings: readonly FeatureHit[]): FeatureHit[] {
  // Stryker disable all: performance only, `keepBest` keeps one hit of a part over the same bases whichever way these were ordered; reducing them here only spares it the rest, and the order and the overlap test decide only which of equal readings goes first
  const edits = (h: FeatureHit): number =>
    h.mismatches + h.ambiguous + (h.insertions ?? 0) + (h.deletions ?? 0);
  const kept: FeatureHit[] = [];
  const ranked = [...readings].sort(
    (x, y) => edits(x) - edits(y) || x.range.start - y.range.start || x.range.end - y.range.end,
  );
  for (const h of ranked) {
    if (!kept.some((k) => k.range.start < h.range.end && h.range.start < k.range.end)) kept.push(h);
  }
  return kept;
}
// Stryker restore all

/**
 * A gapped hit dropped where a hit of the same part and strand with
 * substitutions only overlaps it (#94): an indel is offered only where
 * substitutions cannot explain the copy within the budget. Near an end of
 * the part both readings can be within it, and `keepBest`, which goes by
 * length first, would otherwise keep whichever the indel made longer.
 */
function substitutionsFirst(
  hits: readonly FeatureHit[],
  length: number,
  topology: Topology,
): FeatureHit[] {
  const isGapped = (h: FeatureHit): boolean => h.insertions !== undefined;
  // Stryker disable next-line all: performance only, the early return spares the filter below, which returns the same hits where none is gapped
  if (!hits.some(isGapped)) return [...hits];
  const whole = hits.filter(
    (h) => !isGapped(h) && h.partialStart !== true && h.partialEnd !== true,
  );
  return hits.filter(
    (h) =>
      !isGapped(h) ||
      !whole.some(
        (u) =>
          u.part === h.part &&
          u.strand === h.strand &&
          overlapLength(u.range, h.range, length, topology) > 0,
      ),
  );
}

/** Bases two ranges share, either of which may run over the origin of a circle. */
export function overlapLength(a: Range, b: Range, length: number, topology: Topology): number {
  if (topology === 'linear')
    return Math.max(0, Math.min(a.end, b.end) - Math.max(a.start, b.start));
  let shared = 0;
  for (const p of rangePieces(a, length)) {
    for (const q of rangePieces(b, length)) {
      shared += Math.max(0, Math.min(p.end, q.end) - Math.max(p.start, q.start));
    }
  }
  return shared;
}

/**
 * Hits reduced to the ones worth offering. A part found twice over the same
 * bases — a palindrome on both strands, a repetitive part a few bases along —
 * is kept once, where it fits best. And a hit is dropped when another of
 * the same feature type covers at least 90% of it, is at least as long, and
 * matches at least as well — which takes out, in turn:
 *
 * - a close variant of the part that fits better (the pUC origin where
 *   pBR322's matches exactly);
 * - a part inside a longer one (lacZα inside lacZ).
 *
 * Hits of different types never displace each other: a primer site inside a
 * promoter is two features.
 */
function keepBest(
  hits: readonly FeatureHit[],
  library: FeatureLibrary,
  length: number,
  topology: Topology,
): FeatureHit[] {
  const size = (h: FeatureHit): number => h.range.end - h.range.start;
  // A protein hit's mismatches are residues, so its identity is the
  // comparable number: what share of the part was matched.
  const matched = (h: FeatureHit): number => size(h) * h.identity;
  const cut = (h: FeatureHit): boolean => (h.partialStart ?? false) || (h.partialEnd ?? false);
  // Best first: longer, then more of the part matched, then the whole of a
  // part before a piece of one running off an end (#94), then a match on
  // the bases before one on the translation (it is the more exacting),
  // then forward, then library order.
  const ranked = [...hits].sort(
    (x, y) =>
      size(y) - size(x) ||
      matched(y) - matched(x) ||
      Number(cut(x)) - Number(cut(y)) ||
      Number(x.viaProtein ?? false) - Number(y.viaProtein ?? false) ||
      (x.strand === y.strand ? 0 : x.strand === 'forward' ? -1 : 1) ||
      x.part - y.part ||
      x.range.start - y.range.start,
  );
  const kept: FeatureHit[] = [];
  for (const h of ranked) {
    // Stryker disable next-line OptionalChaining: equivalent, a hit's part is always in the library
    const type = library.parts[h.part]?.type;
    const displaced = kept.some((k) => {
      const shared = overlapLength(k.range, h.range, length, topology);
      if (k.part === h.part) return shared > 0;
      return (
        // Stryker disable next-line OptionalChaining: equivalent, a hit's part is always in the library
        library.parts[k.part]?.type === type && k.identity >= h.identity && shared >= 0.9 * size(h)
      );
    });
    if (!displaced) kept.push(h);
  }
  // Stryker disable next-line ArithmeticOperator: equivalent, `kept` is already longest first, and the sort is stable
  return kept.sort((x, y) => x.range.start - y.range.start || size(y) - size(x));
}
