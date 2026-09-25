import { createFeature, rangeSegment } from '../features';
import { type Topology } from '../range';
import { reverseComplement } from '../sequence';
import { randomDna, randomInt, seededRandom } from '@/test/random';

import { ANNEAL_DEFAULTS, buildAnnealIndex, findAnnealingSites } from './anneal';
import {
  type PrimerHit,
  asPrimerSequence,
  findCollectionPrimers,
  nextPrimerName,
  parsePrimerList,
  preparePrimers,
  primerFromFeature,
  splitRow,
  writePrimerCsv,
  writePrimerFasta,
} from './collection';

/**
 * The search behind "Find my primers" (#64). It is `findAnnealingSites` run
 * over a collection, so these tests pin what a user of the collection
 * relies on rather than the walk itself: a planted primer is found where it
 * was planted, on the strand it was planted on, through the origin of a
 * circle and not past the end of a linear molecule; a mismatch under the 3′
 * anchor always loses the site and one further in only past the limit; and
 * IUPAC codes bind what they stand for. The planting is exhaustive where it
 * can be — every mismatch position, every pair of them, every rotation of a
 * circle — and random otherwise, from a seed.
 */

const { exactThreePrime: ANCHOR, minAnneal: MIN } = ANNEAL_DEFAULTS;

/** `text` with the base at `at` changed to one it is not, the same way each time. */
function mutate(text: string, at: number): string {
  const was = text.charAt(at);
  const next = { A: 'C', C: 'G', G: 'T', T: 'A' }[was] ?? 'A';
  return text.slice(0, at) + next + text.slice(at + 1);
}

/** The bases of a circle from `start`, `length` of them, through the origin if need be. */
function around(text: string, start: number, length: number): string {
  let out = '';
  for (let i = 0; i < length; i++) out += text.charAt((start + i) % text.length);
  return out;
}

/** A primer that binds `template` at [start, start + length) on `strand`, 5′→3′. */
function primerAt(template: string, start: number, length: number, strand: 'forward' | 'reverse') {
  const top = around(template, start, length);
  return strand === 'forward' ? top : reverseComplement(top);
}

/** Only the fields that say where a hit is. */
function where(h: PrimerHit) {
  return {
    name: h.name,
    start: h.range.start,
    end: h.range.end,
    strand: h.strand,
    mismatches: h.mismatches,
    tail: h.tail,
  };
}

function search(
  template: string,
  topology: Topology,
  primers: readonly { id: string; name: string; sequence: string }[],
  maxMismatches = 2,
) {
  return findCollectionPrimers(template, topology, primers, { maxMismatches });
}

const rand = seededRandom(64);
const TEMPLATE = randomDna(rand, 600);

describe('findCollectionPrimers: where a primer is planted', () => {
  it('finds each primer of a collection on its own strand, named', () => {
    const primers = [
      { id: 'a', name: 'fwd-100', sequence: primerAt(TEMPLATE, 100, 20, 'forward') },
      { id: 'b', name: 'rev-300', sequence: primerAt(TEMPLATE, 300, 22, 'reverse') },
      { id: 'c', name: 'absent', sequence: randomDna(seededRandom(9), 20) },
    ];
    const { hits, tooShort } = search(TEMPLATE, 'linear', primers);
    expect(hits.map(where)).toEqual([
      { name: 'fwd-100', start: 100, end: 120, strand: 'forward', mismatches: 0, tail: '' },
      { name: 'rev-300', start: 300, end: 322, strand: 'reverse', mismatches: 0, tail: '' },
    ]);
    expect(hits.map((h) => h.primerId)).toEqual(['a', 'b']);
    expect(tooShort).toEqual([]);
  });

  it('finds every random plant, on either strand, circular or linear', () => {
    const r = seededRandom(640);
    for (let trial = 0; trial < 200; trial++) {
      const template = randomDna(r, randomInt(r, 80, 400));
      const length = randomInt(r, MIN, 30);
      const strand = r() < 0.5 ? 'forward' : 'reverse';
      const circular = r() < 0.5;
      // A linear plant stays inside the molecule; a circular one may cross the origin.
      const start = circular
        ? randomInt(r, 0, template.length)
        : randomInt(r, 0, template.length - length + 1);
      const sequence = primerAt(template, start, length, strand);
      const { hits } = search(template, circular ? 'circular' : 'linear', [
        { id: 'p', name: 'p', sequence },
      ]);
      expect(hits).toContainEqual(
        expect.objectContaining({
          range: { start, end: start + length },
          strand,
          annealLength: length,
          mismatches: 0,
          tail: '',
        }),
      );
    }
  });

  it('keeps a hit on the same bases through every rotation of a circle', () => {
    // A circle has no first base: rotating the origin to every position in
    // turn must move each site with it, including the rotations that put
    // the origin inside a site.
    const circle = randomDna(seededRandom(5), 90);
    const primers = [
      { id: 'f', name: 'f', sequence: primerAt(circle, 10, 18, 'forward') },
      { id: 'r', name: 'r', sequence: primerAt(circle, 50, 20, 'reverse') },
    ];
    const base = search(circle, 'circular', primers).hits.map(where);
    expect(base).toHaveLength(2);
    for (let shift = 0; shift < circle.length; shift++) {
      const rotated = circle.slice(shift) + circle.slice(0, shift);
      const moved = search(rotated, 'circular', primers)
        .hits.map(where)
        .map((h) => {
          const start = (h.start + shift) % circle.length;
          return { ...h, start, end: start + (h.end - h.start) };
        })
        .sort((a, b) => a.start - b.start);
      expect(moved).toEqual(base);
      for (const h of search(rotated, 'circular', primers).hits) {
        // Unrolled: a site through the origin ends past the length, never wraps to before its start.
        expect(h.range.start).toBeGreaterThanOrEqual(0);
        expect(h.range.start).toBeLessThan(circle.length);
        expect(h.range.end).toBeGreaterThan(h.range.start);
      }
    }
  });

  it('finds a site through the origin of a circle, and not past the ends of a line', () => {
    const L = TEMPLATE.length;
    for (const strand of ['forward', 'reverse'] as const) {
      for (let over = 1; over < 20; over++) {
        // `over` bases before the origin, the rest after it.
        const sequence = primerAt(TEMPLATE, L - over, 20, strand);
        const circular = search(TEMPLATE, 'circular', [{ id: 'p', name: 'p', sequence }]).hits;
        expect(circular.map(where)).toContainEqual(
          expect.objectContaining({ start: L - over, end: L - over + 20, strand }),
        );
        // A linear molecule has no bases on the far side of its end. What is
        // left inside is the primer's 3′ part only when the 3′ end is inside
        // and long enough; the rest is then a tail.
        const linear = search(TEMPLATE, 'linear', [{ id: 'p', name: 'p', sequence }]).hits;
        for (const h of linear) {
          expect(h.range.start).toBeGreaterThanOrEqual(0);
          expect(h.range.end).toBeLessThanOrEqual(L);
        }
        // Forward: the 3′ end is after the origin, with `20 - over` bases up
        // to it inside. Reverse: the 3′ end is before the origin, with `over`.
        const inside = strand === 'forward' ? 20 - over : over;
        const expected = inside >= MIN;
        const found = linear.filter((h) => h.strand === strand && h.annealLength === inside);
        expect(found.length > 0).toBe(expected);
        if (expected) expect(found[0]?.tail.length).toBe(20 - inside);
      }
    }
  });

  it('reads the reverse strand as the mirror of the forward one', () => {
    // Searching the reverse complement of the template finds each site on
    // the other strand, at the mirrored coordinates.
    const primers = [
      { id: 'a', name: 'a', sequence: primerAt(TEMPLATE, 40, 21, 'forward') },
      { id: 'b', name: 'b', sequence: primerAt(TEMPLATE, 200, 19, 'reverse') },
      { id: 'c', name: 'c', sequence: primerAt(TEMPLATE, 590, 20, 'forward') },
    ];
    const L = TEMPLATE.length;
    for (const topology of ['linear', 'circular'] as const) {
      const top = search(TEMPLATE, topology, primers).hits.map(where);
      const mirrored = search(reverseComplement(TEMPLATE), topology, primers)
        .hits.map(where)
        .map((h) => {
          const length = h.end - h.start;
          const start = (((L - h.end) % L) + L) % L;
          return {
            ...h,
            start,
            end: start + length,
            strand: h.strand === 'forward' ? 'reverse' : 'forward',
          };
        })
        .sort((a, b) => a.start - b.start || a.strand.localeCompare(b.strand));
      expect(mirrored).toEqual(top);
    }
  });

  it('finds a cloning primer by the part that anneals and calls the rest a tail', () => {
    const tail = 'GCGGATCCGCTTAAG';
    // The base before the site is not the tail's last, so the annealed part
    // stops at the site: with no mismatch allowed, exactly there.
    const template = `${TEMPLATE.slice(0, 249)}C${TEMPLATE.slice(250)}`;
    const sequence = tail + primerAt(template, 250, 20, 'forward');
    const exact = search(template, 'linear', [{ id: 't', name: 'BamHI-fwd', sequence }], 0);
    expect(exact.hits.map(where)).toEqual([
      { name: 'BamHI-fwd', start: 250, end: 270, strand: 'forward', mismatches: 0, tail },
    ]);
    // With mismatches allowed, the annealed part reaches as far into the tail
    // as the tail happens to pair, and no further than it pairs.
    const loose = search(template, 'linear', [{ id: 't', name: 'BamHI-fwd', sequence }], 2).hits;
    expect(loose).toHaveLength(1);
    const [hit] = loose;
    expect(hit?.range.end).toBe(270);
    expect(hit?.range.start).toBeLessThanOrEqual(250);
    expect(hit?.tail).toBe(sequence.slice(0, sequence.length - (hit?.annealLength ?? 0)));
    expect(tail.startsWith(hit?.tail ?? '-')).toBe(true);
  });

  it('reports a primer shorter than a site needs, and does not search it', () => {
    const { hits, tooShort } = search(TEMPLATE, 'linear', [
      { id: 'short', name: 'short', sequence: TEMPLATE.slice(10, 10 + MIN - 1) },
      { id: 'ok', name: 'ok', sequence: TEMPLATE.slice(10, 10 + MIN) },
    ]);
    expect(tooShort).toEqual(['short']);
    expect(hits.map((h) => h.primerId)).toEqual(['ok']);
  });

  it('finds nothing on an empty template or for an empty collection', () => {
    expect(
      search('', 'circular', [{ id: 'a', name: 'a', sequence: TEMPLATE.slice(0, 20) }]).hits,
    ).toEqual([]);
    expect(search(TEMPLATE, 'circular', []).hits).toEqual([]);
  });

  it('lists hits in template order, forward before reverse at one place', () => {
    // A palindromic 20-mer binds both strands at the same bases.
    const half = 'GATTACAGCC';
    const palindrome = half + reverseComplement(half);
    const template = `${TEMPLATE.slice(0, 100)}${palindrome}${TEMPLATE.slice(100, 300)}`;
    const { hits } = search(template, 'linear', [
      { id: 'z', name: 'z', sequence: template.slice(200, 220) },
      { id: 'p', name: 'p', sequence: palindrome },
    ]);
    expect(hits.map((h) => [h.range.start, h.strand, h.name])).toEqual([
      [100, 'forward', 'p'],
      [100, 'reverse', 'p'],
      [200, 'forward', 'z'],
    ]);
  });
});

describe('findCollectionPrimers: mismatches', () => {
  const n = 20;
  const start = 120;
  const clean = primerAt(TEMPLATE, start, n, 'forward');

  /**
   * What the search should find for a forward primer with mismatches at
   * these distances from its 3′ end: nothing if one is under the anchor;
   * otherwise the longest 3′ stretch holding at most `max` of them, trimmed
   * back to a match, if it is long enough to call a site.
   */
  function expected(distances: readonly number[], max: number) {
    if (distances.some((d) => d < ANCHOR)) return null;
    const bad = new Set(distances);
    let seen = 0;
    let length = 0;
    let within = 0;
    for (let i = 0; i < n; i++) {
      if (bad.has(i)) {
        if (++seen > max) break;
        continue;
      }
      length = i + 1;
      within = seen;
    }
    return length < MIN ? null : { length, mismatches: within };
  }

  /** The primer with the base `d` from its 3′ end mismatched, for each `d`. */
  function withMismatches(distances: readonly number[]): string {
    let p = clean;
    for (const d of distances) p = mutate(p, n - 1 - d);
    return p;
  }

  function check(distances: readonly number[], max: number): void {
    for (const strand of ['forward', 'reverse'] as const) {
      const sequence = withMismatches(distances);
      // The same primer on the other strand: the template is made to carry
      // the clean primer's reverse complement where its bases were.
      const template =
        strand === 'forward'
          ? TEMPLATE
          : TEMPLATE.slice(0, start) + reverseComplement(clean) + TEMPLATE.slice(start + n);
      const want = expected(distances, max);
      const hits = search(template, 'linear', [{ id: 'p', name: 'p', sequence }], max).hits.filter(
        (h) => h.strand === strand,
      );
      // Where the 3′ end is: the right-hand end of a forward site, the left of a reverse one.
      const at = hits.filter((h) =>
        strand === 'forward' ? h.range.end === start + n : h.range.start === start,
      );
      if (want === null) {
        expect(at, `${strand} ${distances.join(',')} max ${max}`).toEqual([]);
      } else {
        expect(at, `${strand} ${distances.join(',')} max ${max}`).toHaveLength(1);
        expect(at[0]).toMatchObject({
          annealLength: want.length,
          mismatches: want.mismatches,
          tail: sequence.slice(0, n - want.length),
        });
      }
    }
  }

  it('loses the site to one mismatch anywhere under the 3′ anchor', () => {
    for (let d = 0; d < ANCHOR; d++) for (let max = 0; max <= 3; max++) check([d], max);
  });

  it('allows a single mismatch past the anchor only when mismatches are allowed', () => {
    for (let d = 0; d < n; d++) for (let max = 0; max <= 3; max++) check([d], max);
  });

  it('counts every pair of mismatches against the limit', () => {
    for (let a = 0; a < n; a++) {
      for (let b = a + 1; b < n; b++) for (let max = 0; max <= 3; max++) check([a, b], max);
    }
  });

  it('counts every triple of mismatches past the anchor against the limit', () => {
    for (let a = ANCHOR; a < n; a++)
      for (let b = a + 1; b < n; b++)
        for (let c = b + 1; c < n; c++) for (let max = 1; max <= 3; max++) check([a, b, c], max);
  });

  it('marks a full-length site with two mismatches as having two, with the default limit', () => {
    const sequence = withMismatches([8, 14]);
    const { hits } = findCollectionPrimers(TEMPLATE, 'linear', [{ id: 'p', name: 'p', sequence }]);
    expect(hits.map(where)).toContainEqual(
      expect.objectContaining({ start, end: start + n, mismatches: 2, tail: '' }),
    );
  });
});

describe('findCollectionPrimers: IUPAC codes', () => {
  const start = 330;
  const n = 20;
  const clean = primerAt(TEMPLATE, start, n, 'forward');
  /** The code standing for the given base and some other. */
  const covering: Record<string, string> = { A: 'R', G: 'S', C: 'Y', T: 'W' };
  /** A code that does not stand for the given base. */
  const missing: Record<string, string> = { A: 'Y', G: 'W', C: 'R', T: 'S' };

  function withCode(at: number, table: Record<string, string>): string {
    return clean.slice(0, at) + (table[clean.charAt(at)] ?? 'N') + clean.slice(at + 1);
  }

  it('binds a code wherever it stands for the template base, anchor included', () => {
    for (let at = 0; at < n; at++) {
      for (const strand of ['forward', 'reverse'] as const) {
        const sequence = withCode(at, covering);
        const template =
          strand === 'forward'
            ? TEMPLATE
            : TEMPLATE.slice(0, start) + reverseComplement(clean) + TEMPLATE.slice(start + n);
        const { hits } = search(template, 'linear', [{ id: 'p', name: 'p', sequence }], 0);
        expect(hits.map(where)).toContainEqual(
          expect.objectContaining({ start, end: start + n, strand, mismatches: 0 }),
        );
      }
    }
  });

  it('counts a code that does not stand for the template base as a mismatch', () => {
    for (let at = 0; at < n; at++) {
      const sequence = withCode(at, missing);
      const { hits } = search(TEMPLATE, 'linear', [{ id: 'p', name: 'p', sequence }], 2);
      const underAnchor = n - 1 - at < ANCHOR;
      // A mismatch at the 5′-most base is not counted but trimmed off as a
      // one-base tail: a site never begins with a mismatch.
      const from = at === 0 ? start + 1 : start;
      const full = hits.filter((h) => h.range.start === from && h.range.end === start + n);
      expect(full.map((h) => h.mismatches)).toEqual(underAnchor ? [] : [at === 0 ? 0 : 1]);
    }
  });

  it('binds N anywhere, and a template N only to a primer N', () => {
    const allN = clean.slice(0, 5) + 'NNNNN' + clean.slice(10);
    expect(
      search(TEMPLATE, 'linear', [{ id: 'p', name: 'p', sequence: allN }], 0).hits.map(where),
    ).toContainEqual(expect.objectContaining({ start, mismatches: 0 }));
    // An unknown template base is not known to pair with anything but N.
    const template = TEMPLATE.slice(0, start + 8) + 'N' + TEMPLATE.slice(start + 9);
    const plain = search(template, 'linear', [{ id: 'p', name: 'p', sequence: clean }], 2).hits;
    expect(plain.filter((h) => h.range.start === start).map((h) => h.mismatches)).toEqual([1]);
    const coded = clean.slice(0, 8) + 'N' + clean.slice(9);
    const withN = search(template, 'linear', [{ id: 'p', name: 'p', sequence: coded }], 0).hits;
    expect(withN.filter((h) => h.range.start === start).map((h) => h.mismatches)).toEqual([0]);
  });

  it('reads lower case, U and stray characters in a primer as the bases they are', () => {
    const messy = `5'-${clean.toLowerCase().replace(/t/g, 'u').slice(0, 10)} ${clean.slice(10)}-3'`;
    const { hits } = search(TEMPLATE, 'linear', [{ id: 'p', name: 'p', sequence: messy }]);
    expect(hits.map(where)).toContainEqual(expect.objectContaining({ start, end: start + n }));
  });
});

describe('the anchor index', () => {
  /** A template with a code or an N now and then, as a real one can have. */
  function messyTemplate(r: () => number, length: number): string {
    let out = '';
    for (let i = 0; i < length; i++) {
      const x = r();
      out +=
        x < 0.02
          ? 'N'
          : x < 0.04
            ? 'RYSWKM'.charAt(randomInt(r, 0, 6))
            : 'ACGT'.charAt(randomInt(r, 0, 4));
    }
    return out;
  }

  it('finds exactly the sites the walk over every base finds', () => {
    // The index only narrows where the walk is tried, so every site, in
    // every field, must be the same: planted primers, mutated ones,
    // degenerate ones, primers from nowhere, on messy templates of both
    // topologies and under every setting that changes what a site is.
    const r = seededRandom(5656);
    for (let trial = 0; trial < 300; trial++) {
      const template =
        r() < 0.5 ? messyTemplate(r, randomInt(r, 5, 300)) : randomDna(r, randomInt(r, 5, 300));
      const topology: Topology = r() < 0.5 ? 'circular' : 'linear';
      const length = randomInt(r, 6, 32);
      let primer =
        r() < 0.7 && template.length > 0
          ? primerAt(
              template,
              randomInt(r, 0, template.length),
              Math.min(length, template.length),
              r() < 0.5 ? 'forward' : 'reverse',
            )
          : randomDna(r, length);
      for (let m = randomInt(r, 0, 4); m > 0; m--) {
        const at = randomInt(r, 0, primer.length);
        primer = primer.slice(0, at) + 'ACGTRYNK'.charAt(randomInt(r, 0, 8)) + primer.slice(at + 1);
      }
      const options = {
        minAnneal: randomInt(r, 3, 18),
        maxMismatches: randomInt(r, 0, 4),
        exactThreePrime: randomInt(r, 0, 8),
      };
      const index = buildAnnealIndex(template, topology, options.exactThreePrime);
      const walked = findAnnealingSites(template, topology, primer, options);
      const indexed = findAnnealingSites(template, topology, primer, options, index);
      expect(indexed, `${template} ${topology} ${primer} ${JSON.stringify(options)}`).toEqual(
        walked,
      );
    }
  });

  it('is not used for another template than its own', () => {
    const index = buildAnnealIndex(TEMPLATE, 'circular');
    const other = TEMPLATE.slice(100) + TEMPLATE.slice(0, 100);
    const primer = primerAt(other, 590, 20, 'forward');
    expect(findAnnealingSites(other, 'circular', primer, {}, index)).toEqual(
      findAnnealingSites(other, 'circular', primer),
    );
    expect(findAnnealingSites(TEMPLATE, 'linear', primer, {}, index)).toEqual(
      findAnnealingSites(TEMPLATE, 'linear', primer),
    );
  });

  it('is not built when there is no anchor or nothing to index', () => {
    expect(buildAnnealIndex(TEMPLATE, 'linear', 0)).toBeNull();
    expect(buildAnnealIndex('ACG', 'circular', 5)).toBeNull();
    expect(buildAnnealIndex('ACGTA', 'circular', 5)?.starts.length).toBe(5);
    expect(buildAnnealIndex('ACGTA', 'linear', 5)?.starts.length).toBe(1);
    expect(buildAnnealIndex('ACGTANACGT', 'linear', 5)?.irregular).toEqual([1, 2, 3, 4, 5]);
  });

  it('keeps every plain window once, and the irregular ones apart', () => {
    const plain = (index: ReturnType<typeof buildAnnealIndex>) =>
      Array.from(index?.starts ?? []).sort((a, b) => a - b);
    // Six windows on the line, five of them holding the N; on the circle
    // four more run through the origin, all of them plain.
    expect(plain(buildAnnealIndex('ACGTANACGT', 'linear', 5))).toEqual([0]);
    expect(plain(buildAnnealIndex('ACGTANACGT', 'circular', 5))).toEqual([0, 6, 7, 8, 9]);
    expect(buildAnnealIndex('ACGTANACGT', 'circular', 5)?.irregular).toEqual([1, 2, 3, 4, 5]);
  });

  it('is not used for a circle when it was built for a line', () => {
    // A line's index has no windows through the origin, so it would miss
    // the sites whose 3′ anchor lies across it.
    const L = TEMPLATE.length;
    const index = buildAnnealIndex(TEMPLATE, 'linear');
    for (const [strand, start] of [
      ['forward', L - 18],
      ['reverse', L - 2],
    ] as const) {
      const primer = primerAt(TEMPLATE, start, 20, strand);
      const walked = findAnnealingSites(TEMPLATE, 'circular', primer);
      expect(walked).toContainEqual(
        expect.objectContaining({ range: { start, end: start + 20 }, strand }),
      );
      expect(findAnnealingSites(TEMPLATE, 'circular', primer, {}, index)).toEqual(walked);
    }
  });

  it('is not used when the anchor asked for is shorter than its words', () => {
    // Built for a five-base anchor; searched with two, a mismatch three
    // bases from the 3′ end is allowed, and its site is in no word of the index.
    const index = buildAnnealIndex(TEMPLATE, 'linear', 5);
    const options = { exactThreePrime: 2, maxMismatches: 2 };
    for (const strand of ['forward', 'reverse'] as const) {
      const clean = primerAt(TEMPLATE, 200, 20, strand);
      const primer = mutate(clean, 20 - 1 - 3);
      const walked = findAnnealingSites(TEMPLATE, 'linear', primer, options);
      expect(walked).toContainEqual(
        expect.objectContaining({ range: { start: 200, end: 220 }, strand, mismatches: 1 }),
      );
      expect(findAnnealingSites(TEMPLATE, 'linear', primer, options, index)).toEqual(walked);
    }
  });

  it('lists sites sharing a start in the order the walk does, through the origin too', () => {
    // A repetitive circle where one start has a site ending at each of
    // eleven places, some of them past the origin: the index's windows come
    // grouped by word and unrolled, and must be put back in order.
    const template = 'AAAAAACAACCAACCAACAAAAAAAA';
    const primer = 'AAAACAAAAAAAAAAAAAAA';
    const options = { exactThreePrime: 3, maxMismatches: 0, minAnneal: 4 };
    const walked = findAnnealingSites(template, 'circular', primer, options);
    expect(walked.map((s) => s.range.start)).toEqual(Array<number>(11).fill(18));
    expect(walked.some((s) => s.range.end > template.length)).toBe(true);
    const index = buildAnnealIndex(template, 'circular', 3);
    expect(findAnnealingSites(template, 'circular', primer, options, index)).toEqual(walked);
  });
});

describe('preparePrimers', () => {
  it('cleans, names, and leaves out what is already kept', () => {
    const existing = [{ name: 'Primer 1', sequence: 'ACGTACGTAC' }];
    const { ready, duplicates, empty } = preparePrimers(existing, [
      { name: '', sequence: 'acgu acgt', notes: ' n ' },
      { name: 'Primer 1', sequence: 'ACGTACGTAC', notes: '' },
      { name: 'Other', sequence: 'ACGTACGTAC', notes: '' },
      { name: 'x', sequence: '1234', notes: '' },
      { name: 'Other', sequence: 'ACGTACGTAC', notes: 'again' },
      { name: '', sequence: 'GGGGCCCC', notes: '' },
    ]);
    expect(ready).toEqual([
      { name: 'Primer 2', sequence: 'ACGTACGT', notes: 'n' },
      { name: 'Other', sequence: 'ACGTACGTAC', notes: '' },
      { name: 'Primer 3', sequence: 'GGGGCCCC', notes: '' },
    ]);
    expect(duplicates).toBe(2);
    expect(empty).toBe(1);
  });

  it('names from the first free number', () => {
    expect(nextPrimerName(new Set())).toBe('Primer 1');
    expect(nextPrimerName(new Set(['Primer 1', 'Primer 3']))).toBe('Primer 2');
  });
});

describe('primerFromFeature', () => {
  const doc = {
    featureSequence: (f: { strand: string }) => (f.strand === 'forward' ? 'ACGTTGCA' : 'TTTTGGGG'),
  };
  const feature = (qualifiers: { name: string; value: string }[], strand: 'forward' | 'reverse') =>
    createFeature({
      type: 'primer_bind',
      name: 'M13F',
      strand,
      segments: [rangeSegment(0, 8)],
      qualifiers,
    });

  it('takes the oligo from a sequence note, tail and all, and keeps the other notes', () => {
    expect(
      primerFromFeature(
        doc,
        feature(
          [
            { name: 'note', value: 'sequence: GGATCCacgttgca' },
            { name: 'note', value: 'from the 2019 order' },
          ],
          'forward',
        ),
      ),
    ).toEqual({ name: 'M13F', sequence: 'GGATCCACGTTGCA', notes: 'from the 2019 order' });
    expect(
      primerFromFeature(
        doc,
        feature([{ name: 'note', value: 'PCR primer: AAGCTT (6 bp 5′ tail)' }], 'reverse'),
      )?.sequence,
    ).toBe('AAGCTT');
  });

  it('reads the bases under the feature along its strand when no note says', () => {
    expect(primerFromFeature(doc, feature([], 'forward'))?.sequence).toBe('ACGTTGCA');
    expect(primerFromFeature(doc, feature([], 'reverse'))?.sequence).toBe('TTTTGGGG');
    expect(
      primerFromFeature(doc, feature([{ name: 'note', value: 'sequence: ' }], 'forward')),
    ).toEqual({ name: 'M13F', sequence: 'ACGTTGCA', notes: 'sequence:' });
  });
});

describe('asPrimerSequence', () => {
  it('takes bases written the ways a paper or an order writes them', () => {
    expect(asPrimerSequence("5'-GTAAAACGACGGCCAGT-3'")).toBe('GTAAAACGACGGCCAGT');
    expect(asPrimerSequence('5′-gta aaa cga cgg cca gt-3′')).toBe('GTAAAACGACGGCCAGT');
    expect(asPrimerSequence('ACGUACGU')).toBe('ACGTACGT');
    expect(asPrimerSequence('NNKNNKNNK')).toBe('NNKNNKNNK');
  });

  it('refuses names and anything too short to be told from one', () => {
    expect(asPrimerSequence('GAPDH-F')).toBeNull();
    expect(asPrimerSequence('M13F')).toBeNull();
    expect(asPrimerSequence('ACGTACG')).toBeNull();
    expect(asPrimerSequence('')).toBeNull();
  });
});

describe('parsePrimerList', () => {
  it('reads FASTA, with notes after the name and bases over several lines', () => {
    const parsed = parsePrimerList(
      '>M13F universal forward\nGTAAAACG\nACGGCCAGT\n\n>M13R\nCAGGAAACAGCTATGAC\n>empty\n',
    );
    expect(parsed.format).toBe('fasta');
    expect(parsed.primers).toEqual([
      { name: 'M13F', sequence: 'GTAAAACGACGGCCAGT', notes: 'universal forward' },
      { name: 'M13R', sequence: 'CAGGAAACAGCTATGAC', notes: '' },
    ]);
    expect(parsed.skipped).toEqual([7]);
  });

  it('reads a CSV with a header, in any column order, quoted cells and all', () => {
    const parsed = parsePrimerList(
      'Notes,Sequence,Name\r\n"lab stock, box 3",GTAAAACGACGGCCAGT,M13F\r\n"said ""old""",CAGGAAACAGCTATGAC,M13R\r\nnothing,,x\r\n',
    );
    expect(parsed.format).toBe('table');
    expect(parsed.primers).toEqual([
      { name: 'M13F', sequence: 'GTAAAACGACGGCCAGT', notes: 'lab stock, box 3' },
      { name: 'M13R', sequence: 'CAGGAAACAGCTATGAC', notes: 'said "old"' },
    ]);
    expect(parsed.skipped).toEqual([4]);
  });

  it('reads a table pasted from a spreadsheet, without a header', () => {
    const parsed = parsePrimerList(
      'M13F\tGTAAAACGACGGCCAGT\tuniversal\tbox 3\nT7\tTAATACGACTCACTATAGGG\n',
    );
    expect(parsed.primers).toEqual([
      { name: 'M13F', sequence: 'GTAAAACGACGGCCAGT', notes: 'universal; box 3' },
      { name: 'T7', sequence: 'TAATACGACTCACTATAGGG', notes: '' },
    ]);
  });

  it('reads a semicolon table, as a spreadsheet saves one in much of Europe', () => {
    expect(parsePrimerList('name;sequence\nT7;TAATACGACTCACTATAGGG\n').primers).toEqual([
      { name: 'T7', sequence: 'TAATACGACTCACTATAGGG', notes: '' },
    ]);
  });

  it('reads a column of sequences, and lines of a name and its bases', () => {
    const parsed = parsePrimerList(
      'GTAAAACGACGGCCAGT\n  cagg aaac agct atga c \n# a comment\nT7 TAATACGACTCACTATAGGG promoter\nnot a primer\n',
    );
    expect(parsed.format).toBe('lines');
    expect(parsed.primers).toEqual([
      { name: '', sequence: 'GTAAAACGACGGCCAGT', notes: '' },
      { name: '', sequence: 'CAGGAAACAGCTATGAC', notes: '' },
      { name: 'T7', sequence: 'TAATACGACTCACTATAGGG', notes: 'promoter' },
    ]);
    expect(parsed.skipped).toEqual([5]);
  });

  it('reads nothing from nothing', () => {
    expect(parsePrimerList('').primers).toEqual([]);
    expect(parsePrimerList('\n\n').skipped).toEqual([]);
  });

  it('splits a row as CSV quotes it', () => {
    expect(splitRow('a, "b,c" ,"d""e"', ',')).toEqual(['a', 'b,c', 'd"e']);
  });
});

describe('writing the collection', () => {
  const primers = [
    { name: 'M13 F', sequence: 'GTAAAACGACGGCCAGT', notes: 'box 3, shelf "B"' },
    { name: 'T7', sequence: 'TAATACGACTCACTATAGGG', notes: '' },
    { name: 'NNK lib', sequence: 'NNKNNKACGTACGT', notes: 'two\nlines' },
  ];

  it('writes CSV that reads back exactly', () => {
    const csv = writePrimerCsv(primers);
    expect(csv.split('\r\n')[0]).toBe('name,sequence,notes');
    // A note over two lines stays one cell, quoted.
    expect(parsePrimerList(csv).primers).toEqual(primers);
  });

  it('writes FASTA that reads back, with spaces in names as underscores', () => {
    const fasta = writePrimerFasta(primers);
    expect(fasta.startsWith('>M13_F box 3, shelf "B"\nGTAAAACGACGGCCAGT\n')).toBe(true);
    expect(parsePrimerList(fasta).primers).toEqual([
      { name: 'M13_F', sequence: 'GTAAAACGACGGCCAGT', notes: 'box 3, shelf "B"' },
      { name: 'T7', sequence: 'TAATACGACTCACTATAGGG', notes: '' },
      { name: 'NNK_lib', sequence: 'NNKNNKACGTACGT', notes: 'two lines' },
    ]);
  });
});
