import { reverseComplement } from '../sequence';

/** NCBI translation tables we ship. 1 = standard, 11 = bacterial/plastid (same codons, more starts). */
export type TranslationTable = 1 | 11;

const BASES = ['T', 'C', 'A', 'G'] as const;
// Amino acids for codons in TCAG order (TTT, TTC, TTA, TTG, TCT, ...), as NCBI lists them.
const STANDARD = 'FFLLSSSSYY**CC*WLLLLPPPPHHQQRRRRIIIMTTTTNNKKSSRRVVVVAAAADDEEGGGG';
const STARTS_1 = '---M------**--*----M---------------M----------------------------';
const STARTS_11 = '---M------**--*----M------------MMMM---------------M------------';

const CODON_TO_AA = new Map<string, string>();
const START_CODONS: Record<TranslationTable, Set<string>> = { 1: new Set(), 11: new Set() };
{
  let i = 0;
  for (const a of BASES) {
    for (const b of BASES) {
      for (const c of BASES) {
        const codon = a + b + c;
        CODON_TO_AA.set(codon, STANDARD.charAt(i));
        if (STARTS_1.charAt(i) === 'M') START_CODONS[1].add(codon);
        if (STARTS_11.charAt(i) === 'M') START_CODONS[11].add(codon);
        i++;
      }
    }
  }
}

/** Nucleotides denoted by each IUPAC code. */
export const IUPAC_SETS: Readonly<Record<string, readonly string[]>> = {
  A: ['A'],
  C: ['C'],
  G: ['G'],
  T: ['T'],
  U: ['T'],
  R: ['A', 'G'],
  Y: ['C', 'T'],
  S: ['C', 'G'],
  W: ['A', 'T'],
  K: ['G', 'T'],
  M: ['A', 'C'],
  B: ['C', 'G', 'T'],
  D: ['A', 'G', 'T'],
  H: ['A', 'C', 'T'],
  V: ['A', 'C', 'G'],
  N: ['A', 'C', 'G', 'T'],
};

export const STOP = '*';
export const UNKNOWN_AA = 'X';

/**
 * Amino acid for one codon. Ambiguity codes are expanded; if every
 * expansion agrees the amino acid is returned, otherwise 'X'. Codons with
 * characters outside IUPAC yield 'X'.
 */
export function translateCodon(codon: string): string {
  const upper = codon.toUpperCase();
  if (upper.length !== 3) return UNKNOWN_AA;
  const direct = CODON_TO_AA.get(upper);
  if (direct !== undefined) return direct;
  const sets = [
    IUPAC_SETS[upper.charAt(0)],
    IUPAC_SETS[upper.charAt(1)],
    IUPAC_SETS[upper.charAt(2)],
  ];
  if (sets.some((s) => s === undefined)) return UNKNOWN_AA;
  let result: string | null = null;
  for (const a of sets[0] ?? []) {
    for (const b of sets[1] ?? []) {
      for (const c of sets[2] ?? []) {
        const aa = CODON_TO_AA.get(a + b + c) ?? UNKNOWN_AA;
        if (result === null) result = aa;
        else if (result !== aa) return UNKNOWN_AA;
      }
    }
  }
  return result ?? UNKNOWN_AA;
}

export function isStartCodon(codon: string, table: TranslationTable = 1): boolean {
  return START_CODONS[table].has(codon.toUpperCase());
}

export function isStopCodon(codon: string): boolean {
  return CODON_TO_AA.get(codon.toUpperCase()) === STOP;
}

export interface TranslateOptions {
  readonly table?: TranslationTable;
  /** Stop at the first stop codon (it is not included). Default: translate everything. */
  readonly toStop?: boolean;
  /** Render the first codon as 'M' when it is a start codon of the table. */
  readonly firstCodonAsMet?: boolean;
}

/**
 * Translates `dna` in frame from its first base. Trailing bases that do not
 * complete a codon are ignored. Case is irrelevant; the result is uppercase.
 */
export function translate(dna: string, options: TranslateOptions = {}): string {
  const table = options.table ?? 1;
  let out = '';
  for (let i = 0; i + 3 <= dna.length; i += 3) {
    const codon = dna.slice(i, i + 3);
    let aa = translateCodon(codon);
    if (i === 0 && options.firstCodonAsMet === true && isStartCodon(codon, table)) aa = 'M';
    if (aa === STOP && options.toStop === true) break;
    out += aa;
  }
  return out;
}

/** Translation of the reverse strand, read 5'→3' on that strand. */
export function translateReverse(dna: string, options: TranslateOptions = {}): string {
  return translate(reverseComplement(dna), options);
}

export const AMINO_ACID_NAMES: Readonly<
  Record<string, { readonly three: string; readonly name: string }>
> = {
  A: { three: 'Ala', name: 'Alanine' },
  R: { three: 'Arg', name: 'Arginine' },
  N: { three: 'Asn', name: 'Asparagine' },
  D: { three: 'Asp', name: 'Aspartate' },
  C: { three: 'Cys', name: 'Cysteine' },
  Q: { three: 'Gln', name: 'Glutamine' },
  E: { three: 'Glu', name: 'Glutamate' },
  G: { three: 'Gly', name: 'Glycine' },
  H: { three: 'His', name: 'Histidine' },
  I: { three: 'Ile', name: 'Isoleucine' },
  L: { three: 'Leu', name: 'Leucine' },
  K: { three: 'Lys', name: 'Lysine' },
  M: { three: 'Met', name: 'Methionine' },
  F: { three: 'Phe', name: 'Phenylalanine' },
  P: { three: 'Pro', name: 'Proline' },
  S: { three: 'Ser', name: 'Serine' },
  T: { three: 'Thr', name: 'Threonine' },
  W: { three: 'Trp', name: 'Tryptophan' },
  Y: { three: 'Tyr', name: 'Tyrosine' },
  V: { three: 'Val', name: 'Valine' },
  '*': { three: 'Stop', name: 'Stop' },
  X: { three: 'Xaa', name: 'Unknown' },
};
