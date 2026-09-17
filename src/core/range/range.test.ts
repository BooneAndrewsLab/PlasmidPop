import {
  flipRange,
  isValidRange,
  range,
  rangeContains,
  rangePieces,
  rangesOverlap,
  rotateRange,
  shiftRangeForDelete,
  shiftRangeForInsert,
  unrollRange,
} from './range';

describe('isValidRange', () => {
  it('accepts in-bounds linear ranges and rejects wrapping ones', () => {
    expect(isValidRange(range(0, 10), 10, 'linear')).toBe(true);
    expect(isValidRange(range(10, 10), 10, 'linear')).toBe(true);
    expect(isValidRange(range(3, 3), 10, 'linear')).toBe(true);
    expect(isValidRange(range(0, 11), 10, 'linear')).toBe(false);
    expect(isValidRange(range(8, 12), 10, 'linear')).toBe(false);
    expect(isValidRange(range(5, 4), 10, 'linear')).toBe(false);
    expect(isValidRange(range(-1, 4), 10, 'linear')).toBe(false);
    expect(isValidRange(range(1.5, 4), 10, 'linear')).toBe(false);
  });

  it('accepts wrapping and full-circle ranges on circular sequences', () => {
    expect(isValidRange(range(8, 12), 10, 'circular')).toBe(true);
    expect(isValidRange(range(0, 10), 10, 'circular')).toBe(true);
    expect(isValidRange(range(7, 17), 10, 'circular')).toBe(true);
    expect(isValidRange(range(7, 18), 10, 'circular')).toBe(false);
    expect(isValidRange(range(10, 10), 10, 'circular')).toBe(false);
    expect(isValidRange(range(0, 0), 0, 'circular')).toBe(true);
  });
});

describe('rangePieces / unrollRange', () => {
  it('splits a wrapping range into head and tail', () => {
    expect(rangePieces(range(8, 12), 10)).toEqual([range(8, 10), range(0, 2)]);
    expect(rangePieces(range(2, 5), 10)).toEqual([range(2, 5)]);
    expect(rangePieces(range(0, 10), 10)).toEqual([range(0, 10)]);
  });

  it('unrolls real endpoints', () => {
    expect(unrollRange(8, 2, 10)).toEqual(range(8, 12));
    expect(unrollRange(2, 8, 10)).toEqual(range(2, 8));
    expect(unrollRange(3, 3, 10)).toEqual(range(3, 3));
  });
});

describe('rangeContains / rangesOverlap', () => {
  it('handles wrapped ranges', () => {
    const r = range(8, 12);
    expect([8, 9, 0, 1].every((p) => rangeContains(r, p, 10))).toBe(true);
    expect([2, 7].some((p) => rangeContains(r, p, 10))).toBe(false);
    expect(rangeContains(r, -1, 10)).toBe(false);
    expect(rangeContains(r, 10, 10)).toBe(false);
  });

  it('detects overlap across the origin', () => {
    expect(rangesOverlap(range(8, 12), range(0, 1), 10)).toBe(true);
    expect(rangesOverlap(range(0, 1), range(8, 12), 10)).toBe(true);
    expect(rangesOverlap(range(8, 12), range(2, 8), 10)).toBe(false);
    expect(rangesOverlap(range(8, 12), range(9, 10), 10)).toBe(true);
    expect(rangesOverlap(range(2, 5), range(5, 7), 10)).toBe(false);
    expect(rangesOverlap(range(2, 5), range(4, 7), 10)).toBe(true);
    expect(rangesOverlap(range(3, 3), range(0, 10), 10)).toBe(false);
    expect(rangesOverlap(range(0, 10), range(4, 5), 10)).toBe(true);
  });
});

describe('shiftRangeForInsert', () => {
  it('linear: pushes at start, grows inside, ignores after', () => {
    const r = range(2, 5);
    const at = (p: number) => shiftRangeForInsert(r, p, 1, 10, 'linear');
    expect(at(0)).toEqual(range(3, 6));
    expect(at(1)).toEqual(range(3, 6));
    expect(at(2)).toEqual(range(3, 6));
    expect(at(3)).toEqual(range(2, 6));
    expect(at(4)).toEqual(range(2, 6));
    expect(at(5)).toEqual(range(2, 5));
    expect(at(6)).toEqual(range(2, 5));
  });

  it('linear: a range covering the whole sequence is pushed, not grown, at 0', () => {
    expect(shiftRangeForInsert(range(0, 10), 0, 2, 10, 'linear')).toEqual(range(2, 12));
    expect(shiftRangeForInsert(range(0, 10), 10, 2, 10, 'linear')).toEqual(range(0, 10));
  });

  it('circular: a full-circle range grows wherever you insert', () => {
    expect(shiftRangeForInsert(range(0, 10), 0, 2, 10, 'circular')).toEqual(range(2, 14));
    expect(shiftRangeForInsert(range(0, 10), 10, 2, 10, 'circular')).toEqual(range(2, 14));
    expect(shiftRangeForInsert(range(0, 10), 4, 2, 10, 'circular')).toEqual(range(0, 12));
  });

  describe('circular wrapped range [8,12) on length 10, inserting 3', () => {
    const r = range(8, 12);
    const at = (p: number) => shiftRangeForInsert(r, p, 3, 10, 'circular');

    it('grows when inserting at the origin', () => {
      // head [11,13) + tail [0,5): old 8,9 then new 0,1,2 then old 0,1
      expect(at(0)).toEqual(range(11, 18));
      expect(at(10)).toEqual(range(11, 18));
    });
    it('grows when inserting inside the head', () => {
      expect(at(9)).toEqual(range(8, 15));
    });
    it('grows when inserting inside the tail', () => {
      expect(at(1)).toEqual(range(11, 18));
    });
    it('stays the same size at its end boundary', () => {
      expect(at(2)).toEqual(range(11, 15));
    });
    it('is pushed at its start boundary', () => {
      expect(at(8)).toEqual(range(11, 15));
    });
    it('is shifted when inserting in the gap', () => {
      expect(at(5)).toEqual(range(11, 15));
    });
  });

  it('moves a cursor sitting at the insertion point', () => {
    expect(shiftRangeForInsert(range(3, 3), 3, 2, 10, 'linear')).toEqual(range(5, 5));
    expect(shiftRangeForInsert(range(3, 3), 4, 2, 10, 'linear')).toEqual(range(3, 3));
    expect(shiftRangeForInsert(range(3, 3), 2, 2, 10, 'linear')).toEqual(range(5, 5));
  });

  it('is a no-op for zero-length insertions', () => {
    const r = range(2, 5);
    expect(shiftRangeForInsert(r, 3, 0, 10, 'linear')).toBe(r);
  });
});

describe('shiftRangeForDelete', () => {
  describe('linear range [5,10) on length 20', () => {
    const r = range(5, 10);
    const del = (a: number, b: number) => shiftRangeForDelete(r, range(a, b), 20);

    it('shifts left when deletion is before', () => {
      expect(del(0, 2)).toEqual(range(3, 8));
    });
    it('is unchanged when deletion is after', () => {
      expect(del(12, 15)).toEqual(r);
      expect(del(10, 12)).toEqual(r);
    });
    it('shrinks when deletion is inside', () => {
      expect(del(6, 8)).toEqual(range(5, 8));
      expect(del(5, 7)).toEqual(range(5, 8));
      expect(del(8, 10)).toEqual(range(5, 8));
    });
    it('is trimmed on partial overlap', () => {
      expect(del(3, 7)).toEqual(range(3, 6));
      expect(del(8, 12)).toEqual(range(5, 8));
    });
    it('is removed when fully deleted', () => {
      expect(del(5, 10)).toBeNull();
      expect(del(4, 11)).toBeNull();
    });
  });

  it('collapses a cursor onto the deletion point instead of removing it', () => {
    expect(shiftRangeForDelete(range(6, 6), range(4, 8), 20)).toEqual(range(4, 4));
    expect(shiftRangeForDelete(range(9, 9), range(4, 8), 20)).toEqual(range(5, 5));
    expect(shiftRangeForDelete(range(2, 2), range(4, 8), 20)).toEqual(range(2, 2));
  });

  describe('circular wrapped range [8,12) on length 10', () => {
    const r = range(8, 12);
    const del = (a: number, b: number) => shiftRangeForDelete(r, range(a, b), 10);

    it('shrinks the head and stays wrapped', () => {
      expect(del(9, 10)).toEqual(range(8, 11));
    });
    it('becomes linear when the head is deleted', () => {
      expect(del(8, 10)).toEqual(range(0, 2));
    });
    it('becomes linear when the tail is deleted', () => {
      expect(del(0, 2)).toEqual(range(6, 8));
    });
    it('shrinks the tail and stays wrapped', () => {
      expect(del(0, 1)).toEqual(range(7, 10));
    });
    it('handles a deletion that itself wraps', () => {
      expect(del(9, 11)).toEqual(range(7, 9));
    });
    it('is removed when the whole wrapped range is deleted', () => {
      expect(del(8, 12)).toBeNull();
      expect(del(7, 13)).toBeNull();
    });
    it('shifts when deleting in the gap', () => {
      expect(del(3, 5)).toEqual(range(6, 10));
    });
  });

  it('deleting everything removes non-empty ranges', () => {
    expect(shiftRangeForDelete(range(2, 5), range(0, 10), 10)).toBeNull();
    expect(shiftRangeForDelete(range(8, 12), range(0, 10), 10)).toBeNull();
    expect(shiftRangeForDelete(range(3, 3), range(0, 10), 10)).toEqual(range(0, 0));
  });
});

describe('rotateRange', () => {
  it('moves the origin', () => {
    expect(rotateRange(range(8, 12), 8, 10)).toEqual(range(0, 4));
    expect(rotateRange(range(2, 5), 4, 10)).toEqual(range(8, 11));
    expect(rotateRange(range(0, 10), 3, 10)).toEqual(range(7, 17));
    expect(rotateRange(range(4, 4), 4, 10)).toEqual(range(0, 0));
  });
});

describe('flipRange', () => {
  it('mirrors linear ranges', () => {
    expect(flipRange(range(2, 5), 10, 'linear')).toEqual(range(5, 8));
    expect(flipRange(range(0, 10), 10, 'linear')).toEqual(range(0, 10));
    expect(flipRange(range(0, 0), 10, 'linear')).toEqual(range(10, 10));
    expect(flipRange(range(10, 10), 10, 'linear')).toEqual(range(0, 0));
  });

  it('mirrors circular ranges, keeping them unrolled', () => {
    expect(flipRange(range(8, 12), 10, 'circular')).toEqual(range(8, 12));
    expect(flipRange(range(0, 3), 10, 'circular')).toEqual(range(7, 10));
    expect(flipRange(range(7, 10), 10, 'circular')).toEqual(range(0, 3));
    expect(flipRange(range(0, 0), 10, 'circular')).toEqual(range(0, 0));
    expect(flipRange(range(3, 13), 10, 'circular')).toEqual(range(7, 17));
  });

  it('is an involution', () => {
    for (const r of [range(2, 5), range(8, 12), range(0, 10), range(3, 13), range(9, 10)]) {
      expect(flipRange(flipRange(r, 10, 'circular'), 10, 'circular')).toEqual(r);
    }
  });
});
