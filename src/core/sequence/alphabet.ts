/**
 * Nucleotide alphabet: IUPAC ambiguity codes are first-class citizens.
 * Case is preserved everywhere (lowercase is commonly used to mark regions).
 */

export const IUPAC_NUCLEOTIDES = 'ACGTURYSWKMBDHVN';

const COMPLEMENT_UPPER: Readonly<Record<string, string>> = {
  A: 'T',
  C: 'G',
  G: 'C',
  T: 'A',
  U: 'A',
  R: 'Y',
  Y: 'R',
  S: 'S',
  W: 'W',
  K: 'M',
  M: 'K',
  B: 'V',
  V: 'B',
  D: 'H',
  H: 'D',
  N: 'N',
};

const COMPLEMENT: Readonly<Record<string, string>> = (() => {
  const table: Record<string, string> = {};
  for (const [base, comp] of Object.entries(COMPLEMENT_UPPER)) {
    table[base] = comp;
    table[base.toLowerCase()] = comp.toLowerCase();
  }
  return table;
})();

const VALID_SEQUENCE = /^[ACGTURYSWKMBDHVNacgturyswkmbdhvn]*$/;
const INVALID_CHARS = /[^ACGTURYSWKMBDHVNacgturyswkmbdhvn]/g;
const STRIPPABLE = /[\s\d]/g;

export function isValidSequence(text: string): boolean {
  return VALID_SEQUENCE.test(text);
}

export class InvalidSequenceError extends Error {
  readonly invalidCharacters: readonly string[];

  constructor(invalidCharacters: readonly string[]) {
    super(
      `Sequence contains characters outside the IUPAC nucleotide alphabet: ${describeCharacters(invalidCharacters)}`,
    );
    this.name = 'InvalidSequenceError';
    this.invalidCharacters = invalidCharacters;
  }
}

/** The first few of `chars`, quoted, and how many there are when that is not all of them. */
function describeCharacters(chars: readonly string[]): string {
  const shown = chars
    .slice(0, 5)
    .map((c) => JSON.stringify(c))
    .join(', ');
  return chars.length > 5 ? `${shown}, … (${chars.length} distinct)` : shown;
}

export function assertValidSequence(text: string): void {
  if (isValidSequence(text)) return;
  const distinct = [...new Set(text.match(INVALID_CHARS) ?? [])];
  throw new InvalidSequenceError(distinct);
}

/**
 * Prepares pasted or typed text for insertion: strips whitespace and digits
 * (so numbered GenBank/FASTA blocks paste cleanly) and rejects anything else
 * that is not an IUPAC nucleotide code — or, for a protein document, an
 * amino-acid code (`alphabet`).
 */
export function normalizeSequenceInput(text: string, alphabet: Alphabet = 'nucleotide'): string {
  const stripped = text.replace(STRIPPABLE, '');
  assertValidResidues(stripped, alphabet);
  return stripped;
}

// ---------------------------------------------------------------- proteins

/**
 * What a document's letters are (#66): bases of DNA or RNA, or the residues
 * of a protein. It is fixed when the document is made; no edit changes it.
 */
export type Alphabet = 'nucleotide' | 'protein';

export function isAlphabet(v: unknown): v is Alphabet {
  return v === 'nucleotide' || v === 'protein';
}

/**
 * IUPAC one-letter amino-acid codes: the twenty, selenocysteine (U) and
 * pyrrolysine (O), the ambiguity codes B (D or N), Z (E or Q), J (I or L)
 * and X (any), and `*` for a stop, which a translation may carry.
 */
export const PROTEIN_RESIDUES = 'ACDEFGHIKLMNPQRSTVWYUOBZJX*';

const VALID_PROTEIN = /^[ACDEFGHIKLMNPQRSTVWYUOBZJXacdefghiklmnpqrstvwyuobzjx*]*$/;
const INVALID_PROTEIN_CHARS = /[^ACDEFGHIKLMNPQRSTVWYUOBZJXacdefghiklmnpqrstvwyuobzjx*]/g;

export function isValidProtein(text: string): boolean {
  return VALID_PROTEIN.test(text);
}

/** Letters that are only ever the bases themselves, or N; see `guessAlphabet`. */
const PLAIN_BASES = /[ACGTUNacgtun]/g;

/**
 * Share of letters that must be A, C, G, T, U or N for text that is not
 * all nucleotide codes to still be taken as a (damaged) nucleotide
 * sequence. A protein runs to about a quarter of those letters.
 */
const NUCLEOTIDE_SHARE = 0.9;

/**
 * Whether `text` (letters only) is the residues of a protein or the bases of
 * a nucleic acid. Anything written wholly in IUPAC nucleotide codes is a
 * nucleotide sequence, however many ambiguity codes it has: M, K, R, S and
 * the rest are amino acids too, and a DNA file must never be misread. Only
 * text with a letter no nucleotide has (E, F, I, L, P, Q, …) and that is not
 * mostly A, C, G, T, U and N is a protein; text that is mostly bases with a
 * stray letter stays a nucleotide sequence, so its reader can say which
 * letters are wrong with it.
 */
export function guessAlphabet(text: string): Alphabet {
  if (text.length === 0 || isValidSequence(text) || !isValidProtein(text)) return 'nucleotide';
  const bases = text.match(PLAIN_BASES)?.length ?? 0;
  return bases / text.length >= NUCLEOTIDE_SHARE ? 'nucleotide' : 'protein';
}

/** Characters of a protein outside the amino-acid alphabet. */
export class InvalidResiduesError extends InvalidSequenceError {
  constructor(invalidCharacters: readonly string[]) {
    super(invalidCharacters);
    this.message = `Sequence contains characters outside the amino-acid alphabet: ${describeCharacters(invalidCharacters)}`;
    this.name = 'InvalidResiduesError';
  }
}

/** A paste of bases into a protein, or of residues into DNA (#66). */
export class AlphabetMismatchError extends InvalidSequenceError {
  constructor(into: Alphabet) {
    super([]);
    this.message =
      into === 'protein'
        ? 'These are bases; a protein takes amino-acid residues. Translate them first.'
        : 'These are amino-acid residues; a DNA sequence takes bases.';
    this.name = 'AlphabetMismatchError';
  }
}

/** Whether `text` is all letters of `alphabet`. */
export function isValidResidues(text: string, alphabet: Alphabet): boolean {
  return alphabet === 'protein' ? isValidProtein(text) : isValidSequence(text);
}

/**
 * Throws `InvalidSequenceError` (`InvalidResiduesError` for a protein) naming
 * the characters of `text` that are not in `alphabet`.
 */
export function assertValidResidues(text: string, alphabet: Alphabet): void {
  if (alphabet === 'nucleotide') {
    assertValidSequence(text);
    return;
  }
  if (isValidProtein(text)) return;
  const distinct = [...new Set(text.match(INVALID_PROTEIN_CHARS) ?? [])];
  throw new InvalidResiduesError(distinct);
}

/** `n` residues as a length: `4,361 bp`, or `147 aa` for a protein. */
export function formatLength(n: number, alphabet: Alphabet): string {
  return `${n.toLocaleString()} ${alphabet === 'protein' ? 'aa' : 'bp'}`;
}

/** Complement of one base. Unknown characters pass through unchanged. */
export function complementBase(base: string): string {
  return COMPLEMENT[base] ?? base;
}

export function complement(text: string): string {
  let out = '';
  for (let i = 0; i < text.length; i++) {
    const c = text.charAt(i);
    out += COMPLEMENT[c] ?? c;
  }
  return out;
}

export function reverseComplement(text: string): string {
  let out = '';
  for (let i = text.length - 1; i >= 0; i--) {
    const c = text.charAt(i);
    out += COMPLEMENT[c] ?? c;
  }
  return out;
}

export function reverse(text: string): string {
  let out = '';
  for (let i = text.length - 1; i >= 0; i--) out += text.charAt(i);
  return out;
}
