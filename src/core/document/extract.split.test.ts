import {
  type Feature,
  type Segment,
  SeqDocument,
  createFeature,
  digest,
  documentFromFragment,
  extractRange,
  findCutSites,
  firstQualifier,
  getEnzyme,
  ligate,
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

  it('a whole-circle region that starts outside every feature splits none', () => {
    for (const start of [0, 5, 10, 46, 50]) {
      const ex = extractRange(circle('forward'), { start, end: start + 60 });
      const [f, ...rest] = ex.features.all();
      expect(rest).toHaveLength(0);
      expect(ranges(def(f))).toEqual([
        { start: (10 - start + 60) % 60, end: ((10 - start + 60) % 60) + 36, ps: false, pe: false },
      ]);
      expect(translateCds(ex, def(f)).protein).toBe(PROTEIN);
    }
  });
});

describe('extractRange splits a feature across the one cut of a circle (#174)', () => {
  /** The pieces of the orf in `ex`, in reading order. */
  const reading = (ex: SeqDocument, strand: 'forward' | 'reverse') => {
    const fs = ex.features.all();
    return strand === 'forward' ? fs : [...fs].reverse();
  };

  it.each(['forward', 'reverse'] as const)(
    '%s CDS, whole circle cut at every base inside it: two pieces, each in frame',
    (strand) => {
      const doc = circle(strand);
      for (let cut = 11; cut < 46; cut++) {
        const ex = extractRange(doc, { start: cut, end: cut + 60 });
        const fs = ex.features.all();
        expect(fs, `cut ${cut}`).toHaveLength(2);
        // Listed in the feature's own order: the low source stretch (at the
        // product's right end) first, the high one (at its left end) second.
        const [low, high] = fs.map((f) => ranges(f));
        expect(low).toEqual([{ start: 60 - cut + 10, end: 60, ps: false, pe: true }]);
        expect(high).toEqual([{ start: 0, end: 46 - cut, ps: true, pe: false }]);
        for (const f of fs) expect(firstQualifier(f, 'translation')).toBeUndefined();
        // The two stretches together are the whole reading, each in frame.
        const [head, tail] = reading(ex, strand);
        const headBases = ex.featureSequence(def(head));
        const tailBases = ex.featureSequence(def(tail));
        expect(headBases + tailBases).toBe(ORF);
        expect(firstQualifier(def(head), 'codon_start')).toBeUndefined();
        // A last codon cut short reads as its residue when its two bases
        // decide it (item 66), so the head may show one residue more.
        const whole = Math.floor(headBases.length / 3);
        expect([PROTEIN.slice(0, whole), PROTEIN.slice(0, whole + 1)]).toContain(
          translateCds(ex, def(head)).protein,
        );
        expect(translateBases(headBases, 1)).toBe(PROTEIN.slice(0, whole));
        const frame = ((3 - (headBases.length % 3)) % 3) + 1;
        expect(firstQualifier(def(tail), 'codon_start') ?? '1').toBe(String(frame));
        expect(translateCds(ex, def(tail)).protein).toBe(translateBases(tailBases, frame));
      }
    },
  );

  it('a feature across the origin splits when the whole circle is taken from 0', () => {
    const doc = SeqDocument.create({
      sequence: 'ACGT'.repeat(15),
      topology: 'circular',
      features: [createFeature({ type: 'misc_feature', segments: [rangeSegment(55, 65)] })],
    });
    const ex = extractRange(doc, { start: 0, end: 60 });
    expect(ex.features.all().map((f) => ranges(f))).toEqual([
      [{ start: 55, end: 60, ps: false, pe: true }],
      [{ start: 0, end: 5, ps: true, pe: false }],
    ]);
    // Taken from anywhere else, the origin is inside the product and the feature is whole.
    const whole = extractRange(doc, { start: 30, end: 90 });
    expect(whole.features.all().map((f) => ranges(f))).toEqual([
      [{ start: 25, end: 35, ps: false, pe: false }],
    ]);
  });

  it('a join splits only at the cut, never at its own gap', () => {
    const doc = SeqDocument.create({
      sequence: 'ACGT'.repeat(15),
      topology: 'circular',
      features: [
        createFeature({
          type: 'misc_feature',
          segments: [rangeSegment(10, 20), rangeSegment(30, 50)],
        }),
      ],
    });
    // Cut inside the second segment: 10..19 and 30..39 stay joined at the
    // product's right end, 40..49 is a piece of its own at the left.
    const ex = extractRange(doc, { start: 40, end: 100 });
    expect(ex.features.all().map((f) => ranges(f))).toEqual([
      [
        { start: 30, end: 40, ps: false, pe: false },
        { start: 50, end: 60, ps: false, pe: true },
      ],
      [{ start: 0, end: 10, ps: true, pe: false }],
    ]);
    // Cut in the join's own gap, or between two segments that abut in the
    // source: nothing splits.
    expect(extractRange(doc, { start: 25, end: 85 }).features.all()).toHaveLength(1);
    const abut = SeqDocument.create({
      sequence: 'ACGT'.repeat(15),
      topology: 'circular',
      features: [
        createFeature({
          type: 'misc_feature',
          segments: [rangeSegment(10, 20), rangeSegment(20, 30)],
        }),
      ],
    });
    expect(
      extractRange(abut, { start: 20, end: 80 })
        .features.all()
        .map((f) => ranges(f)),
    ).toEqual([
      [{ start: 50, end: 60, ps: false, pe: true }],
      [{ start: 0, end: 10, ps: true, pe: false }],
    ]);
  });

  it('the issue repro: an insert ligated into a single-cut CDS is not skipped', () => {
    const cds = 'ATGCGAATTCCGAAACTGTTTGCATGGTAA';
    const vseq = 'C'.repeat(10) + cds + 'G'.repeat(20);
    const vector = SeqDocument.create({
      sequence: vseq,
      topology: 'circular',
      features: [createFeature({ type: 'CDS', name: 'gene', segments: [rangeSegment(10, 40)] })],
    });
    const ecoRI = [def(getEnzyme('EcoRI'))];
    const [cut, ...others] = digest(vector, findCutSites(vseq, 'circular', ecoRI));
    expect(others).toHaveLength(0);
    const linear = documentFromFragment(def(cut));
    expect(linear.features.all().map((f) => translateCds(linear, f).protein)).toEqual([
      'MR',
      'IPKLFAW*',
    ]);
    const iseq = `GAATTC${'T'.repeat(20)}GAATTC`;
    const insert = SeqDocument.create({ sequence: iseq, topology: 'linear' });
    const [, mid] = digest(insert, findCutSites(iseq, 'linear', ecoRI));
    const product = ligate([def(cut), def(mid)], { name: 'p', circular: true });
    expect(product.length).toBe(86);
    // The two pieces sit on either side of the insert, not joined across it.
    const fs = product.features.all();
    expect(fs.map((f) => ranges(f))).toEqual([
      [{ start: 55, end: 60, ps: false, pe: true }],
      [{ start: 0, end: 25, ps: true, pe: false }],
    ]);
    expect(fs.map((f) => translateCds(product, f).protein)).toEqual(['MR', 'IPKLFAW*']);
  });
});
