import { alignEitherStrand, reverseComplement } from '@/core';

import { stackAlignments } from './alignmentStack';
import type { TrackAnnotation } from './alignmentTrack';
import {
  confidentDifferences,
  coverageBand,
  coverageOf,
  coveredText,
  type FeatureVerdict,
  sortVerdicts,
  statusText,
  strandsText,
  summariseVerdicts,
  VerdictKind,
  type VerdictKindValue,
  verdictPositionText,
  verdictsOf,
  verdictsTsv,
  verdictSummaryText,
  verdictText,
} from './alignmentVerdict';
import { finishReadAlignment, prepareReadAlignment } from './readAlignment';

const reference = 'GATTACAGCTTGACCGTAAGCTAGGCTTACGATCGATTGCAAGTCCGATGCATTGACCTA';
const ref = { sequence: reference, offset: 0, wrap: null };

interface Read {
  readonly sequence: string;
  /** One quality for the whole read, or per base. */
  readonly quality?: number | readonly number[];
}

function stackOf(
  reads: Read[],
  reference0: { sequence: string; offset: number; wrap: number | null } = ref,
) {
  const samples = reads.map(({ sequence, quality }, i) => {
    const read =
      quality === undefined
        ? null
        : {
            qualities: Uint8Array.from(
              typeof quality === 'number'
                ? new Array<number>(sequence.length).fill(quality)
                : quality,
            ),
            trace: null,
          };
    const prepared = prepareReadAlignment(reference0, { sequence, read }, null);
    if (!prepared.ok) throw new Error(prepared.message);
    const { job } = prepared;
    return {
      name: `r${i}`,
      result: finishReadAlignment(job, alignEitherStrand(job.a, job.b, { mode: 'local' })),
    };
  });
  return stackAlignments(reference0, samples);
}

function note(name: string, start: number, end: number, extra: Partial<TrackAnnotation> = {}) {
  return {
    name,
    type: 'CDS',
    strand: 'forward',
    colour: '#000',
    ranges: [{ start, end }],
    orf: false,
    ...extra,
  } satisfies TrackAnnotation;
}

function verdicts(stack: ReturnType<typeof stackOf>, notes: TrackAnnotation[], from = 20) {
  const coverage = coverageOf(stack, from);
  return verdictsOf(stack, notes, coverage, confidentDifferences(stack, from), 0);
}

/** The verdict's text, failing when there is none. */
function say(v: FeatureVerdict | undefined): string {
  if (v === undefined) throw new Error('no verdict');
  return verdictText(v);
}

describe('coverage', () => {
  it('counts the reads over each column, 0, 1 and 2 or more', () => {
    const stack = stackOf([
      { sequence: reference.slice(0, 40) },
      { sequence: reference.slice(20) },
    ]);
    const c = coverageOf(stack, 20);
    expect([5, 25, 50].map((col) => coverageBand(c, col))).toEqual([1, 2, 1]);
    const bare = stackOf([{ sequence: reference.slice(10, 40) }]);
    expect(coverageBand(coverageOf(bare, 20), 0)).toBe(0);
    expect(coverageBand(coverageOf(bare, 20), 20)).toBe(1);
  });

  it('leaves out bases below the confident quality, but not a read without qualities', () => {
    const quality = new Array<number>(40).fill(30).fill(5, 0, 10);
    const stack = stackOf([{ sequence: reference.slice(0, 40), quality }]);
    const c = coverageOf(stack, 20);
    expect(coverageBand(c, 5)).toBe(0);
    expect(coverageBand(c, 10)).toBe(1);
    expect(coverageBand(coverageOf(stack, 3), 5)).toBe(1);
    const plain = stackOf([{ sequence: reference.slice(0, 40) }]);
    expect(coverageBand(coverageOf(plain, 99), 5)).toBe(1);
  });

  it('keeps the strands apart', () => {
    const fwd = reference.slice(0, 40);
    const stack = stackOf([{ sequence: fwd }, { sequence: reverseComplement(fwd) }]);
    const c = coverageOf(stack, 20);
    expect([c.forward[10], c.reverse[10]]).toEqual([1, 1]);
  });
});

describe('a verdict per feature', () => {
  it('confirms a feature a read covers without a difference, naming the reads', () => {
    const stack = stackOf([
      { sequence: reference.slice(0, 40) },
      { sequence: reference.slice(5, 45) },
    ]);
    const [v] = verdicts(stack, [note('lacZ', 10, 30)]);
    expect(v).toMatchObject({ kind: VerdictKind.Confirmed, reads: 2, bases: 20, covered: 20 });
    expect(say(v)).toBe('lacZ confirmed by 2 reads, forward strand only');
  });

  it('says nothing about strands when both are present, and counts the fewest over the feature', () => {
    const fwd = reference.slice(0, 40);
    const stack = stackOf([{ sequence: fwd }, { sequence: reverseComplement(fwd) }]);
    const [v] = verdicts(stack, [note('x', 10, 30)]);
    expect(v?.strands).toBe('both');
    expect(say(v)).toBe('x confirmed by 2 reads');
    // A second read over only half of the feature does not raise the count.
    const part = stackOf([{ sequence: fwd }, { sequence: reference.slice(20, 50) }]);
    expect(verdicts(part, [note('x', 10, 30)])[0]?.reads).toBe(1);
    expect(say(verdicts(part, [note('x', 10, 30)])[0])).toBe(
      'x confirmed by 1 read, forward strand only',
    );
  });

  it('reports the strand when only reversed reads cover it', () => {
    const stack = stackOf([{ sequence: reverseComplement(reference.slice(0, 40)) }]);
    expect(verdicts(stack, [note('x', 10, 30)])[0]?.strands).toBe('reverse');
  });

  it('counts differences inside a feature and not outside it', () => {
    const changed = reference.slice(0, 40).split('');
    changed[12] = changed[12] === 'A' ? 'C' : 'A';
    changed[35] = changed[35] === 'A' ? 'C' : 'A';
    const stack = stackOf([{ sequence: changed.join('') }]);
    const [inside, outside] = verdicts(stack, [note('in', 10, 20), note('out', 20, 30)]);
    expect(inside).toMatchObject({ kind: VerdictKind.Differences, differences: 1 });
    expect(say(inside)).toBe('in: 1 difference');
    expect(outside?.kind).toBe(VerdictKind.Confirmed);
  });

  it('does not count a difference in a poor stretch of a read, nor cover it', () => {
    const changed = reference.slice(0, 40).split('');
    changed[12] = changed[12] === 'A' ? 'C' : 'A';
    const quality = new Array<number>(40).fill(30).fill(3, 11, 14);
    const stack = stackOf([{ sequence: changed.join(''), quality }]);
    expect(stack.differences).toHaveLength(1);
    expect(confidentDifferences(stack, 20)).toEqual([]);
    const [v] = verdicts(stack, [note('x', 5, 25)]);
    expect(v).toMatchObject({
      kind: VerdictKind.Partial,
      covered: 17,
      bases: 20,
      reads: 0,
      strands: null,
    });
    expect(say(v)).toBe('x: 17 of 20 bases covered');
  });

  it('says not covered for a feature no read reaches, and skips one outside the alignment', () => {
    const stack = stackOf([{ sequence: reference.slice(0, 20) }]);
    const [v] = verdicts(stack, [note('far', 40, 55)]);
    expect(say(v)).toBe('far: not covered');
  });

  it('leaves ORFs out and counts an insertion inside a feature as a difference', () => {
    const inserted = reference.slice(0, 40);
    const stack = stackOf([{ sequence: `${inserted.slice(0, 20)}TTT${inserted.slice(20)}` }]);
    const out = verdicts(stack, [note('orf', 5, 30, { orf: true }), note('g', 10, 30)]);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ kind: VerdictKind.Differences });
  });

  it("does not make another read's insertion a gap in coverage", () => {
    const inserted = reference.slice(0, 40);
    const stack = stackOf([
      { sequence: inserted },
      { sequence: `${inserted.slice(0, 20)}TTT${inserted.slice(20)}` },
    ]);
    const clean = verdicts(stack, [note('g', 5, 15)])[0];
    expect(clean).toMatchObject({ kind: VerdictKind.Confirmed, reads: 2 });
  });

  it('reads a feature across a circle’s origin once, from a read through it', () => {
    const circle = { sequence: reference, offset: 50, wrap: reference.length };
    const read = reference.slice(50) + reference.slice(0, 20);
    const stack = stackOf([{ sequence: read }], circle);
    const coverage = coverageOf(stack, 20);
    const v = verdictsOf(
      stack,
      [note('across', 55, 66, { ranges: [{ start: 55, end: 66 }] })],
      coverage,
      confidentDifferences(stack, 20),
      reference.length,
    );
    expect(v[0]).toMatchObject({ kind: VerdictKind.Confirmed, bases: 11, reads: 1 });
    // Written past the end, it is numbered as the ruler numbers it: 56 through the origin to 6.
    expect(v[0]).toMatchObject({ position: 56, endPosition: 6 });
    expect(v.map((x) => verdictPositionText(x))).toEqual(['56–6']);
  });

  it('numbers a feature 1-based and inclusive, from its first segment to its last', () => {
    const stack = stackOf([{ sequence: reference.slice(0, 40) }]);
    const out = verdicts(stack, [
      note('one', 10, 30),
      note('joined', 2, 30, {
        ranges: [
          { start: 2, end: 8 },
          { start: 20, end: 30 },
        ],
      }),
      note('single', 6, 7),
    ]);
    // Sorted by first base: joined (3), single (7), one (11).
    expect(out.map((v) => v.name)).toEqual(['joined', 'single', 'one']);
    expect(out.map((v) => verdictPositionText(v))).toEqual(['3–30', '7', '11–30']);
    expect(out[0]).toMatchObject({ position: 3, endPosition: 30 });
  });

  it('numbers a join through a circle’s origin from its first segment to its last', () => {
    const circle = { sequence: reference, offset: 50, wrap: reference.length };
    const stack = stackOf([{ sequence: reference.slice(50) + reference.slice(0, 20) }], circle);
    const v = verdictsOf(
      stack,
      [
        note('across', 52, 5, {
          ranges: [
            { start: 52, end: 60 },
            { start: 0, end: 5 },
          ],
        }),
      ],
      coverageOf(stack, 20),
      [],
      reference.length,
    );
    expect(v[0]).toMatchObject({ position: 53, endPosition: 5, bases: 13 });
  });

  it('keeps the given order for features at the same place', () => {
    const stack = stackOf([{ sequence: reference.slice(0, 40) }]);
    const out = verdicts(stack, [note('b', 10, 20), note('a', 10, 20), note('c', 10, 15)]);
    expect(out.map((v) => v.name)).toEqual(['c', 'b', 'a']);
  });

  it('gives the fewest reads and the strands for a feature with differences too', () => {
    const changed = reference.slice(0, 40).split('');
    changed[12] = changed[12] === 'A' ? 'C' : 'A';
    const fwd = changed.join('');
    const stack = stackOf([{ sequence: fwd }, { sequence: reverseComplement(fwd) }]);
    const [v] = verdicts(stack, [note('x', 10, 20)]);
    expect(v).toMatchObject({ kind: VerdictKind.Differences, reads: 2, strands: 'both' });
  });

  it('says mixed when every base is read but neither strand reads them all', () => {
    const stack = stackOf([
      { sequence: reference.slice(0, 22) },
      { sequence: reverseComplement(reference.slice(18, 45)) },
    ]);
    const all = verdicts(stack, [note('x', 10, 30)]);
    const [v] = all;
    expect(v).toMatchObject({ kind: VerdictKind.Confirmed, reads: 1, strands: 'mixed' });
    expect(say(v)).toBe('x confirmed by 1 read');
    expect(all.map((x) => strandsText(x))).toEqual(['mixed']);
  });
});

describe('summariseVerdicts', () => {
  const v = (
    kind: VerdictKindValue,
    reads = 0,
    strands: FeatureVerdict['strands'] = null,
    name = 'x',
  ) =>
    ({
      name,
      type: 'gene',
      kind,
      differences: kind === VerdictKind.Differences ? 2 : 0,
      reads,
      strands,
      covered: kind === VerdictKind.Partial ? 17 : 0,
      bases: 20,
      position: 1,
      endPosition: 20,
      start: 0,
      end: 1,
    }) satisfies FeatureVerdict;

  it('says all, with the fewest reads, and names the exceptions only', () => {
    const s = summariseVerdicts([v('confirmed', 5, 'forward'), v('confirmed', 5, 'forward')]);
    expect(verdictSummaryText(s, 5)).toBe(
      'All 2 features confirmed by all 5 reads, forward strand only',
    );
    expect(s.exceptions).toEqual([]);
    const t = summariseVerdicts([
      v('confirmed', 3, 'both'),
      v('confirmed', 5, 'both'),
      v('differences', 5, 'forward'),
    ]);
    expect(verdictSummaryText(t, 5)).toBe('2 of 3 features confirmed by at least 3 reads');
    expect(t.exceptions).toHaveLength(1);
  });

  it('leaves the strand out when the confirmed features differ, and copes with none', () => {
    const s = summariseVerdicts([v('confirmed', 2, 'forward'), v('confirmed', 2, 'both')]);
    expect(s.oneStrand).toBeNull();
    expect(verdictSummaryText(summariseVerdicts([v('not-covered')]), 2)).toBe(
      'No feature confirmed (of 1)',
    );
  });

  it('sorts by status, the ones needing a look first and document order within', () => {
    const list = [
      v('confirmed', 5, 'forward', 'a'),
      v('not-covered', 0, null, 'b'),
      v('differences', 5, 'forward', 'c'),
      v('partial', 0, null, 'd'),
      v('differences', 1, 'both', 'e'),
    ];
    expect(sortVerdicts(list, 'status').map((x) => x.name)).toEqual(['c', 'e', 'd', 'b', 'a']);
    expect(sortVerdicts(list, 'position').map((x) => x.name)).toEqual(['a', 'b', 'c', 'd', 'e']);
    expect(sortVerdicts(list, 'position')).not.toBe(list);
  });

  it('writes each column of the table', () => {
    expect(statusText(v('confirmed', 5))).toBe('Confirmed');
    expect(statusText(v('differences'))).toBe('2 differences');
    expect(statusText({ ...v('differences'), differences: 1 })).toBe('1 difference');
    expect(statusText(v('partial'))).toBe('Partly covered');
    expect(statusText(v('not-covered'))).toBe('Not covered');
    expect(strandsText(v('confirmed', 5, 'forward'))).toBe('forward only');
    expect(strandsText(v('confirmed', 5, 'reverse'))).toBe('reverse only');
    expect(strandsText(v('confirmed', 5, 'both'))).toBe('both');
    expect(strandsText(v('partial'))).toBe('');
    expect(coveredText(v('partial'))).toBe('17 of 20');
    expect(coveredText({ ...v('partial'), covered: 1200, bases: 1500 })).toBe(
      `${(1200).toLocaleString()} of ${(1500).toLocaleString()}`,
    );
    expect(verdictPositionText(v('confirmed'))).toBe('1–20');
  });

  it('copies the table as tab-separated text, tabs in a name flattened', () => {
    const text = verdictsTsv([v('confirmed', 5, 'forward', 'lac\tZ'), v('not-covered')]);
    expect(text.split('\n')).toEqual([
      'Status\tFeature\tType\tPosition\tReads\tStrands\tDifferences\tBases covered',
      'Confirmed\tlac Z\tgene\t1–20\t5\tforward only\t0\t0 of 20',
      'Not covered\tx\tgene\t1–20\t0\t\t0\t0 of 20',
    ]);
  });
});
