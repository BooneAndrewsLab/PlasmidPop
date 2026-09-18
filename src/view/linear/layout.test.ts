import { type LinearMetrics, LinearLayout, basesPerRowFor } from './layout';

const metrics: LinearMetrics = {
  basesPerRow: 10,
  charWidth: 8,
  lineHeight: 16,
  showComplement: true,
  rulerHeight: 14,
  laneHeight: 18,
  translationHeight: 12,
  rowGap: 6,
  leftGutter: 60,
  topPadding: 8,
};

describe('LinearLayout', () => {
  const layout = new LinearLayout(35, metrics, [1, 0, 2, 0]);

  it('lays rows out with per-row heights', () => {
    expect(layout.rows.map((r) => [r.start, r.end, r.lanes])).toEqual([
      [0, 10, 1],
      [10, 20, 0],
      [20, 30, 2],
      [30, 35, 0],
    ]);
    const base = 14 + 32; // ruler + two strands
    expect(layout.rows.map((r) => r.height)).toEqual([
      base + 18 + 6,
      base + 6,
      base + 36 + 6,
      base + 6,
    ]);
    expect(layout.rows[1]?.top).toBe(8 + base + 18 + 6);
    expect(layout.totalHeight).toBe(8 + layout.rows.reduce((n, r) => n + r.height, 0));
  });

  it('reserves translation lines between the strands and the feature lanes', () => {
    const withTranslations = new LinearLayout(35, metrics, [1, 0, 2, 0], [2, 1, 0, 0]);
    const base = 14 + 32;
    expect(withTranslations.rows.map((r) => r.translations)).toEqual([2, 1, 0, 0]);
    expect(withTranslations.rows.map((r) => r.height)).toEqual([
      base + 24 + 18 + 6,
      base + 12 + 6,
      base + 36 + 6,
      base + 6,
    ]);
    const first = withTranslations.rows[0];
    if (first === undefined) throw new Error('row');
    expect(withTranslations.translationTop(first, 0)).toBe(first.top + base);
    expect(withTranslations.translationTop(first, 1)).toBe(first.top + base + 12);
    expect(withTranslations.laneTop(first, 0)).toBe(first.top + base + 24);
    // The band hit-tests as a translation line; the lane below is still a lane.
    expect(withTranslations.hitTest(60 + 8 * 4.5, first.top + base + 13)).toMatchObject({
      kind: 'translation',
      line: 1,
      position: 4,
    });
    expect(withTranslations.hitTest(60 + 8 * 4.5, first.top + base + 25)).toMatchObject({
      kind: 'lane',
      lane: 0,
      position: 4,
    });
    // Rows without translations keep the lanes right under the strands.
    const third = withTranslations.rows[2];
    if (third === undefined) throw new Error('row');
    expect(withTranslations.laneTop(third, 0)).toBe(third.top + base);
  });

  it('finds rows by position and by y', () => {
    expect(layout.rowOfPosition(0)?.index).toBe(0);
    expect(layout.rowOfPosition(29)?.index).toBe(2);
    expect(layout.rowOfPosition(35)?.index).toBe(3); // caret at the very end
    expect(layout.rowAtY(0)).toBeUndefined();
    expect(layout.rowAtY(8)?.index).toBe(0);
    expect(layout.rowAtY(layout.totalHeight - 1)?.index).toBe(3);
    expect(layout.rowAtY(layout.totalHeight)).toBeUndefined();
  });

  it('lists the rows in a scroll window', () => {
    const second = layout.rows[1];
    if (second === undefined) throw new Error('row');
    expect(layout.rowsInWindow(0, 20).map((r) => r.index)).toEqual([0]);
    expect(
      layout.rowsInWindow(second.top + 1, second.top + second.height + 1).map((r) => r.index),
    ).toEqual([1, 2]);
    expect(layout.rowsInWindow(0, 10_000).map((r) => r.index)).toEqual([0, 1, 2, 3]);
    expect(layout.rowsInWindow(10_000, 20_000)).toEqual([]);
  });

  it('hit-tests boundaries and lanes', () => {
    const first = layout.rows[0];
    if (first === undefined) throw new Error('row');
    // x = gutter + 2.6 chars -> nearest boundary is 3
    expect(layout.hitTest(60 + 8 * 2.6, first.top + 20)).toMatchObject({
      kind: 'boundary',
      position: 3,
    });
    expect(layout.hitTest(60 + 8 * 2.4, first.top + 20)).toMatchObject({
      kind: 'boundary',
      position: 2,
    });
    expect(layout.hitTest(0, first.top + 20)).toMatchObject({ kind: 'boundary', position: 0 });
    expect(layout.hitTest(10_000, first.top + 20)).toMatchObject({
      kind: 'boundary',
      position: 10,
    });
    // lane area of row 0 starts after ruler + 2 strands
    expect(layout.hitTest(60 + 8 * 2.6, layout.laneTop(first, 0) + 5)).toMatchObject({
      kind: 'lane',
      lane: 0,
      position: 2,
    });
    expect(layout.hitTest(50, -5)).toEqual({ kind: 'none' });
    // last row has 5 bases: boundary clamps to 5
    const last = layout.rows[3];
    if (last === undefined) throw new Error('row');
    expect(layout.hitTest(60 + 8 * 9, last.top + 20)).toMatchObject({
      kind: 'boundary',
      position: 35,
    });
  });

  it('degenerates gracefully for an empty sequence', () => {
    const empty = new LinearLayout(0, metrics, [0]);
    expect(empty.rows).toHaveLength(1);
    expect(empty.rowOfPosition(0)?.index).toBe(0);
  });
});

describe('basesPerRowFor', () => {
  it('rounds down to a multiple of ten with a floor of ten', () => {
    expect(basesPerRowFor(800, 8)).toBe(100);
    expect(basesPerRowFor(799, 8)).toBe(90);
    expect(basesPerRowFor(10, 8)).toBe(10);
  });
});
