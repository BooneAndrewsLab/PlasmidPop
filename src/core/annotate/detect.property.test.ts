import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { type Topology } from '../range';
import { reverseComplement } from '../sequence';
import {
  type FeatureHit,
  MIN_IDENTITY_CHOICES,
  MIN_PARTIAL_BASES,
  MIN_PARTIAL_SHARE,
  detectFeatures,
  mismatchBudget,
} from './detect';
import { type FeatureLibrary, type LibraryPart } from './library';

/**
 * Detect features against a slow listing (item 59): every placement of every
 * part on both strands checked base by base, reduced by the rules of
 * `keepBest` as its comment states them.
 */

/** The definite bases each IUPAC code stands for. */
const CODES: Readonly<Record<string, string>> = {
  A: 'A',
  C: 'C',
  G: 'G',
  T: 'T',
  R: 'AG',
  Y: 'CT',
  S: 'CG',
  W: 'AT',
  K: 'GT',
  M: 'AC',
  B: 'CGT',
  D: 'AGT',
  H: 'ACT',
  V: 'ACG',
  N: 'ACGT',
};

function slowHits(sequence: string, topology: Topology, lib: FeatureLibrary, minIdentity: number) {
  const seq = sequence.toUpperCase();
  const n = seq.length;
  const hits: FeatureHit[] = [];
  lib.parts.forEach((p, part) => {
    const len = p.sequence.length;
    // A part longer than a linear sequence can still hang off both ends of
    // it; on a circle it would cover a base twice, so it is not looked for.
    if (len < 12 || (len > n && topology === 'circular')) return;
    const budget = mismatchBudget(len, minIdentity);
    for (const strand of ['forward', 'reverse'] as const) {
      const q = strand === 'forward' ? p.sequence : reverseComplement(p.sequence);
      // A placement is anywhere the part overlaps the sequence at all: on a
      // circle it starts inside it, on a linear sequence it may also hang
      // off either end, and then only the piece inside is compared (#94).
      const last = n - 1;
      const first = topology === 'circular' ? 0 : -(len - 1);
      for (let start = first; start <= last; start++) {
        const from = Math.max(0, start);
        const to = topology === 'circular' ? start + len : Math.min(start + len, n);
        const overlap = to - from;
        const whole = overlap === len && start >= 0;
        if (!whole && (overlap < MIN_PARTIAL_BASES || overlap < len * MIN_PARTIAL_SHARE)) continue;
        const allowed = whole ? budget : Math.min(budget, Math.floor((overlap / len) * budget));
        let mismatches = 0;
        let ambiguous = 0;
        for (let i = from - start; i < to - start; i++) {
          const t = seq.charAt((start + i) % n);
          const b = q.charAt(i);
          if (t === b) continue;
          if ((CODES[t] ?? '').includes(b)) ambiguous++;
          else mismatches++;
        }
        if (mismatches + ambiguous > allowed) continue;
        hits.push({
          part,
          range: { start: from, end: to },
          strand,
          mismatches,
          ambiguous,
          identity: (overlap - mismatches - ambiguous) / overlap,
          ...(start < 0 ? { partialStart: true } : {}),
          ...(start + len > to ? { partialEnd: true } : {}),
        });
      }
    }
  });
  return hits;
}

function sharedBases(a: FeatureHit, b: FeatureHit, n: number): number {
  const bases = new Set<number>();
  for (let p = a.range.start; p < a.range.end; p++) bases.add(p % n);
  let shared = 0;
  for (let p = b.range.start; p < b.range.end; p++) if (bases.has(p % n)) shared++;
  return shared;
}

function slowKeepBest(hits: FeatureHit[], lib: FeatureLibrary, n: number): FeatureHit[] {
  const size = (h: FeatureHit) => h.range.end - h.range.start;
  const matched = (h: FeatureHit) => size(h) - h.mismatches - h.ambiguous;
  const strandRank = (h: FeatureHit) => (h.strand === 'forward' ? 0 : 1);
  const ranked = [...hits].sort(
    (x, y) =>
      size(y) - size(x) ||
      matched(y) - matched(x) ||
      strandRank(x) - strandRank(y) ||
      x.part - y.part ||
      x.range.start - y.range.start,
  );
  const kept: FeatureHit[] = [];
  for (const h of ranked) {
    const type = lib.parts[h.part]?.type;
    const displaced = kept.some((k) =>
      k.part === h.part
        ? sharedBases(k, h, n) > 0
        : lib.parts[k.part]?.type === type &&
          k.identity >= h.identity &&
          sharedBases(k, h, n) >= 0.9 * size(h),
    );
    if (!displaced) kept.push(h);
  }
  return kept.sort((x, y) => x.range.start - y.range.start || size(y) - size(x));
}

const baseArb = fc.constantFrom('A', 'C', 'G', 'T');
const dnaArb = (min: number, max: number) =>
  fc.array(baseArb, { minLength: min, maxLength: max, size: 'max' }).map((b) => b.join(''));

const pieceArb = fc.oneof(
  { arbitrary: dnaArb(0, 30).map((dna) => ({ kind: 'dna' as const, dna })), weight: 2 },
  {
    arbitrary: fc.record({
      kind: fc.constant('copy' as const),
      part: fc.integer({ min: 0, max: 2 }),
      reverse: fc.boolean(),
      /** A share of the part from its start or its end, to put partial copies at the ends. */
      trim: fc.oneof(
        { arbitrary: fc.constant(0), weight: 3 },
        { arbitrary: fc.integer({ min: -20, max: 20 }), weight: 1 },
      ),
      edits: fc.oneof(
        { arbitrary: fc.constant([]), weight: 2 },
        {
          arbitrary: fc.array(
            fc.record({ at: fc.nat(), code: fc.constantFrom(...Object.keys(CODES), 'X') }),
            { maxLength: 3 },
          ),
          weight: 3,
        },
      ),
    }),
    weight: 3,
  },
);

const caseArb = fc.record({
  parts: fc.tuple(dnaArb(12, 80), dnaArb(12, 40), dnaArb(10, 30)),
  /** The first part a repeat of a short unit, found at several overlapping offsets. */
  unit: fc.option(dnaArb(2, 7)),
  /** The second part a variant of the first. */
  variant: fc.option(fc.array(fc.nat(), { minLength: 1, maxLength: 2 })),
  /** The third part inside the first, with a few bases of its own, for the 90% rule. */
  inner: fc.option(
    fc.record({
      from: fc.nat(),
      len: fc.integer({ min: 12, max: 60 }),
      tail: fc.integer({ min: 0, max: 3 }),
    }),
  ),
  types: fc.tuple(
    fc.constantFrom('CDS', 'misc_feature'),
    fc.constantFrom('CDS', 'misc_feature'),
    fc.constantFrom('CDS', 'misc_feature'),
  ),
  pieces: fc.array(pieceArb, { minLength: 1, maxLength: 7, size: 'max' }),
  topology: fc.constantFrom<Topology>('linear', 'circular'),
  rotate: fc.nat(),
  lower: fc.boolean(),
  minIdentity: fc.constantFrom(...MIN_IDENTITY_CHOICES),
});

function libraryOf(sequences: readonly string[], types: readonly string[]): FeatureLibrary {
  return {
    parts: sequences.map((sequence, i): LibraryPart => ({
      name: `p${i}`,
      type: types[i] ?? 'misc_feature',
      category: 'other',
      sequence,
      accession: 'X00000.1',
      location: `1..${sequence.length}`,
      source: 'core',
    })),
  };
}

describe('detectFeatures, against a slow listing of every placement', () => {
  it('finds the hits the listing keeps, and no others', () => {
    const seen = { hits: 0, mismatched: 0, ambiguous: 0, overOrigin: 0, reverse: 0, reduced: 0 };
    fc.assert(
      fc.property(caseArb, (c) => {
        const [random, other, third] = c.parts;
        const a =
          c.unit === null ? random : c.unit.repeat(Math.ceil(random.length / c.unit.length));
        let b = other;
        if (c.variant !== null) {
          const bases = a.split('');
          for (const at of c.variant)
            bases[at % a.length] = bases[at % a.length] === 'A' ? 'C' : 'A';
          b = bases.join('');
        }
        let inner = third;
        if (c.inner !== null) {
          const from = c.inner.from % (a.length - 11);
          inner = a.slice(from, from + c.inner.len) + third.slice(0, c.inner.tail);
        }
        const lib = libraryOf([a, b, inner], c.types);
        let seq = '';
        for (const piece of c.pieces) {
          if (piece.kind === 'dna') {
            seq += piece.dna;
            continue;
          }
          let bases = (lib.parts[piece.part]?.sequence ?? '').split('');
          for (const e of piece.edits) bases[e.at % bases.length] = e.code;
          if (piece.trim > 0) bases = bases.slice(piece.trim);
          else if (piece.trim < 0) bases = bases.slice(0, piece.trim);
          const copy = bases.join('');
          seq += piece.reverse ? reverseComplement(copy) : copy;
        }
        if (seq.length > 0) {
          const r = c.rotate % seq.length;
          seq = seq.slice(r) + seq.slice(0, r);
        }
        if (c.lower) seq = seq.toLowerCase();
        const got = detectFeatures(seq, c.topology, lib, { minIdentity: c.minIdentity });
        const all = slowHits(seq, c.topology, lib, c.minIdentity);
        expect(got).toEqual(slowKeepBest(all, lib, seq.length));
        seen.hits += got.length;
        if (got.length < all.length) seen.reduced++;
        for (const h of got) {
          if (h.mismatches > 0) seen.mismatched++;
          if (h.ambiguous > 0) seen.ambiguous++;
          if (h.range.end > seq.length) seen.overOrigin++;
          if (h.strand === 'reverse') seen.reverse++;
        }
      }),
      { seed: 59, numRuns: 300 },
    );
    // The cases must reach what they are meant to (the seed gives 462 hits,
    // 98 with mismatches, 39 ambiguous, 69 over the origin, 206 reverse, and
    // 92 cases where hits were dropped).
    expect(seen.hits).toBeGreaterThan(300);
    for (const [k, v] of Object.entries(seen)) expect(v, k).toBeGreaterThan(20);
  }, 120_000);
});
