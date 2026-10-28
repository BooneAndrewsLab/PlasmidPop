import {
  SCRATCH_LIFETIME_DAYS,
  SCRATCH_NOTICE_DAYS,
  expiredScratch,
  expiringScratch,
  scratchExpiry,
} from './scratch';

const DAY = 24 * 60 * 60 * 1000;
const NO_TABS: ReadonlySet<string> = new Set();

describe('when a scratch document goes (item 110)', () => {
  it('is thirty days after it was last touched, and a week of notice before', () => {
    expect(SCRATCH_LIFETIME_DAYS).toBe(30);
    expect(SCRATCH_NOTICE_DAYS).toBe(7);
    expect(scratchExpiry(1000)).toBe(1000 + 30 * DAY);
  });

  it('removes a scratch row from the moment it is due, not a moment before', () => {
    const rows = [{ id: 'a', kind: 'scratch' as const, updatedAt: 0 }];
    expect(expiredScratch(rows, 30 * DAY - 1, NO_TABS)).toEqual([]);
    expect(expiredScratch(rows, 30 * DAY, NO_TABS)).toEqual(['a']);
  });

  it('never takes a kept row, however old, nor one from before kinds', () => {
    const rows = [
      { id: 'kept', kind: 'file' as const, updatedAt: 0 },
      { id: 'legacy', updatedAt: 0 },
      { id: 'scratch', kind: 'scratch' as const, updatedAt: 0 },
    ];
    expect(expiredScratch(rows, 1000 * DAY, NO_TABS)).toEqual(['scratch']);
    expect(expiringScratch(rows, 1000 * DAY, NO_TABS)?.ids).toEqual(['scratch']);
  });

  it('never takes one that is open in a tab', () => {
    const rows = [
      { id: 'open', kind: 'scratch' as const, updatedAt: 0 },
      { id: 'closed', kind: 'scratch' as const, updatedAt: 0 },
    ];
    expect(expiredScratch(rows, 40 * DAY, new Set(['open']))).toEqual(['closed']);
    expect(expiringScratch(rows, 40 * DAY, new Set(['open']))?.ids).toEqual(['closed']);
  });

  it('gives notice of the rows due within the week, and when the first goes', () => {
    const now = 100 * DAY;
    const rows = [
      { id: 'fresh', kind: 'scratch' as const, updatedAt: now },
      { id: 'soon', kind: 'scratch' as const, updatedAt: now - 25 * DAY },
      { id: 'sooner', kind: 'scratch' as const, updatedAt: now - 28 * DAY },
    ];
    expect(expiringScratch(rows, now, NO_TABS)).toEqual({
      ids: ['soon', 'sooner'],
      firstAt: now + 2 * DAY,
    });
    // The week is a closed window: 23 days old is the first day inside it.
    expect(
      expiringScratch([{ id: 'x', kind: 'scratch', updatedAt: now - 23 * DAY }], now, NO_TABS),
    ).not.toBeNull();
    expect(
      expiringScratch([{ id: 'x', kind: 'scratch', updatedAt: now - 23 * DAY + 1 }], now, NO_TABS),
    ).toBeNull();
    expect(expiringScratch([], now, NO_TABS)).toBeNull();
  });
});
