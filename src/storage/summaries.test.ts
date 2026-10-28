import { type ListedRow, groupByParent, searchRows, sortRows } from './summaries';

function row(id: string, over: Partial<ListedRow> = {}): ListedRow {
  return { id, name: id, fileName: null, length: 100, kind: 'file', updatedAt: 1, ...over };
}

const product = (id: string, parent: string | undefined, over: Partial<ListedRow> = {}) =>
  row(id, {
    kind: 'scratch',
    ...(parent === undefined ? {} : { parentChecksum: parent, parentName: `parent ${parent}` }),
    ...over,
  });

describe('searchRows', () => {
  const rows = [
    row('pUC19', { fileName: 'puc19.gb' }),
    row('Insert', { fileName: 'PCR_product.fa' }),
    row('Other'),
  ];

  it('matches the name or the file name, whatever the case', () => {
    expect(searchRows(rows, 'puc').map((r) => r.id)).toEqual(['pUC19']);
    expect(searchRows(rows, 'pcr_').map((r) => r.id)).toEqual(['Insert']);
    expect(searchRows(rows, 'ther').map((r) => r.id)).toEqual(['Other']);
  });

  it('gives every row for a blank query, and none that has nothing to match', () => {
    expect(searchRows(rows, '  ')).toHaveLength(3);
    expect(searchRows(rows, 'zzz')).toEqual([]);
  });

  it('does not match a row by its missing file name', () => {
    expect(searchRows(rows, 'null')).toEqual([]);
  });
});

describe('sortRows', () => {
  const rows = [
    row('pUC10', { length: 50, updatedAt: 2 }),
    row('pUC2', { length: 300, updatedAt: 3 }),
    row('Alpha', { length: 300, updatedAt: 1 }),
  ];

  it('puts the most recently updated first', () => {
    expect(sortRows(rows, 'updated').map((r) => r.id)).toEqual(['pUC2', 'pUC10', 'Alpha']);
  });

  it('orders names with their numbers as numbers, aside from case', () => {
    expect(sortRows(rows, 'name').map((r) => r.id)).toEqual(['Alpha', 'pUC2', 'pUC10']);
  });

  it('puts the largest first and keeps the given order between equals', () => {
    expect(sortRows(rows, 'size').map((r) => r.id)).toEqual(['pUC2', 'Alpha', 'pUC10']);
  });

  it('leaves its input alone', () => {
    const copy = [...rows];
    sortRows(rows, 'name');
    expect(rows).toEqual(copy);
  });
});

describe('groupByParent', () => {
  it('folds the scratch products of one parent into one entry at the first one', () => {
    const entries = groupByParent([
      product('a1', 'A'),
      row('kept'),
      product('b1', 'B'),
      product('a2', 'A'),
      product('a3', 'A'),
    ]);
    expect(entries.map((e) => (e.type === 'row' ? e.row.id : `group ${e.parentChecksum}`))).toEqual(
      ['group A', 'kept', 'b1'],
    );
    const group = entries[0];
    expect(group?.type === 'group' && group.rows.map((r) => r.id)).toEqual(['a1', 'a2', 'a3']);
    expect(group?.type === 'group' && group.parentName).toBe('parent A');
  });

  it('leaves a product alone with its parent, one with no parent, and kept rows ungrouped', () => {
    const entries = groupByParent([
      product('alone', 'A'),
      product('orphan1', undefined),
      product('orphan2', undefined),
      row('k1', { parentChecksum: 'K', parentName: 'k' }),
      row('k2', { parentChecksum: 'K', parentName: 'k' }),
    ]);
    expect(entries.every((e) => e.type === 'row')).toBe(true);
    expect(entries).toHaveLength(5);
  });

  it('does not take a kept row into the group of its parent', () => {
    const entries = groupByParent([
      product('a1', 'A'),
      row('kept-a', { parentChecksum: 'A', parentName: 'parent A' }),
      product('a2', 'A'),
    ]);
    expect(entries).toHaveLength(2);
    expect(entries[0]?.type === 'group' && entries[0].rows).toHaveLength(2);
    expect(entries[1]).toMatchObject({ type: 'row', row: { id: 'kept-a' } });
  });

  it('is empty for no rows', () => {
    expect(groupByParent([])).toEqual([]);
  });
});
