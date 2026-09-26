import { SeqDocument } from '@/core';

import { lanesPerRow } from './lanes';
import { type LinearMetrics, LinearLayout } from './layout';
import { RowBreaks, sizedRuns } from './rowBreaks';

/**
 * Rows around larger bases (#91): a row holding some holds fewer bases, is
 * as much taller as its largest one, and every x in it — drawing, hit
 * testing, the arrow keys — follows the wider letters.
 */

const metrics: LinearMetrics = {
  basesPerRow: 10,
  charWidth: 8,
  lineHeight: 16,
  showComplement: true,
  rulerHeight: 14,
  traceHeight: 0,
  laneHeight: 18,
  overlayHeight: 16,
  translationHeight: 12,
  residueNumberHeight: 0,
  rowGap: 6,
  leftGutter: 60,
  rightGutter: 24,
  topPadding: 8,
};

const spans = (b: RowBreaks): [number, number, number][] =>
  b.rows.map((r) => [r.start, r.end, r.scale]);

describe('RowBreaks', () => {
  it('are plain rows of basesPerRow with no larger base', () => {
    const b = new RowBreaks(25, 10);
    expect(spans(b)).toEqual([
      [0, 10, 1],
      [10, 20, 1],
      [20, 25, 1],
    ]);
    expect(b.rowOf(0)).toBe(0);
    expect(b.rowOf(19)).toBe(1);
    expect(b.rowOf(25)).toBe(2);
  });

  it('fit fewer bases in a row with larger ones, and carry on from where it stopped', () => {
    // Bases 2..6 at twice the width: 2 + 4×2 = 10 columns hold 6 bases.
    const b = new RowBreaks(30, 10, [{ start: 2, end: 6, size: 2 }]);
    expect(spans(b)).toEqual([
      [0, 6, 2],
      [6, 16, 1],
      [16, 26, 1],
      [26, 30, 1],
    ]);
    expect(b.rows[0]?.sized).toEqual([{ start: 2, end: 6, size: 2 }]);
    expect(b.rowOf(5)).toBe(0);
    expect(b.rowOf(6)).toBe(1);
    expect(b.rowOf(27)).toBe(3);
  });

  it('split a run of larger bases across rows', () => {
    const b = new RowBreaks(20, 10, [{ start: 0, end: 12, size: 2 }]);
    expect(spans(b)).toEqual([
      [0, 5, 2],
      [5, 10, 2],
      [10, 18, 2],
      [18, 20, 1],
    ]);
    expect(b.rows[2]?.sized).toEqual([{ start: 10, end: 12, size: 2 }]);
  });

  it('give a row at least one base, however large', () => {
    const b = new RowBreaks(3, 1, [{ start: 0, end: 3, size: 2 }]);
    expect(spans(b)).toEqual([
      [0, 1, 2],
      [1, 2, 2],
      [2, 3, 2],
    ]);
  });

  it('take only the sizes from the styles, merged where they abut', () => {
    const doc = SeqDocument.create({ sequence: 'A'.repeat(20) })
      .styleBases({ start: 0, end: 4 }, { size: 1.5 })
      .styleBases({ start: 2, end: 6 }, { bold: true })
      .styleBases({ start: 8, end: 9 }, { color: '#ff0000' });
    expect(sizedRuns(doc.styles)).toEqual([{ start: 0, end: 4, size: 1.5 }]);
  });

  it('count lanes by the rows they make', () => {
    const doc = SeqDocument.create({ sequence: 'A'.repeat(30) });
    const b = new RowBreaks(30, 10, [{ start: 2, end: 6, size: 2 }]);
    const lanes = { laneOf: new Map([['f', 0]]), laneCount: 1 };
    const feature = {
      id: 'f',
      type: 'gene',
      name: '',
      strand: 'forward' as const,
      segments: [
        { kind: 'range' as const, start: 7, end: 9, partialStart: false, partialEnd: false },
      ],
      qualifiers: [],
    };
    expect(lanesPerRow([feature], lanes, doc.length, b)).toEqual([0, 1, 0, 0]);
    expect(lanesPerRow([feature], lanes, doc.length, 10)).toEqual([1, 0, 0]);
  });
});

describe('a layout with larger bases', () => {
  const breaks = new RowBreaks(30, 10, [{ start: 2, end: 6, size: 2 }]);
  const layout = new LinearLayout(30, metrics, [], [], [], breaks);
  const [big, plain] = layout.rows;
  if (big === undefined || plain === undefined) throw new Error('rows');

  it('makes the strands of a row as much taller as its largest base', () => {
    expect(layout.lineHeight(big)).toBe(32);
    expect(big.height).toBe(14 + 64 + 6);
    expect(plain.height).toBe(14 + 32 + 6);
    expect(layout.complementTextTop(big)).toBe(layout.forwardTextTop(big) + 32);
    expect(plain.top).toBe(big.top + big.height);
  });

  it('places each base by the widths of those before it', () => {
    expect(layout.xOf(big, 0)).toBe(60);
    expect(layout.xOf(big, 2)).toBe(76);
    expect(layout.xOf(big, 3)).toBe(92);
    expect(layout.xOf(big, 6)).toBe(140);
    expect(layout.widthOf(big, 2)).toBe(16);
    expect(layout.widthOf(big, 1)).toBe(8);
    expect(layout.xOf(plain, 8)).toBe(76);
  });

  it('turns an x back into the boundary under it', () => {
    expect(layout.offsetAtX(big, 76)).toBe(2);
    expect(layout.offsetAtX(big, 84)).toBe(2.5);
    expect(layout.offsetAtX(big, 140)).toBe(6);
    const hit = layout.hitTest(85, big.top + 20);
    expect(hit).toMatchObject({ kind: 'boundary', position: 3 });
  });

  it('finds the row of a base by the breaks', () => {
    expect(layout.rowOfPosition(5)?.index).toBe(0);
    expect(layout.rowOfPosition(6)?.index).toBe(1);
  });

  it('moves the caret straight up and down, whatever the widths', () => {
    // Base 4 of the big row is at x 108, over base 9 of the next (60 + 6×8 = 108).
    expect(layout.positionInRowBeside(4, 1)).toBe(12);
    expect(layout.positionInRowBeside(12, -1)).toBe(4);
    expect(layout.positionInRowBeside(27, 1)).toBe(37);
  });
});
