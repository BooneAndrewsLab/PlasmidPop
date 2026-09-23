import { SeqDocument } from '../document';
import { type Feature, createFeature, rangeSegment, siteSegment } from '../features';
import {
  CdsTranslations,
  codonIndexAt,
  codonSpan,
  isCodingFeature,
  translateCds,
} from './cdsTranslation';

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

  it('reads a CDS with the genetic code its /transl_table names', () => {
    // TGA at 9..11 is a stop under the standard code and tryptophan under
    // the vertebrate mitochondrial one, which is the whole point of table 2.
    const mito = translateCds(
      doc,
      cds({
        segments: [rangeSegment(0, 12)],
        qualifiers: [{ name: 'transl_table', value: '2' }],
      }),
    );
    expect(mito.protein).toBe('MKGW');
    expect(mito.table).toBe(2);
    expect(mito.unknownTable).toBeNull();
  });

  it('says so rather than guessing when /transl_table names no code', () => {
    // NCBI withdrew table 7; reading such a feature with the standard code
    // is a guess, and one the caller can tell the user about.
    const t = translateCds(
      doc,
      cds({
        segments: [rangeSegment(0, 12)],
        qualifiers: [{ name: 'transl_table', value: '7' }],
      }),
    );
    expect(t.protein).toBe('MKG*');
    expect(t.table).toBe(1);
    expect(t.unknownTable).toBe('7');
    const nonsense = translateCds(
      doc,
      cds({
        segments: [rangeSegment(0, 12)],
        qualifiers: [{ name: 'transl_table', value: 'bacterial' }],
      }),
    );
    expect(nonsense.table).toBe(1);
    expect(nonsense.unknownTable).toBe('bacterial');
  });

  describe('/transl_except', () => {
    // ATG TGA AAA TAA: the TGA at 4..6 is a stop unless an exception says otherwise.
    const sec = 'ATGTGAAAATAA';
    const except = (value: string) => ({ name: 'transl_except', value });

    it('reads the codon it names as the residue it gives', () => {
      const d = SeqDocument.create({ sequence: sec });
      const t = translateCds(
        d,
        cds({ segments: [rangeSegment(0, 12)], qualifiers: [except('(pos:4..6,aa:Sec)')] }),
      );
      expect(t.protein).toBe('MUK*');
      expect(t.codons[1]?.aminoAcid).toBe('U');
      expect(t.unusedExceptions).toEqual([]);
      const pyl = translateCds(
        d,
        cds({ segments: [rangeSegment(0, 12)], qualifiers: [except('(pos:4..6,aa:Pyl)')] }),
      );
      expect(pyl.protein).toBe('MOK*');
    });

    it('finds the codon on the reverse strand', () => {
      // The same gene written on the bottom strand: its TGA is at 7..9.
      const d = SeqDocument.create({ sequence: 'TTATTTTCACAT' });
      const t = translateCds(
        d,
        cds({
          strand: 'reverse',
          segments: [rangeSegment(0, 12)],
          qualifiers: [except('(pos:complement(7..9),aa:Sec)')],
        }),
      );
      expect(t.protein).toBe('MUK*');
    });

    it('finds a codon that straddles the origin', () => {
      // Rotated so the ATG is at 8..10 and the TGA is base 11, then 0..1.
      const d = SeqDocument.create({
        sequence: sec.slice(4) + sec.slice(0, 4),
        topology: 'circular',
      });
      const t = translateCds(
        d,
        cds({
          segments: [rangeSegment(8, 20)],
          qualifiers: [except('(pos:join(12,1..2),aa:Sec)')],
        }),
      );
      expect(t.protein).toBe('MUK*');
      expect(t.unusedExceptions).toEqual([]);
    });

    it('overrules the start codon too', () => {
      const d = SeqDocument.create({ sequence: sec });
      const t = translateCds(
        d,
        cds({ segments: [rangeSegment(0, 12)], qualifiers: [except('(pos:1..3,aa:Leu)')] }),
      );
      expect(t.protein).toBe('L*K*');
    });

    it('lets a TERM of fewer than three bases complete a stop past the annotation', () => {
      // ATG AAA TA, the last A added by the poly(A) tail.
      const d = SeqDocument.create({ sequence: 'ATGAAATA' });
      const t = translateCds(
        d,
        cds({ segments: [rangeSegment(0, 8)], qualifiers: [except('(pos:7..8,aa:TERM)')] }),
      );
      expect(t.protein).toBe('MK');
      expect(t.unusedExceptions).toEqual([]);
    });

    it('says which exceptions it could not apply, and reads those codons as usual', () => {
      const d = SeqDocument.create({ sequence: sec });
      const values = [
        '(pos:5..7,aa:Sec)', // not in frame
        '(pos:4..6,aa:Foo)', // no such amino acid
        'pos:4..6,aa:Sec', // not the (pos:…) form
        '(pos:40..42,aa:Sec)', // off the sequence
      ];
      const t = translateCds(
        d,
        cds({ segments: [rangeSegment(0, 12)], qualifiers: values.map(except) }),
      );
      expect(t.protein).toBe('M*K*');
      expect(t.unusedExceptions).toEqual(values);
    });
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

describe('codonIndexAt', () => {
  const doc = SeqDocument.create({ sequence: 'ATGAAAGGGTGACCC', topology: 'linear' });

  it('finds the codon holding a position and reports -1 elsewhere', () => {
    const t = translateCds(doc, cds({ segments: [rangeSegment(0, 12)] }));
    expect(codonIndexAt(t, 0)).toBe(0);
    expect(codonIndexAt(t, 2)).toBe(0);
    expect(codonIndexAt(t, 3)).toBe(1);
    expect(codonIndexAt(t, 11)).toBe(3);
    expect(codonIndexAt(t, 12)).toBe(-1); // outside the feature
  });

  it('reports -1 for bases /codon_start skips and for an intron', () => {
    const skipped = translateCds(
      doc,
      cds({ segments: [rangeSegment(0, 12)], qualifiers: [{ name: 'codon_start', value: '3' }] }),
    );
    expect(codonIndexAt(skipped, 0)).toBe(-1);
    expect(codonIndexAt(skipped, 1)).toBe(-1);
    expect(codonIndexAt(skipped, 2)).toBe(0);
    const joined = translateCds(doc, cds({ segments: [rangeSegment(0, 5), rangeSegment(6, 12)] }));
    expect(codonIndexAt(joined, 5)).toBe(-1); // the skipped base
    expect(codonIndexAt(joined, 6)).toBe(1);
  });
});

describe('codonSpan', () => {
  //                 0         1         2
  //                 012345678901234567890123456789
  const forward = 'ATGAAAGGGTGACCCAAATTTCCCGGGTTT';
  const doc = SeqDocument.create({ sequence: forward, topology: 'linear' });

  it('covers one codon and a run of codons on the forward strand', () => {
    const t = translateCds(doc, cds({ segments: [rangeSegment(0, 12)] }));
    expect(codonSpan(t, 1, 1, doc.length)).toEqual({ start: 3, end: 6 });
    expect(codonSpan(t, 1, 3, doc.length)).toEqual({ start: 3, end: 12 });
    // The two ends may be given in either order.
    expect(codonSpan(t, 3, 1, doc.length)).toEqual({ start: 3, end: 12 });
    expect(codonSpan(t, 0, 9, doc.length)).toBeNull();
  });

  it('mirrors the span for a reverse-strand feature', () => {
    const rcDoc = SeqDocument.create({ sequence: 'TTACATGGGTTT' }); // rc = AAACCCATGTAA
    const t = translateCds(rcDoc, cds({ strand: 'reverse', segments: [rangeSegment(0, 12)] }));
    expect(t.codons[0]?.positions).toEqual([11, 10, 9]);
    expect(codonSpan(t, 0, 0, rcDoc.length)).toEqual({ start: 9, end: 12 });
    // Codons 0..1 read leftwards, so they cover the last six bases.
    expect(codonSpan(t, 0, 1, rcDoc.length)).toEqual({ start: 6, end: 12 });
  });

  it('wraps the origin when the codons do', () => {
    const circ = SeqDocument.create({
      sequence: forward.slice(3) + forward.slice(0, 3),
      topology: 'circular',
    });
    const t = translateCds(circ, cds({ segments: [rangeSegment(27, 39)] }));
    // Codon 0 is 27..29, codon 1 is 0..2: one codon straddling the origin.
    expect(codonSpan(t, 0, 0, circ.length)).toEqual({ start: 27, end: 30 });
    expect(codonSpan(t, 0, 1, circ.length)).toEqual({ start: 27, end: 33 });
    const wrapping = translateCds(circ, cds({ segments: [rangeSegment(29, 32)] }));
    expect(wrapping.codons[0]?.positions).toEqual([29, 0, 1]);
    expect(codonSpan(wrapping, 0, 0, circ.length)).toEqual({ start: 29, end: 32 });
  });

  it('covers the intervening bases when the codons sit either side of a join', () => {
    const t = translateCds(doc, cds({ segments: [rangeSegment(0, 5), rangeSegment(6, 12)] }));
    expect(codonSpan(t, 0, 1, doc.length)).toEqual({ start: 0, end: 7 });
  });
});
