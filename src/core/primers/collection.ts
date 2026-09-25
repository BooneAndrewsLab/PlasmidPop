import { type Feature, qualifierValues } from '../features';
import { type Topology } from '../range';
import {
  type AnnealOptions,
  type AnnealingSite,
  ANNEAL_DEFAULTS,
  buildAnnealIndex,
  cleanPrimer,
  findAnnealingSites,
} from './anneal';

/**
 * A primer collection: the oligos a lab has in its freezer, kept in the
 * browser, and the search for where each of them binds on the document in
 * front (#64, item 56).
 *
 * The search is not a new matcher. It is `findAnnealingSites`, the search
 * PCR anneals by, run once per primer: a collection is mostly cloning and
 * sequencing primers, and a cloning primer's 5′ tail (a site, an arm, a tag)
 * matches the template nowhere, so a search insisting on the whole oligo
 * would miss exactly the primers most worth finding. What binds is what PCR
 * would call binding: the 3′ end exact, a few mismatches allowed further in,
 * either strand, and through the origin of a circle.
 */

/** A primer as the collection keeps it. */
export interface CollectionPrimer {
  readonly id: string;
  readonly name: string;
  /** 5′→3′, as it would be ordered: IUPAC codes kept, anything else dropped. */
  readonly sequence: string;
  readonly notes: string;
}

/** A primer on its way into the collection, before it has an id. */
export interface PrimerDraft {
  readonly name: string;
  readonly sequence: string;
  readonly notes: string;
}

// ------------------------------------------------------------------ binding

/** Where one primer of the collection binds: an annealing site, and whose it is. */
export interface PrimerHit extends AnnealingSite {
  readonly primerId: string;
  readonly name: string;
}

export interface PrimerSearch {
  /** Every site of every primer, in template order, forward before reverse. */
  readonly hits: readonly PrimerHit[];
  /** Primers too short to call a site by (`minAnneal`), which were not searched. */
  readonly tooShort: readonly string[];
}

/**
 * Where every primer of `primers` binds on `sequence`. A primer is searched
 * by its 3′ end (`findAnnealingSites`), so one with a 5′ tail is found by the
 * part that anneals and the rest reported as `tail`; `mismatches` counts only
 * those inside the annealed part, never under the exact 3′ anchor.
 */
export function findCollectionPrimers(
  sequence: string,
  topology: Topology,
  primers: readonly Pick<CollectionPrimer, 'id' | 'name' | 'sequence'>[],
  options: AnnealOptions = {},
): PrimerSearch {
  const minAnneal = options.minAnneal ?? ANNEAL_DEFAULTS.minAnneal;
  const hits: PrimerHit[] = [];
  const tooShort: string[] = [];
  // One index of the template for the whole collection: each primer is then
  // tried only where its 3′ anchor stands, not at every base.
  const index = buildAnnealIndex(
    sequence,
    topology,
    options.exactThreePrime ?? ANNEAL_DEFAULTS.exactThreePrime,
  );
  for (const primer of primers) {
    if (cleanPrimer(primer.sequence).length < minAnneal) {
      tooShort.push(primer.id);
      continue;
    }
    for (const site of findAnnealingSites(sequence, topology, primer.sequence, options, index)) {
      hits.push({ ...site, primerId: primer.id, name: primer.name });
    }
  }
  hits.sort(
    (a, b) =>
      a.range.start - b.range.start ||
      a.strand.localeCompare(b.strand) ||
      a.name.localeCompare(b.name),
  );
  return { hits, tooShort };
}

// ------------------------------------------------------------ adding primers

/** The name a primer gets when it came without one: the first `Primer N` not taken. */
export function nextPrimerName(taken: ReadonlySet<string>): string {
  for (let n = 1; ; n++) {
    const name = `Primer ${n}`;
    if (!taken.has(name)) return name;
  }
}

/**
 * Drafts made ready to keep: sequences cleaned, empty ones dropped, missing
 * names filled in, and a draft that is already in the collection — same
 * name, same bases — left out rather than kept twice. The same oligo under a
 * second name is kept: labs do order one primer twice, and which name is the
 * right one is not the app's to decide.
 */
export function preparePrimers(
  existing: readonly Pick<CollectionPrimer, 'name' | 'sequence'>[],
  drafts: readonly PrimerDraft[],
): { readonly ready: readonly PrimerDraft[]; readonly duplicates: number; readonly empty: number } {
  const names = new Set(existing.map((p) => p.name));
  const seen = new Set(existing.map((p) => `${p.name}\u0000${cleanPrimer(p.sequence)}`));
  const ready: PrimerDraft[] = [];
  let duplicates = 0;
  let empty = 0;
  for (const draft of drafts) {
    const sequence = cleanPrimer(draft.sequence);
    if (sequence === '') {
      empty++;
      continue;
    }
    const name = draft.name.trim() === '' ? nextPrimerName(names) : draft.name.trim();
    const key = `${name}\u0000${sequence}`;
    if (seen.has(key)) {
      duplicates++;
      continue;
    }
    seen.add(key);
    names.add(name);
    ready.push({ name, sequence, notes: draft.notes.trim() });
  }
  return { ready, duplicates, empty };
}

/** What a feature's `/note` says the oligo was, when a note says so. */
const SEQUENCE_NOTE = /^\s*(?:sequence|PCR primer)\s*:\s*([A-Za-z]+)/i;

/**
 * A `primer_bind` feature as a primer. The oligo's own sequence when a note
 * carries it — `sequence: …`, as the Primers tab and a SnapGene file write
 * one, or `PCR primer: …`, as a PCR product's are — since that has the tail
 * the template does not; the bases under the feature, read along its strand,
 * otherwise. Its other notes become the primer's.
 */
export function primerFromFeature(
  doc: { featureSequence(feature: Feature): string },
  feature: Feature,
): PrimerDraft | null {
  let sequence = '';
  const notes: string[] = [];
  for (const note of qualifierValues(feature, 'note')) {
    const m = SEQUENCE_NOTE.exec(note);
    const bases = m?.[1] === undefined ? '' : cleanPrimer(m[1]);
    if (sequence === '' && bases !== '') sequence = bases;
    else if (note.trim() !== '') notes.push(note.trim());
  }
  if (sequence === '') sequence = cleanPrimer(doc.featureSequence(feature));
  if (sequence === '') return null;
  return { name: feature.name, sequence, notes: notes.join('; ') };
}

// ------------------------------------------------------------- reading lists

/** A pasted or imported list, read. */
export interface ParsedPrimerList {
  readonly primers: readonly PrimerDraft[];
  /** Lines that held something but no primer, 1-based, for the user to look at. */
  readonly skipped: readonly number[];
  readonly format: 'fasta' | 'table' | 'lines';
}

/** Shortest run of bases taken to be a primer when telling one apart from a name. */
export const MIN_LISTED_PRIMER = 8;

/**
 * A cell as a primer sequence, or null when it is not one. `5′-…-3′` and
 * spaces between codons are allowed, as a paper or an order sheet writes
 * them; anything else that is not a nucleotide code means it is a name.
 */
export function asPrimerSequence(cell: string): string | null {
  const bare = cell
    .trim()
    .replace(/^5\s*['′’]?\s*-?\s*/, (m) => (/['′’-]/.test(m) ? '' : m))
    .replace(/\s*-?\s*3\s*['′’]$/, '')
    .replace(/[\s-]+/g, '');
  if (bare.length < MIN_LISTED_PRIMER) return null;
  if (!/^[ACGTURYSWKMBDHVN]+$/i.test(bare)) return null;
  return cleanPrimer(bare);
}

/**
 * Reads a list of primers pasted or loaded from a file, whichever of three
 * shapes it has:
 *
 * - **FASTA**: `>name notes`, then the bases on as many lines as they take.
 * - **A table** (CSV, TSV or `;`-separated, as a spreadsheet saves one): a
 *   header naming `name`, `sequence` and `notes` columns is followed; without
 *   one, the column holding bases is the sequence, the first other column the
 *   name and the rest notes.
 * - **Lines**: one primer per line, the bases alone or after a name.
 */
export function parsePrimerList(text: string): ParsedPrimerList {
  const clean = text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  const lines = clean.split('\n');
  const first = lines.find((l) => l.trim() !== '');
  if (first?.trim().startsWith('>') === true) return parseFasta(lines);
  const delimiter = tableDelimiter(clean);
  if (delimiter !== null) return parseTable(clean, delimiter);
  return parseLines(lines);
}

function parseFasta(lines: readonly string[]): ParsedPrimerList {
  const primers: PrimerDraft[] = [];
  const skipped: number[] = [];
  let current: { name: string; notes: string; bases: string; line: number } | null = null;
  const flush = (): void => {
    if (current === null) return;
    const sequence = cleanPrimer(current.bases);
    if (sequence === '') skipped.push(current.line);
    else primers.push({ name: current.name, sequence, notes: current.notes });
  };
  lines.forEach((raw, i) => {
    const line = raw.trim();
    if (line === '' || line.startsWith(';')) return;
    if (line.startsWith('>')) {
      flush();
      const header = line.slice(1).trim();
      const space = header.search(/\s/);
      current = {
        name: space < 0 ? header : header.slice(0, space),
        notes: space < 0 ? '' : header.slice(space + 1).trim(),
        bases: '',
        line: i + 1,
      };
      return;
    }
    if (current === null) skipped.push(i + 1);
    else current.bases += line.replace(/\s+/g, '');
  });
  flush();
  return { primers, skipped, format: 'fasta' };
}

/**
 * The delimiter of a table, or null for a plain list. A tab wins, being what
 * a spreadsheet copies; then a comma or semicolon, when every record has one
 * outside quotes, since a lone comma in one note is not a table.
 */
function tableDelimiter(text: string): string | null {
  for (const d of ['\t', ',', ';']) {
    const records = splitRecords(text, d);
    if (records.length > 0 && records.every((r) => r.cells.length > 1)) return d;
  }
  return null;
}

/** One record of a table: its cells, and the line it starts on (1-based). */
interface TableRecord {
  readonly cells: readonly string[];
  readonly line: number;
}

/**
 * The records of a delimited table, with `"quoted, ""cells"""` as CSV writes
 * them, a quoted cell running over line breaks. Cells are trimmed, except
 * inside quotes; records with nothing in them are left out.
 */
function splitRecords(text: string, delimiter: string): TableRecord[] {
  const out: TableRecord[] = [];
  let cells: string[] = [];
  let cell = '';
  let quoted = false;
  let wasQuoted = false;
  let line = 1;
  let startLine = 1;
  const endCell = (): void => {
    cells.push(wasQuoted ? cell : cell.trim());
    cell = '';
    wasQuoted = false;
  };
  const endRecord = (): void => {
    endCell();
    if (cells.some((c) => c.trim() !== '')) out.push({ cells, line: startLine });
    cells = [];
  };
  for (let i = 0; i < text.length; i++) {
    const c = text.charAt(i);
    if (quoted) {
      if (c === '"' && text.charAt(i + 1) === '"') {
        cell += '"';
        i++;
      } else if (c === '"') quoted = false;
      else {
        if (c === '\n') line++;
        cell += c;
      }
    } else if (c === '"' && !wasQuoted && cell.trim() === '') {
      quoted = true;
      wasQuoted = true;
      cell = '';
    } else if (c === delimiter) {
      endCell();
    } else if (c === '\n') {
      endRecord();
      line++;
      startLine = line;
    } else if (!wasQuoted) cell += c;
  }
  endRecord();
  return out;
}

/** One row of a delimited table, split as `splitRecords` splits one. */
export function splitRow(line: string, delimiter: string): string[] {
  return [...(splitRecords(line, delimiter)[0]?.cells ?? [])];
}

const NAME_HEADER = /^(name|primer|primer name|oligo|oligo name|id)$/i;
const SEQUENCE_HEADER =
  /^(seq|sequence|bases|primer sequence|oligo sequence|sequence \(5'?-?3'?\))$/i;
const NOTES_HEADER = /^(notes?|description|comments?|remarks?)$/i;

function parseTable(text: string, delimiter: string): ParsedPrimerList {
  const rows = splitRecords(text, delimiter);
  const head = rows[0];
  let columns: { name: number; sequence: number; notes: number } | null = null;
  if (head?.cells.every((c) => asPrimerSequence(c) === null) === true) {
    const sequence = head.cells.findIndex((c) => SEQUENCE_HEADER.test(c));
    if (sequence >= 0) {
      columns = {
        sequence,
        name: head.cells.findIndex((c) => NAME_HEADER.test(c)),
        notes: head.cells.findIndex((c) => NOTES_HEADER.test(c)),
      };
    }
  }
  const primers: PrimerDraft[] = [];
  const skipped: number[] = [];
  for (const row of columns === null ? rows : rows.slice(1)) {
    const draft = columns === null ? guessRow(row.cells) : readRow(row.cells, columns);
    if (draft === null) skipped.push(row.line);
    else primers.push(draft);
  }
  return { primers, skipped, format: 'table' };
}

function readRow(
  cells: readonly string[],
  columns: { name: number; sequence: number; notes: number },
): PrimerDraft | null {
  const sequence = asPrimerSequence(cells[columns.sequence] ?? '');
  if (sequence === null) return null;
  // A column the header does not have is -1, which no cell is at.
  return {
    name: cells[columns.name] ?? '',
    sequence,
    notes: cells[columns.notes] ?? '',
  };
}

/**
 * A row with no header to go by: the last cell that is bases is the
 * sequence (a name like `GAPDH-F` is not bases, and a name made only of
 * letters that happen to be codes is shorter than a primer), the first
 * other cell the name and the rest the notes.
 */
function guessRow(cells: readonly string[]): PrimerDraft | null {
  let at = -1;
  let sequence = '';
  for (let i = 0; i < cells.length; i++) {
    const s = asPrimerSequence(cells[i] ?? '');
    if (s !== null) {
      at = i;
      sequence = s;
    }
  }
  if (at < 0) return null;
  const others = cells.filter((c, i) => i !== at && c !== '');
  return { name: others[0] ?? '', sequence, notes: others.slice(1).join('; ') };
}

function parseLines(lines: readonly string[]): ParsedPrimerList {
  const primers: PrimerDraft[] = [];
  const skipped: number[] = [];
  lines.forEach((raw, i) => {
    const line = raw.trim();
    if (line === '' || line.startsWith('#')) return;
    const whole = asPrimerSequence(line);
    if (whole !== null) {
      primers.push({ name: '', sequence: whole, notes: '' });
      return;
    }
    const draft = guessRow(line.split(/\s+/));
    if (draft === null) skipped.push(i + 1);
    else primers.push(draft);
  });
  return { primers, skipped, format: 'lines' };
}

// ------------------------------------------------------------------ writing

function csvCell(value: string): string {
  return /[",\r\n]/.test(value) || value !== value.trim()
    ? `"${value.replace(/"/g, '""')}"`
    : value;
}

/** The collection as CSV, `name,sequence,notes`, which `parsePrimerList` reads back as it was. */
export function writePrimerCsv(primers: readonly PrimerDraft[]): string {
  const rows = [
    'name,sequence,notes',
    ...primers.map((p) => [p.name, p.sequence, p.notes].map(csvCell).join(',')),
  ];
  return `${rows.join('\r\n')}\r\n`;
}

/**
 * The collection as FASTA, `>name notes`. A FASTA name ends at the first
 * space, so spaces in a name are written as underscores; CSV is the export
 * that keeps a name as it is.
 */
export function writePrimerFasta(primers: readonly PrimerDraft[]): string {
  return primers
    .map((p) => {
      const name = p.name.trim().replace(/\s+/g, '_') || 'primer';
      const notes = p.notes.replace(/\s+/g, ' ').trim();
      return `>${name}${notes === '' ? '' : ` ${notes}`}\n${p.sequence}\n`;
    })
    .join('');
}
