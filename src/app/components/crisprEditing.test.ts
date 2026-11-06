import { type CrisprGuide, type NickPair } from '@/core';

import { pairId, pairSpan, pegId } from './crisprEditing';

/** A guide at [start, end) on `strand`; only what the pair's span and ids read. */
function guide(strand: 'forward' | 'reverse', start: number, end = start + 20): CrisprGuide {
  return { strand, range: { start, end } } as CrisprGuide;
}
function pair(forwardNick: CrisprGuide, reverseNick: CrisprGuide): NickPair {
  return { forwardNick, reverseNick } as NickPair;
}

describe('pairSpan', () => {
  it('covers both guides on a linear molecule, whichever comes first', () => {
    expect(pairSpan(pair(guide('forward', 10), guide('reverse', 50)), 200, 'linear')).toEqual({
      start: 10,
      end: 70,
    });
    expect(pairSpan(pair(guide('reverse', 50), guide('forward', 10)), 200, 'linear')).toEqual({
      start: 10,
      end: 70,
    });
  });

  it('is the short way round on a circle, across the origin', () => {
    // 190-210 (wrapping) and 5-25 of a 200-base circle are 15 bases apart, not 185.
    const span = pairSpan(pair(guide('forward', 190, 210), guide('reverse', 5)), 200, 'circular');
    expect(span).toEqual({ start: 190, end: 225 });
    // The other way round it is the same bases.
    expect(
      pairSpan(pair(guide('reverse', 5), guide('forward', 190, 210)), 200, 'circular'),
    ).toEqual({ start: 190, end: 225 });
  });

  it('is the plain span on a circle where nothing wraps, and never more than the circle', () => {
    expect(pairSpan(pair(guide('forward', 10), guide('reverse', 50)), 200, 'circular')).toEqual({
      start: 10,
      end: 70,
    });
    const all = pairSpan(pair(guide('forward', 0), guide('reverse', 100)), 120, 'circular');
    expect(all.end - all.start).toBeLessThanOrEqual(120);
  });
});

describe('the ids of a pair and a pegRNA', () => {
  it('name the guides, so two pairs sharing a start are told apart', () => {
    const a = pair(guide('forward', 10), guide('reverse', 50));
    const b = pair(guide('reverse', 10), guide('forward', 50));
    expect(pairId(a)).toBe('forward:10|reverse:50');
    expect(pairId(a)).not.toBe(pairId(b));
    expect(pegId({ guide: guide('reverse', 7) } as Parameters<typeof pegId>[0])).toBe('reverse:7');
  });
});
