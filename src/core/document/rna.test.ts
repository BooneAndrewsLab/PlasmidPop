import { describe, expect, it } from 'vitest';

import { createMetadata } from './metadata';
import { SeqDocument } from './seqDocument';
import { fromRnaLetters, isRnaDocument, toRnaLetters } from './rna';

function docOf(moleculeType: string, protein = false): SeqDocument {
  return SeqDocument.create({
    name: 'd',
    sequence: protein ? 'MKV' : 'ACGT',
    alphabet: protein ? 'protein' : 'nucleotide',
    metadata: createMetadata({ moleculeType }),
  });
}

describe('isRnaDocument (#113)', () => {
  it.each([
    ['RNA', true],
    ['mRNA', true],
    ['ss-RNA', true],
    ['rna', true],
    ['DNA', false],
    ['ds-DNA', false],
    ['DNA/RNA', false],
    ['', false],
  ])('molecule type %j -> %s', (type, expected) => {
    expect(isRnaDocument(docOf(type))).toBe(expected);
  });

  it('is never true for a protein', () => {
    expect(isRnaDocument(docOf('RNA', true))).toBe(false);
  });
});

describe('RNA letters', () => {
  it('draws T as U and keeps case and other letters', () => {
    expect(toRnaLetters('ACGTtnN ')).toBe('ACGUunN ');
  });
  it('reads U as T and keeps case', () => {
    expect(fromRnaLetters('ACGUuN')).toBe('ACGTtN');
  });
});
