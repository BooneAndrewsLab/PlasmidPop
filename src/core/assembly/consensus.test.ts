import { describe, expect, it } from 'vitest';

import { callColumn, iupacOf } from './consensus';

const v = (base: string, quality: number) => ({ base, quality });

describe('callColumn', () => {
  it('calls the base the reads agree on, surer with more of them', () => {
    const one = callColumn([v('A', 20)]);
    const three = callColumn([v('A', 20), v('A', 20), v('A', 20)]);
    expect(one.symbol).toBe('A');
    expect(three.symbol).toBe('A');
    expect(three.quality).toBeGreaterThan(one.quality);
    expect(three.ambiguous).toBe(false);
  });

  it('lets a high-quality base outweigh a poor one', () => {
    const c = callColumn([v('A', 40), v('G', 8)]);
    expect(c).toMatchObject({ symbol: 'A', ambiguous: false });
    // ... and several poor ones do not outvote one good one.
    expect(callColumn([v('A', 40), v('G', 5), v('G', 5)]).symbol).toBe('A');
  });

  it('gives an ambiguity code where equally good reads disagree', () => {
    expect(callColumn([v('A', 35), v('G', 35)])).toMatchObject({ symbol: 'R', ambiguous: true });
    expect(callColumn([v('C', 35), v('T', 35)]).symbol).toBe('Y');
    expect(callColumn([v('A', 30), v('C', 30), v('T', 30)]).symbol).toBe('H');
  });

  it('drops a column the reads mostly have a gap in, and keeps one they mostly have a base in', () => {
    expect(callColumn([v('-', 30), v('-', 30), v('A', 30)]).symbol).toBe('');
    expect(callColumn([v('A', 30), v('A', 30), v('-', 30)]).symbol).toBe('A');
  });

  it('ignores reads that say N and says N when no read says anything', () => {
    expect(callColumn([v('N', 40), v('C', 30)]).symbol).toBe('C');
    expect(callColumn([v('N', 40)])).toEqual({ symbol: 'N', quality: 0, ambiguous: false });
    expect(callColumn([])).toEqual({ symbol: 'N', quality: 0, ambiguous: false });
  });

  it('keeps a quality of 0 from ruling a base out', () => {
    expect(callColumn([v('A', 0), v('A', 30)]).symbol).toBe('A');
    // ... though one such read alone is too unsure to call a base.
    expect(callColumn([v('A', 0)]).symbol).toBe('N');
  });
});

describe('iupacOf', () => {
  it('names every set of bases, in any order', () => {
    expect(iupacOf(['T', 'G'])).toBe('K');
    expect(iupacOf(['G', 'C', 'A'])).toBe('V');
    expect(iupacOf(['A', 'C', 'G', 'T'])).toBe('N');
    expect(iupacOf(['A', 'A'])).toBe('A');
  });
});
