import type { ResidueFrame } from './alignmentResidues';
import {
  REFERENCE_ROW,
  rowBases,
  rowName,
  rowResidues,
  selectionColumns,
  type AlignmentSelection,
  type CopyMode,
} from './alignmentSelection';
import { columnPosition, type Stack } from './alignmentStack';
import { cut, fastaRecord, type ColumnRange } from './alignmentText';

/**
 * The large view's Advanced copy (#366): what a selection copies, composed
 * from options rather than picked from a fixed menu. Ctrl+C stays the one
 * instant copy (the selected row's residues); this is for the rest — the
 * reference beside a sample, every row in register, the whole alignment's
 * width, amino acids with the bases, FASTA. Pure, so each combination and
 * its preview are tested without a window; the panel only shows it.
 */

/** Which rows go out: the selected one, the reference above it, or the reference and every sample. */
export type RowChoice = 'selected' | 'with-reference' | 'all';
export type ColumnChoice = 'selection' | 'all';
export type GapChoice = 'kept' | 'dropped';
export type TrackChoice = 'bases' | 'aa' | 'both';
export type FormatChoice = 'text' | 'fasta';

export interface CopyOptions {
  readonly rows: RowChoice;
  readonly columns: ColumnChoice;
  readonly gaps: GapChoice;
  readonly tracks: TrackChoice;
  readonly format: FormatChoice;
  /** Text only: each line led by its row's name, padded to one column. FASTA is always named. */
  readonly names: boolean;
  /** A line of where the columns are (text), or the same after each FASTA name. */
  readonly coordinates: boolean;
}

/** What the panel opens with the first time: the same as Ctrl+C, in text. */
export const DEFAULT_COPY_OPTIONS: CopyOptions = {
  rows: 'selected',
  columns: 'selection',
  gaps: 'dropped',
  tracks: 'bases',
  format: 'text',
  names: false,
  coordinates: false,
};

const ROW_CHOICES: readonly RowChoice[] = ['selected', 'with-reference', 'all'];
const COLUMN_CHOICES: readonly ColumnChoice[] = ['selection', 'all'];
const GAP_CHOICES: readonly GapChoice[] = ['kept', 'dropped'];
const TRACK_CHOICES: readonly TrackChoice[] = ['bases', 'aa', 'both'];
const FORMAT_CHOICES: readonly FormatChoice[] = ['text', 'fasta'];

/** What the options are applied to. */
export interface CopyContext {
  readonly stack: Stack;
  /** The CDS frames in view, null or empty when the amino-acid strips are off. */
  readonly frames: readonly ResidueFrame[] | null;
  readonly referenceName: string;
  readonly selection: AlignmentSelection;
}

/**
 * Which choices the context rules out. The panel greys each out with its
 * reason; `effectiveOptions` falls back the same way, so what is copied is
 * what is shown.
 */
export interface CopyLimits {
  /** Several rows must stay in register, so their gaps are kept. */
  readonly gapsKept: boolean;
  /** No residues are in view, so only bases can go out. */
  readonly basesOnly: boolean;
  /** The selection is on the reference, so "with the reference" adds nothing. */
  readonly onReference: boolean;
}

export function copyLimits(o: CopyOptions, ctx: CopyContext): CopyLimits {
  const onReference = ctx.selection.row === REFERENCE_ROW;
  const rows = o.rows === 'with-reference' && onReference ? 'selected' : o.rows;
  return {
    gapsKept: rows !== 'selected',
    basesOnly: ctx.frames === null || ctx.frames.length === 0,
    onReference,
  };
}

/** The options as they apply, each ruled-out choice replaced by what it falls back to. */
export function effectiveOptions(o: CopyOptions, ctx: CopyContext): CopyOptions {
  const limits = copyLimits(o, ctx);
  return {
    ...o,
    rows: limits.onReference && o.rows === 'with-reference' ? 'selected' : o.rows,
    gaps: limits.gapsKept ? 'kept' : o.gaps,
    tracks: limits.basesOnly ? 'bases' : o.tracks,
  };
}

/**
 * The options the panel opens with: the ones remembered, but the strip the
 * selection is on says which track to copy, as it does for Ctrl+C, unless
 * both were asked for last time.
 */
export function optionsForSelection(stored: CopyOptions, sel: AlignmentSelection): CopyOptions {
  if (stored.tracks === 'both') return stored;
  return { ...stored, tracks: sel.track === 'aa' ? 'aa' : 'bases' };
}

/** The rows that go out, in the order they are shown: the reference first. */
function rowsOf(choice: RowChoice, ctx: CopyContext): number[] {
  const sel = ctx.selection.row;
  if (choice === 'all') return [REFERENCE_ROW, ...ctx.stack.rows.map((_, i) => i)];
  if (choice === 'with-reference' && sel !== REFERENCE_ROW) return [REFERENCE_ROW, sel];
  return [sel];
}

/**
 * Where the columns are, for the coordinate line: the columns themselves,
 * 1-based inclusive, and the reference's positions as the ruler numbers them
 * (the first and last the range has; none when every column is an
 * insertion).
 */
export function coordinateNote(stack: Stack, r: ColumnRange): string {
  let first: number | null = null;
  let last: number | null = null;
  for (let c = r.start; c < r.end; c++) {
    const p = columnPosition(stack, c);
    if (p === null) continue;
    first ??= p;
    last = p;
  }
  const columns = `columns ${r.start + 1}-${r.end}`;
  return first === null || last === null ? columns : `${columns}, reference ${first}-${last}`;
}

interface Sequence {
  readonly name: string;
  readonly text: string;
}

export interface CopyOutput {
  readonly text: string;
  /** How many sequences the text holds: a row's bases, and each CDS's amino acids, count one each. */
  readonly rows: number;
  /** The columns taken. */
  readonly columns: number;
}

const EMPTY: CopyOutput = { text: '', rows: 0, columns: 0 };

/**
 * The text `options` make of the context. A row with nothing in the columns
 * (a sample that does not reach them, gaps dropped) is left out; with no
 * row left the text is empty, and there is nothing to copy. Text ends
 * without a newline, so one sequence pastes as itself; FASTA records end in
 * one, as they do everywhere else.
 */
export function copyOutput(options: CopyOptions, ctx: CopyContext): CopyOutput {
  const o = effectiveOptions(options, ctx);
  const { stack, frames, referenceName } = ctx;
  const range =
    o.columns === 'all' ? { start: 0, end: stack.columns } : selectionColumns(stack, ctx.selection);
  if (range === null || range.end <= range.start) return EMPTY;
  const mode: CopyMode = o.gaps === 'dropped' ? 'residues' : 'aligned';
  const records: Sequence[] = [];
  for (const row of rowsOf(o.rows, ctx)) {
    const name = rowName(stack, referenceName, row);
    if (o.tracks !== 'aa') records.push({ name, text: rowBases(stack, row, range, mode) });
    if (o.tracks !== 'bases' && frames !== null) {
      for (const line of rowResidues(stack, frames, row, range, mode)) {
        records.push({ name: `${name}|${line.frame}|aa`, text: line.letters });
      }
    }
  }
  const kept = records.filter((r) => r.text !== '');
  if (kept.length === 0) return EMPTY;
  const coords = o.coordinates ? coordinateNote(stack, range) : '';
  let text: string;
  if (o.format === 'fasta') {
    text = kept.map((r) => fastaRecord(r.name, r.text, coords)).join('');
  } else {
    const names = kept.map((r) => cut(r.name));
    const width = Math.max(...names.map((n) => n.length));
    const lines = o.names
      ? kept.map((r, i) => `${(names[i] ?? '').padEnd(width)} ${r.text}`)
      : kept.map((r) => r.text);
    if (coords !== '') lines.unshift(`${coords.charAt(0).toUpperCase()}${coords.slice(1)}`);
    text = lines.join('\n');
  }
  return { text, rows: kept.length, columns: range.end - range.start };
}

/** "3 rows × 57 columns, 180 characters" for the preview's foot. */
export function copySummary(out: CopyOutput): string {
  const rows = `${out.rows.toLocaleString()} ${out.rows === 1 ? 'row' : 'rows'}`;
  const columns = `${out.columns.toLocaleString()} ${out.columns === 1 ? 'column' : 'columns'}`;
  return `${rows} × ${columns}, ${out.text.length.toLocaleString()} characters`;
}

/** The line under the alignment after the panel's copy: "Copied 3 rows × 57 columns as FASTA". */
export function copiedSummaryNote(out: CopyOutput, format: FormatChoice): string {
  const rows = `${out.rows.toLocaleString()} ${out.rows === 1 ? 'row' : 'rows'}`;
  const columns = `${out.columns.toLocaleString()} ${out.columns === 1 ? 'column' : 'columns'}`;
  return `Copied ${rows} × ${columns}${format === 'fasta' ? ' as FASTA' : ''}`;
}

/** Above this many characters the panel warns before copying; the copy still goes. */
export const LARGE_COPY_CHARS = 1_000_000;

/** A warning for a copy that is large enough to make pasting slow, or null. */
export function largeCopyWarning(out: CopyOutput): string | null {
  if (out.text.length < LARGE_COPY_CHARS) return null;
  const mb = (out.text.length / 1_000_000).toFixed(1);
  return `A large copy, about ${mb} MB of text: pasting it into a form or a small editor may be slow.`;
}

export interface Preview {
  readonly lines: readonly string[];
  /** Lines not shown. */
  readonly more: number;
}

/** The first `maxLines` lines, each cut to `width` characters with an ellipsis, for the preview. */
export function previewLines(text: string, maxLines = 6, width = 72): Preview {
  if (text === '') return { lines: [], more: 0 };
  const all = text.endsWith('\n') ? text.slice(0, -1).split('\n') : text.split('\n');
  const lines = all
    .slice(0, maxLines)
    .map((l) => (l.length > width ? `${l.slice(0, width - 1)}…` : l));
  return { lines, more: Math.max(0, all.length - lines.length) };
}

/** Where the options are remembered, per browser like the view's other settings. */
const KEY = 'plasmidpop.alignmentCopy';

type Store = Pick<Storage, 'getItem' | 'setItem'>;

function storage(): Store | null {
  try {
    return globalThis.localStorage;
  } catch {
    return null; // Storage unavailable (private mode, blocked cookies).
  }
}

function pick<T extends string>(choices: readonly T[], value: unknown, fallback: T): T {
  return typeof value === 'string' && (choices as readonly string[]).includes(value)
    ? (value as T)
    : fallback;
}

/** The options as a value read back from storage: each field checked, an unknown one at its default. */
export function normalizeCopyOptions(value: unknown): CopyOptions {
  const d = DEFAULT_COPY_OPTIONS;
  if (typeof value !== 'object' || value === null) return d;
  const v = value as Record<string, unknown>;
  return {
    rows: pick(ROW_CHOICES, v['rows'], d.rows),
    columns: pick(COLUMN_CHOICES, v['columns'], d.columns),
    gaps: pick(GAP_CHOICES, v['gaps'], d.gaps),
    tracks: pick(TRACK_CHOICES, v['tracks'], d.tracks),
    format: pick(FORMAT_CHOICES, v['format'], d.format),
    names: typeof v['names'] === 'boolean' ? v['names'] : d.names,
    coordinates: typeof v['coordinates'] === 'boolean' ? v['coordinates'] : d.coordinates,
  };
}

/** The options as last saved, or the defaults: best effort, like the rest of local persistence. */
export function loadCopyOptions(store: Store | null = storage()): CopyOptions {
  try {
    const raw = store?.getItem(KEY);
    if (raw === null || raw === undefined) return DEFAULT_COPY_OPTIONS;
    return normalizeCopyOptions(JSON.parse(raw));
  } catch {
    return DEFAULT_COPY_OPTIONS;
  }
}

export function saveCopyOptions(o: CopyOptions, store: Store | null = storage()): void {
  try {
    store?.setItem(KEY, JSON.stringify(o));
  } catch {
    // Nothing to do: the panel opens at the defaults next time.
  }
}
