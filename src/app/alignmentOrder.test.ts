import { describe, expect, it } from 'vitest';

import { hiddenNote, shownSamples, sortedIndices, type SortKeys } from './alignmentOrder';

const keys: SortKeys[] = [
  { name: 'read10', identity: 0.9, start: 50 },
  { name: 'read2', identity: 1, start: 10 },
  { name: 'Read1', identity: 0.9, start: 10 },
  { name: 'a', identity: 0.5, start: 0 },
];

describe('sortedIndices', () => {
  it('keeps the original order', () => {
    expect(sortedIndices(keys, 'original')).toEqual([0, 1, 2, 3]);
  });
  it('puts the highest identity first and breaks ties by original order', () => {
    expect(sortedIndices(keys, 'identity')).toEqual([1, 0, 2, 3]);
  });
  it('sorts names naturally and without case', () => {
    expect(sortedIndices(keys, 'name')).toEqual([3, 2, 1, 0]);
  });
  it('sorts by start on the reference, ties in original order', () => {
    expect(sortedIndices(keys, 'position')).toEqual([3, 1, 2, 0]);
  });
  it('handles no samples and does not touch its input', () => {
    expect(sortedIndices([], 'name')).toEqual([]);
    const copy = keys.map((k) => ({ ...k }));
    sortedIndices(copy, 'identity');
    expect(copy).toEqual(keys);
  });
});

describe('shownSamples', () => {
  it('drops hidden samples from the sorted order', () => {
    expect(shownSamples(keys, 'identity', new Set([1, 3]))).toEqual([0, 2]);
  });
  it('shows everything when nothing is hidden', () => {
    expect(shownSamples(keys, 'position', new Set())).toEqual([3, 1, 2, 0]);
  });
  it('ignores hidden indices that do not exist', () => {
    expect(shownSamples(keys, 'original', new Set([9]))).toEqual([0, 1, 2, 3]);
  });
});

describe('hiddenNote', () => {
  it('says nothing when all are shown', () => {
    expect(hiddenNote(4, 4)).toBe('');
  });
  it('counts what the verdict is from', () => {
    expect(hiddenNote(4, 3)).toBe('from 3 of 4 samples');
  });
});
