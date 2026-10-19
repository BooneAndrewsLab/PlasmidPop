import {
  flipSegment,
  rangeSegment,
  shiftSegmentBy,
  shiftSegmentForDelete,
  shiftSegmentForInsert,
} from './segment';

describe('single-position spelling mark (#255)', () => {
  const one = rangeSegment(10, 11, { partialStart: true, single: true });

  it('survives a move and a flip, swapping the partial end', () => {
    expect(shiftSegmentBy(one, 5)).toMatchObject({ start: 15, single: true });
    expect(shiftSegmentForInsert(one, 0, 3, 50, 'linear')).toMatchObject({
      start: 13,
      single: true,
    });
    expect(flipSegment(one, 50, 'linear')).toMatchObject({
      partialStart: false,
      partialEnd: true,
      single: true,
    });
  });

  it('is dropped when an edit resizes the segment', () => {
    // An edit that changes the length (here a stale mark on two bases, then
    // an insert inside it) must not leave the mark behind.
    const two = rangeSegment(10, 12, { partialStart: true, single: true });
    const grown = shiftSegmentForInsert(two, 11, 2, 50, 'linear');
    expect(grown).toMatchObject({ start: 10, end: 14, partialStart: true });
    expect(grown).not.toHaveProperty('single');
    const cut = shiftSegmentForDelete(two, { start: 11, end: 12 }, 50);
    expect(cut).toMatchObject({ start: 10, end: 11 });
    expect(cut).not.toHaveProperty('single');
  });
});
