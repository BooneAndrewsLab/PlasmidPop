import {
  type Feature,
  type FeatureLocation,
  type FeatureOrigin,
  type Qualifier,
  type Segment,
  type SequenceSpace,
  advanceCodonStart,
  isLocatedQualifier,
  keepLocatedWithinOwnSegments,
  moveFeature,
  rangeSegment,
  siteSegment,
} from '../features';
import { newId } from '../ids';
import { type Range } from '../range';
import { reverseComplement } from '../sequence';

/*
 * A piece of a feature remembers the feature it was cut from (#182), so that
 * ligation can put the pieces back together when, and only when, they meet
 * again exactly as they were. See `FeatureOrigin` and design note 73.
 *
 * Two coordinate systems meet here. A sequence's own (a source document, a
 * ligation product), and the original feature's: forward strand, base 0 the
 * first base of its reading. A placement ties them: the sequence position of
 * the original's base 0 (`at`), and whether the original reads along the
 * sequence or against it (`reverse`).
 */

interface Placement {
  readonly at: number;
  readonly reverse: boolean;
  readonly space: SequenceSpace;
}

const mod = (x: number, n: number): number => ((x % n) + n) % n;

/** A start in `space`, folded onto a circle; null off the ends of a linear one. */
function fold(start: number, length: number, space: SequenceSpace): number | null {
  if (space.topology === 'circular') return space.length === 0 ? null : mod(start, space.length);
  return start < 0 || start + length > space.length ? null : start;
}

/** A segment of the sequence in the original's own coordinates. */
function toOwn(seg: Segment, p: Placement): Segment | null {
  if (seg.kind === 'site') {
    const q = p.reverse ? p.at + 1 - seg.position : seg.position - p.at;
    return p.space.topology === 'circular' ? siteSegment(mod(q, p.space.length)) : siteSegment(q);
  }
  const length = seg.end - seg.start;
  const s = p.reverse ? p.at - (seg.end - 1) : seg.start - p.at;
  const start = p.space.topology === 'circular' ? mod(s, p.space.length) : s;
  return rangeSegment(start, start + length, {
    partialStart: p.reverse ? seg.partialEnd : seg.partialStart,
    partialEnd: p.reverse ? seg.partialStart : seg.partialEnd,
  });
}

/** A segment of the original's own coordinates on the sequence; null off a linear one. */
function fromOwn(seg: Segment, p: Placement): Segment | null {
  if (seg.kind === 'site') {
    const q = p.reverse ? p.at + 1 - seg.position : p.at + seg.position;
    const folded = fold(q, 0, p.space);
    return folded === null ? null : siteSegment(folded);
  }
  const length = seg.end - seg.start;
  const start = fold(p.reverse ? p.at - seg.end + 1 : p.at + seg.start, length, p.space);
  if (start === null) return null;
  return rangeSegment(start, start + length, {
    partialStart: p.reverse ? seg.partialEnd : seg.partialStart,
    partialEnd: p.reverse ? seg.partialStart : seg.partialEnd,
  });
}

/** `map` applied to a location, turned round when the placement is. */
function relocate(
  location: FeatureLocation,
  p: Placement,
  map: (seg: Segment, p: Placement) => Segment | null,
): FeatureLocation | null {
  const segments: Segment[] = [];
  for (const seg of location.segments) {
    const next = map(seg, p);
    if (next === null) return null;
    segments.push(next);
  }
  if (p.reverse) segments.reverse();
  const strand = p.reverse
    ? location.strand === 'forward'
      ? 'reverse'
      : 'forward'
    : location.strand;
  return { strand, segments };
}

function rangesOf(feature: Feature): { start: number; end: number }[] | null {
  const out: { start: number; end: number }[] = [];
  for (const seg of feature.segments) {
    if (seg.kind !== 'range') return null;
    out.push(seg);
  }
  return out.length === 0 ? null : out;
}

function ownSpace(span: number): SequenceSpace {
  return { length: span, topology: 'linear' };
}

/** FNV-1a over the bases, case folded: what an intron of a piece is checked against. */
export function basesHash(text: string): number {
  let h = 0x811c9dc5;
  const upper = text.toUpperCase();
  for (let i = 0; i < upper.length; i++) {
    h ^= upper.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}

/** The bases `[start, end)` of the original's own space, read 5′ to 3′ on the sequence. */
function ownBases(
  start: number,
  end: number,
  p: Placement,
  bases: (r: Range) => string,
): string | null {
  if (end <= start) return '';
  const seg = fromOwn(rangeSegment(start, end), p);
  if (seg?.kind !== 'range') return null;
  const text = bases({ start: seg.start, end: seg.end });
  return p.reverse ? reverseComplement(text) : text;
}

/**
 * The record a piece of `feature` keeps of it, `feature` being whole on the
 * sequence `space` whose bases `bases` reads. Null for a feature that cannot
 * be laid out on its own: one with a site, or with segments that overlap or
 * run backwards (trans-splicing), which is then never joined back.
 */
export function originRecord(
  feature: Feature,
  space: SequenceSpace,
  bases: (r: Range) => string,
): Omit<FeatureOrigin, 'from' | 'to'> | null {
  const ranges = rangesOf(feature);
  const first = ranges?.[0];
  const last = ranges?.[ranges.length - 1];
  if (ranges === null || first === undefined || last === undefined) return null;
  const reverse = feature.strand === 'reverse';
  const fivePrime = reverse ? last.end - 1 : first.start;
  const at = space.topology === 'circular' ? mod(fivePrime, space.length) : fivePrime;
  const raw = relocate(feature, { at, reverse, space }, toOwn);
  if (raw === null) return null;
  // Segments read 5' to 3' usually run on along the sequence, round a
  // circle if need be. A join on a linear molecule may also step back
  // (`join(88..93,4..14)`); its own space then starts at the lowest base.
  let low = 0;
  let span = 0;
  for (const seg of raw.segments) {
    if (seg.kind !== 'range') return null;
    low = Math.min(low, seg.start);
    span = Math.max(span, seg.end);
  }
  const p: Placement = { at: reverse ? at - low : at + low, reverse, space };
  const own = relocate(feature, p, toOwn);
  if (own === null) return null;
  span -= low;
  const moved = moveFeature(feature, space, ownSpace(span), (loc) => relocate(loc, p, toOwn));
  if (moved === null) return null;
  const { origin: _origin, ...rest } = moved;
  const whole: Feature = { ...rest, id: feature.id, strand: 'forward', segments: own.segments };
  // An intron's bases, so that pieces cut apart in it join back only across
  // the same ones. A join that steps back has none between those two.
  const gaps: number[] = [];
  for (let i = 1; i < own.segments.length; i++) {
    const a = own.segments[i - 1];
    const b = own.segments[i];
    if (a?.kind !== 'range' || b?.kind !== 'range') return null;
    const text = ownBases(a.end, b.start, p, bases);
    if (text === null) return null;
    gaps.push(basesHash(text));
  }
  return { key: feature.id, whole, span, gaps };
}

/** Bases in the original's range segments, laid end to end. */
function totalOf(origin: FeatureOrigin): number {
  return origin.whole.segments.reduce((n, s) => n + (s.kind === 'range' ? s.end - s.start : 0), 0);
}

/**
 * The bases `[from, to)` of the original (along its own bases from the 5′
 * end) as a feature of its own space, as cutting it there would leave them:
 * cut sides partial, `/translation` gone, located qualifiers only where
 * their bases are kept, and a CDS read from its first whole codon.
 */
function ownPiece(origin: FeatureOrigin, from: number, to: number): Feature {
  const total = totalOf(origin);
  if (from === 0 && to === total) return origin.whole;
  const segments: Segment[] = [];
  let along = 0;
  for (const seg of origin.whole.segments) {
    if (seg.kind !== 'range') continue;
    const length = seg.end - seg.start;
    const s = Math.max(from, along);
    const e = Math.min(to, along + length);
    if (e > s) {
      const start = seg.start + s - along;
      const end = seg.start + e - along;
      segments.push(
        rangeSegment(start, end, {
          partialStart: seg.partialStart || (segments.length === 0 && from > 0),
          partialEnd: seg.partialEnd || (e === to && to < total),
        }),
      );
    }
    along += length;
  }
  const piece: Feature = {
    ...origin.whole,
    segments,
    qualifiers: origin.whole.qualifiers.filter((q) => q.name !== 'translation'),
  };
  return advanceCodonStart(
    keepLocatedWithinOwnSegments(piece, ownSpace(origin.span)),
    from,
    origin.whole,
  );
}

/** `feature` on the sequence of `p`, or null when some of it falls off a linear one. */
function place(feature: Feature, p: Placement, span: number): Feature | null {
  const moved = moveFeature(feature, ownSpace(span), p.space, (loc) => relocate(loc, p, fromOwn));
  return moved === null ? null : { ...moved, strand: p.reverse ? 'reverse' : 'forward' };
}

/** The original's own position of the base `along` its bases from the 5′ end. */
function ownPosition(origin: FeatureOrigin, along: number): number | null {
  let acc = 0;
  for (const seg of origin.whole.segments) {
    if (seg.kind !== 'range') continue;
    const length = seg.end - seg.start;
    if (along < acc + length) return seg.start + along - acc;
    acc += length;
  }
  return null;
}

/** The bases a feature covers as runs of (start, length), abutting segments merged, folded on a circle. */
function coverage(feature: Feature, space: SequenceSpace): string {
  const runs: [number, number][] = [];
  for (const seg of feature.segments) {
    if (seg.kind !== 'range') return '';
    const start = space.topology === 'circular' ? mod(seg.start, space.length) : seg.start;
    const prev = runs[runs.length - 1];
    if (
      prev !== undefined &&
      (space.topology === 'circular'
        ? mod(prev[0] + prev[1], space.length) === start
        : prev[0] + prev[1] === start)
    ) {
      prev[1] += seg.end - seg.start;
    } else runs.push([start, seg.end - seg.start]);
  }
  return JSON.stringify(runs);
}

function isOrigin(value: unknown): value is FeatureOrigin {
  if (typeof value !== 'object' || value === null) return false;
  const o = value as Record<string, unknown>;
  const whole = o['whole'] as Record<string, unknown> | null | undefined;
  return (
    typeof o['key'] === 'string' &&
    typeof o['span'] === 'number' &&
    typeof o['from'] === 'number' &&
    typeof o['to'] === 'number' &&
    Array.isArray(o['gaps']) &&
    typeof whole === 'object' &&
    whole !== null &&
    Array.isArray(whole['segments']) &&
    Array.isArray(whole['qualifiers'])
  );
}

/**
 * Where on `space` the original of `piece` would lie for the piece to be
 * the bases it says it is: the placement, or null when the piece no longer
 * matches its record (an edit since the cut added or took bases) or has none.
 */
export function placementOf(piece: Feature, space: SequenceSpace): Placement | null {
  const origin = piece.origin;
  if (!isOrigin(origin) || origin.from < 0 || origin.to <= origin.from) return null;
  if (origin.to > totalOf(origin)) return null;
  const ranges = rangesOf(piece);
  const first = ranges?.[0];
  const last = ranges?.[ranges.length - 1];
  const own = ownPosition(origin, origin.from);
  if (first === undefined || last === undefined || own === null) return null;
  const reverse = piece.strand === 'reverse';
  const raw = reverse ? last.end - 1 + own : first.start - own;
  const at = space.topology === 'circular' ? mod(raw, space.length) : raw;
  const p: Placement = { at, reverse, space };
  const expected = place(ownPiece(origin, origin.from, origin.to), p, origin.span);
  if (expected === null || coverage(expected, space) !== coverage(piece, space)) return null;
  return p;
}

/**
 * The record for a piece holding the bases `[from, to)` of `feature`
 * (counted from its 5′ end along its own bases), `feature` lying whole on
 * `space`. A feature that is itself a piece passes its own record on, so
 * every piece names the first feature cut; one edited since its cut is
 * taken as a feature in its own right. Null when no record can be made.
 */
export function pieceOrigin(
  feature: Feature,
  from: number,
  to: number,
  space: SequenceSpace,
  bases: (r: Range) => string,
): FeatureOrigin | null {
  const own = feature.origin;
  if (own !== undefined && placementOf(feature, space) !== null) {
    return { ...own, from: own.from + from, to: own.from + to };
  }
  const record = originRecord(feature, space, bases);
  return record === null ? null : { ...record, from, to };
}

/** `feature` with `origin` as its record, or with none. */
export function withOrigin(feature: Feature, origin: FeatureOrigin | null): Feature {
  if (origin !== null) return { ...feature, origin };
  if (feature.origin === undefined) return feature;
  const { origin: _dropped, ...rest } = feature;
  return rest;
}

/** The qualifiers a piece shares with its original: all but those a cut gives each piece its own of. */
function shared(qualifiers: readonly Qualifier[]): string {
  return JSON.stringify(
    qualifiers
      .filter(
        (q) => q.name !== 'codon_start' && q.name !== 'translation' && !isLocatedQualifier(q.name),
      )
      .map((q) => [q.name, q.value]),
  );
}

/** Whether a piece still is what its cut left: same kind of feature, name and qualifiers. */
function unchanged(piece: Feature, origin: FeatureOrigin): boolean {
  const whole = origin.whole;
  return (
    piece.type === whole.type &&
    piece.name === whole.name &&
    piece.joining === whole.joining &&
    shared(piece.qualifiers) === shared(whole.qualifiers)
  );
}

interface Candidate {
  readonly index: number;
  readonly piece: Feature;
  readonly origin: FeatureOrigin;
  readonly placement: Placement;
}

/**
 * The features of a sequence (`space`, bases `sequence`) with the pieces of
 * one original that meet again exactly as they were cut put back together
 * (#182). Two pieces join when one holds the original's bases just before
 * the other's, both lie where one placement of the original puts them (so
 * no base was lost or gained between them), on the same strand, and any
 * intron the cut fell in has its own bases back. Pieces that add up to the
 * whole original give the original back, `/translation`, `/transl_except`
 * and all; fewer give one larger piece. Everything else is left as it is.
 */
export function rejoinPieces(
  features: readonly Feature[],
  space: SequenceSpace,
  sequence: string,
): Feature[] {
  const candidates: Candidate[] = [];
  features.forEach((piece, index) => {
    const origin = piece.origin;
    if (origin === undefined) return;
    const placement = placementOf(piece, space);
    if (placement === null || !unchanged(piece, origin)) return;
    candidates.push({ index, piece, origin, placement });
  });
  if (candidates.length < 2) return [...features];
  const bases = (r: Range): string =>
    r.end <= space.length
      ? sequence.slice(r.start, r.end)
      : sequence.slice(r.start) + sequence.slice(0, r.end - space.length);

  // Whether `b` carries on exactly where `a` stops.
  const follows = (a: Candidate, b: Candidate): boolean => {
    if (a.origin.key !== b.origin.key || a.origin.to !== b.origin.from) return false;
    if (a.placement.reverse !== b.placement.reverse || a.placement.at !== b.placement.at)
      return false;
    // A cut between two segments of the original: the bases between must be its intron's.
    let along = 0;
    const segs = a.origin.whole.segments;
    for (let i = 0; i < segs.length - 1; i++) {
      const seg = segs[i];
      const next = segs[i + 1];
      if (seg?.kind !== 'range' || next?.kind !== 'range') return false;
      along += seg.end - seg.start;
      if (along === a.origin.to) {
        const text = ownBases(seg.end, next.start, a.placement, bases);
        return text !== null && basesHash(text) === a.origin.gaps[i];
      }
    }
    return true;
  };

  const used = new Set<number>();
  const next = new Map<number, Candidate>();
  const hasPrevious = new Set<number>();
  for (const a of candidates) {
    const b = candidates.find(
      (c) => c.index !== a.index && !hasPrevious.has(c.index) && follows(a, c),
    );
    if (b === undefined) continue;
    next.set(a.index, b);
    hasPrevious.add(b.index);
  }
  const out = new Map<number, Feature>();
  for (const head of candidates) {
    if (hasPrevious.has(head.index) || !next.has(head.index)) continue;
    let tail = head;
    used.add(head.index);
    for (let n = next.get(tail.index); n !== undefined; n = next.get(tail.index)) {
      tail = n;
      used.add(n.index);
    }
    const { origin, placement } = head;
    const from = origin.from;
    const to = tail.origin.to;
    const joined = place(ownPiece(origin, from, to), placement, origin.span);
    if (joined === null) {
      // Cannot happen for pieces that each placed; leave them be if it does.
      for (let c: Candidate | undefined = head; c !== undefined; c = next.get(c.index)) {
        used.delete(c.index);
      }
      continue;
    }
    const whole = from === 0 && to === totalOf(origin);
    out.set(
      head.index,
      withOrigin({ ...joined, id: newId() }, whole ? null : { ...origin, from, to }),
    );
  }
  const result: Feature[] = [];
  features.forEach((f, i) => {
    const joined = out.get(i);
    if (joined !== undefined) result.push(joined);
    else if (!used.has(i)) result.push(f);
  });
  return result;
}
