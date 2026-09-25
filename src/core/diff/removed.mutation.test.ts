import { createFeature, rangeSegment, siteSegment } from '../features';
import { type DocumentDiff, EMPTY_DIFF } from './documentDiff';
import { deletionThatTook, outerExtent } from './removed';

// Tests written against the survivors of a mutation run (item 50).

function withDeletions(...positions: number[]): DocumentDiff {
  return { ...EMPTY_DIFF, deletions: positions.map((position) => ({ position, count: 10 })) };
}

describe('outerExtent', () => {
  it('spans a feature of a site alone as that one position', () => {
    const site = createFeature({ type: 'misc_feature', segments: [siteSegment(5)] });
    expect(outerExtent(site)).toEqual({ start: 5, end: 5 });
  });

  it('reaches from a site before a range to the range end', () => {
    const f = createFeature({
      type: 'misc_feature',
      segments: [siteSegment(3), rangeSegment(8, 12)],
    });
    expect(outerExtent(f)).toEqual({ start: 3, end: 12 });
  });

  it('reaches from a range to a site after it', () => {
    const f = createFeature({
      type: 'misc_feature',
      segments: [rangeSegment(8, 12), siteSegment(20)],
    });
    expect(outerExtent(f)).toEqual({ start: 8, end: 20 });
  });
});

describe('deletionThatTook', () => {
  const oneBase = createFeature({ type: 'misc_feature', segments: [rangeSegment(5, 6)] });

  it('finds the deletion at either edge of what is left of the feature', () => {
    expect(deletionThatTook(oneBase, withDeletions(5))).toBe(5);
    expect(deletionThatTook(oneBase, withDeletions(6))).toBe(6);
  });

  it('finds none when the only deletions are elsewhere', () => {
    expect(deletionThatTook(oneBase, withDeletions(4))).toBeNull();
    expect(deletionThatTook(oneBase, withDeletions(7))).toBeNull();
    expect(deletionThatTook(oneBase, withDeletions(2, 20))).toBeNull();
  });

  it('picks the deletion that is there out of several', () => {
    expect(deletionThatTook(oneBase, withDeletions(1, 6, 30))).toBe(6);
  });

  it('finds the deletion that took a site', () => {
    const site = createFeature({ type: 'misc_feature', segments: [siteSegment(9)] });
    expect(deletionThatTook(site, withDeletions(9))).toBe(9);
    expect(deletionThatTook(site, withDeletions(8))).toBeNull();
  });

  it('says nothing took a feature that still covers more than a base', () => {
    const f = createFeature({ type: 'misc_feature', segments: [rangeSegment(2, 10)] });
    expect(deletionThatTook(f, withDeletions(5))).toBeNull();
  });
});
