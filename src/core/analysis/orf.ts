import { type Strand } from '../features';
import { type Range, type Topology } from '../range';
import { reverseComplement } from '../sequence';
import { DEFAULT_TABLE, type TranslationTable, isStartCodon, isStopCodon } from './codons';

export interface Orf {
  /** Bases covered, unrolled (may wrap on circular sequences), including the stop codon. */
  readonly range: Range;
  readonly strand: Strand;
  /** Reading frame 0–2 relative to the forward strand (or to the reverse strand's 5' end). */
  readonly frame: number;
  /** Number of codons excluding the stop codon. */
  readonly codons: number;
}

export interface OrfOptions {
  /** Minimum ORF length in codons, excluding the stop. Default 75. */
  readonly minCodons?: number;
  /**
   * Genetic code to read with. It decides where an ORF ends as well as where
   * it may begin: TGA is a stop under the standard code and tryptophan under
   * the vertebrate mitochondrial one.
   */
  readonly table?: TranslationTable;
  /** Only ATG starts, even under a code with more of them. Default true. */
  readonly atgOnly?: boolean;
}

/** ORFs in one strand's text, in that strand's coordinates. */
function scanStrand(
  text: string,
  seqLength: number,
  topology: Topology,
  opts: Required<OrfOptions>,
): { start: number; end: number; frame: number }[] {
  const isStart = (codon: string): boolean =>
    opts.atgOnly ? codon === 'ATG' : isStartCodon(codon, opts.table);
  return topology === 'circular'
    ? scanCircle(text, seqLength, isStart, opts)
    : scanLine(text, isStart, opts);
}

/** A linear strand: each frame from its first start to the next stop. */
function scanLine(
  text: string,
  isStart: (codon: string) => boolean,
  opts: Required<OrfOptions>,
): { start: number; end: number; frame: number }[] {
  const out: { start: number; end: number; frame: number }[] = [];
  for (let frame = 0; frame < 3; frame++) {
    let orfStart: number | null = null;
    for (let i = frame; i + 3 <= text.length; i += 3) {
      const codon = text.slice(i, i + 3);
      if (orfStart === null) {
        if (isStart(codon)) orfStart = i;
        continue;
      }
      if (isStopCodon(codon, opts.table)) {
        const end = i + 3;
        if ((end - orfStart) / 3 - 1 >= opts.minCodons) out.push({ start: orfStart, end, frame });
        orfStart = null;
      }
    }
  }
  return out;
}

/**
 * A circular strand, one ORF per stop codon (item 69, #145). A reading has
 * no first codon on a circle: it may come round the origin from any frame,
 * and when the length is not a multiple of three it runs through all three
 * frames before it repeats. So rather than reading forward from position 0,
 * each stop walks back codon by codon, to the previous stop or until the ORF
 * would be longer than the molecule, and keeps the farthest start it passed.
 * A start nested in an ORF across the origin is thereby never reported
 * beside it, and a reading that runs more than once round before its stop
 * still gives the longest ORF that fits. Each base is walked over by at most
 * one stop per reading, so the scan stays linear in the length.
 */
function scanCircle(
  text: string,
  L: number,
  isStart: (codon: string) => boolean,
  opts: Required<OrfOptions>,
): { start: number; end: number; frame: number }[] {
  const out: { start: number; end: number; frame: number }[] = [];
  // Start + stop is six bases; a shorter circle holds no ORF.
  if (L < 6) return out;
  // What the codon at each position is, read once: 1 a stop, 2 a start.
  const doubled = text + text.slice(0, 2);
  const kind = new Uint8Array(L);
  for (let p = 0; p < L; p++) {
    const codon = doubled.slice(p, p + 3);
    kind[p] = isStopCodon(codon, opts.table) ? 1 : isStart(codon) ? 2 : 0;
  }
  for (let q = 0; q < L; q++) {
    if (kind[q] !== 1) continue;
    let best = -1; // farthest start, as a distance back from q
    // The ORF from q - back through the stop has back + 3 bases.
    for (let back = 3; back + 3 <= L; back += 3) {
      const k = kind[(q - back + L) % L];
      if (k === 1) break;
      if (k === 2) best = back;
    }
    if (best < 0 || best / 3 < opts.minCodons) continue;
    const start = (q - best + L) % L;
    out.push({ start, end: start + best + 3, frame: start % 3 });
  }
  return out;
}

/**
 * Finds open reading frames on both strands: a start codon through the next
 * in-frame stop codon. Nested starts sharing a stop are reported once, from
 * the first start, also when the first start is on the other side of the
 * origin of a circular sequence; there an ORF is at most the molecule's
 * length. Coordinates are forward-strand, unrolled.
 */
export function findOrfs(sequence: string, topology: Topology, options: OrfOptions = {}): Orf[] {
  const opts: Required<OrfOptions> = {
    minCodons: options.minCodons ?? 75,
    table: options.table ?? DEFAULT_TABLE,
    atgOnly: options.atgOnly ?? true,
  };
  const L = sequence.length;
  const upper = sequence.toUpperCase();
  const orfs: Orf[] = [];

  for (const o of scanStrand(upper, L, topology, opts)) {
    orfs.push({
      range: { start: o.start, end: o.end },
      strand: 'forward',
      frame: o.frame,
      codons: (o.end - o.start) / 3 - 1,
    });
  }
  for (const o of scanStrand(reverseComplement(upper), L, topology, opts)) {
    // Reverse-strand position p corresponds to forward position L - p.
    const len = o.end - o.start;
    let start = L - o.end;
    if (topology === 'circular' && L > 0) start = ((start % L) + L) % L;
    orfs.push({
      range: { start, end: start + len },
      strand: 'reverse',
      frame: o.frame,
      codons: len / 3 - 1,
    });
  }
  orfs.sort((a, b) => a.range.start - b.range.start || a.range.end - b.range.end);
  return orfs;
}
