import { createFeature, rangeSegment } from '../features';

import {
  BaseStyles,
  CLEAR_BASE_STYLE,
  type StyleRun,
  isBaseStyle,
  normalizeStyleColor,
} from './baseStyles';
import { describeEditOp } from './editOp';
import { extractRange } from './extract';
import { fragmentFromRange, fragmentToJSON, parseFragmentJSON } from './fragment';
import { SeqDocument } from './seqDocument';

const RED = { color: '#ff0000' } as const;
const BOLD = { bold: true } as const;

const runs = (s: BaseStyles): string =>
  s.runs.map((r) => `${r.start}-${r.end}:${JSON.stringify(r.style)}`).join(' ');

describe('BaseStyles', () => {
  it('styles a stretch, and merges it with a neighbour of the same style', () => {
    const s = BaseStyles.EMPTY.restyle(2, 5, RED).restyle(5, 8, RED);
    expect(s.runs).toEqual([{ start: 2, end: 8, style: RED }]);
  });

  it('patches only the part of the style it names', () => {
    const s = BaseStyles.EMPTY.restyle(0, 10, RED).restyle(4, 6, BOLD);
    expect(runs(s)).toBe(
      '0-4:{"color":"#ff0000"} 4-6:{"color":"#ff0000","bold":true} 6-10:{"color":"#ff0000"}',
    );
  });

  it('styles the unstyled gaps inside a patched stretch too', () => {
    const s = BaseStyles.EMPTY.restyle(2, 3, RED).restyle(6, 7, RED).restyle(0, 10, BOLD);
    expect(runs(s)).toBe(
      '0-2:{"bold":true} 2-3:{"color":"#ff0000","bold":true} 3-6:{"bold":true} 6-7:{"color":"#ff0000","bold":true} 7-10:{"bold":true}',
    );
  });

  it('takes a style off with null, and clears everything with CLEAR_BASE_STYLE', () => {
    const s = BaseStyles.EMPTY.restyle(0, 10, { ...RED, bold: true });
    expect(s.restyle(0, 10, { color: null }).runs).toEqual([
      { start: 0, end: 10, style: { bold: true } },
    ]);
    expect(s.restyle(3, 7, CLEAR_BASE_STYLE).runs).toEqual([
      { start: 0, end: 3, style: { color: '#ff0000', bold: true } },
      { start: 7, end: 10, style: { color: '#ff0000', bold: true } },
    ]);
    expect(s.restyle(0, 10, CLEAR_BASE_STYLE).isEmpty).toBe(true);
  });

  it('grows a run with bases inserted inside it, not at its edges', () => {
    const s = BaseStyles.EMPTY.restyle(2, 5, RED);
    expect(s.insert(3, 2).runs).toEqual([{ start: 2, end: 7, style: RED }]);
    expect(s.insert(2, 2).runs).toEqual([{ start: 4, end: 7, style: RED }]);
    expect(s.insert(5, 2).runs).toEqual([{ start: 2, end: 5, style: RED }]);
  });

  it('shrinks and drops runs with deleted bases', () => {
    const s = BaseStyles.EMPTY.restyle(2, 5, RED).restyle(8, 9, BOLD);
    expect(runs(s.delete(3, 9))).toBe('2-3:{"color":"#ff0000"}');
    expect(s.delete(0, 10).isEmpty).toBe(true);
    // What was on either side of a deletion joins up when it is alike.
    expect(BaseStyles.EMPTY.restyle(0, 2, RED).restyle(4, 6, RED).delete(2, 4).runs).toEqual([
      { start: 0, end: 4, style: RED },
    ]);
  });

  it('rotates, splitting a run the new origin falls inside', () => {
    const s = BaseStyles.EMPTY.restyle(2, 6, RED);
    expect(s.rotate(4, 10).runs).toEqual([
      { start: 0, end: 2, style: RED },
      { start: 8, end: 10, style: RED },
    ]);
  });

  it('turns over for a reverse complement', () => {
    const s = BaseStyles.EMPTY.restyle(0, 2, RED).restyle(5, 6, BOLD);
    expect(s.reverse(10).runs).toEqual([
      { start: 4, end: 5, style: BOLD },
      { start: 8, end: 10, style: RED },
    ]);
  });

  it('answers the style at a base', () => {
    const s = BaseStyles.EMPTY.restyle(2, 5, RED);
    expect(s.at(1)).toBeNull();
    expect(s.at(2)).toEqual(RED);
    expect(s.at(4)).toEqual(RED);
    expect(s.at(5)).toBeNull();
  });

  it('refuses runs that overlap, are out of order or lie off the sequence', () => {
    const r = (start: number, end: number): StyleRun => ({ start, end, style: RED });
    expect(() => BaseStyles.from([r(0, 5), r(4, 6)], 10)).toThrow(RangeError);
    expect(() => BaseStyles.from([r(5, 6), r(0, 2)], 10)).toThrow(RangeError);
    expect(() => BaseStyles.from([r(8, 11)], 10)).toThrow(RangeError);
    expect(() => BaseStyles.from([{ start: 0, end: 1, style: {} }], 10)).toThrow(RangeError);
    expect(BaseStyles.from([r(0, 5), r(5, 6)], 10).runs).toEqual([r(0, 6)]);
  });
});

describe('style values', () => {
  it('normalises colours to #rrggbb', () => {
    expect(normalizeStyleColor('#ABC')).toBe('#aabbcc');
    expect(normalizeStyleColor(' #FF0000 ')).toBe('#ff0000');
    expect(normalizeStyleColor('red')).toBeNull();
  });

  it('knows a style from anything else', () => {
    expect(isBaseStyle({ color: '#ff0000', size: 1.5 })).toBe(true);
    expect(isBaseStyle({ size: 3 })).toBe(false);
    expect(isBaseStyle({ bold: false })).toBe(false);
    expect(isBaseStyle({ colour: '#ff0000' })).toBe(false);
    expect(isBaseStyle({})).toBe(false);
  });
});

describe('a document with styled bases', () => {
  const doc = (topology: 'linear' | 'circular' = 'linear'): SeqDocument =>
    SeqDocument.create({ sequence: 'AAAACCCCGGGGTTTT', topology });

  it('styles a range across the origin of a circle as two runs', () => {
    const d = doc('circular').styleBases({ start: 14, end: 18 }, RED);
    expect(d.styles.runs).toEqual([
      { start: 0, end: 2, style: RED },
      { start: 14, end: 16, style: RED },
    ]);
  });

  it('is the same document when a style changes nothing', () => {
    const d = doc().styleBases({ start: 0, end: 4 }, RED);
    expect(d.styleBases({ start: 1, end: 3 }, RED)).toBe(d);
  });

  it('keeps a style on its bases through an edit before them', () => {
    const d = doc()
      .styleBases({ start: 4, end: 8 }, RED)
      .insert(0, 'TT')
      .delete({ start: 0, end: 1 });
    expect(d.styles.runs).toEqual([{ start: 5, end: 9, style: RED }]);
    expect(d.subsequence({ start: 5, end: 9 })).toBe('CCCC');
  });

  it('keeps it through a same-length replace, which moves nothing', () => {
    const d = doc().styleBases({ start: 4, end: 8 }, RED).replace({ start: 5, end: 7 }, 'TT');
    expect(d.styles.runs).toEqual([{ start: 4, end: 8, style: RED }]);
  });

  it('turns it over with a reverse complement and moves it with the origin', () => {
    const d = doc('circular').styleBases({ start: 0, end: 4 }, RED);
    expect(d.reverseComplement().styles.runs).toEqual([{ start: 12, end: 16, style: RED }]);
    expect(d.setOrigin(2).styles.runs).toEqual([
      { start: 0, end: 2, style: RED },
      { start: 14, end: 16, style: RED },
    ]);
  });

  it('pastes bases with the styles they were copied with, whatever they land in', () => {
    const source = doc().styleBases({ start: 1, end: 3 }, BOLD);
    const fragment = fragmentFromRange(source, { start: 0, end: 4 });
    expect(fragment.styles).toEqual([{ start: 1, end: 3, style: BOLD }]);
    const target = doc().styleBases({ start: 0, end: 16 }, RED);
    const pasted = target.insertFragment({ start: 8, end: 8 }, fragment);
    expect(runs(pasted.styles)).toBe(
      '0-8:{"color":"#ff0000"} 9-11:{"bold":true} 12-20:{"color":"#ff0000"}',
    );
  });

  it('takes the styles of an extract across the origin with it', () => {
    const d = doc('circular').styleBases({ start: 15, end: 17 }, RED);
    const sub = extractRange(d, { start: 14, end: 18 });
    expect(sub.styles.runs).toEqual([{ start: 1, end: 3, style: RED }]);
  });

  it('carries styles through the clipboard JSON, and refuses bad ones', () => {
    const fragment = fragmentFromRange(doc().styleBases({ start: 1, end: 3 }, BOLD), {
      start: 0,
      end: 4,
    });
    expect(parseFragmentJSON(fragmentToJSON(fragment))).toEqual(fragment);
    const bad = JSON.parse(fragmentToJSON(fragment)) as Record<string, unknown>;
    bad['styles'] = [{ start: 0, end: 9, style: BOLD }];
    expect(parseFragmentJSON(JSON.stringify(bad))).toBeNull();
    const plain = fragmentFromRange(doc(), { start: 0, end: 4 });
    expect(fragmentToJSON(plain)).not.toContain('styles');
  });

  it('keeps styles through annotation edits', () => {
    const d = doc()
      .styleBases({ start: 0, end: 4 }, RED)
      .addFeature(createFeature({ type: 'gene', segments: [rangeSegment(0, 4)] }))
      .rename('x');
    expect(d.styles.runs).toEqual([{ start: 0, end: 4, style: RED }]);
  });

  it('names the step by what it changed', () => {
    const op = (style: object) =>
      describeEditOp({ type: 'styleBases', range: { start: 0, end: 1 }, style });
    expect(op({ color: '#ff0000' })).toBe('Colour bases');
    expect(op({ highlight: '#ff0000' })).toBe('Highlight bases');
    expect(op({ size: 1.5 })).toBe('Resize bases');
    expect(op({ bold: true })).toBe('Bold bases');
    expect(op({ bold: true, size: 2 })).toBe('Style bases');
    expect(op({ size: null })).toBe('Ordinary size');
    expect(op(CLEAR_BASE_STYLE)).toBe('Clear base style');
  });
});
