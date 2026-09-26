import { type Alphabet } from '../sequence';

/**
 * What can be done with a document, by its alphabet (#66). Everything that
 * reads bases as DNA — a complement strand, enzymes, reading frames, primers,
 * the reactions of the bench — has nothing to work on in a protein, and the
 * one thing that reads residues has nothing to work on in DNA. The UI asks
 * this rather than testing the alphabet itself, so a tool is switched off in
 * one place and every control that reaches it (a panel, a toolbar toggle, a
 * key, a menu item) goes with it.
 */
export type DocumentTool =
  /** The bottom strand drawn under the bases. */
  | 'complement'
  /** Amino acids drawn under CDS features. */
  | 'translations'
  /** Restriction sites: the Enzymes panel, cut sites on the views, digests. */
  | 'enzymes'
  | 'orfs'
  /** Six-frame translation and Open as protein. */
  | 'translate'
  | 'primers'
  /** PCR, digests to the shelf, mutagenesis, Gateway, the Cloning Bench. */
  | 'cloning'
  /** Aligning a sequence to the document: reads to DNA, a protein to a protein. */
  | 'align'
  /** Detect features: the library of common parts is DNA (item 59). */
  | 'detectFeatures'
  | 'reverseComplement'
  /** Making the molecule circular, setting its origin, and the circular map. */
  | 'circular'
  /** Sticky ends and blunting them. */
  | 'ends'
  /** The dam/dcm methylation of the host the DNA was grown in. */
  | 'methylation'
  /** Molecular weight, pI and extinction coefficient. */
  | 'proteinProperties';

const NUCLEOTIDE_TOOLS: ReadonlySet<DocumentTool> = new Set<DocumentTool>([
  'complement',
  'translations',
  'enzymes',
  'orfs',
  'translate',
  'primers',
  'cloning',
  'align',
  'detectFeatures',
  'reverseComplement',
  'circular',
  'ends',
  'methylation',
]);

const PROTEIN_TOOLS: ReadonlySet<DocumentTool> = new Set<DocumentTool>([
  'proteinProperties',
  // Two proteins align by BLOSUM62 rather than by bases (#95).
  'align',
]);

/** Whether `tool` applies to a document of this alphabet. */
export function hasTool(doc: { readonly alphabet: Alphabet }, tool: DocumentTool): boolean {
  return (doc.alphabet === 'protein' ? PROTEIN_TOOLS : NUCLEOTIDE_TOOLS).has(tool);
}

/** What one letter of the document is called: `base` or `residue`. */
export function unitName(alphabet: Alphabet, plural = false): string {
  const word = alphabet === 'protein' ? 'residue' : 'base';
  return plural ? `${word}s` : word;
}
