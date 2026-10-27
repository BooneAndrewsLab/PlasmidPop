import { type CollectionPrimer } from '@/core';

import { DEFAULT_COLLECTION_SORT, collectionTm, sortCollection } from './collectionSort';

const primers: CollectionPrimer[] = [
  { id: 'a', name: 'M13 fwd', sequence: 'GTAAAACGACGGCCAGT', notes: 'sequencing' },
  { id: 'b', name: 'mix', sequence: 'ACGTNNKACGTACGTACGTAC', notes: '' },
  { id: 'c', name: 'gfp-10', sequence: 'ATGGTGAGCAAGGGCGAGGAGC', notes: 'Cloning' },
  { id: 'd', name: 'gfp-2', sequence: 'CTTGTACAGCTCGTCCATGCC', notes: 'cloning' },
];

describe('sortCollection (item 107)', () => {
  it('keeps the list order by default, and sorts names as a human would', () => {
    expect(sortCollection(primers, DEFAULT_COLLECTION_SORT).map((p) => p.id)).toEqual([
      'a',
      'b',
      'c',
      'd',
    ]);
    expect(sortCollection(primers, { key: 'name', dir: 'asc' }).map((p) => p.id)).toEqual([
      'd',
      'c',
      'a',
      'b',
    ]);
    expect(sortCollection(primers, { key: 'name', dir: 'desc' }).map((p) => p.id)).toEqual([
      'b',
      'a',
      'c',
      'd',
    ]);
  });

  it('sorts by length and by Tm, a primer without a Tm last either way', () => {
    expect(sortCollection(primers, { key: 'nt', dir: 'asc' }).map((p) => p.id)).toEqual([
      'a',
      'b',
      'd',
      'c',
    ]);
    const mix = primers.find((p) => p.id === 'b');
    expect(mix === undefined ? 0 : collectionTm(mix)).toBeNull();
    const asc = sortCollection(primers, { key: 'tm', dir: 'asc' }).map((p) => p.id);
    const desc = sortCollection(primers, { key: 'tm', dir: 'desc' }).map((p) => p.id);
    expect(asc[asc.length - 1]).toBe('b');
    expect(desc[desc.length - 1]).toBe('b');
    expect(asc.slice(0, 3)).toEqual([...desc.slice(0, 3)].reverse());
  });

  it('sorts notes ignoring case, ties in list order', () => {
    expect(sortCollection(primers, { key: 'notes', dir: 'asc' }).map((p) => p.id)).toEqual([
      'b',
      'c',
      'd',
      'a',
    ]);
  });
});
