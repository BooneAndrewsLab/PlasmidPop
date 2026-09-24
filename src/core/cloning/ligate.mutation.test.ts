import { createFeature, rangeSegment } from '@/core';

import { type DigestFragment } from './digest';
import { flipFragment, ligate } from './ligate';

/**
 * Corners of `ligate.ts` the rest of the suite leaves open (#77): a
 * qualifier that holds a location, carried through a flip past a sticky
 * end, and the metadata a ligation writes.
 */

describe('flipFragment', () => {
  it('turns a /transl_except round with its CDS, next to an overhang the flip brings in', () => {
    const fragment: DigestFragment = {
      sequence: 'ATGAAACCCTGA',
      features: [
        createFeature({
          type: 'CDS',
          name: 'orf',
          segments: [rangeSegment(0, 12)],
          qualifiers: [{ name: 'transl_except', value: '(pos:10..12,aa:Sec)' }],
        }),
      ],
      range: { start: 0, end: 12 },
      left: { kind: 'blunt', overhang: '', enzyme: null },
      // A 5′ right end: its overhang is on the bottom strand, past `sequence`.
      right: { kind: "5'", overhang: 'GATC', enzyme: 'BamHI' },
      source: 'p',
    };
    const flipped = flipFragment(fragment);
    expect(flipped.sequence).toBe('GATCTCAGGGTTTCAT');
    expect(flipped.features.map((f) => [f.strand, f.segments, f.qualifiers])).toEqual([
      [
        'reverse',
        [rangeSegment(4, 16)],
        [{ name: 'transl_except', value: '(pos:complement(5..7),aa:Sec)' }],
      ],
    ]);
  });
});

describe('ligate', () => {
  it('writes a DNA molecule, and names a piece with no enzyme at its ends by its source alone', () => {
    const piece: DigestFragment = {
      sequence: 'ACGTACGTAC',
      features: [],
      range: { start: 0, end: 10 },
      left: { kind: 'blunt', overhang: '', enzyme: null },
      right: { kind: 'blunt', overhang: '', enzyme: null },
      source: 'pUC',
    };
    const doc = ligate([piece], { name: 'joined', circular: false });
    expect(doc.metadata.moleculeType).toBe('DNA');
    expect(doc.metadata.division).toBe('SYN');
    expect(doc.metadata.description).toBe('Linear ligation of pUC fragment (10 bp)');
  });
});
