import { SeqDocument, reverseComplement } from '@/core';

import { designMultiOverlapPrimers } from './overlapAssembly';
import { designOverlapPrimers } from './overlapPrimers';

function filler(length: number, seed: number): string {
  let x = seed;
  let out = '';
  for (let i = 0; i < length; i++) {
    x = (x * 1103515245 + 12345) & 0x7fffffff;
    out += 'ACGT'.charAt((x >> 16) & 3);
  }
  return out;
}

const VECTOR = filler(3000, 31);
const vector = SeqDocument.create({ name: 'pBack', sequence: VECTOR, topology: 'linear' });
const GENOME = filler(6000, 77);
const source = SeqDocument.create({ name: 'gDNA', sequence: GENOME, topology: 'linear' });
const A = { start: 500, end: 1300 };
const B = { start: 2500, end: 3400 };
const C = { start: 4200, end: 4900 };

function must<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) throw new Error('expected a value');
  return value;
}

describe('designMultiOverlapPrimers', () => {
  it('with one insert is the single design', () => {
    const one = designMultiOverlapPrimers(vector, [{ template: source, region: A }], 'yeast');
    const single = designOverlapPrimers(vector, source, A, 'yeast');
    expect(one.problem).toBeNull();
    expect(one.inserts[0]?.forward.sequence).toBe(single.forward.sequence);
    expect(one.inserts[0]?.reverse.sequence).toBe(single.reverse.sequence);
  });

  it.each(['both', 'forward', 'reverse'] as const)(
    'closes vector + three inserts with the homology split %s',
    (split) => {
      const d = designMultiOverlapPrimers(
        vector,
        [A, B, C].map((region) => ({ template: source, region })),
        'yeast',
        { split },
      );
      expect(d.problem).toBeNull();
      expect(d.inserts).toHaveLength(3);
      const product = must(d.product);
      expect(product.isCircular).toBe(true);
      expect(product.length).toBe(3000 + 800 + 900 + 700);
      const [a, b] = d.inserts;
      // The first forward tail is the vector's end; each junction is shared by both amplicons.
      expect(a?.forward.tail).toBe(VECTOR.slice(-40));
      const endOfA = must(a?.amplicon).sequence.toString().toUpperCase();
      const startOfB = must(b?.amplicon).sequence.toString().toUpperCase();
      expect(startOfB.slice(0, 40)).toBe(endOfA.slice(-40));
    },
  );

  it('splits a junction between the two primers', () => {
    const d = designMultiOverlapPrimers(
      vector,
      [A, B].map((region) => ({ template: source, region })),
      'yeast',
      { overlap: 41, split: 'both' },
    );
    expect(d.inserts[1]?.forward.tail.length).toBe(21);
    expect(d.inserts[0]?.reverse.tail.length).toBe(20);
  });

  it('carries a junction whole on one primer when asked', () => {
    const inserts = [A, B].map((region) => ({ template: source, region }));
    const f = designMultiOverlapPrimers(vector, inserts, 'yeast', { split: 'forward' });
    expect(f.inserts[1]?.forward.tail).toBe(GENOME.slice(A.end - 40, A.end));
    const r = designMultiOverlapPrimers(vector, inserts, 'yeast', { split: 'reverse' });
    expect(r.inserts[0]?.reverse.tail).toBe(reverseComplement(GENOME.slice(B.start, B.start + 40)));
  });

  it('reads an insert on the reverse strand', () => {
    const d = designMultiOverlapPrimers(
      vector,
      [
        { template: source, region: A },
        { template: source, region: B, reverse: true },
      ],
      'yeast',
    );
    expect(d.problem).toBeNull();
    const circle = must(d.product).sequence.toString().toUpperCase();
    expect((circle + circle).includes(reverseComplement(GENOME.slice(B.start, B.end)))).toBe(true);
  });

  it('works for Gibson kits too, with the kit’s own overlap', () => {
    const d = designMultiOverlapPrimers(
      vector,
      [A, B].map((region) => ({ template: source, region })),
      'nebuilder',
      { overlap: 70 },
    );
    expect(d.problem).toBeNull();
    expect(d.overlap).toBe(20);
  });

  it('holds a yeast overlap to 20 to 80', () => {
    const inserts = [A, B].map((region) => ({ template: source, region }));
    expect(designMultiOverlapPrimers(vector, inserts, 'yeast', { overlap: 5 }).overlap).toBe(20);
    expect(designMultiOverlapPrimers(vector, inserts, 'yeast', { overlap: 500 }).overlap).toBe(80);
  });

  it('refuses a circular vector, no inserts and an insert too short for its junction', () => {
    const circle = SeqDocument.create({ name: 'c', sequence: VECTOR, topology: 'circular' });
    const inserts = [A, B].map((region) => ({ template: source, region }));
    expect(designMultiOverlapPrimers(circle, inserts, 'yeast').problem).toMatch(/circular/);
    expect(designMultiOverlapPrimers(vector, [], 'yeast').problem).toMatch(/at least one/);
    const tiny = { template: source, region: { start: 10, end: 50 } };
    expect(
      designMultiOverlapPrimers(vector, [{ template: source, region: A }, tiny], 'yeast', {
        overlap: 60,
      }).problem,
    ).toMatch(/Insert 2/);
  });
});
