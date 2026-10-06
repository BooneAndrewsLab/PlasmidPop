import { xlsx, zip } from '@/test/xlsx';

import { SpreadsheetError, readTableFile } from './spreadsheet';

async function sheetsOf(bytes: Uint8Array) {
  const read = await readTableFile(bytes);
  if (read.kind !== 'workbook') throw new Error(`read as ${read.kind}`);
  return read.sheets;
}

describe('readTableFile (#141)', () => {
  it('reads an .xlsx workbook: shared strings, numbers, every sheet in the workbook order', async () => {
    const bytes = await xlsx([
      {
        name: '18h @ 37C',
        rows: [
          ['Overhang', 'AAAA', 'TTTT'],
          ['TTTT', 830, 1],
          ['AAAA', 2, 0.5],
        ],
      },
      { name: 'notes & such', rows: [['made by', 'R&D <lab>']] },
    ]);
    const sheets = await sheetsOf(bytes);
    expect(sheets.map((s) => s.name)).toEqual(['18h @ 37C', 'notes & such']);
    expect(sheets[0]?.rows).toEqual([
      ['Overhang', 'AAAA', 'TTTT'],
      ['TTTT', '830', '1'],
      ['AAAA', '2', '0.5'],
    ]);
    expect(sheets[1]?.rows).toEqual([['made by', 'R&D <lab>']]);
  });

  it('puts a cell by its reference when empty cells and rows are left out', async () => {
    const sheets = await sheetsOf(
      await xlsx([{ name: 'S', rows: [['a', null, 'c'], [], [null, null, 7]] }]),
    );
    expect(sheets[0]?.rows).toEqual([['a', '', 'c'], [], ['', '', '7']]);
  });

  it('reads inline strings, prefixed elements and stored (uncompressed) parts', async () => {
    const rows = [
      ['Overhang', 'GGAG'],
      ['CTCC', 12],
    ];
    for (const options of [{ inline: true }, { prefix: 'x' }, { stored: true }]) {
      const sheets = await sheetsOf(await xlsx([{ name: 'T', rows }], options));
      expect(sheets[0]?.rows).toEqual([
        ['Overhang', 'GGAG'],
        ['CTCC', '12'],
      ]);
    }
  });

  it('reads the text of a rich-text shared string, without its phonetic runs', async () => {
    const MAIN = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
    const bytes = await zip({
      'xl/workbook.xml': `<workbook xmlns="${MAIN}" xmlns:r="r"><sheets><sheet name="A" sheetId="1" r:id="rId1"/></sheets></workbook>`,
      'xl/_rels/workbook.xml.rels': `<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>`,
      'xl/sharedStrings.xml': `<sst xmlns="${MAIN}"><si><r><t>Over</t></r><r><rPr/><t xml:space="preserve">hang</t></r><rPh><t>x</t></rPh></si><si/></sst>`,
      'xl/worksheets/sheet1.xml': `<worksheet xmlns="${MAIN}"><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="C1" t="b"><v>1</v></c><c r="D1"><f>1+1</f><v>2</v></c></row></sheetData></worksheet>`,
    });
    expect((await sheetsOf(bytes))[0]?.rows).toEqual([['Overhang', '', '1', '2']]);
  });

  it('writes a number the shortest way, as it was typed, and leaves other values be (#151)', async () => {
    const MAIN = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
    const bytes = await zip({
      'xl/workbook.xml': `<workbook xmlns="${MAIN}" xmlns:r="r"><sheets><sheet name="A" sheetId="1" r:id="rId1"/></sheets></workbook>`,
      'xl/_rels/workbook.xml.rels': `<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>`,
      'xl/worksheets/sheet1.xml': `<worksheet xmlns="${MAIN}"><sheetData><row r="1"><c r="A1"><v>58.299999999999997</v></c><c r="B1" t="n"><v>1.0E-3</v></c><c r="C1" t="str"><v>0012</v></c><c r="D1" t="e"><v>#N/A</v></c><c r="E1"><v>0170</v></c></row></sheetData></worksheet>`,
    });
    expect((await sheetsOf(bytes))[0]?.rows).toEqual([['58.3', '0.001', '0012', '#N/A', '170']]);
  });

  it('reads text as UTF-8, or as UTF-16 when it starts with a byte-order mark', async () => {
    const text = 'Overhang\tAAAA\nTTTT\t5\n';
    expect(await readTableFile(new TextEncoder().encode(text))).toEqual({ kind: 'text', text });
    expect(
      await readTableFile(new TextEncoder().encode(String.fromCharCode(0xfeff) + text)),
    ).toEqual({
      kind: 'text',
      text,
    });
    // Excel's "Unicode text" is UTF-16 little-endian with a byte-order mark.
    const utf16 = new Uint8Array(2 + text.length * 2);
    utf16.set([0xff, 0xfe]);
    for (let i = 0; i < text.length; i++) utf16[2 + i * 2] = text.charCodeAt(i);
    expect(await readTableFile(utf16)).toEqual({ kind: 'text', text });
  });

  it('says how to convert spreadsheets it does not read', async () => {
    const xls = new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0, 0, 0, 0]);
    await expect(readTableFile(xls)).rejects.toThrow(
      /old-style Excel workbook \(\.xls\); save it as an Excel workbook \(\.xlsx\) or as CSV/,
    );
    const ods = await zip({
      mimetype: 'application/vnd.oasis.opendocument.spreadsheet',
      'content.xml': '<office:document-content/>',
    });
    await expect(readTableFile(ods)).rejects.toThrow(/OpenDocument spreadsheet; save it as/);
    await expect(readTableFile(await zip({ 'table.csv': 'a,b' }))).rejects.toThrow(
      /zip archive, not a table/,
    );
  });

  it('says a damaged workbook is damaged', async () => {
    const whole = await xlsx([{ name: 'S', rows: [['a']] }]);
    // Cut off the end, and the central directory with it.
    const cut = whole.slice(0, whole.length - 30);
    await expect(readTableFile(cut)).rejects.toThrow(SpreadsheetError);
    await expect(readTableFile(cut)).rejects.toThrow(/could not be read; it may be damaged/);
  });
});
