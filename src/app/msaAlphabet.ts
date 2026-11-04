import type { Alphabet } from '@/core';

/*
 * Which alphabet a set of records is in, from their letters (#369). The
 * multiple alignment scores bases and residues differently, and it used to
 * take the open document's alphabet for it, so a DNA plasmid open while
 * protein records were aligned silently scored them as bases.
 */

/** A, C, G, T, U and N: what a nucleotide sequence is made of, mostly. */
const CORE = new Set('ACGTUN');
/** The other IUPAC nucleotide codes, which a protein also uses as residues. */
const IUPAC = new Set('RYKMSWBDHV');
/** A record at least this share ACGTUN is nucleotide. */
const NUCLEOTIDE_SHARE = 0.9;
/** Below this share it is protein (a real protein is about a quarter ACGTN). */
const PROTEIN_SHARE = 0.75;
/** Fewer letters than this say nothing either way. */
const MIN_LETTERS = 10;

export type RecordKind = 'nucleotide' | 'protein' | 'unclear' | 'empty';

/** What the letters of one sequence say, ignoring gaps, stops and spaces. */
export function recordKind(sequence: string): RecordKind {
  let letters = 0;
  let core = 0;
  let iupac = 0;
  for (const ch of sequence.toUpperCase()) {
    if (ch < 'A' || ch > 'Z') continue;
    letters++;
    if (CORE.has(ch)) core++;
    else if (IUPAC.has(ch)) iupac++;
  }
  if (letters === 0) return 'empty';
  if (letters < MIN_LETTERS) return 'unclear';
  if (core / letters >= NUCLEOTIDE_SHARE) return 'nucleotide';
  // Mostly bases with a run of ambiguity codes (an alignment's R, Y, K...).
  if ((core + iupac) / letters >= 0.97 && core / letters >= 0.8) return 'nucleotide';
  if (core / letters < PROTEIN_SHARE) return 'protein';
  return 'unclear';
}

export interface AlphabetDetection {
  /** The alphabet the records are in; null when they do not say, or disagree. */
  readonly alphabet: Alphabet | null;
  readonly verdict: 'nucleotide' | 'protein' | 'mixed' | 'unclear' | 'empty';
  /** How many records read as each (a record with no letters is not counted). */
  readonly counts: {
    readonly nucleotide: number;
    readonly protein: number;
    readonly unclear: number;
  };
  /** A sentence saying what was found, for the user. */
  readonly message: string;
}

const plural = (n: number, word: string): string =>
  `${n.toLocaleString()} ${word}${n === 1 ? '' : 's'}`;

/**
 * Nucleotide or protein for a set of sequences. All of them agreeing gives
 * the alphabet; a mixture, or any that the letters cannot settle, gives
 * none and a message, so the user chooses instead of the app guessing.
 */
export function detectAlphabet(sequences: readonly string[]): AlphabetDetection {
  const counts = { nucleotide: 0, protein: 0, unclear: 0 };
  for (const s of sequences) {
    const kind = recordKind(s);
    if (kind !== 'empty') counts[kind]++;
  }
  const total = counts.nucleotide + counts.protein + counts.unclear;
  if (total === 0) {
    return { alphabet: null, verdict: 'empty', counts, message: 'No sequence letters yet.' };
  }
  if (counts.nucleotide > 0 && counts.protein > 0) {
    return {
      alphabet: null,
      verdict: 'mixed',
      counts,
      message: `The records are mixed: ${plural(counts.nucleotide, 'nucleotide record')} and ${plural(counts.protein, 'protein record')}. They cannot be aligned together; choose which kind to align, and remove the others.`,
    };
  }
  if (counts.unclear > 0) {
    return {
      alphabet: null,
      verdict: 'unclear',
      counts,
      message: `${plural(counts.unclear, 'record')} ${counts.unclear === 1 ? 'is' : 'are'} too short or too ambiguous in letters to tell bases from residues. Choose which kind it is.`,
    };
  }
  const alphabet: Alphabet = counts.nucleotide > 0 ? 'nucleotide' : 'protein';
  return {
    alphabet,
    verdict: alphabet,
    counts,
    message: `The letters read as ${alphabet === 'nucleotide' ? 'nucleotide (bases)' : 'protein (residues)'}.`,
  };
}

export type AlphabetChoice = 'auto' | Alphabet;

export interface AlphabetUse {
  /** What the alignment will use; null when it is not settled. */
  readonly alphabet: Alphabet | null;
  /** The user chose it, rather than the letters deciding. */
  readonly chosen: boolean;
  readonly detection: AlphabetDetection;
}

/** The alphabet in use: the user's choice, else what the letters say. */
export function alphabetInUse(sequences: readonly string[], choice: AlphabetChoice): AlphabetUse {
  const detection = detectAlphabet(sequences);
  return choice === 'auto'
    ? { alphabet: detection.alphabet, chosen: false, detection }
    : { alphabet: choice, chosen: true, detection };
}

/**
 * Whether the open document can join records in this alphabet, and if not,
 * why: a document in the other alphabet is left out and says so.
 */
export function documentJoins(
  docAlphabet: Alphabet,
  docLength: number,
  use: AlphabetUse,
): { readonly ok: boolean; readonly why: string | null } {
  if (docLength === 0) return { ok: false, why: 'The document is empty.' };
  if (use.alphabet === null) {
    return { ok: false, why: 'It can join once the kind of the records is settled.' };
  }
  if (use.alphabet !== docAlphabet) {
    return {
      ok: false,
      why: `It is a ${docAlphabet === 'protein' ? 'protein' : 'nucleotide'} document and the records are ${use.alphabet}; they would be scored as ${use.alphabet}, so it is left out.`,
    };
  }
  return { ok: true, why: null };
}
