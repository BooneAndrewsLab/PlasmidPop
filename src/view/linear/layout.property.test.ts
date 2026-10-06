import { LinearLayout, linearMetrics } from './layout';
import { RowBreaks, type SizedRun } from './rowBreaks';

/**
 * Properties of the linear view's rows over seeded random lengths, row
 * widths and runs of larger bases: the rows partition the sequence with no
 * gap or overlap, none holds more than a row's width of columns, and the
 * x of every position in a row reads back as that position (offsetAtX
 * after xOf), widthOf is the distance to the next position, and a row is
 * found for every position.
 */

let seed = 12345;
/** A seeded uniform number in [0, 1). */
function rnd(): number {
  seed = ((Math.imul(seed, 1103515245) + 12345) & 0x7fffffff) >>> 0;
  return seed / 0x7fffffff;
}

const CHAR = 8;

describe('linear layout invariants', () => {
  it('partitions the sequence and round-trips x for every position', () => {
    const problems: string[] = [];
    let checked = 0;
    for (let iter = 0; iter < 400; iter++) {
      const n = iter < 5 ? iter : 1 + Math.floor(rnd() * 400);
      const perRow = 10 * (1 + Math.floor(rnd() * 8));
      const sized: SizedRun[] = [];
      if (rnd() < 0.6 && n > 0) {
        let p = Math.floor(rnd() * n);
        const runs = 1 + Math.floor(rnd() * 4);
        for (let k = 0; k < runs && p < n; k++) {
          const end = Math.min(n, p + 1 + Math.floor(rnd() * 30));
          sized.push({ start: p, end, size: [2, 3, 1.5][Math.floor(rnd() * 3)] ?? 2 });
          p = end + Math.floor(rnd() * 40);
        }
      }
      const label = `n=${String(n)} perRow=${String(perRow)} sized=${String(sized.length)}`;
      const breaks = new RowBreaks(n, perRow, sized);
      let at = 0;
      for (const r of breaks.rows) {
        if (r.start !== at) problems.push(`${label}: gap or overlap at ${String(r.start)}`);
        if (n > 0 && r.end <= r.start) problems.push(`${label}: empty row`);
        at = r.end;
      }
      if (at !== n) problems.push(`${label}: rows end at ${String(at)}`);

      const metrics = linearMetrics({
        fontSize: 13,
        basesPerRow: perRow,
        charWidth: CHAR,
        showComplement: true,
        cutSiteLabels: true,
      });
      const layout = new LinearLayout(
        n,
        metrics,
        breaks.rows.map(() => 1),
        [],
        [],
        breaks,
      );
      for (const row of layout.rows) {
        const columns = (layout.xOf(row, row.end) - layout.xOf(row, row.start)) / CHAR;
        if (columns > perRow + 1e-6)
          problems.push(`${label}: row ${String(row.index)} is ${String(columns)} columns`);
        for (let p = row.start; p <= row.end; p++) {
          checked++;
          const x = layout.xOf(row, p);
          const offset = layout.offsetAtX(row, x);
          if (Math.abs(offset - (p - row.start)) > 1e-9) {
            problems.push(
              `${label}: offsetAtX(xOf(${String(p)})) = ${String(offset)} in row from ${String(row.start)}`,
            );
          }
          if (p < row.end) {
            const width = layout.xOf(row, p + 1) - x;
            if (Math.abs(width - layout.widthOf(row, p)) > 1e-9) {
              problems.push(`${label}: widthOf(${String(p)}) is not the step to the next position`);
            }
          }
          const found = layout.rowOfPosition(p)?.index;
          const expected =
            p === row.end && row.index < layout.rows.length - 1 ? row.index + 1 : row.index;
          if (p !== n && found !== expected)
            problems.push(`${label}: rowOfPosition(${String(p)}) = ${String(found)}`);
        }
      }
      if (problems.length > 10) break;
    }
    expect(checked).toBeGreaterThan(50_000);
    expect(problems).toEqual([]);
  });
});
