import fc from 'fast-check';

import { type SeqDocument, type StyleRun, SeqDocument as Doc } from '@/core';
import { docShapeArb, layFeatures, opShapeArb, resolveOp } from '@/test/editArbitraries';

import {
  formatBaseStylesComment,
  isBaseStylesComment,
  parseBaseStylesComment,
} from './baseStylesComment';
import { parseGenBank } from './parseGenBank';
import { writeGenBank } from './writeGenBank';

/**
 * Base styles in a GenBank file (#89, #91): a COMMENT block of ours,
 * `PlasmidPop-base-styles: 1` and the runs after it. Checked: every kind of
 * style round-trips, a document with none writes no block, many runs wrap
 * to GenBank's width and read back, a block this build cannot read stays an
 * ordinary comment, runs past the end of the record are dropped with a
 * warning, and write → parse → write is a fixed point after random edits.
 */

function must<T>(value: T | null | undefined, what: string): T {
  if (value === null || value === undefined) throw new Error(`expected ${what}`);
  return value;
}

const readBack = (text: string): SeqDocument => must(parseGenBank(text).documents[0], 'a record');

const plain = (): SeqDocument =>
  Doc.create({ name: 'pStyled', sequence: 'ACGT'.repeat(50), topology: 'circular' });

describe('base styles in GenBank', () => {
  it('round-trip every kind of style', () => {
    const doc = plain()
      .styleBases({ start: 0, end: 10 }, { color: '#d62728' })
      .styleBases({ start: 5, end: 15 }, { bold: true })
      .styleBases({ start: 20, end: 30 }, { highlight: '#ffe066', size: 1.5 })
      .styleBases({ start: 195, end: 205 }, { size: 2 });
    const text = writeGenBank(doc);
    expect(text).toContain('COMMENT     PlasmidPop-base-styles: 1');
    expect(text).toContain('1..5:color=#d62728');
    const back = readBack(text);
    expect(back.styles.runs).toEqual(doc.styles.runs);
    expect(back.metadata.comments).toEqual([]);
    expect(writeGenBank(back)).toBe(text);
  });

  it('write no block for a document without styles', () => {
    expect(writeGenBank(plain())).not.toContain('PlasmidPop-base-styles');
  });

  it('wrap many runs to the width of a GenBank line', () => {
    let doc = plain();
    for (let i = 0; i < 60; i += 2) doc = doc.styleBases({ start: i, end: i + 1 }, { bold: true });
    const text = writeGenBank(doc);
    for (const line of text.split('\n')) expect(line.length).toBeLessThanOrEqual(80);
    expect(readBack(text).styles.runs).toEqual(doc.styles.runs);
  });

  it('leave a block that cannot be read among the comments', () => {
    for (const bad of [
      'PlasmidPop-base-styles: 2\n1..4:bold',
      'PlasmidPop-base-styles: 1\n1..4:blink',
      'PlasmidPop-base-styles: 1\n5..8:bold 1..4:bold',
      'PlasmidPop-base-styles: 1\n1..4:size=3',
      'PlasmidPop-base-styles: 1\n1..4:color=red',
    ]) {
      expect(parseBaseStylesComment(bad)).toBeNull();
      expect(isBaseStylesComment(bad)).toBe(true);
    }
    expect(parseBaseStylesComment('1..4:bold')).toBeNull();
  });

  it('read short colours and drop runs past the end of the record', () => {
    expect(parseBaseStylesComment('PlasmidPop-base-styles: 1\n1..4:color=#F00')).toEqual([
      { start: 0, end: 4, style: { color: '#ff0000' } },
    ]);
    const text = writeGenBank(plain()).replace(
      /^(FEATURES)/m,
      'COMMENT     PlasmidPop-base-styles: 1\n            1..4:bold 199..240:bold\n$1',
    );
    const result = parseGenBank(text);
    expect(result.documents[0]?.styles.runs).toEqual([{ start: 0, end: 4, style: { bold: true } }]);
    expect(result.warnings.some((w) => w.message.includes('base styles'))).toBe(true);
  });

  it('format an empty list as just the header, which reads back as no runs', () => {
    expect(formatBaseStylesComment([])).toBe('PlasmidPop-base-styles: 1');
    expect(parseBaseStylesComment('PlasmidPop-base-styles: 1')).toEqual([]);
    expect(parseBaseStylesComment('PlasmidPop-base-styles: 1\n\n1..4:bold  \n')).toEqual([
      { start: 0, end: 4, style: { bold: true } },
    ]);
  });

  it('fill each line as far as 67 columns and no further', () => {
    const bold = { bold: true } as const;
    const runs = (size: 1.5 | 1.25): StyleRun[] => [
      { start: 0, end: 10, style: bold },
      { start: 11, end: 20, style: bold },
      { start: 21, end: 30, style: bold },
      { start: 31, end: 40, style: bold },
      { start: 41, end: 50, style: { bold: true, size } },
      { start: 51, end: 60, style: bold },
    ];
    const head = '1..10:bold 12..20:bold 22..30:bold 32..40:bold';
    // Exactly 67 columns fits on the line.
    expect(formatBaseStylesComment(runs(1.5))).toBe(
      `PlasmidPop-base-styles: 1\n${head} 42..50:bold,size=1.5\n52..60:bold`,
    );
    // 68 does not.
    expect(formatBaseStylesComment(runs(1.25))).toBe(
      `PlasmidPop-base-styles: 1\n${head}\n42..50:bold,size=1.25 52..60:bold`,
    );
  });

  it('put a run too long for any line on a line of its own, with no empty line before it', () => {
    const run: StyleRun = {
      start: 123456788,
      end: 123456799,
      style: { color: '#aabbcc', highlight: '#ddeeff', bold: true, size: 1.25 },
    };
    const text = formatBaseStylesComment([run]);
    expect(text).toBe(
      'PlasmidPop-base-styles: 1\n123456789..123456799:color=#aabbcc,highlight=#ddeeff,bold,size=1.25',
    );
    expect(parseBaseStylesComment(text)).toEqual([run]);
  });

  it('know the block by its header, even indented', () => {
    expect(isBaseStylesComment('  PlasmidPop-base-styles: 1\n1..4:bold')).toBe(true);
    expect(isBaseStylesComment('Made with PlasmidPop-base-styles: 1')).toBe(false);
  });

  it('refuse a run that repeats a part, gives a part a value it takes none of, or is malformed', () => {
    for (const body of [
      '1..4:bold,bold',
      '1..4:bold=yes',
      '1..4:color',
      '1..4:highlight',
      '1..4:color=#ff0000,color=#00ff00',
      '1..4:size=1.5,size=2',
      '1..4:size',
      '1..4:blink=1.5',
      '1..4:=bold',
      'x1..4:bold',
      '1-4:bold',
      '5..4:bold',
      '6..4:bold',
      '1..4:',
    ]) {
      expect(parseBaseStylesComment(`PlasmidPop-base-styles: 1\n${body}`)).toBeNull();
    }
    expect(
      parseBaseStylesComment('PlasmidPop-base-styles: 1\n1..4:bold,size=1.25,highlight=#FFE066'),
    ).toEqual([{ start: 0, end: 4, style: { bold: true, size: 1.25, highlight: '#ffe066' } }]);
  });

  it('write → parse → write is a fixed point after random edits', () => {
    fc.assert(
      fc.property(docShapeArb, fc.array(opShapeArb, { maxLength: 12 }), (shape, ops) => {
        let doc = Doc.create({
          sequence: shape.sequence,
          topology: shape.topology,
          features: layFeatures(shape),
        });
        for (const op of ops) {
          const resolved = resolveOp(doc, op);
          if (resolved !== null) doc = doc.apply(resolved);
        }
        if (doc.length === 0) return;
        const text = writeGenBank(doc);
        const back = readBack(text);
        expect(back.styles.runs).toEqual(doc.styles.runs);
        expect(writeGenBank(back)).toBe(text);
      }),
      { numRuns: 150 },
    );
  });
});
