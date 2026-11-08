import { readTableFile } from '@/io/spreadsheet';
import { xlsx } from '@/test/xlsx';

import {
  BatchTableError,
  type RawRow,
  parseBatchRows,
  parseBatchText,
  parseBatchWorkbook,
  writeBatchCsv,
} from './table';

const GRID = [
  ['name', 'template', 'region'],
  ['gene1', 'pUC19', '10-200'],
  ['gene2', 'pUC19', 'complement(300..400)'],
];

describe('parseBatchText: delimiters', () => {
  it.each([
    ['tab', '\t'],
    ['comma', ','],
    ['semicolon', ';'],
  ])('reads a %s-separated paste', (_, d) => {
    const quote = (c: string): string => (c.includes(d) ? `"${c}"` : c);
    const text = GRID.map((r) => r.map(quote).join(d)).join('\n');
    const table = parseBatchText(text);
    expect(table.columns).toEqual(['name', 'template', 'region']);
    expect(table.rows.map((r) => r.cells)).toEqual([
      { name: 'gene1', template: 'pUC19', region: '10-200' },
      { name: 'gene2', template: 'pUC19', region: 'complement(300..400)' },
    ]);
  });

  it('numbers rows by their line, counting the lines above the header', () => {
    const table = parseBatchText('Order for Monday\n\nname\tregion\na\t1-5\n\nb\t6-9\n');
    expect(table.rows.map((r) => [r.cells.name, r.line])).toEqual([
      ['a', 4],
      ['b', 6],
    ]);
  });

  it('keeps a quoted comma, quote and line break in one cell', () => {
    const table = parseBatchText('name,region,notes\n"a ""b""","join(1..5,9..12)","two\nlines"\n');
    expect(table.rows[0]?.cells).toEqual({ name: 'a "b"', region: 'join(1..5,9..12)' });
    // line breaks inside a cell read as one space
    expect(table.rows[0]?.notes).toBe('two lines');
  });

  it('reads a single column, which has no delimiter', () => {
    const table = parseBatchText('name\nx\ny\n');
    expect(table.rows.map((r) => r.cells.name)).toEqual(['x', 'y']);
  });

  it('reads CRLF line ends', () => {
    expect(parseBatchText('name,region\r\na,1-5\r\n').rows).toHaveLength(1);
  });
});

describe('parseBatchText: columns', () => {
  it('matches loose headers in any order', () => {
    const table = parseBatchText(
      "Region\tPrimer Name\tTemplate Plasmid\tTm (°C)\tInclude start codon\t5' tail\n1-9\ta\tp\t60\tyes\tGGATCC\n",
    );
    expect(table.rows[0]?.cells).toEqual({
      region: '1-9',
      name: 'a',
      template: 'p',
      tm: '60',
      include_start: 'yes',
      left: 'GGATCC',
    });
  });

  it('does not take "Sequence name" for the sequence, nor "Template name" for the name', () => {
    const table = parseBatchText('Sequence name\tSequence\na\tACGT\n');
    expect(table.rows[0]?.cells).toEqual({ name: 'a', sequence: 'ACGT' });
    const t2 = parseBatchText('Template name\tRegion\tName\np\t1-5\ta\n');
    expect(t2.rows[0]?.cells).toEqual({ template: 'p', region: '1-5', name: 'a' });
  });

  it('keeps unknown columns as notes under their header, with a notes column', () => {
    const table = parseBatchText('name\tplate\tNotes\tregion\na\t3\tfor Ann\t1-5\n');
    expect(table.rows[0]?.cells).toEqual({ name: 'a', region: '1-5' });
    expect(table.rows[0]?.notes).toBe('plate: 3; for Ann');
  });

  it('keeps the first of two columns that mean the same thing and notes the second', () => {
    const table = parseBatchText('name\tid\tregion\na\tX1\t1-5\n');
    expect(table.rows[0]?.cells.name).toBe('a');
    expect(table.rows[0]?.notes).toBe('id: X1');
  });

  it('leaves out empty cells and rows with nothing in them', () => {
    const table = parseBatchText('name\tregion\ttm\na\t1-5\t\n\t\t\nb\t\t58\n');
    expect(table.rows.map((r) => r.cells)).toEqual([
      { name: 'a', region: '1-5' },
      { name: 'b', tm: '58' },
    ]);
  });

  it('refuses a table with no header, saying what a header is', () => {
    expect(() => parseBatchText('a\t1-5\nb\t6-9\n')).toThrow(BatchTableError);
    expect(() => parseBatchText('a\t1-5\nb\t6-9\n')).toThrow(/names the columns/);
  });

  it('does not take a title for the header', () => {
    expect(() => parseBatchText('Order for the lab\nwith thanks\nx\ty\n')).toThrow(BatchTableError);
  });
});

describe('workbooks', () => {
  it('reads a sheet of cells, numbering rows as the sheet does', async () => {
    const file = await readTableFile(
      await xlsx([
        {
          name: 'Rows',
          rows: [
            ['Batch for Monday'],
            ['Name', 'Region', 'Tm'],
            ['a', '1-5', 58.299999999999997],
            ['b', '6-9', 60],
          ],
        },
      ]),
    );
    if (file.kind !== 'workbook') throw new Error('not a workbook');
    const table = parseBatchWorkbook(file.sheets);
    expect(table.sheet).toBe('Rows');
    expect(table.rows.map((r) => [r.line, r.cells])).toEqual([
      [3, { name: 'a', region: '1-5', tm: '58.3' }],
      [4, { name: 'b', region: '6-9', tm: '60' }],
    ]);
  });

  it('skips an instructions sheet before the table', async () => {
    const file = await readTableFile(
      await xlsx([
        { name: 'Read me', rows: [['Fill in the next sheet.']] },
        {
          name: 'Table',
          rows: [
            ['name', 'sequence'],
            ['a', 'ACGT'],
          ],
        },
      ]),
    );
    if (file.kind !== 'workbook') throw new Error('not a workbook');
    expect(parseBatchWorkbook(file.sheets)).toMatchObject({ sheet: 'Table' });
  });

  it('refuses a workbook with no table, naming its sheets', async () => {
    const file = await readTableFile(
      await xlsx([
        { name: 'A', rows: [['x']] },
        { name: 'B', rows: [['y']] },
      ]),
    );
    if (file.kind !== 'workbook') throw new Error('not a workbook');
    expect(() => parseBatchWorkbook(file.sheets)).toThrow(/“A”, “B”/);
  });

  it('keeps a cell with a tab or a line break as one cell', () => {
    const table = parseBatchRows([
      ['name', 'region', 'notes'],
      ['a', '1-5', 'one\ttwo\nthree'],
    ]);
    expect(table.rows[0]?.notes).toBe('one two three');
  });
});

describe('writeBatchCsv', () => {
  it('is read back as the rows were', () => {
    const rows: RawRow[] = [
      {
        line: 1,
        cells: { name: 'a, "first"', region: 'join(1..5,9..12)', tm: '58' },
        notes: 'x; y',
      },
      { line: 2, cells: { name: 'b', region: '20-30' }, notes: '' },
      { line: 3, cells: { name: ' padded ', sequence: 'ACGT' }, notes: '' },
    ];
    const back = parseBatchText(writeBatchCsv(rows));
    expect(back.rows.map((r) => r.cells)).toEqual([
      { name: 'a, "first"', region: 'join(1..5,9..12)', tm: '58' },
      { name: 'b', region: '20-30' },
      { name: 'padded', sequence: 'ACGT' },
    ]);
    expect(back.rows.map((r) => r.notes)).toEqual(['x; y', '', '']);
  });
});
