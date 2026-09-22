import { reverseComplement } from '../sequence';
import { GENETIC_CODES, type GeneticCode, type TranslationTable } from './geneticCodes';

export { type GeneticCode, type TranslationTable, GENETIC_CODES } from './geneticCodes';

/** The code assumed when a feature or a panel does not name one, as NCBI does. */
export const DEFAULT_TABLE = 1 satisfies TranslationTable;

const BASES = ['T', 'C', 'A', 'G'] as const;

/** The 64 codons in NCBI's order, the third base cycling fastest. */
const CODONS: readonly string[] = BASES.flatMap((a) =>
  BASES.flatMap((b) => BASES.map((c) => a + b + c)),
);

const BY_ID = new Map<number, GeneticCode>(GENETIC_CODES.map((code) => [code.id, code]));

interface CompiledCode {
  readonly aminoAcid: ReadonlyMap<string, string>;
  readonly starts: ReadonlySet<string>;
}

// Built on first use rather than up front: a session translates with one or
// two codes, and compiling all 27 would be 1,728 map entries nobody asked for.
const COMPILED = new Map<TranslationTable, CompiledCode>();

function compile(code: GeneticCode): CompiledCode {
  const aminoAcid = new Map<string, string>();
  const starts = new Set<string>();
  CODONS.forEach((codon, i) => {
    aminoAcid.set(codon, code.aminoAcids.charAt(i));
    if (code.starts.charAt(i) === 'M') starts.add(codon);
  });
  return { aminoAcid, starts };
}

function codeFor(table: TranslationTable): CompiledCode {
  let compiled = COMPILED.get(table);
  if (compiled === undefined) {
    // BY_ID has every id `TranslationTable` admits, both being generated
    // from the same file; the fallback is for a value cast in from outside.
    compiled = compile(BY_ID.get(table) ?? geneticCode(DEFAULT_TABLE));
    COMPILED.set(table, compiled);
  }
  return compiled;
}

/** The named code, or `undefined` for a number NCBI does not use (7, 8, 17–20, …). */
export function findGeneticCode(id: number): GeneticCode | undefined {
  return BY_ID.get(id);
}

/** Whether `id` names a genetic code we ship. */
export function isTranslationTable(id: number): id is TranslationTable {
  return BY_ID.has(id);
}

/** The named code; `id` must be one we ship. */
export function geneticCode(id: TranslationTable): GeneticCode {
  const code = BY_ID.get(id);
  if (code === undefined) throw new Error(`No genetic code ${String(id)}`);
  return code;
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
 * Amino acid for one codon under `table`. Ambiguity codes are expanded; if
 * every expansion agrees the amino acid is returned, otherwise 'X'. Codons
 * with characters outside IUPAC yield 'X'.
 */
export function translateCodon(codon: string, table: TranslationTable = DEFAULT_TABLE): string {
  const upper = codon.toUpperCase();
  if (upper.length !== 3) return UNKNOWN_AA;
  const { aminoAcid } = codeFor(table);
  const direct = aminoAcid.get(upper);
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
        const aa = aminoAcid.get(a + b + c) ?? UNKNOWN_AA;
        if (result === null) result = aa;
        else if (result !== aa) return UNKNOWN_AA;
      }
    }
  }
  return result ?? UNKNOWN_AA;
}

export function isStartCodon(codon: string, table: TranslationTable = DEFAULT_TABLE): boolean {
  return codeFor(table).starts.has(codon.toUpperCase());
}

/** Whether the codon is a stop under `table`; which codons those are differs by code. */
export function isStopCodon(codon: string, table: TranslationTable = DEFAULT_TABLE): boolean {
  return codeFor(table).aminoAcid.get(codon.toUpperCase()) === STOP;
}

export interface TranslateOptions {
  /** Which genetic code to read with. Default: the standard code. */
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
  const table = options.table ?? DEFAULT_TABLE;
  let out = '';
  for (let i = 0; i + 3 <= dna.length; i += 3) {
    const codon = dna.slice(i, i + 3);
    let aa = translateCodon(codon, table);
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
