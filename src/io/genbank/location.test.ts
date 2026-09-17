import { createFeature, rangeSegment, siteSegment } from '@/core';

import { LocationError, formatLocation, parseLocation } from './location';

const L = 100;

function segs(text: string, topology: 'linear' | 'circular' = 'linear') {
  const parsed = parseLocation(text, L, topology);
  return {
    strand: parsed.strand,
    segments: parsed.segments.map((s) =>
      s.kind === 'range'
        ? [s.start, s.end, s.partialStart ? '<' : '', s.partialEnd ? '>' : '']
        : ['site', s.position],
    ),
    warnings: parsed.warnings,
  };
}

describe('parseLocation', () => {
  it('parses simple ranges, points and partial markers', () => {
    expect(segs('10..20')).toMatchObject({ strand: 'forward', segments: [[9, 20, '', '']] });
    expect(segs('7')).toMatchObject({ segments: [[6, 7, '', '']] });
    expect(segs('<1..>100')).toMatchObject({ segments: [[0, 100, '<', '>']] });
    expect(segs('<5..9')).toMatchObject({ segments: [[4, 9, '<', '']] });
    expect(segs('5..>9')).toMatchObject({ segments: [[4, 9, '', '>']] });
    expect(segs('complement(10..20)')).toMatchObject({
      strand: 'reverse',
      segments: [[9, 20, '', '']],
    });
    expect(segs(' join( 1..3 , 7..9 ) ').segments).toEqual([
      [0, 3, '', ''],
      [6, 9, '', ''],
    ]);
  });

  it('keeps forward order for complement(join(...)) and reverses join(complement(...))', () => {
    const a = segs('complement(join(1..3,7..9))');
    const b = segs('join(complement(7..9),complement(1..3))');
    expect(a.strand).toBe('reverse');
    expect(a.segments).toEqual([
      [0, 3, '', ''],
      [6, 9, '', ''],
    ]);
    expect(b).toEqual({ ...a, warnings: [] });
  });

  it('parses sites, fuzzy ranges and order() with warnings where meaning is lost', () => {
    expect(segs('5^6')).toMatchObject({ segments: [['site', 5]], warnings: [] });
    expect(segs('100^1', 'circular')).toMatchObject({ segments: [['site', 0]] });
    expect(segs('100^101')).toMatchObject({ segments: [['site', 100]] });
    expect(segs('5^9').warnings[0]).toMatch(/not between adjacent/);
    const fuzzy = segs('3.5');
    expect(fuzzy.segments).toEqual([[2, 5, '', '']]);
    expect(fuzzy.warnings[0]).toMatch(/fuzzy/);
    const order = segs('order(1..3,7..9)');
    expect(order.segments).toHaveLength(2);
    expect(order.warnings[0]).toMatch(/order/);
  });

  it('unrolls origin-spanning locations on circular sequences', () => {
    expect(segs('90..10', 'circular')).toMatchObject({ segments: [[89, 110, '', '']] });
    expect(segs('join(90..100,1..10)', 'circular')).toMatchObject({
      segments: [[89, 110, '', '']],
    });
    expect(segs('join(<90..100,1..>10)', 'circular')).toMatchObject({
      segments: [[89, 110, '<', '>']],
    });
    expect(segs('complement(join(90..100,1..10))', 'circular')).toMatchObject({
      strand: 'reverse',
      segments: [[89, 110, '', '']],
    });
    // On a linear sequence the same join stays two segments.
    expect(segs('join(90..100,1..10)').segments).toHaveLength(2);
    // A join that happens to end at L and restart at 1 but covers everything is left alone.
    expect(segs('join(1..100,1..10)', 'circular').segments).toHaveLength(2);
  });

  it('flags mixed strands and nested complements', () => {
    const mixed = segs('join(1..3,complement(7..9))');
    expect(mixed.strand).toBe('forward');
    expect(mixed.warnings[0]).toMatch(/mixed-strand/);
    expect(segs('complement(join(1..3,complement(7..9)))').warnings[0]).toMatch(/nested/);
  });

  it('rejects what it cannot represent', () => {
    expect(() => parseLocation('90..10', L, 'linear')).toThrow(LocationError);
    expect(() => parseLocation('0..5', L, 'linear')).toThrow(/outside/);
    expect(() => parseLocation('5..101', L, 'linear')).toThrow(/outside/);
    expect(() => parseLocation('J00194.1:100..202', L, 'linear')).toThrow(/remote/);
    expect(() => parseLocation('join(1..3', L, 'linear')).toThrow(LocationError);
    expect(() => parseLocation('1..3)', L, 'linear')).toThrow(LocationError);
    expect(() => parseLocation('abc', L, 'linear')).toThrow(LocationError);
    expect(() => parseLocation('', L, 'linear')).toThrow(LocationError);
  });
});

describe('formatLocation', () => {
  const f = (
    segments: Parameters<typeof createFeature>[0]['segments'],
    strand: 'forward' | 'reverse' = 'forward',
  ) => createFeature({ type: 'misc', segments, strand });

  it('formats every shape and round-trips through the parser', () => {
    const cases: [string, 'linear' | 'circular'][] = [
      ['10..20', 'linear'],
      ['7', 'linear'],
      ['<1..>100', 'linear'],
      ['complement(10..20)', 'linear'],
      ['join(1..3,7..9)', 'linear'],
      ['complement(join(1..3,7..9))', 'linear'],
      ['join(90..100,1..10)', 'circular'],
      ['complement(join(<90..100,1..>10))', 'circular'],
      ['5^6', 'linear'],
      ['100^1', 'circular'],
      ['join(5^6,10..12)', 'linear'],
    ];
    for (const [text, topology] of cases) {
      const parsed = parseLocation(text, L, topology);
      const feature = f(parsed.segments, parsed.strand);
      expect(formatLocation(feature, L, topology)).toBe(text);
    }
  });

  it('writes a single-base range with partial markers in a..b form', () => {
    expect(formatLocation(f([rangeSegment(4, 5, { partialStart: true })]), L, 'linear')).toBe(
      '<5..5',
    );
  });

  it('clamps sites GenBank cannot express', () => {
    expect(formatLocation(f([siteSegment(0)]), L, 'linear')).toBe('1^2');
    expect(formatLocation(f([siteSegment(100)]), L, 'linear')).toBe('99^100');
    expect(formatLocation(f([siteSegment(0)]), L, 'circular')).toBe('100^1');
  });
});
