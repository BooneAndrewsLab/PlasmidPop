import { createFeature, rangeSegment, siteSegment } from '../features';
import { type StrandEnd } from './ends';
import { extractRange } from './extract';
import { SeqDocument } from './seqDocument';

// Tests written against the survivors of a mutation run (item 50).

const SEQ = 'ACGTTGCAAGGCTTAACCGG'; // 20 bp

describe('extractRange, sites', () => {
  const doc = SeqDocument.create({
    name: 'pX',
    sequence: SEQ,
    topology: 'circular',
    features: [createFeature({ id: 's', type: 'misc_feature', segments: [siteSegment(7)] })],
  });
  const sites = (sub: SeqDocument) => sub.features.all().flatMap((f) => f.segments);

  it('keeps a site between two bases of the range', () => {
    expect(sites(extractRange(doc, { start: 6, end: 12 }))).toEqual([siteSegment(1)]);
    expect(sites(extractRange(doc, { start: 2, end: 8 }))).toEqual([siteSegment(5)]);
  });

  it('drops a site at either edge of the range, which has no base on one side', () => {
    expect(sites(extractRange(doc, { start: 7, end: 12 }))).toEqual([]);
    expect(sites(extractRange(doc, { start: 2, end: 7 }))).toEqual([]);
  });

  it('keeps a site at the origin of a circle when the range runs across it', () => {
    const atOrigin = SeqDocument.create({
      name: 'pX',
      sequence: SEQ,
      topology: 'circular',
      features: [createFeature({ id: 's', type: 'misc_feature', segments: [siteSegment(0)] })],
    });
    expect(sites(extractRange(atOrigin, { start: 16, end: 24 }))).toEqual([siteSegment(4)]);
    expect(sites(extractRange(atOrigin, { start: 5, end: 25 }))).toEqual([siteSegment(15)]);
    expect(sites(extractRange(atOrigin, { start: 0, end: 20 }))).toEqual([]);
  });
});

describe('extractRange, a feature across the origin', () => {
  it('re-joins the two pieces with the partial ends of the outer ones', () => {
    // 15..23 wraps to 15..20 + 0..3; the range 16..22 trims a base off each.
    const doc = SeqDocument.create({
      name: 'pX',
      sequence: SEQ,
      topology: 'circular',
      features: [
        createFeature({ id: 'w', type: 'misc_feature', segments: [rangeSegment(15, 23)] }),
      ],
    });
    const sub = extractRange(doc, { start: 16, end: 22 });
    expect(sub.features.all().map((f) => f.segments)).toEqual([
      [rangeSegment(0, 6, { partialStart: true, partialEnd: true })],
    ]);
  });
});

describe('extractRange, the ends of a linear molecule', () => {
  const blunt: StrandEnd = { kind: 'blunt', overhang: '', enzyme: null };

  it('keeps no ends for an empty range, even at the start', () => {
    const doc = SeqDocument.create({
      name: 'frag',
      sequence: SEQ,
      topology: 'linear',
      ends: { left: { kind: 'blunt', overhang: '', enzyme: 'SmaI' }, right: blunt },
    });
    expect(extractRange(doc, { start: 0, end: 0 }).ends).toBeNull();
  });

  describe('a 3′ overhang of two bases on the right', () => {
    const doc = SeqDocument.create({
      name: 'frag',
      sequence: SEQ,
      topology: 'linear',
      ends: { left: blunt, right: { kind: "3'", overhang: 'GG', enzyme: null } },
    });

    it('is kept by a range of exactly its two bases', () => {
      expect(extractRange(doc, { start: 18, end: 20 }).ends?.right).toEqual(doc.ends?.right);
    });

    it('is dropped by a range of only its last base', () => {
      expect(extractRange(doc, { start: 19, end: 20 }).ends).toBeNull();
    });
  });

  it('drops the right end when its bases and the left end’s do not both fit', () => {
    // Six bases, four of them the left 5′ overhang and three the right 3′
    // one: seven single-stranded bases cannot all be in six.
    const left: StrandEnd = { kind: "5'", overhang: 'AATT', enzyme: 'EcoRI' };
    const doc = SeqDocument.create({
      name: 'tiny',
      sequence: 'AATTCG',
      topology: 'linear',
      ends: { left, right: { kind: "3'", overhang: 'TCG', enzyme: null } },
    });
    expect(extractRange(doc, { start: 0, end: 6 }).ends).toEqual({ left, right: blunt });
  });
});

describe('extractRange, metadata', () => {
  it('describes the stretch without a colon when the source has no description', () => {
    const doc = SeqDocument.create({ name: 'pX', sequence: SEQ, topology: 'linear' });
    expect(extractRange(doc, { start: 2, end: 5 }).metadata.description).toBe('3-5 of pX');
  });

  it('drops the accession and version, which name the whole record', () => {
    const doc = SeqDocument.create({
      name: 'pBR322',
      sequence: SEQ,
      topology: 'linear',
      metadata: { accession: 'J01749', version: 'J01749.1' },
    });
    const sub = extractRange(doc, { start: 2, end: 5 });
    expect(sub.metadata.accession).toBe('');
    expect(sub.metadata.version).toBe('');
  });
});

describe('extractRange, features with a site segment among their ranges', () => {
  const strip = (f: { segments: unknown; origin?: unknown }) => f.segments;

  it('keeps a feature whole, with no record of a cut, when its sites and ranges all fit', () => {
    const doc = SeqDocument.create({
      name: 'pX',
      sequence: SEQ,
      topology: 'linear',
      features: [
        createFeature({
          id: 'j',
          type: 'misc_feature',
          segments: [rangeSegment(2, 6), siteSegment(8), rangeSegment(10, 14)],
        }),
      ],
    });
    const [f] = extractRange(doc, { start: 0, end: 20 }).features.all();
    expect(f?.segments).toEqual([rangeSegment(2, 6), siteSegment(8), rangeSegment(10, 14)]);
    expect(f?.origin).toBeUndefined();
  });

  it('marks the last range partial when whole later segments are dropped, whatever sites it has', () => {
    const doc = SeqDocument.create({
      name: 'pX',
      sequence: SEQ,
      topology: 'linear',
      features: [
        createFeature({
          id: 'j',
          type: 'misc_feature',
          segments: [rangeSegment(2, 6), rangeSegment(8, 12), siteSegment(15)],
        }),
      ],
    });
    const fs = extractRange(doc, { start: 0, end: 7 }).features.all();
    expect(fs.map(strip)).toEqual([[rangeSegment(2, 6, { partialEnd: true })]]);
  });

  it('counts a forward CDS from its first range, not from a leading site', () => {
    // The 4 bases of the dropped range come before B in the reading.
    const doc = SeqDocument.create({
      name: 'pX',
      sequence: SEQ,
      topology: 'linear',
      features: [
        createFeature({
          id: 'c',
          type: 'CDS',
          segments: [siteSegment(14), rangeSegment(2, 6), rangeSegment(10, 17)],
        }),
      ],
    });
    const [f] = extractRange(doc, { start: 8, end: 20 }).features.all();
    expect(f?.segments).toEqual([siteSegment(6), rangeSegment(2, 9, { partialStart: true })]);
    expect(f?.qualifiers).toEqual([{ name: 'codon_start', value: '3' }]);
  });

  it('marks the first range partial when whole earlier segments are dropped, whatever sites it has', () => {
    const doc = SeqDocument.create({
      name: 'pX',
      sequence: SEQ,
      topology: 'linear',
      features: [
        createFeature({
          id: 'j',
          type: 'misc_feature',
          segments: [siteSegment(14), rangeSegment(2, 6), rangeSegment(10, 17)],
        }),
      ],
    });
    const [f] = extractRange(doc, { start: 8, end: 20 }).features.all();
    expect(f?.segments).toEqual([siteSegment(6), rangeSegment(2, 9, { partialStart: true })]);
  });

  it('counts a reverse CDS from its last range, not from a trailing site', () => {
    // Read from B's far end, the reverse CDS lost the 4 bases of the range before it.
    const doc = SeqDocument.create({
      name: 'pX',
      sequence: SEQ,
      topology: 'linear',
      features: [
        createFeature({
          id: 'c',
          type: 'CDS',
          strand: 'reverse',
          segments: [rangeSegment(10, 17), rangeSegment(2, 6), siteSegment(14)],
        }),
      ],
    });
    const [f] = extractRange(doc, { start: 8, end: 20 }).features.all();
    expect(f?.qualifiers).toEqual([{ name: 'codon_start', value: '3' }]);
  });

  it('keeps a site and every range of a stretch together when a circle region splits the feature', () => {
    // On a 60 bp circle the region 22..72 drops the start of A, and the 8
    // bases of the feature between A's kept two and B's kept four.
    const doc = SeqDocument.create({
      name: 'pX',
      sequence: 'ACGT'.repeat(15),
      topology: 'circular',
      features: [
        createFeature({
          id: 'j',
          type: 'misc_feature',
          segments: [
            rangeSegment(10, 16),
            rangeSegment(20, 26),
            siteSegment(28),
            rangeSegment(30, 36),
          ],
        }),
      ],
    });
    const fs = extractRange(doc, { start: 22, end: 72 }).features.all();
    expect(fs.map(strip)).toEqual([
      [rangeSegment(48, 50, { partialEnd: true })],
      [rangeSegment(0, 4, { partialStart: true }), siteSegment(6), rangeSegment(8, 14)],
    ]);
  });

  it('leaves the /translation of a clipped feature that is not a CDS', () => {
    const doc = SeqDocument.create({
      name: 'pX',
      sequence: SEQ,
      topology: 'linear',
      features: [
        createFeature({
          id: 'm',
          type: 'mat_peptide',
          segments: [rangeSegment(2, 12)],
          qualifiers: [{ name: 'translation', value: 'MKLV' }],
        }),
      ],
    });
    const [f] = extractRange(doc, { start: 0, end: 8 }).features.all();
    expect(f?.qualifiers).toEqual([{ name: 'translation', value: 'MKLV' }]);
  });
});
