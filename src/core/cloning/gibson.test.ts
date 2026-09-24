import { expectWithin, itTimed } from '@/test/timing';
import { SeqDocument, createFeature, rangeSegment, reverseComplement } from '@/core';

import { describeGibsonDropped, gibson, terminalOverlap } from './gibson';

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
  itTimed('works out a six-part assembly inside a frame', () => {
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
    expectWithin(ms, 200);
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

describe('gibson refusals, word for word (#77)', () => {
  it('has nothing to assemble when every part is left out, and says why each was', () => {
    const plasmid = SeqDocument.create({
      name: 'uncut',
      topology: 'circular',
      sequence: template(500, 3),
    });
    // Exactly as long as the homology: nothing would be left of it.
    const oligo = SeqDocument.create({ name: 'oligo', sequence: template(15, 4) });
    const result = gibson([plasmid, oligo]);
    expect(result.assembly).toBeNull();
    expect(result.usable).toEqual([]);
    expect(result.problem).toBe('Nothing to assemble: no part has two ends to join by.');
    const [circular, short] = result.dropped;
    if (circular === undefined || short === undefined) throw new Error('two dropped');
    expect([circular.reason, short.reason]).toEqual(['circular', 'short']);
    expect(describeGibsonDropped(circular, 15)).toBe(
      'is circular, so it has no ends to join by — linearise or digest it first',
    );
    expect(describeGibsonDropped(short, 15)).toBe(
      'is shorter than the 15 bp of homology a junction needs',
    );
  });

  it('will not call one part in a linear product an assembly', () => {
    const [only] = pieces(PLASMID, [0], 25);
    if (only === undefined) throw new Error('parts');
    expect(gibson([only], { circular: false }).problem).toBe(
      'One part and a linear product is not an assembly.',
    );
  });

  it('names the one part that follows either way round', () => {
    // part2 starts with part1's last 25 bases and ends with their reverse
    // complement, so it fits after part1 as itself and turned around.
    const a = SeqDocument.create({ name: 'part1', sequence: template(400, 5) });
    const end = a.sequence.toString().slice(-25);
    const b = SeqDocument.create({
      name: 'part2',
      sequence: end + template(300, 6) + reverseComplement(end),
    });
    expect(gibson([a, b]).problem).toBe(
      'The end of part1 matches part2 either way round, so the assembly is ambiguous.',
    );
  });

  it('names the parts that could come before the start of a linear product', () => {
    const [a, b, c] = linearPieces(PLASMID, [0, 1000, 2000], 25);
    if (a === undefined || b === undefined || c === undefined) throw new Error('parts');
    const twin = SeqDocument.create({ name: 'part1 copy', sequence: a.sequence.toString() });
    expect(gibson([b, c, a, twin], { circular: false }).problem).toBe(
      'The start of part2 matches part1 and part1 copy, so the assembly is ambiguous. Every junction needs homology of its own.',
    );
  });

  it('says where a linear chain stops when nothing comes before or after it', () => {
    const [a, b] = linearPieces(PLASMID, [0, 1000, 2000], 25);
    if (a === undefined || b === undefined) throw new Error('parts');
    const stray = SeqDocument.create({ name: 'stray', sequence: template(500, 999) });
    expect(gibson([a, b, stray], { circular: false }).problem).toBe(
      'Nothing follows part2: no other part starts with its last 15 bases or more. 1 of 3 parts were never reached.',
    );
  });

  it('does not look backwards round a circle that stops', () => {
    // part3 without its tail has nothing after it. Walking back from part2
    // would reach part1, but a circle is followed one way only.
    const [a, b, c] = pieces(PLASMID, [0, 1000, 2000], 25);
    if (a === undefined || b === undefined || c === undefined) throw new Error('parts');
    const open = SeqDocument.create({ name: 'part3', sequence: PLASMID.slice(2000) });
    expect(gibson([b, open, a]).problem).toBe(
      'Nothing follows part3: no other part starts with its last 15 bases or more. 1 of 3 parts were never reached.',
    );
  });

  it('refuses a part that is all homology', () => {
    // part2 is the last 20 bases of part1, and its own last 15 start part3:
    // it gives up all 20 to part1 and nothing of it is left.
    const t = template(600, 21);
    const a = SeqDocument.create({ name: 'part1', sequence: t.slice(0, 300) });
    const b = SeqDocument.create({ name: 'part2', sequence: t.slice(280, 300) });
    const c = SeqDocument.create({ name: 'part3', sequence: t.slice(285) });
    expect(gibson([b, a, c], { circular: false }).problem).toBe(
      'part2 is shorter than the homology at its two ends, so there would be nothing left of it in the product.',
    );
  });
});

describe('gibson product description (#77)', () => {
  it('lists each part with its length, its turn and the overlap after it', () => {
    const [a, b, c] = pieces(PLASMID, [0, 1000, 2000], 25);
    if (a === undefined || b === undefined || c === undefined) throw new Error('parts');
    const flipped = SeqDocument.create({
      name: 'part2',
      sequence: reverseComplement(b.sequence.toString()),
    });
    expect(gibson([a, flipped, c]).assembly?.product.metadata.description).toBe(
      'Circular Gibson assembly of part1 (1,025 bp, 25 bp overlap), part2 (1,025 bp, flipped, 25 bp overlap), part3 (1,025 bp, 25 bp overlap)',
    );
  });

  it('gives the last part of a linear product no overlap', () => {
    const parts = linearPieces(PLASMID, [0, 1000, 2000], 25);
    expect(gibson(parts, { circular: false }).assembly?.product.metadata.description).toBe(
      'Linear Gibson assembly of part1 (1,025 bp, 25 bp overlap), part2 (1,025 bp, 25 bp overlap), part3 (1,000 bp)',
    );
  });
});

describe('gibson warnings, word for word (#77)', () => {
  /** A four-piece circle of PLASMID whose junctions have the given overlaps. */
  function fourPieces(overlaps: readonly number[]): SeqDocument[] {
    const cuts = [0, 750, 1500, 2250];
    return cuts.map((start, i) => {
      const next = cuts[(i + 1) % cuts.length] ?? 0;
      const end = (next > start ? next : next + PLASMID.length) + (overlaps[i] ?? 0);
      let text = '';
      for (let p = start; p < end; p++) text += PLASMID.charAt(p % PLASMID.length);
      return SeqDocument.create({ name: `part${i + 1}`, sequence: text });
    });
  }

  it('counts one short junction as one', () => {
    const assembly = gibson(fourPieces([16, 25, 25, 25])).assembly;
    expect(assembly?.joins.map((j) => j.length)).toEqual([16, 25, 25, 25]);
    expect(assembly?.warnings.map((w) => w.text)).toEqual([
      '4 pieces want overlaps of 20 bp or more; one junction has 16 bp.',
    ]);
  });

  it('lists the lengths of several short junctions once each', () => {
    const assembly = gibson(fourPieces([16, 17, 16, 25])).assembly;
    expect(assembly?.joins.map((j) => j.length)).toEqual([16, 17, 16, 25]);
    expect(assembly?.warnings.map((w) => w.text)).toEqual([
      '4 pieces want overlaps of 20 bp or more; 3 junctions have 16, 17 bp.',
    ]);
  });

  it('keeps apart two junctions whose homology begins alike, and finds each one’s copies', () => {
    // Both junctions start with the same 15 bases (the repeat search's seed)
    // and differ in the last 5. part2 has a copy of the first junction just
    // past its own designed one; part3 has two copies of it back to back
    // right after an N, and a copy of the second junction.
    const x = template(15, 41);
    const w1 = x + 'ACGTA';
    const w2 = x + 'TTGCA';
    const z = template(20, 44);
    const part1 = SeqDocument.create({ name: 'part1', sequence: z + template(400, 45) + w1 });
    const part2 = SeqDocument.create({
      name: 'part2',
      sequence: w1 + template(10, 46) + w1 + template(400, 47) + w2,
    });
    const part3 = SeqDocument.create({
      name: 'part3',
      sequence:
        w2 + template(300, 48) + 'N' + w1 + w1 + template(300, 49) + w2 + template(100, 50) + z,
    });
    const assembly = gibson([part1, part2, part3], { minOverlap: 20 }).assembly;
    if (assembly === null) throw new Error('no assembly');
    expect(assembly.joins.map((j) => j.length)).toEqual([20, 20, 20]);
    const tail = ', where a chewed-back end could anneal instead.';
    expect(assembly.warnings.map((w) => w.text)).toEqual([
      // 20 + 10: inside part2 but not where the junction put it.
      `The homology joining part1 to part2 also occurs in part2 at 31${tail}`,
      // The two touching copies are one stretch, from the first.
      `The homology joining part1 to part2 also occurs in part3 at 322${tail}`,
      `The homology joining part2 to part3 also occurs in part3 at 662${tail}`,
    ]);
  });

  it('reports a junction’s copies by part, then strand, then position', () => {
    // The 25-base junction part1→part2 is searched as 15-base windows. Its
    // first window turns up on part1's other strand, its middle one in
    // part3, its last one in part1: found in that order, reported by part.
    const [a, b, c] = pieces(PLASMID, [0, 1000, 2000], 25);
    if (a === undefined || b === undefined || c === undefined) throw new Error('parts');
    const first = PLASMID.slice(1000, 1015);
    const middle = PLASMID.slice(1005, 1020);
    const last = PLASMID.slice(1010, 1025);
    const p1 = a.sequence.toString();
    const p3 = c.sequence.toString();
    const salted1 = SeqDocument.create({
      name: 'part1',
      sequence:
        p1.slice(0, 300) + reverseComplement(first) + p1.slice(300, 500) + last + p1.slice(500),
    });
    const salted3 = SeqDocument.create({
      name: 'part3',
      sequence: p3.slice(0, 50) + middle + p3.slice(50),
    });
    const assembly = gibson([salted1, b, salted3]).assembly;
    if (assembly === null) throw new Error('no assembly');
    const tail = ', where a chewed-back end could anneal instead.';
    expect(assembly.warnings.map((w) => w.text)).toEqual([
      `The homology joining part1 to part2 also occurs in part1 at 516${tail}`,
      `The homology joining part1 to part2 also occurs in part1 at 301 (other strand)${tail}`,
      `The homology joining part1 to part2 also occurs in part3 at 51${tail}`,
    ]);
  });
});
