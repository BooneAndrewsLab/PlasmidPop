import {
  type Feature,
  type Range,
  type SeqDocument,
  type Strand,
  type TranslationTable,
  DEFAULT_TABLE,
  codingFeaturesOf,
  formatLocation,
  geneticCode,
  isCodingFeature,
  translateCds,
} from '@/core';
import { formatFastaRecord } from '@/io';

import { fileNameFor } from './saveFile';
import { rangeBounds } from './sixFrameExport';

/** Protein FASTA (item 149): the translation of annotated CDS features, an ORF or a selection. */

function stemOf(doc: SeqDocument): string {
  return fileNameFor(doc, 'fasta').replace(/\.fasta$/, '');
}

/** A label as one token of a file name or FASTA identifier. */
function token(label: string): string {
  return label
    .trim()
    .replace(/[^A-Za-z0-9._-]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

/** The genetic code, named only when it is not the standard one (as in the six-frame export). */
function codeNote(table: TranslationTable): string {
  return table === DEFAULT_TABLE ? '' : `, genetic code ${table} (${geneticCode(table).name})`;
}

/** The protein as written to a file: a terminal stop is the end of the record, not a residue. */
function withoutStop(protein: string): string {
  return protein.endsWith('*') ? protein.slice(0, -1) : protein;
}

/** The CDS features of a DNA document that translate to at least one residue, in document order. */
export function exportableCds(doc: SeqDocument): readonly Feature[] {
  if (doc.isProtein) return [];
  return doc.features
    .all()
    .filter((f) => isCodingFeature(f) && withoutStop(translateCds(doc, f).protein) !== '');
}

/**
 * The CDS features whose proteins a selected gene or mRNA downloads (#452):
 * the ones inside it that translate to at least one residue. The gene's own
 * span, introns and UTRs included, is never translated.
 */
export function geneCds(doc: SeqDocument, feature: Feature): readonly Feature[] {
  return codingFeaturesOf(doc, feature).filter(
    (f) => withoutStop(translateCds(doc, f).protein) !== '',
  );
}

function featureLabel(f: Feature): string {
  return f.name.trim() === '' ? f.type : f.name.trim();
}

/** One record per CDS in `features`: `>doc_label_1-99 doc label CDS join(…), 33 aa`. */
export function cdsProteinFasta(doc: SeqDocument, features: readonly Feature[]): string {
  const stem = stemOf(doc);
  const used = new Map<string, number>();
  let out = '';
  for (const f of features) {
    const t = translateCds(doc, f);
    const protein = withoutStop(t.protein);
    if (protein === '') continue;
    const label = featureLabel(f);
    const base = `${stem}_${token(label) || 'CDS'}`;
    // Two features with one name stay distinguishable by their ids.
    const n = (used.get(base) ?? 0) + 1;
    used.set(base, n);
    const id = n === 1 ? base : `${base}_${String(n)}`;
    const location = formatLocation(f, doc.length, doc.topology);
    out += formatFastaRecord(
      `${id} ${doc.name} ${label} CDS ${location}, ${String(protein.length)} aa${codeNote(t.table)}`,
      protein,
    );
  }
  return out;
}

/** File name for the proteins of every CDS (`feature` null) or of one. */
export function cdsProteinFileName(doc: SeqDocument, feature: Feature | null = null): string {
  const stem = stemOf(doc);
  return feature === null
    ? `${stem}_proteins.faa`
    : `${stem}_${token(featureLabel(feature)) || 'CDS'}.faa`;
}

/** File name for the protein(s) of a gene or mRNA with `count` CDS features: named for the gene. */
export function geneProteinFileName(doc: SeqDocument, gene: Feature, count: number): string {
  const name = `${stemOf(doc)}_${token(featureLabel(gene)) || gene.type}`;
  return count > 1 ? `${name}_proteins.faa` : `${name}.faa`;
}

/**
 * One protein of a range read from `strand` (an ORF, or the selection in
 * frame +1), already translated by the caller with `table`.
 */
export function rangeProteinFasta(
  doc: SeqDocument,
  range: Range,
  strand: Strand,
  protein: string,
  table: TranslationTable,
  what: 'ORF' | 'selection',
): string {
  const { from, to } = rangeBounds(range, doc.length);
  const residues = withoutStop(protein);
  const where =
    strand === 'reverse'
      ? `complement(${String(from)}..${String(to)})`
      : `${String(from)}..${String(to)}`;
  return formatFastaRecord(
    `${stemOf(doc)}_${what}_${String(from)}-${String(to)}${strand === 'reverse' ? '_rev' : ''} ${doc.name} ${what} ${where}, ${String(residues.length)} aa${codeNote(table)}`,
    residues,
  );
}

/** File name for the protein of an ORF or a selection. */
export function rangeProteinFileName(doc: SeqDocument, range: Range, strand: Strand): string {
  const { from, to } = rangeBounds(range, doc.length);
  return `${stemOf(doc)}_${String(from)}-${String(to)}${strand === 'reverse' ? '_rev' : ''}.faa`;
}
