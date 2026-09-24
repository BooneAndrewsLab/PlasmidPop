import { createFeature, featureExtent } from './feature';
import { rangeSegment, siteSegment } from './segment';

describe('featureExtent', () => {
  it('runs from the first range segment to the last', () => {
    const joined = createFeature({
      type: 'CDS',
      name: 'split',
      strand: 'forward',
      segments: [rangeSegment(10, 20), siteSegment(25), rangeSegment(30, 45)],
    });
    expect(featureExtent(joined)).toEqual({ start: 10, end: 45 });
  });

  it('keeps an origin-spanning segment unrolled past the end', () => {
    const wrapped = createFeature({
      type: 'misc_feature',
      name: 'ori',
      strand: 'forward',
      segments: [rangeSegment(90, 110)],
    });
    expect(featureExtent(wrapped)).toEqual({ start: 90, end: 110 });
  });

  it('has none for a feature of sites alone', () => {
    const site = createFeature({
      type: 'misc_binding',
      name: 'nick',
      strand: 'forward',
      segments: [siteSegment(5)],
    });
    expect(featureExtent(site)).toBeNull();
  });
});
