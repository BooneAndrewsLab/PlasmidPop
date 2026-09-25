import { type Strand } from '../features';
import { type Range, type Topology } from '../range';
import { reverseComplement } from '../sequence';
import { codeMask } from '../analysis/search';
import { meltingTemperature } from './thermo';

/**
 * Whether a primer base pairs with a template base: the template's base has
 * to be one the code stands for (#75). For plain bases that is equality; a
 * degenerate primer's R pairs with an A or a G, and N with anything. A
 * template N pairs only with a primer N, since which base it is is unknown.
 */
export function pairsWithCode(template: string, primer: string): boolean {
  const t = codeMask(template);
  return t !== 0 && (t & ~codeMask(primer)) === 0;
}

/**
 * Where a primer does not pair with the template it anneals to (#32): the
 * template positions, unrolled like `site.range`, of every base under the
 * primer's 3′ part that its own base does not pair with. The 3′ part is as
 * long as the site; anything before it is tail, which pairs with nothing on
 * the template by design and is not a mismatch. A reverse site's primer is
 * read turned round, as it lies on the top strand.
 */
export function mismatchPositions(
  template: string,
  site: { readonly range: Range; readonly strand: Strand },
  primer: string,
): number[] {
  const length = site.range.end - site.range.start;
  const L = template.length;
  if (length <= 0 || L === 0) return [];
  const part = cleanPrimer(primer).slice(-length);
  const along = site.strand === 'forward' ? part : reverseComplement(part);
  // A primer shorter than its site, which should not happen, lines up at the 3′ end.
  const offset = site.strand === 'forward' ? length - along.length : 0;
  const out: number[] = [];
  for (let i = 0; i < along.length; i++) {
    const at = site.range.start + offset + i;
    const base = template.charAt(((at % L) + L) % L).toUpperCase();
    if (!pairsWithCode(base, along.charAt(i))) out.push(at);
  }
  return out;
}

/** Bases a primer may carry: IUPAC nucleotide codes, U read as T. */
export function cleanPrimer(primer: string): string {
  return primer
    .toUpperCase()
    .replace(/U/g, 'T')
    .replace(/[^ACGTRYSWKMBDHVN]/g, '');
}

/**
 * Where a primer anneals when only part of it is meant to.
 *
 * `findPrimerBindingSites` (`primerDesign.ts`) asks whether the *whole*
 * primer matches, which is the right question for "is this oligo specific to
 * my plasmid". It is the wrong one for PCR: a cloning primer is a 3′ half
 * that anneals and a 5′ tail that does not — a restriction site, a Gibson
 * homology arm, a tag, a mutation. The tail matches nothing on the template
 * and is copied into the product all the same, which is the whole point of
 * it, and a search that insists on a full-length match cannot see such a
 * primer at all.
 *
 * So this walks *back from the 3′ end*, which is the end that matters: a
 * polymerase extends from there, and a mismatch under the last few bases
 * stops the reaction whatever the rest of the oligo does. Whatever is left
 * over at the 5′ end is the tail, reported rather than rejected.
 */
export interface AnnealingSite {
  /** The whole primer, cleaned: tail and annealing part together. */
  readonly primer: string;
  /** Bases of the template the 3′ part pairs with, unrolled forward coordinates. */
  readonly range: Range;
  /**
   * Which strand the primer lies along, and so which way it extends:
   * `forward` primes rightwards along the top strand, `reverse` leftwards.
   */
  readonly strand: Strand;
  /** How many of the primer's 3′ bases anneal; `range` is this long. */
  readonly annealLength: number;
  /** The 5′ bases that do not anneal, in the primer's own direction. */
  readonly tail: string;
  /** Mismatches inside the annealing part, outside the 3′ anchor. */
  readonly mismatches: number;
  /**
   * Melting temperature of the annealing part alone, as if it matched
   * throughout: what the primer anneals at once the product, which carries
   * the primer's own bases, is the template (#14).
   */
  readonly tm: number;
  /**
   * Melting temperature of the 3′ stretch before the first mismatch, the
   * part that surely pairs in the first cycles, when the template is the
   * original. Equal to `tm` for a site with no mismatch. Usually lower
   * otherwise, but not always: a nearest-neighbour Tm does not rise with
   * every base added, so a short GC-rich stretch can melt above the longer
   * whole. It is the temperature of what surely pairs, not a bound on `tm`.
   */
  readonly templateTm: number;
}

export interface AnnealOptions {
  /** Shortest 3′ match to call a site. */
  readonly minAnneal?: number;
  /** Mismatches tolerated inside the annealing part, outside the anchor. */
  readonly maxMismatches?: number;
  /** Bases at the 3′ end that must match exactly. */
  readonly exactThreePrime?: number;
}

export const ANNEAL_DEFAULTS: Required<AnnealOptions> = {
  minAnneal: 15,
  maxMismatches: 2,
  exactThreePrime: 5,
};

/**
 * The longest run from the 3′ end that pairs, or null where nothing does.
 * `probe` reads 3′ first: for a primer on the top strand that is the primer
 * reversed, for one on the bottom strand its reverse complement, so one walk
 * serves both.
 *
 * The run is trimmed back to a match, so a site never begins with a mismatch
 * hanging off its 5′ end: those bases are tail, which is what a tail is.
 */
function annealRun(
  probe: string,
  baseAt: (i: number) => string,
  anchor: number,
  step: number,
  opts: Required<AnnealOptions>,
): { readonly length: number; readonly mismatches: number; readonly perfect: number } | null {
  let mismatches = 0;
  let best = 0;
  let bestMismatches = 0;
  /** Bases from the 3′ end before the first mismatch. */
  let perfect = -1;
  for (let i = 0; i < probe.length; i++) {
    const base = baseAt(anchor + step * i);
    // Off the end of a linear template: the primer hangs over the tip, and
    // what it has matched so far is all there is.
    if (base === '') break;
    if (pairsWithCode(base, probe.charAt(i))) {
      best = i + 1;
      bestMismatches = mismatches;
      continue;
    }
    // A mismatch under the last few bases is not a weak site, it is no site:
    // the 3′ end has to be paired for the polymerase to extend it.
    if (i < opts.exactThreePrime) return null;
    if (perfect < 0) perfect = i;
    if (++mismatches > opts.maxMismatches) break;
  }
  if (best < opts.minAnneal) return null;
  return {
    length: best,
    mismatches: bestMismatches,
    // A site with a mismatch in it had `perfect` set at the first one.
    perfect: bestMismatches === 0 ? best : perfect,
  };
}

const BASE_INDEX: Readonly<Record<string, number>> = { A: 0, C: 1, G: 2, T: 3 };

/**
 * The template's every `k`-mer, for finding where a primer's 3′ anchor lies
 * without walking the whole template for each primer (#64). A search for one
 * primer can afford the walk; a search for a lab's five hundred cannot — it
 * was 3 s on a 10 kb plasmid (docs/perf-notes.md). The anchor has to match
 * exactly, so only the places its bases stand at can be sites, and those are
 * a lookup.
 *
 * Built once per template, reused for every primer. Windows holding anything
 * but A, C, G and T (an N, a code) are few and kept aside, and tried for
 * every primer as the walk would have tried them.
 */
export interface AnnealIndex {
  readonly sequence: string;
  readonly topology: Topology;
  /** Length of the indexed words; never more than the anchor. */
  readonly k: number;
  /** Window starts, grouped by word: word w's are `starts[offsets[w]..offsets[w + 1])`, ascending. */
  readonly offsets: Int32Array;
  readonly starts: Int32Array;
  /** Starts of the windows that are not plain bases, ascending. */
  readonly irregular: readonly number[];
}

/** The index `findAnnealingSites` can be given, words as long as the anchor up to five bases. */
export function buildAnnealIndex(
  sequence: string,
  topology: Topology,
  exactThreePrime: number = ANNEAL_DEFAULTS.exactThreePrime,
): AnnealIndex | null {
  const k = Math.min(exactThreePrime, 5);
  const L = sequence.length;
  if (k <= 0 || L < k) return null;
  const text = sequence.toUpperCase();
  const circular = topology === 'circular';
  const windows = circular ? L : L - k + 1;
  const words = new Int32Array(windows);
  const counts = new Int32Array((1 << (2 * k)) + 1);
  const irregular: number[] = [];
  for (let s = 0; s < windows; s++) {
    let word = 0;
    for (let j = 0; j < k; j++) {
      const b = BASE_INDEX[text.charAt((s + j) % L)];
      if (b === undefined) {
        word = -1;
        break;
      }
      word = (word << 2) | b;
    }
    words[s] = word;
    if (word < 0) irregular.push(s);
    else counts[word + 1] = (counts[word + 1] ?? 0) + 1;
  }
  const offsets = new Int32Array(counts.length);
  for (let w = 1; w < counts.length; w++) offsets[w] = (offsets[w - 1] ?? 0) + (counts[w] ?? 0);
  const fill = offsets.slice();
  const starts = new Int32Array(windows - irregular.length);
  for (let s = 0; s < windows; s++) {
    const word = words[s] ?? -1;
    if (word < 0) continue;
    starts[fill[word] ?? 0] = s;
    fill[word] = (fill[word] ?? 0) + 1;
  }
  return { sequence, topology, k, offsets, starts, irregular };
}

/**
 * Starts of the windows whose plain bases the `k` codes of `anchor` pair
 * with, and the irregular windows, in no particular order: the forward ends
 * made from them are sorted, and reverse starts, one site each at most, are
 * put in order with the sites. A code expands to each base it stands for, so
 * a degenerate anchor looks up each word of its mix.
 */
function anchorWindows(index: AnnealIndex, anchor: string): number[] {
  let words = [0];
  for (let j = 0; j < anchor.length; j++) {
    const code = anchor.charAt(j);
    const next: number[] = [];
    for (const w of words) {
      for (const base of 'ACGT') {
        if (pairsWithCode(base, code)) next.push((w << 2) | (BASE_INDEX[base] ?? 0));
      }
    }
    words = next;
  }
  const out: number[] = [...index.irregular];
  for (const w of words) {
    const from = index.offsets[w] ?? 0;
    const to = index.offsets[w + 1] ?? 0;
    for (let i = from; i < to; i++) out.push(index.starts[i] ?? 0);
  }
  return out;
}

/**
 * Every place `primer` would anneal by its 3′ end, on either strand. Sites
 * may wrap the origin of a circular template.
 *
 * With an `index` of the same template, only the places the primer's 3′
 * anchor can stand at are tried; the sites found are the same.
 */
export function findAnnealingSites(
  sequence: string,
  topology: Topology,
  primer: string,
  options: AnnealOptions = {},
  index: AnnealIndex | null = null,
): AnnealingSite[] {
  const opts = { ...ANNEAL_DEFAULTS, ...options };
  const p = cleanPrimer(primer);
  const L = sequence.length;
  const n = p.length;
  if (n < opts.minAnneal || L === 0) return [];
  const text = sequence.toUpperCase();
  const circular = topology === 'circular';
  const baseAt = (i: number): string =>
    circular ? text.charAt(((i % L) + L) % L) : i < 0 || i >= L ? '' : text.charAt(i);
  const norm = (i: number): number => (circular ? ((i % L) + L) % L : i);

  /**
   * The last `len` bases of the primer as the template makes them pair: a
   * degenerate code takes the template base it anneals to, which is the
   * molecule of the mix that anneals there and the one a Tm can be given
   * for. Plain bases, mismatched or not, are the primer's own.
   */
  const resolved = (range: Range, strand: Strand, len: number): string => {
    let out = '';
    for (let j = n - len; j < n; j++) {
      const code = p.charAt(j);
      // Where primer base j sits on the template, read in the primer's direction.
      const offset = j - (n - (range.end - range.start));
      const base =
        strand === 'forward'
          ? baseAt(range.start + offset)
          : reverseComplement(baseAt(range.end - 1 - offset));
      out += /[ACGT]/.test(code) || !pairsWithCode(base, code) ? code : base;
    }
    return out;
  };
  const site = (
    range: Range,
    strand: Strand,
    run: { readonly length: number; readonly mismatches: number; readonly perfect: number },
  ): AnnealingSite => ({
    primer: p,
    range,
    strand,
    annealLength: run.length,
    tail: p.slice(0, n - run.length),
    mismatches: run.mismatches,
    tm: meltingTemperature(resolved(range, strand, run.length)),
    templateTm: meltingTemperature(resolved(range, strand, run.perfect)),
  });

  const out: AnnealingSite[] = [];
  const reverse = reverseComplement(p);
  // An index is only good for the template it was built from, and only
  // narrows the search while the anchor is at least as long as its words
  // and a site is longer than they are.
  const usable =
    index !== null &&
    index.sequence === sequence &&
    index.topology === topology &&
    index.k <= opts.exactThreePrime &&
    index.k < opts.minAnneal;
  const k = usable ? index.k : 0;
  /** Where the top strand reads the forward anchor, as 3′ ends `e`. */
  const forwardEnds = usable
    ? anchorWindows(index, p.slice(n - k))
        .map((s) => ((s + k - 1) % L) + 1)
        .sort((a, b) => a - b)
    : null;
  /** Where the top strand reads the reverse primer's anchor, as starts `s`. */
  const reverseStarts = usable ? anchorWindows(index, reverse.slice(0, k)) : null;

  // Top strand: the primer reads the same way the sequence does, so its 3′
  // base sits at `e - 1` and the match runs leftwards from there.
  let forward = '';
  for (let i = n - 1; i >= 0; i--) forward += p.charAt(i);
  const tryForward = (e: number): void => {
    const run = annealRun(forward, baseAt, e - 1, -1, opts);
    if (run === null) return;
    const start = norm(e - run.length);
    out.push(site({ start, end: start + run.length }, 'forward', run));
  };
  if (forwardEnds === null) for (let e = 1; e <= L; e++) tryForward(e);
  else for (const e of forwardEnds) tryForward(e);
  // Bottom strand: the primer's reverse complement matches the top strand,
  // and its 3′ base is that probe's *first* one, so the match runs rightwards.
  const tryReverse = (s: number): void => {
    const run = annealRun(reverse, baseAt, s, 1, opts);
    if (run === null) return;
    out.push(site({ start: norm(s), end: norm(s) + run.length }, 'reverse', run));
  };
  if (reverseStarts === null) for (let s = 0; s < L; s++) tryReverse(s);
  else for (const s of reverseStarts) tryReverse(s);
  out.sort((a, b) => a.range.start - b.range.start || a.strand.localeCompare(b.strand));
  return out;
}
