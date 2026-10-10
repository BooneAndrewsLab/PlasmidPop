import { SeqDocument, createFeature, rangeSegment, reverseComplement } from '@/core';

import { SOE_DEFAULTS, designOverlapExtension } from './overlapExtension';

function filler(length: number, seed: number): string {
  let x = seed;
  let out = '';
  for (let i = 0; i < length; i++) {
    x = (x * 1103515245 + 12345) & 0x7fffffff;
    out += 'ACGT'.charAt((x >> 16) & 3);
  }
  return out;
}

const A_TEXT = filler(1200, 3);
const B_TEXT = filler(900, 19);
const C_TEXT = filler(700, 41);

function doc(name: string, text: string, features = [] as ReturnType<typeof createFeature>[]) {
  return SeqDocument.create({ name, sequence: text.toLowerCase(), topology: 'linear', features });
}

const a = doc('A', A_TEXT);
const b = doc('B', B_TEXT);
const c = doc('C', C_TEXT);
const whole = (d: SeqDocument) => ({ doc: d, range: { start: 0, end: d.length } });

function must<T>(value: T | null | undefined, what: string): T {
  if (value === null || value === undefined) throw new Error(`expected ${what}`);
  return value;
}

describe('designOverlapExtension', () => {
  it('fuses two fragments end to end and runs every step', () => {
    const d = designOverlapExtension([whole(a), whole(b)]);
    expect(d.problem).toBeNull();
    const product = must(d.product, 'a product');
    expect(product.sequence.toString().toUpperCase()).toBe(A_TEXT + B_TEXT);
    expect(must(d.fused, 'a fused molecule').length).toBe(A_TEXT.length + B_TEXT.length);
    // Four primers: two outer without tails, two inner with one.
    expect(d.primers.map((p) => p.name)).toEqual(['SOE F1', 'SOE R1', 'SOE F2', 'SOE R2']);
    expect(d.primers.map((p) => p.role)).toEqual(['outer', 'inner', 'inner', 'outer']);
    expect(d.primers[0]?.tail).toBe('');
    expect(d.primers[3]?.tail).toBe('');
    // First-round products carry the neighbour's end: the first the second's start, and back.
    expect(d.firstRound).toHaveLength(2);
    expect(d.firstRound[0]?.length).toBeGreaterThan(A_TEXT.length);
    expect(d.firstRound[1]?.length).toBeGreaterThan(B_TEXT.length);
  });

  it('makes the two inner primers complementary over the whole overlap', () => {
    const d = designOverlapExtension([whole(a), whole(b)]);
    const junction = must(d.junctions[0], 'a junction');
    const inner = d.primers.filter((p) => p.role === 'inner');
    const r1 = must(
      inner.find((p) => p.strand === 'reverse'),
      'reverse inner',
    ).sequence;
    const f2 = must(
      inner.find((p) => p.strand === 'forward'),
      'forward inner',
    ).sequence;
    expect(junction.overlap).toBe(
      A_TEXT.slice(-Math.ceil(junction.length / 2)) +
        B_TEXT.slice(0, Math.floor(junction.length / 2)),
    );
    expect(f2.toUpperCase()).toContain(junction.overlap);
    expect(reverseComplement(r1).toUpperCase()).toContain(junction.overlap);
    expect(junction.tm).toBeGreaterThanOrEqual(SOE_DEFAULTS.overlapTm);
  });

  it('joins three fragments, a middle one carrying a tail at each end', () => {
    const d = designOverlapExtension([whole(a), whole(b), whole(c)], { name: 'ABC' });
    expect(d.problem).toBeNull();
    expect(must(d.product, 'a product').name).toBe('ABC');
    expect(must(d.product, 'a product').sequence.toString().toUpperCase()).toBe(
      A_TEXT + B_TEXT + C_TEXT,
    );
    expect(d.primers).toHaveLength(6);
    expect(d.junctions).toHaveLength(2);
    const middle = d.firstRound[1];
    expect(middle?.length).toBeGreaterThan(B_TEXT.length + 15);
  });

  it('takes a stretch of a template, and makes a deletion by fusing its two flanks', () => {
    const left = { doc: a, range: { start: 0, end: 400 } };
    const right = { doc: a, range: { start: 700, end: 1200 } };
    const d = designOverlapExtension([left, right]);
    expect(d.problem).toBeNull();
    expect(must(d.product, 'a product').sequence.toString().toUpperCase()).toBe(
      A_TEXT.slice(0, 400) + A_TEXT.slice(700),
    );
  });

  it('grows the overlap to the Tm asked for', () => {
    const low = designOverlapExtension([whole(a), whole(b)], { overlapTm: 50, minOverlap: 12 });
    const high = designOverlapExtension([whole(a), whole(b)], { overlapTm: 66 });
    expect(must(high.junctions[0], 'junction').length).toBeGreaterThan(
      must(low.junctions[0], 'junction').length,
    );
  });

  it('warns when an overlap is short', () => {
    const d = designOverlapExtension([whole(a), whole(b)], {
      overlapTm: 30,
      minOverlap: 10,
      maxOverlap: 10,
    });
    expect(d.problem).toBeNull();
    expect(d.warnings.join(' ')).toMatch(/short for the extension step/);
  });

  it('warns when an overlap is not unique in the fused molecule', () => {
    const first = designOverlapExtension([whole(a), whole(b)]);
    const overlap = must(first.junctions[0], 'a junction').overlap;
    // The same stretch turns up again inside the second fragment.
    const again = doc('Again', B_TEXT.slice(0, 300) + overlap + B_TEXT.slice(300));
    const d = designOverlapExtension([whole(a), whole(again)]);
    expect(d.problem ?? d.warnings.join(' ')).toMatch(
      /2 times in the fused molecule|also matches somewhere else/,
    );
  });

  it('refuses fewer than two fragments, and fragments too short to prime', () => {
    expect(designOverlapExtension([whole(a)]).problem).toMatch(/at least two/);
    const tiny = doc('Tiny', 'ACGTACGTAC');
    expect(designOverlapExtension([whole(a), whole(tiny)]).problem).toMatch(/too short/);
  });

  it('refuses ambiguous bases', () => {
    const amb = doc('Amb', B_TEXT.slice(0, 300) + 'N' + B_TEXT.slice(300));
    expect(designOverlapExtension([whole(a), whole(amb)]).problem).toMatch(/ambiguous/);
  });

  describe('reading frames', () => {
    const cds = (start: number, end: number, strand: 'forward' | 'reverse' = 'forward') =>
      createFeature({ type: 'CDS', name: 'gene', strand, segments: [rangeSegment(start, end)] });

    it('is quiet when a deletion inside a gene takes a whole number of codons', () => {
      const gene = doc('Gene', A_TEXT, [cds(100, 1000)]);
      const d = designOverlapExtension([
        { doc: gene, range: { start: 0, end: 400 } },
        { doc: gene, range: { start: 403, end: 1200 } },
      ]);
      expect(d.problem).toBeNull();
      expect(d.warnings.filter((w) => w.includes('frame'))).toEqual([]);
    });

    it('warns when a deletion inside a gene shifts its frame', () => {
      const gene = doc('Gene', A_TEXT, [cds(100, 1000)]);
      const d = designOverlapExtension([
        { doc: gene, range: { start: 0, end: 400 } },
        { doc: gene, range: { start: 401, end: 1200 } },
      ]);
      expect(d.problem).toBeNull();
      expect(d.warnings.some((w) => w.includes('out of frame') && w.includes('gene'))).toBe(true);
    });

    it('warns for a gene on the reverse strand too', () => {
      const gene = doc('Gene', A_TEXT, [cds(100, 1000, 'reverse')]);
      const shifted = designOverlapExtension([
        { doc: gene, range: { start: 0, end: 400 } },
        { doc: gene, range: { start: 402, end: 1200 } },
      ]);
      expect(shifted.warnings.some((w) => w.includes('out of frame'))).toBe(true);
      const kept = designOverlapExtension([
        { doc: gene, range: { start: 0, end: 400 } },
        { doc: gene, range: { start: 406, end: 1200 } },
      ]);
      expect(kept.warnings.filter((w) => w.includes('frame'))).toEqual([]);
    });

    it('checks a tag fused on to a gene against the frame the tag was read in', () => {
      const gene = doc('Gene', A_TEXT, [cds(0, 900)]);
      const tag = doc('Tag', B_TEXT, [cds(0, 300)]);
      // The gene's first 600 bases are 200 codons, so the tag starts in frame.
      const inFrame = designOverlapExtension([
        { doc: gene, range: { start: 0, end: 600 } },
        { doc: tag, range: { start: 0, end: 300 } },
      ]);
      expect(inFrame.warnings.filter((w) => w.includes('frame'))).toEqual([]);
      const off = designOverlapExtension([
        { doc: gene, range: { start: 0, end: 601 } },
        { doc: tag, range: { start: 0, end: 300 } },
      ]);
      expect(off.warnings.some((w) => w.includes('out of frame'))).toBe(true);
    });
  });
});
