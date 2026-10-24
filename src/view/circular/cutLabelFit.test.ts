import { SeqDocument } from '@/core';

import { type DrawingContext } from '../drawingContext';
import { NO_LANES, assignLanes } from '../linear/lanes';
import { NO_OVERLAY } from '../overlay';
import { PRINT_THEME } from '../svg/exportMap';
import { SvgContext } from '../svg/svgContext';
import { CircularLayout } from './circularLayout';
import { fitCutLabel, hiddenLabelsTip, renderCircularMap } from './renderCircular';

/** Ten pixels a character, so the widths in the tests are easy to read. */
const ctx = { measureText: (t: string) => ({ width: t.length * 10 }) } as unknown as DrawingContext;

describe('fitCutLabel (#292)', () => {
  it('keeps the position when the whole label fits', () => {
    expect(fitCutLabel(ctx, 'AlwNI (4,171)', 'AlwNI', 200)).toEqual({
      text: 'AlwNI (4,171)',
      width: 130,
    });
  });
  it('drops the position before it cuts it', () => {
    expect(fitCutLabel(ctx, 'AlwNI (4,171)', 'AlwNI', 129)).toEqual({ text: 'AlwNI', width: 50 });
    expect(fitCutLabel(ctx, 'AlwNI (4,171)', 'AlwNI', 60)).toEqual({ text: 'AlwNI', width: 50 });
  });
  it('shortens the names only when they do not fit either', () => {
    const fitted = fitCutLabel(ctx, 'AlwNI (4,171)', 'AlwNI', 45);
    expect(fitted?.text.endsWith('…')).toBe(true);
    expect(fitted?.text).not.toContain('(');
  });
  it('gives up where nothing sensible fits', () => {
    expect(fitCutLabel(ctx, 'AlwNI (4,171)', 'AlwNI', 20)).toBeNull();
  });
});

describe('hiddenLabelsTip (#292)', () => {
  it('lists the labels, one a line', () => {
    expect(hiddenLabelsTip(['lacZ', 'AmpR'])).toBe('Labels not shown:\nlacZ\nAmpR');
  });
  it('says how many more past a dozen', () => {
    const names = Array.from({ length: 15 }, (_, i) => `n${i}`);
    const lines = hiddenLabelsTip(names).split('\n');
    expect(lines).toHaveLength(14);
    expect(lines.at(-1)).toBe('and 3 more');
  });
});

describe('cut labels on a narrow map (#292)', () => {
  const doc = SeqDocument.create({
    name: 'p',
    sequence: 'ACGT'.repeat(1250),
    topology: 'circular',
  });
  const texts = (width: number, cut: number): { svg: string; hidden: number } => {
    const lanes = assignLanes([], doc.length);
    const layout = new CircularLayout(doc.length, 'circular', {
      width,
      height: 400,
      laneCount: lanes.laneCount,
      ringWidth: 14,
      outerMargin: 40,
    });
    const svg = new SvgContext(width, 400);
    const result = renderCircularMap(svg, {
      doc,
      layout,
      lanes,
      selection: null,
      cutSites: [
        { enzyme: 'AlwNI', cut, cutBottom: cut + 4, siteStart: cut - 3, strand: 'forward' },
      ],
      overlay: NO_OVERLAY,
      overlayLanes: NO_LANES,
      edits: null,
      hoveredFeatureId: null,
      hoveredCut: null,
      width,
      height: 400,
      devicePixelRatio: 1,
      theme: PRINT_THEME,
      sansFont: '12px Helvetica, Arial, sans-serif',
      titleFont: '600 15px Helvetica, Arial, sans-serif',
    });
    return { svg: svg.toSvg(), hidden: result.droppedLabels };
  };

  it('never leaves a position cut mid-number, and shows the bare name where it fits', () => {
    let bare = 0;
    for (let width = 160; width <= 520; width += 10) {
      for (const cut of [1250, 3750]) {
        const { svg } = texts(width, cut);
        expect(svg).not.toMatch(/AlwNI \([^)<]*…/);
        if (svg.includes('>AlwNI<')) bare++;
      }
    }
    expect(bare).toBeGreaterThan(0);
  });
});
