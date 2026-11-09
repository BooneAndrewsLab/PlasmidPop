import { describe, expect, it } from 'vitest';

import { type Placed, type ReadPair, checkPairs, findReadPairs, judgePair } from './pairing';

/**
 * What `pairing.test.ts` leaves to chance (item 50, the 1.25 pass): the exact
 * stems and families of the name patterns, the group conditions at their
 * edges, and every sort and the median, which a test with one or two items
 * cannot tell from no sort at all.
 */

const named = (...names: string[]): ReadPair[] => [...findReadPairs(names).pairs];
const at = (strand: 'forward' | 'reverse', start: number, end: number, index = 0): Placed => ({
  index,
  strand,
  start,
  end,
});

describe('findReadPairs: stems and families', () => {
  it('trims the name before it looks for a mate token', () => {
    expect(named(' clone_F ', '\tclone_R\n')).toEqual([{ first: 0, second: 1, stem: 'clone' }]);
  });

  it('gives an Illumina header pair the name as its stem', () => {
    expect(named('NAME 1:N:0:ACGT', 'NAME 2:N:0:ACGT')).toEqual([
      { first: 0, second: 1, stem: 'NAME' },
    ]);
    expect(named('a b 2:Y:18:', 'a b 1:Y:18:')).toEqual([{ first: 1, second: 0, stem: 'a b' }]);
  });

  it('puts a header read number in the family of numbers, with _1 and _2', () => {
    // One family: the header's 1 and the name's _2 are mates...
    expect(named('NAME 1:N:0:ACGT', 'NAME_2')).toEqual([{ first: 0, second: 1, stem: 'NAME' }]);
    expect(named('NAME_1', 'NAME 2:N:0:ACGT')).toEqual([{ first: 0, second: 1, stem: 'NAME' }]);
    // ...and a series that goes on past 2 spoils them, as it does _1 and _2 alone.
    const series = findReadPairs(['NAME 1:N:0:ACGT', 'NAME_2', 'NAME_3']);
    expect(series.pairs).toEqual([]);
    expect(series.ambiguous).toEqual([
      { stem: 'NAME', names: ['NAME 1:N:0:ACGT', 'NAME_2', 'NAME_3'] },
    ]);
  });

  it('keeps an Illumina file name apart from letters and numbers of the same stem', () => {
    const out = findReadPairs(['x_R1', 'x_R2', 'x_F', 'x_R']);
    expect(out.pairs).toEqual([]);
    expect(out.ambiguous.map((a) => a.names)).toEqual([
      ['x_R1', 'x_R2'],
      ['x_F', 'x_R'],
    ]);
  });

  it('knows a number of two digits is a number, so that it spoils a series', () => {
    const out = findReadPairs(['clone_1', 'clone_2', 'clone_10']);
    expect(out.pairs).toEqual([]);
    expect(out.ambiguous).toEqual([{ stem: 'clone', names: ['clone_1', 'clone_2', 'clone_10'] }]);
  });

  it('reads the chunk and the lane as part of the stem, as written', () => {
    expect(named('Ab_S1_L001_R1_001.fq', 'Ab_S1_L001_R2_001.fq')).toEqual([
      { first: 0, second: 1, stem: 'Ab_S1_L001_001' },
    ]);
  });
});

describe('findReadPairs: the group conditions', () => {
  it('does not pair one forward read with two reverse ones', () => {
    const out = findReadPairs(['c_F', 'c_R', 'c_R']);
    expect(out.pairs).toEqual([]);
    expect(out.ambiguous).toEqual([{ stem: 'c', names: ['c_F', 'c_R', 'c_R'] }]);
  });

  it('does not pair a complete pair whose stem is also a series of numbers', () => {
    const out = findReadPairs(['x_F', 'x_R', 'x_1']);
    expect(out.pairs).toEqual([]);
    expect(out.ambiguous).toEqual([
      { stem: 'x', names: ['x_F', 'x_R'] },
      { stem: 'x', names: ['x_1'] },
    ]);
  });

  it('lists the pairs in the order of their earliest read, not of their latest', () => {
    // x spans reads 0 and 3, y reads 1 and 2: by the lower index x comes first.
    expect(named('x_F', 'y_F', 'y_R', 'x_R')).toEqual([
      { first: 0, second: 3, stem: 'x' },
      { first: 1, second: 2, stem: 'y' },
    ]);
    expect(named('x_R', 'y_R', 'y_F', 'x_F').map((p) => p.stem)).toEqual(['x', 'y']);
  });
});

describe('judgePair: a contig the placements do not fit', () => {
  // The placements are taken as given, so that the distance round the ends can
  // come out as nothing or less, which a real contig never does.
  it('does not say a pair spans the ends at a distance of nothing', () => {
    // length 10 - fwd.start 20 + rev.end 10 = 0, which the insert (50) allows.
    const j = judgePair(at('forward', 20, 30), at('reverse', 5, 10), 10, 50);
    expect(j).toEqual({ verdict: 'facing-away', template: null });
  });

  it('does not say a pair spans the ends at a negative distance', () => {
    // 10 - 30 + 10 = -10: within 100 of an insert of 50.
    const j = judgePair(at('forward', 30, 40), at('reverse', 5, 10), 10, 50);
    expect(j).toEqual({ verdict: 'facing-away', template: null });
  });

  it('says it spans the ends at one base', () => {
    const j = judgePair(at('forward', 20, 30), at('reverse', 5, 11), 10, 50);
    expect(j).toEqual({ verdict: 'spans-ends', template: 1 });
  });
});

describe('checkPairs: sorts and the median', () => {
  const contig = (length: number, reads: Placed[]) => ({ consensus: 'A'.repeat(length), reads });
  const pair = (first: number, second: number): ReadPair => ({ first, second, stem: `p${first}` });

  /** Pairs of one forward mate in contig 0 and one reverse mate in contig 1, one per start. */
  const gapsFor = (starts: number[], insert: number | null) => {
    const forward = starts.map((s, i) => at('forward', s, s + 100, 2 * i));
    // The reverse mates end 100 into contig 1: bPart = 100, aPart = 1000 - start.
    const reverse = starts.map((_, i) => at('reverse', 0, 100, 2 * i + 1));
    const report = checkPairs(
      [contig(1000, forward), contig(1000, reverse)],
      starts.map((_, i) => pair(2 * i, 2 * i + 1)),
      insert,
    );
    return report.links.map((l) => [l.pairs, l.gap]);
  };

  it('takes the middle gap of an odd number of pairs, however they come', () => {
    // gap = 2000 - (1000 - start) - 100 = 900 + start: 1200, 1000, 1100.
    expect(gapsFor([300, 100, 200], 2000)).toEqual([[3, 1100]]);
    expect(gapsFor([100, 200, 300], 2000)).toEqual([[3, 1100]]);
    expect(gapsFor([200], 2000)).toEqual([[1, 1100]]);
  });

  it('takes the mean of the two middle gaps of an even number, however they come', () => {
    // 1300, 1000, 1200, 1100 sort to 1000, 1100, 1200, 1300.
    expect(gapsFor([400, 100, 300, 200], 2000)).toEqual([[4, 1150]]);
    expect(gapsFor([100, 200, 300, 400], 2000)).toEqual([[4, 1150]]);
    expect(gapsFor([300, 100], 2000)).toEqual([[2, 1100]]);
  });

  it('rounds a gap that is half a base', () => {
    // 1001 and 1100: 1050.5.
    expect(gapsFor([101, 200], 2000)).toEqual([[2, 1051]]);
  });

  it('has no gap with no insert size', () => {
    expect(gapsFor([100, 200], null)).toEqual([[2, null]]);
  });

  it('lists the links by pairs, then by the contig they start in, then by the one they end in', () => {
    // Four contigs; every pair is a forward mate in the first contig named and a reverse mate in
    // the second. Seen in this order: 2>3, 1>3, 0>3 (twice), 1>2.
    const route: [number, number][] = [
      [2, 3],
      [1, 3],
      [0, 3],
      [0, 3],
      [1, 2],
    ];
    const reads: Placed[][] = [[], [], [], []];
    const pairs = route.map(([a, b], k) => {
      reads[a]?.push(at('forward', 100, 200, 2 * k));
      reads[b]?.push(at('reverse', 100, 200, 2 * k + 1));
      return pair(2 * k, 2 * k + 1);
    });
    const report = checkPairs(
      reads.map((r) => contig(1000, r)),
      pairs,
      null,
    );
    expect(report.links.map((l) => [l.from.contig, l.to.contig, l.pairs])).toEqual([
      [0, 3, 2],
      [1, 2, 1],
      [1, 3, 1],
      [2, 3, 1],
    ]);
  });

  it('breaks a tie of pairs and start by the contig the link ends in, both ways round', () => {
    // 0>2 seen before 0>1, and again 1>3 before 1>2: only the third key tells them apart.
    const route: [number, number][] = [
      [0, 2],
      [0, 1],
      [1, 3],
      [1, 2],
    ];
    const reads: Placed[][] = [[], [], [], []];
    const pairs = route.map(([a, b], k) => {
      reads[a]?.push(at('forward', 100, 200, 2 * k));
      reads[b]?.push(at('reverse', 100, 200, 2 * k + 1));
      return pair(2 * k, 2 * k + 1);
    });
    const report = checkPairs(
      reads.map((r) => contig(1000, r)),
      pairs,
      null,
    );
    expect(report.links.map((l) => [l.from.contig, l.to.contig])).toEqual([
      [0, 1],
      [0, 2],
      [1, 2],
      [1, 3],
    ]);
  });

  it('gives a link one spelling when its contigs are numbered the other way round', () => {
    // The first mate is in contig 2, the second in contig 1: written from 1, turned over.
    const report = checkPairs(
      [
        contig(500, []),
        contig(500, [at('reverse', 100, 200, 1)]),
        contig(500, [at('forward', 100, 200, 0)]),
      ],
      [pair(0, 1)],
      null,
    );
    expect(report.links).toEqual([
      {
        from: { contig: 1, reversed: true },
        to: { contig: 2, reversed: true },
        pairs: 1,
        gap: null,
      },
    ]);
  });

  it('calls a pair unplaced when only its first mate is missing', () => {
    const report = checkPairs([contig(500, [at('reverse', 100, 200, 1)])], [pair(0, 1)], 300);
    expect(report.checks).toEqual([
      { pair: pair(0, 1), state: 'unplaced', contig: null, template: null },
    ]);
    expect(report.links).toEqual([]);
  });

  it('lists the distances of consistent pairs only, shortest first', () => {
    // Insert 300 (tolerance 100) in a contig of 3000. Pairs, in this order: consistent 350,
    // too short, consistent 250, same strand, too long, consistent 300, facing away, and one
    // that spans the ends (400), which has a distance too but is not a distance of the insert.
    const reads = [
      at('forward', 0, 100, 0),
      at('reverse', 250, 350, 1),
      at('forward', 400, 500, 2),
      at('reverse', 450, 500, 3),
      at('forward', 600, 700, 4),
      at('reverse', 800, 850, 5),
      at('forward', 900, 1000, 6),
      at('forward', 1000, 1100, 7),
      at('forward', 1200, 1300, 8),
      at('reverse', 1800, 1900, 9),
      at('forward', 1500, 1600, 10),
      at('reverse', 1700, 1800, 11),
      at('forward', 2500, 2600, 12),
      at('reverse', 100, 200, 13),
      at('forward', 2800, 2900, 14),
      at('reverse', 100, 200, 15),
    ];
    const pairs = [0, 2, 4, 6, 8, 10, 12, 14].map((i) => pair(i, i + 1));
    const report = checkPairs([contig(3000, reads)], pairs, 300);
    expect(report.checks.map((c) => [c.state, c.template])).toEqual([
      ['consistent', 350],
      ['too-short', 100],
      ['consistent', 250],
      ['same-strand', null],
      ['too-long', 700],
      ['consistent', 300],
      ['facing-away', null],
      ['spans-ends', 400],
    ]);
    expect(report.templates).toEqual([250, 300, 350]);
  });
});
