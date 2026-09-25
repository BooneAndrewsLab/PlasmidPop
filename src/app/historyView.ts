import { type History, type SeqDocument, formatLength } from '@/core';

/** A row of the history panel: one recorded change, or the state it started from. */
export interface HistoryRow {
  /** How many changes are applied in this row's state; 0 is the starting point. */
  readonly position: number;
  readonly label: string;
  /** When the change was recorded, as epoch milliseconds. */
  readonly at: number;
  /** What the change did to the document, e.g. `+12 bp · +1 feature`; empty when nothing measurable did. */
  readonly effect: string;
  /** The document with this row's change applied. */
  readonly state: SeqDocument;
  /** True for the state the document is in now. */
  readonly current: boolean;
  /** True for a change that has been undone, so redo would bring it back. */
  readonly undone: boolean;
  /** True when this state is what the file on disk holds. */
  readonly saved: boolean;
  /** What the user called this state (#4), if anything. */
  readonly name?: string;
  /** The state before this change, which "What changed" compares with; null for the start. */
  readonly before: SeqDocument | null;
}

/**
 * A named state the History's limit dropped from the steps (#4), as the
 * panel lists it below them: it can be brought back, renamed or marked
 * from, but not undone to.
 */
export interface KeptRow {
  /** Its index in `History.kept`, which the store's calls take. */
  readonly index: number;
  readonly name: string;
  readonly label: string;
  readonly at: number;
  /** The size and feature count of the state, as the starting row shows them. */
  readonly effect: string;
  readonly state: SeqDocument;
  /** True when the document is in this state now. */
  readonly current: boolean;
}

export interface HistoryRowOptions {
  /** The version last written to or read from a file, to mark on its row. */
  readonly savedDoc?: SeqDocument | null;
  /** What to call the state the history starts from. */
  readonly startLabel?: string;
}

const MINUS = '−';

function signed(n: number, unit: string, plural = `${unit}s`): string {
  const magnitude = Math.abs(n).toLocaleString();
  return `${n < 0 ? MINUS : '+'}${magnitude} ${Math.abs(n) === 1 ? unit : plural}`;
}

/** Size and annotation count of a document, for the row the history starts from. */
export function summarizeDocument(doc: SeqDocument): string {
  const bases = formatLength(doc.length, doc.alphabet);
  const n = doc.features.size;
  return `${bases} · ${n === 1 ? '1 feature' : `${n.toLocaleString()} features`}`;
}

/**
 * How `next` differs from `prev` in the terms the panel shows: bases gained
 * or lost, features added or removed, and a change of topology. The label of
 * the step says what was done, this says how much it moved.
 */
export function describeEffect(prev: SeqDocument, next: SeqDocument): string {
  const parts: string[] = [];
  const bases = next.length - prev.length;
  if (bases !== 0) parts.push(signed(bases, 'bp', 'bp'));
  const features = next.features.size - prev.features.size;
  if (features !== 0) parts.push(signed(features, 'feature'));
  if (prev.topology !== next.topology) parts.push(next.isCircular ? 'circular' : 'linear');
  return parts.join(' · ');
}

/**
 * The history as rows for the panel, newest first, so the list reads like the
 * undo stack. The last row is the state the history starts from: the document
 * as opened, or the oldest state still kept once the limit has dropped steps.
 */
export function historyRows(
  history: History<SeqDocument> | null,
  options: HistoryRowOptions = {},
): readonly HistoryRow[] {
  if (history === null) return [];
  const { savedDoc = null, startLabel = 'Opened document' } = options;
  const steps = history.steps;
  const start = history.stateAt(0);
  if (start === undefined) return [];
  const rows: HistoryRow[] = [
    {
      position: 0,
      label: history.truncated ? 'Oldest kept state' : startLabel,
      at: history.startedAt,
      effect: summarizeDocument(start),
      state: start,
      current: history.position === 0,
      undone: false,
      saved: savedDoc !== null && savedDoc === start,
      before: null,
    },
  ];
  let prev = start;
  for (const step of steps) {
    rows.push({
      position: step.position,
      label: step.label,
      at: step.at,
      effect: describeEffect(prev, step.state),
      state: step.state,
      current: step.position === history.position,
      undone: step.position > history.position,
      saved: savedDoc !== null && savedDoc === step.state,
      before: prev,
      ...(step.name === undefined ? {} : { name: step.name }),
    });
    prev = step.state;
  }
  rows.reverse();
  return rows;
}

/** The named states kept outside the steps, newest first as the list above them is. */
export function keptRows(history: History<SeqDocument> | null): readonly KeptRow[] {
  if (history === null) return [];
  return history.kept
    .map((k, index) => ({
      index,
      name: k.name,
      label: k.label,
      at: k.at,
      effect: summarizeDocument(k.state),
      state: k.state,
      current: k.state === history.present,
    }))
    .reverse();
}

/**
 * What a state is called where the edit marks name what they measure from
 * ("Compared with …"): its name, else its step number, else — for the state
 * the history starts from — what the list calls that row.
 */
export function stateTitle(row: {
  readonly position: number;
  readonly label: string;
  readonly name?: string;
}): string {
  if (row.name !== undefined) return row.name;
  if (row.position === 0) return `the ${row.label.charAt(0).toLowerCase()}${row.label.slice(1)}`;
  return `step ${row.position.toLocaleString()}`;
}

/** Clock time of a step, as short as the locale allows. */
export function stepTime(at: number): string {
  return new Date(at).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}
