import { type Strand } from '../features';
import { type Range, type Topology } from '../range';
import { reverseComplement } from '../sequence';
import { IUPAC_SETS } from './codons';

const BASE_BITS: Readonly<Record<string, number>> = { A: 1, C: 2, G: 4, T: 8 };

export function codeMask(code: string): number {
  let mask = 0;
  for (const b of IUPAC_SETS[code.toUpperCase()] ?? []) mask |= BASE_BITS[b] ?? 0;
  return mask;
}

/** Bitmask per position of the sequence; unknown characters match nothing. */
export function sequenceMasks(sequence: string): Uint8Array {
  const out = new Uint8Array(sequence.length);
  for (let i = 0; i < sequence.length; i++) out[i] = codeMask(sequence.charAt(i));
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
  const out: number[] = [];
  const n = pattern.length;
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
  const scan = topology === 'circular' ? sequence + sequence.slice(0, n - 1) : sequence;
  const masks = sequenceMasks(scan);
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
  out.sort((a, b) => a.range.start - b.range.start || (a.strand === 'forward' ? -1 : 1));
  return out;
}

/** Whether text can be a nucleotide search pattern (IUPAC codes only). */
export function looksLikeSequence(text: string): boolean {
  return /^[ACGTURYSWKMBDHVN]+$/i.test(text.trim());
}
