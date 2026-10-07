import { describe, expect, it } from 'vitest';
import { createFeature, rangeSegment } from '../features';
import { extractRange } from './extract';
import { basesHash, placementOf, rejoinPieces } from './featureOrigin';
import { SeqDocument } from './seqDocument';

const doc = (strand: 'forward' | 'reverse') =>
  SeqDocument.create({
    sequence: 'ACGTTGCA'.repeat(10),
    topology: 'circular',
    features: [
      createFeature({
        id: 'cds',
        type: 'CDS',
        name: 'g',
        strand,
        segments: [rangeSegment(70, 76), rangeSegment(10, 22)],
        qualifiers: [{ name: 'translation', value: 'XXXXXX' }],
      }),
      createFeature({ id: 'gene', type: 'gene', segments: [rangeSegment(30, 40)] }),
    ],
  });

describe('a piece’s record of the feature it was cut from (#182)', () => {
  it('counts the piece’s bases from the 5′ end, whichever strand', () => {
    // Forward, the join reads 70..76 then, round the origin, 10..22; reverse,
    // 21 down to 10 and then 75 down to 70.
    for (const [strand, from, to, a, b] of [
      ['forward', 6, 18, 6, 20],
      ['reverse', 0, 12, 12, 26],
    ] as const) {
      const piece = extractRange(doc(strand), { start: 0, end: 50 }).features.all()[0];
      expect(piece?.origin, strand).toMatchObject({ key: 'cds', from, to, span: 32 });
      // The original is kept whole, on the forward strand of its own space.
      expect(piece?.origin?.whole.segments).toEqual([rangeSegment(0, a), rangeSegment(b, 32)]);
      expect(piece?.origin?.whole.strand).toBe('forward');
      expect(piece?.origin?.gaps).toHaveLength(1);
    }
  });

  it('is not given to a feature taken whole', () => {
    const gene = extractRange(doc('forward'), { start: 0, end: 50 }).features.all()[1];
    expect(gene?.type).toBe('gene');
    expect(gene?.origin).toBeUndefined();
  });

  it('names the first feature cut when a piece is cut again', () => {
    const once = extractRange(doc('forward'), { start: 0, end: 50 });
    const twice = extractRange(once, { start: 14, end: 50 }).features.all()[0];
    expect(twice?.origin).toMatchObject({ key: 'cds', from: 10, to: 18 });
  });

  it('is dropped by an edit that changes the piece’s bases, and leaves it unjoined', () => {
    const piece = extractRange(doc('forward'), { start: 0, end: 50 });
    const f = piece.features.all()[0];
    expect(f !== undefined && placementOf(f, piece) !== null).toBe(true);
    const edited = piece.insert(15, 'A');
    const g = edited.features.all()[0];
    expect(g?.origin).toBeDefined();
    expect(g !== undefined && placementOf(g, edited) === null).toBe(true);
    expect(rejoinPieces(edited.features.all(), edited, edited.sequence.toString())).toEqual(
      edited.features.all(),
    );
  });

  it('hashes bases without regard to case', () => {
    expect(basesHash('acgt')).toBe(basesHash('ACGT'));
    expect(basesHash('ACGT')).not.toBe(basesHash('ACGA'));
  });
});
