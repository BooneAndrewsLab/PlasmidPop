import { SeqDocument, createFeature, rangeSegment } from '@/core';

import { KIT_OVERLAP, designOverlapPrimers } from './overlapPrimers';

function filler(length: number, seed: number): string {
  let x = seed;
  let out = '';
  for (let i = 0; i < length; i++) {
    x = (x * 1103515245 + 12345) & 0x7fffffff;
    out += 'ACGT'.charAt((x >> 16) & 3);
  }
  return out;
}

const VECTOR_TEXT = filler(3000, 31).toLowerCase();
const vector = SeqDocument.create({ name: 'pBackbone', sequence: VECTOR_TEXT, topology: 'linear' });

const GENOME = filler(4000, 77).toLowerCase();
const source = SeqDocument.create({
  name: 'gDNA',
  sequence: GENOME,
  topology: 'linear',
  features: [createFeature({ type: 'CDS', name: 'gene', segments: [rangeSegment(1000, 1900)] })],
});
const REGION = { start: 1000, end: 1900 };

function must<T>(value: T | null | undefined, what: string): T {
  if (value === null || value === undefined) throw new Error(`expected ${what}`);
  return value;
}

describe('designOverlapPrimers', () => {
  it('carries the vector’s two ends on the tails, and the circle closes', () => {
    const d = designOverlapPrimers(vector, source, REGION, 'in-fusion');
    expect(d.problem).toBeNull();
    const overlap = KIT_OVERLAP['in-fusion'];
    // The forward tail is the vector's last bases, the reverse tail the
    // reverse complement of its first: the two junctions of the circle.
    expect(d.forward.tail).toBe(VECTOR_TEXT.slice(-overlap).toUpperCase());
    expect(d.reverse.tail.length).toBe(overlap);
    expect(d.forward.tm).toBeGreaterThanOrEqual(60);
    expect(d.reverse.tm).toBeGreaterThanOrEqual(60);

    // Running the primers gives the insert with both tails on it...
    const amplicon = must(d.amplicon, 'an amplicon');
    expect(amplicon.length).toBe(REGION.end - REGION.start + overlap * 2);
    // ...and the circle is the vector plus the insert, each once.
    const product = must(d.product, 'a product');
    expect(product.isCircular).toBe(true);
    expect(product.length).toBe(vector.length + (REGION.end - REGION.start));
    const circle = product.sequence.toString().toUpperCase();
    expect(circle + circle).toContain(VECTOR_TEXT.toUpperCase());
    expect(circle + circle).toContain(GENOME.slice(REGION.start, REGION.end).toUpperCase());
    // The gene comes along.
    expect(product.features.all().map((f) => f.name)).toContain('gene');
  });

  it('asks for more homology for NEBuilder than for In-Fusion', () => {
    const inFusion = designOverlapPrimers(vector, source, REGION, 'in-fusion');
    const nebuilder = designOverlapPrimers(vector, source, REGION, 'nebuilder');
    expect(nebuilder.forward.tail.length - inFusion.forward.tail.length).toBe(
      KIT_OVERLAP.nebuilder - KIT_OVERLAP['in-fusion'],
    );
    expect(must(nebuilder.product, 'a product').length).toBe(
      must(inFusion.product, 'a product').length,
    );
  });

  it('refuses a circular vector, and says what to do', () => {
    const circle = SeqDocument.create({
      name: 'pUncut',
      sequence: VECTOR_TEXT,
      topology: 'circular',
    });
    expect(designOverlapPrimers(circle, source, REGION, 'in-fusion').problem).toMatch(
      /circular, so it has no ends.*Digest it/s,
    );
  });

  it('refuses a selection too short to amplify', () => {
    expect(
      designOverlapPrimers(vector, source, { start: 1000, end: 1020 }, 'in-fusion').problem,
    ).toMatch(/too short to amplify/);
  });

  it('warns when the vector has sticky ends', () => {
    const sticky = vector.setEnds({
      left: { kind: "5'", overhang: VECTOR_TEXT.slice(0, 4), enzyme: 'EcoRI' },
      right: { kind: 'blunt', overhang: '', enzyme: 'SmaI' },
    });
    const d = designOverlapPrimers(sticky, source, REGION, 'nebuilder');
    expect(d.problem).toBeNull();
    expect(d.warnings.join(' ')).toMatch(/has sticky ends/);
  });
});
