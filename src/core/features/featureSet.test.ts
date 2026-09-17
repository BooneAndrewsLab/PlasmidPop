import { range } from '../range';
import { createFeature } from './feature';
import { FeatureSet } from './featureSet';
import { rangeSegment, siteSegment } from './segment';

const L = 100;
const cds = createFeature({ id: 'cds', type: 'CDS', segments: [rangeSegment(10, 40)] });
const ori = createFeature({ id: 'ori', type: 'rep_origin', segments: [rangeSegment(90, 105)] });
const joined = createFeature({
  id: 'join',
  type: 'mRNA',
  segments: [rangeSegment(50, 55), rangeSegment(60, 70)],
});
const site = createFeature({ id: 'site', type: 'misc_feature', segments: [siteSegment(80)] });

describe('FeatureSet', () => {
  const set = FeatureSet.from([cds, ori, joined, site]);

  it('is immutable and keeps insertion order', () => {
    const extra = createFeature({ id: 'x', type: 'gene', segments: [rangeSegment(0, 5)] });
    const next = set.add(extra);
    expect(set.size).toBe(4);
    expect(next.size).toBe(5);
    expect(next.all().map((f) => f.id)).toEqual(['cds', 'ori', 'join', 'site', 'x']);
    expect(() => set.add(cds)).toThrow(/Duplicate/);
    expect(set.remove('nope')).toBe(set);
    expect(set.remove('ori').has('ori')).toBe(false);
    const renamed = { ...cds, name: 'lacZ' };
    expect(set.replace(renamed).get('cds')?.name).toBe('lacZ');
    expect(set.get('cds')?.name).toBe('');
    expect(() => set.replace({ ...cds, id: 'missing' })).toThrow(/Unknown/);
  });

  it('finds features overlapping a range, including across the origin', () => {
    const ids = (r: { start: number; end: number }) =>
      set
        .overlapping(r, L)
        .map((f) => f.id)
        .sort();
    expect(ids(range(0, 3))).toEqual(['ori']);
    expect(ids(range(95, 100))).toEqual(['ori']);
    expect(ids(range(5, 15))).toEqual(['cds']);
    expect(ids(range(40, 50))).toEqual([]);
    expect(ids(range(54, 61))).toEqual(['join']);
    expect(ids(range(98, 112))).toEqual(['cds', 'ori']);
    expect(ids(range(0, 100))).toEqual(['cds', 'join', 'ori', 'site']);
    expect(ids(range(20, 20))).toEqual([]);
  });

  it('treats sites as touched only when strictly inside the query', () => {
    const ids = (a: number, b: number) => set.overlapping(range(a, b), L).map((f) => f.id);
    expect(ids(79, 81)).toEqual(['site']);
    expect(ids(80, 90)).toEqual([]);
    expect(ids(70, 80)).toEqual([]);
    expect(ids(75, 85)).toEqual(['site']);
    // wrapped query covering 79 and 80
    expect(ids(79, 181)).toContain('site');
  });

  it('finds features at a position', () => {
    expect(set.at(0, L).map((f) => f.id)).toEqual(['ori']);
    expect(set.at(4, L).map((f) => f.id)).toEqual(['ori']);
    expect(set.at(5, L)).toEqual([]);
    expect(set.at(80, L)).toEqual([]);
    expect(set.at(65, L).map((f) => f.id)).toEqual(['join']);
    expect(set.at(100, L)).toEqual([]);
  });

  it('map drops features that return null and preserves identity when nothing changes', () => {
    expect(set.map((f) => f)).toBe(set);
    const dropped = set.map((f) => (f.id === 'site' ? null : f));
    expect(dropped.size).toBe(3);
    expect(FeatureSet.from([]).map((f) => f)).toBe(FeatureSet.EMPTY);
  });
});
