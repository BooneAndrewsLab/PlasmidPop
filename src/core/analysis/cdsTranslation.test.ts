import { SeqDocument } from '../document';
import { type Feature, createFeature, rangeSegment, siteSegment } from '../features';
import { CdsTranslations, isCodingFeature, translateCds } from './cdsTranslation';

function cds(init: Partial<Feature> & { segments: Feature['segments'] }): Feature {
  return createFeature({ id: 'cds', type: 'CDS', name: 'orf', ...init });
}

describe('translateCds', () => {
  //                 0         1         2
  //                 012345678901234567890123456789
  const forward = 'ATGAAAGGGTGACCCAAATTTCCCGGGTTT';
  const doc = SeqDocument.create({ sequence: forward, topology: 'linear' });

  it('translates a plain forward CDS codon by codon', () => {
    const t = translateCds(doc, cds({ segments: [rangeSegment(0, 12)] }));
    expect(t.protein).toBe('MKG*');
    expect(t.codons.map((c) => c.positions)).toEqual([
      [0, 1, 2],
      [3, 4, 5],
      [6, 7, 8],
      [9, 10, 11],
    ]);
    expect(t.codons[3]?.aminoAcid).toBe('*');
    expect(t.codonStart).toBe(1);
    expect(t.table).toBe(1);
  });

  it('drops trailing bases that do not fill a codon', () => {
    const t = translateCds(doc, cds({ segments: [rangeSegment(0, 11)] }));
    expect(t.protein).toBe('MKG');
  });

  it('honours /codon_start', () => {
    const t = translateCds(
      doc,
      cds({
        segments: [rangeSegment(1, 12)],
        qualifiers: [{ name: 'codon_start', value: '3' }],
      }),
    );
    // Reads from position 3: AAA GGG TGA
    expect(t.protein).toBe('KG*');
    expect(t.codons[0]?.positions).toEqual([3, 4, 5]);
    expect(t.codonStart).toBe(3);
  });

  it('reads reverse-strand features from their 5′ end with descending positions', () => {
    // Reverse complement of positions 12..21 (CCCAAATTTC) is GAAATTTGGG → E I W? no: GAA ATT TGG G
    const rcDoc = SeqDocument.create({ sequence: 'TTACATGGGTTT' }); // rc = AAACCCATGTAA
    const t = translateCds(rcDoc, cds({ strand: 'reverse', segments: [rangeSegment(0, 12)] }));
    expect(t.protein).toBe('KPM*');
    expect(t.codons[0]?.positions).toEqual([11, 10, 9]);
    expect(t.codons[3]?.positions).toEqual([2, 1, 0]);
  });

  it('concatenates join segments so a codon can straddle the junction', () => {
    // ATGAA | AGGG TGA: exon 1 = 0..5, exon 2 = 6..13 skipping base 5
    const t = translateCds(doc, cds({ segments: [rangeSegment(0, 5), rangeSegment(6, 13)] }));
    // text = ATGAA + GGGTGAC = ATGAAGGGTGAC → ATG AAG GGT GAC
    expect(t.protein).toBe('MKGD');
    expect(t.codons[1]?.positions).toEqual([3, 4, 6]);
  });

  it('follows a CDS around the origin of a circular sequence', () => {
    // Sequence rotated so the ORF ATG AAA GGG TGA starts at position 27.
    const circ = SeqDocument.create({
      sequence: forward.slice(3) + forward.slice(0, 3),
      topology: 'circular',
    });
    const t = translateCds(circ, cds({ segments: [rangeSegment(27, 39)] }));
    expect(t.protein).toBe('MKG*');
    expect(t.codons[0]?.positions).toEqual([27, 28, 29]);
    expect(t.codons[1]?.positions).toEqual([0, 1, 2]);
  });

  it('shows alternative start codons as M under table 11 unless the 5′ end is partial', () => {
    const gtg = SeqDocument.create({ sequence: 'GTGAAATAA' });
    const table11 = [{ name: 'transl_table', value: '11' }];
    expect(translateCds(gtg, cds({ segments: [rangeSegment(0, 9)] })).protein).toBe('VK*');
    expect(
      translateCds(gtg, cds({ segments: [rangeSegment(0, 9)], qualifiers: table11 })).protein,
    ).toBe('MK*');
    expect(
      translateCds(
        gtg,
        cds({ segments: [rangeSegment(0, 9, { partialStart: true })], qualifiers: table11 }),
      ).protein,
    ).toBe('VK*');
    // On the reverse strand the 5' end is the last segment's end.
    const rc = SeqDocument.create({ sequence: 'TTATTTCAC' }); // rc = GTGAAATAA
    expect(
      translateCds(
        rc,
        cds({ strand: 'reverse', segments: [rangeSegment(0, 9)], qualifiers: table11 }),
      ).protein,
    ).toBe('MK*');
    expect(
      translateCds(
        rc,
        cds({
          strand: 'reverse',
          segments: [rangeSegment(0, 9, { partialEnd: true })],
          qualifiers: table11,
        }),
      ).protein,
    ).toBe('VK*');
  });

  it('ignores site segments and recognises coding features', () => {
    const withSite = cds({ segments: [siteSegment(2), rangeSegment(0, 6)] });
    expect(translateCds(doc, withSite).protein).toBe('MK');
    expect(isCodingFeature(withSite)).toBe(true);
    expect(isCodingFeature(cds({ segments: [siteSegment(2)] }))).toBe(false);
    expect(isCodingFeature(createFeature({ type: 'gene', segments: [rangeSegment(0, 6)] }))).toBe(
      false,
    );
  });
});

describe('CdsTranslations', () => {
  it('caches per feature and is rebuilt per document', () => {
    const doc = SeqDocument.create({ sequence: 'ATGAAATAA' });
    const feature = cds({ segments: [rangeSegment(0, 9)] });
    const cache = new CdsTranslations(doc);
    expect(cache.get(feature)).toBe(cache.get(feature));
    expect(cache.get(feature).protein).toBe('MK*');
    const edited = doc.replace({ start: 3, end: 6 }, 'CCC');
    expect(new CdsTranslations(edited).get(feature).protein).toBe('MP*');
  });
});
