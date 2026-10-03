import { alignEitherStrand } from '@/core';

import { stackAlignments } from './alignmentStack';
import {
  MAX_SVG_CELLS,
  alignmentSvg,
  exportFileName,
  pictureLimit,
  pictureSize,
  pngScale,
} from './alignmentExport';
import { ColumnClass } from './alignmentTrack';
import { finishReadAlignment, prepareReadAlignment } from './readAlignment';
import { stackLayout, type Colours, type StackDrawing } from './components/alignmentStackDraw';

const reference = 'GATTACAGCTTGACCGTAAGCTAGGCTTACGATCGATTGCAAGTCCGATGCATTGACCTA';
const plain = { sequence: reference, offset: 0, wrap: null };

const colours: Colours = {
  ink: '#111111',
  muted: '#777777',
  line: '#cccccc',
  background: '#ffffff',
  bases: { A: '#00aa00', C: '#0000ff', G: '#ffaa00', T: '#ff0000', U: '#ff0000' },
  other: '#888888',
  byClass: ['#6b7280', '#1f5fd0', '#d81b3c'],
  accent: '#7a3fd0',
  trace: { a: '#0a0', c: '#00f', g: '#000', t: '#f00', quality: '#ccc' },
};

function drawingOf(sequence: string, name = 'read one'): StackDrawing {
  const prepared = prepareReadAlignment(plain, { sequence, read: null }, null);
  if (!prepared.ok) throw new Error(prepared.message);
  const { job } = prepared;
  const result = finishReadAlignment(job, alignEitherStrand(job.a, job.b, { mode: 'local' }));
  const stack = stackAlignments(plain, [{ name, result }]);
  return {
    stack,
    referenceName: 'pRef <1>',
    confidentFrom: 20,
    selectedRow: null,
    track: null,
    classes: new Uint8Array(stack.columns).fill(ColumnClass.None),
    disagreement: [],
    disagreeing: new Set(),
    showTrace: false,
    residues: null,
    marked: null,
    colours,
    charWidth: 8,
    monoFont: '13px monospace',
    layout: stackLayout(stack, null, false, false),
  };
}

describe('the picture of the stack', () => {
  const part = reference.slice(10, 40);
  const changed = `${part.slice(0, 10)}${part.charAt(10) === 'A' ? 'C' : 'A'}${part.slice(11)}`;
  const d = drawingOf(changed);

  it('is sized by the names and the columns drawn', () => {
    const size = pictureSize(d, { start: 10, end: 30 });
    expect(size.width).toBe(168 + 20 * 8);
    expect(size.height).toBe(d.layout.contentHeight);
    expect(size.cells).toBe(40);
  });

  it('draws the range, names escaped, one base per column, the difference shaded', () => {
    const svg = alignmentSvg(d, { start: 10, end: 22 }, 'Alignment');
    expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg" width="264"')).toBe(true);
    expect(svg).toContain('pRef &lt;1&gt;');
    expect(svg).toContain('read one');
    // Ten reference bases and ten of the sample, each its own text, plus the two names.
    expect(svg.match(/<text /g)?.length).toBeGreaterThanOrEqual(22);
    // The mismatch is a tinted block in the class colour.
    expect(svg).toContain('fill="#6b7280" fill-opacity="0.34"');
    // Columns outside the range are not drawn: only what was asked for is in the file.
    const without = alignmentSvg(d, { start: 10, end: 11 }, 'Alignment');
    expect(without.match(/<text /g)?.length).toBeLessThan(svg.match(/<text /g)?.length ?? 0);
    // The names are clipped apart from the columns and the groups are closed.
    expect(svg.match(/<g /g)?.length).toBe(svg.match(/<\/g>/g)?.length);
    expect(svg.endsWith('</svg>')).toBe(true);
  });

  it('draws the whole stack from its first column to its last', () => {
    const svg = alignmentSvg(d, { start: 0, end: d.stack.columns }, 'A');
    for (const ch of reference.slice(0, 5)) expect(svg).toContain(`>${ch}</text>`);
    expect(svg).toContain(`width="${Math.ceil(168 + d.stack.columns * 8)}"`);
  });

  it('refuses what is too large, with the reason', () => {
    const wide = { ...d, stack: { ...d.stack, columns: MAX_SVG_CELLS } };
    expect(pictureLimit(wide, { start: 0, end: MAX_SVG_CELLS }, 'svg')).toMatch(
      /Too large for SVG/,
    );
    expect(() => alignmentSvg(wide, { start: 0, end: MAX_SVG_CELLS }, 't')).toThrow(/Too large/);
    expect(pictureLimit(wide, { start: 0, end: MAX_SVG_CELLS }, 'png')).toMatch(
      /Too large for PNG/,
    );
    expect(pictureLimit(d, { start: 4, end: 4 }, 'svg')).toMatch(/no columns/);
    expect(pictureLimit(d, { start: 0, end: 20 }, 'svg')).toBeNull();
    expect(pictureLimit(d, { start: 0, end: 20 }, 'png')).toBeNull();
  });
});

describe('PNG scale', () => {
  it('is 2 when it fits, 1 when only that does, null when neither', () => {
    expect(pngScale({ width: 1000, height: 100, cells: 1 })).toBe(2);
    expect(pngScale({ width: 10_000, height: 100, cells: 1 })).toBe(1);
    expect(pngScale({ width: 20_000, height: 100, cells: 1 })).toBeNull();
    expect(pngScale({ width: 15_000, height: 15_000, cells: 1 })).toBeNull();
  });
});

describe('export file names', () => {
  it('uses the reference, the 1-based columns and the extension', () => {
    expect(exportFileName('pUC 19/x', { start: 0, end: 120 }, 'svg')).toBe(
      'pUC_19_x-alignment-1-120.svg',
    );
    expect(exportFileName('  ', { start: 4, end: 9 }, 'png')).toBe('alignment-alignment-5-9.png');
  });
});
