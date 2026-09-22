import {
  type Feature,
  type FeatureId,
  type Qualifier,
  type Segment,
  createFeature,
} from '../features';
import { type SeqDocument } from '../document';
import {
  type SequenceDiff,
  type SequenceDiffOptions,
  diffSequences,
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
};

/** True when there is nothing for the views to mark. */
export function isEmptyDiff(diff: DocumentDiff): boolean {
  return (
    diff.marks.length === 0 &&
    diff.deletions.length === 0 &&
    diff.featuresAdded.size === 0 &&
    diff.featuresChanged.size === 0 &&
    diff.featuresRemoved.size === 0
  );
}

/**
 * Compares `current` against `baseline`: the bases are diffed as text (so a
 * circular sequence whose origin moved reads as changed throughout, which is
 * what the views show), and features are matched by id — a feature counts as
 * changed only when it differs from where the sequence diff says its old
 * self would now sit, so annotations merely pushed along by an edit
 * elsewhere are left alone.
 */
export function diffDocuments(
  baseline: SeqDocument,
  current: SeqDocument,
  options: SequenceDiffOptions = {},
): DocumentDiff {
  if (baseline === current) return EMPTY_DIFF;
  const diff = diffSequences(baseline.sequence.toString(), current.sequence.toString(), options);
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

/** The same feature, at wherever the sequence diff says its bases went. */
function mapFeature(feature: Feature, map: (position: number) => number): Feature {
  return createFeature({
    ...feature,
    segments: feature.segments.map((seg) =>
      seg.kind === 'site'
        ? { ...seg, position: map(seg.position) }
        : { ...seg, start: map(seg.start), end: Math.max(map(seg.start), map(seg.end)) },
    ),
  });
}

function diffFeatures(
  baseline: SeqDocument,
  current: SeqDocument,
  diff: SequenceDiff,
): FeatureDiff {
  const map = positionMapper(diff, baseline.length, current.length);
  // Feature locations are unrolled, so a segment that wraps the origin ends
  // past the sequence; map the wrapped part and put it back past the end.
  const mapUnrolled = (position: number): number =>
    position > baseline.length ? map(position - baseline.length) + current.length : map(position);

  const featuresAdded: Feature[] = [];
  const featuresChanged = new Map<FeatureId, Feature>();
  for (const feature of current.features) {
    const before = baseline.getFeature(feature.id);
    if (before === undefined) featuresAdded.push(feature);
    else if (!sameFeature(before, feature, mapUnrolled)) {
      featuresChanged.set(feature.id, mapFeature(before, mapUnrolled));
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
  const { same, changed } = pairByContent(featuresRemoved, featuresAdded, mapUnrolled);
  for (const [before, after] of changed) {
    featuresChanged.set(after.id, mapFeature(before, mapUnrolled));
  }
  const gone = (f: Feature): boolean => !same.has(f) && !paired(changed, f);
  return {
    featuresAdded: new Set(featuresAdded.filter(gone).map((f) => f.id)),
    featuresChanged,
    featuresRemoved: new Map(
      featuresRemoved.filter(gone).map((f) => [f.id, mapFeature(f, mapUnrolled)] as const),
    ),
  };
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
  map: (position: number) => number,
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
    const match = bucket.find((after) => !same.has(after) && sameFeature(before, after, map));
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

function sameLocation(before: Feature, after: Feature, map: (position: number) => number): boolean {
  return (
    before.segments.length === after.segments.length &&
    before.segments.every((seg, i) => sameSegment(seg, after.segments[i], map))
  );
}

function sameFeature(before: Feature, after: Feature, map: (position: number) => number): boolean {
  return (
    before.type === after.type &&
    before.name === after.name &&
    before.strand === after.strand &&
    sameQualifiers(before.qualifiers, after.qualifiers) &&
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

function sameSegment(
  before: Segment,
  after: Segment | undefined,
  map: (position: number) => number,
): boolean {
  if (after?.kind !== before.kind) return false;
  if (before.kind === 'site') {
    return after.kind === 'site' && map(before.position) === after.position;
  }
  if (after.kind !== 'range') return false;
  // An exclusive end is ambiguous: mapping the boundary itself follows an
  // insertion that happens to sit there, mapping the last base does not, and
  // a deletion that swallowed that base only comes out right the first way.
  // Either answer counts, so an edit *beside* a feature does not mark it.
  const ends = [map(before.end), map(before.end - 1) + 1];
  return (
    map(before.start) === after.start &&
    ends.includes(after.end) &&
    before.partialStart === after.partialStart &&
    before.partialEnd === after.partialEnd
  );
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
