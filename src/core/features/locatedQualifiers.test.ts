import { SeqDocument, extractRange, fragmentFromRange } from '../document';
import { type Feature, createFeature, firstQualifier } from './feature';
import { formatLocatedValue, parseLocatedValue } from './locatedQualifiers';
import { rangeSegment } from './segment';

//              0         1         2
//              012345678901234567890123
const BASES = 'CCCCCCATGTGAAAATAACCCCCC';

/** ATG TGA AAA TAA at 6..18, its TGA (7..9 in the file's terms) read as Sec. */
function sec(extra: { name: string; value: string }[] = []): Feature {
  return createFeature({
    id: 'cds',
    type: 'CDS',
    segments: [rangeSegment(6, 18)],
    qualifiers: [{ name: 'transl_except', value: '(pos:10..12,aa:Sec)' }, ...extra],
  });
}

function docWith(feature: Feature, topology: 'linear' | 'circular' = 'linear'): SeqDocument {
  return SeqDocument.create({ sequence: BASES, topology, features: [feature] });
}

function except(doc: SeqDocument): string | undefined {
  const f = doc.features.all()[0];
  return f === undefined ? undefined : firstQualifier(f, 'transl_except');
}

describe('parseLocatedValue', () => {
  const space = { length: 100, topology: 'circular' } as const;

  it('takes the location apart from the rest, commas inside it included', () => {
    const parsed = parseLocatedValue('(pos:join(99..100,1),aa:Sec)', space);
    expect(parsed?.rest).toBe('aa:Sec');
    expect(parsed?.location.segments).toEqual([rangeSegment(98, 101)]);
    const anticodon = parseLocatedValue('(pos:complement(34..36),aa:Phe,seq:gaa)', space);
    expect(anticodon?.location.strand).toBe('reverse');
    expect(anticodon?.rest).toBe('aa:Phe,seq:gaa');
  });

  it('writes the value back the way it was read', () => {
    for (const value of ['(pos:4..6,aa:Sec)', '(pos:complement(34..36),aa:Phe,seq:gaa)']) {
      const parsed = parseLocatedValue(value, space);
      expect(parsed === null ? null : formatLocatedValue(parsed, space)).toBe(value);
    }
  });

  it('declines what is not a location on this sequence', () => {
    expect(parseLocatedValue('aa:Sec', space)).toBeNull();
    expect(parseLocatedValue('(pos:,aa:Sec)', space)).toBeNull();
    expect(parseLocatedValue('(pos:200..202,aa:Sec)', space)).toBeNull();
  });
});

describe('located qualifiers follow their feature', () => {
  it('shift with an insertion upstream and stay put for one downstream', () => {
    expect(except(docWith(sec()).insert(2, 'GGG'))).toBe('(pos:13..15,aa:Sec)');
    expect(except(docWith(sec()).insert(20, 'GGG'))).toBe('(pos:10..12,aa:Sec)');
  });

  it('shift back with a deletion upstream', () => {
    expect(except(docWith(sec()).delete({ start: 0, end: 4 }))).toBe('(pos:6..8,aa:Sec)');
  });

  it('are dropped when an edit changes the bases they name, and nothing else is', () => {
    const inside = docWith(sec([{ name: 'note', value: 'kept' }])).insert(10, 'A');
    const f = inside.features.all()[0];
    expect(f?.qualifiers).toEqual([{ name: 'note', value: 'kept' }]);
    expect(except(docWith(sec()).delete({ start: 9, end: 10 }))).toBeUndefined();
  });

  it('flip strand and position with a reverse complement', () => {
    // 24 bases: 1-based 10..12 is 13..15 on the other strand.
    expect(except(docWith(sec()).reverseComplement())).toBe('(pos:complement(13..15),aa:Sec)');
    expect(except(docWith(sec()).reverseComplement().reverseComplement())).toBe(
      '(pos:10..12,aa:Sec)',
    );
  });

  it('rotate with the origin, across it if need be', () => {
    expect(except(docWith(sec(), 'circular').setOrigin(4))).toBe('(pos:6..8,aa:Sec)');
    // Base 10 as the new base 1 would put the origin inside the feature,
    // so the codon it names is split: 10 becomes 24, 11..12 become 1..2.
    const split = docWith(sec(), 'circular').setOrigin(10);
    expect(except(split)).toBe('(pos:join(24,1..2),aa:Sec)');
  });

  it('move into an extract, and are dropped when it cuts them', () => {
    expect(except(extractRange(docWith(sec()), { start: 6, end: 18 }))).toBe('(pos:4..6,aa:Sec)');
    expect(except(extractRange(docWith(sec()), { start: 10, end: 18 }))).toBeUndefined();
  });

  it('go with a fragment into another document', () => {
    const fragment = fragmentFromRange(docWith(sec()), { start: 6, end: 18 });
    const target = SeqDocument.create({ sequence: 'GGGGG' }).insertFragment(
      { start: 2, end: 2 },
      fragment,
    );
    expect(except(target)).toBe('(pos:6..8,aa:Sec)');
  });

  it('are kept as they were when they cannot be read', () => {
    const odd = createFeature({
      type: 'CDS',
      segments: [rangeSegment(6, 18)],
      qualifiers: [{ name: 'transl_except', value: '(pos:somewhere,aa:Sec)' }],
    });
    expect(except(docWith(odd).insert(0, 'GGG'))).toBe('(pos:somewhere,aa:Sec)');
  });
});
