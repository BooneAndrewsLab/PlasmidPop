import { type Strand } from '../features';
import { type Range, type Topology } from '../range';
import { reverseComplement } from '../sequence';
import { type TranslationTable, isStartCodon, isStopCodon } from './codons';

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
  readonly table?: TranslationTable;
  /** Only ATG starts, even under table 11. Default true. */
  readonly atgOnly?: boolean;
}

/** ORFs in one strand's text, in that strand's coordinates. */
function scanStrand(
  text: string,
  seqLength: number,
  topology: Topology,
  opts: Required<OrfOptions>,
): { start: number; end: number; frame: number }[] {
  const out: { start: number; end: number; frame: number }[] = [];
  // Scan a doubled copy on circular molecules so ORFs across the origin are
  // found; only ORFs that start in the first copy are kept.
  const scan = topology === 'circular' ? text + text : text;
  const isStart = (codon: string): boolean =>
    opts.atgOnly ? codon === 'ATG' : isStartCodon(codon, opts.table);
  for (let frame = 0; frame < 3; frame++) {
    let orfStart: number | null = null;
    for (let i = frame; i + 3 <= scan.length; i += 3) {
      const codon = scan.slice(i, i + 3);
      if (orfStart === null) {
        if (isStart(codon)) orfStart = i;
        continue;
      }
      if (isStopCodon(codon)) {
        const end = i + 3;
        const codons = (end - orfStart) / 3 - 1;
        if (orfStart < seqLength && end - orfStart <= seqLength && codons >= opts.minCodons) {
          out.push({ start: orfStart, end, frame });
        }
        orfStart = null;
      }
    }
  }
  return out;
}

/**
 * Finds open reading frames on both strands: a start codon through the next
 * in-frame stop codon. Nested starts sharing a stop are reported once, from
 * the first start. Coordinates are forward-strand, unrolled.
 */
export function findOrfs(sequence: string, topology: Topology, options: OrfOptions = {}): Orf[] {
  const opts: Required<OrfOptions> = {
    minCodons: options.minCodons ?? 75,
    table: options.table ?? 1,
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
