import { type Strand } from '../features';
import { type Topology } from '../range';
import { translateCodon } from '../analysis/codons';
import { type FeatureHit } from './detect';
import { type FeatureLibrary } from './library';

/**
 * Finding a part by what it codes for (#93), beside the DNA matching of
 * item 59.
 *
 * Two kinds of part are invisible to the DNA search. A short peptide tag —
 * 6xHis, FLAG, the T7 tag — has no canonical DNA: every vector spells it in
 * its own codons. And a fluorescent protein or a resistance gene carried
 * from one construct to the next picks up synonymous changes, which are
 * mismatches to the DNA matcher and nothing at all to the protein. FPbase
 * lists many proteins whose GenBank record gives no usable coding sequence;
 * those are in the library as proteins alone.
 *
 * So a part may carry a protein sequence instead of (or as well as) its
 * bases. The sequence is translated in all six frames and each part looked
 * for in them, by the same seed-and-verify shape as the DNA search but over
 * residues; a hit is mapped back to the bases it was translated from and
 * comes out as an ordinary `FeatureHit` the rest of the app already knows.
 *
 * Matching residues is far more specific than matching bases — twenty
 * letters rather than four — so a short tag can be looked for at all: eight
 * histidines are a match worth showing, where their twenty-four bases would
 * be one spelling among millions.
 *
 * Like the DNA matcher this works in codes rather than strings: the frames
 * are filled as arrays of five-bit residues and the seeds are the rolling
 * words of those, so nothing is allocated per position. A bitmap of the
 * words the library has answers "in no part" for nearly every position
 * before the map is asked.
 */

/** Residues of a part that must match before it is checked in full. */
export const PROTEIN_SEED = 5;

/**
 * Least share of a part's residues that must match, 0–1. Stricter than the
 * DNA default: a protein match is already a near-certain one, and the parts
 * are what a construct carries rather than what it evolved into.
 */
export const DEFAULT_PROTEIN_IDENTITY = 0.98;

/**
 * Parts of at most this many residues must match exactly. A short peptide
 * is its own signature — one substitution in a FLAG tag is not a FLAG tag —
 * and an inexact short match would turn up everywhere.
 */
export const EXACT_UP_TO = 12;

/** Five bits a residue, so a seed of five is 25 bits. */
const RESIDUE_BITS = 5;
const SEED_BITS = RESIDUE_BITS * PROTEIN_SEED;
const SEED_MASK = (1 << SEED_BITS) - 1;
/** Not a residue: a stop, an ambiguous codon, anything that breaks a run. */
const NONE = 31;

export interface ProteinDetectOptions {
  readonly minIdentity?: number;
}

/**
 * The most mismatched residues a part of `length` may have: what the
 * identity allows, capped where a seed is still certain (the q-gram lemma,
 * as for the DNA search), and none at all for a short part.
 */
export function proteinMismatchBudget(length: number, minIdentity: number): number {
  if (length <= EXACT_UP_TO) return 0;
  const byIdentity = Math.floor(length * (1 - minIdentity) + 1e-9);
  const bySeed = Math.floor(length / PROTEIN_SEED) - 1;
  return Math.max(0, Math.min(byIdentity, bySeed));
}

/** A–Z as 0–25; anything else is `NONE`. */
function residueCode(letter: string): number {
  const c = letter.charCodeAt(0);
  return c >= 65 && c <= 90 ? c - 65 : NONE;
}

function codesOf(protein: string): Uint8Array {
  const out = new Uint8Array(protein.length);
  for (let i = 0; i < protein.length; i++) out[i] = residueCode(protein.charAt(i));
  return out;
}

/**
 * Codon → residue code, for the 64 definite codons, by the standard genetic
 * code (`translateCodon`); a stop is `NONE`, as is any codon with a base
 * that is not A, C, G or T, so a run of residues breaks there.
 */
const CODON_TO_RESIDUE = (() => {
  const bases = 'ACGT';
  const table = new Uint8Array(64);
  for (let a = 0; a < 4; a++) {
    for (let b = 0; b < 4; b++) {
      for (let c = 0; c < 4; c++) {
        const codon = bases.charAt(a) + bases.charAt(b) + bases.charAt(c);
        const aa = translateCodon(codon);
        table[a * 16 + b * 4 + c] = aa === '*' || aa === 'X' ? NONE : residueCode(aa);
      }
    }
  }
  return table;
})();

/** Two bits per definite base, 4 for anything else (an IUPAC code, an N). */
const BASE_CODE = (() => {
  const t = new Uint8Array(128).fill(4);
  const set = (letters: string, code: number): void => {
    for (const c of letters) {
      t[c.charCodeAt(0)] = code;
      t[c.toLowerCase().charCodeAt(0)] = code;
    }
  };
  set('A', 0);
  set('C', 1);
  set('G', 2);
  set('TU', 3);
  return t;
})();

interface ProteinEntry {
  /** Index of the part in the library. */
  readonly part: number;
  readonly codes: Uint8Array;
}

interface ProteinIndex {
  readonly entries: readonly ProteinEntry[];
  /** Seed word → (entry, offset) pairs, flattened. */
  readonly seeds: ReadonlyMap<number, readonly number[]>;
  /** One bit per possible seed word (4 MB), set for those in `seeds`. */
  readonly present: Uint8Array;
  readonly longest: number;
}

const indexes = new WeakMap<FeatureLibrary, ProteinIndex>();

function indexFor(library: FeatureLibrary): ProteinIndex {
  const known = indexes.get(library);
  if (known !== undefined) return known;
  const entries: ProteinEntry[] = [];
  const seeds = new Map<number, number[]>();
  const present = new Uint8Array((SEED_MASK + 1) >>> 3);
  let longest = 0;
  library.parts.forEach((part, index) => {
    const protein = part.protein;
    if (protein === undefined || protein.length < PROTEIN_SEED) return;
    const codes = codesOf(protein);
    const e = entries.length;
    entries.push({ part: index, codes });
    longest = Math.max(longest, codes.length);
    forEachSeed(codes, codes.length, (word, at) => {
      present[word >>> 3] = (present[word >>> 3] ?? 0) | (1 << (word & 7));
      const list = seeds.get(word);
      if (list === undefined) seeds.set(word, [e, at]);
      else list.push(e, at);
    });
  });
  const built = { entries, seeds, present, longest };
  indexes.set(library, built);
  return built;
}

/** Calls `visit(word, start)` for each seed of definite residues in `codes[0, end)`. */
function forEachSeed(
  codes: Uint8Array,
  end: number,
  visit: (word: number, start: number) => void,
): void {
  let word = 0;
  let run = 0;
  for (let p = 0; p < end; p++) {
    const code = codes[p] ?? NONE;
    if (code === NONE) {
      run = 0;
      continue;
    }
    word = ((word << RESIDUE_BITS) | code) & SEED_MASK;
    if (++run >= PROTEIN_SEED) visit(word, p - PROTEIN_SEED + 1);
  }
}

/** One frame of the translation, and how to get back to the bases. */
interface Frame {
  readonly strand: Strand;
  /** Bases skipped before the first codon, 0–2. */
  readonly offset: number;
  readonly codes: Uint8Array;
}

/**
 * The six frames of a sequence given as two-bit base codes, as arrays of
 * residue codes. A reverse frame is read from the far end, so its first
 * residue is the last codon of the strand and its residues count back
 * towards zero.
 */
function framesOf(bases: Uint8Array): Frame[] {
  const n = bases.length;
  const out: Frame[] = [];
  for (let offset = 0; offset < 3; offset++) {
    const count = Math.max(0, Math.floor((n - offset) / 3));
    const forward = new Uint8Array(count);
    const reverse = new Uint8Array(count);
    for (let i = 0; i < count; i++) {
      const a = bases[offset + i * 3] ?? 4;
      const b = bases[offset + i * 3 + 1] ?? 4;
      const c = bases[offset + i * 3 + 2] ?? 4;
      forward[i] = a > 3 || b > 3 || c > 3 ? NONE : (CODON_TO_RESIDUE[a * 16 + b * 4 + c] ?? NONE);
      // The same three bases read on the other strand, in the other
      // direction: complement each and swap the ends.
      const ra = bases[n - offset - 1 - i * 3] ?? 4;
      const rb = bases[n - offset - 2 - i * 3] ?? 4;
      const rc = bases[n - offset - 3 - i * 3] ?? 4;
      reverse[i] =
        ra > 3 || rb > 3 || rc > 3
          ? NONE
          : (CODON_TO_RESIDUE[(3 - ra) * 16 + (3 - rb) * 4 + (3 - rc)] ?? NONE);
    }
    out.push({ strand: 'forward', offset, codes: forward });
    out.push({ strand: 'reverse', offset, codes: reverse });
  }
  return out;
}

/**
 * Every part with a protein sequence found in `sequence`, as ranges on its
 * forward strand. A stop codon breaks a frame's run of residues, so a match
 * never reads through one.
 */
export function detectProteinFeatures(
  sequence: string,
  topology: Topology,
  library: FeatureLibrary,
  options: ProteinDetectOptions = {},
): FeatureHit[] {
  const index = indexFor(library);
  const n = sequence.length;
  if (n === 0 || index.entries.length === 0) return [];
  const minIdentity = options.minIdentity ?? DEFAULT_PROTEIN_IDENTITY;
  const budgets = index.entries.map((e) => proteinMismatchBudget(e.codes.length, minIdentity));
  // A circle is read on past its origin far enough for the longest part,
  // and never so far that a part could cover a base twice.
  const extra = topology === 'circular' ? Math.min(index.longest * 3, Math.max(0, n - 1)) : 0;
  const total = n + extra;
  const bases = new Uint8Array(total);
  for (let i = 0; i < n; i++) bases[i] = BASE_CODE[sequence.charCodeAt(i)] ?? 4;
  for (let i = 0; i < extra; i++) bases[n + i] = bases[i % n] ?? 4;

  const hits: FeatureHit[] = [];
  for (const frame of framesOf(bases)) {
    const { codes } = frame;
    forEachSeed(codes, codes.length, (word, at) => {
      if (((index.present[word >>> 3] ?? 0) & (1 << (word & 7))) === 0) return;
      const list = index.seeds.get(word);
      if (list === undefined) return;
      for (let k = 0; k + 1 < list.length; k += 2) {
        const e = list[k] ?? 0;
        const entry = index.entries[e];
        if (entry === undefined) continue;
        const start = at - (list[k + 1] ?? 0);
        const length = entry.codes.length;
        if (start < 0 || start + length > codes.length) continue;
        // Back to the bases: a forward frame reads from `offset`, a reverse
        // frame from the far end.
        const from =
          frame.strand === 'forward'
            ? frame.offset + start * 3
            : total - frame.offset - (start + length) * 3;
        if (from < 0 || from + length * 3 > total || from >= n) continue;
        // The same part may be seeded by several of its words; the first
        // that places it here has already answered for it.
        if (hits.some((h) => h.part === entry.part && h.range.start === from)) continue;
        const budget = budgets[e] ?? 0;
        let mismatches = 0;
        let ok = true;
        for (let i = 0; i < length; i++) {
          if (codes[start + i] === entry.codes[i]) continue;
          if (++mismatches > budget) {
            ok = false;
            break;
          }
        }
        if (!ok) continue;
        hits.push({
          part: entry.part,
          range: { start: from, end: from + length * 3 },
          strand: frame.strand,
          mismatches,
          ambiguous: 0,
          identity: (length - mismatches) / length,
          viaProtein: true,
        });
      }
    });
  }
  return hits;
}
