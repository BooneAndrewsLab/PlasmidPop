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
