import { decodeEntities } from './xml';

/**
 * Reading a table a user brings as a file (#141): CSV or tab-separated text,
 * or the first-class spreadsheet people actually download, an Excel `.xlsx`
 * workbook. Ligase-fidelity tables are the case in point: of the fourteen
 * files in the supporting information of Potapov et al. 2018, twelve are
 * workbooks, the T4 ligase tables NEB's own tools are built on among them.
 *
 * An `.xlsx` file is a zip of XML parts, so it is read here without a
 * library: the zip's central directory says where each part is, the
 * platform's `DecompressionStream('deflate-raw')` inflates it (as the share
 * links already do), and the few elements a worksheet keeps its values in
 * are picked out of its XML. Only values are read — no formulas, formats or
 * merged cells — which is all a table of numbers needs.
 *
 * Other spreadsheet files are recognised by their first bytes and turned
 * away with a sentence that says what to do: an old binary `.xls` workbook,
 * an OpenDocument `.ods` one.
 */

/** A worksheet's name and its cells, row by row, as text. */
export interface Sheet {
  readonly name: string;
  readonly rows: readonly (readonly string[])[];
}

/** What a table file turned out to be. */
export type TableFile =
  | { readonly kind: 'text'; readonly text: string }
  | { readonly kind: 'workbook'; readonly sheets: readonly Sheet[] };

export class SpreadsheetError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SpreadsheetError';
  }
}

const SAVE_AS = 'save it as an Excel workbook (.xlsx) or as CSV and open that instead';

/**
 * Reads a file meant to hold a table, by what its bytes are rather than by
 * its name: a file dropped on the page skips the picker's filter, and a
 * renamed one keeps its contents.
 */
export async function readTableFile(bytes: Uint8Array): Promise<TableFile> {
  if (isZip(bytes)) {
    const entries = zipEntries(bytes);
    if (entries.has('xl/workbook.xml')) {
      return { kind: 'workbook', sheets: await readWorkbook(bytes, entries) };
    }
    if (entries.has('content.xml') && entries.has('mimetype')) {
      throw new SpreadsheetError(`This is an OpenDocument spreadsheet; ${SAVE_AS}.`);
    }
    throw new SpreadsheetError('This is a zip archive, not a table; open the table inside it.');
  }
  if (isCompoundFile(bytes)) {
    throw new SpreadsheetError(`This is an old-style Excel workbook (.xls); ${SAVE_AS}.`);
  }
  return { kind: 'text', text: decodeText(bytes) };
}

/** UTF-8, or UTF-16 when it starts with a byte-order mark, as Excel's "Unicode text" does. */
function decodeText(bytes: Uint8Array): string {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(bytes);
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be').decode(bytes);
  // TextDecoder drops a UTF-8 byte-order mark by itself.
  return new TextDecoder().decode(bytes);
}

function isZip(bytes: Uint8Array): boolean {
  return bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04;
}

/** The OLE2 compound file an `.xls` workbook (and an old `.doc`) is kept in. */
function isCompoundFile(bytes: Uint8Array): boolean {
  const magic = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
  return magic.every((b, i) => bytes[i] === b);
}

interface ZipEntry {
  readonly method: number;
  readonly compressedSize: number;
  readonly localOffset: number;
}

const BROKEN = 'This spreadsheet could not be read; it may be damaged.';

/**
 * The zip's central directory, by part name. It is found from the end of
 * the file, where the end-of-central-directory record sits behind at most a
 * 64 KiB comment, and it — not the local headers — holds the sizes, since a
 * part written as a stream gives them only after its data.
 */
function zipEntries(bytes: Uint8Array): Map<string, ZipEntry> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 0xffff); i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      end = i;
      break;
    }
  }
  if (end < 0) throw new SpreadsheetError(BROKEN);
  const count = view.getUint16(end + 10, true);
  let at = view.getUint32(end + 16, true);
  const entries = new Map<string, ZipEntry>();
  const names = new TextDecoder();
  for (let n = 0; n < count; n++) {
    if (at + 46 > bytes.length || view.getUint32(at, true) !== 0x02014b50) {
      throw new SpreadsheetError(BROKEN);
    }
    const nameLength = view.getUint16(at + 28, true);
    const extraLength = view.getUint16(at + 30, true);
    const commentLength = view.getUint16(at + 32, true);
    const name = names.decode(bytes.subarray(at + 46, at + 46 + nameLength));
    entries.set(name, {
      method: view.getUint16(at + 10, true),
      compressedSize: view.getUint32(at + 20, true),
      localOffset: view.getUint32(at + 42, true),
    });
    at += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

async function readPart(
  bytes: Uint8Array,
  entries: ReadonlyMap<string, ZipEntry>,
  name: string,
): Promise<string | null> {
  const entry = entries.get(name);
  if (entry === undefined) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const at = entry.localOffset;
  if (at + 30 > bytes.length || view.getUint32(at, true) !== 0x04034b50) {
    throw new SpreadsheetError(BROKEN);
  }
  const start = at + 30 + view.getUint16(at + 26, true) + view.getUint16(at + 28, true);
  const data = bytes.slice(start, start + entry.compressedSize);
  if (entry.method === 0) return new TextDecoder().decode(data);
  if (entry.method !== 8) throw new SpreadsheetError(BROKEN);
  try {
    const source = new ReadableStream<BufferSource>({
      start(controller) {
        controller.enqueue(data);
        controller.close();
      },
    });
    return await new Response(source.pipeThrough(new DecompressionStream('deflate-raw'))).text();
  } catch {
    throw new SpreadsheetError(BROKEN);
  }
}

/** Attribute `name` of an element's opening tag, entities decoded. */
function attribute(tag: string, name: string): string | null {
  const m = new RegExp(`\\s${name}\\s*=\\s*("([^"]*)"|'([^']*)')`).exec(tag);
  if (m === null) return null;
  return decodeEntities(m[2] ?? m[3] ?? '');
}

/** Elements may carry a namespace prefix (`x:sheet`) when a tool other than Excel wrote them. */
const P = '(?:[A-Za-z_][\\w.-]*:)?';

/** The text of every `<t>` inside a fragment: a rich-text string is split into runs. */
function texts(fragment: string): string {
  let out = '';
  for (const m of fragment.matchAll(new RegExp(`<${P}t(?:\\s[^>]*)?>([^<]*)</${P}t>`, 'g'))) {
    out += decodeEntities(m[1] ?? '');
  }
  return out;
}

async function readWorkbook(
  bytes: Uint8Array,
  entries: ReadonlyMap<string, ZipEntry>,
): Promise<Sheet[]> {
  const workbook = (await readPart(bytes, entries, 'xl/workbook.xml')) ?? '';
  const rels = (await readPart(bytes, entries, 'xl/_rels/workbook.xml.rels')) ?? '';
  const targets = new Map<string, string>();
  for (const m of rels.matchAll(new RegExp(`<${P}Relationship\\b[^>]*>`, 'g'))) {
    const id = attribute(m[0], 'Id');
    const target = attribute(m[0], 'Target');
    if (id !== null && target !== null) {
      // Targets are relative to xl/, or absolute from the package root.
      targets.set(id, target.startsWith('/') ? target.slice(1) : `xl/${target}`);
    }
  }
  const shared: string[] = [];
  const strings = await readPart(bytes, entries, 'xl/sharedStrings.xml');
  if (strings !== null) {
    for (const m of strings.matchAll(
      new RegExp(`<${P}si(?:\\s[^>]*)?(?:/>|>([\\s\\S]*?)</${P}si>)`, 'g'),
    )) {
      // Phonetic runs (<rPh>) carry readings, not the cell's text.
      shared.push(
        texts((m[1] ?? '').replace(new RegExp(`<${P}rPh\\b[\\s\\S]*?</${P}rPh>`, 'g'), '')),
      );
    }
  }
  const sheets: Sheet[] = [];
  for (const m of workbook.matchAll(new RegExp(`<${P}sheet\\b[^>]*>`, 'g'))) {
    const name = attribute(m[0], 'name') ?? `Sheet ${sheets.length + 1}`;
    const id = attribute(m[0], 'r:id') ?? attribute(m[0], '[\\w.-]+:id');
    const path = id === null ? undefined : targets.get(id);
    const xml = path === undefined ? null : await readPart(bytes, entries, path);
    if (xml === null) continue;
    sheets.push({ name, rows: sheetRows(xml, shared) });
  }
  if (sheets.length === 0) throw new SpreadsheetError(BROKEN);
  return sheets;
}

/** Column letters of a cell reference, as a 0-based index: `A1` → 0, `AB7` → 27. */
function columnOf(ref: string): number | null {
  const m = /^([A-Z]+)\d+$/.exec(ref);
  if (m?.[1] === undefined) return null;
  let n = 0;
  for (const c of m[1]) n = n * 26 + (c.charCodeAt(0) - 64);
  return n - 1;
}

/**
 * A worksheet's values. Rows and cells that hold nothing may be left out of
 * the XML, so each is placed by its reference (`r="C5"`) when it has one;
 * a gap between rows is kept as an empty row.
 */
function sheetRows(xml: string, shared: readonly string[]): string[][] {
  const rows: string[][] = [];
  const rowPattern = new RegExp(`<${P}row\\b([^>]*?)(?:/>|>([\\s\\S]*?)</${P}row>)`, 'g');
  const cellPattern = new RegExp(`<${P}c\\b([^>]*?)(?:/>|>([\\s\\S]*?)</${P}c>)`, 'g');
  const valuePattern = new RegExp(`<${P}v(?:\\s[^>]*)?>([^<]*)</${P}v>`);
  const inlinePattern = new RegExp(`<${P}is\\b[^>]*>([\\s\\S]*?)</${P}is>`);
  for (const r of xml.matchAll(rowPattern)) {
    const index = Number(attribute(`<row${r[1] ?? ''}>`, 'r') ?? rows.length + 1) - 1;
    while (rows.length < index) rows.push([]);
    const row: string[] = [];
    for (const c of (r[2] ?? '').matchAll(cellPattern)) {
      const tag = `<c${c[1] ?? ''}>`;
      const body = c[2] ?? '';
      const type = attribute(tag, 't');
      let value: string;
      if (type === 'inlineStr') {
        value = texts(inlinePattern.exec(body)?.[1] ?? '');
      } else {
        const raw = decodeEntities(valuePattern.exec(body)?.[1] ?? '');
        value = type === 's' ? (shared[Number(raw)] ?? '') : raw;
      }
      const ref = attribute(tag, 'r');
      const column = ref === null ? row.length : (columnOf(ref) ?? row.length);
      while (row.length < column) row.push('');
      row[column] = value;
    }
    rows.push(row);
  }
  return rows;
}
