import { createFeature, rangeSegment } from '@/core';

import { contrastingText, featureColor } from './featureColors';

const seg = [rangeSegment(0, 5)];

describe('featureColor', () => {
  it('prefers ApE colours by strand, then SnapGene note colours, then type', () => {
    const ape = createFeature({
      type: 'CDS',
      strand: 'reverse',
      segments: seg,
      qualifiers: [
        { name: 'ApEinfo_fwdcolor', value: '#ABCDEF' },
        { name: 'ApEinfo_revcolor', value: '#123456' },
      ],
    });
    expect(featureColor(ape)).toBe('#123456');
    expect(featureColor({ ...ape, strand: 'forward' })).toBe('#abcdef');
    const snap = createFeature({
      type: 'CDS',
      segments: seg,
      qualifiers: [{ name: 'note', value: 'color: #FF0000; direction: RIGHT' }],
    });
    expect(featureColor(snap)).toBe('#ff0000');
    expect(featureColor(createFeature({ type: 'promoter', segments: seg }))).toBe('#e9a03b');
    expect(featureColor(createFeature({ type: 'weird_key', segments: seg }))).toBe('#9aa5b1');
    const junk = createFeature({
      type: 'CDS',
      segments: seg,
      qualifiers: [{ name: 'ApEinfo_fwdcolor', value: 'red' }],
    });
    expect(featureColor(junk)).toBe('#6f9bd1');
  });
});

describe('contrastingText', () => {
  it('picks dark text on light fills and light text on dark fills', () => {
    expect(contrastingText('#ffffff')).toBe('#1c2430');
    expect(contrastingText('#000')).toBe('#ffffff');
    expect(contrastingText('#6f9bd1')).toBe('#ffffff');
    expect(contrastingText('nonsense')).toBe('#1c2430');
  });
});
