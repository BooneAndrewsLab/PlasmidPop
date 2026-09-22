import { bandProblems, compareDiagnostic, describeBands, digestProfile, gelProfile } from './gel';

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

  it('prefers fewer bands when the separation is the same', () => {
    const three = gelProfile([4000, 2000, 1000]);
    const two = gelProfile([4000, 2000]);
    expect(compareDiagnostic(two, three)).toBeLessThan(0);
  });
});

describe('describeBands', () => {
  it('writes the sizes a gel would show', () => {
    expect(describeBands(gelProfile([3224, 1137]))).toBe('3,224 + 1,137 bp');
    expect(describeBands(gelProfile([2181, 2180]))).toBe('2,181 ×2 bp');
    expect(describeBands(gelProfile([900, 700, 500, 300, 100]), 2)).toBe('900 + 700 + 3 more bp');
  });
});

describe('gel profile performance', () => {
  it('profiles a REBASE-sized table inside a frame', () => {
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
    expect(ms).toBeLessThan(500);
    // eslint-disable-next-line no-console
    console.info(`[perf] gel profiles for 1,581 enzymes: ${ms.toFixed(1)} ms`);
  });
});
