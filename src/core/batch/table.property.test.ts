import fc from 'fast-check';

import { BATCH_COLUMNS, type RawRow, parseBatchText, writeBatchCsv } from './table';

/** Text a cell can hold once whitespace runs are one space and the ends are trimmed. */
const cellText = fc
  .array(fc.constantFrom('a', 'Z', '7', ',', ';', '"', '\t', '\n', '-', '(', '.', ' ', 'é'), {
    minLength: 1,
    maxLength: 12,
  })
  .map((chars) => chars.join('').replace(/\s+/g, ' ').trim())
  .filter((t) => t !== '');

const row = fc
  .record({
    name: cellText,
    region: fc.option(cellText, { nil: undefined }),
    tm: fc.option(cellText, { nil: undefined }),
    notes: fc.oneof(fc.constant(''), cellText),
  })
  .map(({ name, region, tm, notes }): RawRow => ({
    line: 0,
    cells: {
      name,
      ...(region === undefined ? {} : { region }),
      ...(tm === undefined ? {} : { tm }),
    },
    notes,
  }));

describe('writeBatchCsv and parseBatchText', () => {
  it('read back what was written, whatever the cells hold', () => {
    fc.assert(
      fc.property(fc.array(row, { minLength: 1, maxLength: 8 }), (rows) => {
        const back = parseBatchText(writeBatchCsv(rows));
        expect(back.rows.map((r) => r.cells)).toEqual(rows.map((r) => r.cells));
        expect(back.rows.map((r) => r.notes)).toEqual(rows.map((r) => r.notes));
        expect(back.columns.every((c) => BATCH_COLUMNS.includes(c))).toBe(true);
      }),
    );
  });
});
