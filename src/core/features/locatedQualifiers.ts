import { type Topology } from '../range';
import { type Feature, type Qualifier } from './feature';
import { type FeatureLocation, LocationError, formatLocation, parseLocation } from './location';
import { type Segment, segmentLength, shiftSegmentBy } from './segment';

/**
 * Qualifiers whose value opens with a location on the sequence,
 * `(pos:LOCATION,...)`: `/transl_except` (a codon read as something other
 * than the genetic code says) and `/anticodon` (a tRNA's anticodon). Their
 * positions are the record's own 1-based coordinates, like the feature's
 * location, so they have to move whenever the feature does, or an insertion
 * upstream leaves them pointing at the wrong bases.
 */
const LOCATED_QUALIFIERS: ReadonlySet<string> = new Set(['transl_except', 'anticodon']);

/** The length and shape of a sequence, which is what reading or writing a location needs. */
export interface SequenceSpace {
  readonly length: number;
  readonly topology: Topology;
}

/** A located qualifier's value taken apart: the location, and everything after its comma. */
export interface LocatedValue {
  readonly location: FeatureLocation;
  /** The rest of the value, verbatim: `aa:Sec`, or `aa:Phe,seq:gaa` for an anticodon. */
  readonly rest: string;
}

/**
 * Reads `(pos:LOCATION,REST)`, or returns null when the value is not in that
 * form or its location does not fit `space`. The location may itself hold
 * commas (`join(...)`), so it ends at the first comma outside parentheses.
 */
export function parseLocatedValue(value: string, space: SequenceSpace): LocatedValue | null {
  const text = value.replace(/\s+/g, '');
  if (!text.startsWith('(pos:') || !text.endsWith(')')) return null;
  const body = text.slice('(pos:'.length, -1);
  let depth = 0;
  let comma = -1;
  for (let i = 0; i < body.length && comma < 0; i++) {
    const c = body.charAt(i);
    if (c === '(') depth++;
    else if (c === ')') depth--;
    else if (c === ',' && depth === 0) comma = i;
  }
  if (comma <= 0) return null;
  try {
    const { strand, segments } = parseLocation(body.slice(0, comma), space.length, space.topology);
    return { location: { strand, segments }, rest: body.slice(comma + 1) };
  } catch (e) {
    if (e instanceof LocationError) return null;
    throw e;
  }
}

export function formatLocatedValue(value: LocatedValue, space: SequenceSpace): string {
  return `(pos:${formatLocation(value.location, space.length, space.topology)},${value.rest})`;
}

function locationLength(location: FeatureLocation): number {
  let total = 0;
  for (const seg of location.segments) total += segmentLength(seg);
  return total;
}

/**
 * Moves a feature — its location and the locations its qualifiers hold —
 * from one sequence to another: the same document before and after an edit,
 * or a fragment and the document it lands in. `move` says where one
 * location goes, or returns null when none of it survives, and the feature
 * is then gone (null).
 *
 * A located qualifier that moves to a different number of bases (an edit
 * inside the codon it names, an extract that cuts it) no longer means what
 * it said and is dropped. One whose value we cannot read is kept as it was:
 * losing it would be worse than leaving it unmoved.
 */
export function moveFeature(
  feature: Feature,
  from: SequenceSpace,
  to: SequenceSpace,
  move: (location: FeatureLocation) => FeatureLocation | null,
): Feature | null {
  const own = move(feature);
  if (own === null) return null;
  let qualifiers = feature.qualifiers;
  if (feature.qualifiers.some((q) => LOCATED_QUALIFIERS.has(q.name))) {
    const moved: Qualifier[] = [];
    let changed = false;
    for (const q of feature.qualifiers) {
      const next = moveQualifier(q, from, to, move);
      if (next !== q) changed = true;
      if (next !== null) moved.push(next);
    }
    if (changed) qualifiers = moved;
  }
  if (
    own.strand === feature.strand &&
    own.segments === feature.segments &&
    qualifiers === feature.qualifiers
  ) {
    return feature;
  }
  return { ...feature, strand: own.strand, segments: own.segments, qualifiers };
}

function moveQualifier(
  q: Qualifier,
  from: SequenceSpace,
  to: SequenceSpace,
  move: (location: FeatureLocation) => FeatureLocation | null,
): Qualifier | null {
  if (!LOCATED_QUALIFIERS.has(q.name) || q.value === null) return q;
  const parsed = parseLocatedValue(q.value, from);
  if (parsed === null) return q;
  const location = move(parsed.location);
  if (location === null || locationLength(location) !== locationLength(parsed.location)) {
    return null;
  }
  const value = formatLocatedValue({ location, rest: parsed.rest }, to);
  return value === q.value ? q : { name: q.name, value };
}

/**
 * A `move` for `moveFeature` that maps each segment on its own, dropping the
 * ones `fn` returns null for. Keeps the segments array when nothing changed.
 */
export function eachSegment(
  fn: (seg: Segment) => Segment | null,
): (location: FeatureLocation) => FeatureLocation | null {
  return (location) => {
    const segments: Segment[] = [];
    let changed = false;
    for (const seg of location.segments) {
      const next = fn(seg);
      if (next !== seg) changed = true;
      if (next !== null) segments.push(next);
    }
    if (segments.length === 0) return null;
    return changed ? { strand: location.strand, segments } : location;
  };
}

/**
 * A feature moved `offset` bases along, qualifier locations included: from
 * fragment coordinates into a document's, for one. Nothing is lost on a
 * shift, so this never drops the feature.
 */
export function shiftFeature(
  feature: Feature,
  offset: number,
  from: SequenceSpace,
  to: SequenceSpace,
): Feature {
  return (
    moveFeature(
      feature,
      from,
      to,
      eachSegment((seg) => shiftSegmentBy(seg, offset)),
    ) ?? feature
  );
}
