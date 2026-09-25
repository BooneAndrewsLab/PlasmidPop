import { createFeature, rangeSegment, siteSegment } from '../features';
import { extractRange } from './extract';
import { SeqDocument } from './seqDocument';

const SEQ = 'ACGTTGCAAGGCTTAACCGG'; // 20 bp

const doc = SeqDocument.create({
  name: 'pX',
  sequence: SEQ,
  topology: 'circular',
  features: [
    createFeature({ id: 'in', type: 'gene', name: 'inside', segments: [rangeSegment(6, 9)] }),
    createFeature({
      id: 'span',
      type: 'CDS',
      name: 'spanning',
      strand: 'reverse',
      segments: [rangeSegment(2, 14)],
    }),
    createFeature({ id: 'out', type: 'misc', name: 'outside', segments: [rangeSegment(15, 18)] }),
    createFeature({ id: 'wrap', type: 'misc', name: 'wrapped', segments: [rangeSegment(17, 23)] }),
    createFeature({ id: 'site', type: 'misc', segments: [siteSegment(7)] }),
    createFeature({
      id: 'join',
      type: 'mRNA',
      segments: [rangeSegment(4, 6), rangeSegment(8, 12)],
    }),
  ],
  metadata: { description: 'test' },
});

describe('extractRange', () => {
  it('cuts out a linear sub-document with trimmed, partial-marked features', () => {
    const sub = extractRange(doc, { start: 5, end: 12 });
    expect(sub.sequence.toString()).toBe(SEQ.slice(5, 12));
    expect(sub.topology).toBe('linear');
    expect(sub.name).toBe('pX_6-12');
    expect(sub.metadata.description).toBe('6-12 of pX: test');
    const byName = new Map(sub.features.all().map((f) => [f.name === '' ? f.type : f.name, f]));
    expect(byName.get('inside')?.segments).toEqual([
      expect.objectContaining({ start: 1, end: 4, partialStart: false, partialEnd: false }),
    ]);
    expect(byName.get('spanning')?.segments).toEqual([
      expect.objectContaining({ start: 0, end: 7, partialStart: true, partialEnd: true }),
    ]);
    expect(byName.get('spanning')?.strand).toBe('reverse');
    expect(byName.has('outside')).toBe(false);
    expect(byName.has('wrapped')).toBe(false);
    expect(byName.get('misc')?.segments).toEqual([{ kind: 'site', position: 2 }]);
    expect(byName.get('mRNA')?.segments).toEqual([
      expect.objectContaining({ start: 0, end: 1, partialStart: true }),
      expect.objectContaining({ start: 3, end: 7, partialStart: false, partialEnd: false }),
    ]);
    // ids are fresh so the extract can be added back later without collisions
    expect(sub.features.all().every((f) => !doc.features.has(f.id))).toBe(true);
  });

  it('extracts across the origin and re-joins a wrapped feature', () => {
    const sub = extractRange(doc, { start: 16, end: 24 }, 'piece');
    expect(sub.sequence.toString()).toBe(SEQ.slice(16) + SEQ.slice(0, 4));
    expect(sub.name).toBe('piece');
    const wrapped = sub.features.all().find((f) => f.name === 'wrapped');
    expect(wrapped?.segments).toEqual([
      expect.objectContaining({ start: 1, end: 7, partialStart: false, partialEnd: false }),
    ]);
    const spanning = sub.features.all().find((f) => f.name === 'spanning');
    expect(spanning?.segments).toEqual([
      expect.objectContaining({ start: 6, end: 8, partialStart: false, partialEnd: true }),
    ]);
  });

  describe('the ends of a linear molecule (#39)', () => {
    const cut = SeqDocument.create({
      name: 'frag',
      sequence: 'AATTCGGATCCAAGCTTG', // 18 bp, EcoRI 5' AATT on the left
      topology: 'linear',
      ends: {
        left: { kind: "5'", overhang: 'AATT', enzyme: 'EcoRI' },
        right: { kind: "3'", overhang: 'TG', enzyme: null },
      },
    });

    it('keeps an end the range reaches and makes the other blunt', () => {
      expect(extractRange(cut, { start: 0, end: 18 }).ends).toEqual(cut.ends);
      expect(extractRange(cut, { start: 0, end: 10 }).ends).toEqual({
        left: cut.ends?.left,
        right: { kind: 'blunt', overhang: '', enzyme: null },
      });
      expect(extractRange(cut, { start: 5, end: 18 }).ends).toEqual({
        left: { kind: 'blunt', overhang: '', enzyme: null },
        right: cut.ends?.right,
      });
      expect(extractRange(cut, { start: 5, end: 10 }).ends).toBeNull();
    });

    it('drops an end whose single-stranded bases the range does not hold', () => {
      expect(extractRange(cut, { start: 0, end: 3 }).ends).toBeNull();
      expect(extractRange(cut, { start: 0, end: 4 }).ends?.left).toEqual(cut.ends?.left);
    });

    it('gives a circle nothing: it has no ends', () => {
      expect(extractRange(doc, { start: 0, end: 20 }).ends).toBeNull();
    });
  });
});
