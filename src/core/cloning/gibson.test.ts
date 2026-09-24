import { SeqDocument, createFeature, rangeSegment, reverseComplement } from '@/core';

import { gibson, terminalOverlap } from './gibson';

/**
 * A pseudo-random but fixed template, so every junction's homology is
 * unique by accident of composition rather than by design.
 */
function template(length: number, seed = 12345): string {
  let x = seed;
  let out = '';
  for (let i = 0; i < length; i++) {
    x = (x * 1103515245 + 12345) & 0x7fffffff;
    out += 'ACGT'.charAt((x >> 16) & 3);
  }
  return out;
}

const PLASMID = template(3000);

/**
 * Cuts a circular sequence into `n` pieces, each carrying `overlap` bases of
 * the next one at its 3′ end — which is what a designer does with primer
 * tails. The pieces reassemble into the original circle.
 */
function pieces(sequence: string, cuts: readonly number[], overlap: number): SeqDocument[] {
  const n = sequence.length;
  return cuts.map((start, i) => {
    const next = cuts[(i + 1) % cuts.length] ?? start;
    // A single cut wraps the whole way round, so the one piece is the circle
    // opened up with its own start repeated at its end.
    const end = (next > start ? next : next + n) + overlap;
    let text = '';
    for (let p = start; p < end; p++) text += sequence.charAt(p % n);
    return SeqDocument.create({ name: `part${i + 1}`, sequence: text });
  });
}

/**
 * The same for a linear sequence: the first part starts at its start and the
 * last ends at its end, so the chain has two loose ends and no homology
 * closes it.
 */
function linearPieces(sequence: string, cuts: readonly number[], overlap: number): SeqDocument[] {
  return cuts.map((start, i) => {
    const next = cuts[i + 1];
    const end = next === undefined ? sequence.length : next + overlap;
    return SeqDocument.create({ name: `part${i + 1}`, sequence: sequence.slice(start, end) });
  });
}

describe('terminalOverlap', () => {
  it('finds the longest shared end, within the bounds', () => {
    expect(terminalOverlap('AAAACCCGGGTTT', 'GGGTTTAAAA', 3, 60)).toBe(6);
    expect(terminalOverlap('AAAACCCGGGTTT', 'GGGTTTAAAA', 8, 60)).toBe(0);
    // Capped, not refused: a longer shared end is reported at the cap.
    expect(terminalOverlap('ACGTACGT', 'ACGTACGT', 2, 4)).toBe(4);
    expect(terminalOverlap('ACGT', 'TTTT', 2, 60)).toBe(0);
    // Case is not a difference between two pieces of DNA.
    expect(terminalOverlap('aaaaGGGttt', 'TTTaaaa', 3, 60)).toBe(3);
  });
});

describe('gibson', () => {
  it('puts a plasmid back together from three overlapping pieces', () => {
    const parts = pieces(PLASMID, [0, 1000, 2000], 25);
    const result = gibson(parts);
    expect(result.problem).toBeNull();
    const assembly = result.assembly;
    if (assembly === null) throw new Error('no assembly');
    expect(assembly.order.map((p) => p.document.name)).toEqual(['part1', 'part2', 'part3']);
    expect(assembly.joins.map((j) => j.length)).toEqual([25, 25, 25]);
    // Seamless: each overlap is in the product once, so it is the original.
    expect(assembly.product.sequence.toString()).toBe(PLASMID);
    expect(assembly.product.isCircular).toBe(true);
    expect(assembly.product.length).toBe(PLASMID.length);
  });

  it('does not care what order the parts are given in', () => {
    const [a, b, c] = pieces(PLASMID, [0, 1000, 2000], 25);
    if (a === undefined || b === undefined || c === undefined) throw new Error('parts');
    const assembly = gibson([b, c, a]).assembly;
    if (assembly === null) throw new Error('no assembly');
    // The circle is the same molecule read from another origin: part2 first.
    expect(assembly.order.map((p) => p.document.name)).toEqual(['part2', 'part3', 'part1']);
    expect(assembly.product.length).toBe(PLASMID.length);
  });

  it('turns a part around when that is how it fits', () => {
    const [a, b, c] = pieces(PLASMID, [0, 1000, 2000], 25);
    if (a === undefined || b === undefined || c === undefined) throw new Error('parts');
    const flipped = SeqDocument.create({
      name: 'part2',
      sequence: reverseComplement(b.sequence.toString()),
    });
    const result = gibson([a, flipped, c]);
    const assembly = result.assembly;
    if (assembly === null) throw new Error(result.problem ?? 'no assembly');
    expect(assembly.order.map((p) => p.flipped)).toEqual([false, true, false]);
    expect(assembly.product.sequence.toString()).toBe(PLASMID);
  });

  it('carries the features of every part into the product', () => {
    const [a, b, c] = pieces(PLASMID, [0, 1000, 2000], 25);
    if (a === undefined || b === undefined || c === undefined) throw new Error('parts');
    const marked = SeqDocument.create({
      name: 'part2',
      sequence: b.sequence.toString(),
      features: [createFeature({ type: 'CDS', name: 'gfp', segments: [rangeSegment(100, 400)] })],
    });
    const assembly = gibson([a, marked, c]).assembly;
    if (assembly === null) throw new Error('no assembly');
    const gfp = assembly.product.features.all().find((f) => f.name === 'gfp');
    expect(gfp).toBeDefined();
    // part1 keeps its whole length (1,025) and part2 gives up the 25 bases
    // it shares with it, so the feature lands 25 bases earlier.
    expect(gfp?.segments[0]).toMatchObject({ start: 1000 + 100, end: 1000 + 400 });
  });

  it('assembles a linear product from the part in the middle', () => {
    // Given part2 first, a linear assembly has to walk backwards to part1 as
    // well as forwards to part3; only a circle can be followed one way.
    const [a, b, c] = linearPieces(PLASMID, [0, 1000, 2000], 25);
    if (a === undefined || b === undefined || c === undefined) throw new Error('parts');
    const result = gibson([b, c, a], { circular: false });
    const assembly = result.assembly;
    if (assembly === null) throw new Error(result.problem ?? 'no assembly');
    expect(assembly.order.map((p) => p.document.name)).toEqual(['part1', 'part2', 'part3']);
    expect(assembly.product.isCircular).toBe(false);
    expect(assembly.product.sequence.toString()).toBe(PLASMID);
  });

  it('closes one part on itself when its own ends share homology', () => {
    const [only] = pieces(PLASMID, [0], 25);
    if (only === undefined) throw new Error('parts');
    expect(only.length).toBe(PLASMID.length + 25);
    const assembly = gibson([only]).assembly;
    if (assembly === null) throw new Error('no assembly');
    expect(assembly.joins).toHaveLength(1);
    expect(assembly.product.sequence.toString()).toBe(PLASMID);
  });

  it('refuses when the parts do not close into a circle', () => {
    const [a, b] = pieces(PLASMID, [0, 1000, 2000], 25);
    if (a === undefined || b === undefined) throw new Error('parts');
    const result = gibson([a, b]);
    expect(result.assembly).toBeNull();
    expect(result.problem).toMatch(/do not close into a circle/);
  });

  it('refuses rather than guess when two parts could follow the same one', () => {
    const [a, b, c] = pieces(PLASMID, [0, 1000, 2000], 25);
    if (a === undefined || b === undefined || c === undefined) throw new Error('parts');
    const twin = SeqDocument.create({ name: 'part2 copy', sequence: b.sequence.toString() });
    const result = gibson([a, b, twin, c]);
    expect(result.assembly).toBeNull();
    expect(result.problem).toMatch(/ambiguous/);
    expect(result.problem).toMatch(/part2 and part2 copy|part2 copy and part2/);
  });

  it('says which part has nothing to join to', () => {
    const [a, b, c] = pieces(PLASMID, [0, 1000, 2000], 25);
    if (a === undefined || b === undefined || c === undefined) throw new Error('parts');
    const stranger = SeqDocument.create({ name: 'stray', sequence: template(500, 999) });
    const result = gibson([a, b, c, stranger]);
    expect(result.assembly).toBeNull();
    expect(result.problem).toMatch(/1 of 4 parts were never reached/);
  });

  it('leaves out a circular part and a part shorter than the homology', () => {
    const [a, b, c] = pieces(PLASMID, [0, 1000, 2000], 25);
    if (a === undefined || b === undefined || c === undefined) throw new Error('parts');
    const plasmid = SeqDocument.create({
      name: 'uncut vector',
      topology: 'circular',
      sequence: template(2000, 7),
    });
    const tiny = SeqDocument.create({ name: 'oligo', sequence: 'ACGTACGTAC' });
    const result = gibson([a, b, c, plasmid, tiny]);
    expect(result.assembly).not.toBeNull();
    expect(result.dropped.map((d) => [d.document.name, d.reason])).toEqual([
      ['uncut vector', 'circular'],
      ['oligo', 'short'],
    ]);
  });

  it('holds junctions to the shortest homology asked for', () => {
    const short = pieces(PLASMID, [0, 1000, 2000], 12);
    expect(gibson(short).assembly).toBeNull();
    expect(gibson(short, { minOverlap: 12 }).assembly).not.toBeNull();
  });

  it('reports the melting temperature of each junction', () => {
    const assembly = gibson(pieces(PLASMID, [0, 1000, 2000], 25)).assembly;
    if (assembly === null) throw new Error('no assembly');
    for (const join of assembly.joins) {
      expect(join.overlap).toHaveLength(25);
      expect(join.tm).toBeGreaterThan(40);
      expect(join.tm).toBeLessThan(80);
    }
  });
});

describe('gibson performance', () => {
  it('works out a six-part assembly inside a frame', () => {
    // A 12 kb construct from six 2 kb pieces, which is a large Gibson: NEB
    // quotes up to six fragments for the one-step protocol.
    const big = template(12000, 4242);
    const cuts = [0, 2000, 4000, 6000, 8000, 10000];
    const parts = cuts.map((start, i) => {
      const next = cuts[(i + 1) % cuts.length] ?? start;
      const end = (next > start ? next : next + big.length) + 30;
      let text = '';
      for (let p = start; p < end; p++) text += big.charAt(p % big.length);
      return SeqDocument.create({ name: `part${i + 1}`, sequence: text });
    });
    const t0 = performance.now();
    let length = 0;
    for (let run = 0; run < 10; run++) {
      length = gibson(parts).assembly?.product.length ?? 0;
    }
    const ms = (performance.now() - t0) / 10;
    expect(length).toBe(12000);
    expect(ms).toBeLessThan(200);
    // eslint-disable-next-line no-console
    console.info(`[perf] Gibson of 6 parts into 12 kb: ${ms.toFixed(1)} ms`);
  });
});

describe('gibson warnings (#12)', () => {
  it('has nothing to say about a clean three-piece design', () => {
    const result = gibson(pieces(PLASMID, [0, 1000, 2000], 25));
    expect(result.assembly?.warnings).toEqual([]);
  });

  it('finds a junction’s homology elsewhere in the tube, on either strand', () => {
    const [a, b, c] = pieces(PLASMID, [0, 1000, 2000], 25);
    if (a === undefined || b === undefined || c === undefined) throw new Error('three parts');
    // The a→b homology is PLASMID[1000, 1025); put its reverse complement
    // inside c as well, where a chewed-back end could pair with it.
    const junction = PLASMID.slice(1000, 1025);
    const text = c.sequence.toString();
    const salted = SeqDocument.create({
      name: 'part3',
      sequence: text.slice(0, 500) + reverseComplement(junction) + text.slice(500),
    });
    const result = gibson([a, b, salted]);
    expect(result.assembly).not.toBeNull();
    const repeats = result.assembly?.warnings.filter((w) => w.kind === 'repeat') ?? [];
    expect(repeats).toHaveLength(1);
    expect(repeats[0]?.text).toMatch(
      /joining part1 to part2 also occurs in part3 at 501 \(other strand\)/,
    );
  });

  it('flags a piece short enough to be chewed away, and overlaps short for many pieces', () => {
    // Four pieces, one of them 150 bp, joined by 16 bp overlaps.
    const result = gibson(pieces(PLASMID, [0, 1000, 1134, 2000], 16), { minOverlap: 15 });
    const kinds = result.assembly?.warnings.map((w) => w.kind);
    expect(kinds).toEqual(['short-part', 'short-overlap']);
    expect(result.assembly?.warnings[0]?.text).toMatch(/part2 is 150 bp/);
    expect(result.assembly?.warnings[1]?.text).toMatch(/4 pieces want overlaps of 20 bp or more/);
  });
});
