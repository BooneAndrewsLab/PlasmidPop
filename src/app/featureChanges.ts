import {
  type DocumentDiff,
  type Feature,
  type SeqDocument,
  deletionThatTook,
  outerExtent as extent,
} from '@/core';

/**
 * The Features section of a review: what a diff did to the annotation, one
 * line each, named. The names are the thing the reader wants — "3 features
 * removed" from a plasmid could be three stray `misc_binding`s or it could
 * be the resistance marker — and after the naming fix of item 23 most
 * features on a real record are unnamed, so a line carries where it was as
 * well: `misc_binding 411..414` reads as itself where three lines of
 * `misc_binding` do not.
 */

const MINUS = '−';

/** How many lines one kind of change gets before the rest are counted. */
const MAX_ROWS = 8;

/** How many names the line for one deletion carries. */
const NAMES_PER_DELETION = 3;

export interface FeatureChangeRow {
  readonly key: string;
  /** `+`, `~` or `−`; empty for a line that only counts what is not shown. */
  readonly mark: '+' | '~' | '−' | '';
  readonly text: string;
  /** Where it is, in the coordinates of the edited document; may be empty. */
  readonly where: string;
  /**
   * The removed feature a line is about, when it is about one alone: the
   * review's map draws that one as a ghost and the line can point at it.
   */
  readonly removedId?: string;
}

function displayName(feature: Feature): string {
  return feature.name.trim() === '' ? feature.type : feature.name;
}

/** Where a feature is, as this dialog writes a position: `86..1,276`. */
function whereIs(feature: Feature): string {
  const { start, end } = extent(feature);
  if (end <= start) return (start + 1).toLocaleString();
  if (end - start === 1) return end.toLocaleString();
  return `${(start + 1).toLocaleString()}..${end.toLocaleString()}`;
}

function countOf(n: number, unit: string, plural = `${unit}s`): string {
  return `${n.toLocaleString()} ${n === 1 ? unit : plural}`;
}

/** A line, and how many features it stands for — a deletion's line stands for several. */
interface Line {
  readonly row: FeatureChangeRow;
  readonly count: number;
}

/** One line per removal, with the ones a single deletion took said once. */
function removedRows(diff: DocumentDiff): Line[] {
  const swallowed = new Map<number, Feature[]>();
  const alone: Feature[] = [];
  for (const feature of diff.featuresRemoved.values()) {
    const at = deletionThatTook(feature, diff);
    if (at === null) alone.push(feature);
    else swallowed.set(at, [...(swallowed.get(at) ?? []), feature]);
  }
  // A point that took one feature has nothing to group, and its own line
  // says more than a sentence about a deletion would.
  for (const [at, group] of swallowed) {
    if (group.length === 1) {
      alone.push(...group);
      swallowed.delete(at);
    }
  }

  const lines: { at: number; line: Line }[] = [];
  for (const feature of alone) {
    lines.push({
      at: extent(feature).start,
      line: {
        count: 1,
        row: {
          key: `-${feature.id}`,
          mark: MINUS,
          text: displayName(feature),
          where: whereIs(feature),
          removedId: feature.id,
        },
      },
    });
  }
  for (const [at, group] of swallowed) {
    const names = group.slice(0, NAMES_PER_DELETION).map(displayName);
    const rest = group.length - names.length;
    const listed = rest > 0 ? `${names.join(', ')} and ${rest.toLocaleString()} more` : join(names);
    lines.push({
      at,
      line: {
        count: group.length,
        row: {
          key: `-at${at}`,
          mark: MINUS,
          text: `the deletion at ${(at + 1).toLocaleString()} took ${countOf(
            group.length,
            'feature',
          )} with it: ${listed}`,
          where: '',
        },
      },
    });
  }
  return lines.sort((a, b) => a.at - b.at).map((l) => l.line);
}

function join(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1] ?? ''}`;
}

/**
 * Caps one kind at `MAX_ROWS` lines, counting the features the rest stood
 * for. None of the three lists had a cap, and deleting 2 kb of a plasmid
 * takes every feature on it with it — the section would run to a screenful
 * where the sequence above it stops at a dozen and says how many places it
 * left out.
 */
function capped(lines: readonly Line[], what: string): FeatureChangeRow[] {
  if (lines.length <= MAX_ROWS) return lines.map((l) => l.row);
  const shown = lines.slice(0, MAX_ROWS);
  const left = lines.slice(MAX_ROWS).reduce((n, l) => n + l.count, 0);
  return [
    ...shown.map((l) => l.row),
    { key: `more-${what}`, mark: '', text: `and ${countOf(left, 'feature')} ${what}`, where: '' },
  ];
}

/**
 * What changed about a feature, in the fewest words that are still an
 * answer. "changed" alone leaves the reader to open the feature editor and
 * compare by eye; `type gene → CDS` is the whole story.
 *
 * Only the fields that are one thing each are named. A qualifier can be a
 * paragraph of `/note`, so those are counted rather than quoted, and the
 * location is left to the `where` column that every line already carries.
 */
export function describeFeatureChange(before: Feature, after: Feature): string {
  const parts: string[] = [];
  if (before.type !== after.type) parts.push(`type ${before.type} → ${after.type}`);
  if (before.name !== after.name) {
    parts.push(
      before.name.trim() === ''
        ? `named ${after.name}`
        : after.name.trim() === ''
          ? `lost the name ${before.name}`
          : `renamed from ${before.name}`,
    );
  }
  if (before.strand !== after.strand) parts.push(`now ${strandWord(after.strand)}`);
  if (!sameExtent(before, after)) parts.push('moved');
  const n = qualifiersChanged(before, after);
  if (n > 0) parts.push(`${n} qualifier${n === 1 ? '' : 's'} changed`);
  return parts.length === 0 ? 'changed' : parts.join(', ');
}

function strandWord(strand: Feature['strand']): string {
  return strand === 'reverse' ? 'on the reverse strand' : 'on the forward strand';
}

function sameExtent(before: Feature, after: Feature): boolean {
  const a = extent(before);
  const b = extent(after);
  return a.start === b.start && a.end === b.end && before.segments.length === after.segments.length;
}

/** Qualifiers added, dropped or given another value, counted by name. */
function qualifiersChanged(before: Feature, after: Feature): number {
  const was = new Map(before.qualifiers.map((q) => [q.name, q.value] as const));
  const now = new Map(after.qualifiers.map((q) => [q.name, q.value] as const));
  let n = 0;
  for (const [name, value] of now) if (was.get(name) !== value) n++;
  for (const name of was.keys()) if (!now.has(name)) n++;
  return n;
}

/** Every line of the Features section, added first, then changed, then removed. */
export function featureChangeRows(
  diff: DocumentDiff,
  current: SeqDocument,
): readonly FeatureChangeRow[] {
  const of = (ids: ReadonlySet<string>): Feature[] =>
    current.features.all().filter((f) => ids.has(f.id));
  const added = of(diff.featuresAdded).map((f): Line => ({
    count: 1,
    row: { key: `+${f.id}`, mark: '+', text: displayName(f), where: whereIs(f) },
  }));
  const changed = of(new Set(diff.featuresChanged.keys())).map((f): Line => {
    const before = diff.featuresChanged.get(f.id);
    const what = before === undefined ? 'changed' : describeFeatureChange(before, f);
    return {
      count: 1,
      row: { key: `~${f.id}`, mark: '~', text: `${displayName(f)} ${what}`, where: whereIs(f) },
    };
  });
  return [
    ...capped(added, 'added'),
    ...capped(changed, 'changed'),
    ...capped(removedRows(diff), 'removed'),
  ];
}
