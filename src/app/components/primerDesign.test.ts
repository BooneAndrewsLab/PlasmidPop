import { type BindingSite } from '@/core';

import { siteSpan } from './primerDesign';

describe('siteSpan', () => {
  const site = (start: number, end: number): BindingSite => ({
    range: { start, end },
    strand: 'forward',
    mismatches: 0,
  });

  it('writes a site 1-based and inclusive', () => {
    expect(siteSpan(site(373, 390), 5000)).toBe('374–390');
    expect(siteSpan(site(4980, 5000), 5000)).toBe('4,981–5,000');
  });

  it('wraps the end of a site across the origin onto the circle', () => {
    // [4990, 5010) on 5,000 bases: 4,991 round to 10.
    expect(siteSpan(site(4990, 5010), 5000)).toBe('4,991–10');
    expect(siteSpan(site(4999, 5001), 5000)).toBe('5,000–1');
  });
});
