import { reverseComplement } from '../sequence';
import { STOP, type TranslateOptions, translate } from './codons';

/**
 * Reading frame by the usual convention: +1, +2, +3 read the forward strand
 * from its first, second and third base; −1, −2, −3 read the reverse
 * complement from *its* first, second and third base, i.e. starting at the
 * 3′ end of the forward strand.
 */
export type Frame = 1 | 2 | 3 | -1 | -2 | -3;

export const FRAMES: readonly Frame[] = [1, 2, 3, -1, -2, -3];

export interface FrameTranslation {
  readonly frame: Frame;
  readonly strand: 'forward' | 'reverse';
  /** Bases skipped at the 5′ end of the strand read before the first codon (0, 1 or 2). */
  readonly offset: 0 | 1 | 2;
  /** One-letter amino acids, stops as `*`, unknown as `X`. Empty when fewer than 3 bases remain. */
  readonly protein: string;
  /** Number of stop codons in `protein`. */
  readonly stops: number;
}

/** Label such as `+1` or `−1` (with a proper minus sign). */
export function frameLabel(frame: Frame): string {
  return frame > 0 ? `+${frame}` : `−${-frame}`;
}

function countStops(protein: string): number {
  let n = 0;
  for (const aa of protein) if (aa === STOP) n++;
  return n;
}

/** Translates `dna` in one frame; see {@link Frame} for the numbering. */
export function translateFrame(
  dna: string,
  frame: Frame,
  options: TranslateOptions = {},
): FrameTranslation {
  const strand = frame > 0 ? 'forward' : 'reverse';
  const offset = (Math.abs(frame) - 1) as 0 | 1 | 2;
  const text = strand === 'forward' ? dna : reverseComplement(dna);
  const protein = translate(text.slice(offset), options);
  return { frame, strand, offset, protein, stops: countStops(protein) };
}

/**
 * Translates `dna` in all six reading frames. Trailing bases that do not
 * fill a codon are dropped in each frame; nothing is treated as a start.
 */
export function translateSixFrames(
  dna: string,
  options: TranslateOptions = {},
): readonly FrameTranslation[] {
  return FRAMES.map((frame) => translateFrame(dna, frame, options));
}
