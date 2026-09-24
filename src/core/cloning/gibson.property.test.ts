import fc from 'fast-check';

import { SeqDocument, reverseComplement } from '@/core';

import { type GibsonWarning, gibson } from './gibson';

/**
 * The Gibson warnings (#12) against a brute-force oracle.
 *
 * The repeat search in `gibson.ts` is the one piece of the reaction with a
 * data structure behind it: every window of a junction's homology is keyed
 * by a rolling 2-bit code of its first 15 bases, the tube is scanned once
 * per strand, and the hits are bucketed into 100-base stretches so that one
 * repeat is reported once. Everything in that — the rolling code's restart
 * at a base that is not ACGT, the forward-strand coordinate a reverse-strand
 * hit is reported at, the exclusion of the junction's own two ends, the
 * bucketing — is invisible from an example. So here the same question is
 * asked of a naive oracle: for every window, `startsWith` at every position
 * of every part's two strands, drop the designed hits, bucket, keep the
 * lowest start. The set of (part, strand, start) the two find must be equal.
 *
 * Repeats are planted deliberately (both strands, several per design, in
 * the same bucket and in different ones), because a random 400-base tube
 * holds none. Alongside the property are fixed cases for what an oracle
 * written from the same reading of the code could get wrong with it:
 *
 * - a window holding an N. The rolling code restarts at one, so a window
 *   whose **first 15 bases** are not all ACGT is never looked for at all,
 *   and a repeat of it is missed; an N past base 15 of a longer window is
 *   matched literally and found. That is the behaviour, deliberate or not,
 *   and it is pinned here so a change to the search has to face it.
 * - the 100-base buckets: two copies 10 bases apart are one warning, two
 *   copies either side of a bucket boundary are two.
 * - the two length rules at their exact boundaries: 199 bp against 200 bp,
 *   and an overlap of 14/15 for three pieces and 19/20 for four.
 */

function must<T>(value: T | null | undefined, what: string): T {
  if (value === null || value === undefined) throw new Error(`expected ${what}`);
  return value;
}

/** A fixed pseudo-random template: no repeat in it but the ones planted. */
function template(length: number, seed = 20260924): string {
  let x = seed >>> 0;
  let out = '';
  for (let i = 0; i < length; i++) {
    x = (x * 1103515245 + 12345) & 0x7fffffff;
    out += 'ACGT'.charAt((x >> 16) & 3);
  }
  return out;
}

/** The circle cut into overlapping pieces, as primer tails would make them. */
function pieces(sequence: string, cuts: readonly number[], overlap: number): string[] {
  const n = sequence.length;
  return cuts.map((start, i) => {
    const next = cuts[(i + 1) % cuts.length] ?? start;
    const end = (next > start ? next : next + n) + overlap;
    let text = '';
    for (let p = start; p < end; p++) text += sequence.charAt(p % n);
    return text;
  });
}

function documents(texts: readonly string[]): SeqDocument[] {
  return texts.map((sequence, i) => SeqDocument.create({ name: `part${i + 1}`, sequence }));
}

/** Writes `insert` over `text` at `at`, keeping the length. */
function splice(text: string, at: number, insert: string): string {
  return text.slice(0, at) + insert + text.slice(at + insert.length);
}

// ------------------------------------------------------------------ oracle

/** Bases of a window the rolling code keys on, as `gibson.ts` has it. */
const SEED = 15;

function isAcgt(text: string, from: number, length: number): boolean {
  return /^[ACGT]*$/.test(text.slice(from, from + length));
}

interface Hit {
  readonly part: number;
  readonly start: number;
  readonly reverse: boolean;
}

function key(hit: Hit): string {
  return `${hit.part}|${hit.reverse ? 'reverse' : 'forward'}|${hit.start}`;
}

/**
 * Every repeat the warnings should name, worked out by scanning each part's
 * two strands for each window with `startsWith`, with no index of any kind.
 */
function oracleRepeats(
  order: readonly { readonly name: string; readonly sequence: string }[],
  joins: readonly { readonly overlap: string }[],
  k: number,
): Map<number, Set<string>> {
  const strands = order.map((p) => {
    const forward = p.sequence.toUpperCase();
    return [forward, reverseComplement(forward)] as const;
  });
  const seed = Math.min(k, SEED);
  const out = new Map<number, Set<string>>();
  joins.forEach((join, j) => {
    const overlap = join.overlap.toUpperCase();
    const up = j;
    const down = (j + 1) % order.length;
    const upLength = must(order[up], 'the upstream part').sequence.length;
    const buckets = new Map<string, Hit>();
    for (let i = 0; i + k <= overlap.length; i++) {
      const window = overlap.slice(i, i + k);
      // A window the rolling code cannot key on is never searched for.
      if (!isAcgt(window, 0, seed)) continue;
      strands.forEach((texts, part) => {
        texts.forEach((text, strand) => {
          const reverse = strand === 1;
          for (let at = 0; at + window.length <= text.length; at++) {
            if (!text.startsWith(window, at)) continue;
            const start = reverse ? text.length - at - k : at;
            const designed =
              !reverse &&
              ((part === up && start >= upLength - overlap.length) ||
                (part === down && start + k <= overlap.length));
            if (designed) continue;
            const hit: Hit = { part, start, reverse };
            const bucket = `${part}:${reverse}:${Math.floor(start / 100)}`;
            const known = buckets.get(bucket);
            if (known === undefined || start < known.start) buckets.set(bucket, hit);
          }
        });
      });
    }
    out.set(j, new Set([...buckets.values()].map(key)));
  });
  return out;
}

const REPEAT =
  /^The homology joining (.+?) to (.+?) also occurs in (.+?) at ([\d,]+)( \(other strand\))?, where/;

/** The same set, read back out of the sentences the warnings are. */
function reportedRepeats(
  warnings: readonly GibsonWarning[],
  order: readonly { readonly name: string }[],
): Map<number, Set<string>> {
  const out = new Map<number, Set<string>>();
  for (let j = 0; j < order.length; j++) out.set(j, new Set<string>());
  for (const warning of warnings) {
    if (warning.kind !== 'repeat') continue;
    const m = must(REPEAT.exec(warning.text), `a parseable repeat warning: ${warning.text}`);
    const from = must(m[1], 'the upstream name');
    const where = must(m[3], 'the part named');
    const at = Number(must(m[4], 'the position').replace(/,/g, '')) - 1;
    const j = order.findIndex((p) => p.name === from);
    const part = order.findIndex((p) => p.name === where);
    expect(j).toBeGreaterThanOrEqual(0);
    expect(part).toBeGreaterThanOrEqual(0);
    must(out.get(j), 'a junction').add(key({ part, start: at, reverse: m[5] !== undefined }));
  }
  return out;
}

interface Checked {
  readonly warnings: readonly GibsonWarning[];
  readonly repeats: number;
}

/** Runs the reaction and holds its repeat warnings to the oracle. */
function check(parts: readonly string[], minOverlap = 15): Checked {
  const result = gibson(documents(parts), { minOverlap });
  const assembly = must(result.assembly, `an assembly (${result.problem ?? ''})`);
  const order = assembly.order.map((p) => ({
    name: p.document.name,
    sequence: p.document.sequence.toString(),
  }));
  const expected = oracleRepeats(order, assembly.joins, minOverlap);
  const got = reportedRepeats(assembly.warnings, order);
  const asObject = (m: Map<number, Set<string>>) =>
    Object.fromEntries([...m].map(([j, s]) => [j, [...s].sort()]));
  expect(asObject(got)).toEqual(asObject(expected));
  return {
    warnings: assembly.warnings,
    repeats: assembly.warnings.filter((w) => w.kind === 'repeat').length,
  };
}

// ----------------------------------------------------------------- planting

const CIRCLE = template(1500);

describe('gibson repeat warnings against a naive oracle', () => {
  it('says nothing about a clean design', () => {
    const parts = pieces(template(900, 7), [0, 300, 600], 25);
    const checked = check(parts);
    expect(checked.warnings).toEqual([]);
  });

  it('finds a repeat planted on the forward strand, at the base it starts on', () => {
    const parts = pieces(CIRCLE, [0, 500, 1000], 25);
    const first = must(parts[0], 'part1');
    // The homology closing the circle is part3's last 25 bases; a copy of
    // its first 15 goes into the middle of part1.
    const overlap = must(parts[2], 'part3').slice(-25);
    const planted = splice(first, 200, overlap.slice(0, 15));
    const checked = check([planted, must(parts[1], 'part2'), must(parts[2], 'part3')]);
    expect(checked.repeats).toBe(1);
    const text = must(
      checked.warnings.find((w) => w.kind === 'repeat'),
      'a repeat warning',
    ).text;
    expect(text).toContain('also occurs in part1 at 201');
    expect(text).not.toContain('other strand');
  });

  it('finds one planted on the other strand, and reports its forward-strand start', () => {
    const parts = pieces(CIRCLE, [0, 500, 1000], 25);
    const second = must(parts[1], 'part2');
    const overlap = must(parts[0], 'part1').slice(-25);
    const planted = splice(second, 300, reverseComplement(overlap.slice(0, 20)));
    const checked = check([must(parts[0], 'part1'), planted, must(parts[2], 'part3')]);
    expect(checked.repeats).toBe(1);
    const text = must(
      checked.warnings.find((w) => w.kind === 'repeat'),
      'a repeat warning',
    ).text;
    expect(text).toContain('(other strand)');
    // The 20 planted bases hold six of the junction's 15-base windows,
    // whose forward-strand starts run 300 to 305; they are one stretch, so
    // the report is the lowest of them, 1-based.
    expect(text).toContain('at 301');
  });

  it('groups a repeat into 100-base stretches, and splits one across a boundary', () => {
    const parts = pieces(CIRCLE, [0, 500, 1000], 25);
    const first = must(parts[0], 'part1');
    const overlap = must(parts[2], 'part3').slice(-25);
    const copy = overlap.slice(0, 15);
    // Two copies ten bases apart: one stretch, reported from the first.
    const near = splice(splice(first, 200, copy), 215, copy);
    const together = check([near, must(parts[1], 'part2'), must(parts[2], 'part3')]);
    expect(together.repeats).toBe(1);
    expect(must(together.warnings[0], 'a warning').text).toContain('at 201');
    // Either side of a bucket boundary: two, though they are 20 bases apart.
    const split = splice(splice(first, 85, copy), 105, copy);
    const apart = check([split, must(parts[1], 'part2'), must(parts[2], 'part3')]);
    expect(apart.repeats).toBe(2);
    const at = (text: string): string | undefined => /at (\d+)/.exec(text)?.[1];
    expect(apart.warnings.map((w) => at(w.text))).toEqual(['86', '106']);
  });

  it('does not count the junction homology itself', () => {
    // Three designed junctions and nothing else: the ends match by design,
    // and a design is not a warning.
    const parts = pieces(CIRCLE, [0, 500, 1000], 40);
    expect(check(parts).repeats).toBe(0);
  });

  it('misses a window whose first 15 bases are not all ACGT, and finds one whose N is later', () => {
    const parts = pieces(CIRCLE, [0, 500, 1000], 25);
    const third = must(parts[2], 'part3');
    // The closing junction's homology, with an N put into it on both sides
    // of the junction so that the ends still match literally.
    const withN = (text: string, at: number) => splice(text, at, 'N');
    const hidden = withN(third, third.length - 25 + 5);
    const firstWithN = withN(must(parts[0], 'part1'), 5);
    const planted = splice(must(parts[1], 'part2'), 300, hidden.slice(-25).slice(0, 20));
    const missed = check([firstWithN, planted, hidden], 15);
    // Every 15-base window of that overlap holds the N in its first 15
    // bases, so the rolling code keys on none of them: the planted copy is
    // there in the sequence and goes unreported. The oracle agrees, which
    // is the check; this pins what "agrees" means.
    expect(missed.repeats).toBe(0);

    // With a 20-base window the N sits past base 15, so the code keys on
    // the first 15 and `startsWith` matches the N literally.
    const late = withN(third, third.length - 25 + 17);
    const lateFirst = withN(must(parts[0], 'part1'), 17);
    const plantedLate = splice(must(parts[1], 'part2'), 300, late.slice(-25));
    const found = check([lateFirst, plantedLate, late], 20);
    expect(found.repeats).toBeGreaterThan(0);
  });

  it('matches the oracle on random designs with repeats planted at random', () => {
    let withRepeats = 0;
    let onOtherStrand = 0;
    const base = template(2000, 99);
    fc.assert(
      fc.property(
        fc.record({
          cuts: fc.uniqueArray(fc.integer({ min: 0, max: 17 }), { minLength: 2, maxLength: 4 }),
          overlap: fc.integer({ min: 15, max: 30 }),
          plants: fc.array(
            fc.record({
              junction: fc.integer({ min: 0, max: 3 }),
              from: fc.integer({ min: 0, max: 10 }),
              length: fc.integer({ min: 15, max: 25 }),
              part: fc.integer({ min: 0, max: 3 }),
              at: fc.integer({ min: 0, max: 200 }),
              reverse: fc.boolean(),
            }),
            { maxLength: 3 },
          ),
        }),
        ({ cuts, overlap, plants }) => {
          const sorted = [...cuts].sort((a, b) => a - b).map((c) => c * 40);
          const parts = pieces(base.slice(0, 800), sorted, overlap);
          const n = parts.length;
          const planted = [...parts];
          for (const plant of plants) {
            const source = must(planted[plant.junction % n], 'a part').slice(-overlap);
            const copy = source.slice(plant.from % 6, (plant.from % 6) + plant.length);
            if (copy.length < 15) continue;
            const target = must(planted[plant.part % n], 'a part');
            // Interior only: a repeat at an end would change which parts
            // join, and that is the assembly's question, not the warning's.
            const room = target.length - copy.length - 70;
            if (room <= 70) continue;
            const at = 70 + (plant.at % (room - 70));
            planted[plant.part % n] = splice(
              target,
              at,
              plant.reverse ? reverseComplement(copy) : copy,
            );
            if (plant.reverse) onOtherStrand++;
          }
          const result = gibson(documents(planted), { minOverlap: 15 });
          // A planted copy can make two parts ambiguous; that is the
          // assembly's business and there are no warnings to check.
          fc.pre(result.assembly !== null);
          const checked = check(planted, 15);
          if (checked.repeats > 0) withRepeats++;
        },
      ),
      { numRuns: 100 },
    );
    expect(withRepeats).toBeGreaterThan(0);
    expect(onOtherStrand).toBeGreaterThan(0);
  });
});

describe('gibson length warnings at their boundaries', () => {
  /**
   * The length rules alone: a short `minOverlap` makes the repeat search
   * key on 10-base windows, and a kilobase of DNA holds those by chance.
   * Those are the repeat property's business above.
   */
  const kinds = (parts: readonly string[], minOverlap: number): GibsonWarning['kind'][] => {
    const result = gibson(documents(parts), { minOverlap });
    return must(result.assembly, `an assembly (${result.problem ?? ''})`)
      .warnings.filter((w) => w.kind !== 'repeat')
      .map((w) => w.kind);
  };

  it('calls a 199 bp part short and a 200 bp one not', () => {
    // part1 runs from 0 to the second cut plus the overlap.
    const short = pieces(template(900, 3), [0, 174, 450], 25);
    expect(must(short[0], 'part1')).toHaveLength(199);
    expect(kinds(short, 15)).toEqual(['short-part']);
    const ok = pieces(template(900, 3), [0, 175, 450], 25);
    expect(must(ok[0], 'part1')).toHaveLength(200);
    expect(kinds(ok, 15)).toEqual([]);
  });

  it('wants 15 bp for three pieces and 20 for four, and says so only below', () => {
    const three = (overlap: number) => pieces(template(1200, 5), [0, 400, 800], overlap);
    // Three pieces: the floor is 15, so it is only reportable when the
    // reaction was told to accept less than that.
    expect(kinds(three(14), 10)).toEqual(['short-overlap']);
    expect(kinds(three(15), 10)).toEqual([]);
    expect(kinds(three(15), 15)).toEqual([]);

    const four = (overlap: number) => pieces(template(1200, 5), [0, 300, 600, 900], overlap);
    expect(kinds(four(19), 15)).toEqual(['short-overlap']);
    expect(kinds(four(20), 15)).toEqual([]);
    // And it counts the junctions that are short, not the pieces.
    const mixed = pieces(template(1200, 5), [0, 300, 600, 900], 19);
    const result = gibson(documents(mixed), { minOverlap: 15 });
    const warning = must(
      must(result.assembly, 'an assembly').warnings.find((w) => w.kind === 'short-overlap'),
      'a short-overlap warning',
    );
    expect(warning.text).toContain('4 pieces want overlaps of 20 bp or more');
    expect(warning.text).toContain('4 junctions have 19 bp');
  });
});
