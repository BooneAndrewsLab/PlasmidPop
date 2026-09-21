import { type DeletionMark, type DocumentDiff, type EditMark, EMPTY_DIFF } from './documentDiff';
import { diffHunks } from './hunks';

function diff(marks: EditMark[], deletions: DeletionMark[] = []): DocumentDiff {
  return { ...EMPTY_DIFF, marks, deletions };
}

function inserted(start: number, end: number): EditMark {
  return { kind: 'inserted', start, end };
}

function spans(hunks: readonly { start: number; end: number }[]): string[] {
  return hunks.map((h) => `${h.start}-${h.end}`);
}

describe('diffHunks', () => {
  it('has nothing to show for an empty diff', () => {
    expect(diffHunks(EMPTY_DIFF, 1000)).toEqual([]);
  });

  it('pads a single change on both sides', () => {
    const hunks = diffHunks(diff([inserted(500, 505)]), 1000, 30);
    expect(spans(hunks)).toEqual(['470-535']);
    expect(hunks[0]?.changeStart).toBe(500);
    expect(hunks[0]?.changeEnd).toBe(505);
  });

  it('clamps the padding to the document', () => {
    expect(spans(diffHunks(diff([inserted(2, 5)]), 20, 30))).toEqual(['0-20']);
  });

  it('joins changes whose padding touches', () => {
    // 40 bases apart, padding 30: the padded spans overlap, so one hunk.
    const hunks = diffHunks(diff([inserted(100, 101), inserted(140, 141)]), 1000, 30);
    expect(spans(hunks)).toEqual(['70-171']);
    expect(hunks[0]?.marks).toHaveLength(2);
  });

  it('keeps changes far apart in separate hunks', () => {
    const hunks = diffHunks(diff([inserted(100, 101), inserted(400, 401)]), 1000, 30);
    expect(spans(hunks)).toEqual(['70-131', '370-431']);
  });

  it('keeps a group open across a long mark', () => {
    // The second change is far from the first mark's start but close to its
    // end, so it belongs to the same neighbourhood.
    const hunks = diffHunks(diff([inserted(100, 300), inserted(320, 321)]), 1000, 30);
    expect(spans(hunks)).toEqual(['70-351']);
    expect(hunks[0]?.changeEnd).toBe(321);
  });

  it('takes the furthest end when marks are nested', () => {
    const hunks = diffHunks(diff([inserted(100, 400), inserted(110, 120)]), 1000, 30);
    expect(spans(hunks)).toEqual(['70-430']);
    expect(hunks[0]?.changeEnd).toBe(400);
  });

  it('places a deletion at the boundary it left behind', () => {
    const hunks = diffHunks(diff([], [{ position: 500, count: 12 }]), 1000, 30);
    expect(spans(hunks)).toEqual(['470-530']);
    expect(hunks[0]?.deletions).toEqual([{ position: 500, count: 12 }]);
    expect(hunks[0]?.marks).toEqual([]);
  });

  it('gathers marks and deletions in the same neighbourhood', () => {
    const hunks = diffHunks(diff([inserted(500, 505)], [{ position: 510, count: 3 }]), 1000, 30);
    expect(spans(hunks)).toEqual(['470-540']);
    expect(hunks[0]?.marks).toHaveLength(1);
    expect(hunks[0]?.deletions).toHaveLength(1);
  });

  it('handles a deletion at the very end of the document', () => {
    const hunks = diffHunks(diff([], [{ position: 1000, count: 5 }]), 1000, 30);
    expect(spans(hunks)).toEqual(['970-1000']);
  });
});

describe('diffHunks tallies', () => {
  it('counts the bases each hunk inserted, changed and deleted', () => {
    const d = diff(
      [inserted(100, 105), { kind: 'changed', start: 110, end: 114 }],
      [{ position: 120, count: 3 }],
    );
    const hunks = diffHunks(d, 1000, 30);
    expect(hunks).toHaveLength(1);
    expect(hunks[0]).toMatchObject({ basesInserted: 5, basesChanged: 4, basesDeleted: 3 });
  });

  it('tallies each hunk on its own', () => {
    const d = diff([inserted(10, 12), inserted(500, 503)], [{ position: 505, count: 7 }]);
    const hunks = diffHunks(d, 1000, 30);
    expect(hunks.map((h) => [h.basesInserted, h.basesChanged, h.basesDeleted])).toEqual([
      [2, 0, 0],
      [3, 0, 7],
    ]);
  });

  it('adds up several deletions at the same boundary region', () => {
    const d = diff(
      [],
      [
        { position: 100, count: 2 },
        { position: 104, count: 5 },
      ],
    );
    expect(diffHunks(d, 1000, 30)[0]?.basesDeleted).toBe(7);
  });
});
