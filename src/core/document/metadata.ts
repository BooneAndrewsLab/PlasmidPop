import { type LineageNode } from '../lineage/lineage';

/**
 * Descriptive metadata carried alongside the sequence. The field set mirrors
 * the GenBank header because that is the interchange format every tool
 * speaks, but nothing here is GenBank-specific: FASTA fills `description`,
 * SnapGene fills a few more, and the UI shows them all the same way.
 */

export interface Reference {
  readonly number: number;
  /** e.g. "(bases 1 to 2686)"; empty when absent. */
  readonly location: string;
  readonly authors: string;
  readonly consortium: string;
  readonly title: string;
  readonly journal: string;
  readonly pubmed: string;
  readonly remark: string;
}

/**
 * The molecule a document was forked from: its checksum (`seguid.ts`) and
 * the name of the file that held it. Written into a GenBank file as a
 * comment of ours, so a download says where it came from (`derivedComment.ts`).
 */
export interface DerivedFrom {
  /** `cdseguid=…`, in full. */
  readonly checksum: string;
  /** The file it was read from; may be empty for a document with no file. */
  readonly fileName: string;
}

/** A header entry we do not model explicitly, kept verbatim for round-trips. */
export interface HeaderEntry {
  readonly keyword: string;
  /** Multi-line values are joined with "\n". */
  readonly value: string;
}

export interface DocumentMetadata {
  /** GenBank DEFINITION / FASTA description. */
  readonly description: string;
  readonly accession: string;
  readonly version: string;
  readonly keywords: string;
  readonly source: string;
  readonly organism: string;
  /** Taxonomic lineage, as one line. */
  readonly taxonomy: string;
  /** e.g. "DNA", "ds-DNA", "RNA". */
  readonly moleculeType: string;
  /** GenBank division code, e.g. "SYN", "PLN". */
  readonly division: string;
  /** "DD-MMM-YYYY", as GenBank writes it. */
  readonly date: string;
  readonly dbLinks: readonly string[];
  readonly references: readonly Reference[];
  /** One entry per COMMENT block, lines joined with "\n". */
  readonly comments: readonly string[];
  readonly extraHeaders: readonly HeaderEntry[];
  /** The molecule this one was forked from, when it was forked from one. */
  readonly derivedFrom: DerivedFrom | null;
  /**
   * What the molecule was made from, when it is the product of a simulated
   * reaction (#67): the root is the document as it was made, with the
   * checksum it had then (`core/lineage`). Edits leave it alone; the
   * document's history says what happened since.
   */
  readonly lineage: LineageNode | null;
}

export const EMPTY_METADATA: DocumentMetadata = {
  description: '',
  accession: '',
  version: '',
  keywords: '',
  source: '',
  organism: '',
  taxonomy: '',
  moleculeType: '',
  division: '',
  date: '',
  dbLinks: [],
  references: [],
  comments: [],
  extraHeaders: [],
  derivedFrom: null,
  lineage: null,
};

export function createMetadata(partial: Partial<DocumentMetadata> = {}): DocumentMetadata {
  return { ...EMPTY_METADATA, ...partial };
}

export function createReference(
  partial: Partial<Reference> & Pick<Reference, 'number'>,
): Reference {
  return {
    location: '',
    authors: '',
    consortium: '',
    title: '',
    journal: '',
    pubmed: '',
    remark: '',
    ...partial,
  };
}
