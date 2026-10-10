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
/** Words that must fall within `BAND` diagonals of each other before an alignment is tried. */
export const MIN_SEEDS = 3;
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

interface Index {
  readonly entries: readonly Entry[];
  readonly seeds: ReadonlyMap<number, readonly number[]>;
  readonly present: Uint8Array;
  readonly longest: number;
}

const indexes = new WeakMap<FeatureLibrary, Index>();

function indexFor(library: FeatureLibrary): Index {
  const known = indexes.get(library);
  if (known !== undefined) return known;
  const entries: Entry[] = [];
  const seeds = new Map<number, number[]>();
  const present = new Uint8Array((SEED_MASK + 1) >>> 3);
  let longest = 0;
  library.parts.forEach((part, index) => {
    const protein = part.protein;
    if (protein === undefined || protein.length < MIN_HOMOLOGUE_RESIDUES) return;
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
      present[word >>> 3] = (present[word >>> 3] ?? 0) | (1 << (word & 7));
      const at = p - HOMOLOGUE_SEED + 1;
      const list = seeds.get(word);
      if (list === undefined) seeds.set(word, [e, at]);
      else list.push(e, at);
    }
  });
  const built = { entries, seeds, present, longest };
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

/** Best ungapped local score of the part against the frame along one diagonal. */
function ungapped(rows: Uint8Array, codes: Uint8Array, diagonal: number): number {
  let best = 0;
  let run = 0;
  for (let i = Math.max(0, -diagonal); i < rows.length; i++) {
    const at = i + diagonal;
    if (at >= codes.length) break;
    const frameRow = FRAME_ROWS[codes[at] ?? NONE] ?? PROTEIN_CODES - 1;
    run = Math.max(0, run + (SCORES[(rows[i] ?? 0) * PROTEIN_CODES + frameRow] ?? 0));
    if (run > best) best = run;
  }
  return best;
}

/** Diagonals are offset by this so they sort as non-negative numbers. */
const DIAGONAL_BIAS = 1 << 22;
const ENTRY_STRIDE = 1 << 24;

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
    const found: number[] = [];
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
      if (((index.present[word >>> 3] ?? 0) & (1 << (word & 7))) === 0) continue;
      const list = index.seeds.get(word);
      if (list === undefined) continue;
      const at = p - HOMOLOGUE_SEED + 1;
      for (let k = 0; k + 1 < list.length; k += 2) {
        found.push((list[k] ?? 0) * ENTRY_STRIDE + (at - (list[k + 1] ?? 0)) + DIAGONAL_BIAS);
      }
    }
    if (found.length < MIN_SEEDS) continue;
    const sorted = Float64Array.from(found).sort();
    // The accepted ranges of this frame, per entry, so one locus is aligned once.
    const done = new Map<number, number[]>();
    let from = 0;
    while (from < sorted.length) {
      const e = Math.floor((sorted[from] ?? 0) / ENTRY_STRIDE);
      let to = from + 1;
      while (
        to < sorted.length &&
        Math.floor((sorted[to] ?? 0) / ENTRY_STRIDE) === e &&
        (sorted[to] ?? 0) - (sorted[to - 1] ?? 0) <= BAND
      ) {
        to++;
      }
      const seeds = to - from;
      const first = (sorted[from] ?? 0) - e * ENTRY_STRIDE - DIAGONAL_BIAS;
      const last = (sorted[to - 1] ?? 0) - e * ENTRY_STRIDE - DIAGONAL_BIAS;
      from = to;
      if (seeds < MIN_SEEDS) continue;
      const entry = index.entries[e];
      if (entry === undefined) continue;
      // Two-hit: the words must gather, and an ungapped stretch confirm them.
      let confirmed = false;
      for (let k = to - seeds; k < to && !confirmed; k++) {
        const diagonal = (sorted[k] ?? 0) - e * ENTRY_STRIDE - DIAGONAL_BIAS;
        if (
          k > to - seeds &&
          diagonal === (sorted[k - 1] ?? 0) - e * ENTRY_STRIDE - DIAGONAL_BIAS
        ) {
          continue;
        }
        confirmed = ungapped(entry.rows, codes, diagonal) >= UNGAPPED_TRIGGER;
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
