import {
  SeqDocument,
  createFeature,
  extractRange,
  firstQualifier,
  rangeSegment,
  translateCds,
} from '@/core';

function def<T>(x: T | undefined): T {
  if (x === undefined) throw new Error('expected a value');
  return x;
}

// CDS ATG CGA ATT CCG AAA CTG TTT GCA TGG TAA = M R I P K L F A W *
// EcoRI G^AATTC at CDS offset 4 cuts the top strand after offset 4 (5 bases in).
const CDS = 'ATGCGAATTCCGAAACTGTTTGCATGGTAA';
const LEFT = 'CCCCCCCCCC';
const RIGHT = 'GGGGGGGGGG';

describe('extractRange keeps clipped features in frame and in order (#162)', () => {
  it('A1: extractRange keeps a clipped CDS in frame (copy / Extract selection)', () => {
    const doc = SeqDocument.create({
      sequence: LEFT + CDS + RIGHT,
      topology: 'linear',
      features: [createFeature({ type: 'CDS', segments: [rangeSegment(10, 40)] })],
    });
    expect(translateCds(doc, def(doc.features.all()[0])).protein).toBe('MRIPKLFAW*');
    const ex = extractRange(doc, { start: 15, end: 50 }); // from CDS offset 5
    const f = def(ex.features.all()[0]);
    // Codons 3.. of the original are IPKLFAW*; frame must be codon_start=2.
    expect({ cs: firstQualifier(f, 'codon_start'), p: translateCds(ex, f).protein }).toEqual({
      cs: '2',
      p: 'IPKLFAW*',
    });
  });

  it('A3: reverse CDS clipped at its high end by a copy', () => {
    // reverse CDS: forward strand holds revcomp(CDS)
    const rc = 'TTACCATGCAAACAGTTTCGGAATTCGCAT';
    const doc = SeqDocument.create({
      sequence: LEFT + rc + RIGHT,
      topology: 'linear',
      features: [
        createFeature({ type: 'CDS', strand: 'reverse', segments: [rangeSegment(10, 40)] }),
      ],
    });
    expect(translateCds(doc, def(doc.features.all()[0])).protein).toBe('MRIPKLFAW*');
    const ex = extractRange(doc, { start: 0, end: 35 }); // drops the CDS's first 5 bases
    const f = def(ex.features.all()[0]);
    expect(translateCds(ex, f).protein).toBe('IPKLFAW*');
  });

  it('B1: a region across the origin whose gap is inside a feature splits it, in the feature order', () => {
    // 60 bp circle, misc feature [10, 50); copy [40, 20+60) i.e. 40..59,0..19, gap 20..39 inside it
    const seq = Array.from({ length: 60 }, (_, i) => 'ACGT'[(i * 7 + (i >> 2)) % 4]).join('');
    const doc = SeqDocument.create({
      sequence: seq,
      topology: 'circular',
      features: [createFeature({ type: 'misc_feature', segments: [rangeSegment(10, 50)] })],
    });
    const ex = extractRange(doc, { start: 40, end: 80 });
    // The gap splits it (#169): 10..19 then 40..49, each its own feature.
    const [a, b] = ex.features.all();
    expect(ex.featureSequence(def(a))).toBe(seq.slice(10, 20));
    expect(ex.featureSequence(def(b))).toBe(seq.slice(40, 50));
  });

  it.each([
    [5, 'IPKLFAW*'],
    [6, 'IPKLFAW*'],
    [7, 'PKLFAW*'],
    [3, 'RIPKLFAW*'],
  ])('forward CDS clipped from offset %i reads %s', (off, protein) => {
    const doc = SeqDocument.create({
      sequence: LEFT + CDS + RIGHT,
      topology: 'linear',
      features: [createFeature({ type: 'CDS', segments: [rangeSegment(10, 40)] })],
    });
    const ex = extractRange(doc, { start: 10 + off, end: 50 });
    expect(translateCds(ex, def(ex.features.all()[0])).protein).toBe(protein);
  });

  it('clipping the 3 prime end leaves codon_start alone', () => {
    const doc = SeqDocument.create({
      sequence: LEFT + CDS + RIGHT,
      topology: 'linear',
      features: [createFeature({ type: 'CDS', segments: [rangeSegment(10, 40)] })],
    });
    const ex = extractRange(doc, { start: 0, end: 30 });
    const f = def(ex.features.all()[0]);
    expect(firstQualifier(f, 'codon_start')).toBeUndefined();
    expect(translateCds(ex, f).protein.startsWith('MRIPKL')).toBe(true);
  });

  it('a CDS with codon_start=2 clipped further advances to the next whole codon', () => {
    // Reading starts at offset 1: (A)TG... reading TGC GAA TTC ... = C E F ...
    const doc = SeqDocument.create({
      sequence: LEFT + CDS + RIGHT,
      topology: 'linear',
      features: [
        createFeature({
          type: 'CDS',
          segments: [rangeSegment(10, 40)],
          qualifiers: [{ name: 'codon_start', value: '2' }],
        }),
      ],
    });
    const whole = translateCds(doc, def(doc.features.all()[0])).protein;
    // Lose 2 bases: frame 2 reads from offset 1, first whole codon from the
    // new start is at offset 1 - 2 + 3 = 2 -> codon_start 3.
    const ex = extractRange(doc, { start: 12, end: 50 });
    const f = def(ex.features.all()[0]);
    expect(firstQualifier(f, 'codon_start')).toBe('3');
    expect(translateCds(ex, f).protein).toBe(whole.slice(1));
  });

  it('a join across the origin is read in its own order, and the whole circle keeps it intact', () => {
    const seq = Array.from({ length: 60 }, (_, i) => 'ACGT'[(i * 7 + (i >> 2)) % 4]).join('');
    const doc = SeqDocument.create({
      sequence: seq,
      topology: 'circular',
      features: [
        createFeature({
          type: 'misc_feature',
          segments: [rangeSegment(10, 20), rangeSegment(30, 50)],
        }),
        createFeature({ type: 'gene', segments: [rangeSegment(50, 70)] }), // wraps the origin
      ],
    });
    const ex = extractRange(doc, { start: 40, end: 80 });
    // The join loses 20..39, so it splits (#169); the wrapping gene is whole.
    const [ja, jb, wrap] = ex.features.all();
    expect(ex.featureSequence(def(ja))).toBe(seq.slice(10, 20));
    expect(ex.featureSequence(def(jb))).toBe(seq.slice(40, 50));
    expect(ex.featureSequence(def(wrap))).toBe(seq.slice(50, 60) + seq.slice(0, 10));
    const whole = extractRange(doc, { start: 25, end: 85 });
    const [j2, w2] = whole.features.all();
    expect(whole.featureSequence(def(j2))).toBe(doc.featureSequence(def(doc.features.all()[0])));
    expect(whole.featureSequence(def(w2))).toBe(seq.slice(50, 60) + seq.slice(0, 10));
  });

  it('a reverse CDS that loses its reading start across the origin is in frame', () => {
    const rc = 'TTACCATGCAAACAGTTTCGGAATTCGCAT';
    const doc = SeqDocument.create({
      sequence: LEFT + rc + RIGHT, // 50 bp
      topology: 'circular',
      features: [
        createFeature({ type: 'CDS', strand: 'reverse', segments: [rangeSegment(10, 40)] }),
      ],
    });
    // 40..49 then 0..34: drops 35..39, the first five bases of the reading.
    const ex = extractRange(doc, { start: 40, end: 85 });
    const f = def(ex.features.all()[0]);
    expect(translateCds(ex, f).protein).toBe('IPKLFAW*');
  });
});
