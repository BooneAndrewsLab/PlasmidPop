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
    const shown = invalidCharacters
      .slice(0, 5)
      .map((c) => JSON.stringify(c))
      .join(', ');
    const more = invalidCharacters.length > 5 ? `, … (${invalidCharacters.length} distinct)` : '';
    super(`Sequence contains characters outside the IUPAC nucleotide alphabet: ${shown}${more}`);
    this.name = 'InvalidSequenceError';
    this.invalidCharacters = invalidCharacters;
  }
}

export function assertValidSequence(text: string): void {
  if (isValidSequence(text)) return;
  const distinct = [...new Set(text.match(INVALID_CHARS) ?? [])];
  throw new InvalidSequenceError(distinct);
}

/**
 * Prepares pasted or typed text for insertion: strips whitespace and digits
 * (so numbered GenBank/FASTA blocks paste cleanly) and rejects anything else
 * that is not an IUPAC nucleotide code.
 */
export function normalizeSequenceInput(text: string): string {
  const stripped = text.replace(STRIPPABLE, '');
  assertValidSequence(stripped);
  return stripped;
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
