import {
  type Feature,
  type FeatureId,
  type Qualifier,
  type Segment,
  type SequenceSpace,
  createFeature,
  eachSegment,
  moveFeature,
} from '../features';
import { type SeqDocument } from '../document';
import {
  type Edge,
  type SequenceDiff,
  type SequenceDiffOptions,
  diffSequences,
  equivalentMappings,
  positionMapper,
} from './sequenceDiff';

/**
 * What happened to a run of bases, in the coordinates of the newer
 * document: `inserted` bases are new, `changed` bases stand where others
 * used to be.
 */
export type EditMarkKind = 'inserted' | 'changed';

export interface EditMark {
  readonly kind: EditMarkKind;
  /** Half-open span of the newer document. */
  readonly start: number;
  readonly end: number;
}

/** Bases that are gone, at the boundary of the newer document they left behind. */
export interface DeletionMark {
  readonly position: number;
  readonly count: number;
}

/**
 * How the newer of two versions of a document differs from the older one,
 * as something the views can draw: spans to mark, boundaries where bases
 * were removed, and which features were touched.
 */
export interface DocumentDiff {
  /** Marks in ascending order, never overlapping. */
  readonly marks: readonly EditMark[];
  /** Deletion boundaries in ascending order. */
  readonly deletions: readonly DeletionMark[];
  readonly featuresAdded: ReadonlySet<FeatureId>;
  /**
   * Features the newer version has changed, each one against the older
   * version of itself with its location mapped into the newer document. The
   * before is carried rather than a bare set of ids so a review can say what
   * changed about it, and because a feature paired across two files has a
   * different id on each side (see `pairByContent`).
   */
  readonly featuresChanged: ReadonlyMap<FeatureId, Feature>;
  /**
   * Features the older version had that the newer one has not, each one as
   * it was but with its location mapped into the newer document. A set of
   * ids would be no use: these features are in neither document the caller
   * holds — the newer one has lost them and the older one puts them at
   * coordinates that have since moved — and a review that can only say
   * "3 features removed" is exactly what item 27 was about.
   */
  readonly featuresRemoved: ReadonlyMap<FeatureId, Feature>;
  readonly basesInserted: number;
  readonly basesChanged: number;
  readonly basesDeleted: number;
  readonly renamed: boolean;
  readonly topologyChanged: boolean;
  /** True when the sequences differ by more than the diff will follow base by base. */
  readonly coarse: boolean;
  /**
   * True when the newer version is the older one turned over, give or take
   * edits: the marks are then against the older version reverse-complemented
   * (see `diffDocuments`), and say only what the turn and the edits changed.
   */
  readonly reversed: boolean;
}

export const EMPTY_DIFF: DocumentDiff = {
  marks: [],
  deletions: [],
  featuresAdded: new Set(),
  featuresChanged: new Map(),
  featuresRemoved: new Map(),
  basesInserted: 0,
  basesChanged: 0,
  basesDeleted: 0,
  renamed: false,
  topologyChanged: false,
  coarse: false,
  reversed: false,
};

/**
 * True when there is nothing to mark or report. A molecule turned over has
 * no marks but is not unchanged: its file reads from the other strand, so
 * the summary has something to say even where the views draw nothing.
 */
export function isEmptyDiff(diff: DocumentDiff): boolean {
  return (
    !diff.reversed &&
    diff.marks.length === 0 &&
    diff.deletions.length === 0 &&
    diff.featuresAdded.size === 0 &&
    diff.featuresChanged.size === 0 &&
    diff.featuresRemoved.size === 0
  );
}

/**
 * True when the two versions are the same document: nothing to mark, and the
 * same name and topology too. `isEmptyDiff` leaves those two out because no
 * mark can show them; a review that says "nothing differs" must not.
 */
export function isUnchanged(diff: DocumentDiff): boolean {
  return isEmptyDiff(diff) && !diff.renamed && !diff.topologyChanged;
}

/**
 * Compares `current` against `baseline`: the bases are diffed as text (so a
 * circular sequence whose origin moved reads as changed throughout, which is
 * what the views show), and features are matched by id — a feature counts as
 * changed only when it differs from where the sequence diff says its old
 * self would now sit, so annotations merely pushed along by an edit
 * elsewhere are left alone.
 *
 * A molecule turned over reads as changed throughout too, which says nothing
 * (#7): so when most of it differs, the diff is taken again against the
 * baseline turned over, and the smaller of the two is the answer, with
 * `reversed` set. A sticky-ended flip then marks nothing even though its
 * length changed, which is right: `reverseComplement` moves the window the
 * same way for the baseline as it did for the document, and the molecule is
 * the same one read from its other strand. The History step says the
 * length (`describeEditStep`).
 */
export function diffDocuments(
  baseline: SeqDocument,
  current: SeqDocument,
  options: SequenceDiffOptions = {},
): DocumentDiff {
  if (baseline === current) return EMPTY_DIFF;
  const forward = compare(baseline, current, options);
  const size = (d: DocumentDiff): number => d.basesInserted + d.basesChanged + d.basesDeleted;
  if (!forward.coarse && size(forward) * 2 < Math.max(baseline.length, current.length)) {
    return forward;
  }
  const turned = compare(baseline.reverseComplement(), current, options);
  return size(turned) < size(forward)
    ? { ...turned, renamed: baseline.name !== current.name, reversed: true }
    : forward;
}

function compare(
  baseline: SeqDocument,
  current: SeqDocument,
  options: SequenceDiffOptions,
): DocumentDiff {
  // The case of a letter says nothing about the base (#90): `a` and `A` are
  // one adenine, as the checksum has it too, so changing the case of a
  // stretch is not an edit of its bases.
  const diff = diffSequences(
    baseline.sequence.toString().toUpperCase(),
    current.sequence.toString().toUpperCase(),
    options,
  );
  const { marks, deletions, basesInserted, basesChanged, basesDeleted } = collectMarks(diff);
  const features = diffFeatures(baseline, current, diff);
  return {
    marks,
    deletions,
    ...features,
    basesInserted,
    basesChanged,
    basesDeleted,
    renamed: baseline.name !== current.name,
    topologyChanged: baseline.topology !== current.topology,
    coarse: diff.coarse,
    reversed: false,
  };
}

interface MarkResult {
  readonly marks: EditMark[];
  readonly deletions: DeletionMark[];
  readonly basesInserted: number;
  readonly basesChanged: number;
  readonly basesDeleted: number;
}

/**
 * Turns the edit script into marks. Each run of non-equal ops is one hunk:
 * new bases standing where old ones were are `changed`, new bases with
 * nothing removed are `inserted`, and whatever was removed beyond the length
 * of the replacement is a deletion at the end of the hunk.
 */
function collectMarks(diff: SequenceDiff): MarkResult {
  const marks: EditMark[] = [];
  const deletions: DeletionMark[] = [];
  let basesInserted = 0;
  let basesChanged = 0;
  let basesDeleted = 0;

  let i = 0;
  while (i < diff.ops.length) {
    const op = diff.ops[i];
    if (op === undefined) break;
    if (op.kind === 'equal') {
      i++;
      continue;
    }
    let removed = 0;
    const start = op.bStart;
    let end = op.bStart;
    while (i < diff.ops.length) {
      const hunk = diff.ops[i];
      if (hunk === undefined || hunk.kind === 'equal') break;
      removed += hunk.aEnd - hunk.aStart;
      end = Math.max(end, hunk.bEnd);
      i++;
    }
    const added = end - start;
    if (added > 0) {
      const kind: EditMarkKind = removed > 0 ? 'changed' : 'inserted';
      marks.push({ kind, start, end });
      if (kind === 'changed') basesChanged += added;
      else basesInserted += added;
    }
    const surplus = removed - added;
    if (surplus > 0) {
      deletions.push({ position: end, count: surplus });
      basesDeleted += surplus;
    }
  }
  return { marks, deletions, basesInserted, basesChanged, basesDeleted };
}

interface FeatureDiff {
  readonly featuresAdded: ReadonlySet<FeatureId>;
  readonly featuresChanged: ReadonlyMap<FeatureId, Feature>;
  readonly featuresRemoved: ReadonlyMap<FeatureId, Feature>;
}

/**
 * The same feature, at wherever the sequence diff says its bases went —
 * the locations its qualifiers hold (`/transl_except`) included, so that a
 * qualifier an edit upstream moved along is not taken for a changed one.
 */
function mapFeature(
  feature: Feature,
  map: PositionMap,
  from: SequenceSpace,
  to: SequenceSpace,
): Feature {
  const moved = moveFeature(
    feature,
    from,
    to,
    eachSegment((seg) =>
      seg.kind === 'site'
        ? { ...seg, position: map(seg.position) }
        : isWholeCircle(seg, map)
          ? // A feature around the whole circle stays around it: its end is
            // its start, one turn on, wherever an edit put that (#168, #198).
            { ...seg, start: wholeStart(seg, map), end: wholeStart(seg, map) + to.length }
          : mappedRange(seg, map),
    ),
  );
  return createFeature(moved ?? feature);
}

/**
 * A range segment at the newer document's coordinates. On a circle a start
 * the diff puts at the new length is the origin (what is left of the sequence
 * past it wrapped round to the front), so the range moves back a turn.
 */
function mappedRange(seg: Segment & { kind: 'range' }, map: PositionMap): Segment {
  const start = map(seg.start);
  const end = Math.max(start, map(seg.end));
  if (start === map.circle?.to && end === start) {
    // Collapsed at the origin: all of it, or none of it (#197).
    return { ...seg, start: 0, end: keepsWholeCircle(seg, map.circle) ? start : 0 };
  }
  const turn = start === map.circle?.to && end > start ? start : 0;
  return { ...seg, start: start - turn, end: end - turn };
}

/**
 * Whether a range whose edges both land at the origin of the newer circle,
 * `[length, length)`, went all the way round it rather than lost all its
 * bases: positions on a circle do not say which (#197). An overwrite over
 * the origin can leave a feature covering the whole circle that way (#196),
 * but only one of the two is possible unless the edit removed as many bases
 * as the range holds and the range is as long as what is left, give or take
 * what was added. Neither ruled out, it reads as emptied, which at worst
 * reports as changed a feature the editor kept.
 */
function keepsWholeCircle(seg: Segment & { kind: 'range' }, circle: Circle): boolean {
  const length = seg.end - seg.start;
  return length + circle.gained >= circle.to && circle.lost < length;
}

interface Circle {
  /** The lengths of the older and the newer circle. */
  readonly from: number;
  readonly to: number;
  /** How many bases the diff adds and removes in all. */
  readonly gained: number;
  readonly lost: number;
}

/**
 * Maps a position of the older document into the newer one. On two circles it
 * also says how long each is, so a feature that covers a whole circle can be
 * told from one that merely ends at the last base.
 */
type PositionMap = ((position: number) => number) & {
  readonly circle?: Circle | undefined;
  /**
   * Where a feature's edges land under each equally good reading of the
   * diff, one array per reading (see `equivalentMappings`).
   */
  readonly readings?: (edges: readonly Edge[]) => Iterable<readonly number[]>;
};

function equalBases(diff: SequenceDiff): number {
  return diff.ops.reduce((n, op) => n + (op.kind === 'equal' ? op.aEnd - op.aStart : 0), 0);
}

/**
 * Whether a segment goes once round the whole older circle, from wherever it
 * starts: told by its length, not by a start at the origin (#198).
 */
function isWholeCircle(seg: Segment, map: PositionMap): seg is Segment & { kind: 'range' } {
  return (
    map.circle !== undefined &&
    map.circle.from > 0 &&
    seg.kind === 'range' &&
    seg.end - seg.start === map.circle.from
  );
}

/** Where a whole circle's start lands, at the origin rather than one turn on. */
function wholeStart(seg: Segment & { kind: 'range' }, map: PositionMap): number {
  const start = map(seg.start);
  return start === map.circle?.to ? 0 : start;
}

function diffFeatures(
  baseline: SeqDocument,
  current: SeqDocument,
  diff: SequenceDiff,
): FeatureDiff {
  const map = positionMapper(diff, baseline.length, current.length);
  const circular = baseline.topology === 'circular' && current.topology === 'circular';
  const equivalent = equivalentMappings(
    diff,
    baseline.sequence.toString().toUpperCase(),
    current.sequence.toString().toUpperCase(),
    map,
    circular,
  );
  // Feature locations are unrolled, so a segment that wraps the origin ends
  // past the sequence; map the wrapped part and put it back past the end.
  const unrolled = (position: number): number =>
    position > baseline.length ? map(position - baseline.length) + current.length : map(position);
  const mapUnrolled: PositionMap = Object.assign(unrolled, {
    readings: equivalent.readings,
    circle: circular
      ? {
          from: baseline.length,
          to: current.length,
          gained: diff.ops.reduce((n, op) => n + op.bEnd - op.bStart, 0) - equalBases(diff),
          lost: diff.ops.reduce((n, op) => n + op.aEnd - op.aStart, 0) - equalBases(diff),
        }
      : undefined,
  });
  const mapped = (f: Feature): Feature => mapFeature(f, mapUnrolled, baseline, current);
  const qualifiersOf = (f: Feature): readonly Qualifier[] => mapped(f).qualifiers;

  const featuresAdded: Feature[] = [];
  const featuresChanged = new Map<FeatureId, Feature>();
  for (const feature of current.features) {
    const before = baseline.getFeature(feature.id);
    if (before === undefined) featuresAdded.push(feature);
    else if (!sameFeature(before, feature, mapUnrolled, qualifiersOf)) {
      featuresChanged.set(feature.id, mapped(before));
    }
  }
  const featuresRemoved: Feature[] = [];
  for (const feature of baseline.features) {
    if (current.getFeature(feature.id) === undefined) featuresRemoved.push(feature);
  }
  // Ids only mean something between two versions of one document. Two files
  // parsed separately give every feature a fresh id, so what is left over is
  // paired up by what the features *are* instead — a feature the two
  // documents agree on to the last qualifier is not an addition and a
  // removal, whatever it is called internally, and one they disagree about
  // is a change rather than a loss and a gain.
  const { same, changed } = pairByContent(
    featuresRemoved,
    featuresAdded,
    mapUnrolled,
    qualifiersOf,
  );
  // What is left has moved as well as changed, so no location says it is the
  // same feature; its bases still can (#38).
  const moved = pairByBases(
    featuresRemoved.filter((f) => !same.has(f) && !paired(changed, f)),
    featuresAdded.filter((f) => !same.has(f) && !paired(changed, f)),
    (f) => baseline.featureSequence(f).toUpperCase(),
    (f) => current.featureSequence(f).toUpperCase(),
  );
  const pairs = [...changed, ...moved];
  for (const [before, after] of pairs) {
    featuresChanged.set(after.id, mapped(before));
  }
  const gone = (f: Feature): boolean => !same.has(f) && !paired(pairs, f);
  return {
    featuresAdded: new Set(featuresAdded.filter(gone).map((f) => f.id)),
    featuresChanged,
    featuresRemoved: new Map(featuresRemoved.filter(gone).map((f) => [f.id, mapped(f)] as const)),
  };
}

/** Shorter than this, a feature's bases turn up elsewhere by chance. */
const MIN_BASES_TO_PAIR = 20;

/**
 * The third pass, for a feature that both moved and was renamed (or
 * retyped): no location and no name ties the two versions together, but the
 * bases it covers do. Pairs a leftover with one added feature of the same
 * type and strand whose bases are the same, and only when each is the other's
 * one candidate, so two copies of a repeated element are left unpaired rather
 * than paired by guesswork.
 */
function pairByBases(
  removed: readonly Feature[],
  added: readonly Feature[],
  basesBefore: (f: Feature) => string,
  basesAfter: (f: Feature) => string,
): (readonly [Feature, Feature])[] {
  if (removed.length === 0 || added.length === 0) return [];
  const keyOf = (f: Feature, bases: string): string | null =>
    bases.length < MIN_BASES_TO_PAIR ? null : [f.type, f.strand, bases].join('\u0000');
  const group = (features: readonly Feature[], bases: (f: Feature) => string) => {
    const byKey = new Map<string, Feature[]>();
    for (const f of features) {
      const key = keyOf(f, bases(f));
      if (key === null) continue;
      const list = byKey.get(key);
      if (list === undefined) byKey.set(key, [f]);
      else list.push(f);
    }
    return byKey;
  };
  const before = group(removed, basesBefore);
  const after = group(added, basesAfter);
  const pairs: (readonly [Feature, Feature])[] = [];
  for (const [key, olds] of before) {
    const news = after.get(key);
    const [old] = olds;
    const [next] = news ?? [];
    if (olds.length === 1 && news?.length === 1 && old !== undefined && next !== undefined) {
      pairs.push([old, next]);
    }
  }
  return pairs;
}

/** Whether a feature is one half of a pair the looser pass matched up. */
function paired(changed: readonly (readonly [Feature, Feature])[], feature: Feature): boolean {
  return changed.some(([before, after]) => before === feature || after === feature);
}

/** Everything but the id, cheap enough to bucket on before comparing in full. */
function bucketKey(feature: Feature): string {
  return [feature.type, feature.name, feature.strand, feature.segments.length].join('\u0000');
}

/** What the two passes below found: identical pairs, and changed ones. */
interface ContentPairs {
  /** Features the two documents agree on to the last qualifier. */
  readonly same: ReadonlySet<Feature>;
  /** Pairs that are the same feature changed, older first. */
  readonly changed: readonly (readonly [Feature, Feature])[];
}

/**
 * Matches features the two documents hold in common but under different ids.
 * Only features already known to be unmatched by id are offered, so this
 * cannot override an id match.
 *
 * Two passes. The first pairs features that agree about everything, which is
 * the common case across two files and says nothing to the user. The second
 * goes over what is left and asks a weaker question: is this the same feature
 * with something changed about it? A feature is somewhere, so its location has
 * to match, and it has to still be recognisable — the same name, or failing
 * that the same type. That pairs a feature whose type was edited with the one
 * it became, and a renamed one with its old self, instead of reporting each as
 * a loss and a gain at the same coordinates.
 *
 * It deliberately will not pair two features that share only a location: the
 * `gene` and the `CDS` inside it cover the same bases on a real record
 * (pBR322 has two such pairs) and are not versions of one another.
 */
function pairByContent(
  removed: readonly Feature[],
  added: readonly Feature[],
  map: PositionMap,
  qualifiersOf: (before: Feature) => readonly Qualifier[],
): ContentPairs {
  const same = new Set<Feature>();
  const changed: (readonly [Feature, Feature])[] = [];
  if (removed.length === 0 || added.length === 0) return { same, changed };
  const buckets = new Map<string, Feature[]>();
  for (const feature of added) {
    const key = bucketKey(feature);
    const bucket = buckets.get(key);
    if (bucket === undefined) buckets.set(key, [feature]);
    else bucket.push(feature);
  }
  for (const before of removed) {
    const bucket = buckets.get(bucketKey(before));
    if (bucket === undefined) continue;
    const match = bucket.find(
      (after) => !same.has(after) && sameFeature(before, after, map, qualifiersOf),
    );
    if (match === undefined) continue;
    same.add(before);
    same.add(match);
  }

  const taken = new Set<Feature>(same);
  const leftOver = added.filter((f) => !taken.has(f));
  if (leftOver.length === 0) return { same, changed };
  for (const before of removed) {
    if (taken.has(before)) continue;
    const match = leftOver.find(
      (after) =>
        !taken.has(after) && sameLocation(before, after, map) && recognisable(before, after),
    );
    if (match === undefined) continue;
    taken.add(before);
    taken.add(match);
    changed.push([before, match]);
  }
  return { same, changed };
}

/** Whether two features are the same thing under some change: name, or type. */
function recognisable(before: Feature, after: Feature): boolean {
  if (before.name !== '' && before.name === after.name) return true;
  return before.type === after.type;
}

/**
 * Whether two versions of one feature cover the same bases. The older one a
 * diff carries is already mapped into the newer document's coordinates, so
 * this is the honest question to ask of it: has the annotation moved, or has
 * only its description changed? A view can say that much with a line style,
 * where "touched" is all a colour on its own can carry.
 */
export function sameFeatureLocation(before: Feature, after: Feature): boolean {
  return sameLocation(before, after, (position) => position);
}

/**
 * Whether `after` is where `before` went. Every edge of every segment is read
 * through one reading of the diff at a time: an edge placed by one reading
 * and another edge by a different one would accept a moved or resized
 * feature as kept (#189).
 */
function sameLocation(before: Feature, after: Feature, map: PositionMap): boolean {
  if (before.segments.length !== after.segments.length) return false;
  const ranges: [Segment & { kind: 'range' }, Segment & { kind: 'range' }][] = [];
  for (const [i, seg] of before.segments.entries()) {
    const other = after.segments[i];
    if (other?.kind !== seg.kind) return false;
    if (seg.kind === 'site') {
      if (map(seg.position) !== (other.kind === 'site' ? other.position : -1)) return false;
    } else if (other.kind === 'range') {
      if (seg.partialStart !== other.partialStart || seg.partialEnd !== other.partialEnd) {
        return false;
      }
      ranges.push([seg, other]);
    }
  }
  if (ranges.length === 0) return true;
  const edges = ranges.flatMap(([seg]): Edge[] => [
    { position: seg.start, end: false },
    { position: seg.end, end: true },
  ]);
  // An exclusive end the diff drew an insertion at lies outside it, as the
  // editor leaves one; a deletion that swallowed the last base leaves it at
  // the deletion's boundary.
  const drawn = (edge: Edge): number =>
    edge.end && edge.position > 0
      ? Math.min(map(edge.position - 1) + 1, map(edge.position))
      : map(edge.position);
  const readings = map.readings?.(edges) ?? [edges.map(drawn)];
  for (const placed of readings) {
    if (
      ranges.every(([seg, other], i) =>
        sameRange(seg, other, placed[2 * i] ?? -1, placed[2 * i + 1] ?? -1, map),
      )
    ) {
      return true;
    }
  }
  return false;
}

/** `qualifiersOf` gives the older feature's qualifiers moved into the newer document. */
function sameFeature(
  before: Feature,
  after: Feature,
  map: PositionMap,
  qualifiersOf: (before: Feature) => readonly Qualifier[],
): boolean {
  return (
    before.type === after.type &&
    before.name === after.name &&
    before.strand === after.strand &&
    before.joining === after.joining &&
    sameQualifiers(qualifiersOf(before), after.qualifiers) &&
    sameLocation(before, after, map)
  );
}

function sameQualifiers(before: readonly Qualifier[], after: readonly Qualifier[]): boolean {
  return (
    before.length === after.length &&
    before.every((q, i) => {
      const other = after[i];
      if (other === undefined) return false;
      return q.name === other.name && q.value === other.value;
    })
  );
}

/** Whether `before`, its edges placed at `start` and `end`, is `after`. */
function sameRange(
  before: Segment & { kind: 'range' },
  after: Segment & { kind: 'range' },
  start: number,
  end: number,
  map: PositionMap,
): boolean {
  // On a circle a start mapped to the new length is the origin, and an end
  // past it moves back the same turn. One whose edges both land there is
  // either the whole circle or nothing, never both (#197).
  const fits = (s: number, e: number): boolean => {
    const circle = map.circle;
    if (circle?.to === s && e === s) {
      return after.start === 0 && after.end === (keepsWholeCircle(before, circle) ? s : 0);
    }
    const turn = s === circle?.to ? s : 0;
    return s - turn === after.start && (e > s ? e - turn : e) === after.end;
  };
  // A whole circle stays one: the editor keeps a feature round the whole
  // circle round it under every edit, so only its start is read and its end
  // is the start one new turn on (#168), whatever the end's own reading says
  // and wherever the start was (#198).
  if (isWholeCircle(before, map)) {
    const to = map.circle?.to ?? 0;
    return (start === to ? 0 : start) === after.start && after.end - after.start === to;
  }
  return fits(start, end);
}

/** The marks that overlap `[start, end)`, by binary search on the sorted list. */
export function marksIn(
  marks: readonly EditMark[],
  start: number,
  end: number,
): readonly EditMark[] {
  let lo = 0;
  let hi = marks.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if ((marks[mid]?.end ?? 0) <= start) lo = mid + 1;
    else hi = mid;
  }
  const out: EditMark[] = [];
  for (let i = lo; i < marks.length; i++) {
    const mark = marks[i];
    if (mark === undefined || mark.start >= end) break;
    out.push(mark);
  }
  return out;
}
