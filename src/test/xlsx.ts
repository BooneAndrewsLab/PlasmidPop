/**
 * Builds small `.xlsx` workbooks for tests (#141), so that no published
 * table has to be committed to test the reader with. The zip is a real one —
 * CRCs and all — written the way Excel writes it: deflated parts, shared
 * strings for text, numbers in `<v>`, empty cells left out.
 */

export interface TestSheet {
  readonly name: string;
  /** `null` leaves the cell out of the XML, as Excel does for an empty one. */
  readonly rows: readonly (readonly (string | number | null)[])[];
}

export interface WorkbookOptions {
  /** Write text as inline strings instead of shared ones. */
  readonly inline?: boolean;
  /** Prefix every SpreadsheetML element (`x:`), as some non-Excel writers do. */
  readonly prefix?: string;
  /** Store the parts uncompressed rather than deflated. */
  readonly stored?: boolean;
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of bytes) c = (CRC_TABLE[(c ^ b) & 0xff] ?? 0) ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

async function deflateRaw(bytes: Uint8Array<ArrayBuffer>): Promise<Uint8Array> {
  const source = new ReadableStream<BufferSource>({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
  const out = await new Response(
    source.pipeThrough(new CompressionStream('deflate-raw')),
  ).arrayBuffer();
  return new Uint8Array(out);
}

/** A zip archive of the given parts. */
export async function zip(
  parts: Readonly<Record<string, string>>,
  stored = false,
): Promise<Uint8Array<ArrayBuffer>> {
  const encoder = new TextEncoder();
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;
  for (const [name, text] of Object.entries(parts)) {
    const raw = encoder.encode(text);
    const data = stored ? raw : await deflateRaw(raw);
    const nameBytes = encoder.encode(name);
    const crc = crc32(raw);
    const local = new Uint8Array(30 + nameBytes.length + data.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true);
    lv.setUint16(8, stored ? 0 : 8, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, data.length, true);
    lv.setUint32(22, raw.length, true);
    lv.setUint16(26, nameBytes.length, true);
    local.set(nameBytes, 30);
    local.set(data, 30 + nameBytes.length);
    const central = new Uint8Array(46 + nameBytes.length);
    const cv = new DataView(central.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(10, stored ? 0 : 8, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, data.length, true);
    cv.setUint32(24, raw.length, true);
    cv.setUint16(28, nameBytes.length, true);
    cv.setUint32(42, offset, true);
    central.set(nameBytes, 46);
    locals.push(local);
    centrals.push(central);
    offset += local.length;
  }
  const centralSize = centrals.reduce((n, c) => n + c.length, 0);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, centrals.length, true);
  ev.setUint16(10, centrals.length, true);
  ev.setUint32(12, centralSize, true);
  ev.setUint32(16, offset, true);
  const all = [...locals, ...centrals, end];
  const out = new Uint8Array(all.reduce((n, a) => n + a.length, 0));
  let at = 0;
  for (const a of all) {
    out.set(a, at);
    at += a.length;
  }
  return out;
}

function escape(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function column(i: number): string {
  let s = '';
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) {
    s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  }
  return s;
}

/** An `.xlsx` workbook holding the given sheets, in order. */
export async function xlsx(
  sheets: readonly TestSheet[],
  options: WorkbookOptions = {},
): Promise<Uint8Array<ArrayBuffer>> {
  const p = options.prefix === undefined ? '' : `${options.prefix}:`;
  const ns = options.prefix === undefined ? 'xmlns' : `xmlns:${options.prefix}`;
  const MAIN = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
  const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  const shared: string[] = [];
  const parts: Record<string, string> = {
    '_rels/.rels': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL}/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
  };
  const SML = 'application/vnd.openxmlformats-officedocument.spreadsheetml';
  const overrides = [
    `<Override PartName="/xl/workbook.xml" ContentType="${SML}.sheet.main+xml"/>`,
    `<Override PartName="/xl/sharedStrings.xml" ContentType="${SML}.sharedStrings+xml"/>`,
    ...sheets.map(
      (_, i) =>
        `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="${SML}.worksheet+xml"/>`,
    ),
  ];
  parts['[Content_Types].xml'] =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>${overrides.join('')}</Types>`;
  const sheetTags: string[] = [];
  const rels: string[] = [];
  // Parts are numbered from the end, so that their names do not give the order away.
  for (const [i, sheet] of sheets.entries()) {
    const file = `sheet${sheets.length - i}.xml`;
    sheetTags.push(
      `<${p}sheet name="${escape(sheet.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`,
    );
    rels.push(
      `<Relationship Id="rId${i + 1}" Type="${REL}/worksheet" Target="${i % 2 === 1 ? `/xl/worksheets/${file}` : `worksheets/${file}`}"/>`,
    );
    const rowXml = sheet.rows.map((row, r) => {
      const cells = row.map((value, c) => {
        if (value === null) return '';
        const ref = `${column(c)}${r + 1}`;
        if (typeof value === 'number') return `<${p}c r="${ref}"><${p}v>${value}</${p}v></${p}c>`;
        if (options.inline === true) {
          return `<${p}c r="${ref}" t="inlineStr"><${p}is><${p}t>${escape(value)}</${p}t></${p}is></${p}c>`;
        }
        let index = shared.indexOf(value);
        if (index < 0) index = shared.push(value) - 1;
        return `<${p}c r="${ref}" t="s"><${p}v>${index}</${p}v></${p}c>`;
      });
      return `<${p}row r="${r + 1}">${cells.join('')}</${p}row>`;
    });
    parts[`xl/worksheets/${file}`] =
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><${p}worksheet ${ns}="${MAIN}"><${p}sheetData>${rowXml.join('')}</${p}sheetData></${p}worksheet>`;
  }
  parts['xl/workbook.xml'] =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><${p}workbook ${ns}="${MAIN}" xmlns:r="${REL}"><${p}sheets>${sheetTags.join('')}</${p}sheets></${p}workbook>`;
  parts['xl/_rels/workbook.xml.rels'] =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rels.join('')}</Relationships>`;
  parts['xl/sharedStrings.xml'] =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><${p}sst ${ns}="${MAIN}" count="${shared.length}">${shared
      .map((s) => `<${p}si><${p}t>${escape(s)}</${p}t></${p}si>`)
      .join('')}</${p}sst>`;
  return await zip(parts, options.stored === true);
}
