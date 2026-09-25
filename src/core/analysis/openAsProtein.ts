import { type DocumentMetadata } from '../document/metadata';
import { SeqDocument } from '../document/seqDocument';
import {
  type Feature,
  type Qualifier,
  createFeature,
  firstQualifier,
  formatLocation,
} from '../features';
import { rangeSegment } from '../features/segment';
import { translateCds } from './cdsTranslation';
import { STOP, type TranslationTable } from './codons';

/**
 * Translate ▸ Open as protein (#66): the protein a CDS or a stretch of DNA
 * codes for, as a document of its own. It is made here rather than in the
 * view so that everything about the translation — the genetic code, the
 * frame, `/transl_except`, the pieces of a join and the strand — is the one
 * `translateCds` already reads, and a test can hold it to that.
 */

/** What a CDS is called: its name, else what it makes, else the gene it is of. */
export function cdsName(doc: SeqDocument, feature: Feature): string {
  for (const candidate of [
    feature.name,
    firstQualifier(feature, 'product'),
    firstQualifier(feature, 'gene'),
    firstQualifier(feature, 'locus_tag'),
  ]) {
    const name = candidate?.trim() ?? '';
    if (name !== '') return name;
  }
  return `${doc.name}_CDS`;
}

/**
 * What a protein keeps of the DNA's header: the organism is the protein's
 * too. The rest — accession, references, the molecule's own comments and
 * what it was made from — describes the DNA and stays with it.
 */
function inheritedMetadata(doc: SeqDocument): Partial<DocumentMetadata> {
  const m = doc.metadata;
  return { source: m.source, organism: m.organism, taxonomy: m.taxonomy, division: m.division };
}

/** The whole chain as one `Protein` feature, as GenPept annotates one, named for what it is. */
function proteinFeature(length: number, product: string | undefined): Feature[] {
  if (length === 0) return [];
  const qualifiers: Qualifier[] =
    product === undefined ? [] : [{ name: 'product', value: product }];
  return [
    createFeature({
      type: 'Protein',
      name: product ?? '',
      segments: [rangeSegment(0, length)],
      qualifiers,
    }),
  ];
}

/**
 * The protein a CDS codes for, named after the CDS. The translation is the
 * conceptual one of the Translations row — the feature's own genetic code,
 * `/codon_start`, `/transl_except`, every piece of a join, the reverse
 * strand read reverse-complemented — with the stop that ends it left off,
 * since a stop is not a residue. A stop inside the CDS is kept, as `*`: it
 * is what the bases say, and hiding it would hide a fault.
 */
export function proteinFromCds(doc: SeqDocument, feature: Feature): SeqDocument {
  const t = translateCds(doc, feature);
  const residues = t.protein.endsWith(STOP) ? t.protein.slice(0, -1) : t.protein;
  const name = cdsName(doc, feature);
  const product = firstQualifier(feature, 'product')?.trim();
  const where = formatLocation(feature, doc.length, doc.topology);
  return SeqDocument.create({
    name,
    sequence: residues,
    alphabet: 'protein',
    features: proteinFeature(residues.length, product === '' ? undefined : product),
    metadata: {
      ...inheritedMetadata(doc),
      description: product === undefined || product === '' ? name : product,
      comments: [
        `Translated from ${feature.type} ${name} of ${doc.name}, ${where}, with genetic code ${t.table}.`,
      ],
    },
  });
}

/**
 * A protein from residues already translated — a frame of the Translate
 * panel — named `name`, with where it came from said in its description.
 */
export function proteinFromTranslation(
  doc: SeqDocument,
  residues: string,
  name: string,
  from: string,
  table: TranslationTable,
): SeqDocument {
  return SeqDocument.create({
    name,
    sequence: residues,
    alphabet: 'protein',
    metadata: {
      ...inheritedMetadata(doc),
      description: `Translation of ${from} of ${doc.name}`,
      comments: [`Translated from ${from} of ${doc.name}, with genetic code ${table}.`],
    },
  });
}
