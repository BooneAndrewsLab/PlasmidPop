import { createFeature, rangeSegment } from '../features';
import { type DocumentEnds, type StrandEnd } from './ends';
import { SeqDocument } from './seqDocument';

// Twelve bases of duplex with room at both ends for an overhang.
const CORE = 'ggatccATGAAAtag';

function end(kind: StrandEnd['kind'], overhang: string, enzyme: string): StrandEnd {
  return { kind, overhang, enzyme };
}

/**
 * A linear molecule with the given ends. `head` and `tail` are the bases of
 * the sequence that are single-stranded: a 5′ overhang on the left and a 3′
 * one on the right are in the top strand, so in the sequence; the other two
 * are on the bottom strand and are not.
 */
function molecule(ends: DocumentEnds, head = '', tail = ''): SeqDocument {
  return SeqDocument.create({
    name: 'frag',
    sequence: head + CORE + tail,
    topology: 'linear',
    features: [
      createFeature({
        name: 'orf',
        type: 'CDS',
        segments: [rangeSegment(head.length + 6, head.length + 15)],
      }),
    ],
    ends,
  });
}

function orf(doc: SeqDocument): string {
  const f = doc.features.all()[0];
  const seg = f?.segments[0];
  if (seg?.kind !== 'range') throw new Error('no feature');
  return doc.sequence.toString().slice(seg.start, seg.end);
}

describe('bluntEnds', () => {
  // EcoRI leaves 5′ AATT on both ends: in the sequence on the left, off the
  // bottom strand on the right.
  const ecoRI = molecule(
    { left: end("5'", 'aatt', 'EcoRI'), right: end("5'", 'aatt', 'EcoRI') },
    'aatt',
  );
  // PstI leaves 3′ TGCA on both: off the bottom strand on the left, in the
  // sequence on the right.
  const pstI = molecule(
    { left: end("3'", 'tgca', 'PstI'), right: end("3'", 'tgca', 'PstI') },
    '',
    'tgca',
  );

  it('fills a 5′ overhang in: the left one pairs, the right one is added', () => {
    const blunt = ecoRI.bluntEnds('fill');
    expect(blunt.sequence.toString()).toBe(`aatt${CORE}aatt`);
    expect(blunt.ends).toBeNull();
    expect(orf(blunt)).toBe('ATGAAAtag');
  });

  it('trims a 5′ overhang away, moving everything after the left one', () => {
    const blunt = ecoRI.bluntEnds('trim');
    expect(blunt.sequence.toString()).toBe(CORE);
    expect(blunt.ends).toBeNull();
    expect(orf(blunt)).toBe('ATGAAAtag');
  });

  it('chews a 3′ overhang back whichever way it is blunted', () => {
    for (const method of ['fill', 'trim'] as const) {
      const blunt = pstI.bluntEnds(method);
      expect(blunt.sequence.toString()).toBe(CORE);
      expect(blunt.ends).toBeNull();
      expect(orf(blunt)).toBe('ATGAAAtag');
    }
  });

  it('handles one sticky end and one blunt one', () => {
    const mixed = molecule({ left: end('blunt', '', 'SmaI'), right: end("5'", 'gatc', 'BamHI') });
    expect(mixed.bluntEnds('fill').sequence.toString()).toBe(`${CORE}gatc`);
    expect(mixed.bluntEnds('trim').sequence.toString()).toBe(CORE);
    expect(mixed.bluntEnds('trim').ends).toBeNull();
  });

  it('leaves a blunt or circular molecule alone', () => {
    const plain = SeqDocument.create({ sequence: CORE, topology: 'linear' });
    expect(plain.bluntEnds('fill')).toBe(plain);
    const circle = SeqDocument.create({ sequence: CORE, topology: 'circular' });
    expect(circle.bluntEnds('trim')).toBe(circle);
  });

  it('is an edit op, so it can be undone and named', () => {
    const op = { type: 'bluntEnds', method: 'trim' } as const;
    expect(ecoRI.apply(op).sequence.toString()).toBe(CORE);
    // A caret after the trimmed left overhang moves back by it; one on the
    // overhang lands at the new start.
    expect(ecoRI.mapPositionThrough(op, 10)).toBe(6);
    expect(ecoRI.mapPositionThrough(op, 2)).toBe(0);
    expect(ecoRI.mapPositionThrough({ type: 'bluntEnds', method: 'fill' }, 10)).toBe(10);
  });
});
