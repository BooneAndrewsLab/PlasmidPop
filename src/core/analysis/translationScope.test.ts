import { type Feature, createFeature, rangeSegment } from '../features';
import { isTranslationScope, translatedFeatures } from './translationScope';

function cds(id: string, segments: Feature['segments'], gene?: string, name = id): Feature {
  return createFeature({
    id,
    type: 'CDS',
    name,
    segments,
    qualifiers: gene === undefined ? [] : [{ name: 'gene', value: gene }],
  });
}

const ids = (fs: readonly Feature[]) => fs.map((f) => f.id);

describe('translatedFeatures', () => {
  const short = cds('short', [rangeSegment(0, 30)], 'HAP1');
  const long = cds('long', [rangeSegment(0, 90)], 'HAP1');
  const other = cds('other', [rangeSegment(100, 130)], 'ABC');
  const bare1 = cds('bare1', [rangeSegment(200, 230)]);
  const bare2 = cds('bare2', [rangeSegment(200, 230)]);
  const all = [short, long, other, bare1, bare2];

  it('All keeps every CDS', () => {
    expect(ids(translatedFeatures(all, 'all', null))).toEqual(ids(all));
  });

  it('Selected shows only the selected CDS, or none', () => {
    expect(ids(translatedFeatures(all, 'selected', 'other'))).toEqual(['other']);
    expect(translatedFeatures(all, 'selected', null)).toEqual([]);
    expect(translatedFeatures(all, 'selected', 'a-gene-feature')).toEqual([]);
  });

  it('One per gene keeps the longest per gene and every gene-less CDS', () => {
    expect(ids(translatedFeatures(all, 'gene', null))).toEqual(['long', 'other', 'bare1', 'bare2']);
  });

  it('always shows the selected CDS as well', () => {
    expect(ids(translatedFeatures(all, 'gene', 'short'))).toEqual([
      'short',
      'long',
      'other',
      'bare1',
      'bare2',
    ]);
  });

  it('counts the total length of a join, and of a wrap split across the origin', () => {
    const joined = cds(
      'joined',
      [rangeSegment(0, 20), rangeSegment(40, 70), rangeSegment(80, 90)],
      'G',
    );
    const plain = cds('plain', [rangeSegment(0, 55)], 'G');
    expect(ids(translatedFeatures([plain, joined], 'gene', null))).toEqual(['joined']);
    const wrapped = cds('wrapped', [rangeSegment(90, 100), rangeSegment(0, 50)], 'W');
    const flat = cds('flat', [rangeSegment(10, 65)], 'W');
    expect(ids(translatedFeatures([flat, wrapped], 'gene', null))).toEqual(['wrapped']);
  });

  it('is indifferent to strand', () => {
    const rev = createFeature({
      id: 'rev',
      type: 'CDS',
      name: 'rev',
      strand: 'reverse',
      segments: [rangeSegment(0, 60)],
      qualifiers: [{ name: 'gene', value: 'R' }],
    });
    const fwd = cds('fwd', [rangeSegment(0, 30)], 'R');
    expect(ids(translatedFeatures([fwd, rev], 'gene', null))).toEqual(['rev']);
  });

  it('breaks a length tie for the CDS named after the gene, then by listing order', () => {
    const a = cds('a', [rangeSegment(0, 30)], 'X', 'variant 1');
    const b = cds('b', [rangeSegment(50, 80)], 'X', 'X');
    const c = cds('c', [rangeSegment(100, 130)], 'X', 'X');
    expect(ids(translatedFeatures([a, b, c], 'gene', null))).toEqual(['b']);
    expect(ids(translatedFeatures([c, b, a], 'gene', null))).toEqual(['c']);
  });
});

describe('isTranslationScope', () => {
  it('accepts the three modes only', () => {
    expect(['all', 'selected', 'gene'].every(isTranslationScope)).toBe(true);
    expect(isTranslationScope('one')).toBe(false);
    expect(isTranslationScope(undefined)).toBe(false);
  });
});
