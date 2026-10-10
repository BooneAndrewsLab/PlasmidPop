import { alignInBand } from '../alignment';
import { PROTEIN_CODES, encodeProtein, proteinScoreTable } from '../alignment/scoring';
import { type Topology } from '../range';
import { type FeatureHit } from './detect';
import { type FeatureLibrary, type LibraryPart } from './library';
import { BASE_CODE, NONE, RESIDUE_BITS, codesOf, framesOf } from './protein';

/**
 * Homologues of a part's protein (#219, item 59): a diverged copy of a
 * bundled or user part that the 98% protein match and the DNA match both
 * miss, such as another aminoglycoside phosphotransferase or a β-lactamase
 * variant. Reported as "similar to", never as the part.
 *
 * The method is the one BLAST and pLannotate's DIAMOND search share, built
 * here from scratch (no code is taken from either): seed with short exact
 * words, keep only the words that gather on one diagonal, and align there
 * with a gapped, BLOSUM62-scored local alignment (`alignInBand`, protein
 * alphabet: 11 to open a gap, 1 to extend). Nothing is searched but the
 * parts with a protein, so a 10 kb plasmid against a few hundred proteins is
 * a few thousand words and a handful of alignments (`docs/perf-notes.md`).
 */

/** Residues of an exact word that seed a diagonal. */
export const HOMOLOGUE_SEED = 4;
/**
 * Two words within `TWO_HIT_WINDOW` residues of each other and `BAND` diagonals
 * apart (BLAST's two-hit rule) are what a hit is; words with no partner are
 * not recorded at all, which is most of them in unrelated sequence.
 */
export const TWO_HIT_WINDOW = 48;
/** Recorded words that must fall within `BAND` diagonals of each other before an alignment is tried. */
export const MIN_SEEDS = 2;
export const BAND = 16;
/** Diagonals either side of a cluster that the alignment may wander (gaps). */
export const BAND_WIDTH = 32;
/** Shorter proteins are tags and short peptides, which match exactly or not at all. */
export const MIN_HOMOLOGUE_RESIDUES = 50;

/** Gapped BLOSUM62 (11, 1) statistics, as published by the NCBI. */
const LAMBDA = 0.267;
const K = 0.041;
/** A chance hit this often per search is the most that is shown. */
const MAX_EXPECT = 1e-5;

/** What a homologue of a part must reach, by the class of the part. */
export interface HomologueThreshold {
  /** Identical share of the alignment's columns, 0–1. */
  readonly identity: number;
  /** Share of the part's protein the alignment spans, 0–1. */
  readonly coverage: number;
  /** Bit score. */
  readonly bits: number;
}

/**
 * Thresholds per class of part. A short protein has less to go on, so its
 * floors are higher; fluorescent proteins are a family of close relatives
 * (all one fold), so only a near relative is named; the rest, enzymes,
 * markers, repressors, are allowed to have diverged further.
 */
export function homologueThreshold(
  part: Pick<LibraryPart, 'source'>,
  residues: number,
): HomologueThreshold {
  if (part.source === 'fpbase') return { identity: 0.6, coverage: 0.9, bits: 60 };
  if (residues < 150) return { identity: 0.5, coverage: 0.8, bits: 40 };
  return { identity: 0.35, coverage: 0.7, bits: 50 };
}

const SEED_BITS = RESIDUE_BITS * HOMOLOGUE_SEED;
const SEED_MASK = (1 << SEED_BITS) - 1;

interface Entry {
  readonly part: number;
  readonly letters: string;
  /** The protein as BLOSUM62 rows, for the ungapped check. */
  readonly rows: Uint8Array;
  readonly length: number;
  readonly threshold: HomologueThreshold;
}

/** An entry's offset fits this many bits, so no protein of the library may be longer. */
const OFFSET_BITS = 13;
const OFFSET_RANGE = 1 << OFFSET_BITS;

interface Index {
  readonly entries: readonly Entry[];
  /**
   * Seed word → the (entry, offset) pairs that have it, packed as
   * `entry << OFFSET_BITS | offset`, in `slots[heads[word] .. heads[word + 1])`.
   */
  readonly heads: Int32Array;
  readonly slots: Int32Array;
  readonly longest: number;
}

const indexes = new WeakMap<FeatureLibrary, Index>();

function indexFor(library: FeatureLibrary): Index {
  const known = indexes.get(library);
  if (known !== undefined) return known;
  const entries: Entry[] = [];
  const counts = new Int32Array(SEED_MASK + 2);
  const words: number[] = [];
  let longest = 0;
  library.parts.forEach((part, index) => {
    const protein = part.protein;
    if (
      protein === undefined ||
      protein.length < MIN_HOMOLOGUE_RESIDUES ||
      protein.length >= OFFSET_RANGE
    ) {
      return;
    }
    const e = entries.length;
    entries.push({
      part: index,
      letters: protein,
      rows: encodeProtein(protein),
      length: protein.length,
      threshold: homologueThreshold(part, protein.length),
    });
    longest = Math.max(longest, protein.length);
    const codes = codesOf(protein);
    let word = 0;
    let run = 0;
    for (let p = 0; p < codes.length; p++) {
      const code = codes[p] ?? NONE;
      if (code === NONE) {
        run = 0;
        continue;
      }
      word = ((word << RESIDUE_BITS) | code) & SEED_MASK;
      if (++run < HOMOLOGUE_SEED) continue;
      counts[word + 1] = (counts[word + 1] ?? 0) + 1;
      words.push(word, (e << OFFSET_BITS) | (p - HOMOLOGUE_SEED + 1));
    }
  });
  const heads = counts;
  for (let w = 1; w < heads.length; w++) heads[w] = (heads[w] ?? 0) + (heads[w - 1] ?? 0);
  const slots = new Int32Array(words.length / 2);
  const next = heads.slice(0, SEED_MASK + 1);
  for (let k = 0; k < words.length; k += 2) {
    const w = words[k] ?? 0;
    const at = next[w] ?? 0;
    slots[at] = words[k + 1] ?? 0;
    next[w] = at + 1;
  }
  const built = { entries, heads, slots, longest };
  indexes.set(library, built);
  return built;
}

/** Bit score of a raw BLOSUM62 score (gapped statistics). */
export function bitScore(score: number): number {
  return (LAMBDA * score - Math.log(K)) / Math.LN2;
}

/** Residue codes back to letters; a stop (or anything else) is `*`. */
function lettersOf(codes: Uint8Array, from: number, to: number): string {
  let out = '';
  for (let i = from; i < to; i++) {
    const c = codes[i] ?? NONE;
    out += c === NONE ? '*' : String.fromCharCode(65 + c);
  }
  return out;
}

/**
 * Least score of an ungapped stretch on one of a cluster's diagonals before
 * the gapped alignment is tried (the way BLAST's two-hit method extends only
 * a pair of words that an ungapped extension confirms). About 18 bits: a
 * diverged homologue has a stretch like this between its gaps, while the
 * words of unrelated sequence that happen to share a band almost never do.
 */
export const UNGAPPED_TRIGGER = 45;

const SCORES = proteinScoreTable(1);
/** Frame residue code (0–25 for A–Z, `NONE` for a stop) to a BLOSUM62 row. */
const FRAME_ROWS = (() => {
  const rows = new Uint8Array(32).fill(PROTEIN_CODES - 1);
  const letters = encodeProtein('ABCDEFGHIJKLMNOPQRSTUVWXYZ');
  for (let i = 0; i < 26; i++) rows[i] = letters[i] ?? PROTEIN_CODES - 1;
  return rows;
})();

/** How far below its best an ungapped extension may fall before it stops. */
const XDROP = 20;

function pairScore(rows: Uint8Array, codes: Uint8Array, i: number, at: number): number {
  const frameRow = FRAME_ROWS[codes[at] ?? NONE] ?? PROTEIN_CODES - 1;
  return SCORES[(rows[i] ?? 0) * PROTEIN_CODES + frameRow] ?? 0;
}

/**
 * The score of the ungapped stretch through a seed: the seed's own words,
 * extended either way along its diagonal until the score has fallen `XDROP`
 * below its best (BLAST's ungapped extension). The cost is the stretch, not
 * the protein, which is what keeps a megabase of unrelated words cheap.
 */
function extend(rows: Uint8Array, codes: Uint8Array, diagonal: number, offset: number): number {
  let seed = 0;
  for (let k = 0; k < HOMOLOGUE_SEED; k++) {
    seed += pairScore(rows, codes, offset + k, offset + k + diagonal);
  }
  let right = 0;
  let run = 0;
  for (let i = offset + HOMOLOGUE_SEED; i < rows.length; i++) {
    const at = i + diagonal;
    if (at >= codes.length) break;
    run += pairScore(rows, codes, i, at);
    if (run > right) right = run;
    else if (run < right - XDROP) break;
  }
  let left = 0;
  run = 0;
  for (let i = offset - 1; i >= 0; i--) {
    const at = i + diagonal;
    if (at < 0) break;
    run += pairScore(rows, codes, i, at);
    if (run > left) left = run;
    else if (run < left - XDROP) break;
  }
  return seed + right + left;
}

/** Diagonals are grouped in bands of this many (a power of two) for the two-hit table. */
const BAND_SHIFT = 4;
/** Slots of the two-hit table (a power of two, matching the hash's shift). */
const TABLE = 1 << 12;
const tableBand = new Float64Array(TABLE);
const tableKey = new Float64Array(TABLE);
const tableAt = new Int32Array(TABLE);
const tableRecorded = new Uint8Array(TABLE);

/** `values[at] = value`, growing the array when it is full; returns the array. */
function record(values: Float64Array, at: number, value: number): Float64Array {
  let out = values;
  if (at >= out.length) {
    out = new Float64Array(out.length * 2);
    out.set(values);
  }
  out[at] = value;
  return out;
}

/** A seed hit is the number `(entry · 2^24 + diagonal + bias) · 2^13 + offset`, which sorts by entry, diagonal, offset. */
const DIAGONAL_BIAS = 1 << 22;
const DIAGONAL_RANGE = 1 << 24;

/**
 * Every part with a protein of at least `MIN_HOMOLOGUE_RESIDUES` that has a
 * homologue in `sequence`, as ranges on the forward strand. Each hit has
 * `similar` set. A hit this near to the part itself is also found by the
 * protein match, which `detectFeatures` prefers.
 */
export function detectHomologues(
  sequence: string,
  topology: Topology,
  library: FeatureLibrary,
): FeatureHit[] {
  const index = indexFor(library);
  const n = sequence.length;
  if (n < 3 * MIN_HOMOLOGUE_RESIDUES || index.entries.length === 0) return [];
  const extra = topology === 'circular' ? Math.min(index.longest * 3, Math.max(0, n - 1)) : 0;
  const total = n + extra;
  const bases = new Uint8Array(total);
  for (let i = 0; i < n; i++) bases[i] = BASE_CODE[sequence.charCodeAt(i)] ?? 4;
  for (let i = 0; i < extra; i++) bases[n + i] = bases[i % n] ?? 4;
  // Six frames: about this many residues are searched, which sets what a
  // score has to be to be unlikely by chance.
  const searched = 2 * total;

  const hits: FeatureHit[] = [];
  for (const frame of framesOf(bases)) {
    const { codes } = frame;
    let found: Float64Array = new Float64Array(1 << 12);
    let count = 0;
    // The last word seen in each (entry, diagonal band), as a direct-mapped
    // table: where it was, and whether it has been recorded yet.
    tableBand.fill(-1);
    let word = 0;
    let run = 0;
    for (let p = 0; p < codes.length; p++) {
      const code = codes[p] ?? NONE;
      if (code === NONE) {
        run = 0;
        continue;
      }
      word = ((word << RESIDUE_BITS) | code) & SEED_MASK;
      if (++run < HOMOLOGUE_SEED) continue;
      const to = index.heads[word + 1] ?? 0;
      const at = p - HOMOLOGUE_SEED + 1;
      for (let k = index.heads[word] ?? 0; k < to; k++) {
        const slot = index.slots[k] ?? 0;
        const e = slot >>> OFFSET_BITS;
        const offset = slot & (OFFSET_RANGE - 1);
        const diagonal = at - offset + DIAGONAL_BIAS;
        const key = (e * DIAGONAL_RANGE + diagonal) * OFFSET_RANGE + offset;
        const band = e * DIAGONAL_RANGE + (diagonal >> BAND_SHIFT);
        const cell =
          (Math.imul(e, 0x9e3779b1) ^ Math.imul(diagonal >> BAND_SHIFT, 0x85ebca6b)) >>> 20;
        if (tableBand[cell] === band && at - (tableAt[cell] ?? 0) <= TWO_HIT_WINDOW) {
          // A word that overlaps the last is the same match, not a second.
          if (at - (tableAt[cell] ?? 0) < HOMOLOGUE_SEED) continue;
          if (tableRecorded[cell] === 0) {
            found = record(found, count++, tableKey[cell] ?? 0);
            tableRecorded[cell] = 1;
          }
          found = record(found, count++, key);
        } else {
          tableBand[cell] = band;
          tableRecorded[cell] = 0;
        }
        tableKey[cell] = key;
        tableAt[cell] = at;
      }
    }
    if (count < MIN_SEEDS) continue;
    const sorted = found.subarray(0, count).sort();
    // The accepted ranges of this frame, per entry, so one locus is aligned once.
    const done = new Map<number, number[]>();
    // A seed hit with its offset removed: (entry, diagonal) as one number.
    const cell = (k: number): number => Math.floor((sorted[k] ?? 0) / OFFSET_RANGE);
    let from = 0;
    while (from < sorted.length) {
      let to = from + 1;
      while (to < sorted.length && cell(to) - cell(to - 1) <= BAND) to++;
      const seeds = to - from;
      const lowest = from;
      from = to;
      if (seeds < MIN_SEEDS) continue;
      const e = Math.floor(cell(lowest) / DIAGONAL_RANGE);
      const entry = index.entries[e];
      if (entry === undefined) continue;
      const diagonalOf = (k: number): number => (cell(k) % DIAGONAL_RANGE) - DIAGONAL_BIAS;
      const first = diagonalOf(lowest);
      const last = diagonalOf(to - 1);
      // Two-hit: the words must gather, and an ungapped stretch through one
      // of them confirm the cluster.
      let confirmed = false;
      for (let k = lowest; k < to && !confirmed; k++) {
        const offset = (sorted[k] ?? 0) % OFFSET_RANGE;
        confirmed = extend(entry.rows, codes, diagonalOf(k), offset) >= UNGAPPED_TRIGGER;
      }
      if (!confirmed) continue;
      const centre = Math.round((first + last) / 2);
      const taken = done.get(e) ?? [];
      if (taken.some((c) => Math.abs(c - centre) < entry.length)) continue;
      // The fill is banded around the cluster's diagonals, wide enough for
      // the gaps a homologue has: a full fill of a 1,000-residue protein
      // against its window is about sixteen times the cells.
      const width = Math.max(BAND_WIDTH, Math.ceil((last - first) / 2) + 16);
      const lo = Math.max(0, centre - width);
      const hi = Math.min(codes.length, centre + entry.length + width);
      if (hi - lo < HOMOLOGUE_SEED) continue;
      const slice = lettersOf(codes, lo, hi);
      const m = hi - lo;
      const band = { lo: new Int32Array(entry.length + 1), hi: new Int32Array(entry.length + 1) };
      for (let i = 0; i <= entry.length; i++) {
        const diagonal = i + centre - lo;
        band.lo[i] = Math.min(m, Math.max(0, diagonal - width));
        band.hi[i] = Math.min(m, Math.max(0, diagonal + width));
      }
      const result = alignInBand(entry.letters, slice, band, {
        mode: 'local',
        alphabet: 'protein',
      }).alignment;
      const span = result.endB - result.startB;
      const coverage = (result.endA - result.startA) / entry.length;
      const bits = bitScore(result.score);
      const needed = Math.max(
        entry.threshold.bits,
        Math.log2((entry.length * searched) / MAX_EXPECT),
      );
      if (
        span <= 0 ||
        result.identity < entry.threshold.identity ||
        coverage < entry.threshold.coverage ||
        bits < needed
      ) {
        continue;
      }
      taken.push(centre);
      done.set(e, taken);
      const start = lo + result.startB;
      const at =
        frame.strand === 'forward'
          ? frame.offset + start * 3
          : total - frame.offset - (start + span) * 3;
      if (at < 0 || at + span * 3 > total || at >= n) continue;
      hits.push({
        part: entry.part,
        range: { start: at, end: at + span * 3 },
        strand: frame.strand,
        mismatches: result.columns - result.identities,
        ambiguous: 0,
        identity: result.identity,
        viaProtein: true,
        similar: { coverage, bits },
      });
    }
  }
  return hits;
}
