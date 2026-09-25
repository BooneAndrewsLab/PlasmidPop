import {
  type DocumentDiff,
  type Range,
  type SeqDocument,
  type Topology,
  featureExtent,
  outerExtent,
} from '@/core';
import { type ChangeTarget } from '@/view/circular';

import { type EditsBaseline } from './state/editorStore';

const MINUS = '−';

/** What each baseline is called, in the menu and in the summary. */
export const EDITS_BASELINE_LABELS: Readonly<Record<EditsBaseline, string>> = {
  off: 'Off',
  opened: 'Since opened',
  saved: 'Since last download',
  marked: 'Since marked',
  compared: 'Compared',
};

/** What a baseline is called for the document in front, naming what it was compared with. */
export function editsBaselineLabel(baseline: EditsBaseline, comparedName: string | null): string {
  return baseline === 'compared' && comparedName !== null
    ? `Compared with ${comparedName}`
    : EDITS_BASELINE_LABELS[baseline];
}

function count(n: number, unit: string, plural = `${unit}s`): string {
  return `${n.toLocaleString()} ${n === 1 ? unit : plural}`;
}

/**
 * The marks in one line — `+12 bp · 4 bp changed · −3 bp · 1 feature` — for
 * the toolbar's tooltip and the foot of the Edits menu. Empty when nothing
 * is marked, so callers can fall back to "no changes".
 */
export function describeEditDiff(diff: DocumentDiff | null): string {
  if (diff === null) return '';
  const parts: string[] = [];
  // Past the point where the two versions can be compared base by base
  // (a moved origin, a reverse complement, a very long session) the marks
  // cover the whole stretch that differs; say so rather than quote a tally
  // that reads as if every base had been retyped.
  if (diff.reversed) parts.push('turned over');
  if (diff.coarse) parts.push('too different to follow in detail');
  if (diff.basesInserted > 0) parts.push(`+${count(diff.basesInserted, 'bp', 'bp')}`);
  if (diff.basesChanged > 0) parts.push(`${count(diff.basesChanged, 'bp', 'bp')} changed`);
  if (diff.basesDeleted > 0) parts.push(`${MINUS}${count(diff.basesDeleted, 'bp', 'bp')}`);
  const features = diff.featuresAdded.size + diff.featuresChanged.size;
  if (features > 0) parts.push(count(features, 'feature'));
  if (diff.featuresRemoved.size > 0)
    parts.push(`${MINUS}${count(diff.featuresRemoved.size, 'feature')}`);
  return parts.join(' · ');
}

/**
 * What the baseline called the document and what shape it was, where either
 * differs from the document now (#31). Neither is a mark — a rename or a
 * change of topology touches no base — so `DocumentDiff` carries them only as
 * flags; this keeps what they were, for the toolbar to say.
 */
export interface IdentityChange {
  /** The baseline's name, when the document now has another. */
  readonly nameWas: string | null;
  /** The baseline's topology, when the document is now the other one. */
  readonly topologyWas: Topology | null;
}

/** How `current` differs from `baseline` in name and topology, or null when in neither. */
export function identityChange(
  baseline: SeqDocument | null,
  current: SeqDocument | null,
): IdentityChange | null {
  if (baseline === null || current === null) return null;
  const nameWas = baseline.name === current.name ? null : baseline.name;
  const topologyWas = baseline.topology === current.topology ? null : baseline.topology;
  return nameWas === null && topologyWas === null ? null : { nameWas, topologyWas };
}

/**
 * The toolbar name's tooltip line for a rename: `Renamed from “pBR322”`, or
 * against another file, what that one is called there.
 */
export function renameNote(nameWas: string, comparedName: string | null): string {
  return comparedName === null
    ? `Renamed from “${nameWas}”`
    : `Named “${nameWas}” in ${comparedName}`;
}

/** The toolbar topology's tooltip line: `Was linear`, or `Linear in theirs.gb` against a file. */
export function topologyNote(topologyWas: Topology, comparedName: string | null): string {
  return comparedName === null
    ? `Was ${topologyWas}`
    : `${topologyWas === 'circular' ? 'Circular' : 'Linear'} in ${comparedName}`;
}

/** The rename and topology parts of the Edits tally — `renamed · made circular`. */
export function describeIdentityChange(change: IdentityChange | null): string {
  if (change === null) return '';
  const parts: string[] = [];
  if (change.nameWas !== null) parts.push('renamed');
  if (change.topologyWas !== null)
    parts.push(`made ${change.topologyWas === 'circular' ? 'linear' : 'circular'}`);
  return parts.join(' · ');
}

/**
 * Where Next change and Previous change can land: every mark's span and
 * every deletion boundary (as an empty range, a caret), in document order —
 * by start, then by end, so a deletion comes before a mark that starts where
 * it is. On a circle a mark that runs to the end and one that starts at 0
 * are one change across the origin, and come out as one wrapping range
 * (`end > length`), last in the order since it starts last.
 */
export function changeStops(
  diff: DocumentDiff | null,
  length: number,
  circular: boolean,
): readonly Range[] {
  if (diff === null) return [];
  const stops: Range[] = [
    ...diff.marks.map((m) => ({ start: m.start, end: m.end })),
    // On a circle the boundary after the last base is the one before the first.
    ...diff.deletions.map((d) => {
      const at = circular && d.position === length ? 0 : d.position;
      return { start: at, end: at };
    }),
  ].sort((a, b) => a.start - b.start || a.end - b.end);
  const unique = stops.filter(
    (r, i) => i === 0 || r.start !== stops[i - 1]?.start || r.end !== stops[i - 1]?.end,
  );
  if (!circular) return unique;
  // Deletions are empty and so never run to the end: the last stop reaching
  // `length` is a mark, and the first mark from 0 is the other half of it.
  const head = unique.find((r) => r.end > r.start);
  const tail = unique[unique.length - 1];
  if (head === undefined || tail === undefined || head === tail) return unique;
  if (head.start !== 0 || tail.end !== length) return unique;
  return [
    ...unique.filter((r) => r !== head && r !== tail),
    { start: tail.start, end: length + head.end },
  ];
}

/**
 * The stop after (`1`) or before (`-1`) the selection, wrapping round at
 * either end; null when there are none. The selection is placed in the same
 * order as the stops, so a caret on a mark's start goes to that mark, and a
 * selection that is a stop goes to the one beside it. Nothing selected
 * counts as before the first stop going forward and after the last going back.
 */
export function stepChange(
  stops: readonly Range[],
  from: Range | null,
  direction: 1 | -1,
): Range | null {
  if (stops.length === 0) return null;
  const first = stops[0] ?? null;
  const last = stops[stops.length - 1] ?? null;
  if (from === null) return direction === 1 ? first : last;
  const order = (r: Range): number => r.start - from.start || r.end - from.end;
  if (direction === 1) return stops.find((r) => order(r) > 0) ?? first;
  let before: Range | null = null;
  for (const r of stops) if (order(r) < 0) before = r;
  return before ?? last;
}

/**
 * What a click on a change on the map selects (#27): what Next change would
 * select for it. A mark is its stop — the whole of a change across a
 * circle's origin, as one — a deletion is a caret at its boundary, and a
 * removed feature's ghost is the span it maps to now, as clicking a feature
 * selects its extent. Null for a target the diff has no longer.
 */
export function changeSelection(
  target: ChangeTarget,
  diff: DocumentDiff,
  length: number,
  circular: boolean,
): Range | null {
  if (target.kind === 'removed') {
    const feature = diff.featuresRemoved.get(target.featureId);
    if (feature === undefined) return null;
    const extent = featureExtent(feature);
    if (extent !== null) return extent;
    const { start } = outerExtent(feature);
    return { start, end: start };
  }
  if (target.kind === 'deletion') {
    const deletion = diff.deletions[target.index];
    if (deletion === undefined) return null;
    const at = circular && deletion.position === length ? 0 : deletion.position;
    return { start: at, end: at };
  }
  const mark = diff.marks[target.index];
  if (mark === undefined) return null;
  const within = (stop: Range, shift: number): boolean =>
    stop.start <= mark.start + shift && mark.end + shift <= stop.end;
  const stop = changeStops(diff, length, circular).find(
    (s) => s.end > s.start && (within(s, 0) || (circular && within(s, length))),
  );
  return stop ?? { start: mark.start, end: mark.end };
}
