import { expectWithin, itTimed } from '@/test/timing';
import {
  AGAROSE_PERCENTAGES,
  DEFAULT_GEL,
  bandIntensities,
  bestPairs,
  bestPartners,
  bandLabel,
  bandProblems,
  chooseLadder,
  compareCheck,
  compareDiagnostic,
  describeBands,
  digestProfile,
  gelForAgarose,
  gelProfile,
  laneContrast,
  migration,
} from './gel';

describe('gelProfile', () => {
  it('reads two well-separated fragments as two bands', () => {
    const p = gelProfile([4000, 361]);
    expect(p.bands.map((b) => b.length)).toEqual([4000, 361]);
    expect(p.separation).toBeCloseTo(4000 / 361);
    expect(p.readable).toBe(true);
    expect(bandProblems(p)).toEqual([]);
  });

  it('runs near-equal fragments together as one band', () => {
    const p = gelProfile([2181, 2180]);
    expect(p.bands).toHaveLength(1);
    expect(p.bands[0]?.fragments).toEqual([2181, 2180]);
    expect(p.comigrating).toBe(2);
    expect(p.readable).toBe(false);
    expect(bandProblems(p).join(' ')).toMatch(/run together/);
    // One band has no pair to tell apart.
    expect(p.separation).toBe(Infinity);
  });

  it('chains a smear of near-equal fragments into one band', () => {
    // Each is within 15 % of its neighbour, so nothing resolves, even
    // though the ends of the run differ by a third.
    const p = gelProfile([1000, 900, 810, 730]);
    expect(p.bands).toHaveLength(1);
    expect(p.comigrating).toBe(4);
  });

  it('counts fragments too short to see and too long to resolve', () => {
    const p = gelProfile([14000, 12000, 3000, 40]);
    expect(p.tooSmall).toBe(1);
    expect(p.tooLarge).toBe(2);
    expect(p.readable).toBe(false);
    const said = bandProblems(p).join(' ');
    expect(said).toMatch(/under 100 bp/);
    expect(said).toMatch(/over 10,000 bp/);
  });

  it('calls a linearised plasmid uninformative but not misleading', () => {
    const p = gelProfile([4361]);
    expect(p.readable).toBe(false);
    // Nothing is hidden: there is one piece and it is the whole molecule.
    expect(p.misleading).toBe(false);
    expect(bandProblems(p)).toEqual(['one band, so there is nothing to tell apart']);
  });

  it('counts a lane full of shared bands instead of listing them', () => {
    const many = gelProfile([3000, 2000, 1950, 1000, 980, 500, 495, 490]);
    expect(many.misleading).toBe(true);
    expect(bandProblems(many)[0]).toBe('7 fragments run together under 3 bands');
    // A single pair is still named, since that is the useful case.
    expect(bandProblems(gelProfile([3000, 2000, 1950]))[0]).toBe('2,000 and 1,950 run together');
  });

  it('takes the gel it is run on from the options', () => {
    // A finer gel resolves what the default calls one band.
    expect(gelProfile([1100, 1000]).bands).toHaveLength(1);
    expect(gelProfile([1100, 1000], { resolution: 1.05 }).bands).toHaveLength(2);
    expect(gelProfile([60], { minVisible: 50 }).tooSmall).toBe(0);
  });

  it('measures the tightest pair, not the widest', () => {
    const p = gelProfile([5000, 2000, 1500]);
    expect(p.separation).toBeCloseTo(2000 / 1500);
  });
});

describe('digestProfile', () => {
  it('cuts a circular molecule at the given positions', () => {
    const p = digestProfile([100, 1100], 4361, 'circular');
    expect(p.fragments).toEqual([3361, 1000]);
    expect(p.readable).toBe(true);
  });

  it('gives a single cut on a plasmid one full-length band', () => {
    const p = digestProfile([100], 4361, 'circular');
    expect(p.fragments).toEqual([4361]);
    expect(p.readable).toBe(false);
    expect(bandProblems(p)[0]).toMatch(/nothing to tell apart/);
  });
});

describe('compareDiagnostic', () => {
  const sorted = (lists: readonly (readonly number[])[]): number[][] =>
    lists
      .map((l) => gelProfile(l))
      .sort(compareDiagnostic)
      .map((p) => [...p.fragments]);

  it('puts a gel that can be read first, then the widest bands', () => {
    expect(
      sorted([
        [2181, 2180], // one band
        [2500, 1861], // readable, 1.34x
        [4000, 361], // readable, 11x
        [4361], // linearised
      ]),
    ).toEqual([[4000, 361], [2500, 1861], [4361], [2181, 2180]]);
  });

  it('counts separation only up to plenty, then prefers the brighter lane', () => {
    // Both are far enough apart to read at a glance; the second has a band
    // a thirtieth as bright as its neighbour, which is the one people miss.
    expect(
      sorted([
        [4259, 102],
        [3254, 1107],
      ]),
    ).toEqual([
      [3254, 1107],
      [4259, 102],
    ]);
    // Past bright enough, the wider separation still wins the tie.
    expect(
      sorted([
        [3115, 1246],
        [3254, 1107],
      ]),
    ).toEqual([
      [3254, 1107],
      [3115, 1246],
    ]);
    // And separation under plenty still outranks brightness.
    expect(
      sorted([
        [2768, 1593],
        [3948, 413],
      ]),
    ).toEqual([
      [3948, 413],
      [2768, 1593],
    ]);
  });

  it('prefers fewer bands when the separation is the same', () => {
    const three = gelProfile([4000, 2000, 1000]);
    const two = gelProfile([4000, 2000]);
    expect(compareDiagnostic(two, three)).toBeLessThan(0);
  });
});

describe('laneContrast', () => {
  it('is the widest gap between a band of one lane and the nearest of the other', () => {
    // The 3,000 bands run together; the 1,000 has the 400 as its nearest.
    const c = laneContrast(gelProfile([3000, 1000]), gelProfile([3000, 400]));
    expect(c.contrast).toBeCloseTo(2.5);
    expect(c.band).toBe(1000);
  });

  it('sees no difference between lanes whose bands sit together', () => {
    expect(laneContrast(gelProfile([4000, 1000]), gelProfile([4000, 1000])).contrast).toBe(1);
  });

  it('ignores bands off the gel and compares bands at the well as one', () => {
    // A 60 bp band is off the bottom, and 12 and 15 kb both sit at the well.
    expect(laneContrast(gelProfile([12_000, 60]), gelProfile([15_000])).contrast).toBe(1);
  });

  it('tells nothing apart when a lane has no band', () => {
    expect(laneContrast(gelProfile([3000]), gelProfile([])).contrast).toBe(1);
  });
});

describe('compareCheck', () => {
  const check = (product: number[], empty: number[]) => ({
    product: gelProfile(product),
    empty: gelProfile(empty),
  });

  it('puts an enzyme that tells the product from the empty vector first', () => {
    // A clear product lane that the empty vector gives too, against a
    // plainer one that differs.
    const same = check([4000, 1500], [4000, 1500]);
    const differs = check([5500], [4000]);
    expect(compareCheck(differs, same)).toBeLessThan(0);
  });

  it('counts the difference up to plenty, then prefers the brighter band', () => {
    const wide = check([4000, 1500], [4000, 600]);
    const narrow = check([4000, 1500], [4000, 1200]);
    expect(compareCheck(wide, narrow)).toBeLessThan(0);
    // Both differ plenty; the one whose differing band is a sliver loses.
    const sliver = check([4000, 150], [4000]);
    const bright = check([4000, 1500], [4000]);
    expect(compareCheck(bright, sliver)).toBeLessThan(0);
  });

  it('falls back to the product lane when the difference is the same', () => {
    const readable = check([3000, 1000], [3000, 400]);
    const oneBand = check([1000], [400]);
    expect(compareCheck(readable, oneBand)).toBeLessThan(0);
  });
});

describe('describeBands', () => {
  it('writes the sizes a gel would show', () => {
    expect(describeBands(gelProfile([3224, 1137]))).toBe('3,224 + 1,137 bp');
    expect(describeBands(gelProfile([2181, 2180]))).toBe('2,181 ×2 bp');
    expect(describeBands(gelProfile([900, 700, 500, 300, 100]), 2)).toBe('900 + 700 + 3 more bp');
  });
});

describe('bestPairs', () => {
  it('puts the double digest with the bands furthest apart first', () => {
    // A 4,000 bp plasmid. A and B together cut out 500 bp, B and C 1,400;
    // A and C cut it into 1,900 and 2,100, which run together.
    const pairs = bestPairs(
      [
        { name: 'A', cuts: [100] },
        { name: 'B', cuts: [600] },
        { name: 'C', cuts: [2000] },
      ],
      4000,
      'circular',
    );
    expect(pairs.map((p) => `${p.first}+${p.second}`)).toEqual(['A+B', 'B+C']);
    expect(pairs[0]?.profile.fragments).toEqual([3500, 500]);
  });

  it('leaves out a pair that is no different from one enzyme alone', () => {
    // B cuts everywhere A does, so A+B is B's own digest.
    const pairs = bestPairs(
      [
        { name: 'A', cuts: [100] },
        { name: 'B', cuts: [100, 1500] },
      ],
      4000,
      'circular',
    );
    expect(pairs).toEqual([]);
  });

  it('stops at the limit, keeping the order of the candidates on a tie', () => {
    // Four enzymes cutting at the quarter points: every adjacent pair gives
    // 1,000 + 3,000, every opposite one 2,000 ×2 and so is left out.
    const pairs = bestPairs(
      ['A', 'B', 'C', 'D'].map((name, i) => ({ name, cuts: [i * 1000] })),
      4000,
      'circular',
      3,
    );
    expect(pairs.map((p) => `${p.first}+${p.second}`)).toEqual(['A+B', 'A+D', 'B+C']);
  });

  it('reads each pair exactly as a digest with both would', () => {
    // The pairs are cut without building fragments; check that against the
    // digest itself, on both topologies and with cuts at the ends.
    const candidates = [
      { name: 'A', cuts: [0, 700] },
      { name: 'B', cuts: [3000, 4000] },
      { name: 'C', cuts: [1500, 700] },
      { name: 'D', cuts: [2200] },
    ];
    for (const topology of ['circular', 'linear'] as const) {
      for (const pair of bestPairs(candidates, 4000, topology, 10)) {
        const cuts = [pair.first, pair.second].flatMap(
          (n) => candidates.find((c) => c.name === n)?.cuts ?? [],
        );
        expect(pair.profile).toEqual(digestProfile(cuts, 4000, topology));
      }
    }
  });

  itTimed('ranks the pairs of 120 enzymes, the most the Enzymes tab pairs, inside a frame', () => {
    const candidates = Array.from({ length: 120 }, (_, i) => ({
      name: `E${i}`,
      cuts: Array.from({ length: 1 + (i % 3) }, (_, k) => (i * 97 + k * 1109) % 4361),
    }));
    for (let run = 0; run < 3; run++) bestPairs(candidates, 4361, 'circular');
    const t0 = performance.now();
    for (let run = 0; run < 5; run++) bestPairs(candidates, 4361, 'circular');
    const ms = (performance.now() - t0) / 5;
    expect(bestPairs(candidates, 4361, 'circular')).toHaveLength(5);
    expectWithin(ms, 200);
    // eslint-disable-next-line no-console
    console.info(`[perf] best pairs of 120 enzymes (7,140 pairs): ${ms.toFixed(1)} ms`);
  });
});

describe('bestPartners', () => {
  const candidates = [
    { name: 'A', cuts: [100] },
    { name: 'B', cuts: [600] },
    { name: 'C', cuts: [2000] },
    { name: 'D', cuts: [2600] },
  ];

  it('pairs the anchor with every other enzyme, best first, the anchor named first', () => {
    // On 4,000 bp: A+B 3,500 + 500; A+D 2,500 + 1,500; A+C runs together.
    const pairs = bestPartners({ name: 'A', cuts: [100] }, candidates, 4000, 'circular');
    expect(pairs.map((p) => `${p.first}+${p.second}`)).toEqual(['A+B', 'A+D']);
  });

  it('agrees with bestPairs about the pairs it shares', () => {
    const all = bestPairs(candidates, 4000, 'linear', 20);
    for (const pair of bestPartners({ name: 'C', cuts: [2000] }, candidates, 4000, 'linear', 20)) {
      const same = all.find(
        (p) =>
          (p.first === pair.first && p.second === pair.second) ||
          (p.first === pair.second && p.second === pair.first),
      );
      expect(same?.profile).toEqual(pair.profile);
    }
  });

  itTimed('looks through a whole imported table in well under a frame', () => {
    const table = Array.from({ length: 1500 }, (_, i) => ({
      name: `E${i}`,
      cuts: Array.from({ length: 1 + (i % 3) }, (_, k) => (i * 97 + k * 1109) % 4361),
    }));
    const t0 = performance.now();
    const pairs = bestPartners({ name: 'X', cuts: [1234] }, table, 4361, 'circular');
    const ms = performance.now() - t0;
    expect(pairs).toHaveLength(5);
    expectWithin(ms, 50);
  });
});

describe('gel profile performance', () => {
  itTimed('profiles a REBASE-sized table inside a frame', () => {
    // The Enzymes tab profiles every enzyme, not only the rows on screen,
    // because the list can be ordered by the bands. The shape of the work
    // is a full REBASE scan of a plasmid: 1,581 enzymes and 63,053 cut
    // sites between them, so about 40 cuts each.
    const enzymes = Array.from({ length: 1581 }, (_, i) =>
      Array.from({ length: 40 }, (_, k) => (i * 97 + k * 109) % 4361),
    );
    const t0 = performance.now();
    let bands = 0;
    for (let run = 0; run < 5; run++) {
      for (const cuts of enzymes) bands += digestProfile(cuts, 4361, 'circular').bands.length;
    }
    const ms = (performance.now() - t0) / 5;
    expect(bands).toBeGreaterThan(0);
    expectWithin(ms, 500);
    // eslint-disable-next-line no-console
    console.info(`[perf] gel profiles for 1,581 enzymes: ${ms.toFixed(1)} ms`);
  });
});

describe('the picture of a gel', () => {
  it('runs a short fragment further down the lane than a long one', () => {
    expect(migration(10_000)).toBe(0);
    expect(migration(50)).toBe(1);
    const order = [8000, 4000, 2000, 1000, 500, 200].map((n) => migration(n));
    expect(order).toEqual([...order].sort((a, b) => a - b));
    // Log spacing: halving the length moves the same distance each time,
    // which is why a gel resolves 500 from 250 and not 8,000 from 7,750.
    expect(migration(2000) - migration(4000)).toBeCloseTo(migration(1000) - migration(2000), 6);
  });

  it('pins anything off the ends of the gel to the ends', () => {
    expect(migration(50_000)).toBe(0);
    expect(migration(10)).toBe(1);
    // The same two numbers the warnings use, so the drawing cannot say a
    // band is on the gel while the text says it ran off.
    expect(migration(20_000, { maxResolved: 20_000 })).toBe(0);
  });

  it('picks the ladder that spans what is being run', () => {
    expect(chooseLadder([4361, 1200]).name).toBe('1 kb');
    expect(chooseLadder([1200, 300]).name).toBe('100 bp');
    expect(chooseLadder([]).name).toBe('100 bp');
  });

  it('draws the ladder asked for, whatever is being run', () => {
    expect(chooseLadder([1200, 300], '1 kb').name).toBe('1 kb');
    expect(chooseLadder([4361], '100 bp').name).toBe('100 bp');
    expect(chooseLadder([4361], '1 kb Plus').bands).toContain(1200);
  });

  describe('agarose percentage', () => {
    it('is the default gel at 1 %', () => {
      expect(gelForAgarose(1)).toEqual(DEFAULT_GEL);
    });

    it('moves the range the gel resolves', () => {
      for (let i = 1; i < AGAROSE_PERCENTAGES.length; i++) {
        const thinner = gelForAgarose(AGAROSE_PERCENTAGES[i - 1] ?? 1);
        const thicker = gelForAgarose(AGAROSE_PERCENTAGES[i] ?? 1);
        expect(thicker.maxResolved).toBeLessThan(thinner.maxResolved);
        expect(thicker.minVisible).toBeLessThan(thinner.minVisible);
      }
    });

    it('reads a digest with a small piece on a 2 % gel, and a large pair on 0.7 %', () => {
      // 1,800 + 80 bp: the 80 runs off a 1 % gel and stays on a 2 % one.
      expect(gelProfile([1800, 80]).readable).toBe(false);
      expect(gelProfile([1800, 80], gelForAgarose(2)).readable).toBe(true);
      // 11 + 6 kb compress at the top of a 1 % gel, not of a 0.7 % one.
      expect(gelProfile([11_000, 10_500, 6000]).tooLarge).toBe(2);
      expect(gelProfile([11_000, 6000], gelForAgarose(0.7)).tooLarge).toBe(0);
      // And the drawing agrees: 80 bp is at the dye front of a 1 % gel only.
      expect(migration(80)).toBeGreaterThan(migration(80, gelForAgarose(2)));
    });
  });

  it('stains by mass, so a short band is faint', () => {
    const [big, small] = bandIntensities(gelProfile([4000, 200]).bands);
    expect(big).toBe(1);
    expect(small).toBeLessThan(0.5);
    expect(small).toBeGreaterThan(0.1);
    // Two fragments under one band stain as both of them.
    const [one, two] = bandIntensities(gelProfile([1000, 500, 500]).bands);
    expect(one).toBe(1);
    expect(two).toBeCloseTo(Math.sqrt(1), 6);
  });

  it('labels a shared band with what is under it', () => {
    const bands = gelProfile([2181, 2180, 400]).bands;
    expect(bands.map(bandLabel)).toEqual(['2,181 \u00d72', '400']);
  });
});
