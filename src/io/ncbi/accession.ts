/**
 * Accession numbers, as typed into Open from NCBI (#65, item 58).
 *
 * The format is checked before anything is sent: a typo is caught here
 * rather than costing a request, and only a string that looks like an
 * accession ever leaves the browser. The patterns are NCBI's own
 * (https://www.ncbi.nlm.nih.gov/genbank/acc_prefix/ and the RefSeq prefix
 * table), each with an optional `.version`.
 */

/** Which Entrez database an accession belongs to. */
export type AccessionKind = 'nucleotide' | 'protein';

const VERSION = String.raw`(?:\.\d+)?`;

/** INSDC nucleotide (GenBank, ENA, DDBJ), WGS/TSA/TLS, MGA and RefSeq nucleotide. */
const NUCLEOTIDE = new RegExp(
  [
    String.raw`[A-Z]\d{5}`,
    String.raw`[A-Z]{2}\d{6}`,
    String.raw`[A-Z]{2}\d{8}`,
    String.raw`[A-Z]{4}\d{8,10}`,
    String.raw`[A-Z]{6}\d{9,11}`,
    String.raw`[A-Z]{5}\d{7}`,
    String.raw`(?:AC|NC|NG|NT|NW|NZ|NM|NR|XM|XR)_[A-Z]{0,6}\d{6,}`,
  ]
    .map((p) => `^${p}${VERSION}$`)
    .join('|'),
);

/** INSDC protein ids and RefSeq protein. */
const PROTEIN = new RegExp(
  [String.raw`[A-Z]{3}\d{5}`, String.raw`[A-Z]{3}\d{7}`, String.raw`(?:AP|NP|YP|XP|WP)_\d{6,}`]
    .map((p) => `^${p}${VERSION}$`)
    .join('|'),
);

/** The kind of an accession (already trimmed and upper-cased), or null when it is not one. */
export function accessionKind(accession: string): AccessionKind | null {
  if (NUCLEOTIDE.test(accession)) return 'nucleotide';
  if (PROTEIN.test(accession)) return 'protein';
  return null;
}

/** At most this many accessions go in one request. */
export const MAX_ACCESSIONS = 20;

export interface AccessionList {
  /** Nucleotide accessions, upper-cased, each once, in the order typed. */
  readonly nucleotide: readonly string[];
  readonly protein: readonly string[];
  /** What was typed and is not an accession, as typed. */
  readonly invalid: readonly string[];
}

/**
 * Splits what was typed into accessions: separated by spaces, commas or
 * semicolons, in any case. A pasted NCBI address counts as its last path
 * segment, so `https://www.ncbi.nlm.nih.gov/nuccore/L09137.2` is `L09137.2`.
 */
export function parseAccessions(input: string): AccessionList {
  const nucleotide: string[] = [];
  const protein: string[] = [];
  const invalid: string[] = [];
  for (const token of input.split(/[\s,;]+/)) {
    if (token === '') continue;
    const segments = token
      .replace(/[?#].*$/, '')
      .split('/')
      .filter((s) => s !== '');
    const accession = (segments[segments.length - 1] ?? '').toUpperCase();
    const kind = accessionKind(accession);
    const into = kind === 'nucleotide' ? nucleotide : kind === 'protein' ? protein : invalid;
    const value = kind === null ? token : accession;
    if (!into.includes(value)) into.push(value);
  }
  return { nucleotide, protein, invalid };
}
