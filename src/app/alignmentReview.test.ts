import { describe, expect, it } from 'vitest';

import { SeqDocument } from '@/core';
import { handStack } from '@/test/handStack';

import {
  documentHoldsReference,
  inDocumentCase,
  mapThroughEdits,
  markedColumns,
  marksOf,
  regionKey,
  reviewStateFor,
  type ReviewMark,
  takeEdit,
} from './alignmentReview';
import { differenceRegions, type Stack } from './alignmentStack';

function regionsOf(stack: Stack) {
  return differenceRegions(stack.differences);
}

function take(stack: Stack, region: number, row = 0, length = 12, circular = false) {
  const r = regionsOf(stack)[region];
  const sample = stack.rows[row];
  if (r === undefined || sample === undefined) throw new Error('no region');
  return takeEdit(stack, r, sample, length, circular);
}

describe('regionKey', () => {
  it('anchors a region on the reference, so it survives columns another sample opened', () => {
    // r1's insertion after base 3 opens two columns; without r1 they are gone.
    const withInsert = handStack('ACGT--ACGTAC', [
      { bases: 'ACTT--ACGTAC' },
      { bases: 'ACGTGGACGTAC' },
    ]);
    const without = handStack('ACGTACGTAC', [{ bases: 'ACTTACGTAC' }]);
    const [a] = regionsOf(withInsert);
    const [b] = regionsOf(without);
    if (a === undefined || b === undefined) throw new Error('no region');
    expect(regionKey(withInsert, a)).toBe('2..2');
    expect(regionKey(without, b)).toBe('2..2');
    const insertion = regionsOf(withInsert)[1];
    if (insertion === undefined) throw new Error('no insertion');
    expect(regionKey(withInsert, insertion)).toBe('3+1..3+2');
  });

  it('finds the marks of the regions and their columns', () => {
    const stack = handStack('ACGTACGTAC', [{ bases: 'ACTTACGGAC' }]);
    const regions = regionsOf(stack);
    const marks = new Map<string, ReviewMark>([['7..7', 'taken']]);
    const marked = marksOf(stack, regions, marks);
    expect([...marked]).toEqual([[1, 'taken']]);
    expect([...markedColumns(regions, marked)]).toEqual([7]);
  });
});

describe('takeEdit', () => {
  it('replaces a mismatch with the sample base', () => {
    const stack = handStack('ACGTACGTACGT', [{ bases: 'ACTTACGTACGT' }]);
    expect(take(stack, 0)).toEqual({ ok: true, edit: { start: 2, end: 3, text: 'T' } });
  });

  it('deletes what the sample lacks and inserts what it adds', () => {
    const deletion = handStack('ACGTACGTACGT', [{ bases: 'ACG--CGTACGT' }]);
    expect(take(deletion, 0)).toEqual({ ok: true, edit: { start: 3, end: 5, text: '' } });
    const insertion = handStack('ACGT--ACGTACGT', [{ bases: 'ACGTGGACGTACGT' }]);
    expect(take(insertion, 0, 0, 12)).toEqual({ ok: true, edit: { start: 4, end: 4, text: 'GG' } });
  });

  it('takes only the sample bases, not the padding another sample opened', () => {
    const stack = handStack('ACGT--ACGTAC', [{ bases: 'ACGT-GTCGTAC' }, { bases: 'ACGTGGACGTAC' }]);
    // r0 inserts G and changes base 4 (A to T): one region from the inserted columns on.
    const [region] = regionsOf(stack);
    expect(region).toEqual({ start: 4, end: 7 });
    expect(take(stack, 0, 0)).toEqual({ ok: true, edit: { start: 4, end: 5, text: 'GT' } });
  });

  it('counts from the offset of a selection that was aligned', () => {
    const stack = handStack('ACGTAC', [{ bases: 'ACGAAC' }], { offset: 100 });
    expect(take(stack, 0, 0, 200)).toEqual({ ok: true, edit: { start: 103, end: 104, text: 'A' } });
  });

  it('wraps a read through the origin of a circle, refusing a region across it', () => {
    // A circle of 8 read on past its end: reference index 9 is document base 1.
    const stack = handStack('ACGTACGTACGT', [{ bases: '        ATTT' }], { wrap: 8 });
    expect(take(stack, 0, 0, 8, true)).toEqual({
      ok: true,
      edit: { start: 1, end: 3, text: 'TT' },
    });
    const across = handStack('ACGTACGTACGT', [{ bases: '      CCCCGT' }], { wrap: 8 });
    expect(take(across, 0, 0, 8, true)).toEqual({
      ok: false,
      reason: 'This difference runs through the origin',
    });
  });

  it('refuses a sample that does not reach the region or matches there', () => {
    const stack = handStack('ACGTACGTACGT', [{ bases: 'ACTTACGTACGT' }, { bases: '   TACGTACGT' }]);
    expect(take(stack, 0, 1)).toEqual({
      ok: false,
      reason: 'r1 does not reach all of this difference',
    });
    const two = handStack('ACGTACGTACGT', [{ bases: 'ACTTACGTACGT' }, { bases: 'ACGTACGTACGT' }]);
    expect(take(two, 0, 1)).toEqual({ ok: false, reason: 'r1 matches the document here' });
  });
});

describe('mapThroughEdits', () => {
  const edits = [
    { start: 10, end: 11, text: 'GGG' },
    { start: 30, end: 32, text: '' },
  ];
  it('moves a range after an edit by what it added or removed', () => {
    expect(mapThroughEdits(edits, { start: 5, end: 6 })).toEqual({ start: 5, end: 6 });
    expect(mapThroughEdits(edits, { start: 20, end: 21 })).toEqual({ start: 22, end: 23 });
    // Document positions as aligned; the second edit was written in the first one's coordinates.
    expect(mapThroughEdits(edits, { start: 40, end: 40 })).toEqual({ start: 40, end: 40 });
  });

  it('refuses a range overlapping an edit already taken', () => {
    expect(mapThroughEdits(edits, { start: 9, end: 11 })).toBeNull();
  });

  it('puts a range at the end of an insertion after it', () => {
    expect(mapThroughEdits([{ start: 4, end: 4, text: 'AA' }], { start: 4, end: 5 })).toEqual({
      start: 6,
      end: 7,
    });
    expect(mapThroughEdits([{ start: 4, end: 4, text: 'AA' }], { start: 3, end: 4 })).toEqual({
      start: 3,
      end: 4,
    });
  });
});

describe('the document', () => {
  it('writes in the case of the bases beside', () => {
    expect(inDocumentCase('Ag', 'acgt')).toBe('ag');
    expect(inDocumentCase('ag', 'ACgt')).toBe('AG');
    expect(inDocumentCase('ag', '')).toBe('AG');
  });

  it('checks the document still holds the reference where it was cut', () => {
    const doc = SeqDocument.create({ sequence: 'ttACGTaa' });
    expect(documentHoldsReference(doc, { sequence: 'ACGT', offset: 2 })).toBe(true);
    expect(documentHoldsReference(doc, { sequence: 'ACGA', offset: 2 })).toBe(false);
    expect(documentHoldsReference(doc, { sequence: 'ACGTAAA', offset: 2 })).toBe(false);
  });

  it('keeps a review per alignment result', () => {
    const a = {};
    reviewStateFor(a).marks.set('1..1', 'reviewed');
    expect(reviewStateFor(a).marks.get('1..1')).toBe('reviewed');
    expect(reviewStateFor({}).marks.size).toBe(0);
  });
});
