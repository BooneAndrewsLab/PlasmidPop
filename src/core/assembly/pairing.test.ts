import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
  type Placed,
  type ReadPair,
  checkPairs,
  findReadPairs,
  insertTolerance,
  judgePair,
} from './pairing';

const named = (...names: string[]): ReadPair[] => [...findReadPairs(names).pairs];

describe('findReadPairs: pairs by name', () => {
  it.each([
    ['clone_F', 'clone_R'],
    ['clone.F', 'clone.R'],
    ['clone-F', 'clone-R'],
    ['clone F', 'clone R'],
    ['clone_fwd', 'clone_rev'],
    ['clone_for', 'clone_rev'],
    ['clone_forward', 'clone_reverse'],
    ['clone_FP', 'clone_RP'],
    ['clone_1', 'clone_2'],
    ['clone/1', 'clone/2'],
    ['clone.1', 'clone.2'],
    ['clone_M13F', 'clone_M13R'],
    ['clone5F', 'clone5R'],
    ['clone_f', 'clone_r'],
    ['clone_F.ab1', 'clone_R.ab1'],
    ['clone_F.fastq.gz', 'clone_R.fastq.gz'],
    ['A01_pUC19_Fwd', 'A01_pUC19_Rev'],
    ['NAME 1:N:0:ACGT', 'NAME 2:N:0:ACGT'],
  ])('%s and %s', (a, b) => {
    const out = findReadPairs([a, b]);
    expect(out.pairs).toHaveLength(1);
    expect(out.pairs[0]).toMatchObject({ first: 0, second: 1 });
    expect(out.ambiguous).toEqual([]);
  });

  it('puts the forward-named mate first whichever comes first in the list', () => {
    expect(named('x_R', 'y_F', 'x_F', 'y_R')).toEqual([
      { first: 2, second: 0, stem: 'x' },
      { first: 1, second: 3, stem: 'y' },
    ]);
  });

  it('is case-insensitive and keeps the stem as written', () => {
    expect(named('Sample7_f', 'Sample7_R')).toEqual([{ first: 0, second: 1, stem: 'Sample7' }]);
  });

  it('finds nothing in names with no mate token, or a token on one read only', () => {
    expect(findReadPairs(['alpha', 'beta', 'gamma'])).toEqual({ pairs: [], ambiguous: [] });
    expect(findReadPairs(['clone_F', 'other_R'])).toEqual({ pairs: [], ambiguous: [] });
    expect(findReadPairs(['clone_F', 'clone'])).toEqual({ pairs: [], ambiguous: [] });
    expect(findReadPairs([])).toEqual({ pairs: [], ambiguous: [] });
    expect(findReadPairs([''])).toEqual({ pairs: [], ambiguous: [] });
  });

  it('does not read a trailing letter of an ordinary word as a mate', () => {
    // "BAR" and "CHAIR" end in R, "WOLF" in F; joined to a letter, not a digit or a separator.
    expect(findReadPairs(['WOLF', 'BAR', 'CHAIR', 'SHELF', 'STAR'])).toEqual({
      pairs: [],
      ambiguous: [],
    });
    expect(findReadPairs(['SHELF', 'SHELR'])).toEqual({ pairs: [], ambiguous: [] });
  });

  it('does not pair names whose rest differs', () => {
    expect(findReadPairs(['clone1_F', 'clone2_R']).pairs).toEqual([]);
    expect(findReadPairs(['clone_M13F', 'clone_T7R']).pairs).toEqual([]);
  });

  it('does not mix letters and numbers: F is not the mate of 2', () => {
    const out = findReadPairs(['clone_F', 'clone_2']);
    expect(out.pairs).toEqual([]);
    expect(out.ambiguous.map((a) => a.names).flat()).toEqual(['clone_F', 'clone_2']);
  });

  it('leaves ambiguous names unpaired and says which', () => {
    const three = findReadPairs(['c_F', 'c_R', 'c_F2'.replace('F2', 'F')]);
    expect(three.pairs).toEqual([]);
    expect(three.ambiguous).toHaveLength(1);
    expect(three.ambiguous[0]?.names).toEqual(['c_F', 'c_R', 'c_F']);
    const twoForward = findReadPairs(['c_F', 'c_fwd']);
    expect(twoForward.pairs).toEqual([]);
    expect(twoForward.ambiguous[0]?.names).toEqual(['c_F', 'c_fwd']);
    // Numbered clones are not mates when the numbers go past 2.
    const clones = findReadPairs(['clone_1', 'clone_2', 'clone_3']);
    expect(clones.pairs).toEqual([]);
    expect(clones.ambiguous).toHaveLength(1);
    expect(clones.ambiguous[0]?.names).toEqual(['clone_1', 'clone_2', 'clone_3']);
  });

  it('still pairs the unambiguous stems beside an ambiguous one', () => {
    const out = findReadPairs(['a_F', 'a_F', 'b_F', 'b_R']);
    expect(out.pairs).toEqual([{ first: 2, second: 3, stem: 'b' }]);
    expect(out.ambiguous).toHaveLength(1);
  });

  it('property: every stem with one forward and one reverse mate pairs, in any order', () => {
    const stems = fc.uniqueArray(fc.stringMatching(/^[a-z]{3,8}$/), { minLength: 1, maxLength: 6 });
    const style = fc.constantFrom(
      ['_F', '_R'],
      ['.fwd', '.rev'],
      ['-1', '-2'],
      ['_forward', '_reverse'],
    );
    fc.assert(
      fc.property(stems, style, fc.integer(), (ss, [f = '', r = ''], seed) => {
        const reads = ss.flatMap((s, i) => [
          { name: s + f, key: i, first: true },
          { name: s + r, key: i, first: false },
        ]);
        // A deterministic shuffle.
        const order = reads
          .map((x, i) => ({ x, k: Math.imul(i + 1, 2654435761 + (seed | 1)) >>> 0 }))
          .sort((a, b) => a.k - b.k)
          .map((o) => o.x);
        const out = findReadPairs(order.map((o) => o.name));
        expect(out.pairs).toHaveLength(ss.length);
        for (const p of out.pairs) {
          const a = order[p.first];
          const b = order[p.second];
          expect(a?.first).toBe(true);
          expect(b?.first).toBe(false);
          expect(a?.key).toBe(b?.key);
        }
      }),
      { numRuns: 100 },
    );
  });
});

const at = (strand: 'forward' | 'reverse', start: number, end: number, index = 0): Placed => ({
  index,
  strand,
  start,
  end,
});

describe('judgePair: where two mates lie', () => {
  it('takes the distance between the outer ends, in 0-based half-open bases', () => {
    // A read of bases 1-100 (0..100) and one of bases 201-300 (200..300): a template of 300.
    const j = judgePair(at('forward', 0, 100), at('reverse', 200, 300), 1000, 300);
    expect(j).toEqual({ verdict: 'consistent', template: 300 });
  });

  it('is the same whichever mate is given first', () => {
    const f = at('forward', 50, 250);
    const r = at('reverse', 700, 900);
    expect(judgePair(f, r, 2000, 850)).toEqual(judgePair(r, f, 2000, 850));
  });

  it('accepts any distance with no insert size, but still wants them facing', () => {
    expect(judgePair(at('forward', 0, 10), at('reverse', 5000, 5010), 6000, null).verdict).toBe(
      'consistent',
    );
    expect(judgePair(at('forward', 0, 10), at('forward', 50, 60), 6000, null).verdict).toBe(
      'same-strand',
    );
    expect(judgePair(at('reverse', 0, 10), at('forward', 50, 60), 6000, null).verdict).toBe(
      'facing-away',
    );
  });

  it('has a tolerance of a tenth of the insert, and at least 100 bases', () => {
    expect(insertTolerance(2000)).toBe(200);
    expect(insertTolerance(500)).toBe(100);
    expect(insertTolerance(100)).toBe(100);
    // A template of 1000 bases, against an insert size that is at the edge of what it allows.
    const f = at('forward', 0, 400);
    const r = at('reverse', 600, 1000);
    expect(judgePair(f, r, 5000, 1111).verdict).toBe('consistent'); // 1111 allows 111
    expect(judgePair(f, r, 5000, 1112).verdict).toBe('too-short'); // 1112 allows 111, off by 112
    expect(judgePair(f, r, 5000, 900).verdict).toBe('consistent'); // 900 allows 100
    expect(judgePair(f, r, 5000, 899).verdict).toBe('too-long'); // off by 101
  });

  it('says too short for mates nearer than the insert allows, with the distance', () => {
    const j = judgePair(at('forward', 0, 300), at('reverse', 600, 900), 3000, 2100);
    expect(j).toEqual({ verdict: 'too-short', template: 900 });
  });

  it('says too long for mates farther than the insert allows', () => {
    const j = judgePair(at('forward', 0, 300), at('reverse', 2500, 2800), 3000, 1000);
    expect(j).toEqual({ verdict: 'too-long', template: 2800 });
  });

  it('handles mates that overlap, or one inside the other', () => {
    expect(judgePair(at('forward', 0, 500), at('reverse', 300, 800), 2000, 800).template).toBe(800);
    // A short template read right through: the reverse mate lies inside the forward one.
    expect(judgePair(at('forward', 100, 700), at('reverse', 200, 500), 2000, 600)).toEqual({
      verdict: 'consistent',
      template: 600,
    });
    // Both start at the same base: the forward one is on the left.
    expect(judgePair(at('forward', 0, 300), at('reverse', 0, 400), 2000, 400).verdict).toBe(
      'consistent',
    );
  });

  it('lets a template run off one end of a contig and in at the other (a circle)', () => {
    // 1000 bp contig, forward mate at 800..950, reverse mate at 20..150: 1000-800+150 = 350 round the ends.
    const f = at('forward', 800, 950);
    const r = at('reverse', 20, 150);
    expect(judgePair(f, r, 1000, 350)).toEqual({ verdict: 'spans-ends', template: 350 });
    // A different insert: just facing away.
    expect(judgePair(f, r, 1000, 2000).verdict).toBe('facing-away');
    expect(judgePair(f, r, 1000, null).verdict).toBe('facing-away');
  });

  it('property: mates cut from a template are consistent with its true length, and no other', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 50_000 }),
        fc.integer({ min: 300, max: 8000 }),
        fc.integer({ min: 50, max: 900 }),
        fc.integer({ min: 50, max: 900 }),
        fc.integer({ min: 300, max: 2000 }),
        fc.boolean(),
        (s, t, la, lb, margin, flip) => {
          fc.pre(la <= t && lb <= t);
          // The contig is the template with margins either side; flipped, it is turned over.
          const length = t + 2 * margin;
          const f = { start: margin + s * 0, end: margin + la };
          const r = { start: margin + t - lb, end: margin + t };
          const turn = (p: { start: number; end: number }, strand: 'forward' | 'reverse') =>
            flip
              ? {
                  strand: strand === 'forward' ? 'reverse' : 'forward',
                  start: length - p.end,
                  end: length - p.start,
                }
              : { strand, start: p.start, end: p.end };
          const a = turn(f, 'forward') as Placed;
          const b = turn(r, 'reverse') as Placed;
          expect(judgePair(a, b, length, t)).toEqual({ verdict: 'consistent', template: t });
          // An insert size twice as long, or half as long (more than 10 %, and 100 bases, off).
          expect(judgePair(a, b, length, 2 * t + 300).verdict).toBe('too-short');
          expect(judgePair(a, b, length, Math.floor(t / 2)).verdict).toBe('too-long');
          // Moving the contig along it changes nothing.
          expect(
            judgePair(
              { ...a, start: a.start + 7, end: a.end + 7 },
              { ...b, start: b.start + 7, end: b.end + 7 },
              length + 7,
              t,
            ).verdict,
          ).toBe('consistent');
        },
      ),
      { numRuns: 200 },
    );
  });
});

describe('checkPairs: the pairs against a set of contigs', () => {
  const contig = (length: number, reads: Placed[]) => ({ consensus: 'A'.repeat(length), reads });
  const pair = (first: number, second: number): ReadPair => ({ first, second, stem: `p${first}` });

  it('judges the pairs in one contig and lists the distances that fit', () => {
    const report = checkPairs(
      [contig(2000, [at('forward', 0, 400, 0), at('reverse', 1500, 1900, 1)])],
      [pair(0, 1)],
      null,
    );
    expect(report.checks).toEqual([
      { pair: pair(0, 1), state: 'consistent', contig: 0, template: 1900 },
    ]);
    expect(report.templates).toEqual([1900]);
    expect(report.links).toEqual([]);
    expect(report.insert).toBeNull();
  });

  it('calls a pair with a mate that is in no contig unplaced', () => {
    const report = checkPairs([contig(500, [at('forward', 0, 400, 0)])], [pair(0, 1)], 900);
    expect(report.checks).toEqual([
      { pair: pair(0, 1), state: 'unplaced', contig: null, template: null },
    ]);
  });

  it('links two contigs a pair falls in, in the order the template runs, with a gap', () => {
    // The forward mate reads towards the end of contig 0 (1000 bp, 700 to go from its start);
    // the reverse mate ends 150 into contig 1: gap = 2000 - 700 - 150 = 1150.
    const report = checkPairs(
      [contig(1000, [at('forward', 300, 600, 0)]), contig(900, [at('reverse', 0, 150, 1)])],
      [pair(0, 1)],
      2000,
    );
    expect(report.checks[0]).toMatchObject({ state: 'linked', contig: 0 });
    expect(report.links).toEqual([
      {
        from: { contig: 0, reversed: false },
        to: { contig: 1, reversed: false },
        pairs: 1,
        gap: 1150,
      },
    ]);
  });

  it('turns a contig over when its mate reads the other way, and measures from the right end', () => {
    // Mate 0 is reverse in contig 0: turned over it is forward, 300 bases (its end) from the start,
    // so 300 bases of template lie in contig 0. Mate 1 is forward in contig 1: turned over it
    // reads backwards, with 900 - 700 = 200 bases of contig 1 in the template.
    const report = checkPairs(
      [contig(1000, [at('reverse', 100, 300, 0)]), contig(900, [at('forward', 700, 850, 1)])],
      [pair(0, 1)],
      1000,
    );
    expect(report.links).toEqual([
      {
        from: { contig: 0, reversed: true },
        to: { contig: 1, reversed: true },
        pairs: 1,
        gap: 500,
      },
    ]);
  });

  it('gives a link one spelling whichever mate is the first, and counts the pairs', () => {
    const contigs = [
      contig(1000, [at('forward', 100, 400, 0), at('forward', 200, 500, 2)]),
      contig(1000, [at('reverse', 500, 800, 1), at('reverse', 600, 900, 3)]),
    ];
    // Pair (0,1) has the contig-0 mate first; pair (3,2) the contig-1 mate first.
    const report = checkPairs(contigs, [pair(0, 1), pair(3, 2)], null);
    expect(report.links).toHaveLength(1);
    expect(report.links[0]).toMatchObject({
      from: { contig: 0, reversed: false },
      to: { contig: 1, reversed: false },
      pairs: 2,
      gap: null,
    });
  });

  it('keeps conflicting arrangements apart: pairs that say each contig follows the other', () => {
    const contigs = [
      contig(1000, [at('forward', 100, 400, 0), at('reverse', 500, 800, 2)]),
      contig(1000, [at('reverse', 500, 800, 1), at('forward', 100, 400, 3)]),
    ];
    const report = checkPairs(contigs, [pair(0, 1), pair(3, 2)], 1500);
    expect(report.links).toHaveLength(2);
    expect(report.links.map((l) => l.pairs)).toEqual([1, 1]);
    expect(
      report.links.map((l) => `${String(l.from.reversed)}${String(l.to.reversed)}`).sort(),
    ).toEqual(['falsefalse', 'truetrue']);
  });

  it('reports the median gap of several pairs', () => {
    const contigs = [
      contig(1000, [
        at('forward', 100, 400, 0),
        at('forward', 200, 500, 2),
        at('forward', 300, 600, 4),
      ]),
      contig(1000, [
        at('reverse', 500, 800, 1),
        at('reverse', 500, 800, 3),
        at('reverse', 500, 800, 5),
      ]),
    ];
    const report = checkPairs(contigs, [pair(0, 1), pair(2, 3), pair(4, 5)], 2500);
    // gaps: 2500-900-800=800, 2500-800-800=900, 2500-700-800=1000
    expect(report.links[0]?.gap).toBe(900);
  });

  it('property: swapping which mate is called first never changes the verdict or the link', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 800 }),
        fc.integer({ min: 0, max: 800 }),
        fc.boolean(),
        fc.boolean(),
        fc.boolean(),
        (s1, s2, rev1, rev2, same) => {
          const a = at(rev1 ? 'reverse' : 'forward', s1, s1 + 150, 0);
          const b = at(rev2 ? 'reverse' : 'forward', s2, s2 + 150, 1);
          const contigs = same ? [contig(1000, [a, b])] : [contig(1000, [a]), contig(1000, [b])];
          const x = checkPairs(contigs, [pair(0, 1)], 1200);
          const y = checkPairs(contigs, [pair(1, 0)], 1200);
          expect(x.checks[0]?.state).toBe(y.checks[0]?.state);
          expect(x.links.length).toBe(y.links.length);
          if (x.links.length > 0 && y.links.length > 0) {
            expect(x.links[0]?.gap).toBe(y.links[0]?.gap);
            expect(x.links[0]?.from).toEqual(y.links[0]?.from);
            expect(x.links[0]?.to).toEqual(y.links[0]?.to);
          }
        },
      ),
      { numRuns: 200 },
    );
  });
});
