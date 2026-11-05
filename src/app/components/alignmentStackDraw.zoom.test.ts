import { describe, expect, it } from 'vitest';

import { SAMPLE_STACK as stack } from '../../test/alignmentStackFixture';
import type { StackContext } from './alignmentStackDraw';

/** Whether the bases are letters or bars (#263): what a recording context sees at two column widths. */
describe('drawStack below a legible letter size (#263)', () => {
  it('draws letters at full width and bars, no letters, when narrow', async () => {
    const { drawStack, stackLayout, FONT_SIZE } = await import('./alignmentStackDraw');
    const colours = {
      ink: '#000',
      muted: '#888',
      accent: '#00f',
      line: '#ccc',
      background: '#fff',
      other: '#999',
      bases: { A: '#0a0', C: '#00a', G: '#a80', T: '#a00' },
      byClass: ['#1', '#2', '#3', '#4', '#5', '#6'],
      trace: { A: '#0a0', C: '#00a', G: '#a80', T: '#a00', other: '#999' },
    } as unknown as Parameters<typeof drawStack>[1]['colours'];
    const run = (charWidth: number) => {
      const texts: string[] = [];
      const rects: number[][] = [];
      const ctx = new Proxy({} as StackContext, {
        get: (_, key) => {
          if (key === 'fillText') return (t: string) => texts.push(t);
          if (key === 'fillRect') return (...a: number[]) => rects.push(a);
          if (key === 'measureText') return () => ({ width: 30 });
          return () => undefined;
        },
        set: () => true,
      });
      const layout = stackLayout(stack, null, false, false, null, null, true);
      drawStack(
        ctx,
        {
          stack,
          referenceName: 'ref',
          confidentFrom: 20,
          selectedRow: null,
          track: null,
          sampleTracks: null,
          classes: null,
          disagreement: [],
          disagreeing: new Set(),
          showTrace: false,
          residues: null,
          changes: null,
          marked: null,
          selection: null,
          reviewed: new Set(),
          colours,
          charWidth,
          monoFont: `${FONT_SIZE}px monospace`,
          layout,
        },
        { left: 0, top: 0, width: 800, height: 300 },
      );
      return { texts, rects };
    };
    const full = run(8);
    expect(full.texts.some((t) => /^[ACGT]$/.test(t))).toBe(true);
    const narrow = run(3);
    expect(narrow.texts.some((t) => /^[ACGT]$/.test(t))).toBe(false);
    // Bars are merged along a run of one base, so the count is bounded by the columns.
    expect(narrow.rects.length).toBeGreaterThan(1);
  });
});
