import { type CdsTranslation, type Codon } from './cdsTranslation';

/**
 * Numbered residues (#97, item 60): where amino acids are drawn, the first
 * residue and every tenth one carry their number, as SnapGene numbers them.
 *
 * A residue's number is its place in the protein, 1-based, counted from the
 * CDS's first full codon — after the bases `/codon_start` skips — and on
 * across the segments of a `join(...)`, whatever the length of each. Which
 * bases make each codon is `translateCds`'s business (reading order, reverse
 * strand, the origin of a circle); this module only picks the codons that are
 * numbered and says where their number goes, so a number always sits on the
 * codon its letter does.
 */

/** How often a residue is numbered: every tenth, and the first. */
export const RESIDUE_NUMBER_EVERY = 10;

/** Whether residue `n` (1-based) carries its number. */
export function isNumberedResidue(n: number, every: number = RESIDUE_NUMBER_EVERY): boolean {
  return n === 1 || (n > 0 && n % every === 0);
}

/** A residue that carries its number, and the base its number is centred on. */
export interface ResidueNumber {
  /** The residue's place in the protein, 1-based. */
  readonly number: number;
  readonly codon: Codon;
  /**
   * Forward-strand position of the codon's middle base in reading order: the
   * base its letter is drawn over, so a codon split by a join, a row break or
   * the origin is numbered where it is lettered.
   */
  readonly position: number;
  /**
   * Whether it is the first residue or a tenth one. When every residue is
   * numbered and they do not all fit, these are the ones kept.
   */
  readonly major: boolean;
}

const cache = new WeakMap<CdsTranslation, Map<number, readonly ResidueNumber[]>>();

/**
 * The numbered residues of a CDS translation, in reading order: the first and
 * every `step`th, so a step of 1 numbers every residue. Kept per translation
 * (which is itself kept per document version), since the view asks for them
 * once per row it draws.
 */
export function residueNumbers(
  t: CdsTranslation,
  step: number = RESIDUE_NUMBER_EVERY,
): readonly ResidueNumber[] {
  let byStep = cache.get(t);
  if (byStep === undefined) {
    byStep = new Map();
    cache.set(t, byStep);
  }
  let out = byStep.get(step);
  if (out === undefined) {
    out = t.codons
      .filter((codon) => isNumberedResidue(codon.index + 1, step))
      .map((codon) => ({
        number: codon.index + 1,
        codon,
        position: codon.positions[1],
        major: isNumberedResidue(codon.index + 1),
      }));
    byStep.set(step, out);
  }
  return out;
}

/**
 * A protein laid out in blocks of `every` residues, as a sequence is printed:
 * each block is numbered by its last residue (10, 20, …) and the first block
 * by its first residue too. A last block shorter than `every` has no number of
 * its own, since no tenth residue is in it.
 */
export interface ResidueBlock {
  /** 0-based index in the protein of the block's first residue. */
  readonly start: number;
  readonly residues: string;
  /** Number shown at the block's left: 1 on the first block, null elsewhere. */
  readonly first: number | null;
  /** Number shown at the block's right: its last residue's, when that is a tenth. */
  readonly last: number | null;
}

export function residueBlocks(
  protein: string,
  every: number = RESIDUE_NUMBER_EVERY,
): ResidueBlock[] {
  const blocks: ResidueBlock[] = [];
  for (let start = 0; start < protein.length; start += every) {
    const residues = protein.slice(start, start + every);
    const end = start + residues.length;
    blocks.push({
      start,
      residues,
      first: start === 0 ? 1 : null,
      last: end % every === 0 ? end : null,
    });
  }
  return blocks;
}
