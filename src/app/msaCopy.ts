import { pickChoice, browserStorage, type FormatChoice, type CopyOutput } from './alignmentCopy';
import { cut, fastaRecord, type ColumnRange } from './alignmentText';
import {
  MSA_CONSENSUS_ROW,
  msaRowText,
  msaSelectionColumns,
  type MsaCopyMode,
  type MsaSelection,
} from './msaSelection';

/**
 * The multiple alignment's Advanced copy (#368): what a selection copies,
 * composed from options, as the large view's does (#366) but for rows that
 * are all equal: no reference, no amino-acid strips, no tracks. Ctrl+C is
 * still the one instant copy; this is for every row in register, the
 * whole width, FASTA. Pure, so each combination is tested without a window.
 * The output has the large view's shape (`CopyOutput`), so the preview, the
 * summary line and the large-copy warning are the same code.
 */

/** Which rows go out: the selected one, every sequence, or the consensus and every sequence. */
export type MsaRowChoice = 'selected' | 'sequences' | 'with-consensus';
export type MsaColumnChoice = 'selection' | 'all';
export type MsaGapChoice = 'kept' | 'dropped';

export interface MsaCopyOptions {
  readonly rows: MsaRowChoice;
  readonly columns: MsaColumnChoice;
  readonly gaps: MsaGapChoice;
  readonly format: FormatChoice;
  /** Text only: each line led by its row's name, padded to one column. FASTA is always named. */
  readonly names: boolean;
  /** Which columns these are, and each row's own residue numbers: a line (text) or after each FASTA name. */
  readonly coordinates: boolean;
}

/** What the panel opens with the first time: the same as Ctrl+C, in text. */
export const DEFAULT_MSA_COPY_OPTIONS: MsaCopyOptions = {
  rows: 'selected',
  columns: 'selection',
  gaps: 'dropped',
  format: 'text',
  names: false,
  coordinates: false,
};

const ROW_CHOICES: readonly MsaRowChoice[] = ['selected', 'sequences', 'with-consensus'];
const COLUMN_CHOICES: readonly MsaColumnChoice[] = ['selection', 'all'];
const GAP_CHOICES: readonly MsaGapChoice[] = ['kept', 'dropped'];
const FORMAT_CHOICES: readonly FormatChoice[] = ['text', 'fasta'];

/** What the options are applied to. */
export interface MsaCopyContext {
  readonly rows: readonly string[];
  readonly consensus: string;
  /** The rows' names as the window shows them (unique), without the consensus's. */
  readonly names: readonly string[];
  readonly columns: number;
  readonly selection: MsaSelection;
}

/** Several rows must stay in register, so their gaps are kept: the panel greys Gaps out and the copy follows. */
export function msaGapsKept(o: MsaCopyOptions): boolean {
  return o.rows !== 'selected';
}

/** The options as they apply, each ruled-out choice replaced by what it falls back to. */
export function effectiveMsaOptions(o: MsaCopyOptions): MsaCopyOptions {
  return msaGapsKept(o) ? { ...o, gaps: 'kept' } : o;
}

export const MSA_CONSENSUS_NAME = 'Consensus';

function rowsOf(choice: MsaRowChoice, ctx: MsaCopyContext): number[] {
  const all = ctx.rows.map((_, i) => i);
  if (choice === 'sequences') return all;
  if (choice === 'with-consensus') return [MSA_CONSENSUS_ROW, ...all];
  return [ctx.selection.row];
}

function nameOf(row: number, ctx: MsaCopyContext): string {
  return row === MSA_CONSENSUS_ROW ? MSA_CONSENSUS_NAME : (ctx.names[row] ?? '');
}

/**
 * The row's own residue numbers over `r`, 1-based inclusive, as "residues
 * 12-40"; null for the consensus (no sequence of its own) and for a row with
 * no residue in the columns.
 */
export function residueNote(rows: readonly string[], row: number, r: ColumnRange): string | null {
  if (row === MSA_CONSENSUS_ROW) return null;
  const text = rows[row] ?? '';
  const before = text.slice(0, r.start).replace(/-/g, '').length;
  const inside = text.slice(r.start, r.end).replace(/-/g, '').length;
  return inside === 0 ? null : `residues ${before + 1}-${before + inside}`;
}

/**
 * The text `options` make of the context. A row with nothing in the columns
 * (gaps dropped) is left out; with no row left the text is empty, and there
 * is nothing to copy. Text ends without a newline, so one sequence pastes
 * as itself; FASTA records end in one.
 */
export function msaCopyOutput(options: MsaCopyOptions, ctx: MsaCopyContext): CopyOutput {
  const o = effectiveMsaOptions(options);
  const range: ColumnRange | null =
    o.columns === 'all'
      ? { start: 0, end: ctx.columns }
      : msaSelectionColumns(ctx.columns, ctx.selection);
  if (range === null || range.end <= range.start) return { text: '', rows: 0, columns: 0 };
  const mode: MsaCopyMode = o.gaps === 'dropped' ? 'residues' : 'aligned';
  const kept = rowsOf(o.rows, ctx)
    .map((row) => ({
      row,
      name: nameOf(row, ctx),
      text: msaRowText(ctx.rows, ctx.consensus, row, range, mode),
    }))
    .filter((r) => r.text !== '');
  if (kept.length === 0) return { text: '', rows: 0, columns: 0 };
  const columns = `columns ${range.start + 1}-${range.end}`;
  let text: string;
  if (o.format === 'fasta') {
    text = kept
      .map((r) => {
        const own = o.coordinates ? residueNote(ctx.rows, r.row, range) : null;
        const note = o.coordinates ? (own === null ? columns : `${columns}, ${own}`) : '';
        return fastaRecord(r.name, r.text, note);
      })
      .join('');
  } else {
    const names = kept.map((r) => cut(r.name));
    const width = Math.max(...names.map((n) => n.length));
    const lines = o.names
      ? kept.map((r, i) => `${(names[i] ?? '').padEnd(width)} ${r.text}`)
      : kept.map((r) => r.text);
    if (o.coordinates) {
      const only = kept.length === 1 ? kept[0] : undefined;
      const own = only === undefined ? null : residueNote(ctx.rows, only.row, range);
      const head = own === null ? columns : `${columns}, ${own}`;
      lines.unshift(`${head.charAt(0).toUpperCase()}${head.slice(1)}`);
    }
    text = lines.join('\n');
  }
  return { text, rows: kept.length, columns: range.end - range.start };
}

/** Where the options are remembered, apart from the large view's, which has other choices. */
const KEY = 'plasmidpop.msaCopy';

type Store = Pick<Storage, 'getItem' | 'setItem'>;

/** The options as a value read back from storage: each field checked, an unknown one at its default. */
export function normalizeMsaCopyOptions(value: unknown): MsaCopyOptions {
  const d = DEFAULT_MSA_COPY_OPTIONS;
  if (typeof value !== 'object' || value === null) return d;
  const v = value as Record<string, unknown>;
  return {
    rows: pickChoice(ROW_CHOICES, v['rows'], d.rows),
    columns: pickChoice(COLUMN_CHOICES, v['columns'], d.columns),
    gaps: pickChoice(GAP_CHOICES, v['gaps'], d.gaps),
    format: pickChoice(FORMAT_CHOICES, v['format'], d.format),
    names: typeof v['names'] === 'boolean' ? v['names'] : d.names,
    coordinates: typeof v['coordinates'] === 'boolean' ? v['coordinates'] : d.coordinates,
  };
}

export function loadMsaCopyOptions(store: Store | null = browserStorage()): MsaCopyOptions {
  try {
    const raw = store?.getItem(KEY);
    if (raw === null || raw === undefined) return DEFAULT_MSA_COPY_OPTIONS;
    return normalizeMsaCopyOptions(JSON.parse(raw));
  } catch {
    return DEFAULT_MSA_COPY_OPTIONS;
  }
}

export function saveMsaCopyOptions(
  o: MsaCopyOptions,
  store: Store | null = browserStorage(),
): void {
  try {
    store?.setItem(KEY, JSON.stringify(o));
  } catch {
    // Nothing to do: the panel opens at the defaults next time.
  }
}
