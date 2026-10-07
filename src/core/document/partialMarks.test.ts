import { type Feature, createFeature, rangeSegment } from '../features';
import { writeGenBank } from '../../io/genbank/writeGenBank';
import { parseGenBank } from '../../io/genbank/parseGenBank';
import { extractRange } from './extract';
import { SeqDocument } from './seqDocument';

// #176: a kept piece is partial on every side where the feature has bases the
// region does not keep, not only where the region cuts inside the piece.

const SEQ = 'ATGAAACCCGGGTTTAAACCCGGGTTTAAATAGCCCCCCCC'; // 41

function marks(f: Feature): string[] {
  return f.segments.map((s) =>
    s.kind === 'range'
      ? `${s.partialStart ? '<' : ''}${s.start}-${s.end}${s.partialEnd ? '>' : ''}`
      : '^',
  );
}

function linear(type: string, strand: 'forward' | 'reverse'): SeqDocument {
  return SeqDocument.create({
    sequence: SEQ,
    topology: 'linear',
    features: [
      createFeature({
        type,
        name: 'f',
        strand,
        segments: [rangeSegment(0, 9), rangeSegment(12, 33)],
      }),
    ],
  });
}

function only(doc: SeqDocument): Feature {
  const all = doc.features.all();
  expect(all).toHaveLength(1);
  const [f] = all;
  if (f === undefined) throw new Error('no feature');
  return f;
}

describe('extractRange marks a dropped join segment partial (#176)', () => {
  it('last segment dropped: the 3-prime side of a forward CDS', () => {
    expect(marks(only(extractRange(linear('CDS', 'forward'), { start: 0, end: 11 })))).toEqual([
      '0-9>',
    ]);
  });

  it('last segment dropped: a reverse CDS marks its 5-prime end', () => {
    expect(marks(only(extractRange(linear('CDS', 'reverse'), { start: 0, end: 11 })))).toEqual([
      '0-9>',
    ]);
  });

  it('first segment dropped: a misc_feature marks its start, forward and reverse', () => {
    for (const strand of ['forward', 'reverse'] as const) {
      expect(
        marks(only(extractRange(linear('misc_feature', strand), { start: 10, end: 40 }))),
      ).toEqual(['<2-23']);
    }
  });

  it('first segment dropped: a reverse CDS marks its low (3-prime) end', () => {
    const f = only(extractRange(linear('CDS', 'reverse'), { start: 10, end: 40 }));
    expect(marks(f)).toEqual(['<2-23']);
  });

  it('a region keeping every segment adds no marks', () => {
    expect(
      marks(only(extractRange(linear('misc_feature', 'forward'), { start: 0, end: 41 }))),
    ).toEqual(['0-9', '12-33']);
  });

  it('a region that keeps whole ends of the feature but drops outside bases adds no marks', () => {
    expect(
      marks(only(extractRange(linear('misc_feature', 'forward'), { start: 0, end: 33 }))),
    ).toEqual(['0-9', '12-33']);
  });

  it('the far side of the origin of a wrapping segment', () => {
    const doc = SeqDocument.create({
      sequence: SEQ.slice(0, 40),
      topology: 'circular',
      features: [
        createFeature({ type: 'misc_feature', name: 'w', segments: [rangeSegment(35, 45)] }),
      ],
    });
    expect(marks(only(extractRange(doc, { start: 30, end: 40 })))).toEqual(['5-10>']);
    expect(marks(only(extractRange(doc, { start: 0, end: 10 })))).toEqual(['<0-5']);
  });

  it('a reverse feature across the origin keeps each side marked', () => {
    const doc = SeqDocument.create({
      sequence: SEQ.slice(0, 40),
      topology: 'circular',
      features: [
        createFeature({
          type: 'CDS',
          name: 'w',
          strand: 'reverse',
          segments: [rangeSegment(35, 45)],
        }),
      ],
    });
    expect(marks(only(extractRange(doc, { start: 30, end: 40 })))).toEqual(['5-10>']);
    expect(marks(only(extractRange(doc, { start: 0, end: 10 })))).toEqual(['<0-5']);
  });

  it('survives a GenBank round trip', () => {
    const ex = extractRange(linear('misc_feature', 'forward'), { start: 10, end: 40 });
    const text = writeGenBank(ex);
    expect(text).toContain('<3..23');
    const back = parseGenBank(text).documents[0];
    if (back === undefined) throw new Error('no document');
    expect(marks(only(back))).toEqual(['<2-23']);
    const rev = writeGenBank(extractRange(linear('CDS', 'reverse'), { start: 0, end: 11 }));
    expect(rev).toContain('complement(1..>9)');
  });
});

describe('delete marks a CDS cut at the end of its reading 3-prime partial (#176)', () => {
  const doc = (strand: 'forward' | 'reverse', segs = [rangeSegment(2, 14), rangeSegment(20, 32)]) =>
    SeqDocument.create({
      sequence: SEQ,
      topology: 'linear',
      features: [createFeature({ type: 'CDS', name: 'c', strand, segments: segs })],
    });

  it('trimming the end of a forward CDS', () => {
    expect(marks(only(doc('forward').delete({ start: 28, end: 33 })))).toEqual(['2-14', '20-28>']);
  });

  it('dropping the whole last segment of a forward CDS', () => {
    expect(marks(only(doc('forward').delete({ start: 18, end: 36 })))).toEqual(['2-14>']);
  });

  it('keeps a mark the dropped last segment carried', () => {
    const d = doc('forward', [rangeSegment(2, 14), rangeSegment(20, 32, { partialEnd: true })]);
    expect(marks(only(d.delete({ start: 18, end: 36 })))).toEqual(['2-14>']);
  });

  it('trimming the low (3-prime) end of a reverse CDS', () => {
    expect(marks(only(doc('reverse').delete({ start: 0, end: 4 })))).toEqual(['<0-10', '16-28']);
  });

  it('dropping the first segment of a reverse CDS', () => {
    expect(marks(only(doc('reverse').delete({ start: 0, end: 16 })))).toEqual(['<4-16']);
  });

  it('a delete in the middle or at the 5-prime end adds no 3-prime mark', () => {
    expect(marks(only(doc('forward').delete({ start: 6, end: 8 })))).toEqual(['2-12', '18-30']);
    expect(marks(only(doc('forward').delete({ start: 33, end: 36 })))).toEqual(['2-14', '20-32']);
  });

  it('across the origin of a circle', () => {
    const circle = SeqDocument.create({
      sequence: SEQ.slice(0, 40),
      topology: 'circular',
      features: [createFeature({ type: 'CDS', name: 'w', segments: [rangeSegment(30, 46)] })],
    });
    // 46 wraps to base 6; the delete takes bases 2..5 off the end of the reading.
    expect(marks(only(circle.delete({ start: 2, end: 8 })))).toEqual(['24-36>']);
  });

  it('a non-CDS gets no mark', () => {
    const d = SeqDocument.create({
      sequence: SEQ,
      topology: 'linear',
      features: [
        createFeature({ type: 'misc_feature', name: 'm', segments: [rangeSegment(2, 14)] }),
      ],
    });
    expect(marks(only(d.delete({ start: 10, end: 14 })))).toEqual(['2-10']);
  });
});
