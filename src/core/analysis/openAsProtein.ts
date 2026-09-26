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
import { type CdsTranslation, translateCds } from './cdsTranslation';
import { STOP, type TranslationTable } from './codons';
import { rangePieces } from '../range';

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
 * Feature types that are about the DNA and mean nothing on a protein (#95):
 * a promoter or an intron inside a CDS is not a part of the chain. Anything
 * else annotated inside the CDS — a domain, a site, a signal peptide, a
 * plain `misc_feature` with a `/note` — is carried over, since a denylist
 * keeps an unusual but meaningful annotation where an allowlist would drop
 * it.
 */
const DNA_ONLY_TYPES: ReadonlySet<string> = new Set([
  'source',
  'gene',
  'CDS',
  'mRNA',
  'exon',
  'intron',
  'primer_bind',
  'promoter',
  'terminator',
  'enhancer',
  'RBS',
  'polyA_signal',
  'polyA_site',
  'rep_origin',
  'protein_bind',
  'misc_binding',
  'regulatory',
  'LTR',
  'oriT',
  'misc_recomb',
  'centromere',
  'telomere',
  'mobile_element',
  "5'UTR",
  "3'UTR",
  'STS',
  'assembly_gap',
  'gap',
]);

/** Where each base of the CDS sits in the protein: base position → residue. */
function codonOfBase(t: CdsTranslation): Map<number, number> {
  const at = new Map<number, number>();
  for (const codon of t.codons) {
    for (const p of codon.positions) at.set(p, codon.index);
  }
  return at;
}

/**
 * The residues a feature's segment covers, and whether it runs outside the
 * CDS at either end. Positions are walked in reading order — descending for
 * a reverse-strand CDS — so "before" and "after" mean what they do in the
 * protein.
 */
function residuesOf(
  segment: { readonly start: number; readonly end: number },
  at: ReadonlyMap<number, number>,
  length: number,
  reverse: boolean,
): { start: number; end: number; partialStart: boolean; partialEnd: boolean } | null {
  const positions: number[] = [];
  for (const piece of rangePieces(segment, length)) {
    for (let p = piece.start; p < piece.end; p++) positions.push(p);
  }
  if (reverse) positions.reverse();
  let first = -1;
  let last = -1;
  let lowest = Infinity;
  let highest = -Infinity;
  positions.forEach((p, i) => {
    const codon = at.get(p);
    if (codon === undefined) return;
    if (first < 0) first = i;
    last = i;
    lowest = Math.min(lowest, codon);
    highest = Math.max(highest, codon);
  });
  if (first < 0) return null;
  return {
    start: lowest,
    end: highest + 1,
    // Bases of the feature before the first one that is in the CDS, or
    // after the last, are outside it: the protein has only a part of it.
    partialStart: first > 0,
    partialEnd: last < positions.length - 1,
  };
}

/**
 * The features of the DNA that belong to the protein (#95): everything
 * annotated inside the CDS that is not about the DNA itself — domains,
 * sites, signal and mature peptides, a `misc_feature` marking a motif —
 * placed on the residues they code for. A feature that runs past the CDS is
 * kept for the part inside it and marked partial there, as GenBank's `<`
 * and `>` mean.
 */
export function featuresOntoProtein(
  doc: SeqDocument,
  cds: Feature,
  t: CdsTranslation,
  residues: number,
): Feature[] {
  const at = codonOfBase(t);
  const reverse = t.strand === 'reverse';
  const out: Feature[] = [];
  for (const feature of doc.features.all()) {
    if (feature.id === cds.id || DNA_ONLY_TYPES.has(feature.type)) continue;
    const segments = [];
    for (const seg of feature.segments) {
      if (seg.kind !== 'range') continue;
      const mapped = residuesOf(seg, at, doc.length, reverse);
      if (mapped === null) continue;
      // The stop is not a residue of the protein, so nothing may cover it.
      const end = Math.min(mapped.end, residues);
      if (end <= mapped.start) continue;
      segments.push(
        rangeSegment(mapped.start, end, {
          partialStart: mapped.partialStart,
          partialEnd: mapped.partialEnd || end < mapped.end,
        }),
      );
    }
    if (segments.length === 0) continue;
    out.push(
      createFeature({
        type: feature.type,
        name: feature.name,
        // A protein has one strand; a feature read from the other strand of
        // the DNA is on it either way, as its codons are.
        strand: 'forward',
        segments: segments.sort((a, b) => a.start - b.start),
        qualifiers: feature.qualifiers,
      }),
    );
  }
  return out;
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
    features: [
      ...proteinFeature(residues.length, product === '' ? undefined : product),
      // What was annotated inside the CDS on the DNA comes with it (#95).
      ...featuresOntoProtein(doc, feature, t, residues.length),
    ],
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
