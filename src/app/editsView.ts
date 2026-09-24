import { type DocumentDiff, type Range } from '@/core';

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
