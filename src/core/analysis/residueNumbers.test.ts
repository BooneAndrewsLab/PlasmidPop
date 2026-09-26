import { SeqDocument } from '../document';
import { type Feature, createFeature, rangeSegment } from '../features';
import { type CdsTranslation, translateCds } from './cdsTranslation';
import { isNumberedResidue, residueBlocks, residueNumbers } from './residueNumbers';

function cds(init: Partial<Feature> & { segments: Feature['segments'] }): Feature {
  return createFeature({ id: 'cds', type: 'CDS', name: 'orf', ...init });
}

/** A sequence of `n` bases with no pattern to lean on. */
function bases(n: number, seed = 7): string {
  let x = seed;
  let s = '';
  for (let i = 0; i < n; i++) {
    x = (x * 1103515245 + 12345) % 2147483648;
    s += 'ACGT'[(x >> 16) % 4] ?? 'A';
  }
  return s;
}

/** Residue number (1-based) and place in its codon of every base the CDS reads. */
function residueOfBase(t: CdsTranslation): Map<number, { residue: number; base: number }> {
  const out = new Map<number, { residue: number; base: number }>();
  for (const codon of t.codons) {
    codon.positions.forEach((p, base) => {
      out.set(p, { residue: codon.index + 1, base });
    });
  }
  return out;
}

/**
 * The oracle: the forward-strand positions a feature reads, in reading
 * order, cut into codons after `/codon_start` — worked out here from the
 * segments alone, without `translateCds`.
 */
function expectedCodons(
  segments: readonly (readonly [number, number])[],
  length: number,
  strand: 'forward' | 'reverse',
  codonStart = 1,
): number[][] {
  const positions: number[] = [];
  for (const [start, end] of segments) for (let p = start; p < end; p++) positions.push(p % length);
  if (strand === 'reverse') positions.reverse();
  const codons: number[][] = [];
  for (let i = codonStart - 1; i + 3 <= positions.length; i += 3) {
    codons.push(positions.slice(i, i + 3));
  }
  return codons;
}

/** Numbered residues as `[number, middle base]` pairs. */
function numbered(t: CdsTranslation): [number, number][] {
  return residueNumbers(t).map((r) => [r.number, r.position]);
}

/** What the oracle says should be numbered, as `[number, middle base]`. */
function expectedNumbers(codons: number[][]): [number, number][] {
  return codons
    .map((c, i): [number, number] => [i + 1, c[1] ?? -1])
    .filter(([n]) => n === 1 || n % 10 === 0);
}

describe('isNumberedResidue', () => {
  it('numbers the first residue and every tenth', () => {
    const shown = Array.from({ length: 45 }, (_, i) => i + 1).filter((n) => isNumberedResidue(n));
    expect(shown).toEqual([1, 10, 20, 30, 40]);
    expect(isNumberedResidue(0)).toBe(false);
    expect(isNumberedResidue(-10)).toBe(false);
    expect(isNumberedResidue(5, 5)).toBe(true);
    expect(isNumberedResidue(6, 5)).toBe(false);
  });
});

describe('residueNumbers', () => {
  const doc = SeqDocument.create({ sequence: bases(120), topology: 'linear' });

  it('numbers a forward CDS from its first codon, over each middle base', () => {
    const t = translateCds(doc, cds({ segments: [rangeSegment(3, 93)] }));
    expect(t.codons).toHaveLength(30);
    expect(numbered(t)).toEqual([
      [1, 4],
      [10, 3 + 27 + 1],
      [20, 3 + 57 + 1],
      [30, 3 + 87 + 1],
    ]);
    expect(residueNumbers(t)[1]?.codon).toBe(t.codons[9]);
  });

  it('counts from the first full codon after /codon_start 2 and 3', () => {
    for (const codonStart of [2, 3] as const) {
      const t = translateCds(
        doc,
        cds({
          segments: [rangeSegment(0, 100)],
          qualifiers: [{ name: 'codon_start', value: String(codonStart) }],
        }),
      );
      const codons = expectedCodons([[0, 100]], 120, 'forward', codonStart);
      expect(t.codons.map((c) => [...c.positions])).toEqual(codons);
      expect(numbered(t)).toEqual(expectedNumbers(codons));
      // Residue 1 starts on the base codon_start names, not on the feature's first.
      expect(residueOfBase(t).get(codonStart - 1)).toEqual({ residue: 1, base: 0 });
      expect(residueOfBase(t).has(0)).toBe(false);
    }
  });

  it('numbers a reverse-strand CDS in its own reading direction', () => {
    const t = translateCds(doc, cds({ strand: 'reverse', segments: [rangeSegment(0, 90)] }));
    // Residue 1 is the codon at the right-hand end, read leftwards.
    expect(residueOfBase(t).get(89)).toEqual({ residue: 1, base: 0 });
    expect(residueOfBase(t).get(0)).toEqual({ residue: 30, base: 2 });
    expect(numbered(t)).toEqual([
      [1, 88],
      [10, 89 - 27 - 1],
      [20, 89 - 57 - 1],
      [30, 1],
    ]);
  });

  it('skips /codon_start bases at the right-hand end of a reverse CDS', () => {
    const t = translateCds(
      doc,
      cds({
        strand: 'reverse',
        segments: [rangeSegment(0, 92)],
        qualifiers: [{ name: 'codon_start', value: '3' }],
      }),
    );
    expect(residueOfBase(t).get(89)).toEqual({ residue: 1, base: 0 });
    expect(residueOfBase(t).has(90)).toBe(false);
    expect(residueOfBase(t).has(91)).toBe(false);
    expect(numbered(t)).toEqual(expectedNumbers(expectedCodons([[0, 92]], 120, 'reverse', 3)));
  });

  it('counts on across join segments that are not whole codons', () => {
    // Exons of 7, 14 and 50 bases: codons straddle both junctions.
    const exons = [
      [2, 9],
      [20, 34],
      [60, 110],
    ] as const;
    for (const strand of ['forward', 'reverse'] as const) {
      for (const codonStart of [1, 2, 3] as const) {
        const t = translateCds(
          doc,
          cds({
            strand,
            segments: exons.map(([s, e]) => rangeSegment(s, e)),
            qualifiers: [{ name: 'codon_start', value: String(codonStart) }],
          }),
        );
        const codons = expectedCodons(exons, 120, strand, codonStart);
        expect(t.codons.map((c) => [...c.positions])).toEqual(codons);
        expect(numbered(t)).toEqual(expectedNumbers(codons));
        // One count for the whole protein: numbers ascend in reading order.
        const numbers = residueNumbers(t).map((r) => r.number);
        expect(numbers).toEqual([1, 10, 20].filter((n) => n <= codons.length));
      }
    }
  });

  it('numbers a codon split by a junction over the middle base, in whichever exon it is', () => {
    // 28 bases then an intron: codon 10 is bases 27, 28 | 40 — its middle is 28.
    const t = translateCds(doc, cds({ segments: [rangeSegment(1, 30), rangeSegment(40, 70)] }));
    const tenth = residueNumbers(t).find((r) => r.number === 10);
    expect(tenth?.codon.positions).toEqual([28, 29, 40]);
    expect(tenth?.position).toBe(29);
  });

  describe('on a circle', () => {
    const length = 60;
    const circle = SeqDocument.create({ sequence: bases(length, 11), topology: 'circular' });

    it('runs straight on through the origin, one segment or several', () => {
      const layouts: (readonly (readonly [number, number])[])[] = [
        [[35, 35 + 48]], // one segment through the origin
        [
          [40, 60],
          [0, 25],
        ], // a join whose junction is the origin
        [
          [50, 65],
          [10, 33],
        ], // a segment through the origin, then another
      ];
      for (const segments of layouts) {
        for (const strand of ['forward', 'reverse'] as const) {
          const t = translateCds(
            circle,
            cds({ strand, segments: segments.map(([s, e]) => rangeSegment(s, e)) }),
          );
          const codons = expectedCodons(segments, length, strand);
          expect(t.codons.map((c) => [...c.positions])).toEqual(codons);
          expect(numbered(t)).toEqual(expectedNumbers(codons));
        }
      }
    });

    it('numbers every base the same wherever the origin is set', () => {
      // 13 codons, 39 bases plus two exons; enough for residue 10 to be numbered.
      for (const strand of ['forward', 'reverse'] as const) {
        for (const codonStart of [1, 2, 3] as const) {
          const feature = cds({
            strand,
            segments: [rangeSegment(5, 26), rangeSegment(30, 52)],
            qualifiers: [{ name: 'codon_start', value: String(codonStart) }],
          });
          const withFeature = SeqDocument.create({
            sequence: circle.sequence.toString(),
            topology: 'circular',
            features: [feature],
          });
          const reference = translateCds(withFeature, feature);
          const want = residueOfBase(reference);
          const wantNumbers = numbered(reference);
          expect(wantNumbers.map(([n]) => n)).toContain(10);
          for (let origin = 0; origin < length; origin++) {
            const rotated = withFeature.setOrigin(origin);
            const moved = rotated.features.all()[0];
            if (moved === undefined) throw new Error('feature lost');
            const t = translateCds(rotated, moved);
            expect(t.protein).toBe(reference.protein);
            // Back to the original coordinates, base by base.
            const back = (p: number): number => (p + origin) % length;
            const got = new Map([...residueOfBase(t)].map(([p, r]) => [back(p), r]));
            expect(got).toEqual(want);
            expect(numbered(t).map(([n, p]) => [n, back(p)])).toEqual(wantNumbers);
          }
        }
      }
    });
  });

  it('numbers every residue at a step of 1, marking the first and the tenths', () => {
    const t = translateCds(doc, cds({ strand: 'reverse', segments: [rangeSegment(1, 70)] }));
    const all = residueNumbers(t, 1);
    expect(all.map((r) => r.number)).toEqual(t.codons.map((c) => c.index + 1));
    expect(all.map((r) => r.position)).toEqual(t.codons.map((c) => c.positions[1]));
    expect(all.filter((r) => r.major).map((r) => r.number)).toEqual([1, 10, 20]);
    expect(residueNumbers(t).every((r) => r.major)).toBe(true);
  });

  it('is kept per translation and step', () => {
    const t = translateCds(doc, cds({ segments: [rangeSegment(0, 90)] }));
    expect(residueNumbers(t)).toBe(residueNumbers(t));
    expect(residueNumbers(t, 1)).toBe(residueNumbers(t, 1));
    expect(residueNumbers(t, 1)).not.toBe(residueNumbers(t));
  });

  it('numbers nothing when there is no whole codon', () => {
    const t = translateCds(doc, cds({ segments: [rangeSegment(0, 2)] }));
    expect(residueNumbers(t)).toEqual([]);
  });
});

describe('residueBlocks', () => {
  it('cuts a protein into tens numbered by their last residue, and the first by 1', () => {
    const protein = 'MKTAYIAKQRQISFVKSHFSRQ';
    expect(residueBlocks(protein)).toEqual([
      { start: 0, residues: 'MKTAYIAKQR', first: 1, last: 10 },
      { start: 10, residues: 'QISFVKSHFS', first: null, last: 20 },
      { start: 20, residues: 'RQ', first: null, last: null },
    ]);
  });

  it('keeps every residue in order', () => {
    const protein = 'ACDEFGHIKLMNPQRSTVWY*'.repeat(7);
    const blocks = residueBlocks(protein);
    expect(blocks.map((b) => b.residues).join('')).toBe(protein);
    expect(blocks.every((b, i) => b.start === i * 10)).toBe(true);
  });

  it('numbers a short protein by its first residue only', () => {
    expect(residueBlocks('MK')).toEqual([{ start: 0, residues: 'MK', first: 1, last: null }]);
    expect(residueBlocks('M')).toEqual([{ start: 0, residues: 'M', first: 1, last: null }]);
    expect(residueBlocks('')).toEqual([]);
  });

  it('takes a block size', () => {
    expect(residueBlocks('ABCDEFG', 3).map((b) => [b.residues, b.last])).toEqual([
      ['ABC', 3],
      ['DEF', 6],
      ['G', null],
    ]);
  });
});
