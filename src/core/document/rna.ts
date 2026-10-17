import { type SeqDocument } from './seqDocument';

/**
 * Whether a document is an RNA (#113): a nucleotide document whose molecule
 * type says RNA and not DNA ("RNA", "mRNA", "ss-RNA"; not "DNA", "ds-DNA" or
 * a "DNA/RNA" hybrid). The molecule type is the only thing that says so: the
 * sequence stays T, as GenBank and SnapGene spell an RNA's bases, and the
 * sequence view only draws U in its place.
 */
export function isRnaDocument(doc: Pick<SeqDocument, 'isProtein' | 'metadata'>): boolean {
  const type = doc.metadata.moleculeType;
  return !doc.isProtein && /rna/i.test(type) && !/dna/i.test(type);
}

/** Bases as an RNA reads them: every T drawn as U, case kept. */
export function toRnaLetters(text: string): string {
  return text.replace(/T/g, 'U').replace(/t/g, 'u');
}

/** Bases as the model keeps them: every U read as T, case kept. */
export function fromRnaLetters(text: string): string {
  return text.replace(/U/g, 'T').replace(/u/g, 't');
}
