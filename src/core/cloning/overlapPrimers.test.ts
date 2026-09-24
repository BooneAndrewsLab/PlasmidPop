import { SeqDocument, createFeature, rangeSegment, reverseComplement } from '@/core';
import { meltingTemperature } from '@/core/primers/thermo';

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

describe('designOverlapPrimers, pinned (#77)', () => {
  it('gives back empty primers and no warnings when it refuses', () => {
    const circle = SeqDocument.create({
      name: 'pUncut',
      sequence: VECTOR_TEXT,
      topology: 'circular',
    });
    const d = designOverlapPrimers(circle, source, REGION, 'in-fusion');
    const empty = { sequence: '', tail: '', annealLength: 0, tm: NaN };
    expect(d.forward).toEqual(empty);
    expect(d.reverse).toEqual(empty);
    expect(d.warnings).toEqual([]);
  });

  it('stops growing a primer as soon as it reaches the target Tm', () => {
    const insert = GENOME.slice(REGION.start, REGION.end);
    // A target the shortest annealing part meets exactly.
    const targetTm = meltingTemperature(insert.slice(0, 18));
    const d = designOverlapPrimers(vector, source, REGION, 'in-fusion', { targetTm });
    expect(d.forward.annealLength).toBe(18);
    expect(d.forward.sequence).toBe(VECTOR_TEXT.slice(-15).toUpperCase() + insert.slice(0, 18));
  });

  it('names the product, labels the primers and passes on the assembly’s warnings', () => {
    // 150 bp of insert and two 15-base tails: a part short enough to be chewed away.
    const region = { start: 1000, end: 1150 };
    const d = designOverlapPrimers(vector, source, region, 'in-fusion', { name: 'pCloned' });
    expect(d.problem).toBeNull();
    expect(must(d.product, 'a product').name).toBe('pCloned');
    const amplicon = must(d.amplicon, 'an amplicon');
    expect(amplicon.length).toBe(180);
    expect(
      amplicon.features
        .all()
        .filter((f) => f.type === 'primer_bind')
        .map((f) => f.name),
    ).toEqual(['Forward', 'Reverse']);
    expect(d.warnings).toEqual([
      'In-Fusion asks for 15 bases of homology, which both tails carry.',
      'gDNA PCR product is 180 bp; the exonuclease may chew a piece under 200 bp away before it anneals, so add it in excess (NEB suggests 5-fold).',
    ]);
  });

  it('counts the other products the primers make, in the singular and the plural', () => {
    // The start of the insert copied in upstream, once and then twice: the
    // forward primer anneals there too and each copy makes one more product.
    const head = GENOME.slice(1000, 1030);
    const once = SeqDocument.create({
      name: 'gDNA',
      sequence: GENOME.slice(0, 500) + head + GENOME.slice(500),
    });
    const twice = SeqDocument.create({
      name: 'gDNA',
      sequence: GENOME.slice(0, 300) + head + GENOME.slice(300, 500) + head + GENOME.slice(500),
    });
    const one = designOverlapPrimers(vector, once, { start: 1030, end: 1630 }, 'in-fusion');
    const two = designOverlapPrimers(vector, twice, { start: 1060, end: 1660 }, 'in-fusion');
    expect(one.problem).toBeNull();
    expect(one.warnings).toEqual([
      'The primers also amplify 1 other product of the template, which would compete in the tube.',
      'In-Fusion asks for 15 bases of homology, which both tails carry.',
    ]);
    expect(two.problem).toBeNull();
    expect(two.warnings).toEqual([
      'The primers also amplify 2 other products of the template, which would compete in the tube.',
      'In-Fusion asks for 15 bases of homology, which both tails carry.',
    ]);
  });

  it('keeps the primers and says why when only other products amplify', () => {
    // 20.5 kb is past a proofreading polymerase's reach, and on 21 kb of
    // random sequence the primers find somewhere else to make one product.
    // It was counted as "1 other products".
    const long = SeqDocument.create({ name: 'gDNA', sequence: filler(21000, 5) });
    const d = designOverlapPrimers(vector, long, { start: 100, end: 20600 }, 'in-fusion');
    expect(d.problem).toBe(
      'The primers amplify 1 other product of gDNA but not the selection; they are not specific to it.',
    );
    expect(d.forward.annealLength).toBeGreaterThanOrEqual(18);
    expect(d.amplicon).toBeNull();
    expect(d.product).toBeNull();
    expect(d.warnings).toEqual([]);
    const many = SeqDocument.create({ name: 'gDNA', sequence: filler(21000, 7) });
    expect(
      designOverlapPrimers(vector, many, { start: 100, end: 20600 }, 'in-fusion').problem,
    ).toBe(
      'The primers amplify 5 other products of gDNA but not the selection; they are not specific to it.',
    );
  });

  it('keeps the amplicon and passes on the reason when the circle does not close', () => {
    // A vector whose two ends are each other's reverse complement gives both
    // tails the same bases, so the amplicon fits after it either way round.
    const end = filler(15, 9);
    const itr = SeqDocument.create({
      name: 'pITR',
      sequence: end + filler(2000, 10) + reverseComplement(end),
    });
    const d = designOverlapPrimers(itr, source, REGION, 'in-fusion');
    expect(d.problem).toBe(
      'The end of pITR matches gDNA PCR product either way round, so the assembly is ambiguous.',
    );
    expect(d.amplicon).not.toBeNull();
    expect(d.product).toBeNull();
    expect(d.warnings).toEqual([]);
  });
});
