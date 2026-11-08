import { splitRecords, tableDelimiter } from '../primers/collection';

/**
 * The table a batch design starts from (#358, #360, item 141): one row per
 * primer pair or construct, pasted from a spreadsheet or read from a file.
 * This reads the cells and finds the columns; `rows.ts` says whether each
 * row can be designed.
 *
 * Columns are found by their header as a primer list's are (item 72): loose
 * spellings, any order, a title above the header passed over. A column the
 * batch does not know is not an error but a note, kept under its header, so
 * a lab's own columns (plate, owner, date) ride along.
 */

/** The columns a batch row can fill. */
export const BATCH_COLUMNS = [
  'name',
  'template',
  'region',
  'sequence',
  'tm',
  'size',
  'enzyme',
  'left',
  'right',
  'include_start',
  'include_stop',
  'kit',
  'change',
] as const;

export type BatchColumn = (typeof BATCH_COLUMNS)[number];

/** The cells of one row, as text; a column the row has no cell for is absent. */
export type BatchCells = Partial<Record<BatchColumn, string>>;

/** A row as it was typed: nothing in it has been checked. */
export interface RawRow {
  /** Where the row was, 1-based: the line of pasted text, the row of a sheet. */
  readonly line: number;
  readonly cells: BatchCells;
  /** Cells of columns the batch does not know, as `header: value`, and any notes column. */
  readonly notes: string;
}

export interface BatchTable {
  readonly rows: readonly RawRow[];
  /** The columns the header named, in the order they appear. */
  readonly columns: readonly BatchColumn[];
  /** The worksheet a workbook's table came from. */
  readonly sheet?: string | undefined;
}

export class BatchTableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BatchTableError';
  }
}

type Role = BatchColumn | 'notes';

const STRICT: Readonly<Record<Role, readonly string[]>> = {
  name: ['name', 'id', 'primer name', 'oligo name', 'construct', 'label', 'row'],
  template: ['template', 'plasmid', 'source', 'document', 'record', 'file'],
  region: ['region', 'location', 'target', 'range', 'coordinates', 'position', 'feature', 'span'],
  sequence: ['sequence', 'seq', 'bases', 'insert', 'insert sequence'],
  tm: ['tm', 'tm c', 'target tm', 'melting temperature'],
  size: ['size', 'product size', 'amplicon', 'amplicon size'],
  enzyme: ['enzyme', 'enzymes', 'restriction enzyme', 'restriction site'],
  left: ['left', 'left tail', 'left end', '5 tail', '5 end', 'forward tail'],
  right: ['right', 'right tail', 'right end', '3 tail', '3 end', 'reverse tail'],
  include_start: ['include start', 'include start codon', 'start codon'],
  include_stop: ['include stop', 'include stop codon', 'stop codon'],
  kit: ['kit', 'method', 'recipe'],
  change: ['change', 'change to', 'mutation', 'replacement', 'replace with'],
  notes: ['notes', 'note', 'description', 'comment', 'comments', 'remarks'],
};

/** Looser spellings, tried for a column no header spells as above. */
const LOOSE: Readonly<Record<Role, RegExp>> = {
  name: /\bname\b/,
  template: /\b(template|plasmid)\b/,
  region: /\b(region|location|coordinates?)\b/,
  sequence: /\b(seq|sequence)\b/,
  tm: /\btm\b/,
  size: /\b(size|amplicon)\b/,
  enzyme: /\benzymes?\b/,
  left: /\bleft\b/,
  right: /\bright\b/,
  include_start: /\binclude start\b/,
  include_stop: /\binclude stop\b/,
  kit: /\bkit\b/,
  change: /\bchange\b/,
  notes: /\b(notes?|comments?|remarks?)\b/,
};

/** A loose match is not a column naming something else: "template name" is no name. */
const NOT_NAME = /\b(template|plasmid|enzyme|kit)\b/;
/** ...and a column naming a sequence's name, ID or length is not the sequence. */
const NOT_SEQUENCE = /\b(name|id|length|len|no|number|count|type|mw)\b|#/;

const ROLES: readonly Role[] = [...BATCH_COLUMNS, 'notes'];

/** A header as it is compared: lower case, punctuation as a space, `5'` as `5`. */
function normalise(header: string): string {
  return header
    .toLowerCase()
    .replace(/['’′]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function tidy(cell: string): string {
  return cell.replace(/\s+/g, ' ').trim();
}

/** What each header is, by position: its column, `'notes'`, or null for one the batch does not know. */
function matchHeaders(cells: readonly string[]): (Role | null)[] {
  const heads = cells.map(normalise);
  const roles: (Role | null)[] = heads.map(() => null);
  const find = (role: Role, pass: 'strict' | 'loose'): void => {
    if (roles.includes(role)) return;
    const at = heads.findIndex((h, i) => {
      if (roles[i] !== null || h === '') return false;
      if (pass === 'strict') return STRICT[role].includes(h);
      if (role === 'name' && NOT_NAME.test(h)) return false;
      if (role === 'sequence' && NOT_SEQUENCE.test(h)) return false;
      return LOOSE[role].test(h);
    });
    if (at >= 0) roles[at] = role;
  };
  for (const pass of ['strict', 'loose'] as const) for (const role of ROLES) find(role, pass);
  return roles;
}

/** How far down a title may push the header. */
const HEADER_SEARCH = 20;

interface Line {
  readonly cells: readonly string[];
  readonly line: number;
}

function readRecords(records: readonly Line[]): BatchTable | null {
  let header = -1;
  let roles: (Role | null)[] = [];
  const known = (r: readonly (Role | null)[]): number =>
    r.filter((x) => x !== null && x !== 'notes').length;
  for (const [i, record] of records.slice(0, HEADER_SEARCH).entries()) {
    const found = matchHeaders(record.cells);
    // A first row naming one column is a header; further down it takes two,
    // so that a title does not pass for one.
    if (known(found) >= (i === 0 ? 1 : 2)) {
      header = i;
      roles = found;
      break;
    }
  }
  const head = records[header];
  if (head === undefined) return null;
  const columns = [...new Set(roles.filter((r): r is BatchColumn => r !== null && r !== 'notes'))];
  const names = head.cells.map(tidy);
  const rows: RawRow[] = [];
  for (const record of records.slice(header + 1)) {
    const cells: Partial<Record<BatchColumn, string>> = {};
    const notes: string[] = [];
    record.cells.forEach((raw, i) => {
      const cell = tidy(raw);
      if (cell === '') return;
      const role = roles[i] ?? null;
      if (role === 'notes') notes.push(cell);
      else if (role !== null) cells[role] = cell;
      else notes.push(`${names[i] ?? ''}`.trim() === '' ? cell : `${names[i]}: ${cell}`);
    });
    if (Object.keys(cells).length > 0 || notes.length > 0) {
      rows.push({ line: record.line, cells, notes: notes.join('; ') });
    }
  }
  return { rows, columns };
}

const NO_HEADER =
  'No row names the columns. Put a header above the rows, such as “name, region” or “name, template, sequence”.';

/**
 * A table from pasted text: tab-, comma- or semicolon-separated, with
 * `"quoted, ""cells"""` as CSV writes them. Lines are numbered from 1.
 * A single column has no delimiter, so it is read as one.
 */
export function parseBatchText(text: string): BatchTable {
  const delimiter = tableDelimiter(text) ?? '\t';
  const table = readRecords(splitRecords(text, delimiter));
  if (table === null) throw new BatchTableError(NO_HEADER);
  return table;
}

/** A sheet's rows as a table, numbered from 1 as the sheet numbers them. */
export function parseBatchRows(rows: readonly (readonly string[])[]): BatchTable {
  const records: Line[] = [];
  rows.forEach((cells, i) => {
    if (cells.some((c) => c.trim() !== '')) records.push({ cells, line: i + 1 });
  });
  const table = readRecords(records);
  if (table === null) throw new BatchTableError(NO_HEADER);
  return table;
}

/**
 * The first sheet of a workbook, in its order, that has a header row; an
 * instructions sheet before the table is passed over (item 72). A workbook
 * with no such sheet is refused naming its sheets.
 */
export function parseBatchWorkbook(
  sheets: readonly { readonly name: string; readonly rows: readonly (readonly string[])[] }[],
): BatchTable {
  for (const sheet of sheets) {
    try {
      return { ...parseBatchRows(sheet.rows), sheet: sheet.name };
    } catch (error) {
      if (!(error instanceof BatchTableError)) throw error;
    }
  }
  const names = sheets.map((s) => `“${s.name}”`).join(', ');
  throw new BatchTableError(
    sheets.length === 1
      ? `This workbook's sheet ${names} has no row naming the columns, such as “name, region”.`
      : `None of this workbook's sheets (${names}) has a row naming the columns, such as “name, region”.`,
  );
}

function cell(value: string): string {
  return /[",\r\n\t;]/.test(value) || value !== value.trim()
    ? `"${value.replace(/"/g, '""')}"`
    : value;
}

/**
 * Rows as CSV, which `parseBatchText` reads back as they were (a row's
 * `line` aside): the columns any row fills, in the batch's order, then
 * `notes` when any row has some.
 */
export function writeBatchCsv(rows: readonly RawRow[]): string {
  const columns = BATCH_COLUMNS.filter((c) => rows.some((r) => r.cells[c] !== undefined));
  const withNotes = rows.some((r) => r.notes !== '');
  const head = [...columns, ...(withNotes ? ['notes'] : [])];
  const lines = [
    head.join(','),
    ...rows.map((r) =>
      [...columns.map((c) => r.cells[c] ?? ''), ...(withNotes ? [r.notes] : [])]
        .map(cell)
        .join(','),
    ),
  ];
  return `${lines.join('\r\n')}\r\n`;
}
