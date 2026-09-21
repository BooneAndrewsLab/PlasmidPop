import { type DocumentDiff } from '@/core';

import { type EditsBaseline } from './state/editorStore';

const MINUS = '−';

/** What each baseline is called, in the menu and in the summary. */
export const EDITS_BASELINE_LABELS: Readonly<Record<EditsBaseline, string>> = {
  off: 'Off',
  opened: 'Since opened',
  saved: 'Since last download',
  marked: 'Since marked',
};

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
  if (diff.coarse) parts.push('too different to follow in detail');
  if (diff.basesInserted > 0) parts.push(`+${count(diff.basesInserted, 'bp', 'bp')}`);
  if (diff.basesChanged > 0) parts.push(`${count(diff.basesChanged, 'bp', 'bp')} changed`);
  if (diff.basesDeleted > 0) parts.push(`${MINUS}${count(diff.basesDeleted, 'bp', 'bp')}`);
  const features = diff.featuresAdded.size + diff.featuresChanged.size;
  if (features > 0) parts.push(count(features, 'feature'));
  if (diff.featuresRemoved > 0) parts.push(`${MINUS}${count(diff.featuresRemoved, 'feature')}`);
  return parts.join(' · ');
}
