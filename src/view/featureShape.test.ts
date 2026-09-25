import { createFeature, rangeSegment } from '@/core';

import {
  THICKNESS_QUALIFIER,
  chosenThickness,
  featureThickness,
  thicknessFraction,
} from './featureShape';

/** How thick a feature's bar is drawn (#88). */
describe('feature thickness', () => {
  const feature = (type: string, value?: string) =>
    createFeature({
      type,
      segments: [rangeSegment(0, 10)],
      qualifiers: value === undefined ? [] : [{ name: THICKNESS_QUALIFIER, value }],
    });

  it('draws an intron thin and everything else full by default', () => {
    expect(featureThickness(feature('intron'))).toBe('thin');
    expect(featureThickness(feature('exon'))).toBe('full');
    expect(featureThickness(feature('CDS'))).toBe('full');
    expect(thicknessFraction(feature('intron'))).toBeLessThan(thicknessFraction(feature('CDS')));
  });

  it('takes the thickness chosen for a feature over its type', () => {
    expect(featureThickness(feature('intron', 'full'))).toBe('full');
    expect(featureThickness(feature('CDS', 'medium'))).toBe('medium');
    expect(chosenThickness(feature('CDS', ' Thin '))).toBe('thin');
  });

  it('ignores a value it does not know', () => {
    expect(chosenThickness(feature('CDS', 'huge'))).toBeNull();
    expect(featureThickness(feature('intron', 'huge'))).toBe('thin');
  });
});
