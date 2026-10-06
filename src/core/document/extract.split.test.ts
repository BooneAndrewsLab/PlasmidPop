import {
  type Feature,
  type Segment,
  SeqDocument,
  createFeature,
  extractRange,
  firstQualifier,
  rangeSegment,
  translateCds,
} from '@/core';
import { reverseComplement } from '@/core/sequence/alphabet';

function def<T>(x: T | undefined): T {
  if (x === undefined) throw new Error('expected a value');
  return x;
}

const CODONS = ['ATG', 'CGA', 'ATT', 'CCG', 'AAA', 'CTG', 'TTT', 'GCA', 'TGG', 'GAC', 'CAT', 'TAA'];
const ORF = CODONS.join(''); // 36 bases: M R I P K L F A W D H *
const PROTEIN = 'MRIPKLFAWDH*';

/** Amino acids of `bases` read from `frame` (1-3), to compare with the translated pieces. */
function translateBases(bases: string, frame: number): string {
  let out = '';
  for (let i = frame - 1; i + 3 <= bases.length; i += 3) {
    out += PROTEIN[CODONS.indexOf(bases.slice(i, i + 3))] ?? '?';
  }
  return out;
}

function ranges(f: Feature): { start: number; end: number; ps: boolean; pe: boolean }[] {
  return f.segments.flatMap((s: Segment) =>
    s.kind === 'range'
      ? [{ start: s.start, end: s.end, ps: s.partialStart, pe: s.partialEnd }]
      : [],
  );
}

/** A 60 bp circle: `ORF` (or its reverse complement) at [10, 46) in filler that has no ATG-like surprises. */
function circle(
  strand: 'forward' | 'reverse',
  extra: Partial<Parameters<typeof createFeature>[0]> = {},
) {
  const body = strand === 'forward' ? ORF : reverseComplement(ORF);
  const sequence = 'C'.repeat(10) + body + 'G'.repeat(14);
  return SeqDocument.create({
    sequence,
    topology: 'circular',
    features: [
      createFeature({
        type: 'CDS',
        name: 'orf',
        strand,
        segments: [rangeSegment(10, 46)],
        qualifiers: [{ name: 'translation', value: PROTEIN.slice(0, -1) }],
        ...extra,
      }),
    ],
  });
}

describe('extractRange splits a feature whose middle the region drops (#169)', () => {
  it('the issue repro: 60 bp circle, CDS [10,50), extract [40,80)', () => {
    const doc = SeqDocument.create({
      sequence: 'C'.repeat(10) + ORF + ORF.slice(0, 4) + 'G'.repeat(10),
      topology: 'circular',
      features: [createFeature({ type: 'CDS', name: 'x', segments: [rangeSegment(10, 50)] })],
    });
    const ex = extractRange(doc, { start: 40, end: 80 });
    const fs = ex.features.all();
    expect(fs).toHaveLength(2);
    expect(new Set(fs.map((f) => f.id)).size).toBe(2);
    expect(fs.map((f) => f.name)).toEqual(['x', 'x']);
    // 10..19 (extract 30..40) keeps the start, 40..49 (extract 0..10) the end.
    const [first, second] = fs.map((f) => ranges(f));
    expect(first).toEqual([{ start: 30, end: 40, ps: false, pe: true }]);
    expect(second).toEqual([{ start: 0, end: 10, ps: true, pe: false }]);
  });

  it.each([0, 1, 2])(
    'forward CDS, dropped middle of 12 + %i bases: both pieces in frame',
    (mod) => {
      const gap = 12 + mod;
      // Keeps ORF[0, 6) at [10, 16) and ORF[6 + gap, 36) at [16 + gap, 46).
      const ex = extractRange(circle('forward'), { start: 16 + gap, end: 60 + 16 });
      const fs = ex.features.all();
      expect(fs).toHaveLength(2);
      const head = def(fs.find((f) => ranges(f)[0]?.ps === false));
      const tail = def(fs.find((f) => ranges(f)[0]?.ps === true));
      expect(ranges(head)[0]?.pe).toBe(true);
      expect(ranges(tail)[0]?.pe).toBe(false);
      expect(firstQualifier(head, 'translation')).toBeUndefined();
      expect(firstQualifier(tail, 'translation')).toBeUndefined();
      expect(firstQualifier(head, 'codon_start')).toBeUndefined();
      expect(translateCds(ex, head).protein).toBe('MR');
      // The tail starts 6 + gap bases into the reading.
      const frame = ((3 - ((6 + gap) % 3)) % 3) + 1;
      expect(firstQualifier(tail, 'codon_start') ?? '1').toBe(String(frame));
      expect(translateCds(ex, tail).protein).toBe(translateBases(ORF.slice(6 + gap), frame));
    },
  );

  it.each([0, 1, 2])(
    'reverse CDS, dropped middle of 12 + %i bases: partials follow the reading',
    (mod) => {
      const gap = 12 + mod;
      // Reading starts at base 45. Keeps its first 6 at [40, 46) and the rest at [10, 40 - gap).
      const ex = extractRange(circle('reverse'), { start: 40, end: 100 - gap });
      const fs = ex.features.all();
      expect(fs).toHaveLength(2);
      const last = (f: Feature) => def(ranges(f).at(-1));
      const head = def(fs.find((f) => !last(f).pe));
      const tail = def(fs.find((f) => last(f).pe));
      // The head keeps the 5' end (high coordinate) and is cut on its low side; the tail the reverse.
      expect([ranges(head)[0]?.ps, last(head).pe]).toEqual([true, false]);
      expect([ranges(tail)[0]?.ps, last(tail).pe]).toEqual([false, true]);
      expect(firstQualifier(head, 'codon_start')).toBeUndefined();
      expect(translateCds(ex, head).protein).toBe('MR');
      const frame = ((3 - ((6 + gap) % 3)) % 3) + 1;
      expect(firstQualifier(tail, 'codon_start') ?? '1').toBe(String(frame));
      expect(translateCds(ex, tail).protein).toBe(translateBases(ORF.slice(6 + gap), frame));
    },
  );

  it('a non-CDS feature splits with partial flags only', () => {
    const doc = circle('forward', { type: 'misc_feature', qualifiers: [] });
    const ex = extractRange(doc, { start: 30, end: 60 + 20 });
    const fs = ex.features.all();
    expect(fs).toHaveLength(2);
    expect(fs.every((f) => firstQualifier(f, 'codon_start') === undefined)).toBe(true);
    expect(fs.map((f) => ranges(f).map((r) => [r.ps, r.pe])).sort()).toEqual([
      [[false, true]],
      [[true, false]],
    ]);
  });

  it('a source join kept whole stays one join, even across the origin', () => {
    const doc = SeqDocument.create({
      sequence: 'ACGTTGCAAC'.repeat(6),
      topology: 'circular',
      features: [
        createFeature({ type: 'CDS', segments: [rangeSegment(10, 20), rangeSegment(30, 50)] }),
      ],
    });
    for (const r of [
      { start: 5, end: 55 },
      { start: 25, end: 85 },
    ]) {
      const ex = extractRange(doc, r);
      const f = def(ex.features.all()[0]);
      expect(ex.features.all()).toHaveLength(1);
      expect(ranges(f)).toHaveLength(2);
      expect(ex.featureSequence(f)).toBe(doc.featureSequence(def(doc.features.all()[0])));
    }
  });

  it('a source join whose middle stretch is dropped splits only at that drop', () => {
    const doc = SeqDocument.create({
      sequence: 'ACGTTGCAAC'.repeat(10),
      topology: 'circular',
      features: [
        createFeature({
          type: 'misc_feature',
          segments: [rangeSegment(10, 20), rangeSegment(30, 50), rangeSegment(60, 70)],
        }),
      ],
    });
    // Keeps 45..99 and 0..24: the head of the middle segment (30..44) is lost.
    const ex = extractRange(doc, { start: 45, end: 125 });
    const [a, rest] = ex.features.all();
    expect(ex.features.all()).toHaveLength(2);
    expect(ex.featureSequence(def(a))).toBe(doc.sequence.toString().slice(10, 20));
    // 45..49 and 60..69 stay joined across the source's own gap.
    expect(ranges(def(rest))).toHaveLength(2);
    expect(ex.featureSequence(def(rest))).toBe(
      doc.sequence.toString().slice(45, 50) + doc.sequence.toString().slice(60, 70),
    );
    expect([ranges(def(a))[0]?.ps, ranges(def(a))[0]?.pe]).toEqual([false, true]);
    expect(ranges(def(rest))[0]?.ps).toBe(true);
  });

  it('a whole-circle region never splits', () => {
    const ex = extractRange(circle('forward'), { start: 30, end: 90 });
    expect(ex.features.all()).toHaveLength(1);
  });
});
