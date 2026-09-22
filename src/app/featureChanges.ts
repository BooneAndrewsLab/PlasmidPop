import { type DocumentDiff, type Feature, type SeqDocument } from '@/core';

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
}

function displayName(feature: Feature): string {
  return feature.name.trim() === '' ? feature.type : feature.name;
}

/** Outer extent of a feature, half-open, over all of its segments. */
function extent(feature: Feature): { start: number; end: number } {
  let start = Infinity;
  let end = -Infinity;
  for (const seg of feature.segments) {
    const from = seg.kind === 'site' ? seg.position : seg.start;
    const to = seg.kind === 'site' ? seg.position : seg.end;
    start = Math.min(start, from);
    end = Math.max(end, to);
  }
  return { start: Number.isFinite(start) ? start : 0, end: Number.isFinite(end) ? end : 0 };
}

/**
 * The deletion that took a removed feature, or null if none did. A feature
 * inside a deleted stretch has all of its bases mapped onto the boundary the
 * deletion left behind, so it comes back from the diff covering a base or
 * none at all — and seven of those are one thing that happened, not seven.
 * The deletion has to be there: a 1 bp feature deleted by hand also comes
 * back covering one base, and nothing swallowed it.
 */
function swallowedBy(feature: Feature, diff: DocumentDiff): number | null {
  const { start, end } = extent(feature);
  if (end - start > 1) return null;
  for (const deletion of diff.deletions) {
    if (deletion.position >= start && deletion.position <= end) return deletion.position;
  }
  return null;
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
    const at = swallowedBy(feature, diff);
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
  const changed = of(diff.featuresChanged).map((f): Line => ({
    count: 1,
    row: { key: `~${f.id}`, mark: '~', text: `${displayName(f)} changed`, where: whereIs(f) },
  }));
  return [
    ...capped(added, 'added'),
    ...capped(changed, 'changed'),
    ...capped(removedRows(diff), 'removed'),
  ];
}
