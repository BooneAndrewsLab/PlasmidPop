import { alignEitherStrand, reverseComplement } from '@/core';

import { stackAlignments } from './alignmentStack';
import type { TrackAnnotation } from './alignmentTrack';
import {
  confidentDifferences,
  coverageBand,
  coverageOf,
  type FeatureVerdict,
  VerdictKind,
  verdictsOf,
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
    expect(v?.oneStrand).toBeNull();
    // A second read over only half of the feature does not raise the count.
    const part = stackOf([{ sequence: fwd }, { sequence: reference.slice(20, 50) }]);
    expect(verdicts(part, [note('x', 10, 30)])[0]?.reads).toBe(1);
    expect(say(verdicts(part, [note('x', 10, 30)])[0])).toBe(
      'x confirmed by 1 read, forward strand only',
    );
  });

  it('reports the strand when only reversed reads cover it', () => {
    const stack = stackOf([{ sequence: reverseComplement(reference.slice(0, 40)) }]);
    expect(verdicts(stack, [note('x', 10, 30)])[0]?.oneStrand).toBe('reverse');
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
    expect(v).toMatchObject({ kind: VerdictKind.Partial, covered: 17, bases: 20 });
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
  });
});
