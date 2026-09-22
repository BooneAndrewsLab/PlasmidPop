import { SeqDocument } from '../document';
import { type Feature, type Qualifier, createFeature, rangeSegment } from '../features';
import { checkCdsTranslation, checkTranslations } from './translationCheck';

//                0         1         2
//                012345678901234567890123456789
const SEQUENCE = 'ATGAAAGGGTGACCCAAATTTCCCGGGTTT';
const doc = SeqDocument.create({ sequence: SEQUENCE, topology: 'linear' });

function cds(qualifiers: Qualifier[], end = 12): Feature {
  return createFeature({
    id: 'cds',
    type: 'CDS',
    name: 'orf',
    segments: [rangeSegment(0, end)],
    qualifiers,
  });
}

describe('checkCdsTranslation', () => {
  it('says nothing when the stored translation is the one the bases give', () => {
    // MKG, with the terminal stop left off as GenBank writes it.
    expect(checkCdsTranslation(doc, cds([{ name: 'translation', value: 'MKG' }]))).toEqual([]);
    // Wrapped over lines, as a real record has it.
    expect(checkCdsTranslation(doc, cds([{ name: 'translation', value: 'M K\n  G' }]))).toEqual([]);
    // Nothing stored is nothing to disagree with.
    expect(checkCdsTranslation(doc, cds([]))).toEqual([]);
  });

  it('reports a translation of the wrong length', () => {
    expect(checkCdsTranslation(doc, cds([{ name: 'translation', value: 'MKGH' }]))).toEqual([
      { kind: 'length', featureId: 'cds', stored: 4, computed: 3 },
    ]);
  });

  it('reports where the two first differ, and how many differ in all', () => {
    expect(checkCdsTranslation(doc, cds([{ name: 'translation', value: 'MQG' }]))).toEqual([
      { kind: 'residue', featureId: 'cds', position: 2, stored: 'Q', computed: 'K', differences: 1 },
    ]);
    expect(checkCdsTranslation(doc, cds([{ name: 'translation', value: 'AQG' }]))).toEqual([
      { kind: 'residue', featureId: 'cds', position: 1, stored: 'A', computed: 'M', differences: 2 },
    ]);
  });

  it('excuses the residues neither side is claiming to know', () => {
    // Selenocysteine and pyrrolysine reach a file through /transl_except,
    // which we do not read; X on either side is a codon nobody could call.
    const ambiguous = SeqDocument.create({ sequence: 'ATGAANGGGTGA', topology: 'linear' });
    expect(checkCdsTranslation(ambiguous, cds([{ name: 'translation', value: 'MKG' }]))).toEqual([]);
    expect(checkCdsTranslation(doc, cds([{ name: 'translation', value: 'MUG' }]))).toEqual([]);
    expect(checkCdsTranslation(doc, cds([{ name: 'translation', value: 'MXG' }]))).toEqual([]);
  });

  it('reads the stored translation with the genetic code the feature names', () => {
    // TGA at 9..11 is a stop under the standard code, so the protein is MKG;
    // under table 2 it is tryptophan and the protein is MKGW.
    const mito = [
      { name: 'transl_table', value: '2' },
      { name: 'translation', value: 'MKGW' },
    ];
    expect(checkCdsTranslation(doc, cds(mito))).toEqual([]);
    expect(checkCdsTranslation(doc, cds([{ name: 'translation', value: 'MKGW' }]))).toEqual([
      { kind: 'length', featureId: 'cds', stored: 4, computed: 3 },
    ]);
  });

  it('reports a /transl_table that names no genetic code, translation or not', () => {
    expect(checkCdsTranslation(doc, cds([{ name: 'transl_table', value: '7' }]))).toEqual([
      { kind: 'unknown-table', featureId: 'cds', value: '7' },
    ]);
    const both = checkCdsTranslation(
      doc,
      cds([
        { name: 'transl_table', value: '7' },
        { name: 'translation', value: 'MQG' },
      ]),
    );
    expect(both.map((p) => p.kind)).toEqual(['unknown-table', 'residue']);
  });

  it('checks every coding feature of a document and nothing else', () => {
    const d = SeqDocument.create({
      sequence: SEQUENCE,
      topology: 'linear',
      features: [
        cds([{ name: 'translation', value: 'MKG' }]),
        createFeature({
          id: 'gene',
          type: 'gene',
          name: 'orf',
          segments: [rangeSegment(0, 12)],
          // A gene is not translated, so a stray qualifier on one is not ours
          // to argue with.
          qualifiers: [{ name: 'translation', value: 'NONSENSE' }],
        }),
        createFeature({
          id: 'cds2',
          type: 'CDS',
          name: 'other',
          segments: [rangeSegment(12, 24)],
          qualifiers: [{ name: 'translation', value: 'PKF' }],
        }),
      ],
    });
    expect(checkTranslations(d)).toEqual([
      { kind: 'length', featureId: 'cds2', stored: 3, computed: 4 },
    ]);
  });
});
