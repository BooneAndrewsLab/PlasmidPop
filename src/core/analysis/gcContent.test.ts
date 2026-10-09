import { describe, expect, it } from 'vitest';

import { formatGc, gcContent, gcContentOfRange, gcProfile, gcWindowFor } from './gcContent';

describe('gcContent', () => {
  it('counts G, C and S, and ignores case', () => {
    expect(gcContent('GCAT')).toBe(0.5);
    expect(gcContent('gcat')).toBe(0.5);
    expect(gcContent('SSAA')).toBe(0.5);
  });

  it('weighs ambiguity codes by what they could be, and leaves N out', () => {
    expect(gcContent('R')).toBe(0.5);
    expect(gcContent('B')).toBeCloseTo(2 / 3, 12);
    expect(gcContent('D')).toBeCloseTo(1 / 3, 12);
    expect(gcContent('W')).toBe(0);
    expect(gcContent('GNNNN')).toBe(1);
    expect(gcContent('NNNN')).toBeNull();
    expect(gcContent('')).toBeNull();
  });

  it('takes a range, half open', () => {
    expect(gcContent('GGAATT', 0, 2)).toBe(1);
    expect(gcContent('GGAATT', 2, 6)).toBe(0);
  });

  it('wraps the origin of a circular range', () => {
    // bases 4,5,0,1 = T,T,G,G... "GGAATT": [4, 8) covers TT then GG
    expect(gcContentOfRange('GGAATT', 4, 8, true)).toBe(0.5);
    expect(gcContentOfRange('GGAATT', 4, 6, true)).toBe(0);
  });
});

describe('gcContentOfRange with nothing to count', () => {
  it('is null, not NaN, for a wrapped range of bases that say nothing', () => {
    expect(gcContentOfRange('NNNN', 2, 6, true)).toBeNull();
    expect(gcContentOfRange('', 0, 3, true)).toBeNull();
  });
});

describe('gcProfile', () => {
  it('is one value per base, and a window of 1 is the base itself', () => {
    expect(Array.from(gcProfile('GATC', 1, false))).toEqual([1, 0, 0, 1]);
  });

  it('shrinks the window at the ends of a linear sequence', () => {
    // window 3: [G,G], [G,G,A], [G,A,A], [A,A]
    const p = gcProfile('GGAA', 3, false);
    expect(p[0]).toBe(1);
    expect(p[1]).toBeCloseTo(2 / 3, 6);
    expect(p[2]).toBeCloseTo(1 / 3, 6);
    expect(p[3]).toBe(0);
  });

  it('wraps across the origin of a circular sequence', () => {
    // At base 0 the window is bases 5,0,1 = T,G,G.
    const p = gcProfile('GGAATT', 3, true);
    expect(p[0]).toBeCloseTo(2 / 3, 6);
    // At base 5 the window is 4,5,0 = T,T,G.
    expect(p[5]).toBeCloseTo(1 / 3, 6);
    // The same sequence rotated gives the same profile, rotated.
    const q = gcProfile('AATTGG', 3, true);
    for (let i = 0; i < 6; i++) expect(q[(i + 4) % 6]).toBeCloseTo(p[i] ?? -1, 6);
  });

  it('gives a window as long as a circular sequence its whole content everywhere', () => {
    const p = gcProfile('GGAA', 10, true);
    expect(Array.from(p)).toEqual([0.5, 0.5, 0.5, 0.5]);
  });

  it('matches the direct count for every window, with ambiguity codes', () => {
    const seq = 'GATTACARYNNGCSWBDHVKMGGCC';
    for (const circular of [false, true]) {
      for (const w of [1, 2, 3, 4, 7, 10]) {
        const p = gcProfile(seq, w, circular);
        const back = Math.floor((w - 1) / 2);
        for (let i = 0; i < seq.length; i++) {
          const direct = circular
            ? gcContentOfRange(
                seq,
                (((i - back) % seq.length) + seq.length) % seq.length,
                ((((i - back) % seq.length) + seq.length) % seq.length) + w,
                true,
              )
            : gcContent(seq, i - back, i - back + w);
          if (direct === null) expect(p[i]).toBeNaN();
          else expect(p[i]).toBeCloseTo(direct, 5);
        }
      }
    }
  });

  it('is NaN where the window says nothing', () => {
    expect(gcProfile('NNNN', 2, false)[0]).toBeNaN();
    expect(gcProfile('', 5, true).length).toBe(0);
  });

  it('handles a long sequence in one pass', () => {
    const seq = 'GC'.repeat(250_000) + 'AT'.repeat(250_000);
    const p = gcProfile(seq, 1000, true);
    expect(p.length).toBe(1_000_000);
    expect(p[100_000]).toBe(1);
    expect(p[800_000]).toBe(0);
  }, 20_000);
});

describe('gcWindowFor', () => {
  it('defaults to 50 on the sequence view and 1 % on the map', () => {
    expect(gcWindowFor(null, 5000, false)).toBe(50);
    expect(gcWindowFor(null, 5000, true)).toBe(50);
    expect(gcWindowFor(null, 100_000, true)).toBe(1000);
    expect(gcWindowFor(null, 300, true)).toBe(10);
    expect(gcWindowFor(200, 5000, true)).toBe(200);
  });
});

describe('formatGc', () => {
  it('prints a percentage with one decimal', () => {
    expect(formatGc(0.5234)).toBe('52.3 %');
  });
});
