import { describe, expect, it } from 'vitest';

import { type Alignment } from '../alignment';
import { createFeature, rangeSegment, siteSegment } from '../features';

import {
  type Variant,
  type VariantKind,
  describeVariant,
  placeVariants,
  variantsOf,
  whereVariant,
} from './variants';

/** An alignment of two gapped rows, its match line drawn the way the aligner draws it. */
function aln(alignedA: string, alignedB: string, startA = 0): Alignment {
  let line = '';
  for (let i = 0; i < alignedA.length; i++) {
    const x = alignedA.charAt(i);
    const y = alignedB.charAt(i);
    line += x === '-' || y === '-' ? ' ' : x === y ? '|' : '.';
  }
  return {
    mode: 'global',
    score: 0,
    alignedA,
    alignedB,
    matchLine: line,
    startA,
    endA: startA + alignedA.replaceAll('-', '').length,
    startB: 0,
    endB: alignedB.replaceAll('-', '').length,
    identities: 0,
    ambiguous: 0,
    gaps: 0,
    columns: alignedA.length,
    identity: 1,
  };
}

const shape = (alignment: Alignment) =>
  variantsOf(alignment).map((v) => [v.kind, v.start, v.end, v.size, v.expected, v.observed]);

describe('variantsOf', () => {
  it('finds nothing in identical rows', () => {
    expect(variantsOf(aln('ACGTACGT', 'ACGTACGT'))).toEqual([]);
  });

  it('calls one changed base an SNV, with both bases, at the construct position', () => {
    expect(shape(aln('ACGTACGT', 'ACGAACGT'))).toEqual([['snv', 3, 4, 1, 'T', 'A']]);
  });

  it('groups adjacent changed bases into one substitution that ends where the match resumes', () => {
    expect(shape(aln('ACGTTTAC', 'ACAAATAC'))).toEqual([['substitution', 2, 5, 3, 'GTT', 'AAA']]);
  });

  it('keeps two separated changes as two SNVs', () => {
    expect(shape(aln('ACGTACGT', 'ATGTACCT'))).toEqual([
      ['snv', 1, 2, 1, 'C', 'T'],
      ['snv', 6, 7, 1, 'G', 'C'],
    ]);
  });

  it('puts a change at the last column in the variant', () => {
    expect(shape(aln('ACGT', 'ACGA'))).toEqual([['snv', 3, 4, 1, 'T', 'A']]);
    expect(shape(aln('ACGT', 'ACAA'))).toEqual([['substitution', 2, 4, 2, 'GT', 'AA']]);
  });

  it('numbers from where the alignment starts on the construct', () => {
    expect(shape(aln('ACGTACGT', 'ACGAACGT', 100))).toEqual([['snv', 103, 104, 1, 'T', 'A']]);
  });

  it('calls bases only the clone has an insertion, a point on the construct', () => {
    expect(shape(aln('ACG---TAC', 'ACGTTTTAC'))).toEqual([['insertion', 3, 3, 3, '', 'TTT']]);
  });

  it('calls bases only the construct has a deletion, over the bases it lacks', () => {
    expect(shape(aln('ACGTTTTAC', 'ACG---TAC'))).toEqual([['deletion', 3, 6, 3, 'TTT', '']]);
  });

  it('reads on at the right construct position after a deletion', () => {
    expect(shape(aln('ACGTAC', 'AC--AG'))).toEqual([
      ['deletion', 2, 4, 2, 'GT', ''],
      ['snv', 5, 6, 1, 'C', 'G'],
    ]);
  });

  it('keeps the construct position across an insertion too', () => {
    expect(shape(aln('AC-GTAC', 'ACTGTAG'))).toEqual([
      ['insertion', 2, 2, 1, '', 'T'],
      ['snv', 5, 6, 1, 'C', 'G'],
    ]);
  });

  it('ends a run of gaps at the end of the alignment', () => {
    expect(shape(aln('ACGT--', 'ACGTAA'))).toEqual([['insertion', 4, 4, 2, '', 'AA']]);
    expect(shape(aln('ACGTAA', 'ACGT--'))).toEqual([['deletion', 4, 6, 2, 'AA', '']]);
  });

  it('starts an insertion run at the first column', () => {
    expect(shape(aln('--ACGT', 'TTACGT'))).toEqual([['insertion', 0, 0, 2, '', 'TT']]);
  });

  it('splits a gap in one row from a gap in the other next to it', () => {
    expect(shape(aln('AC--GTAC', 'ACGT--AC'))).toEqual([
      ['insertion', 2, 2, 2, '', 'GT'],
      ['deletion', 2, 4, 2, 'GT', ''],
    ]);
  });

  it('calls twenty inserted bases an extra region and nineteen an insertion', () => {
    const t = 'T'.repeat(19);
    expect(variantsOf(aln('AC' + '-'.repeat(19) + 'GT', 'AC' + t + 'GT'))[0]?.kind).toBe(
      'insertion',
    );
    const run = 'T'.repeat(20);
    expect(shape(aln('AC' + '-'.repeat(20) + 'GT', 'AC' + run + 'GT'))).toEqual([
      ['extra', 2, 2, 20, '', run],
    ]);
  });

  it('calls twenty missing bases a missing region and nineteen a deletion', () => {
    const gap19 = '-'.repeat(19);
    expect(variantsOf(aln('AC' + 'T'.repeat(19) + 'GT', 'AC' + gap19 + 'GT'))[0]?.kind).toBe(
      'deletion',
    );
    const run = 'T'.repeat(20);
    expect(shape(aln('AC' + run + 'GT', 'AC' + '-'.repeat(20) + 'GT'))).toEqual([
      ['missing', 2, 22, 20, run, ''],
    ]);
  });

  it('shows at most twenty bases, then an ellipsis', () => {
    const run = 'ACGTACGTAC'.repeat(2) + 'A';
    const [v] = variantsOf(aln('AC' + run + 'GT', 'AC' + '-'.repeat(21) + 'GT'));
    expect(v?.kind).toBe('missing');
    expect(v?.size).toBe(21);
    expect(v?.expected).toBe('ACGTACGTACACGTACGTAC…');
    const [w] = variantsOf(aln('AC' + '-'.repeat(21) + 'GT', 'AC' + run + 'GT'));
    expect(w?.observed).toBe('ACGTACGTACACGTACGTAC…');
    const [x] = variantsOf(aln('AC' + '-'.repeat(20) + 'GT', 'AC' + run.slice(0, 20) + 'GT'));
    expect(x?.observed).toBe('ACGTACGTACACGTACGTAC');
  });
});

describe('placeVariants', () => {
  const v = (kind: VariantKind, start: number, end: number, size = end - start): Variant => ({
    kind,
    start,
    end,
    size,
    expected: '',
    observed: '',
    features: [],
  });
  const at = (
    features: Parameters<typeof placeVariants>[1],
    variant: Variant,
    length = 1000,
  ): string[] => placeVariants([variant], features, length)[0]?.features.map((f) => f.text) ?? [];
  const f = (type: string, name: string, ...segments: [number, number][]) =>
    createFeature({
      type,
      name,
      segments: segments.map(([s, e]) => rangeSegment(s, e)),
    });

  it('names a feature by its type alone when it has no name', () => {
    expect(at([f('promoter', '', [10, 20])], v('snv', 12, 13))).toEqual(['promoter changed']);
    expect(at([f('promoter', '   ', [10, 20])], v('snv', 12, 13))).toEqual(['promoter changed']);
    expect(at([f('promoter', 'pLac', [10, 20])], v('snv', 12, 13))).toEqual([
      'promoter pLac changed',
    ]);
  });

  it('carries the feature id, type and name', () => {
    const feature = f('terminator', 'T7', [10, 20]);
    const [placed] = placeVariants([v('snv', 12, 13)], [feature], 1000);
    expect(placed?.features).toEqual([
      { featureId: feature.id, type: 'terminator', name: 'T7', text: 'terminator T7 changed' },
    ]);
  });

  it('keeps variants without a feature as they are and leaves the input alone', () => {
    const input = v('snv', 500, 501);
    const [placed] = placeVariants([input], [f('CDS', 'a', [10, 20])], 1000);
    expect(placed).toEqual(input);
    expect(input.features).toEqual([]);
  });

  it('lists every feature a variant falls in, in the order given', () => {
    const list = [f('gene', 'g', [0, 100]), f('CDS', 'c', [10, 50]), f('misc', 'm', [200, 300])];
    expect(at(list, v('snv', 20, 21))).toEqual(['gene g changed', 'base change in CDS c']);
  });

  it('skips the source and features with no located stretch', () => {
    const site = createFeature({ type: 'misc', name: 's', segments: [siteSegment(15)] });
    expect(at([f('source', '', [0, 1000]), site], v('snv', 15, 16))).toEqual([]);
    expect(at([f('source', '', [0, 1000]), site], v('deletion', 14, 17))).toEqual([]);
  });

  it('says a base change in a CDS is a base change and a longer run a substitution', () => {
    const cds = [f('CDS', 'bla', [100, 400])];
    expect(at(cds, v('snv', 150, 151))).toEqual(['base change in CDS bla']);
    expect(at(cds, v('substitution', 150, 153))).toEqual(['substitution in CDS bla']);
  });

  it('does not call a base change in a one-base feature a deletion', () => {
    expect(at([f('misc', 'x', [10, 11])], v('snv', 10, 11))).toEqual(['misc x changed']);
    expect(at([f('CDS', 'x', [10, 13])], v('substitution', 10, 13))).toEqual([
      'substitution in CDS x',
    ]);
  });

  it('tells an insertion from a deletion in the CDS, in frame or not', () => {
    const cds = [f('CDS', 'bla', [100, 400])];
    expect(at(cds, v('insertion', 150, 150, 3))).toEqual(['in-frame insertion of 3 bp in CDS bla']);
    expect(at(cds, v('insertion', 150, 150, 2))).toEqual(['frameshift in CDS bla']);
    expect(at(cds, v('deletion', 150, 153, 3))).toEqual(['in-frame deletion of 3 bp in CDS bla']);
    expect(at(cds, v('deletion', 150, 152, 2))).toEqual(['frameshift in CDS bla']);
    expect(at(cds, v('extra', 150, 150, 21))).toEqual(['in-frame insertion of 21 bp in CDS bla']);
    expect(at(cds, v('extra', 150, 150, 22))).toEqual(['frameshift in CDS bla']);
    expect(at(cds, v('missing', 150, 171, 21))).toEqual(['in-frame deletion of 21 bp in CDS bla']);
    expect(at(cds, v('missing', 150, 172, 22))).toEqual(['frameshift in CDS bla']);
  });

  it('groups thousands in the size of an in-frame change', () => {
    const cds = [f('CDS', 'big', [0, 5000])];
    expect(at(cds, v('missing', 100, 1600, 1500), 5000)).toEqual([
      'in-frame deletion of 1,500 bp in CDS big',
    ]);
  });

  it('only says a feature changed when an indel is in something other than a CDS', () => {
    const p = [f('promoter', 'p', [100, 400])];
    expect(at(p, v('insertion', 150, 150, 3))).toEqual(['promoter p changed']);
    expect(at(p, v('deletion', 150, 153, 3))).toEqual(['promoter p changed']);
  });

  it('puts an insertion inside a feature only strictly between its bases', () => {
    const cds = [f('CDS', 'c', [100, 200])];
    expect(at(cds, v('insertion', 100, 100, 2))).toEqual([]);
    expect(at(cds, v('insertion', 200, 200, 2))).toEqual([]);
    expect(at(cds, v('insertion', 101, 101, 2))).toEqual(['frameshift in CDS c']);
    expect(at(cds, v('insertion', 199, 199, 2))).toEqual(['frameshift in CDS c']);
  });

  it('sees an insertion inside one stretch of a feature of several', () => {
    const split = [f('CDS', 'c', [100, 200], [300, 400])];
    expect(at(split, v('insertion', 350, 350, 1))).toEqual(['frameshift in CDS c']);
    expect(at(split, v('insertion', 250, 250, 1))).toEqual([]);
    expect(at(split, v('insertion', 200, 200, 1))).toEqual([]);
  });

  it('wraps an insertion at the origin of a circle', () => {
    const across = [f('CDS', 'c', [90, 100], [0, 10])];
    expect(at(across, v('insertion', 0, 0, 1), 100)).toEqual([]);
    const whole = [f('misc', 'm', [0, 100])];
    expect(at(whole, v('insertion', 0, 0, 1), 100)).toEqual(['misc m changed']);
    expect(at(whole, v('insertion', 1, 1, 1), 100)).toEqual(['misc m changed']);
  });

  it('finds a variant touching any one stretch of a feature of several', () => {
    const split = [f('misc', 'm', [100, 110], [300, 310])];
    expect(at(split, v('snv', 305, 306))).toEqual(['misc m changed']);
    expect(at(split, v('snv', 200, 201))).toEqual([]);
    expect(at(split, v('deletion', 108, 112, 4))).toEqual(['misc m changed']);
  });

  it('says a deletion that covers a feature deleted it', () => {
    const list = [f('promoter', 'pLac', [10, 20])];
    expect(at(list, v('deletion', 10, 20))).toEqual(['promoter pLac deleted']);
    expect(at(list, v('deletion', 5, 25))).toEqual(['promoter pLac deleted']);
    expect(at(list, v('missing', 10, 30, 20))).toEqual(['promoter pLac deleted']);
    expect(at(list, v('missing', 0, 20, 20))).toEqual(['promoter pLac deleted']);
  });

  it('says a deletion that takes part of a feature changed it', () => {
    const list = [f('promoter', 'pLac', [10, 20])];
    expect(at(list, v('deletion', 11, 25))).toEqual(['promoter pLac changed']);
    expect(at(list, v('deletion', 5, 19))).toEqual(['promoter pLac changed']);
    expect(at(list, v('missing', 11, 40, 29))).toEqual(['promoter pLac changed']);
  });

  it('needs a deletion to cover every stretch to say the feature is deleted', () => {
    const split = [f('promoter', 'p', [10, 20], [50, 60])];
    expect(at(split, v('deletion', 5, 25))).toEqual(['promoter p changed']);
    expect(at(split, v('deletion', 5, 65))).toEqual(['promoter p deleted']);
    const mixed = createFeature({
      type: 'promoter',
      name: 'q',
      segments: [rangeSegment(10, 20), siteSegment(500)],
    });
    expect(at([mixed], v('deletion', 5, 25))).toEqual(['promoter q deleted']);
  });
});

describe('whereVariant and describeVariant', () => {
  const v = (
    kind: VariantKind,
    start: number,
    end: number,
    size: number,
    e = '',
    o = '',
  ): Variant => ({
    kind,
    start,
    end,
    size,
    expected: e,
    observed: o,
    features: [],
  });

  it('numbers a base from 1, a range inclusive, a point by the base before', () => {
    expect(whereVariant(v('snv', 1233, 1234, 1))).toBe('1,234');
    expect(whereVariant(v('deletion', 1233, 1240, 7))).toBe('1,234..1,240');
    expect(whereVariant(v('deletion', 0, 2, 2))).toBe('1..2');
    expect(whereVariant(v('insertion', 1234, 1234, 2))).toBe('after 1,234');
    expect(whereVariant(v('insertion', 0, 0, 2))).toBe('before 1');
  });

  it('describes each kind of variant in a phrase', () => {
    expect(describeVariant(v('snv', 1233, 1234, 1, 'A', 'G'))).toBe('SNV at 1,234 (A to G)');
    expect(describeVariant(v('substitution', 9, 13, 4))).toBe('4-base substitution at 10..13');
    expect(describeVariant(v('deletion', 1999, 2002, 3))).toBe('deletion of 3 bp at 2,000..2,002');
    expect(describeVariant(v('deletion', 1999, 2000, 1))).toBe('deletion of 1 bp at 2,000');
    expect(describeVariant(v('insertion', 50, 50, 2))).toBe('insertion of 2 bp after 50');
    expect(describeVariant(v('insertion', 0, 0, 2))).toBe('insertion of 2 bp before 1');
    expect(describeVariant(v('extra', 1000, 1000, 1200))).toBe(
      'extra region of 1,200 bp after 1,000',
    );
    expect(describeVariant(v('missing', 100, 130, 30))).toBe('missing region of 30 bp at 101..130');
  });
});
