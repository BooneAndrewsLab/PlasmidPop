import fc from 'fast-check';

import {
  type CutSite,
  type DocumentEnds,
  type Enzyme,
  type Feature,
  type Topology,
  SeqDocument,
  createFeature,
  findCutSites,
  getEnzyme,
  rangeSegment,
} from '@/core';

import {
  type DigestFragment,
  type FragmentEnd,
  digest,
  partialDigest,
  partialDigestSize,
} from './digest';

/**
 * Partial digests (`partialDigest`, `partialDigestSize`) checked against a
 * plain enumeration of the stretches between stops, on random linear and
 * circular molecules cut both by real enzymes (`findCutSites`, Type IIS and
 * 3′ cutters among them) and by synthetic cut lists with arbitrary overhangs,
 * duplicate cuts and cuts at the very ends:
 *
 * - without a limit there are exactly `partialDigestSize` pieces, one per
 *   ordered pair of stops (linear: both molecule ends are stops; circular:
 *   every cut to every cut, itself included once round);
 * - each piece's bases are the source's over its range, unrolled round the
 *   origin; `uncut` is the number of distinct cuts strictly inside it;
 * - its ends are the ones the enzyme at each stop makes, worked out here from
 *   the two cut positions, or the document's own at a linear molecule's ends;
 * - the pieces with `uncut` 0 are the complete digest, as a multiset;
 * - features come out covering exactly the source bases they covered inside
 *   the piece, on the same strand, and nowhere else;
 * - `limit` keeps min(limit, total) pieces, the ones missing fewest sites
 *   and longest among equals, sorted longest first.
 *
 * Small exhaustive cases (every cut set on a short molecule) sit alongside
 * the random ones so the corners never depend on the generator.
 */

function must<T>(value: T | null | undefined, what: string): T {
  if (value === null || value === undefined) throw new Error(`expected ${what}`);
  return value;
}

const ENZYME_NAMES = ['EcoRI', 'BamHI', 'PstI', 'SmaI', 'KpnI', 'BsaI', 'NotI', 'HindIII', 'SapI'];
const ENZYMES: readonly Enzyme[] = ENZYME_NAMES.map((n) => must(getEnzyme(n), n));
const SITES = [
  'GAATTC',
  'GGATCC',
  'CTGCAG',
  'CCCGGG',
  'GGTACC',
  'GGTCTC',
  'GCGGCCGC',
  'AAGCTT',
  'GCTCTTC',
];

// ------------------------------------------------------------------ oracle

interface Expected {
  readonly start: number;
  readonly end: number;
  readonly uncut: number;
  readonly sequence: string;
  readonly left: FragmentEnd;
  readonly right: FragmentEnd;
}

const mod = (x: number, n: number): number => ((x % n) + n) % n;

/** The bases from `start` to `end`, running on round a circle. */
function unrolled(seq: string, start: number, end: number, topology: Topology): string {
  if (topology === 'linear') return seq.slice(start, end);
  let out = '';
  for (let i = start; i < end; i++) out += seq.charAt(mod(i, seq.length));
  return out;
}

/**
 * The end an enzyme leaves: which strand runs on, and over which bases. On a
 * circle the bottom cut is taken on whichever side of the top cut is nearer.
 */
function endOf(seq: string, topology: Topology, site: CutSite): FragmentEnd {
  const L = seq.length;
  let d = site.cutBottom - site.cut;
  if (topology === 'circular') {
    d = mod(d, L);
    if (d > L / 2) d -= L;
  }
  if (d === 0) return { kind: 'blunt', overhang: '', enzyme: site.enzyme };
  const from = Math.min(site.cut, site.cut + d);
  return {
    kind: d > 0 ? "5'" : "3'",
    overhang: unrolled(
      seq,
      topology === 'circular' ? mod(from, L) : from,
      (topology === 'circular' ? mod(from, L) : from) + Math.abs(d),
      topology,
    ),
    enzyme: site.enzyme,
  };
}

/** One site per cut position, the first by name; a linear molecule's ends are no cut. */
function stopsOf(sites: readonly CutSite[], L: number, topology: Topology): Map<number, CutSite> {
  const byCut = new Map<number, CutSite>();
  const order = [...sites].sort((a, b) => a.cut - b.cut || a.enzyme.localeCompare(b.enzyme));
  for (const s of order) {
    if (topology === 'linear' && (s.cut <= 0 || s.cut >= L)) continue;
    const at = topology === 'circular' ? mod(s.cut, L) : s.cut;
    if (!byCut.has(at)) byCut.set(at, s);
  }
  return byCut;
}

function expectedPieces(doc: SeqDocument, sites: readonly CutSite[]): Expected[] {
  const seq = doc.sequence.toString();
  const L = seq.length;
  if (L === 0) return [];
  const stops = stopsOf(sites, L, doc.topology);
  const cuts = [...stops.keys()].sort((a, b) => a - b);
  const inside = (start: number, end: number): number =>
    cuts.filter((c) =>
      doc.topology === 'linear'
        ? c > start && c < end
        : [c, c + L, c + 2 * L].some((u) => u > start && u < end),
    ).length;
  const end = (at: number, side: 'left' | 'right'): FragmentEnd => {
    const site = stops.get(doc.topology === 'circular' ? mod(at, L) : at);
    if (site !== undefined) return endOf(seq, doc.topology, site);
    const natural: DocumentEnds = doc.ends ?? {
      left: { kind: 'blunt', overhang: '', enzyme: null },
      right: { kind: 'blunt', overhang: '', enzyme: null },
    };
    return side === 'left' ? natural.left : natural.right;
  };
  const out: Expected[] = [];
  const add = (start: number, stop: number): void => {
    out.push({
      start,
      end: stop,
      uncut: inside(start, stop),
      sequence: unrolled(seq, start, stop, doc.topology),
      left: end(start, 'left'),
      right: end(stop, 'right'),
    });
  };
  if (doc.topology === 'linear') {
    const all = [0, ...cuts, L];
    for (let i = 0; i < all.length; i++)
      for (let j = i + 1; j < all.length; j++) add(must(all[i], 'stop'), must(all[j], 'stop'));
  } else {
    for (const a of cuts) {
      for (const b of cuts) add(a, b > a ? b : b + L);
    }
  }
  return out;
}

const key = (p: {
  range?: { start: number; end: number };
  start?: number;
  end?: number;
  uncut?: number;
}): string =>
  p.range !== undefined ? `${p.range.start}-${p.range.end}` : `${p.start ?? -1}-${p.end ?? -1}`;

function endKey(e: FragmentEnd): string {
  return `${e.kind}/${e.overhang}/${e.enzyme ?? '-'}`;
}

// ------------------------------------------------------------------ features

/** Source indices a feature covers. */
function sourceCover(f: Feature, L: number): Set<number> {
  const out = new Set<number>();
  for (const s of f.segments) {
    if (s.kind !== 'range') continue;
    for (let i = s.start; i < s.end; i++) out.add(mod(i, L));
  }
  return out;
}

/** Piece-local indices each named feature covers, as the oracle sees it. */
function expectedFeatureCover(
  doc: SeqDocument,
  start: number,
  end: number,
): Map<string, { strand: Feature['strand']; cover: number[] }> {
  const L = doc.length;
  const out = new Map<string, { strand: Feature['strand']; cover: number[] }>();
  for (const f of doc.features.all()) {
    const src = sourceCover(f, L);
    const cover: number[] = [];
    for (let i = start; i < end; i++) if (src.has(mod(i, L))) cover.push(i - start);
    if (cover.length > 0) out.set(f.name, { strand: f.strand, cover });
  }
  return out;
}

function actualFeatureCover(
  frag: DigestFragment,
): Map<string, { strand: Feature['strand']; cover: number[] }> {
  const out = new Map<string, { strand: Feature['strand']; cover: number[] }>();
  for (const f of frag.features) {
    const prev = out.get(f.name);
    if (prev !== undefined) expect(prev.strand).toBe(f.strand);
    const cover = new Set(prev?.cover ?? []);
    for (const s of f.segments) {
      if (s.kind !== 'range') continue;
      expect(s.start).toBeGreaterThanOrEqual(0);
      expect(s.end).toBeLessThanOrEqual(frag.sequence.length);
      for (let i = s.start; i < s.end; i++) cover.add(i);
    }
    out.set(f.name, { strand: f.strand, cover: [...cover].sort((a, b) => a - b) });
  }
  return out;
}

// ------------------------------------------------------------------ the check

function checkPartial(doc: SeqDocument, sites: readonly CutSite[], withFeatures: boolean): void {
  const want = expectedPieces(doc, sites);
  const got = partialDigest(doc, sites);
  expect(got.length).toBe(partialDigestSize(doc, sites));
  expect(got.length).toBe(want.length);
  expect(got.map(key).sort()).toEqual(want.map(key).sort());

  const byKey = new Map(want.map((w) => [key(w), w]));
  for (const p of got) {
    const w = must(byKey.get(key(p)), `an expected piece ${key(p)}`);
    expect(p.uncut, key(p)).toBe(w.uncut);
    expect(p.sequence, key(p)).toBe(w.sequence);
    expect(p.left, key(p)).toEqual(w.left);
    expect(p.right, key(p)).toEqual(w.right);
    expect(p.source).toBe(doc.name);
    if (withFeatures) {
      expect(actualFeatureCover(p), key(p)).toEqual(
        expectedFeatureCover(doc, p.range.start, p.range.end),
      );
    }
  }

  // Longest first; among equals, fewest missed sites, then leftmost.
  for (let i = 1; i < got.length; i++) {
    const a = must(got[i - 1], 'piece');
    const b = must(got[i], 'piece');
    const la = a.range.end - a.range.start;
    const lb = b.range.end - b.range.start;
    expect(
      la > lb ||
        (la === lb &&
          (a.uncut < b.uncut || (a.uncut === b.uncut && a.range.start <= b.range.start))),
    ).toBe(true);
  }

  // The complete digest is exactly the pieces that miss nothing.
  const complete = digest(doc, sites);
  const describe = (f: DigestFragment): string =>
    `${key(f)}|${f.sequence}|${endKey(f.left)}|${endKey(f.right)}`;
  expect(
    got
      .filter((p) => p.uncut === 0)
      .map(describe)
      .sort(),
  ).toEqual(complete.map(describe).sort());
}

function checkLimit(doc: SeqDocument, sites: readonly CutSite[], limit: number): void {
  const all = partialDigest(doc, sites);
  const kept = partialDigest(doc, sites, limit);
  expect(kept.length).toBe(Math.max(0, Math.min(limit, all.length)));
  // Each kept piece is one of the full list's, whole.
  const full = new Map(all.map((p) => [`${key(p)}:${p.uncut}`, p]));
  // Features get fresh ids each time a piece is cut out, so those are left out.
  const noIds = (p: DigestFragment | undefined) =>
    p === undefined ? p : { ...p, features: p.features.map(({ id: _id, ...f }) => f) };
  for (const p of kept) expect(noIds(p)).toEqual(noIds(full.get(`${key(p)}:${p.uncut}`)));
  // The best `limit` by (uncut asc, length desc): compare what the choice
  // looked at, since ties at the cut-off may go either way.
  const rank = (p: { uncut: number; range: { start: number; end: number } }): string =>
    `${String(p.uncut).padStart(4, '0')}:${String(100000 - (p.range.end - p.range.start)).padStart(6, '0')}`;
  const best = all.map(rank).sort().slice(0, kept.length);
  expect(kept.map(rank).sort()).toEqual(best);
  for (let i = 1; i < kept.length; i++) {
    const a = must(kept[i - 1], 'piece');
    const b = must(kept[i], 'piece');
    expect(a.range.end - a.range.start).toBeGreaterThanOrEqual(b.range.end - b.range.start);
  }
}

// ------------------------------------------------------------------ generators

const baseArb = fc.constantFrom('A', 'C', 'G', 'T');
const fillerArb = fc.string({ unit: baseArb, minLength: 0, maxLength: 25 });

/** A random molecule with real sites spliced in now and then. */
const realSeqArb = fc
  .array(
    fc.oneof(
      { arbitrary: fillerArb, weight: 2 },
      { arbitrary: fc.constantFrom(...SITES), weight: 1 },
    ),
    {
      minLength: 1,
      maxLength: 12,
    },
  )
  .map((chunks) => chunks.join(''))
  .filter((s) => s.length > 0);

interface FeatureSpec {
  readonly start: number;
  readonly span: number;
  readonly reverse: boolean;
}
const featureSpecArb: fc.Arbitrary<FeatureSpec> = fc.record({
  start: fc.nat(),
  span: fc.nat(),
  reverse: fc.boolean(),
});

function makeFeatures(specs: readonly FeatureSpec[], L: number, topology: Topology): Feature[] {
  return specs.map((s, i) => {
    const start = s.start % L;
    const max = topology === 'circular' ? L : L - start;
    const span = 1 + (s.span % max);
    return createFeature({
      id: `f${i}`,
      name: `feat${i}`,
      type: 'misc_feature',
      strand: s.reverse ? 'reverse' : 'forward',
      segments: [rangeSegment(start, start + span)],
    });
  });
}

const endsArb: fc.Arbitrary<DocumentEnds | null> = fc.oneof(
  fc.constant(null),
  fc.record({
    left: fc.constantFrom<FragmentEnd>(
      { kind: "5'", overhang: 'AATT', enzyme: 'EcoRI' },
      { kind: 'blunt', overhang: '', enzyme: 'SmaI' },
      { kind: "3'", overhang: 'TGCA', enzyme: 'PstI' },
    ),
    right: fc.constantFrom<FragmentEnd>(
      { kind: "5'", overhang: 'GATC', enzyme: 'BamHI' },
      { kind: 'blunt', overhang: '', enzyme: null },
    ),
  }),
);

const docArb = fc
  .record({
    sequence: realSeqArb,
    topology: fc.constantFrom<Topology>('linear', 'circular'),
    features: fc.array(featureSpecArb, { maxLength: 4 }),
    ends: endsArb,
  })
  .map(({ sequence, topology, features, ends }) =>
    SeqDocument.create({
      name: 'src',
      sequence,
      topology,
      features: makeFeatures(features, sequence.length, topology),
      ends,
    }),
  );

/** Cut sites made up outright: any top cut, a bottom cut up to 5 away, repeats allowed. */
function syntheticSites(
  doc: SeqDocument,
  raw: readonly (readonly [number, number, number])[],
): CutSite[] {
  const L = doc.length;
  return raw.map(([c, d, e]) => {
    const linear = doc.topology === 'linear';
    const cut = linear ? c % (L + 1) : c % L;
    const offset = (d % 11) - 5;
    const bottom = linear ? Math.max(0, Math.min(L, cut + offset)) : mod(cut + offset, L);
    return {
      enzyme: `E${e % 4}`,
      cut,
      cutBottom: bottom,
      siteStart: linear ? Math.min(cut, L - 1) : cut,
      strand: 'forward',
    };
  });
}

// ------------------------------------------------------------------ tests

describe('partialDigest, exhaustively on small molecules', () => {
  it('matches the enumeration for every cut set on 7 bp, linear and circular', () => {
    const seq = 'ACGTTGA';
    const L = seq.length;
    for (const topology of ['linear', 'circular'] as const) {
      const doc = SeqDocument.create({
        name: 's',
        sequence: seq,
        topology,
        features: makeFeatures(
          [
            { start: 0, span: 2, reverse: false },
            { start: 5, span: 3, reverse: true },
            { start: 2, span: 0, reverse: false },
          ],
          L,
          topology,
        ),
      });
      // Every subset of cut positions 0..L, each with a blunt, 5′ 1 or 3′ 1 cut.
      for (let mask = 0; mask < 1 << (L + 1); mask++) {
        const sites: CutSite[] = [];
        for (let c = 0; c <= L; c++) {
          if ((mask & (1 << c)) === 0) continue;
          const shape = (c + mask) % 3;
          const raw = shape === 0 ? c : shape === 1 ? c + 1 : c - 1;
          const cutBottom = topology === 'circular' ? mod(raw, L) : Math.max(0, Math.min(L, raw));
          sites.push({
            enzyme: `E${shape}`,
            cut: topology === 'circular' ? c % L : c,
            cutBottom,
            siteStart: Math.min(c, L - 1),
            strand: 'forward',
          });
        }
        checkPartial(doc, sites, true);
        if (mask % 5 === 0) for (const limit of [0, 1, 3, 1000]) checkLimit(doc, sites, limit);
      }
    }
  }, 20_000);

  it('gives nothing for an empty molecule or an uncut circle, and the whole of an uncut line', () => {
    const empty = SeqDocument.create({ sequence: '', topology: 'linear' });
    expect(partialDigest(empty, [])).toEqual([]);
    expect(partialDigestSize(empty, [])).toBe(0);
    const circle = SeqDocument.create({ sequence: 'ACGT', topology: 'circular' });
    expect(partialDigest(circle, [])).toEqual([]);
    expect(partialDigestSize(circle, [])).toBe(0);
    const line = SeqDocument.create({ sequence: 'ACGT', topology: 'linear' });
    const [whole, ...rest] = partialDigest(line, []);
    expect(rest).toEqual([]);
    expect(must(whole, 'the whole molecule')).toMatchObject({ sequence: 'ACGT', uncut: 0 });
    expect(partialDigestSize(line, [])).toBe(1);
  });
});

describe('partialDigest, random molecules', () => {
  it('matches the enumeration with real enzymes', () => {
    fc.assert(
      fc.property(docArb, (doc) => {
        const sites = findCutSites(doc.sequence.toString(), doc.topology, ENZYMES);
        checkPartial(doc, sites, true);
      }),
      { numRuns: 150 },
    );
  });

  it('matches the enumeration with synthetic cut lists', () => {
    fc.assert(
      fc.property(
        docArb,
        fc.array(fc.tuple(fc.nat(), fc.nat(), fc.nat()), { maxLength: 9 }),
        (doc, raw) => {
          checkPartial(doc, syntheticSites(doc, raw), true);
        },
      ),
      { numRuns: 150 },
    );
  });

  it('keeps the pieces that miss fewest sites under a limit', () => {
    fc.assert(
      fc.property(
        docArb,
        fc.array(fc.tuple(fc.nat(), fc.nat(), fc.nat()), { maxLength: 8 }),
        fc.integer({ min: -2, max: 90 }),
        (doc, raw, limit) => {
          checkLimit(doc, syntheticSites(doc, raw), limit);
          checkLimit(doc, findCutSites(doc.sequence.toString(), doc.topology, ENZYMES), limit);
        },
      ),
      { numRuns: 150 },
    );
  });
});
