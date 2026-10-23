import { DEFAULT_MIN_ORF_CODONS } from '../analysis/orf';
import { type Topology } from '../range';
import { type FeatureHit } from './detect';
import { BASE_CODE } from './protein';

/**
 * Whether the frame a protein hit was read in is plausibly translated (#285,
 * docs/design/59-detect-features.md).
 *
 * The protein search reads all six frames, and a short peptide made of one
 * repeated codon turns up in a frame nobody translates: a (GGT)n glycine
 * linker inside a fusion CDS is (ACC)n on the other strand, which one base
 * along reads as a run of histidines, and a His tag is offered where none is
 * encoded. Such a hit has
 * two marks. Its own frame is no ORF: no ATG at or before it back to the
 * stop before it, and open, stop to stop, for fewer codons than the ORFs
 * tab's default (`DEFAULT_MIN_ORF_CODONS`). And the other strand has an ORF
 * of at least that length, ATG to stop, across all of the hit's bases. A hit
 * with both is reading the antisense of a gene and is dropped.
 *
 * Neither mark alone is enough. A tag with a start before it is kept
 * whatever the other strand holds: the N-terminal His tag of pETDuet-1-ART
 * (PP098729.1) reads in a 29-codon ORF across a 271-codon one on the other
 * strand. A frame open for an ORF's length is kept without a start,
 * which may lie outside it: a TEV site in frame with the protein after it,
 * in a fusion whose start a cloning step supplies. And a tag with no long
 * ORF opposite is kept, as one in a vector with nothing else to translate it
 * would be.
 */

const OTHER = 0;
const STOP = 1;
const START = 2;
/** A codon with a base that is not A, C, G or T. */
const AMBIGUOUS = 3;
/** Past an end of a linear sequence. */
const END = 4;

/** What the codon whose forward-strand bases start at `q` is, read on `forward` or the other strand. */
function codonKind(bases: Uint8Array, circular: boolean, q: number, forward: boolean): number {
  const n = bases.length;
  if (!circular && (q < 0 || q + 3 > n)) return END;
  const at = (p: number): number => bases[((p % n) + n) % n] ?? 4;
  let a = at(q);
  let b = at(q + 1);
  let c = at(q + 2);
  if (a > 3 || b > 3 || c > 3) return AMBIGUOUS;
  if (!forward) [a, b, c] = [3 - c, 3 - b, 3 - a];
  // A C G T are 0 1 2 3: TAA, TAG and TGA stop, ATG starts.
  if (a === 3 && ((b === 0 && (c === 0 || c === 2)) || (b === 2 && c === 0))) return STOP;
  if (a === 0 && b === 3 && c === 2) return START;
  return OTHER;
}

/**
 * Whether `hit`, found by what it codes for, lies in a frame that is not
 * plausibly translated: no ORF in its own frame, and inside one on the
 * other strand (see above). `bases` are the sequence's
 * two-bit codes (`BASE_CODE`). The walks along the hit's own frame go no
 * further than an ORF's length; those along the other strand are kept in
 * `memo`, so the hits of one sequence walk each codon at most once.
 */
export function readsAntisense(
  hit: FeatureHit,
  bases: Uint8Array,
  topology: Topology,
  memo: AntisenseWalks = antisenseWalks(),
): boolean {
  const n = bases.length;
  const { start: s, end: e } = hit.range;
  const len = e - s;
  if (n === 0 || len <= 0 || len % 3 !== 0) return false;
  const circular = topology === 'circular';
  // A walk never goes further than round the circle once.
  const cap = circular ? Math.floor(n / 3) : n;
  const codons = len / 3;
  const forward = hit.strand === 'forward';
  // Codon k of the hit's frame in its reading order: 0 is its first.
  const own = (k: number): number =>
    codonKind(bases, circular, forward ? s + 3 * k : e - 3 - 3 * k, forward);

  // A start at or before the hit, back to the stop before it. Where the
  // frame runs off a linear end or into an unknown base it may have one. A
  // frame open for as long as an ORF is one in all but its start, which may
  // lie outside it; so neither walk need go further than that.
  let open = codons;
  for (let k = 0; ; k--) {
    if (open >= DEFAULT_MIN_ORF_CODONS) return false;
    const kind = own(k);
    if (kind === START || kind === AMBIGUOUS || kind === END) return false;
    if (kind === STOP) break;
    if (k < 0) open++;
  }
  for (let k = codons; ; k++) {
    if (open >= DEFAULT_MIN_ORF_CODONS) return false;
    const kind = own(k);
    if (kind === STOP || kind === END) break;
    open++;
  }

  // The three frames of the other strand across the hit's bases.
  const other = !forward;
  const walks = other ? memo.forward : memo.reverse;
  // One codon on along the other strand, in forward-strand bases.
  const dir = other ? 3 : -3;
  const kindOf = (q: number): number => codonKind(bases, circular, q, other);
  for (let phase = 0; phase < 3; phase++) {
    // The codons of this frame that hold a base of the hit, forward-strand
    // starts q0, q0 + 3, …, q0 + 3(m − 1).
    const q0 = s + phase - (phase > 0 ? 3 : 0);
    const m = Math.floor((e - 1 - q0) / 3) + 1;
    // Its first and last codon in the other strand's reading order.
    const head = other ? q0 : q0 + 3 * (m - 1);
    const tail = head + dir * (m - 1);
    let across = true;
    for (let k = 0; k < m && across; k++) {
      const kind = kindOf(head + dir * k);
      across = kind === OTHER || kind === START;
    }
    if (!across) continue;
    const first =
      farthestStart(head, dir, kindOf, walks.up, cap) ?? (kindOf(head) === START ? head : null);
    if (first === null) continue;
    const stop = firstStop(tail + dir, dir, kindOf, walks.down, cap);
    if (stop === null) continue;
    // Codons from the start to the stop, the stop not counted, as `findOrfs`;
    // and on a circle no longer than the circle.
    const orf = Math.abs(stop - first) / 3;
    if (circular && (orf + 1) * 3 > n) continue;
    if (orf >= DEFAULT_MIN_ORF_CODONS) return true;
  }
  return false;
}

/**
 * What walks along the other strand have found, kept across the hits of one
 * sequence so that hits in one long ORF do not each walk the whole of it:
 * per strand, for a codon (by its first forward-strand base, unrolled), the
 * farthest start upstream of it before a stop, and the first stop at or
 * after it.
 */
export interface AntisenseWalks {
  readonly forward: {
    readonly up: Map<number, number | null>;
    readonly down: Map<number, number | null>;
  };
  readonly reverse: {
    readonly up: Map<number, number | null>;
    readonly down: Map<number, number | null>;
  };
}

export function antisenseWalks(): AntisenseWalks {
  return {
    forward: { up: new Map(), down: new Map() },
    reverse: { up: new Map(), down: new Map() },
  };
}

/** The farthest ATG upstream of codon `q`, `q` itself not counted, before a stop or unknown codon. */
function farthestStart(
  q: number,
  dir: number,
  kindOf: (q: number) => number,
  up: Map<number, number | null>,
  cap: number,
): number | null {
  const known = up.get(q);
  if (known !== undefined) return known;
  const path: number[] = [];
  let p = q;
  let found: number | null = null;
  for (;;) {
    path.push(p);
    if (path.length > cap) break;
    const before = p - dir;
    const kind = kindOf(before);
    if (kind !== OTHER && kind !== START) break;
    const cached = up.get(before);
    if (cached !== undefined) {
      found = cached ?? (kind === START ? before : null);
      break;
    }
    p = before;
  }
  // Back down the path: each codon's answer is the next one's, or that
  // codon itself where it is a start and nothing lies further.
  for (let i = path.length - 1; i >= 0; i--) {
    const at = path[i] ?? q;
    up.set(at, found);
    if (found === null && i > 0 && kindOf(at) === START) found = at;
  }
  return up.get(q) ?? null;
}

/** The first stop at or after codon `q`, or null where an unknown codon or an end comes first. */
function firstStop(
  q: number,
  dir: number,
  kindOf: (q: number) => number,
  down: Map<number, number | null>,
  cap: number,
): number | null {
  const path: number[] = [];
  let p = q;
  let found: number | null = null;
  for (;;) {
    const cached = down.get(p);
    if (cached !== undefined) {
      found = cached;
      break;
    }
    path.push(p);
    const kind = kindOf(p);
    if (kind === STOP) {
      found = p;
      break;
    }
    if ((kind !== OTHER && kind !== START) || path.length > cap) break;
    p += dir;
  }
  for (const at of path) down.set(at, found);
  return found;
}

/** The hits, less those found by what they code for in a frame read only antisense. */
export function withoutAntisense<T extends FeatureHit>(
  hits: readonly T[],
  sequence: string,
  topology: Topology,
): T[] {
  if (!hits.some((h) => h.viaProtein === true)) return [...hits];
  const bases = new Uint8Array(sequence.length);
  for (let i = 0; i < sequence.length; i++) bases[i] = BASE_CODE[sequence.charCodeAt(i)] ?? 4;
  const memo = antisenseWalks();
  return hits.filter((h) => h.viaProtein !== true || !readsAntisense(h, bases, topology, memo));
}
