import { type PartDraft } from '@/core';

/**
 * Reading the data files of a pLannotate database a user already has (#210,
 * item 86). Nothing of pLannotate is shipped and none of its code is used:
 * this reads two plain-text file shapes, as its documentation and its
 * `makedb` / gatherer scripts describe them, from files the user supplies
 * (verified against the `master` branch, October 2026):
 *
 * - a **FASTA** of the sequences its search index is built from. The header's
 *   first word is the part's id (`sseqid`). `snapgene` holds nucleotides;
 *   `fpbase` holds proteins, headed by FPbase's slug.
 * - a **descriptions table**, one row per id. pLannotate's own columns are
 *   `sseqid,name,type,blurb` (CSV), or in older releases
 *   `sseqid,Feature,Type,Description`; its loader also accepts `id` or
 *   `accession` for the id, `feature` or `gene` for the name, and
 *   `description`, `desc` or `note` for the blurb, in any case. FPbase's
 *   gatherer writes a headerless TSV of `slug, name, blurb`.
 *
 * The importer is tolerant: the delimiter is sniffed, a header is looked
 * for, and an id without a row is still a part, named by its id. pLannotate
 * also ships its indexes as BLAST/DIAMOND/SQLite files, which are not read;
 * the FASTA and the table are.
 */

export interface FastaRecord {
  readonly id: string;
  /** The header after its first word. */
  readonly description: string;
  readonly sequence: string;
}

/** Records of a FASTA text, residues as written minus whitespace and digits. */
export function readFastaRecords(text: string): FastaRecord[] {
  const out: FastaRecord[] = [];
  let header: string | null = null;
  let seq = '';
  const flush = (): void => {
    if (header === null) return;
    const body = header.trim();
    const space = body.search(/\s/);
    out.push({
      id: space < 0 ? body : body.slice(0, space),
      description: space < 0 ? '' : body.slice(space).trim(),
      sequence: seq.replace(/[\s\d*-]/g, ''),
    });
  };
  for (const line of text.replace(/\r\n?/g, '\n').split('\n')) {
    if (line.startsWith('>')) {
      flush();
      header = line.slice(1);
      seq = '';
    } else if (header !== null) seq += line;
  }
  flush();
  return out;
}

/** Rows of delimited text, with quoted fields (and doubled quotes) as RFC 4180 has them. */
export function readDelimited(text: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  for (let i = 0; i < src.length; i++) {
    const c = src[i] ?? '';
    if (quoted) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += c;
    } else if (c === '"' && field === '') quoted = true;
    else if (c === delimiter) {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++;
      row.push(field);
      field = '';
      if (row.some((f) => f.trim() !== '')) rows.push(row);
      row = [];
    } else field += c;
  }
  row.push(field);
  if (row.some((f) => f.trim() !== '')) rows.push(row);
  return rows;
}

const ID_COLUMNS = ['sseqid', 'id', 'accession', 'qseqid'];
const NAME_COLUMNS = ['name', 'feature', 'gene'];
const TYPE_COLUMNS = ['type'];
const BLURB_COLUMNS = ['blurb', 'description', 'desc', 'note'];

export interface PlannotateDescription {
  readonly name: string;
  readonly type: string;
  readonly blurb: string;
}

/** The descriptions of a table, by id; the first row of an id wins, as in pLannotate. */
export function readDescriptions(text: string): Map<string, PlannotateDescription> {
  const head = text.split(/\r?\n/, 1)[0] ?? '';
  const tabs = head.split('\t').length;
  const commas = head.split(',').length;
  const rows = readDelimited(text, tabs > commas ? '\t' : ',');
  const out = new Map<string, PlannotateDescription>();
  const first = rows[0];
  if (first === undefined) return out;
  const names = first.map((c) => c.trim().toLowerCase());
  const column = (aliases: readonly string[]): number =>
    names.findIndex((n) => aliases.includes(n));
  const idAt = column(ID_COLUMNS);
  const hasHeader = idAt >= 0;
  // No header: FPbase's gatherer writes `slug, name, blurb`.
  const at = hasHeader
    ? {
        id: idAt,
        name: column(NAME_COLUMNS),
        type: column(TYPE_COLUMNS),
        blurb: column(BLURB_COLUMNS),
      }
    : { id: 0, name: 1, type: -1, blurb: 2 };
  for (const row of hasHeader ? rows.slice(1) : rows) {
    const cell = (i: number): string => (i < 0 ? '' : (row[i] ?? '').trim());
    const id = cell(at.id);
    if (id === '' || out.has(id)) continue;
    out.set(id, { name: cell(at.name), type: cell(at.type), blurb: cell(at.blurb) });
  }
  return out;
}

/** Residues that are not bases: a record of these is a protein. */
function isDna(sequence: string): boolean {
  return /^[ACGTUN]+$/i.test(sequence);
}

/** What reading one database came to. */
export interface PlannotateImport {
  readonly drafts: readonly PartDraft[];
  /** Records read, before any was left out. */
  readonly records: number;
  /** Records with a description row. */
  readonly described: number;
}

/**
 * The parts of one pLannotate database: its FASTA and, when the user has it,
 * its descriptions table. `list` names the database (`snapgene`); every
 * part is labelled `pLannotate: <list>`. A protein record becomes a part
 * matched in the six frames; a record with no description row is named by
 * its id and typed `CDS` for a protein, `misc_feature` for DNA, as
 * pLannotate's own `makedb` does for a FASTA with no table.
 */
export function readPlannotate(
  fasta: string,
  table: string | null,
  list: string,
): PlannotateImport {
  const records = readFastaRecords(fasta);
  const descriptions =
    table === null ? new Map<string, PlannotateDescription>() : readDescriptions(table);
  const origin = `pLannotate: ${list}`;
  let described = 0;
  const drafts: PartDraft[] = [];
  for (const r of records) {
    const d = descriptions.get(r.id);
    if (d !== undefined) described++;
    const dna = isDna(r.sequence);
    const blurb = d?.blurb ?? r.description;
    drafts.push({
      name: d !== undefined && d.name !== '' ? d.name : r.id,
      type: d !== undefined && d.type !== '' ? d.type : dna ? 'misc_feature' : 'CDS',
      sequence: dna ? r.sequence : '',
      ...(dna ? {} : { protein: r.sequence }),
      notes: blurb,
      origin,
    });
  }
  return { drafts, records: records.length, described };
}

/** A file the user chose, read as text. */
export interface NamedText {
  readonly name: string;
  readonly text: string;
}

/** The part of a file name that names its database: `snapgene.fasta` and `snapgene.csv` are `snapgene`. */
export function databaseStem(fileName: string): string {
  const base = fileName.replace(/^.*[\\/]/, '').replace(/\.[^.]*$/, '');
  return base.replace(/[-_. ]?(descriptions?|details|metadata|blurbs?|features?)$/i, '') || base;
}

export interface PlannotatePair {
  readonly list: string;
  readonly fasta: NamedText;
  readonly table: NamedText | null;
}

/**
 * Sorts chosen files into databases: a file starting with `>` is a FASTA,
 * any other a descriptions table, and each table goes with the FASTA that
 * shares its stem (`snapgene.fasta`, `snapgene.csv`); a lone table goes with
 * a lone FASTA whatever it is called. Tables left without a FASTA are returned in `unpaired`.
 */
export function pairPlannotateFiles(files: readonly NamedText[]): {
  readonly pairs: readonly PlannotatePair[];
  readonly unpaired: readonly NamedText[];
} {
  const fastas = files.filter((f) => /^\s*>/.test(f.text));
  const tables = files.filter((f) => !/^\s*>/.test(f.text));
  const used = new Set<NamedText>();
  const pairs: PlannotatePair[] = fastas.map((fasta) => {
    const stem = databaseStem(fasta.name).toLowerCase();
    let table =
      tables.find((t) => !used.has(t) && databaseStem(t.name).toLowerCase() === stem) ?? null;
    if (table === null && fastas.length === 1) table = tables.find((t) => !used.has(t)) ?? null;
    if (table !== null) used.add(table);
    return { list: databaseStem(fasta.name), fasta, table };
  });
  return { pairs, unpaired: tables.filter((t) => !used.has(t)) };
}
