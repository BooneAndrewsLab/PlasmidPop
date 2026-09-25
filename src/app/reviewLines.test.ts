import { EMPTY_DIFF, diffHunks } from '@/core';

import { MAX_STRIPS, MORE_PLACES, hunkKey, reviewKeyFor } from './reviewLines';

describe('reviewKeyFor', () => {
  it('finds the drawn neighbourhood a mark or a deletion is in', () => {
    const diff = {
      ...EMPTY_DIFF,
      marks: [{ kind: 'inserted' as const, start: 100, end: 104 }],
      deletions: [{ position: 400, count: 10 }],
    };
    const hunks = diffHunks(diff, 600);
    expect(hunks).toHaveLength(2);
    const [first, second] = hunks;
    if (first === undefined || second === undefined) throw new Error('no hunks');
    expect(reviewKeyFor({ kind: 'mark', index: 0 }, diff, hunks, new Set())).toBe(hunkKey(first));
    expect(reviewKeyFor({ kind: 'deletion', index: 0 }, diff, hunks, new Set())).toBe(
      hunkKey(second),
    );
  });

  it('points past the dozen drawn at the line that counts the rest', () => {
    const marks = Array.from({ length: MAX_STRIPS + 2 }, (_, i) => ({
      kind: 'inserted' as const,
      start: i * 200,
      end: i * 200 + 5,
    }));
    const diff = { ...EMPTY_DIFF, marks };
    const hunks = diffHunks(diff, 4000);
    expect(reviewKeyFor({ kind: 'mark', index: 0 }, diff, hunks, new Set())).toBe(
      hunks[0] === undefined ? null : hunkKey(hunks[0]),
    );
    expect(reviewKeyFor({ kind: 'mark', index: MAX_STRIPS + 1 }, diff, hunks, new Set())).toBe(
      MORE_PLACES,
    );
  });

  it("finds a removed feature's own line, or the line that counts the ones not listed", () => {
    const own = reviewKeyFor(
      { kind: 'removed', featureId: 'a' },
      EMPTY_DIFF,
      [],
      new Set(['-a', 'more-removed']),
    );
    expect(own).toBe('-a');
    expect(
      reviewKeyFor({ kind: 'removed', featureId: 'b' }, EMPTY_DIFF, [], new Set(['more-removed'])),
    ).toBe('more-removed');
    expect(reviewKeyFor({ kind: 'removed', featureId: 'b' }, EMPTY_DIFF, [], new Set())).toBeNull();
  });
});
