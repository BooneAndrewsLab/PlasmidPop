import { SeqDocument, createFeature, diffDocuments, rangeSegment } from '@/core';

import { featureChangeRows } from './featureChanges';

const SEQ = 'ACGTTGCAAGGCTTAACCGGATATCCGGTTAACCGGATTACAGGCCTTAA'; // 50 bases

function feature(id: string, start: number, end: number, name = '', type = 'misc_binding') {
  return createFeature({ id, type, name, segments: [rangeSegment(start, end)] });
}

function doc(features: ReturnType<typeof feature>[], sequence = SEQ): SeqDocument {
  return SeqDocument.create({ name: 'test', sequence, features });
}

/** The rows as one string each, the way the dialog reads them out. */
function lines(before: SeqDocument, after: SeqDocument): string[] {
  return featureChangeRows(diffDocuments(before, after), after).map((row) =>
    `${row.mark} ${row.text} ${row.where}`.trim().replace(/\s+/g, ' '),
  );
}

describe('featureChangeRows', () => {
  it('names what was added, changed and removed, and says where', () => {
    const before = doc([feature('f1', 4, 12, 'tet', 'CDS'), feature('f2', 20, 24)]);
    const after = before
      .removeFeature('f2')
      .updateFeature('f1', { name: 'tetA' })
      .addFeature(feature('f3', 30, 36, 'lacZα', 'CDS'));
    expect(lines(before, after)).toEqual([
      '+ lacZα 31..36',
      '~ tetA renamed from tet 5..12',
      '− misc_binding 21..24',
    ]);
  });

  it('says what changed about a feature, not merely that it did', () => {
    const before = doc([feature('f1', 4, 12, 'tet', 'gene')]);
    const typed = before.updateFeature('f1', { type: 'CDS' });
    expect(lines(before, typed)).toEqual(['~ tet type gene → CDS 5..12']);

    // A qualifier can be a paragraph of /note, so those are counted.
    const noted = before.updateFeature('f1', {
      qualifiers: [
        { name: 'note', value: 'a long explanation' },
        { name: 'gene', value: 'tet' },
      ],
    });
    expect(lines(before, noted)).toEqual(['~ tet 2 qualifiers changed 5..12']);

    // Several at once read in one line, and where it went is the column
    // every row already has.
    const lots = before.updateFeature('f1', {
      type: 'CDS',
      strand: 'reverse',
      segments: [rangeSegment(4, 20)],
    });
    expect(lines(before, lots)).toEqual([
      '~ tet type gene → CDS, now on the reverse strand, moved 5..20',
    ]);
  });

  it('falls back to the type, which is all an unnamed feature has', () => {
    const before = doc([feature('f1', 4, 12)]);
    expect(lines(before, before.removeFeature('f1'))).toEqual(['− misc_binding 5..12']);
  });

  it('says a deletion once rather than once per feature it took', () => {
    const inside = [
      feature('a', 10, 20, 'bla', 'CDS'),
      feature('b', 12, 14, 'op'),
      feature('c', 15, 18),
      feature('d', 16, 19),
    ];
    const before = doc(inside);
    // The deletion removes the features itself; what is left is the
    // untouched flanks, so every one of them maps onto the same boundary.
    const after = before.delete({ start: 8, end: 22 });
    const rows = lines(before, after);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatch(/^− the deletion at \d+ took 4 features with it: bla, op, /);
    expect(rows[0]).toContain('and 1 more');
  });

  it('counts the features it stops naming', () => {
    const many = Array.from({ length: 12 }, (_, i) => feature(`f${i}`, i, i + 1));
    const before = doc([]);
    const after = many.reduce((d, f) => d.addFeature(f), before);
    const rows = lines(before, after);
    expect(rows).toHaveLength(9);
    expect(rows[8]).toBe('and 4 features added');
  });

  it('is empty when nothing about the annotation changed', () => {
    const before = doc([feature('f1', 4, 12, 'tet', 'CDS')]);
    expect(lines(before, before.insert(40, 'GGG'))).toEqual([]);
  });
});
