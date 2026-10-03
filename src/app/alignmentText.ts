import { columnPosition, type Stack, type StackRow } from './alignmentStack';

/**
 * The large view's alignment as text (#126): blocks of columns with names,
 * positions and a match line, and aligned FASTA. Pure, so the layout is
 * tested without a window. A range is columns `[start, end)`, 0-based as the
 * stack's own; positions printed are 1-based.
 */

export interface ColumnRange {
  readonly start: number;
  readonly end: number;
}

/** Columns per block of the text form, unless asked otherwise. */
export const DEFAULT_BLOCK = 60;
/** The longest name the text form prints; a longer one is cut. */
const NAME_LIMIT = 24;
/** Residues per line of the aligned FASTA. */
const FASTA_WIDTH = 60;

/** `range` kept inside the stack's columns and in order, or null when it holds none. */
export function clampRange(stack: Stack, range: ColumnRange): ColumnRange | null {
  const start = Math.max(0, Math.min(range.start, range.end));
  const end = Math.min(stack.columns, Math.max(range.start, range.end));
  return Number.isFinite(start) && Number.isFinite(end) && end > start ? { start, end } : null;
}

/** A character of a row that is a base: not a gap and not outside the sample's stretch. */
function isBase(ch: string): boolean {
  return ch !== '-' && ch !== ' ' && ch !== '';
}

/**
 * Whether every row that has a character in the column has the same one, and
 * at least two do (the reference counts). A gap agrees with a gap; a column
 * that only one row reaches is not marked.
 */
export function columnAgrees(stack: Stack, column: number): boolean {
  const ref = stack.reference.charAt(column).toUpperCase();
  let rows = 1;
  for (const row of stack.rows) {
    const ch = row.bases.charAt(column);
    if (ch === ' ' || ch === '') continue;
    if (ch.toUpperCase() !== ref) return false;
    rows++;
  }
  return rows >= 2;
}

/** The match line for a range: `|` where all agree, a space where not. */
export function matchLine(stack: Stack, range: ColumnRange): string {
  let out = '';
  for (let c = range.start; c < range.end; c++) out += columnAgrees(stack, c) ? '|' : ' ';
  return out;
}

/** How many bases a sample has before each column: its own first aligned base is 0-based `first`. */
function firstBaseOf(row: StackRow): number {
  return row.result.alignment.startB + row.result.offsetB;
}

interface Line {
  readonly name: string;
  readonly text: string;
  /** 1-based number of the first and last base of the block along the row's own numbering, or null. */
  readonly from: number | null;
  readonly to: number | null;
}

/** The reference's line of one block: positions as numbered on screen. */
function referenceLine(stack: Stack, name: string, a: number, b: number): Line {
  let from: number | null = null;
  let to: number | null = null;
  for (let c = a; c < b; c++) {
    const p = columnPosition(stack, c);
    if (p === null) continue;
    from ??= p;
    to = p;
  }
  return { name, text: stack.reference.slice(a, b), from, to };
}

/** A sample's line: numbers count its own bases, from where its aligned stretch starts. */
function sampleLine(row: StackRow, before: number, a: number, b: number): Line {
  const text = row.bases.slice(a, b);
  let n = 0;
  for (const ch of text) if (isBase(ch)) n++;
  return {
    name: row.name,
    text,
    from: n === 0 ? null : firstBaseOf(row) + before + 1,
    to: n === 0 ? null : firstBaseOf(row) + before + n,
  };
}

function cut(name: string): string {
  const one = name.replace(/\s+/g, ' ').trim();
  return one.length > NAME_LIMIT ? `${one.slice(0, NAME_LIMIT - 1)}…` : one;
}

/**
 * The alignment in blocks of `block` columns: each block has the reference,
 * a match line and one line per sample, each led by its name and the
 * 1-based number of its first base in the block and ended by its last. The
 * reference is numbered as the ruler is; a sample along its own aligned
 * bases. A sample has spaces outside the stretch it covers. A block with no
 * base in a row leaves its numbers blank.
 */
export function alignmentText(
  stack: Stack,
  referenceName: string,
  range: ColumnRange,
  block: number = DEFAULT_BLOCK,
): string {
  const r = clampRange(stack, range);
  if (r === null) return '';
  const size = Math.max(1, Math.floor(block));
  const names = [referenceName, ...stack.rows.map((row) => row.name)].map(cut);
  const nameWidth = Math.max(...names.map((n) => n.length));
  // The bases each sample has before the range, so numbering carries across blocks.
  const seen = stack.rows.map((row) => {
    let n = 0;
    for (const ch of row.bases.slice(0, r.start)) if (isBase(ch)) n++;
    return n;
  });
  const blocks: string[][] = [];
  for (let a = r.start; a < r.end; a += size) {
    const b = Math.min(r.end, a + size);
    const lines: Line[] = [
      referenceLine(stack, names[0] ?? referenceName, a, b),
      ...stack.rows.map((row, i) => sampleLine(row, seen[i] ?? 0, a, b)),
    ];
    const numberWidth = Math.max(
      1,
      ...lines.map((l) => (l.to === null ? 0 : String(l.to).length)),
      ...lines.map((l) => (l.from === null ? 0 : String(l.from).length)),
    );
    const num = (n: number | null): string => (n === null ? '' : String(n));
    const format = (name: string, text: string, from: string, to: string): string =>
      `${name.padEnd(nameWidth)} ${from.padStart(numberWidth)} ${text}${to === '' ? '' : ` ${to}`}`;
    const out: string[] = [];
    lines.forEach((l, i) => {
      out.push(format(names[i] ?? l.name, l.text, num(l.from), num(l.to)).trimEnd());
      if (i === 0) out.push(format('', matchLine(stack, { start: a, end: b }), '', ''));
    });
    stack.rows.forEach((row, i) => {
      for (const ch of row.bases.slice(a, b)) if (isBase(ch)) seen[i] = (seen[i] ?? 0) + 1;
    });
    blocks.push(out);
  }
  return `${blocks.map((b) => b.join('\n')).join('\n\n')}\n`;
}

function wrap(text: string, width: number): string {
  const lines: string[] = [];
  for (let i = 0; i < text.length; i += width) lines.push(text.slice(i, i + width));
  return lines.join('\n');
}

/**
 * The columns as aligned FASTA: the reference first, then every sample, all
 * the same length, a gap as `-`. A sample's stretch outside what it covers
 * is gaps too, so the records stay in register in any tool.
 */
export function alignedFasta(stack: Stack, referenceName: string, range: ColumnRange): string {
  const r = clampRange(stack, range);
  if (r === null) return '';
  const record = (name: string, text: string): string =>
    `>${name.replace(/\s+/g, ' ').trim() || 'sequence'}\n${wrap(text, FASTA_WIDTH)}\n`;
  return [
    record(referenceName, stack.reference.slice(r.start, r.end)),
    ...stack.rows.map((row) =>
      record(row.name, row.bases.slice(r.start, r.end).replace(/ /g, '-')),
    ),
  ].join('');
}
