import { describe, expect, it } from 'vitest';
import { createFeature, rangeSegment, siteSegment } from '../features';
import { type Range } from '../range';
import { extractRange } from './extract';
import { basesHash, originRecord, pieceOrigin, placementOf, rejoinPieces } from './featureOrigin';
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

describe('a join that steps back (#432 step 3)', () => {
  // `join(88..93,4..14)`: the second segment lies before the first. On a
  // circle its start, 84 bases before the 5′ end, folds to 12 bases after
  // it: the feature goes on round the origin. On a line it stays negative,
  // and the original's own space starts at the lowest base.
  const text = 'ACGTTGCA'.repeat(12);
  const feature = createFeature({
    id: 'cds',
    type: 'CDS',
    name: 'g',
    segments: [rangeSegment(87, 93), rangeSegment(3, 14)],
  });
  const bases = (r: Range): string =>
    r.end <= text.length
      ? text.slice(r.start, r.end)
      : text.slice(r.start) + text.slice(0, r.end - text.length);

  it('on a line, lays the original out from its lowest base, the step kept as it is', () => {
    const record = originRecord(feature, { length: 96, topology: 'linear' }, bases);
    expect(record?.span).toBe(90);
    expect(record?.whole.segments).toEqual([rangeSegment(84, 90), rangeSegment(0, 11)]);
  });

  it('on a circle, reads the step back as going on round the origin', () => {
    const record = originRecord(feature, { length: 96, topology: 'circular' }, bases);
    expect(record?.span).toBe(23);
    expect(record?.whole.segments).toEqual([rangeSegment(0, 6), rangeSegment(12, 23)]);
  });
});

describe('pieces put back together on a circle', () => {
  /** An 80 bp circle with one CDS at 10 to 40, cut at 25 into two pieces. */
  const ring = (strand: 'forward' | 'reverse') =>
    SeqDocument.create({
      sequence: 'ACGTTGCA'.repeat(10),
      topology: 'circular',
      features: [
        createFeature({
          id: 'cds',
          type: 'CDS',
          name: 'g',
          strand,
          segments: [rangeSegment(10, 40)],
          qualifiers: [{ name: 'translation', value: 'XXXXXXXXXX' }],
        }),
      ],
    });

  it.each(['forward', 'reverse'] as const)(
    'joins the two halves of a %s CDS that meet across the origin',
    (strand) => {
      const source = ring(strand);
      const text = source.sequence.toString();
      const first = extractRange(source, { start: 0, end: 25 }).features.all()[0];
      const second = extractRange(source, { start: 25, end: 80 }).features.all()[0];
      if (first === undefined || second === undefined) throw new Error('no pieces');
      // Ligated as second + first, the product is the circle turned by 25: the
      // second half sits at 0 to 15, the first at 65 to 80.
      const shift = (f: typeof first, by: number) => ({
        ...f,
        segments: f.segments.map((seg) =>
          seg.kind === 'range' ? rangeSegment(seg.start + by, seg.end + by) : seg,
        ),
      });
      const space = { length: 80, topology: 'circular' } as const;
      const turned = text.slice(25) + text.slice(0, 25);
      const joined = rejoinPieces([shift(second, 0), shift(first, 55)], space, turned);
      expect(joined).toHaveLength(1);
      // One CDS again, over 65 to the origin and on to 15, with its translation back.
      expect(joined[0]?.segments).toEqual([rangeSegment(65, 95)]);
      expect(joined[0]?.strand).toBe(strand);
      expect(joined[0]?.qualifiers).toEqual([{ name: 'translation', value: 'XXXXXXXXXX' }]);
    },
  );

  it.each([
    ['two ranges, the second back at 0', [rangeSegment(75, 80), rangeSegment(0, 10)]],
    ['two ranges, the second numbered past the end', [rangeSegment(75, 80), rangeSegment(80, 90)]],
  ] as const)(
    'joins a piece that itself lies across the origin to the piece after it, as %s',
    (_name, spelled) => {
      // A CDS written as join(71..80,1..20) on the 80 bp circle, cut at 5 into a
      // piece of 15 bases and one of 15 more.
      const source = SeqDocument.create({
        sequence: 'ACGTTGCA'.repeat(10),
        topology: 'circular',
        features: [
          createFeature({
            id: 'cds',
            type: 'CDS',
            name: 'g',
            segments: [rangeSegment(70, 80), rangeSegment(0, 20)],
            qualifiers: [{ name: 'translation', value: 'XXXXXXXXXX' }],
          }),
        ],
      });
      const text = source.sequence.toString();
      const first = extractRange(source, { start: 60, end: 85 });
      const second = extractRange(source, { start: 5, end: 60 });
      const a = first.features.all()[0];
      const b = second.features.all()[0];
      if (a === undefined || b === undefined) throw new Error('no pieces');
      const firstText = first.sequence.toString();
      // The 25 bases of the first piece lie from 65 over the origin to 10; the second from 10 to 65.
      const product = firstText.slice(15) + text.slice(5, 60) + firstText.slice(0, 15);
      const shift = (f: typeof a, segments: ReturnType<typeof rangeSegment>[]) => ({
        ...f,
        segments,
      });
      const space = { length: 80, topology: 'circular' } as const;
      const joined = rejoinPieces(
        [shift(a, [...spelled]), shift(b, [rangeSegment(10, 25)])],
        space,
        product,
      );
      expect(joined).toHaveLength(1);
      // The original join(71..80,1..20), 5 bases further along: it ends at 25 on the next turn.
      expect(joined[0]?.segments).toEqual([rangeSegment(75, 85), rangeSegment(5, 25)]);
      expect(joined[0]?.qualifiers).toEqual([{ name: 'translation', value: 'XXXXXXXXXX' }]);
    },
  );

  it('keeps a located qualifier counted from the feature’s start, over the origin', () => {
    // transl_except at 6, which on the circle is 15 bases after the CDS starts at 71.
    const source = SeqDocument.create({
      sequence: 'ACGTTGCA'.repeat(10),
      topology: 'circular',
      features: [
        createFeature({
          id: 'cds',
          type: 'CDS',
          name: 'g',
          segments: [rangeSegment(70, 80), rangeSegment(0, 20)],
          qualifiers: [{ name: 'transl_except', value: '(pos:5^6,aa:Sec)' }],
        }),
      ],
    });
    const piece = extractRange(source, { start: 75, end: 100 }).features.all()[0];
    expect(piece?.origin?.whole.qualifiers).toEqual([
      { name: 'transl_except', value: '(pos:15^16,aa:Sec)' },
    ]);
    // The same qualifier before the origin is counted without folding.
    const before = extractRange(
      SeqDocument.create({
        sequence: 'ACGTTGCA'.repeat(10),
        topology: 'circular',
        features: [
          createFeature({
            id: 'cds',
            type: 'CDS',
            name: 'g',
            segments: [rangeSegment(10, 40)],
            qualifiers: [{ name: 'transl_except', value: '(pos:20^21,aa:Sec)' }],
          }),
        ],
      }),
      { start: 0, end: 30 },
    ).features.all()[0];
    expect(before?.origin?.whole.qualifiers).toEqual([
      { name: 'transl_except', value: '(pos:10^11,aa:Sec)' },
    ]);
  });
});

describe('an empty circular document (#434)', () => {
  // The only feature an empty document can hold is a site (a range segment
  // must cover a base), and every unguarded fold in `featureOrigin.ts` comes
  // after `rangesOf`, which has no range to give for one: `originRecord`,
  // `placementOf` and through them `pieceOrigin` answer null before a
  // position is folded, and `rejoinPieces` gives the features back as they
  // are. The callers (`extract.ts`, `trimTip`, `ligate.ts`) pass the
  // document's own features, so no range reaches these with a length of 0.
  const empty = SeqDocument.create({ sequence: '' }).setTopology('circular');
  const doc = empty.addFeature(
    createFeature({ id: 's', type: 'misc_feature', name: 's', segments: [siteSegment(0)] }),
  );
  const bases = (r: Range): string => doc.subsequence(r);

  it('has no record to make of its feature, and no placement for it', () => {
    const site = doc.requireFeature('s');
    expect(originRecord(site, doc, bases)).toBeNull();
    expect(placementOf(site, doc)).toBeNull();
    expect(pieceOrigin(site, 0, 0, doc, bases)).toBeNull();
  });

  it('gives its features back as they are when asked to rejoin them', () => {
    expect(rejoinPieces(doc.features.all(), doc, '')).toEqual(doc.features.all());
    expect(rejoinPieces([], empty, '')).toEqual([]);
  });

  it('cuts an empty piece out of one', () => {
    const piece = extractRange(doc, { start: 0, end: 0 });
    expect(piece.length).toBe(0);
    for (const f of piece.features.all()) expect(f.origin).toBeUndefined();
  });
});
