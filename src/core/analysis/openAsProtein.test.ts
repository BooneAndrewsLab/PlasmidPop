import { SeqDocument } from '../document';
import { type FeatureInit, createFeature, rangeSegment } from '../features';
import { reverseComplement } from '../sequence';
import { cdsName, proteinFromCds, proteinFromTranslation } from './openAsProtein';

function cds(init: Partial<FeatureInit>) {
  return createFeature({ type: 'CDS', name: '', segments: [rangeSegment(0, 3)], ...init });
}

const organism = { organism: 'Escherichia coli', source: 'E. coli', taxonomy: 'Bacteria' };

describe('Open as protein (#66)', () => {
  it('makes a protein named after the CDS, without the stop that ends it', () => {
    // M K L E stop
    const dna = 'ATGAAACTGGAATAA';
    const doc = SeqDocument.create({
      name: 'pX',
      sequence: `GG${dna}GG`,
      metadata: { ...organism, accession: 'X1' },
    });
    const feature = cds({
      name: 'klE',
      segments: [rangeSegment(2, 17)],
      qualifiers: [{ name: 'product', value: 'KLE protein' }],
    });
    const protein = proteinFromCds(doc, feature);
    expect(protein.alphabet).toBe('protein');
    expect(protein.name).toBe('klE');
    expect(protein.sequence.toString()).toBe('MKLE');
    expect(protein.metadata.description).toBe('KLE protein');
    expect(protein.metadata.organism).toBe('Escherichia coli');
    // The DNA's own identity stays with the DNA.
    expect(protein.metadata.accession).toBe('');
    expect(protein.metadata.comments[0]).toBe(
      'Translated from CDS klE of pX, 3..17, with genetic code 1.',
    );
    const [whole] = protein.features.all();
    expect(whole).toMatchObject({ type: 'Protein', name: 'KLE protein' });
    expect(whole?.segments[0]).toMatchObject({ start: 0, end: 4 });
  });

  it('reads the reverse strand, the pieces of a join, codon_start and the genetic code', () => {
    // Exon 1 ATG AA | intron | exon 2 A TGA TGG, read with code 4, where TGA is Trp.
    const coding = 'ATGAA' + 'A' + 'TGATGG';
    const intron = 'GTAAGTCCCCAG';
    const forward = `C${coding.slice(0, 5)}${intron}${coding.slice(5)}C`;
    const joined = [rangeSegment(1, 6), rangeSegment(6 + intron.length, 7 + intron.length + 6)];
    const doc = SeqDocument.create({ sequence: forward });
    const table4 = [{ name: 'transl_table', value: '4' }];
    expect(
      proteinFromCds(doc, cds({ segments: joined, qualifiers: table4 })).sequence.toString(),
    ).toBe('MKWW');
    // The same gene on the bottom strand of the reverse complement.
    const rc = SeqDocument.create({ sequence: reverseComplement(forward) });
    const L = forward.length;
    const flipped = [...joined].reverse().map((s) => rangeSegment(L - s.end, L - s.start));
    expect(
      proteinFromCds(
        rc,
        cds({ strand: 'reverse', segments: flipped, qualifiers: table4 }),
      ).sequence.toString(),
    ).toBe('MKWW');
    // codon_start=2 skips a base first.
    const shifted = SeqDocument.create({ sequence: 'CATGAAA' });
    expect(
      proteinFromCds(
        shifted,
        cds({ segments: [rangeSegment(0, 7)], qualifiers: [{ name: 'codon_start', value: '2' }] }),
      ).sequence.toString(),
    ).toBe('MK');
  });

  it('reads /transl_except, and keeps a stop inside the CDS', () => {
    // M, a TGA read as selenocysteine, K, and a stop that ends it.
    const doc = SeqDocument.create({ sequence: 'ATGTGAAAATAA' });
    const sec = cds({
      name: 'selenoprotein',
      segments: [rangeSegment(0, 12)],
      qualifiers: [{ name: 'transl_except', value: '(pos:4..6,aa:Sec)' }],
    });
    expect(proteinFromCds(doc, sec).sequence.toString()).toBe('MUK');
    const broken = cds({ name: 'broken', segments: [rangeSegment(0, 12)] });
    expect(proteinFromCds(doc, broken).sequence.toString()).toBe('M*K');
  });

  it('names a CDS by its name, its product, its gene, its locus tag, or the document', () => {
    const doc = SeqDocument.create({ name: 'pX', sequence: 'ATGAAATAA' });
    const q = (name: string, value: string) => ({ name, value });
    expect(cdsName(doc, cds({ name: 'bla' }))).toBe('bla');
    expect(cdsName(doc, cds({ qualifiers: [q('gene', 'bla'), q('product', 'TEM-1')] }))).toBe(
      'TEM-1',
    );
    expect(cdsName(doc, cds({ qualifiers: [q('gene', 'bla')] }))).toBe('bla');
    expect(cdsName(doc, cds({ qualifiers: [q('locus_tag', 'b0001')] }))).toBe('b0001');
    expect(cdsName(doc, cds({}))).toBe('pX_CDS');
    // With no product the description is the name.
    expect(
      proteinFromCds(doc, cds({ name: 'x', segments: [rangeSegment(0, 9)] })).metadata.description,
    ).toBe('x');
  });

  it('makes a protein of an empty translation, with no feature over nothing', () => {
    const doc = SeqDocument.create({ sequence: 'ATGTAA' });
    const stopOnly = proteinFromCds(doc, cds({ segments: [rangeSegment(3, 6)] }));
    expect(stopOnly.length).toBe(0);
    expect(stopOnly.features.size).toBe(0);
  });

  it('makes a protein of a frame of the Translate panel', () => {
    const doc = SeqDocument.create({ name: 'pX', sequence: 'ATGAAA', metadata: organism });
    const protein = proteinFromTranslation(doc, 'MK*', 'pX_+1', 'frame +1 of 1–6', 11);
    expect(protein.alphabet).toBe('protein');
    expect(protein.sequence.toString()).toBe('MK*');
    expect(protein.name).toBe('pX_+1');
    expect(protein.metadata.description).toBe('Translation of frame +1 of 1–6 of pX');
    expect(protein.metadata.comments).toEqual([
      'Translated from frame +1 of 1–6 of pX, with genetic code 11.',
    ]);
    expect(protein.metadata.taxonomy).toBe('Bacteria');
  });
});

describe('Open as protein: the product (mutation tests)', () => {
  const q = (name: string, value: string) => ({ name, value });
  const pX = () => SeqDocument.create({ name: 'pX', sequence: 'ATGAAACTGTAA' });

  it('skips a blank name, and trims the one it takes', () => {
    expect(cdsName(pX(), cds({ name: '  ', qualifiers: [q('product', ' TEM-1 ')] }))).toBe('TEM-1');
    expect(cdsName(pX(), cds({ qualifiers: [q('product', ' '), q('gene', 'bla')] }))).toBe('bla');
  });

  it('gives the Protein feature the product, trimmed, as its name and qualifier', () => {
    const feature = cds({
      name: 'klE',
      segments: [rangeSegment(0, 12)],
      qualifiers: [q('product', '  KLE protein ')],
    });
    const protein = proteinFromCds(pX(), feature);
    expect(protein.metadata.description).toBe('KLE protein');
    const [whole] = protein.features.all();
    expect(whole?.name).toBe('KLE protein');
    expect(whole?.qualifiers).toEqual([{ name: 'product', value: 'KLE protein' }]);
  });

  it('leaves the Protein feature unnamed and without a qualifier when there is no product', () => {
    const protein = proteinFromCds(pX(), cds({ name: 'klE', segments: [rangeSegment(0, 12)] }));
    const [whole] = protein.features.all();
    expect(whole?.name).toBe('');
    expect(whole?.qualifiers).toEqual([]);
    expect(protein.metadata.description).toBe('klE');
  });

  it('takes a blank product for none', () => {
    const feature = cds({
      name: 'klE',
      segments: [rangeSegment(0, 12)],
      qualifiers: [q('product', '   ')],
    });
    const protein = proteinFromCds(pX(), feature);
    expect(protein.metadata.description).toBe('klE');
    const [whole] = protein.features.all();
    expect(whole?.name).toBe('');
    expect(whole?.qualifiers).toEqual([]);
  });
});

describe('features carried onto the protein (#95)', () => {
  // M K L E V C D F stop, the CDS at 6..33 of a 40 bp molecule.
  const coding = 'ATGAAACTGGAAGTGTGCGATTTTTAA';
  const dna = `GGGGGG${coding}GGGGGGG`;
  const cdsAt = (segments = [rangeSegment(6, 33)], strand: 'forward' | 'reverse' = 'forward') =>
    cds({ id: 'cds', name: 'gene', strand, segments });

  function proteinOf(features: readonly ReturnType<typeof createFeature>[], sequence = dna) {
    const doc = SeqDocument.create({ name: 'pX', sequence, features });
    const feature = doc.getFeature('cds');
    if (feature === undefined) throw new Error('no CDS');
    return proteinFromCds(doc, feature);
  }

  const carried = (protein: SeqDocument) =>
    protein.features.all().filter((f) => f.type !== 'Protein');

  it('places a domain inside the CDS on the residues it codes for', () => {
    // Bases 12..21 are codons 2, 3 and 4 (L, E, V).
    const domain = createFeature({
      type: 'misc_feature',
      name: 'domain',
      segments: [rangeSegment(12, 21)],
      qualifiers: [{ name: 'note', value: 'a domain' }],
    });
    const [onProtein] = carried(proteinOf([cdsAt(), domain]));
    expect(onProtein).toMatchObject({ type: 'misc_feature', name: 'domain' });
    expect(onProtein?.segments[0]).toMatchObject({
      start: 2,
      end: 5,
      partialStart: false,
      partialEnd: false,
    });
    expect(onProtein?.qualifiers).toEqual([{ name: 'note', value: 'a domain' }]);
  });

  it('covers a whole residue when only part of its codon is annotated', () => {
    // One base of codon 1 and two of codon 2.
    const site = createFeature({
      type: 'misc_feature',
      name: 'site',
      segments: [rangeSegment(11, 14)],
    });
    expect(carried(proteinOf([cdsAt(), site]))[0]?.segments[0]).toMatchObject({ start: 1, end: 3 });
  });

  it('keeps the piece inside the CDS and marks it partial there', () => {
    const over = createFeature({
      type: 'sig_peptide',
      name: 'signal',
      segments: [rangeSegment(0, 15)], // starts before the CDS
    });
    const [onProtein] = carried(proteinOf([cdsAt(), over]));
    expect(onProtein?.segments[0]).toMatchObject({ start: 0, end: 3, partialStart: true });
    const past = createFeature({
      type: 'mat_peptide',
      name: 'mature',
      segments: [rangeSegment(27, 40)], // runs past the CDS
    });
    const [tail] = carried(proteinOf([cdsAt(), past]));
    expect(tail?.segments[0]).toMatchObject({ partialEnd: true });
    // The stop is not a residue, so nothing covers it: the protein is 8 long.
    expect(tail?.segments[0]).toMatchObject({ kind: 'range', end: 8 });
  });

  it('reads a reverse-strand CDS in its own direction', () => {
    const sequence = reverseComplement(dna);
    // The same molecule the other way round: the CDS is at 7..34 reversed.
    const rc = cdsAt([rangeSegment(7, 34)], 'reverse');
    // The end of the protein is at the low bases here: 7..9 is the stop,
    // 10..12 the last residue (F) and 13..15 the one before it (D).
    const domain = createFeature({
      type: 'misc_feature',
      name: 'domain',
      segments: [rangeSegment(7, 16)],
    });
    const [onProtein] = carried(proteinOf([rc, domain], sequence));
    // The stop is not a residue, so the feature is D and F, cut off there.
    expect(onProtein?.segments[0]).toMatchObject({ start: 6, end: 8, partialEnd: true });
  });

  it('leaves out what is about the DNA, and what is not inside the CDS', () => {
    const promoter = createFeature({
      type: 'promoter',
      name: 'p',
      segments: [rangeSegment(6, 15)],
    });
    const elsewhere = createFeature({
      type: 'misc_feature',
      name: 'far',
      segments: [rangeSegment(0, 6)],
    });
    const gene = createFeature({ type: 'gene', name: 'gene', segments: [rangeSegment(6, 33)] });
    expect(carried(proteinOf([cdsAt(), promoter, elsewhere, gene]))).toEqual([]);
  });

  it('maps each piece of a join through the intron between them', () => {
    // Codons 0-1 from 6..12, then 18..33: the protein is M K V C D F.
    const spliced = cdsAt([rangeSegment(6, 12), rangeSegment(18, 33)]);
    const domain = createFeature({
      type: 'misc_feature',
      name: 'spans',
      segments: [rangeSegment(9, 21)],
    });
    const protein = proteinOf([spliced, domain]);
    expect(protein.sequence.toString()).toBe('MKVCDF');
    // The bases in the intron map to nothing; the two ends map to residues.
    expect(carried(protein)[0]?.segments[0]).toMatchObject({ start: 1, end: 3 });
  });
});
